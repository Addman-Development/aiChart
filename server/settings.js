module.exports = {
  port: process.env.CB_API_PORT,
  secret: process.env.CB_SECRET,
  encryptionKey: process.env.CB_ENCRYPTION_KEY,
  client: process.env.VITE_APP_CLIENT_HOST,
  api: process.env.CB_API_HOST,
  adminMail: process.env.SMTP_FROM || process.env.CB_ADMIN_MAIL,
  mailSettings: {
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT || 587,
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  },
  keycloak: {
    issuer: process.env.KEYCLOAK_ISSUER,
    clientId: process.env.KEYCLOAK_CLIENT_ID,
    clientSecret: process.env.KEYCLOAK_CLIENT_SECRET,
    redirectUri: process.env.KEYCLOAK_REDIRECT_URI,
    postLogoutRedirectUri: process.env.KEYCLOAK_POST_LOGOUT_REDIRECT_URI,
    scope: process.env.KEYCLOAK_SCOPE,
  },
  signupRestricted: process.env.CB_RESTRICT_SIGNUP,
  ssoAutoCreate: process.env.CB_SSO_AUTOCREATE_USERS !== "false",
};
