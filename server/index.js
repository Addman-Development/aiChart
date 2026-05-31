// set up the encryption keys first, then load .env file
const setUpEncryptionKeys = require("./modules/setUpEncryptionKeys"); // eslint-disable-line

setUpEncryptionKeys();

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const logger = require("./modules/logger");

// Prevent unhandled promise rejections from crashing the server
process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "unhandledRejection");
});

process.on("uncaughtException", (err) => {
  logger.error({ err }, "uncaughtException");
});

const express = require("express");
const methodOverride = require("method-override");
const { urlencoded, json } = require("body-parser");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const _ = require("lodash");
const pinoHttp = require("pino-http");
const helmet = require("helmet");
const fs = require("fs");
const busboy = require("connect-busboy");

const settings = require("./settings");
const routes = require("./api");
const appsRoutes = require("./apps");

const cleanChartCache = require("./modules/CleanChartCache");
const cleanAuthCache = require("./modules/CleanAuthCache");
const parseQueryParams = require("./middlewares/parseQueryParams");
const db = require("./models/models");
const packageJson = require("./package.json");
const cleanGhostChartsCron = require("./modules/cleanGhostChartsCron");
const { checkEncryptionKeys } = require("./modules/cbCrypto");
const { setUpQueues } = require("./setUpQueues");
const socketManager = require("./modules/socketManager");

// check if the encryption keys are valid 32-byte hex strings
checkEncryptionKeys();

// set up folders
fs.mkdir(".cache", () => { });
fs.mkdir("uploads", () => { });

const app = express();
app.settings = settings;

app.set("trust proxy", 1);

// Strip an optional public-facing API prefix (e.g. "/smart-chart-api") so
// internal routes mounted at "/" still match. No-op when the prefix is unset
// or already stripped upstream by the gateway. req.originalUrl is preserved
// for log correlation.
const apiBasePath = (process.env.CB_API_BASE_PATH || "").replace(/\/$/, "");
if (apiBasePath) {
  app.use((req, res, next) => {
    if (req.url === apiBasePath) {
      req.url = "/";
    } else if (req.url.startsWith(`${apiBasePath}/`)) {
      req.url = req.url.slice(apiBasePath.length);
    }
    next();
  });
}

app.use(pinoHttp({
  logger,
  customLogLevel: (req, res, err) => {
    if (err || res.statusCode >= 500) return "error";
    if (res.statusCode === 401 && /\/user\/relog\b/.test(req.url || "")) return "info";
    if (res.statusCode >= 400) return "warn";
    // Suppress noisy healthcheck logs on success — only log /health when it fails
    if (/^\/health(\?|$)/.test(req.url || "")) return "silent";
    return "info";
  },
  customSuccessMessage: (req, res) => `${req.method} ${req.originalUrl || req.url} ${res.statusCode}`,
  customErrorMessage: (req, res, err) => `${req.method} ${req.originalUrl || req.url} ${res.statusCode} ${err.message}`,
  serializers: {
    req: (req) => ({
      id: req.id,
      method: req.method,
      url: req.originalUrl || req.url,
      remoteAddress: req.remoteAddress,
    }),
    res: (res) => ({
      statusCode: res.statusCode,
    }),
  },
}));
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(urlencoded({
  extended: true,
  verify: (req, res, buf, encoding) => {
    const url = req.originalUrl;
    // Save raw body for Slack signature verification (URL-encoded requests)
    if (req.headers["content-type"]?.includes("application/x-www-form-urlencoded") && url.includes("/apps/slack/")) {
      req.rawBody = buf.toString(encoding || "utf8");
    }
  },
}));
app.set("query parser", "simple");
app.use(json({
  limit: "5mb",
  verify: (req, res, buf, encoding) => {
    // Save raw body for Slack signature verification (JSON requests)
    if (req.headers["content-type"]?.includes("application/json")) {
      req.rawBody = buf.toString(encoding || "utf8");
    }
  },
}));
app.use(methodOverride("X-HTTP-Method-Override"));
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: false,
}));
// app.use(helmet.crossOriginResourcePolicy({ policy: "cross-origin" }));
//---------------------------------------

