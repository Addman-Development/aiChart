const rateLimit = require("express-rate-limit");
const multer = require("multer");

const verifyToken = require("../modules/verifyToken");
const keycloakTokenStore = require("../modules/keycloakTokenStore");
const azureBlob = require("../modules/azureBlob");
const logger = require("../modules/logger").child({ module: "api:FeedbackRoute" });

// The ADDMAN platform endpoint that ultimately stores the feedback. Overridable
// via env so non-prod deployments can point at a different platform instance.
// NOTE: keep the trailing slash — the platform 308-redirects the slashless path.
// The "/home" prefix was dropped platform-side (2026-07), so it's gone here too.
const PLATFORM_FEEDBACK_URL = process.env.PLATFORM_FEEDBACK_URL
  || "https://aos.addmangroup.com/api/feedback/";

const VALID_CATEGORIES = ["bug", "idea", "other"];
const MAX_MESSAGE_LENGTH = 4000;

// Screenshot upload limits. Mirrored in the client so users get instant feedback,
// but enforced here as the source of truth.
const MAX_SCREENSHOTS = 3;
const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"];

// Screenshots are held in memory just long enough to forward them to Azure Blob
// Storage; nothing touches the local disk.
const uploadScreenshots = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_SCREENSHOT_BYTES,
    files: MAX_SCREENSHOTS,
  },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
      return cb(null, true);
    }
    return cb(new Error("Only PNG, JPEG, WebP, or GIF images are allowed."));
  },
}).array("screenshots", MAX_SCREENSHOTS);

const apiLimiter = (max = 10) => {
  return rateLimit({
    windowMs: 60 * 1000,
    max,
    validate: { trustProxy: false },
  });
};

module.exports = (app) => {
  // Proxies user feedback to the ADDMAN platform. verifyToken guarantees the
  // caller is an authenticated app user; we then forward a fresh Keycloak access
  // token (cached at login, refreshed on demand) — the platform validates that
  // token, not our self-signed app JWT.
  //
  // Requests may arrive as JSON (no attachments) or multipart/form-data (with
  // screenshots). multer parses the latter, leaving text fields on req.body and
  // image files on req.files; it passes JSON requests through untouched.
  app.post("/feedback", verifyToken, apiLimiter(20), (req, res, next) => {
    uploadScreenshots(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(400).json({ error: "Each screenshot must be 5MB or smaller." });
        }
        if (err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE") {
          return res.status(400).json({ error: `You can attach at most ${MAX_SCREENSHOTS} screenshots.` });
        }
        return res.status(400).json({ error: "Could not process the attached screenshots." });
      }
      if (err) {
        return res.status(400).json({ error: err.message || "Could not process the attached screenshots." });
      }
      return next();
    });
  }, async (req, res) => {
    const { category, message } = req.body || {};

    if (!VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: "category must be one of: bug, idea, other" });
    }

    if (typeof message !== "string" || message.trim().length < 1 || message.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({ error: `message is required and must be 1-${MAX_MESSAGE_LENGTH} characters` });
    }

    const accessToken = await keycloakTokenStore.getFreshAccessToken(req.user.id);
    if (!accessToken) {
      // No usable Keycloak token (e.g. a session that predates token caching, or
      // an expired refresh token). Signal the client to re-authenticate and retry.
      return res.status(401).json({
        error: "Could not authenticate you with the platform. Please sign in via SSO again and retry.",
        reauthRequired: true,
      });
    }

    // Push any attached screenshots to the feedback container and reference the
    // resulting links in the entry forwarded to the platform.
    let screenshots = [];
    if (Array.isArray(req.files) && req.files.length > 0) {
      try {
        screenshots = await azureBlob.uploadFeedbackScreenshots(req.files);
      } catch (error) {
        logger.error({ err: error }, "failed to upload feedback screenshots");
        return res.status(502).json({ error: "Failed to upload screenshots. Please try again." });
      }
    }

    try {
      const response = await fetch(PLATFORM_FEEDBACK_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          category,
          message: message.trim(),
          pageUrl: req.body.pageUrl,
          module: req.body.module,
          screenshots,
        }),
      });

      // Be tolerant of non-JSON error bodies coming back from the platform.
      const text = await response.text();
      let data;
      try {
        data = text ? JSON.parse(text) : {};
      } catch (e) {
        data = { raw: text };
      }

      // A 401 from the platform means the forwarded token was rejected (expired
      // or otherwise invalid). Tell the client to re-authenticate and retry once.
      if (response.status === 401) {
        return res.status(401).json({
          error: (data && data.error) || "The platform rejected your session. Please sign in again and retry.",
          reauthRequired: true,
        });
      }

      // A 404 from the platform is an upstream misconfiguration (wrong or
      // undeployed endpoint), not a missing route here. Relaying it verbatim
      // makes it look like our own /feedback endpoint 404'd; surface a clear
      // 502 instead and log the real upstream response so ops can find it.
      if (response.status === 404) {
        logger.error({ upstreamStatus: 404, url: PLATFORM_FEEDBACK_URL, body: data }, "platform feedback endpoint returned 404");
        return res.status(502).json({ error: "The feedback service is temporarily unavailable. Please try again later." });
      }

      return res.status(response.status).json(data);
    } catch (error) {
      logger.error({ err: error }, "failed to forward feedback to the platform");
      return res.status(502).json({ error: "Failed to submit feedback" });
    }
  });

  return (req, res, next) => {
    next();
  };
};
