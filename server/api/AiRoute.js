const rateLimit = require("express-rate-limit");

const {
  getOrchestration,
  getAvailableTools,
  getConversations,
  getConversation,
  deleteConversation,
  renameConversation,
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
      context
    } = req.body;

    if (!teamId || !req.user.id) {
      return res.status(400).json({ error: "teamId and user ID are required" });
    }

    if (!isOpenAiApiKeySet()) {
      return res.status(400).json({ error: "OpenAI API key is not set. Check your environment variables." });
    }

    try {
      const orchestration = await getOrchestration(
        teamId, question, conversationHistory, aiConversationId, req.user.id, context
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

  // Get user conversations for a team
  app.get("/ai/conversations", apiLimiter(10), verifyToken, checkAccess, async (req, res) => {
    const {
      teamId, limit = 20, offset = 0
    } = req.query;

    if (!teamId || !req.user.id) {
      return res.status(400).json({ error: "teamId and userId are required" });
    }

    try {
      const conversations = await getConversations(
        teamId, req.user.id, parseInt(limit, 10), parseInt(offset, 10)
      );
      return res.json({ conversations });
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
      const result = await deleteConversation(conversationId, teamId);
      return res.json(result);
    } catch (error) {
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
      const result = await renameConversation(conversationId, teamId, title.trim());
      return res.json(result);
    } catch (error) {
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
