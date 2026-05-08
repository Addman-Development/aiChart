const { Queue, Worker } = require("bullmq");
const { createBullBoard } = require("@bull-board/api");
const { BullMQAdapter } = require("@bull-board/api/bullMQAdapter");
const { ExpressAdapter } = require("@bull-board/express");

const { getQueueOptions } = require("./redisConnection");
const updateCharts = require("./crons/updateCharts");
const updateDashboards = require("./crons/updateDashboards");
const sendSnapshots = require("./crons/sendSnapshots");
const logger = require("./modules/logger").child({ module: "setUpQueues" });
// const updateSnapshots = require("./crons/updateSnapshots");

async function cleanActiveJobs(queue) {
  try {
    const activeJobs = await queue.getJobs(["active"]);

    const jobPromises = activeJobs.map(async (job) => {
      await job.moveToFailed({ message: "Job manually failed due to server restart" });
      await job.remove();
    });

    await Promise.all(jobPromises);

    logger.info({ count: activeJobs.length, queue: queue.name }, "Cleaned active jobs");
  } catch (err) {
    logger.error({ err, queue: queue.name }, "Failed to clean active jobs");
  }
}

let updateChartsQueue;
let updateDashboardsQueue;
let updateMongoDBSchemaQueue;

const setUpQueues = (app) => {
  // set up bullmq queues

  /*
  ** Update Charts Queue
  */
  updateChartsQueue = new Queue("updateChartsQueue", getQueueOptions());
  updateChartsQueue.on("error", (error) => {
    if (error.code === "ECONNREFUSED") {
      logger.error({ err: error, queue: "updateChartsQueue" }, "Failed to set up the updates queue. Check that Redis is running.");
      process.exit(1);
    }
  });

  /*
  ** Update Dashboards Queue
  */
  updateDashboardsQueue = new Queue("updateDashboardsQueue", getQueueOptions());
  updateDashboardsQueue.on("error", (error) => {
    if (error.code === "ECONNREFUSED") {
      logger.error({ err: error, queue: "updateDashboardsQueue" }, "Failed to set up the updates queue. Check that Redis is running.");
      process.exit(1);
    }
  });

  /*
  ** Update MongoDB Schema Queue
  */
  updateMongoDBSchemaQueue = new Queue("updateMongoDBSchemaQueue", getQueueOptions());
  updateMongoDBSchemaQueue.on("error", (error) => {
    if (error.code === "ECONNREFUSED") {
      logger.error({ err: error, queue: "updateMongoDBSchemaQueue" }, "Failed to set up the MongoDB schema update queue. Check that Redis is running.");
      process.exit(1);
    }
  });
  // create a worker for the updateMongoDBSchemaQueue
  const updateMongoDBSchemaWorker = new Worker(updateMongoDBSchemaQueue.name, async (job) => { // eslint-disable-line
    const updateMongoDBSchema = require("./crons/workers/updateMongoSchema"); // eslint-disable-line
    await updateMongoDBSchema(job);
  }, { connection: updateMongoDBSchemaQueue.opts.connection, concurrency: 1 });

  /*
  ** Dashboard Snapshot Queue
  */
  const dashboardSnapshotQueue = new Queue("sendSnapshotsQueue", getQueueOptions());
  dashboardSnapshotQueue.on("error", (error) => {
    if (error.code === "ECONNREFUSED") {
      logger.error({ err: error, queue: "sendSnapshotsQueue" }, "Failed to set up the dashboard snapshot queue. Check that Redis is running.");
      process.exit(1);
    }
  });
  // create a worker for the dashboardSnapshotQueue
  const sendSnapshotWorker = new Worker(dashboardSnapshotQueue.name, async (job) => { // eslint-disable-line
    const sendSnapshot = require("./crons/workers/sendSnapshot"); // eslint-disable-line
    await sendSnapshot(job);
  }, { connection: dashboardSnapshotQueue.opts.connection, concurrency: 1 });

  /*
  ** Update Snapshots Queue
  */
  const updateSnapshotsQueue = new Queue("updateSnapshotsQueue", getQueueOptions());
  updateSnapshotsQueue.on("error", (error) => {
    if (error.code === "ECONNREFUSED") {
      logger.error({ err: error, queue: "updateSnapshotsQueue" }, "Failed to set up the update snapshots queue. Check that Redis is running.");
      process.exit(1);
    }
  });
  // create a worker for the updateSnapshotsQueue
  const takeSnapshotWorker = new Worker(updateSnapshotsQueue.name, async (job) => { // eslint-disable-line
    const takeSnapshot = require("./crons/workers/takeSnapshot"); // eslint-disable-line
    await takeSnapshot(job);
  }, { connection: updateSnapshotsQueue.opts.connection, concurrency: 10 });

  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath("/apps/queues");

  createBullBoard({
    queues: [
      new BullMQAdapter(updateChartsQueue),
      new BullMQAdapter(updateDashboardsQueue),
      new BullMQAdapter(updateMongoDBSchemaQueue),
      new BullMQAdapter(dashboardSnapshotQueue),
      new BullMQAdapter(updateSnapshotsQueue),
    ],
    serverAdapter,
    options: {
      uiConfig: {
        boardTitle: "ADDMAN-SmartChart Jobs",
      },
    },
  });

  app.use("/apps/queues", (req, res, next) => {
    res.setHeader("Content-Security-Policy", "default-src 'self'; img-src *;"); // Allow images to load from any source
    next();
  }, serverAdapter.getRouter());

  // set up cron jobs
  updateCharts(updateChartsQueue);
  updateDashboards(updateDashboardsQueue);
  sendSnapshots(dashboardSnapshotQueue);

  // Uncomment this to enable regular snapshot updates
  // updateSnapshots(updateSnapshotsQueue, takeSnapshotWorker);

  // Clean BullMQ queues on shutdown. The HTTP graceful-shutdown handler in
  // index.js (SIGTERM/SIGINT) is responsible for the final process.exit —
  // these only handle queue cleanup so they run concurrently with HTTP drain.
  // SIGUSR2 (nodemon reload) still needs an explicit exit since it has no
  // index.js counterpart.
  const cleanAll = async (signal) => {
    logger.info({ signal }, "Signal received. Cleaning active jobs...");
    await cleanActiveJobs(updateChartsQueue);
    await cleanActiveJobs(updateDashboardsQueue);
    await cleanActiveJobs(updateMongoDBSchemaQueue);
  };

  process.on("SIGINT", () => cleanAll("SIGINT"));
  process.on("SIGTERM", () => cleanAll("SIGTERM"));
  process.on("SIGUSR2", async () => {
    await cleanAll("SIGUSR2");
    process.exit(0);
  });
};

module.exports = {
  setUpQueues,
  getQueues: () => ({
    updateChartsQueue,
    updateDashboardsQueue,
    updateMongoDBSchemaQueue,
  }),
};
