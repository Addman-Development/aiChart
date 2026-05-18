const { Op } = require("sequelize");

const db = require("../models/models");

class AccessRequestController {
  create({ userId, email, name, teamId, reason }) {
    return db.AccessRequest.create({
      user_id: userId,
      email,
      name,
      requested_team_id: teamId,
      reason,
      status: "pending",
    });
  }

  findPending({ userId, teamId }) {
    return db.AccessRequest.findOne({
      where: {
        user_id: userId,
        requested_team_id: teamId,
        status: "pending",
      },
    });
  }

  findById(id) {
    return db.AccessRequest.findByPk(id, {
      include: [
        { model: db.Team },
        { model: db.User, as: "Requester", attributes: ["id", "email", "name"] },
      ],
    });
  }

  listPendingForTeams(teamIds) {
    if (!teamIds || teamIds.length === 0) return Promise.resolve([]);
    return db.AccessRequest.findAll({
      where: {
        requested_team_id: { [Op.in]: teamIds },
        status: "pending",
      },
      include: [
        { model: db.Team },
        { model: db.User, as: "Requester", attributes: ["id", "email", "name"] },
      ],
      order: [["createdAt", "DESC"]],
    });
  }

  getTeamOwnerUser(teamId) {
    return db.TeamRole.findOne({
      where: { team_id: teamId, role: "teamOwner" },
      include: [{ model: db.User }],
    }).then((tr) => (tr ? tr.User : null));
  }

  // Approve: user already exists (created at SSO auto-create or via invite).
  // Just add the TeamRole and mark resolved, in one transaction so a partial
  // failure can't leave the row marked approved without team membership.
  async approve(requestId, { role, projects, canExport, resolverId }) {
    const request = await db.AccessRequest.findByPk(requestId);
    if (!request) throw new Error("Access request not found");
    if (request.status !== "pending") throw new Error("Access request is not pending");
    if (!request.user_id) throw new Error("Access request has no associated user");

    const transaction = await db.sequelize.transaction();
    try {
      const existingRole = await db.TeamRole.findOne({
        where: { team_id: request.requested_team_id, user_id: request.user_id },
        transaction,
      });

      if (!existingRole) {
        await db.TeamRole.create({
          team_id: request.requested_team_id,
          user_id: request.user_id,
          role: role || "projectViewer",
          projects: projects || [],
          canExport: !!canExport,
        }, { transaction });
      }

      await request.update({
        status: "approved",
        resolved_by: resolverId,
        resolved_at: new Date(),
      }, { transaction });

      await transaction.commit();

      const user = await db.User.findByPk(request.user_id);
      return { user, request };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async reject(requestId, { resolverId }) {
    const request = await db.AccessRequest.findByPk(requestId);
    if (!request) throw new Error("Access request not found");
    if (request.status !== "pending") throw new Error("Access request is not pending");

    await request.update({
      status: "rejected",
      resolved_by: resolverId,
      resolved_at: new Date(),
    });

    return request;
  }
}

module.exports = AccessRequestController;
