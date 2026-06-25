const { fn, col, Op } = require("sequelize");

const { orchestrate, availableTools } = require("../modules/ai/orchestrator/orchestrator");
const { aiClient, aiModel } = require("../modules/ai/aiClient");
const db = require("../models/models");
const socketManager = require("../modules/socketManager");
const logger = require("../modules/logger").child({ module: "AiController" });

/**
 * Generate a short conversation title from the user's question and the AI response.
 * Runs as a lightweight, fire-and-forget AI call so it doesn't block the response.
 */
async function generateConversationTitle(question, aiResponse) {
  if (!aiClient) return null;

  try {
    const response = await aiClient.chat.completions.create({
      model: aiModel,
      max_tokens: 60,
      messages: [
        {
          role: "system",
          content: "Generate a short, descriptive title (max 8 words) for a data analytics conversation. Output ONLY the title text, nothing else. No quotes, no punctuation at the end.",
        },
        {
          role: "user",
          content: `User asked: "${question}"\n\nAssistant responded: "${(aiResponse || "").substring(0, 300)}"`,
        },
      ],
    });

    const title = response.choices?.[0]?.message?.content?.trim();
    return title || null;
  } catch (err) {
    logger.warn({ err }, "Failed to generate conversation title");
    return null;
  }
}

async function getOrchestration(
  teamId,
  question,
  conversationHistory,
  aiConversationId,
  userId,
  context = null,
  clientTurnId = null,
) {
  let conversation;

  // Load existing conversation or create new one
  if (aiConversationId) {
    conversation = await db.AiConversation.findByPk(aiConversationId);
    if (!conversation) {
      throw new Error("Conversation not found");
    }
    if (conversation.team_id !== teamId) {
      throw new Error("Conversation does not belong to this team");
    }
  } else {
    // Create new conversation
    conversation = await db.AiConversation.create({
      team_id: teamId,
      user_id: userId,
      title: "New Conversation", // Will be updated by orchestrator
      status: "active",
    });

    // Emit conversation ID to user's room immediately so they can join before orchestration
    socketManager.emitToUser(userId, "conversation-created", {
      conversationId: conversation.id
    });
  }

  // Load conversation history from database if not provided
  let fullHistory = conversationHistory;
  if (!conversationHistory || conversationHistory.length === 0) {
    // Rebuild history from AiMessage table
    const messages = await db.AiMessage.findAll({
      where: { conversation_id: conversation.id },
      order: [["sequence", "ASC"]],
    });

    fullHistory = messages.map((msg) => {
      const messageObj = {
        role: msg.role,
        content: msg.content,
      };

      // Add tool-specific fields
      if (msg.tool_calls) {
        messageObj.tool_calls = msg.tool_calls;
      }
      if (msg.tool_name) {
        messageObj.name = msg.tool_name;
      }
      if (msg.tool_call_id) {
        messageObj.tool_call_id = msg.tool_call_id;
      }

      return messageObj;
    });
  }

  try {
    const orchestration = await orchestrate(teamId, question, fullHistory, conversation, context);

    const finalMessage = orchestration.message;
    const isNewConversation = !conversation || conversation.message_count === 0;

    // Get the starting sequence number (0 for new conversations, or continue from existing)
    const existingMessageCount = await db.AiMessage.count({
      where: { conversation_id: conversation.id }
    });

    // Save new messages to AiMessage table
    // Use newMessageStartIndex from orchestrator to correctly skip system prompt + loaded history
    const sliceFrom = orchestration.newMessageStartIndex ?? existingMessageCount;
    const newMessages = orchestration.conversationHistory
      .slice(sliceFrom)
      .filter((msg) => msg.role !== "system"); // Never persist system prompts
    const messagePromises = newMessages.map((msg, index) => {
      const messageData = {
        conversation_id: conversation.id,
        role: msg.role,
        content: msg.content,
        sequence: existingMessageCount + index,
      };

      // Handle tool calls for assistant messages
      if (msg.tool_calls) {
        messageData.tool_calls = msg.tool_calls;
      }

      // Handle tool result messages
      if (msg.role === "tool") {
        messageData.tool_name = msg.name;
        messageData.tool_call_id = msg.tool_call_id;
        // Store preview of tool result (first 500 chars)
        const resultStr = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
        messageData.tool_result_preview = resultStr.substring(0, 500);
      }

      return db.AiMessage.create(messageData);
    });

    await Promise.all(messagePromises);

    // Save usage records to AiUsage table
    const usagePromises = (orchestration.usageRecords || []).map((usage) => db.AiUsage.create({
      conversation_id: conversation.id,
      team_id: teamId,
      model: usage.model,
      prompt_tokens: usage.prompt_tokens,
      completion_tokens: usage.completion_tokens,
      total_tokens: usage.total_tokens,
      elapsed_ms: usage.elapsed_ms,
      cost_micros: 0, // TODO: Calculate cost based on model pricing
    }));

    await Promise.all(usagePromises);

    // Update conversation metadata
    const updateData = {
      message_count: orchestration.conversationHistory.filter((msg) => msg.role === "user").length,
      status: "active",
      error_message: null,
    };

    await conversation.update(updateData);

    // Authoritative completion signal. The answer is already persisted above, so
    // emit to the user's room — this lets the client finalize the turn even if
    // the long-lived orchestrate HTTP response is lost (proxy/idle timeout),
    // which was the cause of the chat getting stuck on "computing".
    socketManager.emitToUser(userId, "ai-orchestration-complete", {
      conversationId: conversation.id,
      turnId: clientTurnId,
    });

    // Generate title asynchronously for new conversations (don't block the response)
    if (isNewConversation) {
      generateConversationTitle(question, finalMessage)
        .then(async (title) => {
          if (title) {
            await conversation.update({ title });
            // Notify the client so the sidebar updates in real-time
            socketManager.emitToUser(userId, "conversation-updated", {
              conversationId: conversation.id,
              title,
            });
          }
        })
        .catch(() => {}); // swallow — title is best-effort
    }

    return {
      ...orchestration,
      message: finalMessage,
      aiConversationId: conversation.id,
    };
  } catch (error) {
    // Update conversation status on error
    await conversation.update({
      status: "error",
      error_message: error.message,
    });

    // Emit error event via socket
    if (conversation?.id) {
      socketManager.emitProgress(conversation.id, "error", {
        message: "An error occurred during AI orchestration",
        error: error.message
      });
      // Also signal completion-with-error on the user's room so a client whose
      // HTTP connection was lost still stops spinning instead of hanging.
      socketManager.emitToUser(userId, "ai-orchestration-complete", {
        conversationId: conversation.id,
        turnId: clientTurnId,
        error: true,
        errorMessage: error.message,
      });
    }

    throw error;
  }
}