app.get("/", (req, res) => {
  return res.send("Welcome to Edison server API");
});

app.use("/uploads", express.static("uploads"));

// Readiness state: flips to true once migrations complete so the /health
// endpoint can return 503 while we're still starting up. The reverse proxy
// uses /health to gate traffic.
let isReady = false;

// Health endpoint registered BEFORE other middlewares so it can't be blocked
// by anything route-related and stays cheap. Liveness is implicit (we
// responded). Readiness reflects DB/migration state.
app.get("/health", async (req, res) => {
  res.set("Cache-Control", "no-store");
  if (!isReady) {
    return res.status(503).json({ status: "starting" });
  }
  try {
    await db.sequelize.authenticate();
    return res.status(200).json({ status: "ready", version: packageJson.version });
  } catch (err) {
    return res.status(503).json({ status: "db-unhealthy", error: err.message });
  }
});

// load middlewares
app.use(parseQueryParams);

// Load the routes
_.each(routes, (controller, route) => {
  app.use(route, controller(app));
});

// Load the apps routes
_.each(appsRoutes, (controller, route) => {
  app.use(route, controller(app));
});

const port = process.env.PORT || app.settings.port || 4019;

// Open the port FIRST so the reverse proxy gets connect-success during
// startup (and /health serves a structured 503), instead of connection
// refused → opaque 503 from the proxy. Migrations run after.
const server = app.listen(port, app.settings.api, () => {
  logger.info({ port }, `Listening on port ${port} (not yet ready)`);
});

// Initialize Socket.IO immediately — it's independent of the DB schema.
socketManager.initialize(server).catch((err) => {
  logger.error({ err }, "socketManager.initialize failed");
});

db.migrate()
  .then(async (data) => {
    if (data && data.length > 0) {
      logger.info("Updated database schema to the latest version");
    }

    // create an instance ID and record the current version
    try {
      const appData = await db.App.findAll();
      if (!appData || appData.length === 0) {
        db.App.create({ version: packageJson.version });
      } else if (appData && appData[0]) {
        db.App.update({ version: packageJson.version }, { where: { id: appData[0].id } });
      }
    } catch (e) {
      // continue
    }

    // Check if this is the main cluster and run the cron jobs if it is
    const isMainCluster = parseInt(process.env.NODE_APP_INSTANCE, 10) === 0;
    if (isMainCluster || !process.env.NODE_APP_INSTANCE) {
      // start CronJob, making sure the database is populated for the first time
      setTimeout(() => {
        setUpQueues(app);
        cleanChartCache();
        cleanAuthCache();
        cleanGhostChartsCron();
      }, 5000);
    }

    isReady = true;
    logger.info("Server ready");
  })
  .catch((err) => {
    logger.error({ err }, "Migrations failed; server will continue serving 503 from /health");
  });

// Graceful shutdown: stop accepting new connections, drain in-flight, then
// exit. Hard-cap at SHUTDOWN_TIMEOUT_MS so a stuck request can't pin us
// forever. setUpQueues registers its own SIGTERM/SIGINT handlers for queue
// cleanup; those run concurrently with this one.
let shuttingDown = false;
const SHUTDOWN_TIMEOUT_MS = 30000;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  isReady = false; // immediately fail health checks so the proxy stops routing
  logger.info({ signal }, "Shutdown signal received; draining HTTP server");

  const forceTimer = setTimeout(() => {
    logger.warn({ timeoutMs: SHUTDOWN_TIMEOUT_MS }, "Shutdown timeout; forcing exit");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceTimer.unref();

  server.close((err) => {
    if (err) logger.error({ err }, "server.close error");
    else logger.info("HTTP server closed");
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
