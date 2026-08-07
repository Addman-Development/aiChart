const rateLimit = require("express-rate-limit");

const {
  getOrchestration,
  getAvailableTools,
  getConversations,
  getConversation,
  deleteConversation,
  renameConversation,
  setConversationArchived,
  setConversationStarred,
  bulkUpdateConversations,
  getAiUsage,
  submitMessageFeedback,
  forkConversation
} = require("../controllers/AiController");
const verifyToken = require("../modules/verifyToken");
const TeamController = require("../controllers/TeamController");

const apiLimiter = (max = 10) => {
  return rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max,
  });
};

const checkAccess = async (req, res, next) => {
  const teamId = req.body?.teamId || req.query?.teamId || req.params?.teamId;

  if (!teamId) {
    return res.status(400).json({ error: "teamId is required" });
  }

  // Global (master) admins bypass per-team role checks, matching the client's
  // canAccess convention which defers the real enforcement to the backend.
  if (req.user?.admin) {
    return next();
  }

  const teamController = new TeamController();
  const teamRole = await teamController.getTeamRole(teamId, req.user.id);

  if (!teamRole?.role || !["teamOwner", "teamAdmin"].includes(teamRole.role)) {
    return res.status(403).json({ error: "Access denied" });
  }

  next();
};

const isOpenAiApiKeySet = () => {
  return process.env.CB_AI_API_KEY || process.env.CB_OPENAI_API_KEY;
};