async function getAvailableTools() {
  const tools = await availableTools();
  return tools;
}

async function getConversations(teamId, userId, limit = 20, offset = 0) {
  const conversations = await db.AiConversation.findAll({
    where: {
      team_id: teamId,
      user_id: userId,
    },
    order: [["updatedAt", "DESC"]],
    limit,
    offset,
    attributes: ["id", "title", "status", "message_count", "createdAt", "updatedAt", "source"],
    include: [
      {
        model: db.AiUsage,
        attributes: [],
      }
    ],
  });

  // Compute token totals from AiUsage for each conversation
  const conversationsWithUsage = await Promise.all(conversations.map(async (conv) => {
    const usageStats = await db.AiUsage.findAll({
      where: { conversation_id: conv.id },
      attributes: [
        [fn("SUM", col("total_tokens")), "total_tokens"],
        [fn("SUM", col("prompt_tokens")), "prompt_tokens"],
        [fn("SUM", col("completion_tokens")), "completion_tokens"],
      ],
      raw: true,
    });

    const stats = usageStats[0] || {};

    return {
      id: conv.id,
      title: conv.title,
      source: conv.source,
      status: conv.status,
      message_count: conv.message_count,
      total_tokens: parseInt(stats.total_tokens, 10) || 0,
      prompt_tokens: parseInt(stats.prompt_tokens, 10) || 0,
      completion_tokens: parseInt(stats.completion_tokens, 10) || 0,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
    };
  }));

  return conversationsWithUsage;
}

