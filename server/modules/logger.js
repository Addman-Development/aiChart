const pino = require("pino");
const packageJson = require("../package.json");

const env = process.env.NODE_ENV || "development";
const isProd = env === "production";
const level = process.env.LOG_LEVEL || (isProd ? "info" : "debug");

const logger = pino({
  level,
  messageKey: "message",
  base: {
    service: process.env.DD_SERVICE || "smartchart-server",
    env: process.env.DD_ENV || env,
    version: process.env.DD_VERSION || packageJson.version,
  },
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      "password",
      "*.password",
      "newPassword",
      "*.newPassword",
      "token",
      "*.token",
      "accessToken",
      "*.accessToken",
      "refreshToken",
      "*.refreshToken",
      "apiKey",
      "*.apiKey",
      "api_key",
      "*.api_key",
      "secret",
      "*.secret",
      "authorization",
      "*.authorization",
      "headers.authorization",
      "headers.cookie",
      "req.headers.authorization",
      "req.headers.cookie",
      "request.headers.authorization",
      "request.headers.cookie",
    ],
    censor: "[REDACTED]",
  },
});

// Ergonomic alias so `logger.log(...)` matches the convention used elsewhere
// in ADDMAN services. Patch the prototype so child loggers (e.g. req.log from
// pino-http) inherit it as well.
const proto = Object.getPrototypeOf(logger);
if (typeof proto.log !== "function") {
  proto.log = function log(...args) {
    return this.info(...args);
  };
}

module.exports = logger;
