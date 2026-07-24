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
// Max output tokens per response. Anthropic requires max_tokens, and the old
// hardcoded 8192 truncated long answers. Set CB_AI_MAX_TOKENS to the configured
// model's max output (128000 for Claude Opus/Sonnet, 64000 for Haiku 4.5); it
// must not exceed the model's limit or the API returns a 400. The 32000
// fallback is a safe, generous default for any current model when the env var
// is unset. NOTE: these are non-streaming requests — very large values rely on
// the SDK auto-extending its HTTP timeout; streaming is preferable for outputs
// that routinely approach the ceiling.
const aiMaxTokens = Number(process.env.CB_AI_MAX_TOKENS) || 32000;

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
            max_tokens: params.max_tokens || aiMaxTokens,
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

          // Stream internally and assemble the final message. Streaming keeps
          // the connection alive with events, so a large max_tokens (up to the
          // model's 128k ceiling) can't trip the SDK's HTTP idle timeout the
          // way a long non-streaming request would. `finalMessage()` returns
          // the same Message shape `create()` did, so callers are unaffected.
          const stream = anthropic.messages.stream(requestParams);
          // Forward incremental text deltas to an optional caller callback (for
          // live UI streaming). Errors in the callback must never break the run.
          if (params.onToken) {
            stream.on("text", (delta) => {
              try { params.onToken(delta); } catch (e) { /* ignore streaming callback errors */ }
            });
          }
          const response = await stream.finalMessage();
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
  const openai = new OpenAI(clientOptions);

  // Wrap chat.completions.create so requests default to aiMaxTokens (callers
  // don't pass max_tokens) and stream internally, assembling the final
  // completion via finalChatCompletion(). Streaming avoids HTTP idle timeouts
  // on large outputs; the returned shape matches a non-streaming completion.
  // An explicit params.max_tokens still wins; include_usage preserves token
  // accounting across the stream.
  return {
    chat: {
      completions: {
        create: (params) => {
          // onToken is a local streaming hook, not an API param — strip it
          // before forwarding the rest to the OpenAI/LiteLLM endpoint.
          const { onToken, ...rest } = params;
          const stream = openai.chat.completions.stream({
            max_tokens: aiMaxTokens,
            stream_options: { include_usage: true },
            ...rest,
          });
          if (onToken) {
            stream.on("content", (delta) => {
              try { onToken(delta); } catch (e) { /* ignore streaming callback errors */ }
            });
          }
          return stream.finalChatCompletion();
        },
      },
    },
  };
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
