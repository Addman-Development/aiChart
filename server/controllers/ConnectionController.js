const mongoose = require("mongoose");
const Sequelize = require("sequelize");
const querystring = require("querystring");
const moment = require("moment");
const _ = require("lodash");
const fs = require("fs");
const { Queue } = require("bullmq");

const { ObjectId } = mongoose.Types;

const db = require("../models/models");
const ProjectController = require("./ProjectController");
const externalDbConnection = require("../modules/externalDbConnection");
const assembleMongoUrl = require("../modules/assembleMongoUrl");
const paginateRequests = require("../modules/paginateRequests");
const logger = require("../modules/logger").child({ module: "ConnectionController" });
const determineType = require("../modules/determineType");
const drCacheController = require("./DataRequestCacheController");
const { getQueueOptions } = require("../redisConnection");
const updateMongoSchema = require("../crons/workers/updateMongoSchema");
const { applyApiVariables } = require("../modules/applyVariables");

const getMomentObj = (timezone) => {
  if (timezone) {
    return (...args) => moment(...args).tz(timezone);
  } else {
    return (...args) => moment.utc(...args);
  }
};

async function _fetchRequest(options) {
  const fetchOptions = {
    method: options.method || "GET",
    headers: { ...options.headers },
  };

  let url = options.url;

  // Handle query string parameters
  if (options.qs) {
    const params = new URLSearchParams();
    Object.entries(options.qs).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        params.append(key, String(value));
      }
    });
    const qsString = params.toString();
    if (qsString) {
      url += (url.includes("?") ? "&" : "?") + qsString;
    }
  }

  // Handle basic auth
  if (options.auth) {
    const encoded = Buffer.from(`${options.auth.user}:${options.auth.pass}`).toString("base64");
    fetchOptions.headers.authorization = `Basic ${encoded}`;
  }

  // Handle body
  if (options.body) {
    fetchOptions.body = options.body;
  }

  // Handle json option (auto-parse request/response)
  if (options.json === true && fetchOptions.body && typeof fetchOptions.body === "object") {
    fetchOptions.body = JSON.stringify(fetchOptions.body);
    if (!fetchOptions.headers["Content-Type"] && !fetchOptions.headers["content-type"]) {
      fetchOptions.headers["Content-Type"] = "application/json";
    }
  }

  const response = await fetch(url, fetchOptions);
  const body = await response.text();

  if (options.resolveWithFullResponse) {
    return { statusCode: response.status, body, headers: response.headers };
  }

  if (options.json === true) {
    try {
      return JSON.parse(body);
    } catch (e) {
      return body;
    }
  }

  // When simple is not explicitly false, throw on non-2xx
  if (options.simple !== false && !response.ok) {
    const error = new Error(`${response.status} - ${body}`);
    error.statusCode = response.status;
    throw error;
  }

  return body;
}

async function checkAndGetCache(connection_id, dataRequest) {
  // check if there is a cache available and valid
  try {
    const drCache = await drCacheController.findLast(dataRequest.id);
    const cachedDataRequest = { ...drCache.dataRequest };
    cachedDataRequest.updatedAt = "";
    cachedDataRequest.createdAt = "";
    delete cachedDataRequest.Connection;

    const liveDataRequest = dataRequest.toJSON();
    liveDataRequest.updatedAt = "";
    liveDataRequest.createdAt = "";
    delete liveDataRequest.Connection;

    if (_.isEqual(cachedDataRequest, liveDataRequest) && drCache.connection_id === connection_id) {
      return {
        responseData: drCache.responseData,
        dataRequest: drCache.dataRequest,
      };
    }
  } catch (e) {
    return false;
  }

  return false;
}

function isArrayPresent(responseData) {
  let arrayFound = false;
  Object.keys(responseData).forEach((k1) => {
    if (determineType(responseData[k1]) === "array") {
      arrayFound = true;
    }

    if (!arrayFound && determineType(responseData[k1]) === "object") {
      Object.keys(responseData[k1]).forEach((k2) => {
        if (determineType(responseData[k1][k2]) === "array") {
          arrayFound = true;
        }

        if (!arrayFound && determineType(responseData[k1][k2]) === "object") {
          Object.keys(responseData[k1][k2]).forEach((k3) => {
            if (determineType(responseData[k1][k2][k3]) === "array") {
              arrayFound = true;
            }
          });
        }
      });
    }
  });

  return arrayFound;
}

// Recursively convert MongoDB ObjectId instances into hex string values
function stringifyMongoIds(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  const valueType = typeof value;
  if (valueType !== "object") return value;

  // Detect ObjectId from mongoose or native driver
  if ((value instanceof ObjectId) || (value && value._bsontype === "ObjectId")) {
    return typeof value.toHexString === "function" ? value.toHexString() : String(value);
  }

  // Avoid converting Date or Buffer-like values
  if (value instanceof Date || Buffer.isBuffer(value)) return value;

  // Prevent circular references
  if (seen.has(value)) return value;
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => stringifyMongoIds(item, seen));
  }

  const result = {};
  Object.keys(value).forEach((key) => {
    result[key] = stringifyMongoIds(value[key], seen);
  });
  return result;
}

