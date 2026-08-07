import { testDbManager } from "./helpers/testDbManager.js";

export default async function globalSetup() {
  console.log("🚀 Starting global test setup...");

  // Set test environment variables
  process.env.NODE_ENV = "test";
  process.env.CB_SECRET = "test-secret-key-for-testing-only";
  process.env.CB_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef"; // 32-char hex for testing
  process.env.CB_API_HOST = "127.0.0.1";
  process.env.CB_API_PORT = "0"; // Let the system assign a random port
  process.env.CB_DB_DIALECT = "postgres";
  // The local test container speaks plaintext. Some migrations open their own
  // connection through models/config/config.js, which loads the repo .env — so a
  // developer whose CB_DB_SSL targets a real TLS database would otherwise fail
  // those migrations with "The server does not support SSL connections". Cleared
  // here as well as in setup.js, because setupFiles only apply to test workers.
  process.env.CB_DB_SSL = "";
  process.env.CB_DB_CERT = "";
  process.env.CB_DB_SSL_KEY = "";
  process.env.CB_DB_SSL_CERT = "";

  // Start the test database container (shared across all tests). Tests run
  // against a disposable Postgres container via testcontainers — Docker required.
  await testDbManager.start();

  console.log("✅ Global test setup completed");
}
