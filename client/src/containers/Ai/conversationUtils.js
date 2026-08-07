// Shared helpers for the Edison conversation history UI.
//
// These live in a plain .js module rather than alongside the list components
// because eslint-plugin-react-refresh rejects non-component exports from a .jsx
// component file, and AiPage itself still needs formatTokens for the token
// footer and chat header.

// Rows fetched per "Load more" page.
export const CONVERSATIONS_PAGE_SIZE = 20;

export function formatDate(date) {
  return new Date(date).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function formatTokens(tokens) {
  if (!tokens || tokens === 0) return "0";
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`;
  return tokens.toString();
}
