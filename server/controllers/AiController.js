const {
  fn, col, literal, Op,
} = require("sequelize");

const { orchestrate, availableTools } = require("../modules/ai/orchestrator/orchestrator");
const { aiClient, aiModel } = require("../modules/ai/aiClient");
const db = require("../models/models");
const socketManager = require("../modules/socketManager");
const logger = require("../modules/logger").child({ module: "AiController" });

// Conversation ids are UUIDs. Postgres throws "invalid input syntax for type
// uuid" on anything else, which would surface as an opaque 500, so ids coming
// off the wire are shape-checked before they reach a query.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DEFAULT_CONVERSATION_PAGE_SIZE = 20;
const MAX_CONVERSATION_PAGE_SIZE = 100;
// Matches the page size cap so "select everything loaded" always fits one call.
const MAX_BULK_CONVERSATIONS = 100;
const BULK_ACTIONS = ["archive", "unarchive", "delete"];

/**
 * Escape a user-supplied ILIKE search term.
 *
 * Postgres treats % and _ as wildcards and \ as the escape character, so an
 * unescaped term lets a bare "%" match everything and "_" match any character.
 * Sequelize binds the value as a parameter, so the backslash reaches Postgres
 * literally and is honoured as ILIKE's default escape character (no ESCAPE
 * clause needed).
 */
