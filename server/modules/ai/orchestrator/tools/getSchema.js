const { isConnectionSupported } = require("../entityCreationRules");
const assertConnectionInTeam = require("./assertConnectionInTeam");

async function getSchema(payload) {
  const { connection_id, team_id, include_samples = true } = payload;
  // sample_rows_per_entity could be used when extracting samples in the future

  // Enforce that the connection belongs to the active team.
  const connection = await assertConnectionInTeam(connection_id, team_id);

  // Check if connection type and subtype are supported
  if (!isConnectionSupported(connection.type, connection.subType)) {
    throw new Error(`Connection type '${connection.type}'${connection.subType ? `/${connection.subType}` : ""} is not supported. Currently only MySQL, PostgreSQL, and MongoDB connections are supported. API connections and other sources will be available in future updates.`);
  }

  // Return schema to the AI in a terse format (column names only) to stay
  // within token limits.  The full typed schema is kept on connection.schema
  // for internal use (e.g. date-column detection).
  let terseSchema = connection.schema || [];
  if (terseSchema?.description && typeof terseSchema.description === "object") {
    const terse = {};
    for (const [table, cols] of Object.entries(terseSchema.description)) {
      // cols may be { colName: "TYPE" } (rich) or ["colName"] (legacy)
      terse[table] = Array.isArray(cols) ? cols : Object.keys(cols);
    }
    terseSchema = { ...terseSchema, description: terse };
  }

  return {
    dialect: connection.type,
    connection_id: connection.id,
    name: connection.name,
    entities: terseSchema,
    samples: include_samples ? {} : undefined,
  };
}

module.exports = getSchema;
