import { API_HOST } from "../config/settings";

// sessionStorage keys used to carry a pending feedback submission across the
// Keycloak re-auth redirect, and to guard against re-auth loops.
export const FEEDBACK_PENDING_KEY = "feedback_pending";
export const FEEDBACK_REAUTH_ATTEMPTED_KEY = "feedback_reauth_attempted";

/*
  Starts the Keycloak OIDC login. The server sets the PKCE+state cookie and
  returns the authorization URL; we then full-page redirect to Keycloak. This is
  the same flow the SSO login button uses. Used to transparently re-seed the
  server-side Keycloak token cache when a forwarded token is rejected.
*/
export async function startKeycloakLogin() {
  const response = await fetch(`${API_HOST}/api/keycloak/auth`, {
    method: "GET",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });

  if (!response.ok) {
    throw new Error("Failed to initiate Keycloak login");
  }

  const data = await response.json();
  if (!data.authUrl) {
    throw new Error("No auth URL returned from server");
  }

  window.location.href = data.authUrl;
}
