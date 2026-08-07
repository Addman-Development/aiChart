import { beforeEach } from "vitest";
import { testDbManager } from "./helpers/testDbManager.js";

// Ensure required env vars exist for settings.js during tests
process.env.CB_SECRET = process.env.CB_SECRET || "test-secret";
// Must be 64 hex chars (32 bytes) because server/modules/cbCrypto.js uses it as AES-256 key in hex.
process.env.CB_ENCRYPTION_KEY = process.env.CB_ENCRYPTION_KEY
  || "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.VITE_APP_CLIENT_HOST = process.env.VITE_APP_CLIENT_HOST || "http://localhost:3000";
process.env.CB_RESTRICT_TEAMS = process.env.CB_RESTRICT_TEAMS || "0";
process.env.CB_RESTRICT_SIGNUP = process.env.CB_RESTRICT_SIGNUP || "0";
// Force SSL off for the models singleton. models/config/config.js loads the repo
// .env, so a developer pointing CB_DB_SSL at a real (TLS-requiring) database
// leaked that setting into the tests and made every model-backed test fail with
// "The server does not support SSL connections" against the local test
// container. Set before the model modules are required — dotenv does not
// override variables that already exist.
process.env.CB_DB_SSL = "";
process.env.CB_DB_CERT = "";
process.env.CB_DB_SSL_KEY = "";
process.env.CB_DB_SSL_CERT = "";

// Clean database between each test but don't restart containers
beforeEach(async () => {
  // Only clean if database is initialized
  if (testDbManager.getSequelize()) {
    await testDbManager.cleanup();
  }
});
