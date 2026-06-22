/**
 * Keycloak (OIDC) client configuration.
 *
 * The actual OIDC dance lives on the server (see /api/keycloak/auth). The
 * client only needs to know whether Keycloak is wired up so it can show the
 * SSO button on the login screen.
 */
export const isKeycloakConfigured = () => {
  return Boolean(import.meta.env.VITE_KEYCLOAK_ENABLED === "true");
};
