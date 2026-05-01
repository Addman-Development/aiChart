const msal = require("@azure/msal-node");

const settings = require("../settings");
const logger = require("./logger").child({ module: "azureConnector" });

class AzureConnector {
  constructor() {
    if (!settings.azure || !settings.azure.clientId) {
      this.enabled = false;
      return;
    }

    this.enabled = true;
    this.config = {
      auth: {
        clientId: settings.azure.clientId,
        authority: settings.azure.authority,
        clientSecret: settings.azure.clientSecret,
      },
    };

    this.redirectUri = settings.azure.redirectUri;
    this.scopes = ["openid", "profile", "email", "User.Read"];

    try {
      this.confidentialClient = new msal.ConfidentialClientApplication(this.config);
    } catch (error) {
      logger.error({ err: error }, "Failed to initialize Azure MSAL client");
      this.enabled = false;
    }
  }

  /**
   * Check if Azure AD authentication is enabled
   */
  isEnabled() {
    return this.enabled;
  }

  /**
   * Generate Azure AD authorization URL
   * @param {string} state - CSRF protection state parameter
   * @returns {Promise<string>} Authorization URL
   */
  async getAuthUrl(state) {
    if (!this.enabled) {
      throw new Error("Azure AD authentication is not configured");
    }

    const authCodeUrlParameters = {
      scopes: this.scopes,
      redirectUri: this.redirectUri,
      state,
    };

    try {
      const authUrl = await this.confidentialClient.getAuthCodeUrl(authCodeUrlParameters);
      return authUrl;
    } catch (error) {
      throw new Error(`Failed to generate auth URL: ${error.message}`);
    }
  }

  /**
   * Exchange authorization code for tokens and extract user info
   * @param {string} code - Authorization code from callback
   * @returns {Promise<Object>} User information { azureId, email, name }
   */
  async getToken(code) {
    if (!this.enabled) {
      throw new Error("Azure AD authentication is not configured");
    }

    const tokenRequest = {
      code,
      scopes: this.scopes,
      redirectUri: this.redirectUri,
    };

    try {
      const response = await this.confidentialClient.acquireTokenByCode(tokenRequest);

      // Extract user information from ID token claims
      const idTokenClaims = response.idTokenClaims;

      if (!idTokenClaims) {
        throw new Error("No ID token claims returned from Azure AD");
      }

      return {
        azureId: idTokenClaims.oid || idTokenClaims.sub, // Object ID (preferred) or Subject
        email: idTokenClaims.email || idTokenClaims.preferred_username,
        name: idTokenClaims.name,
      };
    } catch (error) {
      throw new Error(`Failed to exchange code for token: ${error.message}`);
    }
  }

  /**
   * Validate an Azure access token
   * @param {string} accessToken - Access token to validate
   * @returns {Promise<Object>} Token validation result
   */
  async validateToken(accessToken) {
    if (!this.enabled) {
      throw new Error("Azure AD authentication is not configured");
    }

    try {
      // Note: For production, implement proper token validation using JWT verification
      // This is a placeholder for the validation logic
      // You would typically verify the token signature, expiration, issuer, audience, etc.
      return { valid: true };
    } catch (error) {
      throw new Error(`Token validation failed: ${error.message}`);
    }
  }
}

module.exports = new AzureConnector();
