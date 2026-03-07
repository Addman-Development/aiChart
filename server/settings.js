module.exports = {
  port: process.env.CB_API_PORT,
  secret: process.env.CB_SECRET,
  encryptionKey: process.env.CB_ENCRYPTION_KEY,
  client: process.env.VITE_APP_CLIENT_HOST,
  api: process.env.CB_API_HOST,
  adminMail: process.env.CB_ADMIN_MAIL,
  mailSettings: {
    host: process.env.CB_MAIL_HOST,
    port: process.env.CB_MAIL_PORT || 465,
    secure: process.env.CB_MAIL_SECURE,
    auth: {
      user: process.env.CB_MAIL_USER,
      pass: process.env.CB_MAIL_PASS,
    },
  },
  azure: {
    clientId: process.env.AZURE_AD_CLIENT_ID,
    clientSecret: process.env.AZURE_AD_CLIENT_SECRET,
    tenantId: process.env.AZURE_AD_TENANT_ID,
    redirectUri: process.env.AZURE_AD_REDIRECT_URI,
    authority: process.env.AZURE_AD_AUTHORITY,
  },
  teamRestricted: process.env.CB_RESTRICT_TEAMS,
  signupRestricted: process.env.CB_RESTRICT_SIGNUP,
};
