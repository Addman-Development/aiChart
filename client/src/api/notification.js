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

export async function getNotificationsApi(teamId) {
  const response = await fetch(`${API_HOST}/team/${teamId}/notification`, {
    method: "GET",
    headers: authHeaders(),
  });
  if (!response.ok) throw new Error("Failed to fetch notifications");
  return response.json();
}

export async function createNotificationApi(teamId, data) {
  const response = await fetch(`${API_HOST}/team/${teamId}/notification`, {
    method: "POST",
    headers: authHeaders(true),
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error("Failed to create notification");
  return response.json();
}

export async function markNotificationReadApi(teamId, id) {
  const response = await fetch(`${API_HOST}/team/${teamId}/notification/${id}/read`, {
    method: "PUT",
    headers: authHeaders(),
  });
  if (!response.ok) throw new Error("Failed to update notification");
  return response.json();
}

export async function markAllNotificationsReadApi(teamId) {
  const response = await fetch(`${API_HOST}/team/${teamId}/notification/read-all`, {
    method: "PUT",
    headers: authHeaders(),
  });
  if (!response.ok) throw new Error("Failed to update notifications");
  return response.json();
}

export async function removeNotificationApi(teamId, id) {
  const response = await fetch(`${API_HOST}/team/${teamId}/notification/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!response.ok) throw new Error("Failed to delete notification");
  return response.json();
}

export async function clearNotificationsApi(teamId) {
  const response = await fetch(`${API_HOST}/team/${teamId}/notification`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!response.ok) throw new Error("Failed to clear notifications");
  return response.json();
}