function escapeLikePattern(value) {
  return String(value).replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Generate a short conversation title from the user's question and the AI response.
 * Runs as a lightweight, fire-and-forget AI call so it doesn't block the response.
 */
async function generateConversationTitle(question, aiResponse) {
  if (!aiClient) return null;

  try {
    const response = await aiClient.chat.completions.create({
      model: aiModel,
      max_tokens: 60,
      messages: [
        {
          role: "system",
          content: "Generate a short, descriptive title (max 8 words) for a data analytics conversation. Output ONLY the title text, nothing else. No quotes, no punctuation at the end.",
        },
        {
          role: "user",
          content: `User asked: "${question}"\n\nAssistant responded: "${(aiResponse || "").substring(0, 300)}"`,
        },
      ],
    });

    const title = response.choices?.[0]?.message?.content?.trim();
    return title || null;
  } catch (err) {
    logger.warn({ err }, "Failed to generate conversation title");
    return null;
  }
}

async function getOrchestration(
  teamId,
  question,
  conversationHistory,
  aiConversationId,
  userId,
  context = null,
  clientTurnId = null,
) {
  let conversation;

  // Load existing conversation or create new one
  if (aiConversationId) {
    conversation = await db.AiConversation.findByPk(aiConversationId);
    if (!conversation) {
      throw new Error("Conversation not found");
    }
    if (conversation.team_id !== teamId) {
      throw new Error("Conversation does not belong to this team");
    }
  } else {
    // Create new conversation
    conversation = await db.AiConversation.create({
      team_id: teamId,
      user_id: userId,
      title: "New Conversation", // Will be updated by orchestrator
      status: "active",
    });

    // Emit conversation ID to user's room immediately so they can join before orchestration
    socketManager.emitToUser(userId, "conversation-created", {
      conversationId: conversation.id
    });
  }

  // Load conversation history from database if not provided
  let fullHistory = conversationHistory;
  if (!conversationHistory || conversationHistory.length === 0) {
    // Rebuild history from AiMessage table
    const messages = await db.AiMessage.findAll({
      where: { conversation_id: conversation.id },
      order: [["sequence", "ASC"]],
    });

    fullHistory = messages.map((msg) => {
      const messageObj = {
        role: msg.role,
        content: msg.content,
      };

      // Add tool-specific fields
      if (msg.tool_calls) {
        messageObj.tool_calls = msg.tool_calls;
      }
      if (msg.tool_name) {
        messageObj.name = msg.tool_name;
      }
      if (msg.tool_call_id) {
        messageObj.tool_call_id = msg.tool_call_id;
      }

      return messageObj;
    });
  }

  try {
    const orchestration = await orchestrate(teamId, question, fullHistory, conversation, context, { clientTurnId, userId });

    const finalMessage = orchestration.message;
    const isNewConversation = !conversation || conversation.message_count === 0;

    // Get the starting sequence number (0 for new conversations, or continue from existing)
    const existingMessageCount = await db.AiMessage.count({
      where: { conversation_id: conversation.id }
    });

    // Save new messages to AiMessage table
    // Use newMessageStartIndex from orchestrator to correctly skip system prompt + loaded history
    const sliceFrom = orchestration.newMessageStartIndex ?? existingMessageCount;
    const newMessages = orchestration.conversationHistory
      .slice(sliceFrom)
      .filter((msg) => msg.role !== "system"); // Never persist system prompts
    const messagePromises = newMessages.map((msg, index) => {
      const messageData = {
        conversation_id: conversation.id,
        role: msg.role,
        content: msg.content,
        sequence: existingMessageCount + index,
      };

      // Handle tool calls for assistant messages
      if (msg.tool_calls) {
        messageData.tool_calls = msg.tool_calls;
      }

      // Handle tool result messages
      if (msg.role === "tool") {
        messageData.tool_name = msg.name;
        messageData.tool_call_id = msg.tool_call_id;
        // Store preview of tool result (first 500 chars)
        const resultStr = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
        messageData.tool_result_preview = resultStr.substring(0, 500);
      }

      return db.AiMessage.create(messageData);
    });

    await Promise.all(messagePromises);

    // Save usage records to AiUsage table
    const usagePromises = (orchestration.usageRecords || []).map((usage) => db.AiUsage.create({
      conversation_id: conversation.id,
      team_id: teamId,
      model: usage.model,
      prompt_tokens: usage.prompt_tokens,
      completion_tokens: usage.completion_tokens,
      total_tokens: usage.total_tokens,
      elapsed_ms: usage.elapsed_ms,
      cost_micros: 0, // TODO: Calculate cost based on model pricing
    }));

    await Promise.all(usagePromises);

    // Update conversation metadata
    const updateData = {
      message_count: orchestration.conversationHistory.filter((msg) => msg.role === "user").length,
      status: "active",
      error_message: null,
      // A conversation receiving a new turn is active again by definition —
      // otherwise it would stay hidden in the Archived tab while being chatted
      // to. Unlike the archive/unarchive writes, this update is intentionally
      // NOT silent: real activity should bump updatedAt.
      archived: false,
      archived_at: null,
    };

    await conversation.update(updateData);

    // Authoritative completion signal. The answer is already persisted above, so
    // emit to the user's room — this lets the client finalize the turn even if
    // the long-lived orchestrate HTTP response is lost (proxy/idle timeout),
    // which was the cause of the chat getting stuck on "computing".
    socketManager.emitToUser(userId, "ai-orchestration-complete", {
      conversationId: conversation.id,
      turnId: clientTurnId,
    });

    // Generate title asynchronously for new conversations (don't block the response)
    if (isNewConversation) {
      generateConversationTitle(question, finalMessage)
        .then(async (title) => {
          if (title) {
            await conversation.update({ title });
            // Notify the client so the sidebar updates in real-time
            socketManager.emitToUser(userId, "conversation-updated", {
              conversationId: conversation.id,
              title,
            });
          }
        })
        .catch(() => {}); // swallow — title is best-effort
    }

    return {
      ...orchestration,
      message: finalMessage,
      aiConversationId: conversation.id,
    };
  } catch (error) {
    // Update conversation status on error
    await conversation.update({
      status: "error",
      error_message: error.message,
    });

    // Emit error event via socket
    if (conversation?.id) {
      socketManager.emitProgress(conversation.id, "error", {
        message: "An error occurred during AI orchestration",
        error: error.message
      });
      // Also signal completion-with-error on the user's room so a client whose
      // HTTP connection was lost still stops spinning instead of hanging.
      socketManager.emitToUser(userId, "ai-orchestration-complete", {
        conversationId: conversation.id,
        turnId: clientTurnId,
        error: true,
        errorMessage: error.message,
      });
    }

    throw error;
  }
}

async function getAvailableTools() {
  const tools = await availableTools();
  return tools;
}

/**
 * List a user's conversations for one team.
 *
 * `statuses` is a set drawn from ("active", "archived") — the client's filter
 * dropdown lets both be selected at once, which yields one merged list. An empty
 * or unrecognised set falls back to "active". `starred` narrows to starred only.
 *
 * Costs a flat 3 queries: the page, one count row carrying all three filter
 * totals, and one grouped token aggregation over the page's ids.
 */
async function getConversations(teamId, userId, options = {}) {
  const {
    limit = DEFAULT_CONVERSATION_PAGE_SIZE, offset = 0, search = "",
    statuses, starred = false,
  } = options;

  const safeLimit = Math.min(
    Math.max(parseInt(limit, 10) || DEFAULT_CONVERSATION_PAGE_SIZE, 1),
    MAX_CONVERSATION_PAGE_SIZE,
  );
  const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);
  const trimmedSearch = typeof search === "string" ? search.trim() : "";
  const starredOnly = !!starred;

  const requested = Array.isArray(statuses) ? statuses : [];
  const wantsActive = requested.includes("active");
  const wantsArchived = requested.includes("archived");
  // Neither recognised (or nothing sent) means the default view: active only.
  const archivedValues = (!wantsActive && !wantsArchived)
    ? [false]
    : [...(wantsActive ? [false] : []), ...(wantsArchived ? [true] : [])];

  // Ownership + optional title search. The status/starred filters are applied
  // only to the page query, so this same WHERE feeds the filter counts below.
  const baseWhere = { team_id: teamId, user_id: userId };
  if (trimmedSearch) {
    baseWhere.title = { [Op.iLike]: `%${escapeLikePattern(trimmedSearch)}%` };
  }

  const pageWhere = { ...baseWhere, archived: { [Op.in]: archivedValues } };
  if (starredOnly) pageWhere.starred = true;

  const conversations = await db.AiConversation.findAll({
    where: pageWhere,
    // Starred pins to the top; id is a tie-breaker so "Load more" can't
    // duplicate or skip rows when several conversations share an updatedAt.
    order: [["starred", "DESC"], ["updatedAt", "DESC"], ["id", "DESC"]],
    limit: safeLimit,
    offset: safeOffset,
    attributes: [
      "id", "title", "status", "message_count", "createdAt", "updatedAt",
      "source", "archived", "archived_at", "starred",
    ],
    // NOTE: a previous `include: [{ model: db.AiUsage, attributes: [] }]` was
    // removed here — it contributed nothing and its JOIN could multiply rows,
    // which would silently break LIMIT/OFFSET.
  });

  // One row carrying every count the filter dropdown needs. Conditional
  // aggregates rather than GROUP BY, because `starred` cuts across `archived`
  // and a grouped query would need a second round-trip for it.
  const [counts] = await db.AiConversation.findAll({
    where: baseWhere,
    attributes: [
      [fn("COUNT", literal("CASE WHEN archived = false THEN 1 END")), "activeCount"],
      [fn("COUNT", literal("CASE WHEN archived = true THEN 1 END")), "archivedCount"],
      [fn("COUNT", literal("CASE WHEN starred = true THEN 1 END")), "starredCount"],
      // Split by status too, so the filtered total stays exact when "Starred
      // only" is combined with a status selection — without a 4th query.
      [fn("COUNT", literal("CASE WHEN starred = true AND archived = false THEN 1 END")), "starredActiveCount"],
      [fn("COUNT", literal("CASE WHEN starred = true AND archived = true THEN 1 END")), "starredArchivedCount"],
    ],
    raw: true,
  });

  const readCount = (key) => parseInt(counts?.[key], 10) || 0;
  const activeCount = readCount("activeCount");
  const archivedCount = readCount("archivedCount");
  const starredCount = readCount("starredCount");

  // Batched token aggregation — replaces a one-query-per-row N+1.
  const ids = conversations.map((conv) => conv.id);
  const usageByConversation = new Map();
  if (ids.length > 0) {
    const usageRows = await db.AiUsage.findAll({
      where: { conversation_id: { [Op.in]: ids } },
      attributes: [
        "conversation_id",
        [fn("SUM", col("total_tokens")), "total_tokens"],
        [fn("SUM", col("prompt_tokens")), "prompt_tokens"],
        [fn("SUM", col("completion_tokens")), "completion_tokens"],
      ],
      group: ["conversation_id"],
      raw: true,
    });
    usageRows.forEach((row) => usageByConversation.set(row.conversation_id, row));
  }

  const items = conversations.map((conv) => {
    const stats = usageByConversation.get(conv.id) || {};

    return {
      id: conv.id,
      title: conv.title,
      source: conv.source,
      status: conv.status,
      archived: conv.archived,
      archived_at: conv.archived_at,
      starred: conv.starred,
      message_count: conv.message_count,
      total_tokens: parseInt(stats.total_tokens, 10) || 0,
      prompt_tokens: parseInt(stats.prompt_tokens, 10) || 0,
      completion_tokens: parseInt(stats.completion_tokens, 10) || 0,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
    };
  });

  const includesActive = archivedValues.includes(false);
  const includesArchived = archivedValues.includes(true);
  const total = starredOnly
    ? (includesActive ? readCount("starredActiveCount") : 0)
      + (includesArchived ? readCount("starredArchivedCount") : 0)
    : (includesActive ? activeCount : 0) + (includesArchived ? archivedCount : 0);

  return {
    conversations: items,
    total,
    activeCount,
    archivedCount,
    starredCount,
    limit: safeLimit,
    offset: safeOffset,
    hasMore: safeOffset + items.length < total,
    // Echoed back so a debounced client can discard out-of-order responses.
    statuses: [...(includesActive ? ["active"] : []), ...(includesArchived ? ["archived"] : [])],
    starred: starredOnly,
    search: trimmedSearch,
  };
}

