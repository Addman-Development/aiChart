/**
 * Shared AI Client
 *
 * Supports two providers, controlled by CB_AI_PROVIDER:
 *   "anthropic" (default) — Anthropic SDK direct, wrapped in OpenAI-compatible interface
 *   "litellm"             — OpenAI SDK pointed at a LiteLLM proxy
 *
 * All consumers use the same interface: aiClient.chat.completions.create(...)
 *
 * Env vars:
 *   CB_AI_PROVIDER    - "anthropic" | "litellm"  (default: "anthropic")
 *   CB_AI_API_KEY     - API key (Anthropic key or LiteLLM proxy key)
 *   CB_AI_MODEL       - Model name
 *   CB_AI_BASE_URL    - Base URL (required for litellm, optional for anthropic)
 */

const logger = require("../logger").child({ module: "aiClient" });

const aiProvider = (process.env.CB_AI_PROVIDER || "anthropic").toLowerCase();
const aiKey = process.env.CB_AI_API_KEY || process.env.CB_OPENAI_API_KEY;
const aiModel = process.env.CB_AI_MODEL || process.env.CB_OPENAI_MODEL || "claude-sonnet-4-20250514";
const aiBaseUrl = process.env.CB_AI_BASE_URL;

// ── Anthropic → OpenAI format converters ────────────────────────────────────

function convertMessages(openaiMessages) {
  let systemPrompt = "";
  const messages = [];

  for (const msg of openaiMessages) {
    if (msg.role === "system") {
      systemPrompt += (systemPrompt ? "\n\n" : "") + msg.content;
      continue;
    }

    if (msg.role === "tool") {
      const toolBlock = {
        type: "tool_result",
        tool_use_id: msg.tool_call_id,
        content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
      };
      const prev = messages[messages.length - 1];
      if (prev?.role === "user" && Array.isArray(prev.content) && prev.content[0]?.type === "tool_result") {
        prev.content.push(toolBlock);
      } else {
        messages.push({ role: "user", content: [toolBlock] });
      }
      continue;
    }

    if (msg.role === "assistant" && msg.tool_calls?.length > 0) {
      const content = [];
      if (msg.content) {
        content.push({ type: "text", text: msg.content });
      }
      for (const tc of msg.tool_calls) {
        content.push({
          type: "tool_use",
          id: tc.id,
          name: tc.function.name,
          input: typeof tc.function.arguments === "string"
            ? JSON.parse(tc.function.arguments)
            : tc.function.arguments,
        });
      }
      messages.push({ role: "assistant", content });
      continue;
    }

    messages.push({
      role: msg.role,
      content: msg.content || "",
    });
  }

  return { systemPrompt, messages };
}

function convertTools(openaiTools) {
  if (!openaiTools?.length) return undefined;
  return openaiTools.map((t) => {
    const fn = t.function || t;
    return {
      name: fn.name,
      description: fn.description || "",
      input_schema: fn.parameters || { type: "object", properties: {} },
    };
  });
}

function convertResponse(anthropicResponse) {
  const message = { role: "assistant", content: null, tool_calls: null };
  const textParts = [];
  const toolCalls = [];

  for (const block of anthropicResponse.content || []) {
    if (block.type === "text") {
      textParts.push(block.text);
    } else if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id,
        type: "function",
        function: { name: block.name, arguments: JSON.stringify(block.input) },
      });
    }
  }

  message.content = textParts.length > 0 ? textParts.join("") : null;
  message.tool_calls = toolCalls.length > 0 ? toolCalls : null;

  return {
    id: anthropicResponse.id,
    object: "chat.completion",
    model: anthropicResponse.model,
    choices: [{ index: 0, message, finish_reason: anthropicResponse.stop_reason === "end_turn" ? "stop" : anthropicResponse.stop_reason === "tool_use" ? "tool_calls" : anthropicResponse.stop_reason || "stop" }],
    usage: {
      prompt_tokens: anthropicResponse.usage?.input_tokens || 0,
      completion_tokens: anthropicResponse.usage?.output_tokens || 0,
      total_tokens: (anthropicResponse.usage?.input_tokens || 0) + (anthropicResponse.usage?.output_tokens || 0),
    },
  };
}

// ── Build the client based on provider ──────────────────────────────────────

function buildAnthropicClient() {
  const Anthropic = require("@anthropic-ai/sdk");
  const clientOptions = { apiKey: aiKey };
  if (aiBaseUrl) clientOptions.baseURL = aiBaseUrl;
  const anthropic = new Anthropic(clientOptions);

  return {
    chat: {
      completions: {
        create: async (params) => {
          const { systemPrompt, messages } = convertMessages(params.messages || []);
          const tools = convertTools(params.tools);

          const requestParams = {
            model: params.model || aiModel,
            system: systemPrompt || undefined,
            messages,
            max_tokens: params.max_tokens || 8192,
          };

          if (tools?.length) {
            requestParams.tools = tools;
            if (params.tool_choice === "none") {
              requestParams.tool_choice = { type: "none" };
            } else if (params.tool_choice === "auto" || !params.tool_choice) {
              requestParams.tool_choice = { type: "auto" };
            } else if (params.tool_choice === "required") {
              requestParams.tool_choice = { type: "any" };
            }
          }

          const response = await anthropic.messages.create(requestParams);
          return convertResponse(response);
        },
      },
    },
  };
}

function buildLitellmClient() {
  const OpenAI = require("openai");
  const clientOptions = { apiKey: aiKey };
  if (aiBaseUrl) clientOptions.baseURL = aiBaseUrl;
  return new OpenAI(clientOptions);
}

let aiClient = null;

if (aiKey) {
  if (aiProvider === "litellm") {
    if (!aiBaseUrl) {
      logger.warn(
        { provider: "litellm" },
        "CB_AI_PROVIDER=litellm but CB_AI_BASE_URL is not set. LiteLLM requires a proxy URL."
      );
    }
    aiClient = buildLitellmClient();
    logger.info(
      { provider: "litellm", baseUrl: aiBaseUrl || null, model: aiModel },
      "AI client initialized"
    );
  } else {
    aiClient = buildAnthropicClient();
    logger.info(
      { provider: "anthropic", baseUrl: aiBaseUrl || null, model: aiModel },
      "AI client initialized"
    );
  }
} else {
  logger.warn("CB_AI_API_KEY not set; AI client disabled");
}

module.exports = { aiClient, aiModel };
