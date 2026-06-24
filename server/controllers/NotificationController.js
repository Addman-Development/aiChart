const db = require("../models/models");
const socketManager = require("../modules/socketManager");

class NotificationController {
  findByTeamUser(teamId, userId) {
    return db.Notification.findAll({
      where: { team_id: teamId, user_id: userId },
      order: [["createdAt", "DESC"]],
      limit: 50,
    })
      .then((notifications) => notifications)
      .catch((error) => new Promise((resolve, reject) => reject(error)));
  }

  findById(id) {
    return db.Notification.findOne({ where: { id } })
      .then((notification) => {
        if (!notification) {
          return new Promise((resolve, reject) => reject(new Error(404)));
        }
        return notification;
      })
      .catch((error) => new Promise((resolve, reject) => reject(error)));
  }

  create(data) {
    // Whitelist writable fields so callers can't mass-assign id/read/timestamps.
    return db.Notification.create(data, {
      fields: ["type", "title", "message", "meta", "team_id", "user_id"],
    })
      .then((created) => this.findById(created.id))
      .then((notification) => {
        socketManager.emitToUser(notification.user_id, "notification-created", notification.toJSON());
        return notification;
      })
      .catch((error) => new Promise((resolve, reject) => reject(error)));
  }

  markRead(id, teamId, userId) {
    return db.Notification.update(
      { read: true },
      { where: { id, team_id: teamId, user_id: userId } },
    )
      .then(([affectedCount]) => {
        // 0 rows => not found OR not owned by this user; never read back a row
        // scoped only by id (that would leak another user's notification).
        if (!affectedCount) {
          return new Promise((resolve, reject) => reject(new Error(404)));
        }
        return db.Notification.findOne({ where: { id, team_id: teamId, user_id: userId } });
      })
      .then((notification) => {
        // The row may have been deleted by a concurrent remove()/clear() between
        // the UPDATE and this read-back; treat that as a no-op success.
        if (!notification) {
          return { id, read: true };
        }
        socketManager.emitToUser(userId, "notification-updated", notification.toJSON());
        return notification;
      })
      .catch((error) => new Promise((resolve, reject) => reject(error)));
  }

  markAllRead(teamId, userId) {
    return db.Notification.update(
      { read: true },
      { where: { team_id: teamId, user_id: userId, read: false } },
    )
      .then(() => {
        socketManager.emitToUser(userId, "notifications-read-all", { team_id: teamId });
        return { team_id: teamId, read: true };
      })
      .catch((error) => new Promise((resolve, reject) => reject(error)));
  }

  remove(id, teamId, userId) {
    return db.Notification.destroy({ where: { id, team_id: teamId, user_id: userId } })
      .then(() => {
        socketManager.emitToUser(userId, "notification-deleted", { id });
        return { id };
      })
      .catch((error) => new Promise((resolve, reject) => reject(error)));
  }

  clear(teamId, userId) {
    return db.Notification.destroy({ where: { team_id: teamId, user_id: userId } })
      .then(() => {
        socketManager.emitToUser(userId, "notifications-cleared", { team_id: teamId });
        return { cleared: true };
      })
      .catch((error) => new Promise((resolve, reject) => reject(error)));
  }
}

module.exports = NotificationController;
