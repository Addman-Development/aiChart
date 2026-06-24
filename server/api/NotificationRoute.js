const NotificationController = require("../controllers/NotificationController");
const TeamController = require("../controllers/TeamController");
const verifyToken = require("../modules/verifyToken");
const accessControl = require("../modules/accessControl");

module.exports = (app) => {
  const notificationController = new NotificationController();
  const teamController = new TeamController();

  const checkPermissions = (actionType = "readAny") => {
    return async (req, res, next) => {
      const { team_id } = req.params;

      // Global master admins bypass team-role checks.
      if (req.user.admin) {
        return next();
      }

      const teamRole = await teamController.getTeamRole(team_id, req.user.id);
      if (!teamRole) {
        return res.status(403).json({ message: "Access denied" });
      }

      const permission = accessControl.can(teamRole.role)[actionType]("notification");
      if (!permission.granted) {
        return res.status(403).json({ message: "Access denied" });
      }

      return next();
    };
  };

  // List the current user's notifications for a team
  app.get("/team/:team_id/notification", verifyToken, checkPermissions("readAny"), (req, res) => {
    return notificationController.findByTeamUser(req.params.team_id, req.user.id)
      .then((notifications) => res.status(200).send(notifications))
      .catch((error) => res.status(400).send(error));
  });

  // Create a notification for the current user
  app.post("/team/:team_id/notification", verifyToken, checkPermissions("createAny"), (req, res) => {
    const data = req.body || {};
    data.team_id = req.params.team_id;
    data.user_id = req.user.id;
    return notificationController.create(data)
      .then((notification) => res.status(200).send(notification))
      .catch((error) => res.status(400).send(error));
  });

  // Mark all of the current user's notifications as read (declared before /:id routes)
  app.put("/team/:team_id/notification/read-all", verifyToken, checkPermissions("updateAny"), (req, res) => {
    return notificationController.markAllRead(req.params.team_id, req.user.id)
      .then((result) => res.status(200).send(result))
      .catch((error) => res.status(400).send(error));
  });

  // Mark a single notification as read
  app.put("/team/:team_id/notification/:id/read", verifyToken, checkPermissions("updateAny"), (req, res) => {
    return notificationController.markRead(req.params.id, req.params.team_id, req.user.id)
      .then((notification) => res.status(200).send(notification))
      .catch((error) => res.status(400).send(error));
  });

  // Remove a single notification
  app.delete("/team/:team_id/notification/:id", verifyToken, checkPermissions("deleteAny"), (req, res) => {
    return notificationController.remove(req.params.id, req.params.team_id, req.user.id)
      .then((result) => res.status(200).send(result))
      .catch((error) => res.status(400).send(error));
  });

  // Clear all of the current user's notifications for a team
  app.delete("/team/:team_id/notification", verifyToken, checkPermissions("deleteAny"), (req, res) => {
    return notificationController.clear(req.params.team_id, req.user.id)
      .then((result) => res.status(200).send(result))
      .catch((error) => res.status(400).send(error));
  });

  return (req, res, next) => {
    next();
  };
};
