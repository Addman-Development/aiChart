const db = require("../models");

/**
 * Claim orphan dashboards so ownership-scoped surfaces can't hide real work.
 *
 * ProjectRole is the only per-user ownership record smartChart keeps — Project
 * has no owner column — and /api/embed/* scopes to it (see server/api/EmbedRoute.js).
 * Every project made through POST /project gets one via ProjectController.create,
 * but the auto-created "Your First Dash" is built with a bare db.Project.create and
 * has none. If someone renamed that project and filled it with charts, it would
 * silently drop out of the embed catalog. Assign every non-ghost project that has
 * no ProjectRole at all to its team's owner.
 *
 * Ghost projects are skipped on purpose: they are the per-team holding pen for
 * AI-generated scratch charts, are never embeddable, and have no meaningful owner.
 */
module.exports.up = async () => {
  const projects = await db.Project.findAll({
    where: { ghost: false },
    attributes: ["id", "team_id"],
  });
  if (projects.length === 0) return "done";

  const existingRoles = await db.ProjectRole.findAll({ attributes: ["project_id"] });
  const claimed = new Set(existingRoles.map((r) => r.project_id));

  const orphans = projects.filter((p) => !claimed.has(p.id));
  if (orphans.length === 0) return "done";

  const owners = await db.TeamRole.findAll({
    where: { role: "teamOwner" },
    attributes: ["team_id", "user_id"],
  });
  const ownerByTeam = new Map(owners.map((r) => [r.team_id, r.user_id]));

  const rows = [];
  orphans.forEach((project) => {
    const userId = ownerByTeam.get(project.team_id);
    // A team with no owner has nobody to assign to — leave the project unclaimed
    // rather than inventing an owner for it.
    if (userId) {
      rows.push({ project_id: project.id, user_id: userId, role: "teamOwner" });
    }
  });

  if (rows.length === 0) return "done";
  return db.ProjectRole.bulkCreate(rows);
};

/**
 * Intentionally a no-op. The rows added above are indistinguishable from
 * ownership records written during normal project creation, so deleting them on
 * rollback would destroy real ownership. Leaving them is harmless: an extra
 * ProjectRole for a team owner grants access they already had.
 */
module.exports.down = () => Promise.resolve("done");
