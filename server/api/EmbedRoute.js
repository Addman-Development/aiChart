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
 * (see modules/verifyKeycloakToken.js), no admin key and no public sharing.
 *
 * Scope here is deliberately NARROWER than smartChart's own dashboard list: it
 * covers only projects the caller CREATED — the ones they hold a ProjectRole for,
 * written by ProjectController.create — and never ghost projects, the per-team
 * holding pen for AI-generated scratch charts. Team owners/admins do not get the
 * whole team, and a global smartChart admin gets no bypass: an embedded dashboard
 * is personal, so it must not surface a colleague's work.
 *
 * The payloads are the same render-ready `getEmbeddedChartData` objects used by
 * smartChart's own embeds, so a consumer can re-render them natively.
 */

const embedLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 });

module.exports = (app) => {
  const projectController = new ProjectController();
  const chartController = new ChartController();
  const teamController = new TeamController();

  function getRoles(userId) {
    return db.TeamRole.findAll({ where: { user_id: userId } });
  }

  // The projects this user created. ProjectRole is the only per-user ownership
  // record smartChart keeps — Project itself has no owner column — and every
  // project made through POST /project gets one (ProjectController.create).
  // The auto-created "Ghost Project" / "Your First Dash" are built with a bare
  // db.Project.create and so have none, which is why they fall out here for free.
  async function getOwnedProjectIds(userId) {
    const projectRoles = await db.ProjectRole.findAll({
      where: { user_id: userId },
      attributes: ["project_id"],
    });
    return new Set(projectRoles.map((r) => r.project_id));
  }

  function embedScope(userId) {
    return Promise.all([getRoles(userId), getOwnedProjectIds(userId)])
      .then(([roles, owned]) => ({ roles, owned }));
  }

  // Embeddable = the caller created it, it isn't a ghost project, and they are
  // still on the owning team (so leaving a team also revokes embedding).
  function canAccessProject(scope, project) {
    if (project.ghost) return false;
    if (!scope.owned.has(project.id)) return false;
    return scope.roles.some((r) => r.team_id === project.team_id);
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

      const scope = await embedScope(req.user.id);
      const teamIds = [...new Set(scope.roles.map((r) => r.team_id))];
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

        (team.Projects || []).forEach((project) => {
          if (!canAccessProject(scope, project)) return;
          const charts = (project.Charts || [])
            .filter((c) => !c.draft)
            .sort((a, b) => (a.dashboardOrder || 0) - (b.dashboardOrder || 0))
            .map((c) => ({ id: c.id, name: c.name, type: c.type }));
          outProjects.push({
            id: project.id,
            name: project.name,
            brewName: project.brewName,
            // Always false given the filter above, but part of the contract so a
            // consumer can hide ghosts itself when talking to an older deployment.
            ghost: Boolean(project.ghost),
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

      const scope = await embedScope(req.user.id);
      if (!canAccessProject(scope, project)) {
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

      const scope = await embedScope(req.user.id);
      if (!canAccessProject(scope, project)) {
        return res.status(403).send({ error: "Not authorized" });
      }

      const team = project.Team || await teamController.findById(project.team_id);
      // Match /embed/mine, which advertises only non-draft charts.
      const charts = (project.Charts || [])
        .filter((c) => !c.draft)
        .map((c) => getEmbeddedChartData(c, team));

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
