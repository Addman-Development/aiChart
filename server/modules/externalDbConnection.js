const Sequelize = require("sequelize");
const { decryptFileSync } = require("./fileEncryption");

module.exports = async (connection) => {
  const name = connection.dbName;
  const username = connection.username || "";
  const password = connection.password || "";
  const host = connection.host || "localhost";
  const { port, connectionString } = connection;
  const dialect = connection.type;


  let sequelize;

  const connectionConfig = {
    host,
    port: port || (dialect === "mssql" ? 1433 : undefined),
    dialect,
    logging: false,
  };

  // MSSQL-specific configuration
  if (dialect === "mssql") {
    connectionConfig.dialectOptions = {
      options: {
        encrypt: !!connection.ssl,
        trustServerCertificate: true,
        // Avoid TLS SNI issues when connecting to IP addresses
        cryptoCredentialsDetails: {
          servername: "",
        },
      },
      connectTimeout: 15000,
      requestTimeout: 15000,
    };
    connectionConfig.pool = {
      max: 5,
      min: 0,
      acquire: 20000,
      idle: 10000,
    };
  }

  // SSL options only apply to Postgres-family dialects
  let sslOptions = null;

  if (dialect !== "mssql") {
    if (connection.subType === "timescaledb") {
      sslOptions = {
        require: true,
        rejectUnauthorized: false,
      };
    }

    if (connection.ssl) {
      switch (connection.sslMode) {
        case "require":
          sslOptions = {
            require: true,
            rejectUnauthorized: false,
          };
          break;

        case "verify-ca":
          sslOptions = {
            require: true,
            rejectUnauthorized: true,
            ca: connection.sslCa ? decryptFileSync(connection.sslCa) : undefined,
          };
          break;

        case "verify-full":
          sslOptions = {
            require: true,
            rejectUnauthorized: true,
            ca: connection.sslCa ? decryptFileSync(connection.sslCa) : undefined,
            key: connection.sslKey ? decryptFileSync(connection.sslKey) : undefined,
            cert: connection.sslCert ? decryptFileSync(connection.sslCert) : undefined,
          };
          break;
        case "prefer":
          sslOptions = {
            require: false,
            rejectUnauthorized: false,
          };
          break;
        case "disable":
          sslOptions = {
            require: false,
            rejectUnauthorized: false,
          };
          break;
        default:
          sslOptions = {
            require: true,
            rejectUnauthorized: false,
          };
          break;
      }
    }

    // Bound connection establishment and pool acquisition for Postgres-family
    // dialects so an unreachable/firewalled host fails fast (~15s) instead of
    // hanging on the OS TCP timeout (~2min) — which the reverse proxy would cut
    // off as an opaque 504 before a clean driver error can be returned. (MSSQL
    // sets its own connect/request timeouts above.) The branches below layer
    // `ssl` onto this dialectOptions object, so they must not replace it.
    connectionConfig.pool = {
      max: 5,
      min: 0,
      acquire: 20000,
      idle: 10000,
    };
    connectionConfig.dialectOptions = {
      connectionTimeoutMillis: 15000,
    };
  }

  if (connectionString && dialect === "mssql") {
    // Parse MSSQL connection string (Server=...;Database=...;User Id=...;Password=...;)
    const params = {};
    connectionString.split(";").forEach((pair) => {
      const idx = pair.indexOf("=");
      if (idx > -1) {
        const key = pair.substring(0, idx).trim().toLowerCase();
        const value = pair.substring(idx + 1).trim();
        params[key] = value;
      }
    });

    const csHost = params.server || params.host || params["data source"] || host;
    const csDb = params.database || params["initial catalog"] || name;
    const csUser = params["user id"] || params.uid || params.user || username;
    const csPass = params.password || params.pwd || password;
    const csPort = params.port || port || 1433;

    const encrypt = params.encrypt === "true" || params.encrypt === "yes" || !!connection.ssl;
    connectionConfig.host = csHost;
    connectionConfig.port = csPort;
    connectionConfig.dialectOptions = {
      options: {
        encrypt,
        trustServerCertificate: true,
        cryptoCredentialsDetails: {
          servername: "",
        },
      },
      connectTimeout: 15000,
      requestTimeout: 15000,
    };

    sequelize = new Sequelize(csDb, csUser, csPass, connectionConfig);
  } else if (connectionString) {
    // extract each element from the string so that we can encode the password
    // this is needed when the password contains symbols that are not URI-friendly
    const cs = connectionString;
    let newConnectionString = "";

    const protocol = cs.substring(0, cs.indexOf("//") + 2);
    newConnectionString = cs.replace(protocol, "");

    const csUsername = newConnectionString.substring(0, newConnectionString.indexOf(":"));
    newConnectionString = cs.replace(protocol + csUsername, "");

    const csPassword = encodeURIComponent(newConnectionString.substring(1, newConnectionString.lastIndexOf("@")));

    const hostAndOpt = cs.substring(cs.lastIndexOf("@"));

    newConnectionString = `${protocol}${csUsername}:${csPassword}${hostAndOpt}`;

    connectionConfig.dialectOptions.ssl = sslOptions;

    // check if a postgres connection needs SSL
    if (newConnectionString.indexOf("sslmode=require") > -1 && dialect === "postgres" && !connection.ssl) {
      newConnectionString = newConnectionString.replace("?sslmode=require", "");
      newConnectionString = newConnectionString.replace("&sslmode=require", "");
      connectionConfig.dialectOptions.ssl = {
        require: true,
        rejectUnauthorized: false,
      };
    }

    sequelize = new Sequelize(newConnectionString, connectionConfig);
  // else just connect with each field from the form
  } else {
    if (sslOptions && dialect !== "mssql") {
      connectionConfig.dialectOptions.ssl = sslOptions;
    }

    sequelize = new Sequelize(name, username, password, connectionConfig);
  }

  await sequelize.authenticate();
  return sequelize;
};
