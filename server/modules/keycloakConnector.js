const settings = require("../settings");
const logger = require("./logger").child({ module: "keycloakConnector" });

const DEFAULT_SCOPE = "openid profile email";

class KeycloakConnector {
  constructor() {
    const cfg = settings.keycloak || {};
    if (!cfg.issuer || !cfg.clientId || !cfg.redirectUri) {
      this.enabled = false;
      return;
    }

    this.enabled = true;
    this.issuerUrl = cfg.issuer;
    this.clientId = cfg.clientId;
    this.clientSecret = cfg.clientSecret;
    this.redirectUri = cfg.redirectUri;
    this.postLogoutRedirectUri = cfg.postLogoutRedirectUri;
    this.scope = cfg.scope || DEFAULT_SCOPE;
    this.client = null;
    this.generators = null;
    this.discoveryPromise = null;
  }

  isEnabled() {
    return this.enabled;
  }

  async getClient() {
    if (!this.enabled) {
      throw new Error("Keycloak authentication is not configured");
    }
    if (this.client) return this.client;
    if (!this.discoveryPromise) {
      this.discoveryPromise = (async () => {
        const { Issuer, generators } = require("openid-client");
        this.generators = generators;
        const issuer = await Issuer.discover(this.issuerUrl);
        this.client = new issuer.Client({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          redirect_uris: [this.redirectUri],
          response_types: ["code"],
          token_endpoint_auth_method: this.clientSecret ? "client_secret_post" : "none",
        });
        return this.client;
      })().catch((err) => {
        this.discoveryPromise = null;
        logger.error({ err, issuer: this.issuerUrl }, "Keycloak discovery failed");
        throw err;
      });
    }
    return this.discoveryPromise;
  }

  async getAuthUrl() {
    const client = await this.getClient();
    const state = this.generators.state();
    const nonce = this.generators.nonce();
    const codeVerifier = this.generators.codeVerifier();
    const codeChallenge = this.generators.codeChallenge(codeVerifier);

    const authUrl = client.authorizationUrl({
      scope: this.scope,
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });

    return { authUrl, state, codeVerifier, nonce };
  }

  async getToken({ code, state, iss, codeVerifier, nonce }) {
    const client = await this.getClient();

    const tokenSet = await client.callback(
      this.redirectUri,
      { code, state, ...(iss ? { iss } : {}) },
      { state, code_verifier: codeVerifier, nonce },
    );

    const claims = tokenSet.claims();
    if (!claims || !claims.sub) {
      throw new Error("Keycloak returned a token with no subject claim");
    }

    const email = claims.email || claims.preferred_username;
    const name = claims.name
      || [claims.given_name, claims.family_name].filter(Boolean).join(" ")
      || claims.preferred_username;

    return {
      keycloakId: claims.sub,
      email,
      name,
      idToken: tokenSet.id_token,
      accessToken: tokenSet.access_token,
      refreshToken: tokenSet.refresh_token,
      expiresAt: tokenSet.expires_at, // epoch seconds
    };
  }

  async refresh(refreshToken) {
    const client = await this.getClient();
    const tokenSet = await client.refresh(refreshToken);

    return {
      accessToken: tokenSet.access_token,
      // Keycloak rotates refresh tokens; fall back to the old one if not returned.
      refreshToken: tokenSet.refresh_token || refreshToken,
      expiresAt: tokenSet.expires_at,
    };
  }

  async getLogoutUrl(idTokenHint) {
    const client = await this.getClient();
    return client.endSessionUrl({
      id_token_hint: idTokenHint,
      post_logout_redirect_uri: this.postLogoutRedirectUri,
    });
  }
}

module.exports = new KeycloakConnector();
