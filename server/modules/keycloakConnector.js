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

  // Lazy discovery: openid-client is ESM-only in v6 but v5 is CJS-friendly.
  // We pin to ^5 and require it on first use so module load never fails the
  // server when Keycloak is unconfigured.
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
        // Reset so a later request can retry discovery (Keycloak may be briefly down)
        this.discoveryPromise = null;
        logger.error({ err, issuer: this.issuerUrl }, "Keycloak discovery failed");
        throw err;
      });
    }
    return this.discoveryPromise;
  }

  /**
   * Build the authorization URL plus the PKCE/state values that must be
   * round-tripped back from the callback.
   * @returns {Promise<{ authUrl: string, state: string, codeVerifier: string, nonce: string }>}
   */
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

  /**
   * Exchange the authorization code for tokens and return the OIDC claims we
   * care about for user provisioning.
   * @param {object} params - { code, state, codeVerifier, nonce }
   * @returns {Promise<{ keycloakId: string, email: string, name: string, idToken: string }>}
   */
  async getToken({ code, state, codeVerifier, nonce }) {
    const client = await this.getClient();

    // openid-client wants the raw query params; we hand it back the code/state
    // we received from Keycloak.
    const tokenSet = await client.callback(
      this.redirectUri,
      { code, state },
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
    };
  }

  /**
   * Build an RP-initiated logout URL so we can sign the user out at Keycloak
   * after we clear the local session.
   * @param {string} idTokenHint - The id_token from the original login
   */
  async getLogoutUrl(idTokenHint) {
    const client = await this.getClient();
    return client.endSessionUrl({
      id_token_hint: idTokenHint,
      post_logout_redirect_uri: this.postLogoutRedirectUri,
    });
  }
}

module.exports = new KeycloakConnector();