class ConnectionController {
  constructor() {
    this.projectController = new ProjectController();
  }

  findAll() {
    return db.Connection.findAll({
      attributes: { exclude: ["dbName", "password", "username", "options", "port", "host", "sslCa", "sslCert", "sslKey"] },
      include: [{ model: db.OAuth, attributes: { exclude: ["refreshToken"] } }],
    })
      .then((connections) => {
        return Promise.resolve(connections);
      })
      .catch((error) => {
        return Promise.reject(error);
      });
  }

  findById(id) {
    return db.Connection.findByPk(id, {
      include: [{ model: db.OAuth, attributes: { exclude: ["refreshToken"] } }],
    })
      .then((connection) => {
        if (!connection) {
          return new Promise((resolve, reject) => reject(new Error(404)));
        }
        return connection;
      })
      .catch((error) => {
        return new Promise((resolve, reject) => reject(error));
      });
  }

  findByTeam(teamId) {
    return db.Connection.findAll({
      where: { team_id: teamId },
      attributes: { exclude: ["password", "schema"] },
      include: [{ model: db.OAuth, attributes: { exclude: ["refreshToken"] } }],
      order: [["createdAt", "DESC"]],
    })
      .then((connections) => {
        return connections;
      })
      .catch((error) => {
        return new Promise((resolve, reject) => reject(error));
      });
  }

  findByProject(projectId) {
    return db.Connection.findAll({
      where: { project_id: projectId },
      attributes: { exclude: ["password"] },
      include: [{ model: db.OAuth, attributes: { exclude: ["refreshToken"] } }],
    })
      .then((connections) => {
        return connections;
      })
      .catch((error) => {
        return new Promise((resolve, reject) => reject(error));
      });
  }

  findByProjects(teamId, projects) {
    return db.Connection.findAll({
      where: { team_id: teamId },
      attributes: { exclude: ["password"] },
      include: [{ model: db.OAuth, attributes: { exclude: ["refreshToken"] } }],
      order: [["createdAt", "DESC"]],
    })
      .then((connections) => {
        const filteredConnections = connections.filter((connection) => {
          if (!connection.project_ids) return false;
          return connection.project_ids.some((projectId) => {
            return projects.includes(projectId);
          });
        });

        return filteredConnections;
      })
      .catch((error) => {
        return new Promise((resolve, reject) => reject(error));
      });
  }

  async create(data) {
    const dataToSave = { ...data };

    if (!data.type) data.type = "mongodb"; // eslint-disable-line
    if (data.type === "postgres" || data.type === "mssql") {
      try {
        const testData = data.type === "mssql"
          ? await this.testMssql(data)
          : await this.testPostgres(data);
        dataToSave.schema = testData.schema;
      } catch (e) {
        //
      }
    }

    return db.Connection.create(dataToSave)
      .then((connection) => {
        if (connection.type === "mongodb") {
          // update the schema in the background
          this.addMongoSchemaUpdateJob(connection.id);
        }

        return connection;
      })
      .catch((error) => {
        return new Promise((resolve, reject) => reject(error));
      });
  }

  update(id, data) {
    return db.Connection.update(data, { where: { id } })
      .then(() => {
        return this.findById(id);
      })
      .catch((error) => {
        return new Promise((resolve, reject) => reject(error));
      });
  }

  getConnectionUrl(id) {
    return db.Connection.findByPk(id)
      .then((connection) => {
        if (!connection) {
          return new Promise((resolve, reject) => reject(new Error(404)));
        }

        if (connection.type === "mongodb") {
          return assembleMongoUrl(connection);
        } else {
          return new Promise((resolve, reject) => reject(new Error(400)));
        }
      })
      .catch((error) => {
        return new Promise((resolve, reject) => reject(error));
      });
  }

  async removeConnection(id, removeDatasets) {
    if (removeDatasets) {
      try {
        const drs = await db.DataRequest.findAll({ where: { connection_id: id } });
        const datasetIds = drs.map((dr) => dr.dataset_id);

        await db.DataRequest.destroy({ where: { connection_id: id } });
        await db.Dataset.destroy({ where: { id: datasetIds } });
      } catch (e) {
        //
      }
    }

    const connection = await this.findById(id);
    // remove certificates and keys if present
    try {
      if (connection.sslCa) {
        fs.unlink(connection.sslCa, () => {});
      }
      if (connection.sslCert) {
        fs.unlink(connection.sslCert, () => {});
      }
      if (connection.sslKey) {
        fs.unlink(connection.sslKey, () => {});
      }
      if (connection.sshPrivateKey) {
        fs.unlink(connection.sshPrivateKey, () => {});
      }
    } catch (e) {
      //
    }

    return db.Connection.destroy({ where: { id } })
      .then(() => {
        return true;
      })
      .catch((error) => {
        return new Promise((resolve, reject) => reject(error));
      });
  }

