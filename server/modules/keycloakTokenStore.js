const { getCacheClient } = require("./redisCache");
const keycloakConnector = require("./keycloakConnector");
const logger = require("./logger").child({ module: "keycloakTokenStore" });

// Caches each user's Keycloak tokens in Redis so we can forward a valid access
// token to the platform without re-running the OIDC flow on every request. The
// cache entry is seeded at login and lives for TTL_SECONDS; on read we refresh
// the access token if it's expired (or about to be), which both renews the
// stored token and resets its TTL.
const KEY_PREFIX = "kc:token:";
const TTL_SECONDS = 60 * 60; // 1 hour
const EXPIRY_SKEW_SECONDS = 30; // refresh slightly early to avoid sending an expired token

const keyFor = (userId) => `${KEY_PREFIX}${userId}`;

// Store a freshly-obtained token set for a user. Safe to await — never throws.
const cacheTokens = async (userId, { accessToken, refreshToken, expiresAt } = {}) => {
  const client = getCacheClient();
  if (!client || !userId || !accessToken) return;

  try {
    const payload = JSON.stringify({ accessToken, refreshToken, expiresAt });
    await client.set(keyFor(userId), payload, "EX", TTL_SECONDS);
  } catch (err) {
    logger.error({ err, userId }, "failed to cache keycloak tokens");
  }
};

// Return a valid Keycloak access token for the user, refreshing if needed.
// Returns null when there's no usable token (no cache entry, Redis down, or the
// refresh token is dead) so callers can respond with a clear auth error.
const getFreshAccessToken = async (userId) => {
  const client = getCacheClient();
  if (!client || !userId) return null;

  let entry;
  try {
    const raw = await client.get(keyFor(userId));
    if (!raw) return null;
    entry = JSON.parse(raw);
  } catch (err) {
    logger.error({ err, userId }, "failed to read keycloak tokens from cache");
    return null;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const stillValid = entry.expiresAt && (entry.expiresAt - EXPIRY_SKEW_SECONDS) > nowSec;
  if (stillValid && entry.accessToken) {
    return entry.accessToken;
  }

  if (!entry.refreshToken) return null;

  try {
    const refreshed = await keycloakConnector.refresh(entry.refreshToken);
    await cacheTokens(userId, refreshed);
    return refreshed.accessToken;
  } catch (err) {
    logger.error({ err, userId }, "failed to refresh keycloak token");
    // Drop the stale entry so we don't keep hammering a dead refresh token.
    try {
      await client.del(keyFor(userId));
    } catch (delErr) {
      logger.error({ err: delErr, userId }, "failed to evict stale keycloak token");
    }
    return null;
  }
};

module.exports = { cacheTokens, getFreshAccessToken };
