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

  // Start the test database container (shared across all tests). Tests run
  // against a disposable Postgres container via testcontainers — Docker required.
  await testDbManager.start();

  console.log("✅ Global test setup completed");
}
