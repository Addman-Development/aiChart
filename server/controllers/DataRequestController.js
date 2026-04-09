const Sequelize = require("sequelize");

const ConnectionController = require("./ConnectionController");
const drCacheController = require("./DataRequestCacheController");
const db = require("../models/models");
const { generateSqlQuery } = require("../modules/ai/generateSqlQuery");
const { generateMongoQuery } = require("../modules/ai/generateMongoQuery");
const { aiClient, aiModel } = require("../modules/ai/aiClient");
const externalDbConnection = require("../modules/externalDbConnection");
const moment = require("moment");
const { applyTransformation } = require("../modules/dataTransformations");
const { applyVariables } = require("../modules/applyVariables");

class RequestController {
  constructor() {
    this.connectionController = new ConnectionController();
  }

  create(data) {
    return db.DataRequest.create(data)
      .then((dataRequest) => {
        return this.findById(dataRequest.id);
      })
      .catch((error) => {
        return new Promise((resolve, reject) => reject(error));
      });
  }

  findById(id) {
    return db.DataRequest.findOne({
      where: { id },
      include: [
        { model: db.Connection, attributes: ["id", "name", "type", "subType", "host"] },
        {
          model: db.VariableBinding,
          on: Sequelize.and(
            { "$VariableBindings.entity_type$": "DataRequest" },
            Sequelize.where(
              Sequelize.cast(Sequelize.col("VariableBindings.entity_id"), "INTEGER"),
              Sequelize.col("DataRequest.id")
            )
          ),
          required: false
        }
      ],
    })
      .then((dataRequest) => {
        if (!dataRequest) {
          return new Promise((resolve, reject) => reject(new Error(404)));
        }
        return new Promise((resolve) => resolve(dataRequest));
      })
      .catch((error) => {
        return new Promise((resolve, reject) => reject(error));
      });
  }

  findByChart(chartId) {
    return db.DataRequest.findOne({
      where: { chart_id: chartId },
      include: [
        { model: db.Connection, attributes: ["id", "name", "type", "subType", "host"] },
        {
          model: db.VariableBinding,
          on: Sequelize.and(
            { "$VariableBindings.entity_type$": "DataRequest" },
            Sequelize.where(
              Sequelize.cast(Sequelize.col("VariableBindings.entity_id"), "INTEGER"),
              Sequelize.col("DataRequest.id")
            )
          ),
          required: false
        }
      ]
    })
      .then((dataRequest) => {
        if (!dataRequest) {
          return new Promise((resolve, reject) => reject(new Error(404)));
        }
        return new Promise((resolve) => resolve(dataRequest));
      })
      .catch((error) => {
        return new Promise((resolve, reject) => reject(error));
      });
  }

  findByDataset(datasetId) {
    return db.DataRequest.findAll({
      where: { dataset_id: datasetId },
      include: [
        { model: db.Connection, attributes: ["id", "name", "type", "subType", "host"] },
        {
          model: db.VariableBinding,
          on: Sequelize.and(
            { "$VariableBindings.entity_type$": "DataRequest" },
            Sequelize.where(
              Sequelize.cast(Sequelize.col("VariableBindings.entity_id"), "INTEGER"),
              Sequelize.col("DataRequest.id")
            )
          ),
          required: false
        }
      ]
    })
      .then((dataRequests) => {
        if (!dataRequests || dataRequests.length === 0) {
          return new Promise((resolve, reject) => reject(new Error(404)));
        }
        return Promise.resolve(dataRequests);
      })
      .catch((error) => {
        return Promise.reject(error);
      });
  }

  update(id, data) {
    return db.DataRequest.update(data, {
      where: { id },
    })
      .then(() => {
        return this.findById(id);
      })
      .catch((error) => {
        return new Promise((resolve, reject) => reject(error));
      });
  }

  sendRequest(chartId) {
    let gDataRequest;
    return this.findByChart(chartId)
      .then((dataRequest) => {
        if (!dataRequest) return new Promise((resolve, reject) => reject(new Error(404)));
        gDataRequest = JSON.parse(JSON.stringify(dataRequest));

        return db.Chart.findByPk(chartId);
      })
      .then((chart) => {
        const jsChart = chart.get({ plain: true });
        return this.connectionController.testApiRequest({ ...jsChart, dataRequest: gDataRequest });
      })
      .catch((error) => {
        return new Promise((resolve, reject) => reject(error));
      });
  }

