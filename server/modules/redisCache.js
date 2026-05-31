const Redis = require("ioredis");

const { getRedisOptions } = require("../redisConnection");
const logger = require("./logger").child({ module: "redisCache" });

// Lazily-created, shared ioredis client for general-purpose caching (separate
// from the BullMQ queue connections and the Socket.IO pub/sub clients). Returns
// null when Redis isn't configured so callers can degrade gracefully.
let client = null;
let warnedDisabled = false;

const getCacheClient = () => {
  if (client) return client;

  const redisConfig = getRedisOptions();
  if (!redisConfig.host) {
    if (!warnedDisabled) {
      logger.warn("Redis not configured (CB_REDIS_HOST missing); cache is disabled");
      warnedDisabled = true;
    }
    return null;
  }

  client = new Redis({
    ...redisConfig,
    maxRetriesPerRequest: 2,
    retryStrategy(times) {
      return Math.min(times * 50, 2000);
    },
  });

  client.on("error", (err) => {
    logger.error({ err }, "Redis cache client error");
  });

  return client;
};

module.exports = { getCacheClient };
