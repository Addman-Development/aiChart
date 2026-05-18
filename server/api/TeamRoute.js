const _ = require("lodash");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");

const TeamController = require("../controllers/TeamController");
const UserController = require("../controllers/UserController");
const verifyToken = require("../modules/verifyToken");
const accessControl = require("../modules/accessControl");

const apiLimiter = (max = 10) => {
  return rateLimit({
    windowMs: 60 * 1000,
    max,
  });
};

function filterProjects(projects, teamRole) {
  return projects.filter((p) => _.indexOf(teamRole.projects, p.id) > -1);
}

module.exports = (app) => {
  const teamController = new TeamController();
  const userController = new UserController();

  const checkPermissions = (actionType = "readOwn", entity = "team") => {
    return async (req, res, next) => {
      const { id } = req.params;

      if (req.user.admin) {
        req.user.isEditor = true;
        return next();
      }

      const teamRole = await teamController.getTeamRole(id, req.user.id);

      if (!teamRole) {
        return res.status(403).json({ message: "Access denied" });
      }

      const permission = accessControl.can(teamRole.role)[actionType](entity);
      if (!permission.granted) {
        return res.status(403).json({ message: "Access denied" });
      }

      const { role } = teamRole;

      if (["teamOwner", "teamAdmin"].includes(role)) {
        req.user.isEditor = true;
        return next();
      }

      if (role === "projectAdmin" || role === "projectViewer" || role === "projectEditor") {
        return next();
      }

      return res.status(403).json({ message: "Access denied" });
    };
  };

  app.get("/team", verifyToken, (req, res) => {
    const teamsPromise = req.user.admin
      ? teamController.getAllTeams()
      : teamController.getUserTeams(req.user.id);

    return teamsPromise
      .then((teams) => {
        return res.status(200).send(teams);
      })
      .catch((error) => {
        return res.status(400).send(error);
      });
  });


  app.get("/team/:id", verifyToken, checkPermissions(), (req, res) => {
    return teamController.findById(req.params.id)
      .then((team) => {
        const modTeam = team;
        if (team.Projects) modTeam.setDataValue("Projects", filterProjects(team.Projects, req.user));
        return res.status(200).send(modTeam);
      })
      .catch((error) => {
        if (error.message === "401") return res.status(401).send({ error: "Not authorized" });
        if (error === "404") return res.status(404).send({ error: "The team is not found" });
        return res.status(400).send(error);
      });
  });


  app.post("/team", verifyToken, apiLimiter(10), async (req, res) => {
    try {
      const team = await teamController.createTeam(req.body, req.user.id);
      return res.status(200).send(team);
    } catch (error) {
      return res.status(400).send({ error: "Error creating team" });
    }
  });


  app.delete("/team/:id", verifyToken, checkPermissions("deleteOwn", "team"), (req, res) => {
    return teamController.deleteTeam(req.params.id, req.user.id)
      .then((result) => {
        return res.status(200).send(result);
      })
      .catch((error) => {
        if (error?.message === "401") return res.status(401).send({ error: "Not authorized" });
        return res.status(400).send({ error: error?.message || "Error deleting team" });
      });
  });


  app.put("/team/:id", verifyToken, (req, res) => {
    if (!req.params || !req.body) return res.status(400).send("Missing fields");
    let gTeamRole;
    return teamController.getTeamRole(req.params.id, req.user.id)
      .then((teamRole) => {
        gTeamRole = teamRole;
        const permission = accessControl.can(teamRole.role).updateOwn("team");
        if (!permission.granted) {
          return new Promise((resolve, reject) => reject(new Error(401)));
        }
        return teamController.update(req.params.id, req.body);
      })
      .then((team) => {
        const modTeam = team;
        if (team.Projects) modTeam.setDataValue("Projects", filterProjects(team.Projects, gTeamRole));
        return res.status(200).send(modTeam);
      })
      .catch((error) => {
        if (error.message === "401") return res.status(401).send({ error: "Not authorized" });
        return res.status(400).send(error);
      });
  });


  app.put("/team/:id/transfer", verifyToken, checkPermissions("updateAny", "team"), (req, res) => {
    return teamController.transferOwnership(req.params.id, req.user.id, req.body.newOwnerId)
      .then((updated) => {
        return res.status(200).send(updated);
      })
      .catch((error) => {
        return res.status(400).send(error);
      });
  });


  app.post("/team/:id/invite", verifyToken, checkPermissions("createAny", "teamInvite"), (req, res) => {
    const payload = {
      projects: req.body.projects,
      canExport: req.body.canExport,
      role: req.body.role,
      team_id: req.params.id,
      user_id: req.user.id,
    };

    const token = jwt.sign(payload, app.settings.encryptionKey, {
      expiresIn: 2592000
    }, (err, token) => {
      if (err) throw new Error(err);
      return res.status(200).send({
        url: `${app.settings.client}/invite?token=${token}`,
      });
    });

    return token;
  });


  app.post("/team/user/:user_id", verifyToken, (req, res) => {
    if (!req.params.user_id || !req.body.token) return res.status(400).send("Missing fields");
    if (`${req.params.user_id}` !== `${req.user.id}`) {
      return res.status(400).send("Malformed request");
    }

    let newRole = {};
    return jwt.verify(req.body.token, app.settings.encryptionKey, (err, decoded) => {
      return teamController.addTeamRole(decoded.team_id, req.user.id, decoded.role || "projectViewer", decoded.projects, decoded.canExport)
        .then((role) => {
          newRole = role;
          return teamController.findById(newRole.team_id);
        })
        .then((team) => {
          const modTeam = team;
          if (team.Projects) modTeam.setDataValue("Projects", filterProjects(team.Projects, newRole));
          return res.status(200).send(modTeam);
        })
        .catch((error) => {
          return res.status(400).send(error);
        });
    });
  });


  app.get("/team/:id/members", verifyToken, checkPermissions(), (req, res) => {
    return teamController.getTeamMembersId(req.params.id)
      .then((userIds) => {
        if (userIds.length < 1) return res.status(200).send([]);
        return userController.getUsersById(userIds, req.params.id);
      })
      .then((teamMembers) => {
        return res.status(200).send(teamMembers);
      })
      .catch((error) => {
        if (error.message === "401") return res.status(401).send({ error: "Not authorized" });
        return res.status(400).send(error);
      });
  });


  app.put("/team/:id/role", verifyToken, checkPermissions("updateAny", "teamRole"), (req, res) => {
    return teamController.updateTeamRole(req.params.id, req.body.user_id, req.body)
      .then((updated) => {
        return res.status(200).send(updated);
      })
      .catch((error) => {
        if (error.message === "401") return res.status(401).send({ error: "Not authorized" });
        return res.status(400).send(error);
      });
  });


  app.delete("/team/:id/member/:userId", verifyToken, checkPermissions("deleteAny", "teamRole"), (req, res) => {
    return teamController.getTeamRole(req.params.id, req.params.userId)
      .then(async (teamRole) => {
        if (!teamRole) return res.status(404).send("Did not find a team member");

        const roleToDelete = await teamController.getTeamRole(req.params.id, req.params.userId);

        if (roleToDelete.role === "teamOwner") {
          return new Promise((resolve, reject) => reject("Cannot delete a team owner"));
        }

        return teamController.deleteTeamMember(teamRole.id);
      })
      .then((success) => {
        if (success) {
          return res.status(200).send({ removed: success });
        }
        return new Promise((resolve, reject) => reject(new Error(400)));
      })
      .catch((error) => {
        if (error.message === "401") return res.status(401).send({ error: "Not authorized" });
        return res.status(400).send(error);
      });
  });


  app.put("/team/:id/member/:userId/password-reset", verifyToken, checkPermissions("updateAny", "teamRole"), apiLimiter(10), async (req, res) => {
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    try {
      const targetRole = await teamController.getTeamRole(req.params.id, req.params.userId);
      if (!targetRole) {
        return res.status(404).json({ error: "User is not a member of this team" });
      }
      if (targetRole.role === "teamOwner") {
        return res.status(403).json({ error: "Cannot reset the team owner's password" });
      }

      const result = await userController.adminResetPassword(req.params.userId, newPassword);
      return res.status(200).json(result);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });


  app.get("/team/:id/availableUsers", verifyToken, checkPermissions("createAny", "teamInvite"), async (req, res) => {
    try {
      const users = await teamController.getAvailableUsers(req.params.id);
      return res.status(200).json(users);
    } catch (error) {
      return res.status(400).json({ error: error.message || "Error fetching available users" });
    }
  });


  app.post("/team/:id/addExistingUser", verifyToken, checkPermissions("createAny", "teamInvite"), async (req, res) => {
    const { userId, role, projects, canExport } = req.body;

    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    try {
      const result = await teamController.addExistingUserToTeam(req.params.id, userId, {
        role,
        projects,
        canExport,
      });
      return res.status(200).json(result);
    } catch (error) {
      if (error.message === "User is already a member of this team") {
        return res.status(409).json({ error: error.message });
      }
      return res.status(400).json({ error: error.message || "Error adding user to team" });
    }
  });


  app.post("/team/:id/createUser", verifyToken, checkPermissions("createAny", "teamInvite"), async (req, res) => {
    const { name, email, role, projects, canExport, sendEmail } = req.body;

    if (!name || !email) {
      return res.status(400).json({ error: "Name and email are required" });
    }

    try {
      const result = await teamController.createUserForTeam(req.params.id, {
        name,
        email,
        role,
        projects,
        canExport,
        sendEmail,
      });

      return res.status(200).json(result);
    } catch (error) {
      if (error.message === "User is already a member of this team") {
        return res.status(409).json({ error: error.message });
      }
      return res.status(400).json({ error: error.message || "Error creating user" });
    }
  });


  app.post("/team/:id/apikey", verifyToken, checkPermissions("createAny", "apiKey"), (req, res) => {
    if (!req.body.name) return res.status(400).send("Missing required fields.");

    return teamController.createApiKey(req.params.id, req.user, req.body)
      .then((apiKey) => {
        return res.status(200).send(apiKey);
      })
      .catch((err) => {
        return res.status(400).send(err);
      });
  });


  app.get("/team/:id/apikey", verifyToken, checkPermissions("readAny", "apiKey"), (req, res) => {
    return teamController.getApiKeys(req.params.id)
      .then((apiKey) => {
        return res.status(200).send(apiKey);
      })
      .catch((err) => {
        return res.status(400).send(err);
      });
  });


  app.delete("/team/:id/apikey/:keyId", verifyToken, checkPermissions("deleteAny", "apiKey"), (req, res) => {
    return teamController.deleteApiKey(req.params.keyId)
      .then(() => {
        return res.status(200).send({ deleted: true });
      })
      .catch((err) => {
        return res.status(400).send(err);
      });
  });

  return (req, res, next) => {
    next();
  };
};