  getApiTestOptions(connection) {
    if (connection.type !== "api") return false;

    const testOptions = {
      url: connection.host,
      method: "GET",
      headers: {},
      resolveWithFullResponse: true,
    };

    let globalHeaders = connection.options;
    if (connection.getHeaders) {
      globalHeaders = connection.getHeaders(connection);
    } else if (connection.authentication && connection.authentication.type === "bearer_token") {
      testOptions.headers.authorization = `Bearer ${connection.authentication.token}`;
    }

    if (globalHeaders && globalHeaders.length > 0) {
      for (const option of connection.options) {
        testOptions.headers[Object.keys(option)[0]] = option[Object.keys(option)[0]];
      }
    }

    // Basic Auth
    if (connection.authentication && connection.authentication.type === "basic_auth") {
      testOptions.auth = {
        user: connection.authentication.user,
        pass: connection.authentication.pass,
      };
    }

    return testOptions;
  }

  testRequest(data, extras) {
    const certificates = {};
    if (extras?.files?.length > 0) {
      try {
        extras.files.forEach((file) => {
          // Handle SSL certificates
          if (file.fieldname === "sslCa" || file.fieldname === "sslCert" || file.fieldname === "sslKey") {
            certificates[file.fieldname] = file.path; // Use the temporary file path for testing
          }
          // Handle SSH private key
          if (file.fieldname === "sshPrivateKey") {
            certificates.sshPrivateKey = file.path;
          }
        });
      } catch (error) {
        return Promise.reject(new Error(`Error processing certificate files: ${error.message}`));
      }
    }

    let connectionParams = { ...data };

    if (Object.keys(certificates).length > 0) {
      connectionParams = { ...connectionParams, ...certificates };
    }

    if (data.type === "api") {
      return this.testApi(connectionParams);
    } else if (data.type === "mongodb") {
      return this.testMongo(connectionParams);
    } else if (data.type === "postgres") {
      return this.testPostgres(connectionParams);
    } else if (data.type === "mssql") {
      return this.testMssql(connectionParams);
    }

    return new Promise((resolve, reject) => reject(new Error("No request type specified")));
  }

  testApi(data) {
    const testOpt = this.getApiTestOptions(data);
    return _fetchRequest(testOpt);
  }

  testMongo(data) {
    const mongoString = assembleMongoUrl(data);

    const mongoConnection = mongoose.createConnection(mongoString);
    return mongoConnection.asPromise()
      .then((connection) => {
        return connection.db.listCollections().toArray();
      })
      .then((collections) => {
        // Close the connection
        mongoConnection.close();

        return Promise.resolve({
          success: true,
          collections
        });
      })
      .catch((err) => {
        // Close the connection
        mongoConnection.close();

        return Promise.reject(err.message || err);
      });
  }

  async getSchema(dbConnection) {
    const dialect = dbConnection.getDialect();

    // For MSSQL, use a single INFORMATION_SCHEMA query instead of N+1 describeTable calls
    if (dialect === "mssql") {
      return this._getMssqlSchema(dbConnection);
    }

    const tables = await dbConnection.getQueryInterface().showAllTables();
    const schemaPromises = tables.map((table) => {
      return dbConnection.getQueryInterface().describeTable(table)
        .then((description) => ({ table, description }));
    });

    const schemas = await Promise.all(schemaPromises);
    const schema = schemas.reduce((acc, { table, description }) => {
      acc[table] = description;
      return acc;
    }, {});

    // Format schema: include column names with their types for better AI date-column detection
    // Format: { tableName: { colName: "TYPE", ... } }
    let formattedSchema = {};
    if (schema) {
      try {
        Object.keys(schema).forEach((tableName) => {
          const columns = schema[tableName];
          if (columns && typeof columns === "object") {
            formattedSchema[tableName] = {};
            Object.keys(columns).forEach((colName) => {
              formattedSchema[tableName][colName] = columns[colName]?.type || "UNKNOWN";
            });
          }
        });
      } catch (e) {
        // Fallback to column-names-only if type extraction fails
        formattedSchema = {};
        Object.keys(schema).forEach((tableName) => {
          formattedSchema[tableName] = Object.keys(schema[tableName] || {});
        });
      }
    }

    return {
      tables,
      description: formattedSchema,
    };
  }

