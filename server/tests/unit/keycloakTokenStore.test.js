import {
  describe, it, expect, beforeEach, afterAll, vi,
} from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

// This module under test is CommonJS and pulls its collaborators in via require().
// vitest's vi.mock only reliably intercepts bare specifiers in this CJS chain, so
// instead we inject fakes through Node's own require.cache before requiring it.
const map = new Map();
const cacheClient = {
  map,
  get: vi.fn(async (key) => (map.has(key) ? map.get(key) : null)),
  set: vi.fn(async (key, value) => { map.set(key, value); return "OK"; }),
  del: vi.fn(async (key) => { map.delete(key); return 1; }),
};
let cacheClientToReturn = cacheClient;
const refreshMock = vi.fn();

const redisCachePath = require.resolve("../../modules/redisCache.js");
const connectorPath = require.resolve("../../modules/keycloakConnector.js");
const originalRedisCache = require.cache[redisCachePath];
const originalConnector = require.cache[connectorPath];

require.cache[redisCachePath] = {
  id: redisCachePath,
  filename: redisCachePath,
  loaded: true,
  exports: { getCacheClient: () => cacheClientToReturn },
};

require.cache[connectorPath] = {
  id: connectorPath,
  filename: connectorPath,
  loaded: true,
  exports: { refresh: refreshMock },
};

// Required after the fakes are seeded so its internal require() picks them up.
const { cacheTokens, getFreshAccessToken } = require("../../modules/keycloakTokenStore.js");

const KEY = "kc:token:42";
const nowSec = () => Math.floor(Date.now() / 1000);

describe("keycloakTokenStore", () => {
  beforeEach(() => {
    map.clear();
    cacheClient.get.mockClear();
    cacheClient.set.mockClear();
    cacheClient.del.mockClear();
    refreshMock.mockReset();
    cacheClientToReturn = cacheClient;
  });

  afterAll(() => {
    if (originalRedisCache) require.cache[redisCachePath] = originalRedisCache;
    else delete require.cache[redisCachePath];
    if (originalConnector) require.cache[connectorPath] = originalConnector;
    else delete require.cache[connectorPath];
  });

  it("cacheTokens stores the token set with a 1h TTL", async () => {
    await cacheTokens(42, { accessToken: "at", refreshToken: "rt", expiresAt: nowSec() + 300 });

    expect(cacheClient.set).toHaveBeenCalledTimes(1);
    const [key, value, exFlag, ttl] = cacheClient.set.mock.calls[0];
    expect(key).toBe(KEY);
    expect(exFlag).toBe("EX");
    expect(ttl).toBe(3600);
    expect(JSON.parse(value)).toMatchObject({ accessToken: "at", refreshToken: "rt" });
  });

  it("cacheTokens is a no-op when there's no access token", async () => {
    await cacheTokens(42, { refreshToken: "rt" });
    expect(cacheClient.set).not.toHaveBeenCalled();
  });

  it("returns the cached token without refreshing when it is still valid", async () => {
    map.set(KEY, JSON.stringify({
      accessToken: "valid-token", refreshToken: "rt", expiresAt: nowSec() + 300,
    }));

    const token = await getFreshAccessToken(42);

    expect(token).toBe("valid-token");
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("refreshes and re-caches when the token is expired", async () => {
    map.set(KEY, JSON.stringify({
      accessToken: "old-token", refreshToken: "rt-old", expiresAt: nowSec() - 10,
    }));
    refreshMock.mockResolvedValue({ accessToken: "new-token", refreshToken: "rt-new", expiresAt: nowSec() + 300 });

    const token = await getFreshAccessToken(42);

    expect(refreshMock).toHaveBeenCalledWith("rt-old");
    expect(token).toBe("new-token");
    expect(JSON.parse(map.get(KEY))).toMatchObject({ accessToken: "new-token", refreshToken: "rt-new" });
  });

  it("refreshes when the token is within the expiry skew window", async () => {
    map.set(KEY, JSON.stringify({
      accessToken: "old-token", refreshToken: "rt", expiresAt: nowSec() + 10, // < 30s skew
    }));
    refreshMock.mockResolvedValue({ accessToken: "fresh", refreshToken: "rt", expiresAt: nowSec() + 300 });

    const token = await getFreshAccessToken(42);
    expect(token).toBe("fresh");
    expect(refreshMock).toHaveBeenCalledOnce();
  });

  it("returns null when there is no cache entry", async () => {
    const token = await getFreshAccessToken(42);
    expect(token).toBeNull();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("returns null and evicts the entry when refresh fails", async () => {
    map.set(KEY, JSON.stringify({
      accessToken: "old-token", refreshToken: "dead-rt", expiresAt: nowSec() - 10,
    }));
    refreshMock.mockRejectedValue(new Error("invalid_grant"));

    const token = await getFreshAccessToken(42);

    expect(token).toBeNull();
    expect(cacheClient.del).toHaveBeenCalledWith(KEY);
  });

  it("returns null when Redis is not configured", async () => {
    cacheClientToReturn = null;
    const token = await getFreshAccessToken(42);
    expect(token).toBeNull();
  });
});