async function getConversation(conversationId, teamId) {
  const conversation = await db.AiConversation.findOne({
    where: {
      id: conversationId,
      team_id: teamId,
    },
  });

  if (!conversation) {
    throw new Error("Conversation not found");
  }

  // Load messages from AiMessage table
  const messages = await db.AiMessage.findAll({
    where: { conversation_id: conversationId },
    order: [["sequence", "ASC"]],
  });

  // Rebuild full_history for backward compatibility with client
  const fullHistory = messages.map((msg) => {
    const messageObj = {
      id: msg.id,
      role: msg.role,
      content: msg.content,
      feedback: msg.feedback || null,
    };

    // Add tool-specific fields
    if (msg.tool_calls) {
      messageObj.tool_calls = msg.tool_calls;
    }
    if (msg.tool_name) {
      messageObj.name = msg.tool_name;
    }
    if (msg.tool_call_id) {
      messageObj.tool_call_id = msg.tool_call_id;
    }

    return messageObj;
  });

  // Compute token usage stats
  const usageStats = await db.AiUsage.findAll({
    where: { conversation_id: conversationId },
    attributes: [
      [fn("SUM", col("total_tokens")), "total_tokens"],
      [fn("SUM", col("prompt_tokens")), "prompt_tokens"],
      [fn("SUM", col("completion_tokens")), "completion_tokens"],
    ],
    raw: true,
  });

  const stats = usageStats[0] || {};

  // Return conversation with messages and usage stats
  return {
    ...conversation.toJSON(),
    full_history: fullHistory,
    total_tokens: parseInt(stats.total_tokens, 10) || 0,
    prompt_tokens: parseInt(stats.prompt_tokens, 10) || 0,
    completion_tokens: parseInt(stats.completion_tokens, 10) || 0,
  };
}