  runRequest({
    id, chartId, noSource, getCache, variables = {},
  }) {
    let gDataset;
    let dataRequest;
    return this.findById(id)
      .then((dr) => {
        dataRequest = dr;
        return db.Dataset.findOne({ where: { id: dataRequest.dataset_id } });
      })
      .then((dataset) => {
        gDataset = dataset;

        // Inject fallback start_date/end_date (last 7 days) when the query
        // uses these variables but no values were provided by the caller
        const runtimeVars = { ...variables };
        if (dataRequest.query && dataRequest.query.includes("{{start_date}}") && !runtimeVars.start_date) {
          runtimeVars.start_date = moment().subtract(7, "days").startOf("day").toISOString();
        }
        if (dataRequest.query && dataRequest.query.includes("{{end_date}}") && !runtimeVars.end_date) {
          runtimeVars.end_date = moment().endOf("day").toISOString();
        }

        const {
          dataRequest: originalDataRequest,
          processedQuery,
        } = applyVariables(dataRequest, runtimeVars);

        // go through all data requests
        const connection = originalDataRequest.Connection;

        if (!originalDataRequest || (originalDataRequest && originalDataRequest.length === 0)) {
          return new Promise((resolve, reject) => reject(new Error("404")));
        }

        if (!connection) {
          return new Promise((resolve, reject) => reject(new Error("404")));
        }

        if (noSource === true) {
          return new Promise((resolve) => resolve({}));
        }

        if (connection.type === "mongodb") {
          return this.connectionController.runMongo(
            connection.id,
            originalDataRequest,
            getCache,
            processedQuery
          );
        } else if (connection.type === "api") {
          return this.connectionController.runApiRequest(
            connection.id, chartId, originalDataRequest, getCache, [], "", variables,
          );
        } else if (connection.type === "postgres") {
          return this.connectionController.runPostgres(
            connection.id, originalDataRequest, getCache, processedQuery,
          );
        } else if (connection.type === "mssql") {
          return this.connectionController.runMssql(
            connection.id, originalDataRequest, getCache, processedQuery,
          );
        } else {
          return new Promise((resolve, reject) => reject(new Error("Invalid connection type")));
        }
      })
      .then(async (response) => {
        const processedRequest = response;
        if (response?.dataRequest?.Connection.type === "mongodb") {
          processedRequest.responseData = JSON.parse(
            JSON.stringify(processedRequest.responseData)
          );
        }

        // Apply transformation if enabled
        if (processedRequest.dataRequest.transform
          && processedRequest.dataRequest.transform.enabled
        ) {
          processedRequest.responseData.data = applyTransformation(
            processedRequest?.responseData?.data,
            processedRequest.dataRequest.transform
          );
        }

        return Promise.resolve({
          options: gDataset,
          dataRequest: processedRequest,
        });
      })
      .catch((err) => {
        return Promise.reject(err);
      });
  }

  delete(id) {
    return db.DataRequest.destroy({
      where: { id },
    })
      .then(() => {
        return new Promise((resolve) => resolve({ deleted: true }));
      })
      .catch((error) => {
        return new Promise((resolve, reject) => reject(error));
      });
  }

  async completeQuery(id, currentQuery, cursorPosition) {
    const dataRequest = await this.findById(id);
    const connection = await db.Connection.findByPk(dataRequest.Connection.id);
    let schema = connection?.schema;

    if (!schema) {
      if (connection.type === "mongodb") {
        const updatedConnection = await this.connectionController
          .updateMongoSchema(connection.id);
        schema = updatedConnection?.schema;
      } else if (connection.type === "postgres" || connection.type === "mssql") {
        const dbConnection = await externalDbConnection(connection);
        schema = await this.connectionController.getSchema(dbConnection);
      }
    }

    if (!schema) {
      return { completion: "" };
    }

    const dialect = connection.type === "mongodb" ? "MongoDB" : "SQL";
    const formattedSchema = typeof schema === "string" ? schema : JSON.stringify(schema);

    const prompt = `You are an inline code completion engine for ${dialect} queries. Given the current query and cursor position, predict what the user is likely to type next.

Database Schema:
${formattedSchema}

RULES:
- Output ONLY the completion text (the code to insert at the cursor). Nothing else.
- Do NOT repeat any code that already exists before the cursor.
- Keep suggestions short — typically one line or a partial clause.
- If the cursor is at the end of a complete query with no obvious next token, return an empty string.
- Do NOT output explanations, markdown, or code fences.
- For ${dialect === "MongoDB" ? "MongoDB, suggest collection methods, aggregation stages, field names from the schema" : "SQL, suggest clauses (SELECT, FROM, WHERE, JOIN, GROUP BY, ORDER BY), column names, table names from the schema"}.`;

    const response = await aiClient.chat.completions.create({
      model: aiModel,
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: `Current query (cursor marked with |):\n${currentQuery.slice(0, cursorPosition)}|${currentQuery.slice(cursorPosition)}` },
      ],
      max_tokens: 150,
      temperature: 0.2,
    });

    const completion = response.choices?.[0]?.message?.content?.trim() || "";
    // Strip any markdown fences that might slip through
    const cleaned = completion.replace(/^```\w*\n?/, "").replace(/\n?```$/, "").trim();
    return { completion: cleaned };
  }

  askAi(id, question, conversationHistory, currentQuery) {
    return this.findById(id)
      .then(async (dataRequest) => {
        const connection = await db.Connection.findByPk(dataRequest.Connection.id);
        let schema = connection?.schema;
        if (!schema) {
          if (connection.type === "mongodb") {
            const updatedConnection = await this.connectionController
              .updateMongoSchema(connection.id);
            schema = updatedConnection?.schema;
          } else if (connection.type === "postgres" || connection.type === "mssql") {
            const dbConnection = await externalDbConnection(connection);
            schema = await this.connectionController.getSchema(dbConnection);
          }
        }

        if (!schema) {
          return Promise.reject(new Error("No schema found. Please test your connection first."));
        }

        let aiResponse;
        if (connection.type === "mongodb") {
          aiResponse = await generateMongoQuery(
            schema, question, conversationHistory, currentQuery
          );
        } else {
          aiResponse = await generateSqlQuery(
            schema, question, conversationHistory, currentQuery
          );
        }

        return aiResponse;
      })
      .catch((error) => {
        return Promise.reject(error);
      });
  }

  createVariableBinding(id, data) {
    const newVar = {
      ...data,
      entity_type: "DataRequest",
      entity_id: `${id}`,
    };

    return db.VariableBinding.create(newVar)
      .then(() => {
        return this.findById(id);
      });
  }

  updateVariableBinding(id, variable_id, data) {
    return db.VariableBinding.update(data, { where: { id: variable_id } })
      .then(() => {
        return this.findById(id);
      });
  }
}

module.exports = RequestController;
