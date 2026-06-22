const rateLimit = require("express-rate-limit");
const { Op } = require("sequelize");

const AccessRequestController = require("../controllers/AccessRequestController");
const db = require("../models/models");
const verifyToken = require("../modules/verifyToken");
const nodemail = require("../modules/nodemail");
const logger = require("../modules/logger").child({ module: "api:AccessRequestRoute" });

const apiLimiter = (max = 10) => {
  return rateLimit({
    windowMs: 60 * 1000,
    max,
    validate: { trustProxy: false },
  });
};

module.exports = (app) => {
  const controller = new AccessRequestController();

  const requireOwner = async (req, res, next) => {
    try {
      const request = await controller.findById(req.params.id);
      if (!request) return res.status(404).json({ error: "Access request not found" });

      if (!req.user.admin) {
        const teamRole = await db.TeamRole.findOne({
          where: { team_id: request.requested_team_id, user_id: req.user.id },
        });
        if (!teamRole || (teamRole.role !== "teamOwner" && teamRole.role !== "teamAdmin")) {
          return res.status(403).json({ error: "Access denied" });
        }
      }

      req.accessRequest = request;
      return next();
    } catch (error) {
      logger.error({ err: error }, "requireOwner check failed");
      return res.status(500).json({ error: "Internal error" });
    }
  };

  app.get("/api/access-requests/teams", verifyToken, apiLimiter(60), async (req, res) => {
    try {
      const q = (req.query.q || "").trim();
      const where = q
        ? { name: { [Op.iLike]: `%${q}%` } }
        : {};

      const teams = await db.Team.findAll({
        where,
        attributes: ["id", "name"],
        order: [["name", "ASC"]],
        limit: 50,
      });

      return res.status(200).json(teams.map((t) => ({ id: t.id, name: t.name })));
    } catch (error) {
      logger.error({ err: error }, "failed to list teams for access request");
      return res.status(500).json({ error: "Failed to load teams" });
    }
  });

  app.post("/api/access-requests", verifyToken, apiLimiter(20), async (req, res) => {
    const { teamId, reason } = req.body || {};

    if (!teamId) {
      return res.status(400).json({ error: "teamId is required" });
    }

    try {
      const team = await db.Team.findByPk(teamId);
      if (!team) return res.status(404).json({ error: "Team not found" });

      const existingRole = await db.TeamRole.findOne({
        where: { team_id: teamId, user_id: req.user.id },
      });
      if (existingRole) {
        return res.status(400).json({ error: "You are already a member of this team" });
      }

      const existing = await controller.findPending({
        userId: req.user.id,
        teamId,
      });
      if (existing) {
        return res.status(200).json({ id: existing.id, status: existing.status, duplicate: true });
      }

      const request = await controller.create({
        userId: req.user.id,
        email: req.user.email,
        name: req.user.name,
        teamId,
        reason: reason ? String(reason).slice(0, 2000) : null,
      });

      try {
        const owner = await controller.getTeamOwnerUser(teamId);
        if (owner && owner.email) {
          const reviewUrl = `${app.settings.client}/settings/members?access_request_id=${request.id}`;
          await nodemail.sendAccessRequest({
            ownerEmail: owner.email,
            ownerName: owner.name,
            requesterEmail: req.user.email,
            requesterName: req.user.name,
            teamName: team.name,
            reason,
            reviewUrl,
          });
        } else {
          logger.warn({ teamId }, "no team owner found to notify for access request");
        }
      } catch (notifyErr) {
        logger.error({ err: notifyErr, requestId: request.id }, "failed to email access request");
      }

      return res.status(201).json({ id: request.id, status: request.status });
    } catch (error) {
      if (error.name === "SequelizeUniqueConstraintError") {
        const existing = await controller.findPending({
          userId: req.user.id,
          teamId,
        });
        if (existing) {
          return res.status(200).json({ id: existing.id, status: existing.status, duplicate: true });
        }
      }
      logger.error({ err: error }, "failed to create access request");
      return res.status(500).json({ error: "Failed to submit access request" });
    }
  });

  app.get("/api/access-requests", verifyToken, async (req, res) => {
    try {
      let teamIds;
      if (req.user.admin) {
        teamIds = (await db.Team.findAll({ attributes: ["id"] })).map((t) => t.id);
      } else {
        const roles = await db.TeamRole.findAll({
          where: {
            user_id: req.user.id,
            role: { [Op.in]: ["teamOwner", "teamAdmin"] },
          },
          attributes: ["team_id"],
        });
        teamIds = roles.map((r) => r.team_id);
      }

      const requests = await controller.listPendingForTeams(teamIds);
      return res.status(200).json(requests);
    } catch (error) {
      logger.error({ err: error }, "failed to list access requests");
      return res.status(500).json({ error: "Failed to load access requests" });
    }
  });

  app.get("/api/access-requests/:id", verifyToken, requireOwner, (req, res) => {
    return res.status(200).json(req.accessRequest);
  });

  app.post("/api/access-requests/:id/approve", verifyToken, requireOwner, async (req, res) => {
    const { role, projects, canExport } = req.body || {};

    try {
      const { user, request } = await controller.approve(req.accessRequest.id, {
        role,
        projects,
        canExport,
        resolverId: req.user.id,
      });

      return res.status(200).json({
        request: { id: request.id, status: request.status },
        user: { id: user.id, email: user.email, name: user.name },
      });
    } catch (error) {
      logger.error({ err: error, requestId: req.params.id }, "failed to approve access request");
      return res.status(400).json({ error: error.message || "Failed to approve" });
    }
  });

  app.post("/api/access-requests/:id/reject", verifyToken, requireOwner, async (req, res) => {
    try {
      const request = await controller.reject(req.accessRequest.id, {
        resolverId: req.user.id,
      });
      return res.status(200).json({ id: request.id, status: request.status });
    } catch (error) {
      logger.error({ err: error, requestId: req.params.id }, "failed to reject access request");
      return res.status(400).json({ error: error.message || "Failed to reject" });
    }
  });

  return (req, res, next) => {
    next();
  };
};