/**
 * Hard-delete the rows making up one or more conversations.
 *
 * AiUsage rows are deliberately PRESERVED for billing/audit with
 * conversation_id nulled — aiusage.js documents that nullable FK, and team_id
 * keeps the usage attributable.
 *
 * Statement ORDER IS LOAD-BEARING. Both child FKs are ON DELETE NO ACTION
 * (verified against the database: the `onDelete` in the create-migrations is
 * nested inside `references`, where Sequelize v6 ignores it), so nothing
 * cascades: the AiMessage rows must be destroyed explicitly, and
 * AiUsage.conversation_id must be nulled before the parent row can go or the
 * delete throws a foreign key violation. That is also why callers run this in a
 * transaction — a partial failure would otherwise leave orphaned messages or a
 * message-less shell conversation.
 *
 * Callers MUST have already verified ownership of every id passed in.
 */
async function purgeConversations(conversationIds, transaction) {
  if (!conversationIds || conversationIds.length === 0) return 0;

  await db.AiMessage.destroy({
    where: { conversation_id: { [Op.in]: conversationIds } },
    transaction,
  });

  await db.AiUsage.update(
    { conversation_id: null },
    { where: { conversation_id: { [Op.in]: conversationIds } }, transaction },
  );

  return db.AiConversation.destroy({
    where: { id: { [Op.in]: conversationIds } },
    transaction,
  });
}

async function deleteConversation(conversationId, teamId, userId) {
  if (!UUID_RE.test(String(conversationId || ""))) {
    throw new Error("Conversation not found");
  }

  const where = { id: conversationId, team_id: teamId };
  // Scoped by owner so one team admin cannot hard-delete another member's
  // conversation by id. Optional so the signature stays backwards compatible.
  if (userId) where.user_id = userId;

  const conversation = await db.AiConversation.findOne({ where });

  if (!conversation) {
    throw new Error("Conversation not found");
  }

  await db.sequelize.transaction(
    (transaction) => purgeConversations([conversation.id], transaction),
  );

  return { success: true };
}

