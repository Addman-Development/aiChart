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

// Clean database between each test but don't restart containers
beforeEach(async () => {
  // Only clean if database is initialized
  if (testDbManager.getSequelize()) {
    await testDbManager.cleanup();
  }
});
