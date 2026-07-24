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
  let rowCounts;
  if (terseSchema?.description && typeof terseSchema.description === "object") {
    const terse = {};
    for (const [table, cols] of Object.entries(terseSchema.description)) {
      // cols may be { colName: "TYPE" } (rich) or ["colName"] (legacy)
      terse[table] = Array.isArray(cols) ? cols : Object.keys(cols);
    }
    // Carried through from ConnectionController._get*Schema: approximate rows
    // per table (Postgres via pg_catalog.reltuples, MSSQL via partition stats).
    rowCounts = (terseSchema.rowCounts && typeof terseSchema.rowCounts === "object")
      ? terseSchema.rowCounts
      : undefined;
    terseSchema = { ...terseSchema, description: terse };
  }

  return {
    dialect: connection.type,
    connection_id: connection.id,
    name: connection.name,
    entities: terseSchema,
    // Steer the model toward tables that actually hold data so it doesn't burn
    // steps re-querying empty ones. Only present when the stored schema has
    // counts (older schemas refresh on the next query run).
    rowCountGuidance: rowCounts
      ? "entities.rowCounts gives approximate rows per table (0 = empty, null = unknown/not analyzed). Prefer tables that contain data; do not repeatedly query empty tables. Empty tables stay listed and become valid targets as soon as they hold data."
      : undefined,
    samples: include_samples ? {} : undefined,
  };
}

module.exports = getSchema;
