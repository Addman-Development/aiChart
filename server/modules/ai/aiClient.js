/**
 * Shared AI Client
 *
 * Uses the OpenAI SDK which is compatible with any OpenAI-compatible API,
 * including LiteLLM, Azure OpenAI, and Claude via LiteLLM proxy.
 *
 * Configuration via env vars:
 *   CB_AI_API_KEY     - API key (falls back to CB_OPENAI_API_KEY for compat)
 *   CB_AI_MODEL       - Model name (e.g. "claude-sonnet-4-20250514", "gpt-4o-mini")
 *   CB_AI_BASE_URL    - Base URL (e.g. "http://localhost:4000" for LiteLLM)
 */

const OpenAI = require("openai");

const aiKey = process.env.CB_AI_API_KEY || process.env.CB_OPENAI_API_KEY;
const aiModel = process.env.CB_AI_MODEL || process.env.CB_OPENAI_MODEL || "gpt-4o-mini";
const aiBaseUrl = process.env.CB_AI_BASE_URL;

let aiClient = null;

if (aiKey) {
  const clientOptions = { apiKey: aiKey };
  if (aiBaseUrl) {
    clientOptions.baseURL = aiBaseUrl;
  }
  aiClient = new OpenAI(clientOptions);
}

module.exports = { aiClient, aiModel };
