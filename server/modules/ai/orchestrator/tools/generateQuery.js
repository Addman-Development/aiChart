const { generateSqlQuery } = require("../../generateSqlQuery");
const { generateMongoQuery } = require("../../generateMongoQuery");

async function generateQuery(payload) {
  const {
    question, schema, preferred_dialect
  } = payload;

  if (!global.openaiClient) {
    return {
      status: "unsupported",
      message: "Query generation requires OpenAI to be configured",
    };
  }

  try {
    if (schema && typeof schema !== "object") {
      throw new Error("Schema must be a valid object if provided");
    }

    if (preferred_dialect === "mongodb") {
      const result = await generateMongoQuery(schema, question, []);

      if (!result || !result.query || result.query.trim() === "") {
        throw new Error("Query generation failed - no query returned");
      }

      // Validate no destructive operations
      const mongoForbidden = ["deleteMany", "deleteOne", "drop", "remove", "insertOne", "insertMany", "updateOne", "updateMany", "replaceOne"];
      const hasForbidden = mongoForbidden.some((op) => result.query.includes(`.${op}(`));
      if (hasForbidden) {
        return {
          status: "unsupported",
          message: "Generated query contains forbidden operations (only read queries are allowed)",
          query: result.query,
        };
      }

      return {
        status: "ok",
        dialect: preferred_dialect,
        query: result.query,
        rationale: {
          message: "MongoDB query generated successfully",
        },
      };
    }

    // SQL path (postgres)
    const effectiveSchema = schema || {
      tables: ["User"],
      description: {
        User: {
          id: { type: "INT" },
          name: { type: "VARCHAR(255)" },
          email: { type: "VARCHAR(255)" },
          createdAt: { type: "DATETIME" }
        }
      }
    };

    const result = await generateSqlQuery(effectiveSchema, question, []);

    if (!result || !result.query || result.query.trim() === "") {
      throw new Error("Query generation failed - no query returned");
    }

    const forbiddenKeywords = ["DROP", "DELETE", "UPDATE", "INSERT", "TRUNCATE", "ALTER", "CREATE"];
    const upperQuery = result.query.toUpperCase();
    const hasForbiddenKeyword = forbiddenKeywords.some((keyword) => {
      const regex = new RegExp(`\\b${keyword}\\b`, "i");
      return regex.test(upperQuery);
    });

    if (hasForbiddenKeyword) {
      return {
        status: "unsupported",
        message: "Generated query contains forbidden operations (only SELECT queries are allowed)",
        query: result.query,
      };
    }

    return {
      status: "ok",
      dialect: preferred_dialect,
      query: result.query,
      rationale: {
        message: "Query generated successfully",
      },
    };
  } catch (error) {
    return {
      status: "error",
      message: `Query generation failed: ${error.message}`,
    };
  }
}

module.exports = generateQuery;