/**
 * Archive or unarchive one conversation.
 *
 * The write is { silent: true } so updatedAt keeps meaning "last conversation
 * activity". Without that, unarchiving an old conversation would jump it to the
 * top of the list, since both tabs sort by updatedAt DESC; archived_at carries
 * the archive timestamp instead.
 */
async function setConversationArchived(conversationId, teamId, userId, archived) {
  if (!UUID_RE.test(String(conversationId || ""))) {
    throw new Error("Conversation not found");
  }

  const where = { id: conversationId, team_id: teamId };
  if (userId) where.user_id = userId;

  const conversation = await db.AiConversation.findOne({ where });

  if (!conversation) {
    throw new Error("Conversation not found");
  }

  await conversation.update(
    {
      archived: !!archived,
      archived_at: archived ? new Date() : null,
    },
    { silent: true },
  );

  return { success: true, id: conversation.id, archived: !!archived };
}

/**
 * Star or unstar one conversation.
 *
 * Silent for the same reason as archiving: starring must pin the row via the
 * `starred DESC` sort, not by pretending the conversation was just used.
 */
async function setConversationStarred(conversationId, teamId, userId, starred) {
  if (!UUID_RE.test(String(conversationId || ""))) {
    throw new Error("Conversation not found");
  }

  const where = { id: conversationId, team_id: teamId };
  if (userId) where.user_id = userId;

  const conversation = await db.AiConversation.findOne({ where });

  if (!conversation) {
    throw new Error("Conversation not found");
  }

  await conversation.update({ starred: !!starred }, { silent: true });

  return { success: true, id: conversation.id, starred: !!starred };
}

/**
 * Archive / unarchive / delete up to MAX_BULK_CONVERSATIONS conversations.
 *
 * Ids are resolved to owned rows FIRST; anything not owned by the caller (or
 * malformed, or already gone) is never touched and comes back in `skipped`.
 */
async function bulkUpdateConversations(teamId, userId, action, ids) {
  if (!BULK_ACTIONS.includes(action)) {
    throw new Error(`action must be one of: ${BULK_ACTIONS.join(", ")}`);
  }
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new Error("ids must be a non-empty array");
  }
  if (ids.length > MAX_BULK_CONVERSATIONS) {
    throw new Error(`Cannot process more than ${MAX_BULK_CONVERSATIONS} conversations at once`);
  }

  // De-dupe, and drop malformed ids before they reach Postgres — one bad UUID
  // would abort the whole statement with a cast error.
  const requestedIds = [...new Set(ids.map((id) => String(id)))];
  const candidateIds = requestedIds.filter((id) => UUID_RE.test(id));

  const owned = candidateIds.length > 0
    ? await db.AiConversation.findAll({
      where: { id: { [Op.in]: candidateIds }, team_id: teamId, user_id: userId },
      attributes: ["id"],
    })
    : [];

  const ownedIds = owned.map((conv) => conv.id);
  const ownedSet = new Set(ownedIds);
  const skipped = requestedIds.filter((id) => !ownedSet.has(id));

  let affected = 0;

  if (ownedIds.length > 0) {
    if (action === "delete") {
      affected = await db.sequelize.transaction(
        (transaction) => purgeConversations(ownedIds, transaction),
      );
    } else {
      const archived = action === "archive";
      // A single UPDATE is already atomic, so no transaction needed here.
      const [count] = await db.AiConversation.update(
        { archived, archived_at: archived ? new Date() : null },
        { where: { id: { [Op.in]: ownedIds } }, silent: true },
      );
      affected = count;
    }
  }

  return {
    success: true, action, requested: requestedIds.length, affected, skipped,
  };
}

