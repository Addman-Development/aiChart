const { resolveAccessibleConnection } = require("./connectionScope");

// Tenant isolation guard for AI tools. Any connection_id the model supplies must
// be usable by the active team — either owned by it or a shared connection the
// team has opted into. Otherwise the chat/component generation could read from
// or build against another team's private data source (e.g. the Dev team).
// Returns the connection so callers can reuse it without a second lookup.
async function assertConnectionInTeam(connectionId, teamId) {
  if (!teamId) {
    throw new Error("team_id is required");
  }
  if (!connectionId) {
    throw new Error("connection_id is required");
  }

  const { connection, accessible } = await resolveAccessibleConnection(connectionId, teamId);
  if (!connection) {
    throw new Error("Connection not found");
  }
  if (!accessible) {
    throw new Error("Connection is not available to the active team");
  }

  return connection;
}

module.exports = assertConnectionInTeam;
