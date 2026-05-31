const rateLimit = require("express-rate-limit");

const verifyToken = require("../modules/verifyToken");
const keycloakTokenStore = require("../modules/keycloakTokenStore");
const logger = require("../modules/logger").child({ module: "api:FeedbackRoute" });

// The ADDMAN platform endpoint that ultimately stores the feedback. Overridable
// via env so non-prod deployments can point at a different platform instance.
const PLATFORM_FEEDBACK_URL = process.env.PLATFORM_FEEDBACK_URL
  || "https://aos.addmangroup.com/home/api/feedback";

const VALID_CATEGORIES = ["bug", "idea", "other"];
const MAX_MESSAGE_LENGTH = 4000;

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
  app.post("/api/feedback", verifyToken, apiLimiter(20), async (req, res) => {
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
