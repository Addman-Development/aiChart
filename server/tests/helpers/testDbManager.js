import { Sequelize } from "sequelize";
import { Umzug, SequelizeStorage } from "umzug";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class TestDbManager {
  constructor() {
    this.container = null;
    this.sequelize = null;
    this.port = null;
    this.database = "smartchart_test";
    this.username = "root";
    this.password = "test_password";
  }

  async start() {
    if (this.sequelize) {
      console.log("Database already initialized");
      return;
    }

    // Postgres-only test harness: tests run against a disposable Postgres
    // container via testcontainers (Docker required). There is no SQLite
    // fallback — the app only targets Postgres, and an in-memory SQLite shadow
    // DB diverges from the real schema and from the models' own connection.
    let GenericContainer;
    let Wait;
    try {
      const testcontainers = await import("testcontainers");
      GenericContainer = testcontainers.GenericContainer;
      Wait = testcontainers.Wait;
    } catch (error) {
      throw new Error(
        "testcontainers is required to run the test suite. Ensure Docker is running and the "
        + `'testcontainers' package is installed. Original error: ${error.message}`,
      );
    }

    // Disable Postgres SSL for the local test container.
    process.env.PGSSLMODE = "disable";
    process.env.PGSSL = "false";
    process.env.PGSSLROOTCERT = "";
    process.env.PGSSLCERT = "";
    process.env.PGSSLKEY = "";

    console.log("🐳 Starting test database container...");
    await this.startPostgres(GenericContainer, Wait);
    console.log(`✅ Database container started on port ${this.port}`);

    // Point the app's models at the test container.
    this.setTestEnvVars();

    // Initialize Sequelize and run migrations.
    await this.initializeDatabase();
  }

  async startPostgres(GenericContainer, Wait) {
    this.container = await new GenericContainer("postgres:15")
      .withEnvironment({
        POSTGRES_USER: this.username,
        POSTGRES_PASSWORD: this.password,
        POSTGRES_DB: this.database,
      })
      .withExposedPorts(5432)
      .withWaitStrategy(
        Wait.forAll([
          Wait.forLogMessage("database system is ready to accept connections"),
          Wait.forListeningPorts()
        ])
      )
      .withStartupTimeout(60000) // 60 seconds timeout
      .start();

    this.port = this.container.getMappedPort(5432);

    // Additional wait to ensure PostgreSQL is truly ready
    console.log("⏳ Waiting for PostgreSQL to be fully ready...");
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  setTestEnvVars() {
    process.env.CB_DB_HOST = "127.0.0.1";
    process.env.CB_DB_PORT = this.port.toString();
    process.env.CB_DB_NAME = this.database;
    process.env.CB_DB_USERNAME = this.username;
    process.env.CB_DB_PASSWORD = this.password;
    process.env.CB_DB_DIALECT = "postgres";

    process.env.PGSSLMODE = "disable";
    process.env.PGSSL = "false";
    process.env.PGSSLROOTCERT = "";
    process.env.PGSSLCERT = "";
    process.env.PGSSLKEY = "";
  }

  async initializeDatabase() {
    this.sequelize = new Sequelize(
      this.database,
      this.username,
      this.password,
      {
        host: "localhost",
        port: this.port,
        dialect: "postgres",
        logging: false,
        pool: {
          max: 5,
          min: 0,
          acquire: 30000,
          idle: 10000
        },
      }
    );

    // Test connection with retry logic
    await this.authenticateWithRetry();
    console.log("✅ Database connection established successfully");

    await this.runMigrations();
  }

  async authenticateWithRetry(maxRetries = 5, delay = 1000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.sequelize.authenticate();
        return;
      } catch (error) {
        console.log(`⏳ Database connection attempt ${attempt}/${maxRetries} failed:`, error.message);

        if (attempt === maxRetries) {
          throw new Error(`Failed to connect to database after ${maxRetries} attempts: ${error.message}`);
        }

        // Wait before retrying
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  async runMigrations() {
    console.log("🔄 Running database migrations...");

    const umzug = new Umzug({
      migrations: {
        glob: path.join(__dirname, "../../models/migrations/*.js"),
        resolve: (params) => {
          const migration = require(params.path);
          return {
            name: params.name,
            up: async () => {
              // Special handling for specific problematic migrations in test environment
              if (params.name === "20200609080754-add-chartid-chartcache.js") {
                // This migration tries to delete from ChartCache but in test environment
                // the table might be empty, so we'll skip the delete and just add the column
                console.log(`⚠️  Applying test-safe version of migration ${params.name}`);
                return this.sequelize.getQueryInterface().addColumn("ChartCache", "chart_id", {
                  type: Sequelize.INTEGER,
                  allowNull: false,
                  reference: {
                    model: "Chart",
                    key: "id",
                    onDelete: "cascade",
                  },
                });
              }

              return await migration.up(this.sequelize.getQueryInterface(), Sequelize);
            }
          };
        },
      },
      context: this.sequelize.getQueryInterface(),
      storage: new SequelizeStorage({ sequelize: this.sequelize }),
      logger: undefined, // Disable logging for tests
    });

    await umzug.up();
    console.log("✅ Migrations completed successfully");
  }

  async stop() {
    if (this.sequelize) {
      try {
        await this.sequelize.close();
      } catch (error) {
        console.log("⚠️  Error closing database connection:", error.message);
      }
      this.sequelize = null;
    }

    if (this.container) {
      try {
        console.log("🛑 Stopping test database container...");
        await this.container.stop();
        console.log("✅ Database container stopped");
      } catch (error) {
        console.log("⚠️  Error stopping container:", error.message);
      }
      this.container = null;
    }
  }

  async cleanup() {
    if (!this.sequelize) return;

    console.log("🧹 Cleaning up test database...");

    // Get all table names
    const tables = await this.sequelize.getQueryInterface().showAllTables();

    // Truncate all tables except SequelizeMeta (migration tracking)
    for (const table of tables) {
      if (table !== "SequelizeMeta") {
        await this.sequelize.query(`TRUNCATE TABLE "${table}" RESTART IDENTITY CASCADE`);
      }
    }

    console.log("✅ Database cleanup completed");
  }

  getSequelize() {
    return this.sequelize;
  }

  getConnectionDetails() {
    return {
      host: "localhost",
      port: this.port,
      database: this.database,
      username: this.username,
      password: this.password,
      dialect: "postgres"
    };
  }
}

// Export singleton instance
export const testDbManager = new TestDbManager();