async function getAiUsage(teamId, startDate, endDate) {
  try {
    const whereClause = { team_id: parseInt(teamId, 10) };

    // Add date filtering if provided
    if (startDate || endDate) {
      whereClause.createdAt = {};
      if (startDate) whereClause.createdAt[Op.gte] = new Date(startDate);
      if (endDate) whereClause.createdAt[Op.lte] = new Date(endDate);
    }

    // Get total usage
    const totalUsage = await db.AiUsage.findAll({
      where: whereClause,
      attributes: [
        [fn("SUM", col("total_tokens")), "total_tokens"],
        [fn("SUM", col("prompt_tokens")), "prompt_tokens"],
        [fn("SUM", col("completion_tokens")), "completion_tokens"],
        [fn("SUM", col("cost_micros")), "total_cost_micros"],
        [fn("COUNT", col("id")), "api_calls"],
      ],
      raw: true,
    });

    const formattedTotalUsage = {
      total_tokens: parseInt(totalUsage[0]?.total_tokens, 10) || 0,
      prompt_tokens: parseInt(totalUsage[0]?.prompt_tokens, 10) || 0,
      completion_tokens: parseInt(totalUsage[0]?.completion_tokens, 10) || 0,
      total_cost_micros: parseInt(totalUsage[0]?.total_cost_micros, 10) || 0,
      api_calls: parseInt(totalUsage[0]?.api_calls, 10) || 0,
    };

    // Get usage by model
    const usageByModel = await db.AiUsage.findAll({
      where: whereClause,
      attributes: [
        "model",
        [fn("SUM", col("total_tokens")), "total_tokens"],
        [fn("COUNT", col("id")), "api_calls"],
      ],
      group: ["model"],
      raw: true,
    });

    const formattedUsageByModel = usageByModel.map((model) => {
      return {
        model: model.model,
        total_tokens: parseInt(model.total_tokens, 10) || 0,
        api_calls: parseInt(model.api_calls, 10) || 0,
      };
    });

    return {
      total: formattedTotalUsage,
      byModel: formattedUsageByModel,
    };
  } catch (error) {
    throw new Error(error.message);
  }
}

async function renameConversation(conversationId, teamId, title, userId) {
  const where = { id: conversationId, team_id: teamId };
  // The list only ever shows conversations you own, so the client can never
  // legitimately rename someone else's.
  if (userId) where.user_id = userId;

  const conversation = await db.AiConversation.findOne({ where });

  if (!conversation) {
    throw new Error("Conversation not found");
  }

  await conversation.update({ title });

  return { success: true, title };
}

async function submitMessageFeedback(conversationId, messageId, teamId, feedback) {
  const conversation = await db.AiConversation.findOne({
    where: { id: conversationId, team_id: teamId },
  });

  if (!conversation) {
    throw new Error("Conversation not found");
  }

  const message = await db.AiMessage.findOne({
    where: { id: messageId, conversation_id: conversationId },
  });

  if (!message) {
    throw new Error("Message not found");
  }

  if (feedback !== "positive" && feedback !== "negative" && feedback !== null) {
    throw new Error("Invalid feedback value");
  }

  await message.update({ feedback });

  return { success: true, feedback };
}

async function forkConversation(conversationId, teamId, userId, targetUserId) {
  const source = await db.AiConversation.findOne({
    where: { id: conversationId, team_id: teamId },
  });

  if (!source) {
    throw new Error("Conversation not found");
  }

  const ownerUserId = targetUserId || userId;
  const isShare = !!targetUserId && targetUserId !== userId;

  // Create the forked conversation
  const forked = await db.AiConversation.create({
    team_id: teamId,
    user_id: ownerUserId,
    title: isShare ? `${source.title} (shared)` : `${source.title} (fork)`,
    source: "app",
    status: "active",
    message_count: source.message_count,
  });

  // Copy all messages
  const messages = await db.AiMessage.findAll({
    where: { conversation_id: conversationId },
    order: [["sequence", "ASC"]],
  });

  if (messages.length > 0) {
    const messageCopies = messages.map((msg) => ({
      conversation_id: forked.id,
      role: msg.role,
      content: msg.content,
      tool_calls: msg.getDataValue("tool_calls"),
      tool_name: msg.tool_name,
      tool_call_id: msg.tool_call_id,
      tool_result_preview: msg.tool_result_preview,
      sequence: msg.sequence,
      // feedback is intentionally not copied — it belongs to the original user
    }));

    await db.AiMessage.bulkCreate(messageCopies);
  }

  return {
    id: forked.id,
    title: forked.title,
    shared_to: isShare ? ownerUserId : null,
  };
}

module.exports = {
  getOrchestration,
  getAvailableTools,
  getConversations,
  getConversation,
  deleteConversation,
  renameConversation,
  setConversationArchived,
  setConversationStarred,
  bulkUpdateConversations,
  getAiUsage,
  submitMessageFeedback,
  forkConversation,
};
