import {
  describe, it, expect, beforeAll, beforeEach
} from "vitest";
import { createRequire } from "module";
import { testDbManager } from "../helpers/testDbManager.js";

const require = createRequire(import.meta.url);

/**
 * Covers the conversation-history query and mutation logic: archive/star state,
 * the statuses + starred filters, search escaping, owner scoping and the bulk
 * endpoint's contract.
 *
 * Exercises the controller rather than the HTTP routes on purpose — the routes
 * carry aggressive per-IP rate limits (bulk is 10/min) that a suite this size
 * would trip, and all of the logic under test is SQL in the controller.
 */
describe("AI Conversations", () => {
  let models;
  let controller;
  let teamId;
  let userId;
  let otherUserId;
  let seq = 0;

  beforeAll(async () => {
    // globalSetup starts and migrates the container in the *main* process, but
    // tests run in a fork where this singleton is fresh — so bring it up here if
    // needed (same guard as health.test.js). This must happen before the models
    // are required, because start() is what points CB_DB_* at the migrated
    // database that the models singleton then connects to.
    if (!testDbManager.getSequelize()) {
      await testDbManager.start();
    }

    models = require("../../models/models/index.js");
    controller = require("../../controllers/AiController.js");
    await models.sequelize.authenticate();
  });

  beforeEach(async () => {
    // Own the cleanup for the same reason: don't depend on setup.js's truncation
    // having a live handle. Child rows first — the FKs are ON DELETE NO ACTION.
    await models.sequelize.query("DELETE FROM \"AiMessage\"");
    await models.sequelize.query("DELETE FROM \"AiUsage\"");
    await models.sequelize.query("DELETE FROM \"AiConversation\"");

    // Fresh owners per test, uniquely named so a shared database can't collide.
    seq += 1;
    const team = await models.Team.create({ name: `AI Test Team ${seq}` });
    const user = await models.User.create({
      name: "Owner", email: `ai-owner-${seq}@example.com`, password: "x", active: true,
    });
    const other = await models.User.create({
      name: "Other", email: `ai-other-${seq}@example.com`, password: "x", active: true,
    });
    teamId = team.id;
    userId = user.id;
    otherUserId = other.id;
  });

  /** Create a conversation owned by the test user. */
  const makeConversation = async (overrides = {}) => models.AiConversation.create({
    team_id: teamId,
    user_id: userId,
    title: "Conversation",
    source: "app",
    status: "active",
    message_count: 1,
    ...overrides,
  });

  const idsOf = (result) => result.conversations.map((c) => c.id);

  describe("schema", () => {
    it("defaults archived and starred to false", async () => {
      const conv = await makeConversation();
      expect(conv.archived).toBe(false);
      expect(conv.starred).toBe(false);
      expect(conv.archived_at).toBeFalsy();
    });
  });

  describe("statuses filter", () => {
    beforeEach(async () => {
      await makeConversation({ title: "active one" });
      await makeConversation({ title: "archived one", archived: true });
    });

    it("returns only active conversations by default", async () => {
      const result = await controller.getConversations(teamId, userId, {});
      expect(result.conversations).toHaveLength(1);
      expect(result.conversations[0].title).toBe("active one");
      expect(result.statuses).toEqual(["active"]);
    });

    it("returns only archived when asked", async () => {
      const result = await controller.getConversations(teamId, userId, { statuses: ["archived"] });
      expect(result.conversations).toHaveLength(1);
      expect(result.conversations[0].title).toBe("archived one");
    });

    it("merges both statuses into one list", async () => {
      const result = await controller.getConversations(teamId, userId, {
        statuses: ["active", "archived"],
      });
      expect(result.conversations).toHaveLength(2);
      expect(result.total).toBe(result.activeCount + result.archivedCount);
      expect(result.statuses).toEqual(["active", "archived"]);
    });

    it("falls back to active for unrecognised statuses", async () => {
      const result = await controller.getConversations(teamId, userId, { statuses: ["bogus"] });
      expect(result.statuses).toEqual(["active"]);
      expect(result.conversations).toHaveLength(1);
    });

    it("reports counts for both statuses regardless of the filter", async () => {
      const result = await controller.getConversations(teamId, userId, { statuses: ["active"] });
      expect(result.activeCount).toBe(1);
      expect(result.archivedCount).toBe(1);
    });
  });

  describe("starred", () => {
    it("pins starred conversations to the top, newest first within each block", async () => {
      // Oldest-to-newest so updatedAt ordering is unambiguous.
      const a = await makeConversation({ title: "a" });
      const b = await makeConversation({ title: "b" });
      const c = await makeConversation({ title: "c" });
      // Star the OLDEST, which unstarred would sort last.
      await controller.setConversationStarred(a.id, teamId, userId, true);

      const result = await controller.getConversations(teamId, userId, { limit: 10 });
      expect(idsOf(result)[0]).toBe(a.id);
      // The remaining two keep updatedAt DESC between themselves.
      expect(idsOf(result).slice(1)).toEqual([c.id, b.id]);
    });

    it("does not change updatedAt when starring", async () => {
      const conv = await makeConversation();
      const before = conv.updatedAt.getTime();
      await controller.setConversationStarred(conv.id, teamId, userId, true);
      await conv.reload();
      expect(conv.starred).toBe(true);
      expect(conv.updatedAt.getTime()).toBe(before);
    });

    it("filters to starred only, with an exact total", async () => {
      await makeConversation({ title: "plain" });
      const starred = await makeConversation({ title: "starred" });
      await controller.setConversationStarred(starred.id, teamId, userId, true);

      const result = await controller.getConversations(teamId, userId, { starred: true });
      expect(idsOf(result)).toEqual([starred.id]);
      expect(result.total).toBe(1);
      expect(result.starredCount).toBe(1);
      expect(result.starred).toBe(true);
    });

    it("keeps the starred total exact when combined with statuses", async () => {
      const activeStar = await makeConversation({ title: "active star" });
      const archivedStar = await makeConversation({ title: "archived star", archived: true });
      await controller.setConversationStarred(activeStar.id, teamId, userId, true);
      await controller.setConversationStarred(archivedStar.id, teamId, userId, true);

      const activeOnly = await controller.getConversations(teamId, userId, {
        statuses: ["active"], starred: true,
      });
      expect(activeOnly.total).toBe(1);
      expect(activeOnly.conversations).toHaveLength(1);

      const both = await controller.getConversations(teamId, userId, {
        statuses: ["active", "archived"], starred: true,
      });
      expect(both.total).toBe(2);
      expect(both.conversations).toHaveLength(2);
    });

    it("rejects a star on someone else's conversation", async () => {
      const conv = await makeConversation();
      await expect(
        controller.setConversationStarred(conv.id, teamId, otherUserId, true),
      ).rejects.toThrow("Conversation not found");
      await conv.reload();
      expect(conv.starred).toBe(false);
    });

    it("rejects a malformed id without a database cast error", async () => {
      await expect(
        controller.setConversationStarred("not-a-uuid", teamId, userId, true),
      ).rejects.toThrow("Conversation not found");
    });
  });

  describe("archive", () => {
    it("sets archived_at and leaves updatedAt alone", async () => {
      const conv = await makeConversation();
      const before = conv.updatedAt.getTime();
      await controller.setConversationArchived(conv.id, teamId, userId, true);
      await conv.reload();
      expect(conv.archived).toBe(true);
      expect(conv.archived_at).toBeTruthy();
      expect(conv.updatedAt.getTime()).toBe(before);
    });

    it("clears archived_at on unarchive", async () => {
      const conv = await makeConversation({ archived: true, archived_at: new Date() });
      await controller.setConversationArchived(conv.id, teamId, userId, false);
      await conv.reload();
      expect(conv.archived).toBe(false);
      expect(conv.archived_at).toBeNull();
    });

    it("rejects archiving someone else's conversation", async () => {
      const conv = await makeConversation();
      await expect(
        controller.setConversationArchived(conv.id, teamId, otherUserId, true),
      ).rejects.toThrow("Conversation not found");
    });
  });

  describe("title search", () => {
    it("matches case-insensitively", async () => {
      await makeConversation({ title: "Quarterly Revenue" });
      await makeConversation({ title: "Churn" });
      const result = await controller.getConversations(teamId, userId, { search: "REVENUE" });
      expect(result.conversations).toHaveLength(1);
      expect(result.search).toBe("REVENUE");
    });

    it("treats % as a literal, not a wildcard", async () => {
      await makeConversation({ title: "100% margin" });
      await makeConversation({ title: "no percent here" });

      const literal = await controller.getConversations(teamId, userId, { search: "%" });
      expect(literal.conversations).toHaveLength(1);
      expect(literal.conversations[0].title).toBe("100% margin");
    });

    it("treats _ as a literal, not a single-char wildcard", async () => {
      await makeConversation({ title: "q1_report" });
      await makeConversation({ title: "qXreport" });

      const literal = await controller.getConversations(teamId, userId, { search: "_" });
      expect(literal.conversations).toHaveLength(1);
      expect(literal.conversations[0].title).toBe("q1_report");
    });

    it("narrows the counts to the search term", async () => {
      await makeConversation({ title: "match me" });
      await makeConversation({ title: "unrelated" });
      const result = await controller.getConversations(teamId, userId, { search: "match" });
      expect(result.activeCount).toBe(1);
      expect(result.total).toBe(1);
    });
  });

  describe("pagination", () => {
    it("pages without overlap and reports hasMore", async () => {
      // eslint-disable-next-line no-plusplus
      for (let i = 0; i < 5; i++) {
        // eslint-disable-next-line no-await-in-loop
        await makeConversation({ title: `conv ${i}` });
      }
      const page1 = await controller.getConversations(teamId, userId, { limit: 2, offset: 0 });
      const page2 = await controller.getConversations(teamId, userId, { limit: 2, offset: 2 });

      expect(page1.conversations).toHaveLength(2);
      expect(page1.total).toBe(5);
      expect(page1.hasMore).toBe(true);
      expect(idsOf(page2).some((id) => idsOf(page1).includes(id))).toBe(false);

      const last = await controller.getConversations(teamId, userId, { limit: 2, offset: 4 });
      expect(last.hasMore).toBe(false);
    });

    it("clamps the page size and offset", async () => {
      await makeConversation();
      expect((await controller.getConversations(teamId, userId, { limit: 5000 })).limit).toBe(100);
      expect((await controller.getConversations(teamId, userId, { limit: 0 })).limit).toBe(20);
      expect((await controller.getConversations(teamId, userId, { limit: "abc" })).limit).toBe(20);
      expect((await controller.getConversations(teamId, userId, { offset: -10 })).offset).toBe(0);
    });
  });

  describe("ownership", () => {
    it("never lists another user's conversations", async () => {
      await makeConversation({ title: "mine" });
      await models.AiConversation.create({
        team_id: teamId, user_id: otherUserId, title: "theirs", source: "app", message_count: 1,
      });

      const mine = await controller.getConversations(teamId, userId, {});
      expect(mine.conversations).toHaveLength(1);
      expect(mine.conversations[0].title).toBe("mine");
      expect(mine.activeCount).toBe(1);
    });
  });

  describe("delete", () => {
    it("removes messages but preserves usage rows with a null conversation_id", async () => {
      const conv = await makeConversation();
      await models.AiMessage.create({
        conversation_id: conv.id, role: "user", content: "hi", sequence: 0,
      });
      await models.AiUsage.create({
        conversation_id: conv.id,
        team_id: teamId,
        model: "test-model",
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      });

      await controller.deleteConversation(conv.id, teamId, userId);

      expect(await models.AiConversation.count({ where: { id: conv.id } })).toBe(0);
      expect(await models.AiMessage.count({ where: { conversation_id: conv.id } })).toBe(0);
      // Billing rows survive, detached from the deleted conversation.
      expect(await models.AiUsage.count({ where: { team_id: teamId } })).toBe(1);
      expect(await models.AiUsage.count({ where: { conversation_id: null } })).toBe(1);
    });

    it("refuses to delete another user's conversation", async () => {
      const conv = await makeConversation();
      await expect(
        controller.deleteConversation(conv.id, teamId, otherUserId),
      ).rejects.toThrow("Conversation not found");
      expect(await models.AiConversation.count({ where: { id: conv.id } })).toBe(1);
    });

    it("reports a missing conversation rather than succeeding twice", async () => {
      const conv = await makeConversation();
      await controller.deleteConversation(conv.id, teamId, userId);
      await expect(
        controller.deleteConversation(conv.id, teamId, userId),
      ).rejects.toThrow("Conversation not found");
    });
  });

  describe("bulk", () => {
    it("archives and unarchives several at once", async () => {
      const a = await makeConversation();
      const b = await makeConversation();

      const archived = await controller.bulkUpdateConversations(teamId, userId, "archive", [a.id, b.id]);
      expect(archived.affected).toBe(2);
      expect(archived.skipped).toEqual([]);
      expect(await models.AiConversation.count({ where: { archived: true } })).toBe(2);

      const restored = await controller.bulkUpdateConversations(teamId, userId, "unarchive", [a.id, b.id]);
      expect(restored.affected).toBe(2);
      expect(await models.AiConversation.count({ where: { archived: true } })).toBe(0);
    });

    it("de-dupes ids and skips ones it cannot act on", async () => {
      const a = await makeConversation();
      const result = await controller.bulkUpdateConversations(teamId, userId, "archive", [
        a.id, a.id, "00000000-0000-4000-8000-000000000000", "not-a-uuid",
      ]);
      expect(result.requested).toBe(3); // duplicate collapsed
      expect(result.affected).toBe(1);
      expect(result.skipped).toHaveLength(2);
    });

    it("never touches another user's conversations", async () => {
      const theirs = await models.AiConversation.create({
        team_id: teamId, user_id: otherUserId, title: "theirs", source: "app", message_count: 1,
      });
      const result = await controller.bulkUpdateConversations(teamId, userId, "delete", [theirs.id]);
      expect(result.affected).toBe(0);
      expect(result.skipped).toEqual([theirs.id]);
      expect(await models.AiConversation.count({ where: { id: theirs.id } })).toBe(1);
    });

    it("deletes in bulk, taking the messages with them", async () => {
      const a = await makeConversation();
      const b = await makeConversation();
      await models.AiMessage.create({
        conversation_id: a.id, role: "user", content: "hi", sequence: 0,
      });

      const result = await controller.bulkUpdateConversations(teamId, userId, "delete", [a.id, b.id]);
      expect(result.affected).toBe(2);
      expect(await models.AiConversation.count()).toBe(0);
      expect(await models.AiMessage.count()).toBe(0);
    });

    it("validates the action and the id list", async () => {
      const conv = await makeConversation();
      await expect(
        controller.bulkUpdateConversations(teamId, userId, "nuke", [conv.id]),
      ).rejects.toThrow(/action must be one of/);
      await expect(
        controller.bulkUpdateConversations(teamId, userId, "archive", []),
      ).rejects.toThrow(/ids must be a non-empty array/);
      await expect(
        controller.bulkUpdateConversations(teamId, userId, "archive", "nope"),
      ).rejects.toThrow(/ids must be a non-empty array/);
    });

    it("caps the batch at 100 ids", async () => {
      const tooMany = Array.from(
        { length: 101 },
        (unused, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      );
      await expect(
        controller.bulkUpdateConversations(teamId, userId, "archive", tooMany),
      ).rejects.toThrow(/more than 100/);

      // Exactly at the cap is accepted (nothing matches, so nothing is affected).
      const atCap = await controller.bulkUpdateConversations(
        teamId, userId, "archive", tooMany.slice(0, 100),
      );
      expect(atCap.requested).toBe(100);
      expect(atCap.affected).toBe(0);
    });
  });
});
