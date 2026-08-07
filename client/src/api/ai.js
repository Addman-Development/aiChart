import { API_HOST } from "../config/settings";
import { getAuthToken } from "../modules/auth";

// Same shape as the helper in api/notification.js. Used by the functions below;
// the older ones in this file still inline their own Headers, and are left alone
// on purpose so this change doesn't touch working request code.
const authHeaders = (json = false) => {
  const token = getAuthToken();
  const headers = new Headers({
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
  });
  if (json) headers.set("Content-Type", "application/json");
  return headers;
};

/**
 * List conversations. Returns { conversations, total, activeCount, archivedCount,
 * starredCount, limit, offset, hasMore, statuses, starred, search }.
 *
 * `statuses` is an array drawn from ("active", "archived") — both may be sent to
 * get one merged list. It's serialised comma-separated because the API runs the
 * "simple" query parser, which never parses repeated params into an array.
 *
 * Built with URL/searchParams rather than a template string so the search term
 * is percent-encoded — a raw template breaks on &, #, + and % in a user's query.
 */
export async function getAiConversations(teamId, {
  limit, offset, statuses, starred, search,
} = {}) {
  const url = new URL(`${API_HOST}/ai/conversations`);
  url.searchParams.set("teamId", teamId);
  if (limit != null) url.searchParams.set("limit", limit);
  if (offset != null) url.searchParams.set("offset", offset);
  if (Array.isArray(statuses) && statuses.length) {
    url.searchParams.set("statuses", statuses.join(","));
  }
  if (starred) url.searchParams.set("starred", "true");
  if (search) url.searchParams.set("search", search);

  const response = await fetch(url.toString(), { headers: authHeaders(), method: "GET" });
  if (!response.ok) {
    throw new Error("Failed to fetch AI conversations");
  }

  return response.json();
}

export async function getAiConversation(conversationId, teamId) {
  const token = getAuthToken();
  const url = `${API_HOST}/ai/conversations/${conversationId}?teamId=${teamId}`;
  const headers = new Headers({
    "Accept": "application/json",
    "Authorization": `Bearer ${token}`,
  });

  const response = await fetch(url, { headers, method: "GET" });

  if (!response.ok) {
    throw new Error("Failed to fetch AI conversation");
  }

  return response.json();
}

export async function orchestrateAi(
  teamId, question, conversationHistory = [], aiConversationId, context = null,
  { timeoutMs = 300000, clientTurnId } = {}
) {
  const token = getAuthToken();
  const url = `${API_HOST}/ai/orchestrate`;
  const headers = new Headers({
    "Accept": "application/json",
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`,
  });

  const body = {
    teamId,
    question,
    conversationHistory,
    aiConversationId,
    context,
    // Echoed back in the "ai-orchestration-complete" socket event so the client
    // can match a completion to the exact turn that issued it.
    clientTurnId
  };

  // Orchestration can run for minutes; without a deadline a dropped/idle
  // connection (proxy/LB timeout) leaves the fetch hanging forever and the UI
  // stuck on "computing". Abort after timeoutMs so the caller can recover (the
  // answer is persisted server-side and also signalled over the socket).
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers,
      method: "POST",
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || "Failed to orchestrate AI");
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function renameAiConversation(conversationId, teamId, title) {
  const token = getAuthToken();
  const url = `${API_HOST}/ai/conversations/${conversationId}`;
  const headers = new Headers({
    "Accept": "application/json",
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`,
  });

  const response = await fetch(url, {
    headers,
    method: "PATCH",
    body: JSON.stringify({ teamId, title })
  });

  if (!response.ok) {
    throw new Error("Failed to rename conversation");
  }

  return response.json();
}

export async function deleteAiConversation(conversationId, teamId) {
  const token = getAuthToken();
  const url = `${API_HOST}/ai/conversations/${conversationId}?teamId=${teamId}`;
  const headers = new Headers({
    "Accept": "application/json",
    "Authorization": `Bearer ${token}`,
  });

  const response = await fetch(url, {
    headers,
    method: "DELETE"
  });

  if (!response.ok) {
    throw new Error("Failed to delete conversation");
  }

  return response.json();
}

/**
 * Archive or unarchive one conversation. A single endpoint handles both
 * directions via the boolean, so callers just pass the state they want.
 */
export async function setAiConversationArchived(conversationId, teamId, archived) {
  const url = `${API_HOST}/ai/conversations/${conversationId}/archive`;

  const response = await fetch(url, {
    headers: authHeaders(true),
    method: "PATCH",
    body: JSON.stringify({ teamId, archived })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Failed to ${archived ? "archive" : "unarchive"} conversation`);
  }

  return response.json();
}

/** Star or unstar one conversation. Starred conversations pin to the top. */
export async function setAiConversationStarred(conversationId, teamId, starred) {
  const url = `${API_HOST}/ai/conversations/${conversationId}/star`;

  const response = await fetch(url, {
    headers: authHeaders(true),
    method: "PATCH",
    body: JSON.stringify({ teamId, starred })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Failed to ${starred ? "star" : "unstar"} conversation`);
  }

  return response.json();
}

/**
 * Bulk mutation. `action` is "archive" | "unarchive" | "delete", max 100 ids.
 * Resolves to { success, action, requested, affected, skipped } — `skipped`
 * holds ids the server refused (not yours, already gone, or malformed), so the
 * caller can report partial success.
 */
export async function bulkUpdateAiConversations(teamId, ids, action) {
  const url = `${API_HOST}/ai/conversations/bulk`;

  const response = await fetch(url, {
    headers: authHeaders(true),
    method: "POST",
    body: JSON.stringify({ teamId, action, ids })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "Failed to update conversations");
  }

  return response.json();
}

export async function submitAiMessageFeedback(conversationId, messageId, teamId, feedback) {
  const token = getAuthToken();
  const url = `${API_HOST}/ai/conversations/${conversationId}/messages/${messageId}/feedback`;
  const headers = new Headers({
    "Accept": "application/json",
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`,
  });

  const response = await fetch(url, {
    headers,
    method: "PATCH",
    body: JSON.stringify({ teamId, feedback })
  });

  if (!response.ok) {
    throw new Error("Failed to submit feedback");
  }

  return response.json();
}

export async function forkAiConversation(conversationId, teamId, targetUserId = null) {
  const token = getAuthToken();
  const url = `${API_HOST}/ai/conversations/${conversationId}/fork`;
  const headers = new Headers({
    "Accept": "application/json",
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`,
  });

  const body = { teamId };
  if (targetUserId) {
    body.targetUserId = targetUserId;
  }

  const response = await fetch(url, {
    headers,
    method: "POST",
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to fork conversation");
  }

  return response.json();
}

export async function getAiUsage(teamId, startDate, endDate) {
  const token = getAuthToken();
  let url = new URL(`${API_HOST}/ai/usage/${teamId}`);
  if (startDate) {
    url.searchParams.set("startDate", startDate);
  }
  if (endDate) {
    url.searchParams.set("endDate", endDate);
  }
  const headers = new Headers({
    "Accept": "application/json",
    "Authorization": `Bearer ${token}`,
  });

  const response = await fetch(url.toString(), { headers, method: "GET" });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to fetch AI usage");
  }

  return response.json();
}
