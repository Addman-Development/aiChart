import {
  describe, it, expect, beforeEach, afterAll, vi,
} from "vitest";
import request from "supertest";
import express from "express";
import { json } from "body-parser";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

// Inject fakes for the route's collaborators via require.cache (vi.mock doesn't
// intercept this CJS require chain). verifyToken is stubbed to a logged-in user,
// and the Keycloak token store is controllable per-test. Originals are restored
// in afterAll so we don't leak into other files (the suite runs single-fork).
const getFreshAccessToken = vi.fn();
const uploadFeedbackScreenshots = vi.fn();

const verifyTokenPath = require.resolve("../../modules/verifyToken.js");
const tokenStorePath = require.resolve("../../modules/keycloakTokenStore.js");
const azureBlobPath = require.resolve("../../modules/azureBlob.js");
const originalVerifyToken = require.cache[verifyTokenPath];
const originalTokenStore = require.cache[tokenStorePath];
const originalAzureBlob = require.cache[azureBlobPath];

require.cache[verifyTokenPath] = {
  id: verifyTokenPath,
  filename: verifyTokenPath,
  loaded: true,
  exports: (req, res, next) => { req.user = { id: 7 }; next(); },
};
require.cache[tokenStorePath] = {
  id: tokenStorePath,
  filename: tokenStorePath,
  loaded: true,
  exports: { getFreshAccessToken, cacheTokens: vi.fn() },
};
require.cache[azureBlobPath] = {
  id: azureBlobPath,
  filename: azureBlobPath,
  loaded: true,
  exports: { isConfigured: () => true, uploadFeedbackScreenshots },
};

const feedbackRoute = require("../../api/FeedbackRoute.js");

const buildApp = () => {
  const app = express();
  app.use(json());
  feedbackRoute(app);
  return app;
};

describe("Feedback API", () => {
  let app;

  beforeEach(() => {
    getFreshAccessToken.mockReset();
    uploadFeedbackScreenshots.mockReset();
    vi.unstubAllGlobals();
    app = buildApp();
  });

  afterAll(() => {
    if (originalVerifyToken) require.cache[verifyTokenPath] = originalVerifyToken;
    else delete require.cache[verifyTokenPath];
    if (originalTokenStore) require.cache[tokenStorePath] = originalTokenStore;
    else delete require.cache[tokenStorePath];
    if (originalAzureBlob) require.cache[azureBlobPath] = originalAzureBlob;
    else delete require.cache[azureBlobPath];
  });

  it("rejects an invalid category with 400", async () => {
    const res = await request(app)
      .post("/api/feedback")
      .send({ category: "spam", message: "hello" })
      .expect(400);

    expect(res.body.error).toMatch(/category/);
    expect(getFreshAccessToken).not.toHaveBeenCalled();
  });

  it("rejects a missing message with 400", async () => {
    const res = await request(app)
      .post("/api/feedback")
      .send({ category: "bug" })
      .expect(400);

    expect(res.body.error).toMatch(/message/);
  });

  it("rejects an over-length message with 400", async () => {
    await request(app)
      .post("/api/feedback")
      .send({ category: "bug", message: "x".repeat(4001) })
      .expect(400);
  });

  it("returns 401 with reauthRequired when no Keycloak token is available", async () => {
    getFreshAccessToken.mockResolvedValue(null);

    const res = await request(app)
      .post("/api/feedback")
      .send({ category: "idea", message: "make it faster" })
      .expect(401);

    expect(getFreshAccessToken).toHaveBeenCalledWith(7);
    expect(res.body.reauthRequired).toBe(true);
  });

  it("returns 401 with reauthRequired when the platform rejects the token", async () => {
    getFreshAccessToken.mockResolvedValue("stale-token");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      status: 401,
      text: async () => JSON.stringify({ error: "token expired" }),
    })));

    const res = await request(app)
      .post("/api/feedback")
      .send({ category: "bug", message: "broken" })
      .expect(401);

    expect(res.body.reauthRequired).toBe(true);
  });

  it("forwards to the platform with a fresh Keycloak token and relays the response", async () => {
    getFreshAccessToken.mockResolvedValue("kc-access-token");
    const fetchMock = vi.fn(async () => ({
      status: 201,
      text: async () => JSON.stringify({ id: "fb_123" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app)
      .post("/api/feedback")
      .send({
        category: "bug", message: "  something broke  ", pageUrl: "https://app/x", module: "charts",
      })
      .expect(201);

    expect(res.body).toEqual({ id: "fb_123" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/feedback");
    expect(options.method).toBe("POST");
    expect(options.headers.Authorization).toBe("Bearer kc-access-token");

    const forwarded = JSON.parse(options.body);
    expect(forwarded).toMatchObject({
      category: "bug",
      message: "something broke", // trimmed
      pageUrl: "https://app/x",
      module: "charts",
    });
  });

  it("uploads attached screenshots and references their URLs in the entry", async () => {
    getFreshAccessToken.mockResolvedValue("kc-access-token");
    uploadFeedbackScreenshots.mockResolvedValue([
      "https://blob/feedback/a.png?sas",
      "https://blob/feedback/b.png?sas",
    ]);
    const fetchMock = vi.fn(async () => ({
      status: 201,
      text: async () => JSON.stringify({ id: "fb_456" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app)
      .post("/api/feedback")
      .field("category", "bug")
      .field("message", "see attached")
      .field("pageUrl", "https://app/x")
      .attach("screenshots", Buffer.from("fake-png-1"), { filename: "one.png", contentType: "image/png" })
      .attach("screenshots", Buffer.from("fake-png-2"), { filename: "two.png", contentType: "image/png" })
      .expect(201);

    expect(res.body).toEqual({ id: "fb_456" });

    // Both files reached the uploader.
    expect(uploadFeedbackScreenshots).toHaveBeenCalledTimes(1);
    expect(uploadFeedbackScreenshots.mock.calls[0][0]).toHaveLength(2);

    const forwarded = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(forwarded.screenshots).toEqual([
      "https://blob/feedback/a.png?sas",
      "https://blob/feedback/b.png?sas",
    ]);
  });

  it("rejects a non-image attachment with 400", async () => {
    getFreshAccessToken.mockResolvedValue("kc-access-token");

    await request(app)
      .post("/api/feedback")
      .field("category", "bug")
      .field("message", "bad file")
      .attach("screenshots", Buffer.from("not-an-image"), { filename: "evil.txt", contentType: "text/plain" })
      .expect(400);

    expect(uploadFeedbackScreenshots).not.toHaveBeenCalled();
  });

  it("forwards an empty screenshots array for JSON (no attachment) requests", async () => {
    getFreshAccessToken.mockResolvedValue("kc-access-token");
    const fetchMock = vi.fn(async () => ({
      status: 201,
      text: async () => JSON.stringify({ id: "fb_789" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await request(app)
      .post("/api/feedback")
      .send({ category: "idea", message: "no images here" })
      .expect(201);

    expect(uploadFeedbackScreenshots).not.toHaveBeenCalled();
    const forwarded = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(forwarded.screenshots).toEqual([]);
  });

  it("relays a platform error status", async () => {
    getFreshAccessToken.mockResolvedValue("kc-access-token");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      status: 502,
      text: async () => JSON.stringify({ error: "upstream down" }),
    })));

    const res = await request(app)
      .post("/api/feedback")
      .send({ category: "other", message: "hi" })
      .expect(502);

    expect(res.body).toEqual({ error: "upstream down" });
  });
});