  async _getMssqlSchema(dbConnection) {
    let results;

    try {
      // Try filtering out empty tables using sys.dm_db_partition_stats
      // Include DATA_TYPE for date-column detection
      results = await dbConnection.query(
        `SELECT c.TABLE_SCHEMA, c.TABLE_NAME, c.COLUMN_NAME, c.DATA_TYPE
         FROM INFORMATION_SCHEMA.COLUMNS c
         INNER JOIN (
           SELECT s.name AS TABLE_SCHEMA, t.name AS TABLE_NAME
           FROM sys.tables t
           INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
           INNER JOIN sys.dm_db_partition_stats ps
             ON t.object_id = ps.object_id AND ps.index_id IN (0, 1)
           GROUP BY s.name, t.name
           HAVING SUM(ps.row_count) > 0
         ) populated ON c.TABLE_SCHEMA = populated.TABLE_SCHEMA
                     AND c.TABLE_NAME = populated.TABLE_NAME
         ORDER BY c.TABLE_SCHEMA, c.TABLE_NAME, c.ORDINAL_POSITION`,
        { type: Sequelize.QueryTypes.SELECT }
      );
    } catch (err) {
      logger.warn(
        { err },
        "_getMssqlSchema filtered query failed, falling back to INFORMATION_SCHEMA only"
      );
      // Fallback: just use INFORMATION_SCHEMA (no empty-table filtering)
      results = await dbConnection.query(
        `SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_NAME NOT LIKE 'sys%'
         ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION`,
        { type: Sequelize.QueryTypes.SELECT }
      );
    }

    const tables = [];
    const formattedSchema = {};
    const seen = new Set();

    for (const row of results) {
      const fullName = `${row.TABLE_SCHEMA}.${row.TABLE_NAME}`;
      if (!seen.has(fullName)) {
        seen.add(fullName);
        tables.push(fullName);
        formattedSchema[fullName] = {};
      }
      formattedSchema[fullName][row.COLUMN_NAME] = row.DATA_TYPE || "UNKNOWN";
    }

    return {
      tables,
      description: formattedSchema,
    };
  }

  async testPostgres(data) {
    let sqlDb;
    try {
      sqlDb = await externalDbConnection(data);
      const schema = await this.getSchema(sqlDb);

      return Promise.resolve({
        success: true,
        schema
      });
    } catch (err) {
      return Promise.reject(err.message || err);
    } finally {
      // Close SSH tunnel if it exists
      if (sqlDb && sqlDb.sshTunnel) {
        sqlDb.sshTunnel.close();
      }
    }
  }

  async testMssql(data) {
    let sqlDb;
    try {
      sqlDb = await externalDbConnection(data);
      const schema = await this.getSchema(sqlDb);

      return { success: true, schema };
    } catch (err) {
      logger.error(
        { err, original: err.original?.message },
        "testMssql failed"
      );
      throw new Error(err.message || err);
    } finally {
      if (sqlDb) {
        try { await sqlDb.close(); } catch (e) { /* ignore */ }
      }
    }
  }

  testConnection(id) {
    let gConnection;
    let mongoConnection;
    return db.Connection.findByPk(id)
      .then((connection) => {
        gConnection = connection;
        switch (connection.type) {
          case "mongodb":
            return this.getConnectionUrl(id);
          case "api":
            return _fetchRequest(this.getApiTestOptions(connection));
          case "postgres":
          case "mssql":
            return externalDbConnection(connection);
          default:
            return new Promise((resolve, reject) => reject(new Error(400)));
        }
      })
      .then((response) => {
        switch (gConnection.type) {
          case "mongodb": {
            mongoConnection = mongoose.createConnection(response);
            return mongoConnection.asPromise();
          }
          case "api":
            if (response.statusCode < 300) {
              return new Promise((resolve) => resolve({ success: true }));
            }
            return new Promise((resolve, reject) => reject(new Error(400)));
          case "postgres":
          case "mssql":
            return new Promise((resolve) => resolve({ success: true }));
          default:
            return new Promise((resolve, reject) => reject(new Error(400)));
        }
      })
      .then(() => {
        // close the mongodb connection if it exists
        if (mongoConnection) {
          mongoConnection.close();
        }

        return new Promise((resolve) => resolve({ success: true }));
      })
      .catch((err) => {
        // close the mongodb connection if it exists
        if (mongoConnection) {
          mongoConnection.close();
        }

        return new Promise((resolve, reject) => reject(err));
      });
  }

  testApiRequest({
    connection_id, dataRequest, itemsLimit, items, offset, pagination, paginationField,
  }) {
    const limit = itemsLimit
      ? parseInt(itemsLimit, 10) : 0;
    return this.findById(connection_id)
      .then((connection) => {
        const tempUrl = `${connection.getApiUrl(connection)}${dataRequest.route || ""}`;
        const queryParams = querystring.parse(tempUrl.split("?")[1]);

        let url = tempUrl;
        if (url.indexOf("?") > -1) {
          url = tempUrl.substring(0, tempUrl.indexOf("?"));
        }

        const options = {
          url,
          method: dataRequest.method || "GET",
          headers: {},
          qs: queryParams,
          resolveWithFullResponse: true,
          simple: false,
        };

        // prepare the headers
        let headers = {};
        if (dataRequest.useGlobalHeaders) {
          const globalHeaders = connection.getHeaders(connection);
          for (const opt of globalHeaders) {
            headers = Object.assign(opt, headers);
          }

          if (dataRequest.headers) {
            headers = Object.assign(dataRequest.headers, headers);
          }
        }

        options.headers = headers;

        if (dataRequest.body && dataRequest.method !== "GET") {
          options.body = dataRequest.body;
          options.headers["Content-Type"] = "application/json";
        }

        if (pagination) {
          if ((options.url.indexOf(`?${items}=`) || options.url.indexOf(`&${items}=`))
            && (options.url.indexOf(`?${offset}=`) || options.url.indexOf(`&${offset}=`))
          ) {
            return paginateRequests(dataRequest.template, {
              options,
              limit,
              items,
              offset,
              paginationField,
            });
          }
        }

        return _fetchRequest(options);
      })
      .then((response) => {
        if (pagination) {
          return new Promise((resolve) => resolve(response));
        }

        if (response.statusCode < 300) {
          try {
            return new Promise((resolve) => resolve(JSON.parse(response.body)));
          } catch (e) {
            return new Promise((resolve, reject) => reject(400));
          }
        } else {
          return new Promise((resolve, reject) => reject(response.statusCode));
        }
      })
      .catch((error) => {
        return new Promise((resolve, reject) => reject(error));
      });
  }

