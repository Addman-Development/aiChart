/**
 * Azure AD MSAL Configuration
 */

export const msalConfig = {
  auth: {
    clientId: import.meta.env.VITE_AZURE_AD_CLIENT_ID || "",
    authority: import.meta.env.VITE_AZURE_AD_AUTHORITY || "",
    redirectUri: import.meta.env.VITE_AZURE_AD_REDIRECT_URI || "",
  },
  cache: {
    cacheLocation: "sessionStorage",
    storeAuthStateInCookie: false,
  },
};

export const loginRequest = {
  scopes: ["openid", "profile", "email", "User.Read"],
};

/**
 * Check if Azure AD authentication is configured
 * @returns {boolean} True if Azure is configured
 */
export const isAzureConfigured = () => {
  return Boolean(
    import.meta.env.VITE_AZURE_AD_CLIENT_ID
    && import.meta.env.VITE_AZURE_AD_TENANT_ID
    && import.meta.env.VITE_AZURE_AD_AUTHORITY
    && import.meta.env.VITE_AZURE_AD_REDIRECT_URI
  );
};
