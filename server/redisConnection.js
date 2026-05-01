const logger = require("./modules/logger").child({ module: "redisConnection" });

const getRedisOptions = () => {
  if (!process.env.CB_REDIS_HOST) {
    logger.error("CB_REDIS_HOST is not set. The charts are not going to update automatically.");
  }
  return {
    host: process.env.CB_REDIS_HOST,
    port: process.env.CB_REDIS_PORT,
    password: process.env.CB_REDIS_PASSWORD,
    db: process.env.CB_REDIS_DB,
    tls: process.env.CB_REDIS_CA ? { ca: process.env.CB_REDIS_CA } : undefined,
  };
};

const getRedisClusterOptions = () => {
  const clusterNodes = process.env.CB_REDIS_CLUSTER_NODES;

  if (clusterNodes) {
    const nodes = clusterNodes.split(",").map((node) => {
      const [host, port] = node.trim().split(":");
      return { host, port: parseInt(port, 10) || 6379 };
    });

    const clusterOptions = {
      enableReadyCheck: false,
      redisOptions: {
        password: process.env.CB_REDIS_PASSWORD,
      }
    };

    // Add TLS configuration if provided
    const tlsCa = process.env.CB_REDIS_CA;

    if (tlsCa) {
      clusterOptions.redisOptions.tls = { ca: tlsCa };
    }

    return { cluster: { nodes, options: clusterOptions } };
  }

  return null;
};

const getQueueOptions = () => {
  // Check if cluster configuration is available
  const clusterConfig = getRedisClusterOptions();

  return {
    connection: clusterConfig || getRedisOptions(),
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "fixed",
        delay: 5000
      },
      removeOnComplete: true,
      removeOnFail: true,
    },
    settings: {
      stalledInterval: 30000,
      maxStalledCount: 3,
    }
  };
};

module.exports = {
  getRedisOptions,
  getRedisClusterOptions,
  getQueueOptions,
};