  async runMongo(id, dataRequest, getCache, queryOverride = null) {
    if (getCache) {
      const drCache = await checkAndGetCache(id, dataRequest);
      if (drCache) return drCache;
    }

    let mongoConnection;

    // Use the processed query if provided, otherwise use the original query
    const formattedQuery = (() => {
      let q = queryOverride || dataRequest.query;
      if (!q) return null;
      // formatting required since introducing the multiple mongo connection support
      if (q.indexOf("connection.") === 0) {
        q = q.replace("connection.", "");
      }
      return q;
    })();

    if (!formattedQuery) {
      throw new Error("No query provided");
    }

    try {
      const url = await this.getConnectionUrl(id);
      mongoConnection = mongoose.createConnection(url, { connectTimeoutMS: 100000 });
      await mongoConnection.asPromise();

      // Build the query function - try with .toArray() first, then without
      let data;
      try {
        data = await Function(`'use strict';return (mongoConnection, ObjectId) => mongoConnection.${formattedQuery}.toArray()`)()(mongoConnection, ObjectId); // eslint-disable-line
      } catch (toArrayErr) {
        try {
          data = await Function(`'use strict';return (mongoConnection, ObjectId) => mongoConnection.${formattedQuery}`)()(mongoConnection, ObjectId); // eslint-disable-line
        } catch (queryErr) {
          throw new Error(`Invalid MongoDB query: ${queryErr.message}`);
        }
      }

      let finalData = data;
      if (data && typeof data?.next === "function") {
        finalData = await data.toArray();
      }
      // MongoDB returns a plain number when count() is used, transform this into an object
      if (formattedQuery.indexOf("count(") > -1) {
        finalData = { count: data };
      }
      // Ensure ObjectId instances are returned as strings for UI rendering
      finalData = stringifyMongoIds(finalData);
      // cache the data for later use - use ORIGINAL dataRequest to preserve variable placeholders
      const dataToCache = {
        dataRequest,
        responseData: {
          data: finalData,
        },
        connection_id: id,
      };

      await drCacheController.create(dataRequest.id, dataToCache);

      // Trigger schema update in the background
      try {
        this.addMongoSchemaUpdateJob(id);
      } catch (error) {
        // do nothing
      }

      return dataToCache;
    } catch (error) {
      logger.error(
        { err: error, connectionId: id, query: formattedQuery },
        "runMongo failed"
      );
      throw error;
    } finally {
      if (mongoConnection) {
        try {
          mongoConnection.close();
        } catch (closeErr) {
          // ignore close errors
        }
      }
    }
  }

  async runPostgres(id, dataRequest, getCache, queryOverride = null) {
    if (getCache) {
      const drCache = await checkAndGetCache(id, dataRequest);
      if (drCache) return drCache;
    }

    let dbConnection = null;

    try {
      const connection = await this.findById(id);
      dbConnection = await externalDbConnection(connection);

      // Update schema in the background
      this.getSchema(dbConnection)
        .then((schema) => {
          db.Connection.update({ schema }, { where: { id } });
        });

      // Use the processed query if provided, otherwise use the original query
      const queryToExecute = queryOverride || dataRequest.query;
      const results = await dbConnection
        .query(queryToExecute, { type: Sequelize.QueryTypes.SELECT });

      // cache the data for later use - use ORIGINAL dataRequest to preserve variable placeholders
      const dataToCache = {
        dataRequest,
        responseData: {
          data: results,
        },
        connection_id: id,
      };

      await drCacheController.create(dataRequest.id, dataToCache);

      return dataToCache;
    } catch (error) {
      return Promise.reject(error);
    } finally {
      // Close SSH tunnel if it exists
      if (dbConnection && dbConnection.sshTunnel) {
        dbConnection.sshTunnel.close();
      }
    }
  }

