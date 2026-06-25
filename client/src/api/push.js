import { API_HOST } from "../config/settings";
import { getAuthToken } from "../modules/auth";

const authHeaders = (json = false) => {
  const token = getAuthToken();
  const headers = new Headers({
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
  });
  if (json) headers.set("Content-Type", "application/json");
  return headers;
};

// Fetch this deployment's VAPID public key. Returns null when push is not
// configured server-side (404) so callers can disable the feature cleanly.
export async function getVapidKeyApi() {
  const response = await fetch(`${API_HOST}/push/vapid`, {
    method: "GET",
    headers: new Headers({ Accept: "application/json" }),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Failed to fetch push key");
  const data = await response.json();
  return data.publicKey || null;
}

export async function subscribePushApi(subscription) {
  const response = await fetch(`${API_HOST}/push/subscription`, {
    method: "POST",
    headers: authHeaders(true),
    body: JSON.stringify(subscription),
  });
  if (!response.ok) throw new Error("Failed to save push subscription");
  return response.json();
}

export async function unsubscribePushApi(endpoint) {
  const response = await fetch(`${API_HOST}/push/subscription`, {
    method: "DELETE",
    headers: authHeaders(true),
    body: JSON.stringify({ endpoint }),
  });
  if (!response.ok) throw new Error("Failed to remove push subscription");
  return response.json();
}
