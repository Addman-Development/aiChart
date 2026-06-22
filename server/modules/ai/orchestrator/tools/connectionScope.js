const db = require("../../../../models/models");

// Which connections an AI request may use for a given team. This mirrors
// ConnectionController.findByTeam (which powers the connections page): a team's
// own connections, plus any `shared` connections it has opted into via the
// TeamConnection join table. Shared connections are treated as inherent once a
// team opts in, so the chat and chart generation see the same data sources the
// user sees in the UI. Private connections from other teams stay isolated.

async function accessibleConnectionIds(teamId) {
  const owned = await db.Connection.findAll({
    where: { team_id: teamId },
    attributes: ["id"],
  });
  const ids = new Set(owned.map((c) => c.id));

  const optedIn = await db.TeamConnection.findAll({
    where: { team_id: teamId },
    attributes: ["connection_id"],
  });
  const optedInIds = optedIn
    .map((tc) => tc.connection_id)
    .filter((id) => !ids.has(id));

  if (optedInIds.length > 0) {
    // Only honour opt-ins that still point at a genuinely shared connection.
    const shared = await db.Connection.findAll({
      where: { id: optedInIds, shared: true },
      attributes: ["id"],
    });
    shared.forEach((c) => ids.add(c.id));
  }

  return Array.from(ids);
}

// Resolve a single connection and report whether the team may use it (owned or
// opted-in shared). Returns the connection instance either way so callers can
// reuse it and craft their own error.
async function resolveAccessibleConnection(connectionId, teamId) {
  const connection = await db.Connection.findByPk(connectionId);
  if (!connection) {
    return { connection: null, accessible: false };
  }

  if (Number(connection.team_id) === Number(teamId)) {
    return { connection, accessible: true };
  }

  if (connection.shared) {
    const optedIn = await db.TeamConnection.findOne({
      where: { team_id: teamId, connection_id: connectionId },
    });
    if (optedIn) {
      return { connection, accessible: true };
    }
  }

  return { connection, accessible: false };
}

module.exports = { accessibleConnectionIds, resolveAccessibleConnection };
