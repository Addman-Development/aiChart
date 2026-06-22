const db = require("../../../../models/models");
const { isConnectionSupported } = require("../entityCreationRules");
const { accessibleConnectionIds } = require("./connectionScope");

async function listConnections(payload) {
  const { team_id } = payload;

  if (!team_id) {
    throw new Error("team_id is required to list connections");
  }

  // Owned connections + shared connections the team has opted into. This mirrors
  // the connections page so the AI sees exactly the data sources the user does,
  // including inherited shared connections, and never another team's private ones.
  const ids = await accessibleConnectionIds(team_id);
  if (ids.length === 0) {
    return { connections: [] };
  }

  const connections = await db.Connection.findAll({
    where: { id: ids },
    attributes: ["id", "type", "subType", "name"],
    order: [["createdAt", "DESC"]],
  });

  // Filter connections to only include supported types/subtypes.
  const filteredConnections = connections.filter(
    (conn) => isConnectionSupported(conn.type, conn.subType)
  );

  return {
    connections: filteredConnections.map((c) => ({
      id: c.id,
      type: c.type,
      subType: c.subType,
      name: c.name,
    })),
  };
}

module.exports = listConnections;
