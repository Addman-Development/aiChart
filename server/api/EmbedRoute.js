const rateLimit = require("express-rate-limit");

const db = require("../models/models");
const ProjectController = require("../controllers/ProjectController");
const ChartController = require("../controllers/ChartController");
const TeamController = require("../controllers/TeamController");
const verifyKeycloakToken = require("../modules/verifyKeycloakToken");
const getEmbeddedChartData = require("../modules/getEmbeddedChartData");
const logger = require("../modules/logger").child({ module: "api:EmbedRoute" });

/**
 * /api/embed/* — a small, read-only surface for embedding a user's own charts
 * ("components") and projects ("dashboards") into sibling ADDMAN apps
 * (the-platform). Authenticated with a shared-realm Keycloak access token
 * (see modules/verifyKeycloakToken.js), so the caller sees exactly the charts
 * their own smartChart account can access — no admin key, no public sharing.
 *
 * The payloads are the same render-ready `getEmbeddedChartData` objects used by
 * smartChart's own embeds, so a consumer can re-render them natively.
 */

const OWNER_ROLES = ["teamOwner", "teamAdmin"];

const embedLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 });

module.exports = (app) => {
  const projectController = new ProjectController();
  const chartController = new ChartController();
  const teamController = new TeamController();

  function getRoles(userId) {
    return db.TeamRole.findAll({ where: { user_id: userId } });
  }

  function roleForTeam(roles, teamId) {
    return roles.find((r) => r.team_id === teamId);
  }

  // Does the embed user have access to this project? Team owners/admins see the
  // whole team; project-scoped roles only see projects in their `projects[]`
  // whitelist. A global smartChart admin bypasses the check.
  function canAccessProject(req, roles, project) {
    if (req.user && req.user.admin) return true;
    const role = roleForTeam(roles, project.team_id);
    if (!role) return false;
    if (OWNER_ROLES.includes(role.role)) return true;
    const allowed = role.projects;
    return Array.isArray(allowed) && allowed.includes(project.id);
  }

  /*
  ** Catalog of the current user's projects (dashboards) + charts (components),
  ** used to build the "add widget" picker.
  */
  app.get("/embed/mine", embedLimiter, verifyKeycloakToken, async (req, res) => {
    try {
      if (req.embedUnlinked || !req.user) {
        return res.status(200).send({ linked: false, teams: [], projects: [] });
      }

      const roles = await getRoles(req.user.id);
      const teamIds = [...new Set(roles.map((r) => r.team_id))];
      if (teamIds.length === 0) {
        return res.status(200).send({ linked: true, teams: [], projects: [] });
      }

      const teams = await db.Team.findAll({
        where: { id: teamIds },
        include: [{
          model: db.Project,
          include: [{
            model: db.Chart,
            attributes: ["id", "name", "type", "draft", "dashboardOrder"],
          }],
        }],
      });

      const outTeams = [];
      const outProjects = [];

      teams.forEach((team) => {
        outTeams.push({ id: team.id, name: team.name });
        const role = roleForTeam(roles, team.id);
        const isOwner = (req.user.admin || (role && OWNER_ROLES.includes(role.role)));
        const allowed = role && Array.isArray(role.projects) ? role.projects : [];

        (team.Projects || []).forEach((project) => {
          if (!isOwner && !allowed.includes(project.id)) return;
          const charts = (project.Charts || [])
            .filter((c) => !c.draft)
            .sort((a, b) => (a.dashboardOrder || 0) - (b.dashboardOrder || 0))
            .map((c) => ({ id: c.id, name: c.name, type: c.type }));
          outProjects.push({
            id: project.id,
            name: project.name,
            brewName: project.brewName,
            team_id: team.id,
            chartCount: charts.length,
            charts,
          });
        });
      });

      return res.status(200).send({ linked: true, teams: outTeams, projects: outProjects });
    } catch (err) {
      logger.error({ err }, "embed catalog failed");
      return res.status(500).send({ error: "Failed to load catalog" });
    }
  });

  /*
  ** Render-ready data for a single chart (component).
  */
  app.get("/embed/chart/:id", embedLimiter, verifyKeycloakToken, async (req, res) => {
    try {
      if (req.embedUnlinked || !req.user) {
        return res.status(403).send({ error: "No linked smartChart account" });
      }

      const chart = await chartController.findById(req.params.id);
      if (!chart) return res.status(404).send({ error: "Chart not found" });

      const project = await db.Project.findByPk(chart.project_id);
      if (!project) return res.status(404).send({ error: "Chart not found" });

      const roles = await getRoles(req.user.id);
      if (!canAccessProject(req, roles, project)) {
        return res.status(403).send({ error: "Not authorized" });
      }

      const team = await teamController.findById(project.team_id);
      return res.status(200).send(getEmbeddedChartData(chart, team));
    } catch (err) {
      logger.error({ err }, "embed chart failed");
      return res.status(500).send({ error: "Failed to load chart" });
    }
  });

  /*
  ** Render-ready data for a whole project (dashboard) — all of its charts.
  */
  app.get("/embed/project/:id", embedLimiter, verifyKeycloakToken, async (req, res) => {
    try {
      if (req.embedUnlinked || !req.user) {
        return res.status(403).send({ error: "No linked smartChart account" });
      }

      const project = await projectController.findById(req.params.id);
      if (!project) return res.status(404).send({ error: "Project not found" });

      const roles = await getRoles(req.user.id);
      if (!canAccessProject(req, roles, project)) {
        return res.status(403).send({ error: "Not authorized" });
      }

      const team = project.Team || await teamController.findById(project.team_id);
      const charts = (project.Charts || []).map((c) => getEmbeddedChartData(c, team));

      return res.status(200).send({
        project: { id: project.id, name: project.name, brewName: project.brewName },
        charts,
      });
    } catch (err) {
      logger.error({ err }, "embed project failed");
      return res.status(500).send({ error: "Failed to load project" });
    }
  });
};