module.exports = (app) => {
  // Main orchestration endpoint - handles conversation creation/loading automatically
  app.post("/ai/orchestrate", apiLimiter(3), verifyToken, checkAccess, async (req, res) => {
    const {
      question,
      conversationHistory = [],
      aiConversationId,
      teamId,
      context,
      clientTurnId
    } = req.body;

    if (!teamId || !req.user.id) {
      return res.status(400).json({ error: "teamId and user ID are required" });
    }

    if (!isOpenAiApiKeySet()) {
      return res.status(400).json({ error: "OpenAI API key is not set. Check your environment variables." });
    }

    try {
      const orchestration = await getOrchestration(
        teamId, question, conversationHistory, aiConversationId, req.user.id, context, clientTurnId
      );
      return res.json({ orchestration });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  // Get available tools
  app.get("/ai/tools", apiLimiter(10), verifyToken, checkAccess, async (req, res) => {
    try {
      const tools = await getAvailableTools();
      res.json({ tools });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get user conversations for a team (paginated, archive-filtered, searchable).
  // Rate limit is deliberately high: a debounced search fires a request per
  // settled keystroke burst, "Load more" one per page, and the client already
  // refreshes the list after every orchestration. express-rate-limit keys on IP
  // by default, so everyone behind one NAT shares this bucket.
  app.get("/ai/conversations", apiLimiter(60), verifyToken, checkAccess, async (req, res) => {
    const {
      teamId, limit, offset, statuses, starred, search
    } = req.query;

    if (!teamId || !req.user.id) {
      return res.status(400).json({ error: "teamId and userId are required" });
    }

    try {
      const result = await getConversations(teamId, req.user.id, {
        limit,
        offset,
        // Comma-separated because this app runs the "simple" query parser, so
        // repeated/bracketed params never parse into an array.
        statuses: typeof statuses === "string" && statuses
          ? statuses.split(",").map((s) => s.trim()).filter(Boolean)
          : [],
        // Query strings are always strings.
        starred: starred === "true" || starred === "1",
        search: typeof search === "string" ? search : "",
      });
      return res.json(result);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  // Get a specific conversation
  app.get("/ai/conversations/:conversationId", apiLimiter(20), verifyToken, checkAccess, async (req, res) => {
    const { conversationId } = req.params;
    const { teamId } = req.query;

    if (!teamId) {
      return res.status(400).json({ error: "teamId is required" });
    }

    try {
      const conversation = await getConversation(conversationId, teamId);
      return res.json({ conversation });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  // Delete a conversation
  app.delete("/ai/conversations/:conversationId", apiLimiter(10), verifyToken, checkAccess, async (req, res) => {
    const { conversationId } = req.params;
    const { teamId } = req.query;

    if (!teamId) {
      return res.status(400).json({ error: "teamId is required" });
    }

    try {
      const result = await deleteConversation(conversationId, teamId, req.user.id);
      return res.json(result);
    } catch (error) {
      if (error.message === "Conversation not found") {
        return res.status(404).json({ error: error.message });
      }
      return res.status(500).json({ error: error.message });
    }
  });

  // Rename a conversation
  app.patch("/ai/conversations/:conversationId", apiLimiter(10), verifyToken, checkAccess, async (req, res) => {
    const { conversationId } = req.params;
    const { teamId, title } = req.body;

    if (!teamId) {
      return res.status(400).json({ error: "teamId is required" });
    }

    if (!title || !title.trim()) {
      return res.status(400).json({ error: "title is required" });
    }

    try {
      const result = await renameConversation(conversationId, teamId, title.trim(), req.user.id);
      return res.json(result);
    } catch (error) {
      if (error.message === "Conversation not found") {
        return res.status(404).json({ error: error.message });
      }
      return res.status(500).json({ error: error.message });
    }
  });

  // Archive / unarchive a conversation.
  //
  // Deliberately NOT folded into PATCH /ai/conversations/:conversationId: that
  // handler hard-requires a non-empty title, and loosening it would mean a body
  // of just { teamId } returns 200 having changed nothing. Archiving is a state
  // transition, not a field edit — same reasoning as the /fork sub-path. Three
  // path segments, so it cannot collide with the two-segment rename route.
  app.patch("/ai/conversations/:conversationId/archive", apiLimiter(20), verifyToken, checkAccess, async (req, res) => {
    const { conversationId } = req.params;
    const { teamId, archived } = req.body;

    if (!teamId) {
      return res.status(400).json({ error: "teamId is required" });
    }

    if (typeof archived !== "boolean") {
      return res.status(400).json({ error: "archived must be a boolean" });
    }

    try {
      const result = await setConversationArchived(
        conversationId, teamId, req.user.id, archived,
      );
      return res.json(result);
    } catch (error) {
      if (error.message === "Conversation not found") {
        return res.status(404).json({ error: error.message });
      }
      return res.status(500).json({ error: error.message });
    }
  });

  // Star / unstar a conversation. Starred rows pin to the top of the list.
  app.patch("/ai/conversations/:conversationId/star", apiLimiter(30), verifyToken, checkAccess, async (req, res) => {
    const { conversationId } = req.params;
    const { teamId, starred } = req.body;

    if (!teamId) {
      return res.status(400).json({ error: "teamId is required" });
    }

    if (typeof starred !== "boolean") {
      return res.status(400).json({ error: "starred must be a boolean" });
    }

    try {
      const result = await setConversationStarred(
        conversationId, teamId, req.user.id, starred,
      );
      return res.json(result);
    } catch (error) {
      if (error.message === "Conversation not found") {
        return res.status(404).json({ error: error.message });
      }
      return res.status(500).json({ error: error.message });
    }
  });

  // Bulk archive / unarchive / delete.
  //
  // POST with a JSON body rather than DELETE with array query params: this app
  // runs the "simple" query parser (server/index.js), so ids[]=a&ids[]=b would
  // parse as the literal key "ids[]" and never as an array. One route with an
  // `action` field rather than three, since validation, the ownership gate and
  // the response shape are identical for all three verbs.
  app.post("/ai/conversations/bulk", apiLimiter(10), verifyToken, checkAccess, async (req, res) => {
    const { teamId, action, ids } = req.body;

    if (!teamId) {
      return res.status(400).json({ error: "teamId is required" });
    }

    try {
      const result = await bulkUpdateConversations(teamId, req.user.id, action, ids);
      return res.json(result);
    } catch (error) {
      // Every throw in bulkUpdateConversations is a caller/validation error.
      if (/^(action must be|ids must be|Cannot process more than)/.test(error.message)) {
        return res.status(400).json({ error: error.message });
      }
      return res.status(500).json({ error: error.message });
    }
  });

  // Fork a conversation (optionally share to a teammate)
  app.post("/ai/conversations/:conversationId/fork", apiLimiter(10), verifyToken, checkAccess, async (req, res) => {
    const { conversationId } = req.params;
    const { teamId, targetUserId } = req.body;

    if (!teamId) {
      return res.status(400).json({ error: "teamId is required" });
    }

    // If sharing to another user, verify they belong to the team
    if (targetUserId) {
      const teamController = new TeamController();
      const targetRole = await teamController.getTeamRole(teamId, targetUserId);
      if (!targetRole) {
        return res.status(400).json({ error: "Target user is not a member of this team" });
      }
    }

    try {
      const result = await forkConversation(conversationId, teamId, req.user.id, targetUserId);
      return res.json(result);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  // Submit feedback on a message (thumbs up/down)
  app.patch("/ai/conversations/:conversationId/messages/:messageId/feedback", apiLimiter(20), verifyToken, checkAccess, async (req, res) => {
    const { conversationId, messageId } = req.params;
    const { teamId, feedback } = req.body;

    if (!teamId) {
      return res.status(400).json({ error: "teamId is required" });
    }

    try {
      const result = await submitMessageFeedback(conversationId, messageId, teamId, feedback);
      return res.json(result);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  // Get team usage statistics (for billing/analytics)
  app.get("/ai/usage/:teamId", apiLimiter(20), verifyToken, checkAccess, async (req, res) => {
    const { teamId } = req.params;
    const { startDate, endDate } = req.query;

    if (!teamId) {
      return res.status(400).json({ error: "teamId is required" });
    }

    try {
      const usage = await getAiUsage(teamId, startDate, endDate);
      return res.json(usage);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  return (req, res, next) => {
    next();
  };
};