  async runMssql(id, dataRequest, getCache, queryOverride = null) {
    if (getCache) {
      const drCache = await checkAndGetCache(id, dataRequest);
      if (drCache) return drCache;
    }

    const queryToExecute = queryOverride || dataRequest.query;
    if (!queryToExecute) {
      throw new Error("No query provided");
    }

    let dbConnection = null;

    try {
      const connection = await this.findById(id);
      dbConnection = await externalDbConnection(connection);

      // Update schema in the background
      this.getSchema(dbConnection)
        .then((schema) => {
          db.Connection.update({ schema }, { where: { id } });
        })
        .catch(() => {});

      const results = await dbConnection
        .query(queryToExecute, { type: Sequelize.QueryTypes.SELECT });

      // cache the data for later use - use ORIGINAL dataRequest to preserve variable placeholders
      const dataToCache = {
        dataRequest,
        responseData: {
          data: results,
        },
        connection_id: id,
      };

      await drCacheController.create(dataRequest.id, dataToCache);

      return dataToCache;
    } catch (error) {
      throw error;
    } finally {
      if (dbConnection) {
        try { await dbConnection.close(); } catch (e) { /* ignore */ }
      }
    }
  }

  async runApiRequest(id, chartId, dataRequest, getCache, filters, timezone = "", runtimeVariables = {}) {
    if (getCache) {
      const drCache = await checkAndGetCache(id, dataRequest);
      if (drCache) return drCache;
    }

    const limit = dataRequest.itemsLimit
      ? parseInt(dataRequest.itemsLimit, 10) : 0;
    const { variables } = dataRequest;

    return this.findById(id)
      .then(async (connection) => {
        // Apply variable substitution for API requests
        let processedRoute = dataRequest.route || "";
        let processedHeaders = dataRequest.headers || {};
        let processedBody = dataRequest.body || "";

        try {
          const result = applyApiVariables(dataRequest, runtimeVariables);
          processedRoute = result.processedRoute || processedRoute;
          processedHeaders = result.processedHeaders || processedHeaders;
          processedBody = result.processedBody || processedBody;
        } catch (error) {
          // If there's an error in variable processing, return it
          return Promise.reject(error);
        }

        let tempUrl = connection.getApiUrl(connection);
        let route = processedRoute;
        if (route && (route[0] !== "/" && route[0] !== "?")) {
          route = `/${route}`;
        }

        tempUrl += route;

        const queryParams = querystring.parse(tempUrl.split("?")[1]);

        // if any queryParams has variables, modify them here
        if (queryParams && Object.keys(queryParams).length > 0) {
          // First, process generic variables (excluding start_date and end_date)
          if (dataRequest.VariableBindings && dataRequest.VariableBindings.length > 0) {
            // Process each query parameter for variables
            for (const q of Object.keys(queryParams)) {
              const paramValue = queryParams[q];
              if (typeof paramValue === "string") {
                let processedValue = paramValue;

                // Find all variables in this parameter value
                const variableMatches = [...paramValue.matchAll(/\{\{([^}]+)\}\}/g)];

                for (const match of variableMatches) {
                  const variableName = match[1].trim();

                  // Skip reserved date variables - they're handled separately below
                  if (variableName === "start_date" || variableName === "end_date") {
                    // eslint-disable-next-line no-continue
                    continue;
                  }

                  const binding = dataRequest.VariableBindings
                    .find((vb) => vb.name === variableName);

                  // Check for runtime variable value first
                  const runtimeValue = runtimeVariables[variableName];
                  const hasRuntimeValue = runtimeValue !== null
                    && runtimeValue !== undefined && runtimeValue !== "";

                  // Check for default value
                  const hasDefaultValue = binding?.default_value !== null
                    && binding?.default_value !== undefined
                    && binding?.default_value !== "";

                  if (hasRuntimeValue) {
                    // Priority 1: Use runtime value
                    let replacementValue = runtimeValue;

                    // Handle different data types based on binding type (if available)
                    if (binding?.type) {
                      switch (binding.type) {
                        case "string":
                          replacementValue = String(runtimeValue);
                          break;
                        case "number":
                          replacementValue = Number.isNaN(Number(runtimeValue))
                            ? "0" : String(runtimeValue);
                          break;
                        case "boolean":
                          replacementValue = (runtimeValue === "true" || runtimeValue === true)
                            ? "true" : "false";
                          break;
                        case "date":
                          replacementValue = String(runtimeValue);
                          break;
                        default:
                          replacementValue = String(runtimeValue);
                      }
                    } else {
                      // No binding type info, treat as string
                      replacementValue = String(runtimeValue);
                    }

                    processedValue = processedValue.replace(match[0], replacementValue);
                  } else if (hasDefaultValue && binding) {
                    // Priority 2: Use default value
                    let replacementValue = binding.default_value;

                    if (binding.type) {
                      switch (binding.type) {
                        case "string":
                          replacementValue = String(binding.default_value);
                          break;
                        case "number":
                          replacementValue = Number.isNaN(Number(binding.default_value))
                            ? "0" : String(binding.default_value);
                          break;
                        case "boolean":
                          replacementValue = binding.default_value === "true"
                            || binding.default_value === true ? "true" : "false";
                          break;
                        case "date":
                          replacementValue = String(binding.default_value);
                          break;
                        default:
                          replacementValue = String(binding.default_value);
                      }
                    } else {
                      replacementValue = String(binding.default_value);
                    }

                    processedValue = processedValue.replace(match[0], replacementValue);
                  } else {
                    // Priority 3: No runtime value and no default value
                    if (binding?.required) {
                      // Required variable without value - throw error
                      const errorMsg = `Required variable '${variableName}' has no value provided and no default value`;
                      throw new Error(errorMsg);
                    }

                    // Not required and no value - remove the placeholder
                    processedValue = processedValue.replace(match[0], "");
                  }
                }

                // Update the query parameter with processed value
                queryParams[q] = processedValue;
              }
            }
          }

          // Now handle special date variables
          // first, check for the keys to avoid making an unnecessary query to the DB
          const keysFound = {};
          Object.keys(queryParams).forEach((q) => {
            const paramValue = queryParams[q];
            // Check for exact matches
            if (paramValue === "{{start_date}}") {
              keysFound[q] = { type: "startDate", format: "single" };
            } else if (paramValue === "{{end_date}}") {
              keysFound[q] = { type: "endDate", format: "single" };
            } else if (typeof paramValue === "string") {
              // Check for combined variables using regex
              const startDateMatch = paramValue.match(/{{start_date}}/);
              const endDateMatch = paramValue.match(/{{end_date}}/);
              if (startDateMatch || endDateMatch) {
                keysFound[q] = {
                  type: "combined",
                  hasStartDate: !!startDateMatch,
                  hasEndDate: !!endDateMatch,
                  originalValue: paramValue
                };
              }
            }
          });

          // something was found, go through all and replace the date variables
          if (Object.keys(keysFound).length > 0) {
            const chart = await db.Chart.findByPk(chartId);
            if (chart?.startDate && chart?.endDate) {
              Object.keys(keysFound).forEach((q) => {
                const value = keysFound[q];
                let startDate = getMomentObj(timezone)(chart.startDate);
                let endDate = getMomentObj(timezone)(chart.endDate);

                if (value.type === "startDate" && chart.currentEndDate) {
                  const timeDiff = endDate.diff(startDate, chart.timeInterval);
                  endDate = getMomentObj(timezone)().endOf(chart.timeInterval);
                  if (!chart.fixedStartDate) {
                    startDate = endDate.clone()
                      .subtract(timeDiff, chart.timeInterval)
                      .startOf(chart.timeInterval);
                  }
                } else if (value.type === "endDate" && chart.currentEndDate) {
                  const timeDiff = endDate.diff(startDate, chart.timeInterval);
                  endDate = getMomentObj(timezone)().endOf(chart.timeInterval);
                  if (!chart.fixedStartDate) {
                    startDate = endDate.clone()
                      .subtract(timeDiff, chart.timeInterval)
                      .startOf(chart.timeInterval);
                  }
                }

                if (filters && filters.length > 0) {
                  const dateRangeFilter = filters.find((o) => o.type === "date");
                  if (dateRangeFilter) {
                    startDate = getMomentObj(timezone)(dateRangeFilter.startDate).startOf("day");
                    endDate = getMomentObj(timezone)(dateRangeFilter.endDate);
                  }
                }

                if (value.format === "single") {
                  if (value.type === "startDate" && startDate) {
                    queryParams[q] = startDate.format(chart.dateVarsFormat || "");
                  } else if (value.type === "endDate" && endDate) {
                    queryParams[q] = endDate.format(chart.dateVarsFormat || "");
                  }
                } else if (value.type === "combined") {
                  let formattedValue = value.originalValue;
                  if (value.hasStartDate && startDate) {
                    formattedValue = formattedValue.replace(/{{start_date}}/g, startDate.format(chart.dateVarsFormat || ""));
                  }
                  if (value.hasEndDate && endDate) {
                    formattedValue = formattedValue.replace(/{{end_date}}/g, endDate.format(chart.dateVarsFormat || ""));
                  }
                  queryParams[q] = formattedValue;
                }
              });
            } else if (variables?.startDate?.value && variables?.endDate?.value) {
              Object.keys(keysFound).forEach((q) => {
                const value = keysFound[q];
                const startDate = getMomentObj(timezone)(variables.startDate.value);
                const endDate = getMomentObj(timezone)(variables.endDate.value);

                if (value.format === "single") {
                  if (value.type === "startDate" && startDate) {
                    queryParams[q] = startDate.format(variables.dateFormat?.value || "");
                  } else if (value.type === "endDate" && endDate) {
                    queryParams[q] = endDate.format(variables.dateFormat?.value || "");
                  }
                } else if (value.type === "combined") {
                  let formattedValue = value.originalValue;
                  if (value.hasStartDate && startDate) {
                    formattedValue = formattedValue.replace(/{{start_date}}/g, startDate.format(variables.dateFormat?.value || ""));
                  }
                  if (value.hasEndDate && endDate) {
                    formattedValue = formattedValue.replace(/{{end_date}}/g, endDate.format(variables.dateFormat?.value || ""));
                  }
                  queryParams[q] = formattedValue;
                }
              });
            }
          }
        }

        let url = tempUrl;
        if (url.indexOf("?") > -1) {
          url = tempUrl.substring(0, tempUrl.indexOf("?"));
        }

        // if ant variable queryParams are left, remove them
        if (queryParams && Object.keys(queryParams).length > 0) {
          Object.keys(queryParams).forEach((q) => {
            if (queryParams[q] === "{{start_date}}" || queryParams[q] === "{{end_date}}") {
              delete queryParams[q];
            }
          });
        }

        const options = {
          url,
          method: dataRequest.method || "GET",
          headers: {},
          qs: queryParams,
          resolveWithFullResponse: true,
          simple: false,
        };

        // prepare the headers
        let headers = {};
        if (dataRequest.useGlobalHeaders) {
          const globalHeaders = connection.getHeaders(connection);
          for (const opt of globalHeaders) {
            headers = Object.assign(opt, headers);
          }

          if (processedHeaders) {
            headers = Object.assign(processedHeaders, headers);
          }
        }

        options.headers = headers;

        if (processedBody && dataRequest.method !== "GET") {
          options.body = processedBody;
          options.headers["Content-Type"] = "application/json";
        }

        // Basic auth
        if (connection.authentication && connection.authentication.type === "basic_auth") {
          options.auth = {
            user: connection.authentication.user,
            pass: connection.authentication.pass,
          };
        }

        if (dataRequest.pagination) {
          if ((options.url.indexOf(`?${dataRequest.items}=`) || options.url.indexOf(`&${dataRequest.items}=`))
            && (options.url.indexOf(`?${dataRequest.offset}=`) || options.url.indexOf(`&${dataRequest.offset}=`))
          ) {
            return paginateRequests(dataRequest.template, {
              options,
              limit,
              items: dataRequest.items,
              offset: dataRequest.offset,
              paginationField: dataRequest.paginationField,
            });
          }
        }

        return _fetchRequest(options);
      })
      .then(async (response) => {
        if (dataRequest.pagination) {
          // cache the data for later use
          const dataToCache = {
            dataRequest,
            responseData: {
              data: response,
            },
            connection_id: id,
          };

          await drCacheController.create(dataRequest.id, dataToCache);

          return new Promise((resolve) => resolve(dataToCache));
        }

        if (response.statusCode < 300) {
          try {
            let responseData = JSON.parse(response.body);

            // check if there are arrays to take into account
            // transform the data in 1-item array if that's the case
            // check for arrays in 3 levels
            if (determineType(responseData) === "object" && !isArrayPresent(responseData)) {
              responseData = [responseData];
            }

            // cache the data for later use
            const dataToCache = {
              dataRequest,
              responseData: {
                data: responseData,
              },
              connection_id: id,
            };

            await drCacheController.create(dataRequest.id, dataToCache);

            return new Promise((resolve) => resolve(dataToCache));
          } catch (e) {
            return new Promise((resolve, reject) => reject(400));
          }
        } else {
          return new Promise((resolve, reject) => reject(response.statusCode));
        }
      })
      .catch((error) => {
        return new Promise((resolve, reject) => reject(error));
      });
  }



  async duplicateConnection(connectionId, name) {
    const connection = await db.Connection.findByPk(connectionId);
    const connectionToSave = connection.toJSON();
    delete connectionToSave.id;
    delete connectionToSave.createdAt;
    delete connectionToSave.updatedAt;

    if (name) {
      connectionToSave.name = name;
    }

    const newConnection = await db.Connection.create(connectionToSave);
    return newConnection;
  }

  async importConnections(connectionIds, sourceTeamId, targetTeamId) {
    // Verify all requested connections belong to the source team
    const connections = await db.Connection.findAll({
      where: {
        id: connectionIds,
        team_id: sourceTeamId,
      },
    });

    if (connections.length === 0) {
      return Promise.reject(new Error("No valid connections found in the source team"));
    }

    const imported = [];
    for (const connection of connections) {
      const data = connection.toJSON();
      delete data.id;
      delete data.createdAt;
      delete data.updatedAt;
      data.team_id = targetTeamId;
      data.project_ids = [];

      const newConnection = await db.Connection.create(data);
      imported.push(newConnection);
    }

    return imported;
  }

  async addMongoSchemaUpdateJob(connectionId) {
    try {
      const connection = await this.findById(connectionId);

      if (!connection) {
        return Promise.reject(new Error("Connection not found"));
      }

      if (connection.type !== "mongodb") {
        return Promise.reject(new Error("Connection is not a MongoDB connection"));
      }

      // Get the queue from the global scope
      const queue = new Queue("updateMongoDBSchemaQueue", getQueueOptions());

      // Add a job to update the schema
      const job = await queue.add(`update-mongo-schema-${connectionId}`, { connection_id: connectionId }, {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 5000,
        },
        removeOnComplete: true,
        removeOnFail: 100,
      });

      // Wait for job to complete
      const result = await job.waitUntilFinished(queue);

      return result;
    } catch (error) {
      return Promise.reject(error);
    }
  }

  async updateMongoSchema(connectionId) {
    await updateMongoSchema({
      data: {
        connection_id: connectionId,
      },
    });

    return this.findById(connectionId);
  }
}

module.exports = ConnectionController;
