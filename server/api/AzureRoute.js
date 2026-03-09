const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");

const UserController = require("../controllers/UserController");
const verifyToken = require("../modules/verifyToken");
const userResponse = require("../modules/userResponse");
const azureConnector = require("../modules/azureConnector");

const apiLimiter = (max = 10) => {
  return rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max,
    validate: { trustProxy: false }, // Disable trust proxy validation for development
  });
};

module.exports = (app) => {
  const userController = new UserController();

  const tokenizeUser = ((user, res, redirectParams = {}) => {
    const userToken = {
      id: user.id,
      email: user.email,
    };
    jwt.sign(userToken, app.settings.encryptionKey, {
      expiresIn: 2592000 // a month
    }, (err, token) => {
      if (err) {
        return res.redirect(`${app.settings.client}/login?error=token_generation_failed`);
      }

      // Build redirect URL with token and optional params
      const params = new URLSearchParams({
        token,
        ...redirectParams,
      });

      return res.redirect(`${app.settings.client}/azure-callback?${params.toString()}`);
    });
  });

  /*
  ** Route to initiate Azure AD login
  */
  app.get("/api/azure/auth", apiLimiter(10), async (req, res) => {
    if (!azureConnector.isEnabled()) {
      return res.status(503).json({ error: "Azure AD authentication is not configured" });
    }

    try {
      // Generate CSRF protection state parameter
      const state = crypto.randomBytes(16).toString("hex");

      // Store state in session or temporary cache if needed
      // For simplicity, we're not validating state in this implementation
      // In production, you should validate the state parameter on callback

      const authUrl = await azureConnector.getAuthUrl(state);
      return res.status(200).json({ authUrl });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });
  // --------------------------------------

  /*
  ** Route to handle Azure AD callback
  */
  app.get("/api/azure/auth/callback", apiLimiter(10), async (req, res) => {
    if (!azureConnector.isEnabled()) {
      return res.redirect(`${app.settings.client}/login?error=azure_not_configured`);
    }

    const { code, error, error_description } = req.query;

    if (error) {
      return res.redirect(
        `${app.settings.client}/login?error=azure_auth_failed&message=${encodeURIComponent(error_description || error)}`
      );
    }

    if (!code) {
      return res.redirect(`${app.settings.client}/login?error=no_authorization_code`);
    }

    try {
      // Exchange authorization code for user information
      const azureUser = await azureConnector.getToken(code);

      if (!azureUser.email) {
        return res.redirect(`${app.settings.client}/login?error=no_email_from_azure`);
      }

      // Check if user with this Azure ID exists
      let user = await userController.findByAzureId(azureUser.azureId);

      if (user) {
        // User found by Azure ID - log them in
        await userController.update(user.id, { lastLogin: new Date() });
        return tokenizeUser(user, res);
      }

      // Check if user with this email exists (account linking scenario)
      user = await userController.findByEmail(azureUser.email);

      if (user) {
        // User exists with same email - link accounts
        if (user.azureId) {
          // Email already linked to a different Azure account
          return res.redirect(
            `${app.settings.client}/login?error=email_already_linked`
          );
        }

        // Link Azure account to existing user
        await userController.update(user.id, {
          azureId: azureUser.azureId,
          authProvider: user.password ? "hybrid" : "azure",
          azureLinkedAt: new Date(),
          lastLogin: new Date(),
        });

        return tokenizeUser(user, res, { linked: "true" });
      }

      // No existing user - create new Azure-only user
      const icon = azureUser.name ? azureUser.name.substring(0, 2).toUpperCase() : "AZ";
      const newUser = await userController.createUser({
        name: azureUser.name || azureUser.email,
        email: azureUser.email,
        azureId: azureUser.azureId,
        authProvider: "azure",
        password: null, // Azure-only users don't have passwords
        active: true, // Auto-activate Azure users
        icon,
      });

      return tokenizeUser(newUser, res, { new: "true" });
    } catch (error) {
      return res.redirect(
        `${app.settings.client}/login?error=azure_callback_failed&message=${encodeURIComponent(error.message)}`
      );
    }
  });
  // --------------------------------------

  /*
  ** Route to link Azure account to logged-in user
  */
  app.post("/api/azure/link", verifyToken, apiLimiter(5), async (req, res) => {
    if (!azureConnector.isEnabled()) {
      return res.status(503).json({ error: "Azure AD authentication is not configured" });
    }

    const { code } = req.body;

    if (!code) {
      return res.status(400).json({ error: "Authorization code is required" });
    }

    try {
      // Exchange authorization code for user information
      const azureUser = await azureConnector.getToken(code);

      if (!azureUser.email) {
        return res.status(400).json({ error: "No email returned from Azure AD" });
      }

      // Verify that Azure email matches logged-in user's email
      if (azureUser.email.toLowerCase() !== req.user.email.toLowerCase()) {
        return res.status(400).json({
          error: "Azure account email does not match your account email",
        });
      }

      // Check if Azure ID is already linked to another account
      const existingUser = await userController.findByAzureId(azureUser.azureId);
      if (existingUser && existingUser.id !== req.user.id) {
        return res.status(409).json({
          error: "This Azure account is already linked to another user",
        });
      }

      // Link Azure account
      const updatedUser = await userController.update(req.user.id, {
        azureId: azureUser.azureId,
        authProvider: "hybrid",
        azureLinkedAt: new Date(),
      });

      return res.status(200).json(userResponse(updatedUser));
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });
  // --------------------------------------

  /*
  ** Route to unlink Azure account from logged-in user
  */
  app.delete("/api/azure/unlink", verifyToken, apiLimiter(5), async (req, res) => {
    const { password } = req.body;

    try {
      // Get current user
      const user = await userController.findById(req.user.id);

      if (!user.azureId) {
        return res.status(400).json({ error: "No Azure account linked to this user" });
      }

      // Azure-only users cannot unlink (they would lose access)
      if (user.authProvider === "azure" || !user.password) {
        return res.status(400).json({
          error: "Cannot unlink Azure account. This is your only authentication method.",
        });
      }

      // Verify password before unlinking
      if (!password) {
        return res.status(400).json({ error: "Password verification required" });
      }

      const isValidPassword = await userController.verifyPassword(user, password);
      if (!isValidPassword) {
        return res.status(401).json({ error: "Invalid password" });
      }

      // Unlink Azure account
      const updatedUser = await userController.update(req.user.id, {
        azureId: null,
        authProvider: "local",
        azureLinkedAt: null,
      });

      return res.status(200).json(userResponse(updatedUser));
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });
  // --------------------------------------

  return (req, res, next) => {
    next();
  };
};