async function getConversation(conversationId, teamId) {
  const conversation = await db.AiConversation.findOne({
    where: {
      id: conversationId,
      team_id: teamId,
    },
  });

  if (!conversation) {
    throw new Error("Conversation not found");
  }

  // Load messages from AiMessage table
  const messages = await db.AiMessage.findAll({
    where: { conversation_id: conversationId },
    order: [["sequence", "ASC"]],
  });

  // Rebuild full_history for backward compatibility with client
  const fullHistory = messages.map((msg) => {
    const messageObj = {
      id: msg.id,
      role: msg.role,
      content: msg.content,
      feedback: msg.feedback || null,
    };

    // Add tool-specific fields
    if (msg.tool_calls) {
      messageObj.tool_calls = msg.tool_calls;
    }
    if (msg.tool_name) {
      messageObj.name = msg.tool_name;
    }
    if (msg.tool_call_id) {
      messageObj.tool_call_id = msg.tool_call_id;
    }

    return messageObj;
  });

  // Compute token usage stats
  const usageStats = await db.AiUsage.findAll({
    where: { conversation_id: conversationId },
    attributes: [
      [fn("SUM", col("total_tokens")), "total_tokens"],
      [fn("SUM", col("prompt_tokens")), "prompt_tokens"],
      [fn("SUM", col("completion_tokens")), "completion_tokens"],
    ],
    raw: true,
  });

  const stats = usageStats[0] || {};

  // Return conversation with messages and usage stats
  return {
    ...conversation.toJSON(),
    full_history: fullHistory,
    total_tokens: parseInt(stats.total_tokens, 10) || 0,
    prompt_tokens: parseInt(stats.prompt_tokens, 10) || 0,
    completion_tokens: parseInt(stats.completion_tokens, 10) || 0,
  };
}

async function deleteConversation(conversationId, teamId) {
  const conversation = await db.AiConversation.findOne({
    where: {
      id: conversationId,
      team_id: teamId,
    },
  });

  if (!conversation) {
    throw new Error("Conversation not found");
  }

  // Delete messages (AiMessage cascade delete will handle this)
  await db.AiMessage.destroy({
    where: { conversation_id: conversationId }
  });

  // NOTE: We intentionally DO NOT delete AiUsage records
  // They are kept for billing/audit purposes even after conversation deletion
  // The team_id field in AiUsage allows us to track usage history
  // Set conversation_id to NULL in AiUsage records to avoid foreign key constraint
  await db.AiUsage.update(
    { conversation_id: null },
    { where: { conversation_id: conversationId } }
  );

  // Delete the conversation itself
  await conversation.destroy();

  return { success: true };
}

