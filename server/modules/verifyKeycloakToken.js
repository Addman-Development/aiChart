const jwt = require("jsonwebtoken");
const { createPublicKey } = require("crypto");

const db = require("../models/models");
const userResponse = require("./userResponse");
const settings = require("../settings");
const logger = require("./logger").child({ module: "verifyKeycloakToken" });

/**
 * Express middleware that authenticates a request with a Keycloak *access
 * token* issued by the shared ADDMAN realm, instead of a smartChart-issued
 * JWT.
 *
 * This is what lets sibling ADDMAN apps (notably "the-platform") call the
 * /api/embed/* surface on behalf of a signed-in user by simply forwarding that
 * user's existing Keycloak bearer — no smartChart credential is minted, stored
 * or shared anywhere. The token is verified against the realm's published JWKS
 * (RS256), then mapped to a local User by `keycloakId` (== the Keycloak `sub`),
 * falling back to email. Access to individual charts/projects is still enforced
 * per-request by the route (TeamRole scoping); this middleware only proves
 * *who* is calling.
 *
 * If the token is valid but the caller has never signed into smartChart (no
 * linked User row yet), we do NOT 401 — instead `req.embedUnlinked` is set so
 * the catalog route can return an empty "not linked yet" payload and the
 * platform UI can guide the user to open smartChart once.
 *
 * No external dependency: JWKS is fetched with the built-in global `fetch`
 * (Node 20) and JWK verification keys are built with `crypto.createPublicKey`.
 */

const JWKS_TTL_MS = 60 * 60 * 1000; // refresh the realm keys hourly
let jwksCache = { keys: null, fetchedAt: 0, uri: null };

function issuer() {
  return settings.keycloak && settings.keycloak.issuer;
}

function certsUri() {
  return `${issuer().replace(/\/$/, "")}/protocol/openid-connect/certs`;
}

async function getKeys({ force = false } = {}) {
  const uri = certsUri();
  const fresh = !force
    && jwksCache.keys
    && jwksCache.uri === uri
    && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS;
  if (fresh) return jwksCache.keys;

  const res = await fetch(uri, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`JWKS fetch failed (${res.status})`);
  const body = await res.json();
  jwksCache = { keys: body.keys || [], fetchedAt: Date.now(), uri };
  return jwksCache.keys;
}

async function publicKeyForKid(kid) {
  let keys = await getKeys();
  let jwk = keys.find((k) => k.kid === kid);
  if (!jwk) {
    // Signing key may have rotated — refresh once before giving up.
    keys = await getKeys({ force: true });
    jwk = keys.find((k) => k.kid === kid);
  }
  if (!jwk) throw new Error(`No JWKS key for kid ${kid}`);
  return createPublicKey({ key: jwk, format: "jwk" });
}

module.exports = async (req, res, next) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return res.status(401).send({ error: "Missing bearer token" });

  if (!issuer()) {
    logger.error("KEYCLOAK_ISSUER is not configured; /api/embed is unavailable");
    return res.status(503).send({ error: "SSO is not configured" });
  }

  let decoded;
  try {
    const complete = jwt.decode(token, { complete: true });
    const kid = complete && complete.header && complete.header.kid;
    if (!kid) return res.status(401).send({ error: "Invalid token" });
    const pub = await publicKeyForKid(kid);
    decoded = jwt.verify(token, pub, {
      algorithms: ["RS256"],
      issuer: issuer(),
    });
  } catch (err) {
    logger.debug({ err: err.message }, "keycloak token verification failed");
    return res.status(401).send({ error: "Invalid or expired token" });
  }

  const { sub } = decoded;
  try {
    let user = await db.User.findOne({ where: { keycloakId: sub } });
    if (!user && decoded.email) {
      user = await db.User.findOne({
        where: { email: `${decoded.email}`.toLowerCase() },
      });
    }

    req.kcClaims = decoded;
    if (!user) {
      req.embedUnlinked = true;
      return next();
    }

    req.user = userResponse(user);
    req.user.admin = user.admin;
    return next();
  } catch (err) {
    logger.error({ err }, "failed to resolve embed user");
    return res.status(500).send({ error: "Failed to resolve user" });
  }
};
