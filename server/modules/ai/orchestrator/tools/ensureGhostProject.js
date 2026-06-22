const { nanoid } = require("nanoid");
const db = require("../../../../models/models");

/**
 * Find the ghost project for a team, creating one automatically if it
 * doesn't exist.  This makes chart-creation tools self-healing — they
 * won't fail just because a migration was skipped or the project was
 * accidentally deleted.
 */
async function ensureGhostProject(teamId) {
  let ghostProject = await db.Project.findOne({
    where: { team_id: teamId, ghost: true },
  });

  if (!ghostProject) {
    ghostProject = await db.Project.create({
      team_id: teamId,
      name: "Ghost Project",
      brewName: `ghost-project-${nanoid(8)}`,
      dashboardTitle: "Ghost Project",
      ghost: true,
      public: false,
    });
  }

  return ghostProject;
}

module.exports = ensureGhostProject;