async function getAiUsage(teamId, startDate, endDate) {
  try {
    const whereClause = { team_id: parseInt(teamId, 10) };

    // Add date filtering if provided
    if (startDate || endDate) {
      whereClause.createdAt = {};
      if (startDate) whereClause.createdAt[Op.gte] = new Date(startDate);
      if (endDate) whereClause.createdAt[Op.lte] = new Date(endDate);
    }

    // Get total usage
    const totalUsage = await db.AiUsage.findAll({
      where: whereClause,
      attributes: [
        [fn("SUM", col("total_tokens")), "total_tokens"],
        [fn("SUM", col("prompt_tokens")), "prompt_tokens"],
        [fn("SUM", col("completion_tokens")), "completion_tokens"],
        [fn("SUM", col("cost_micros")), "total_cost_micros"],
        [fn("COUNT", col("id")), "api_calls"],
      ],
      raw: true,
    });

    const formattedTotalUsage = {
      total_tokens: parseInt(totalUsage[0]?.total_tokens, 10) || 0,
      prompt_tokens: parseInt(totalUsage[0]?.prompt_tokens, 10) || 0,
      completion_tokens: parseInt(totalUsage[0]?.completion_tokens, 10) || 0,
      total_cost_micros: parseInt(totalUsage[0]?.total_cost_micros, 10) || 0,
      api_calls: parseInt(totalUsage[0]?.api_calls, 10) || 0,
    };

    // Get usage by model
    const usageByModel = await db.AiUsage.findAll({
      where: whereClause,
      attributes: [
        "model",
        [fn("SUM", col("total_tokens")), "total_tokens"],
        [fn("COUNT", col("id")), "api_calls"],
      ],
      group: ["model"],
      raw: true,
    });

    const formattedUsageByModel = usageByModel.map((model) => {
      return {
        model: model.model,
        total_tokens: parseInt(model.total_tokens, 10) || 0,
        api_calls: parseInt(model.api_calls, 10) || 0,
      };
    });

    return {
      total: formattedTotalUsage,
      byModel: formattedUsageByModel,
    };
  } catch (error) {
    throw new Error(error.message);
  }
}

async function renameConversation(conversationId, teamId, title) {
  const conversation = await db.AiConversation.findOne({
    where: {
      id: conversationId,
      team_id: teamId,
    },
  });

  if (!conversation) {
    throw new Error("Conversation not found");
  }

  await conversation.update({ title });

  return { success: true, title };
}

async function submitMessageFeedback(conversationId, messageId, teamId, feedback) {
  const conversation = await db.AiConversation.findOne({
    where: { id: conversationId, team_id: teamId },
  });

  if (!conversation) {
    throw new Error("Conversation not found");
  }

  const message = await db.AiMessage.findOne({
    where: { id: messageId, conversation_id: conversationId },
  });

  if (!message) {
    throw new Error("Message not found");
  }

  if (feedback !== "positive" && feedback !== "negative" && feedback !== null) {
    throw new Error("Invalid feedback value");
  }

  await message.update({ feedback });

  return { success: true, feedback };
}

async function forkConversation(conversationId, teamId, userId, targetUserId) {
  const source = await db.AiConversation.findOne({
    where: { id: conversationId, team_id: teamId },
  });

  if (!source) {
    throw new Error("Conversation not found");
  }

  const ownerUserId = targetUserId || userId;
  const isShare = !!targetUserId && targetUserId !== userId;

  // Create the forked conversation
  const forked = await db.AiConversation.create({
    team_id: teamId,
    user_id: ownerUserId,
    title: isShare ? `${source.title} (shared)` : `${source.title} (fork)`,
    source: "app",
    status: "active",
    message_count: source.message_count,
  });

  // Copy all messages
  const messages = await db.AiMessage.findAll({
    where: { conversation_id: conversationId },
    order: [["sequence", "ASC"]],
  });

  if (messages.length > 0) {
    const messageCopies = messages.map((msg) => ({
      conversation_id: forked.id,
      role: msg.role,
      content: msg.content,
      tool_calls: msg.getDataValue("tool_calls"),
      tool_name: msg.tool_name,
      tool_call_id: msg.tool_call_id,
      tool_result_preview: msg.tool_result_preview,
      sequence: msg.sequence,
      // feedback is intentionally not copied — it belongs to the original user
    }));

    await db.AiMessage.bulkCreate(messageCopies);
  }

  return {
    id: forked.id,
    title: forked.title,
    shared_to: isShare ? ownerUserId : null,
  };
}

module.exports = {
  getOrchestration,
  getAvailableTools,
  getConversations,
  getConversation,
  deleteConversation,
  renameConversation,
  getAiUsage,
  submitMessageFeedback,
  forkConversation,
};
