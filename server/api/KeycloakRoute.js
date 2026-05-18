const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");

const UserController = require("../controllers/UserController");
const verifyToken = require("../modules/verifyToken");
const userResponse = require("../modules/userResponse");
const keycloakConnector = require("../modules/keycloakConnector");
const logger = require("../modules/logger").child({ module: "api:KeycloakRoute" });

const apiLimiter = (max = 10) => {
  return rateLimit({
    windowMs: 60 * 1000,
    max,
    validate: { trustProxy: false },
  });
};

const OIDC_COOKIE = "kc_oidc";
const OIDC_COOKIE_TTL_MS = 10 * 60 * 1000;

const oidcCookieOptions = (req) => ({
  httpOnly: true,
  sameSite: "lax",
  secure: req.secure || req.headers["x-forwarded-proto"] === "https",
  maxAge: OIDC_COOKIE_TTL_MS,
  path: "/",
});

module.exports = (app) => {
  const userController = new UserController();

  const tokenizeUser = (user, res, redirectParams = {}) => {
    const userToken = { id: user.id, email: user.email };
    jwt.sign(userToken, app.settings.encryptionKey, {
      expiresIn: 2592000,
    }, (err, token) => {
      if (err) {
        return res.redirect(`${app.settings.client}/login?error=token_generation_failed`);
      }
      const params = new URLSearchParams({ token, ...redirectParams });
      return res.redirect(`${app.settings.client}/keycloak-callback?${params.toString()}`);
    });
  };

  app.get("/api/keycloak/auth", apiLimiter(10), async (req, res) => {
    if (!keycloakConnector.isEnabled()) {
      return res.status(503).json({ error: "Keycloak authentication is not configured" });
    }

    try {
      const { authUrl, state, codeVerifier, nonce } = await keycloakConnector.getAuthUrl();
      const cookieValue = jwt.sign(
        { state, codeVerifier, nonce },
        app.settings.encryptionKey,
        { expiresIn: "10m" },
      );
      res.cookie(OIDC_COOKIE, cookieValue, oidcCookieOptions(req));
      return res.status(200).json({ authUrl });
    } catch (error) {
      logger.error({ err: error }, "keycloak: failed to build auth URL");
      return res.status(500).json({ error: "Failed to start Keycloak login" });
    }
  });

  app.get("/api/keycloak/auth/callback", apiLimiter(10), async (req, res) => {
    if (!keycloakConnector.isEnabled()) {
      return res.redirect(`${app.settings.client}/login?error=keycloak_not_configured`);
    }

    const { code, state, iss, error, error_description: errorDescription } = req.query;

    if (error) {
      res.clearCookie(OIDC_COOKIE, { path: "/" });
      return res.redirect(
        `${app.settings.client}/login?error=keycloak_auth_failed&message=${encodeURIComponent(errorDescription || error)}`,
      );
    }

    if (!code || !state) {
      res.clearCookie(OIDC_COOKIE, { path: "/" });
      return res.redirect(`${app.settings.client}/login?error=no_authorization_code`);
    }

    const oidcCookie = req.cookies && req.cookies[OIDC_COOKIE];
    if (!oidcCookie) {
      return res.redirect(`${app.settings.client}/login?error=keycloak_state_missing`);
    }

    let stash;
    try {
      stash = jwt.verify(oidcCookie, app.settings.encryptionKey);
    } catch (e) {
      res.clearCookie(OIDC_COOKIE, { path: "/" });
      return res.redirect(`${app.settings.client}/login?error=keycloak_state_invalid`);
    }

    if (stash.state !== state) {
      res.clearCookie(OIDC_COOKIE, { path: "/" });
      return res.redirect(`${app.settings.client}/login?error=keycloak_state_mismatch`);
    }

    res.clearCookie(OIDC_COOKIE, { path: "/" });

    try {
      const kcUser = await keycloakConnector.getToken({
        code,
        state,
        iss,
        codeVerifier: stash.codeVerifier,
        nonce: stash.nonce,
      });

      if (!kcUser.email) {
        return res.redirect(`${app.settings.client}/login?error=no_email_from_keycloak`);
      }

      let user = await userController.findByKeycloakId(kcUser.keycloakId);

      if (user) {
        await userController.update(user.id, { lastLogin: new Date() });
        return tokenizeUser(user, res);
      }

      user = await userController.findByEmail(kcUser.email).catch(() => null);

      if (user) {
        if (user.keycloakId) {
          return res.redirect(`${app.settings.client}/login?error=email_already_linked`);
        }

        await userController.update(user.id, {
          keycloakId: kcUser.keycloakId,
          authProvider: user.password ? "hybrid" : "keycloak",
          keycloakLinkedAt: new Date(),
          lastLogin: new Date(),
        });

        return tokenizeUser(user, res, { linked: "true" });
      }

      if (!app.settings.ssoAutoCreate) {
        const message = encodeURIComponent(
          "No account exists for this email. Please contact your administrator for an invite.",
        );
        return res.redirect(
          `${app.settings.client}/login?error=sso_account_required&message=${message}`,
        );
      }

      const newUser = await userController.createSSOUser({
        email: kcUser.email,
        name: kcUser.name,
        keycloakId: kcUser.keycloakId,
      });

      return tokenizeUser(newUser, res, { new: "true" });
    } catch (err) {
      logger.error({ err }, "keycloak: callback failed");
      return res.redirect(
        `${app.settings.client}/login?error=keycloak_callback_failed&message=${encodeURIComponent(err.message)}`,
      );
    }
  });

  app.post("/api/keycloak/link", verifyToken, apiLimiter(5), async (req, res) => {
    if (!keycloakConnector.isEnabled()) {
      return res.status(503).json({ error: "Keycloak authentication is not configured" });
    }

    const { code, state } = req.body;
    if (!code || !state) {
      return res.status(400).json({ error: "code and state are required" });
    }

    const oidcCookie = req.cookies && req.cookies[OIDC_COOKIE];
    if (!oidcCookie) {
      return res.status(400).json({ error: "Missing OIDC state cookie" });
    }

    let stash;
    try {
      stash = jwt.verify(oidcCookie, app.settings.encryptionKey);
    } catch (e) {
      res.clearCookie(OIDC_COOKIE, { path: "/" });
      return res.status(400).json({ error: "Invalid OIDC state" });
    }

    if (stash.state !== state) {
      res.clearCookie(OIDC_COOKIE, { path: "/" });
      return res.status(400).json({ error: "OIDC state mismatch" });
    }

    res.clearCookie(OIDC_COOKIE, { path: "/" });

    try {
      const kcUser = await keycloakConnector.getToken({
        code,
        state,
        codeVerifier: stash.codeVerifier,
        nonce: stash.nonce,
      });

      if (!kcUser.email) {
        return res.status(400).json({ error: "No email returned from Keycloak" });
      }

      if (kcUser.email.toLowerCase() !== req.user.email.toLowerCase()) {
        return res.status(400).json({
          error: "Keycloak account email does not match your account email",
        });
      }

      const existingUser = await userController.findByKeycloakId(kcUser.keycloakId);
      if (existingUser && existingUser.id !== req.user.id) {
        return res.status(409).json({
          error: "This Keycloak account is already linked to another user",
        });
      }

      const updatedUser = await userController.update(req.user.id, {
        keycloakId: kcUser.keycloakId,
        authProvider: "hybrid",
        keycloakLinkedAt: new Date(),
      });

      return res.status(200).json(userResponse(updatedUser));
    } catch (err) {
      logger.error({ err }, "keycloak: link failed");
      return res.status(400).json({ error: err.message });
    }
  });

  app.delete("/api/keycloak/unlink", verifyToken, apiLimiter(5), async (req, res) => {
    const { password } = req.body;

    try {
      const user = await userController.findById(req.user.id);

      if (!user.keycloakId) {
        return res.status(400).json({ error: "No Keycloak account linked to this user" });
      }

      if (user.authProvider === "keycloak" || !user.password) {
        return res.status(400).json({
          error: "Cannot unlink Keycloak account. This is your only authentication method.",
        });
      }

      if (!password) {
        return res.status(400).json({ error: "Password verification required" });
      }

      const isValidPassword = await userController.verifyPassword(user, password);
      if (!isValidPassword) {
        return res.status(401).json({ error: "Invalid password" });
      }

      const updatedUser = await userController.update(req.user.id, {
        keycloakId: null,
        authProvider: "local",
        keycloakLinkedAt: null,
      });

      return res.status(200).json(userResponse(updatedUser));
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  });

  return (req, res, next) => {
    next();
  };
};
