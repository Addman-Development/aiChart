const nodemailer = require("nodemailer");
const ejs = require("ejs");

const settings = require("../settings");

// setup nodemailer
// In tests we don't want to connect to a real SMTP server.
// jsonTransport stores the email payload in-memory and resolves immediately.
const transportConfig = process.env.NODE_ENV === "test"
  ? { jsonTransport: true }
  : settings.mailSettings;

const nodemail = nodemailer.createTransport(transportConfig);

module.exports.sendInvite = (invite, admin, teamName) => {
  const inviteUrl = `${settings.client}/invite?team_id=${invite.team_id}&token=${invite.token}`;

  const message = {
    from: settings.adminMail,
    to: invite.email,
    subject: "ADDMAN-SmartChart - Join the team",
    text: `
      Hi there,

      You have been invited to join ${teamName}. Please click the link below to register your account.

      ${inviteUrl}

      - ADDMAN-SmartChart
    `,
    html: `
      <h3>Hi there 👋</h3>

      <p>You have been invited to join ${teamName}. Please click the link below to register your account.</p>

      <p>${inviteUrl}</p>

      - ADDMAN-SmartChart
    `,
  };

  return nodemail.sendMail(message);
};

module.exports.sendUserCreatedInvite = (data) => {
  const message = {
    from: settings.adminMail,
    to: data.email,
    subject: "ADDMAN-SmartChart - Your account has been created",
    text: `
      Hi ${data.name},

      An account has been created for you on ${data.teamName}.

      You can log in using the following details:

      Login URL: ${data.loginUrl}
      Email: ${data.email}
      Temporary Password: ${data.temporaryPassword}

      You will be asked to change your password on your first login.

      - ADDMAN-SmartChart
    `,
    html: `
      <h3>Hi ${data.name},</h3>

      <p>An account has been created for you on <strong>${data.teamName}</strong>.</p>

      <p>You can log in using the following details:</p>

      <table style="border-collapse: collapse; margin: 16px 0;">
        <tr>
          <td style="padding: 8px 16px; font-weight: bold;">Login URL</td>
          <td style="padding: 8px 16px;"><a href="${data.loginUrl}">${data.loginUrl}</a></td>
        </tr>
        <tr>
          <td style="padding: 8px 16px; font-weight: bold;">Email</td>
          <td style="padding: 8px 16px;">${data.email}</td>
        </tr>
        <tr>
          <td style="padding: 8px 16px; font-weight: bold;">Temporary Password</td>
          <td style="padding: 8px 16px;"><code>${data.temporaryPassword}</code></td>
        </tr>
      </table>

      <p><strong>You will be asked to change your password on your first login.</strong></p>

      <p>- ADDMAN-SmartChart</p>
    `,
  };

  return nodemail.sendMail(message);
};

module.exports.passwordReset = (data) => {
  const message = {
    from: settings.adminMail,
    to: data.email,
    subject: "ADDMAN-SmartChart - Reset your password",
    text: `
      Reset your ADDMAN-SmartChart password

      You can reset your password by clicking the link below:

      ${data.resetUrl}

      Cheers,
      ADDMAN-SmartChart
    `,
    html: `
      <h3>Reset your ADDMAN-SmartChart password 🔑</h3>

      <p>You can reset your password by clicking the link below:</p>

      <p>${data.resetUrl}</p>

      Cheers,
      ADDMAN-SmartChart
    `,
  };

  return nodemail.sendMail(message);
};

module.exports.sendChartAlert = (data) => {
  const message = {
    from: settings.adminMail,
    bcc: data.recipients,
    subject: `ADDMAN-SmartChart - ${data.chartName} alert`,
  };

  /** TEXT */
  message.text = `Your "${data.chartName}" chart has a new alert`;
  message.text += "\n";
  message.text += `${data.thresholdText}`;
  message.text += "\n";
  for (let i = 0; i < data.alerts.length; i++) {
    message.text += `${data.alerts[i]}`;
    message.text += "\n";
  }
  message.text += `Check your dashboard here: ${data.dashboardUrl}`;
  message.text += "\n";
  message.text += "- ADDMAN-SmartChart";
  // ------------------------------

  ejs.renderFile(`${__dirname}/emailTemplates/alert.ejs`, {
    chartName: data.chartName,
    thresholdText: data.thresholdText,
    alerts: data.alerts,
    dashboardUrl: data.dashboardUrl,
    snapshotUrl: data.snapshotUrl,
  }, (err, str) => {
    if (err) {
      console.log(err); // eslint-disable-line no-console
    }
    message.html = str;

    return nodemail.sendMail(message);
  });
};

module.exports.emailUpdate = (data) => {
  const message = {
    from: settings.adminMail,
    to: data.email,
    subject: "ADDMAN-SmartChart - new email confirmation",
  };

  ejs.renderFile(`${__dirname}/emailTemplates/emailUpdate.ejs`, {
    updateUrl: data.updateUrl,
  }, (err, str) => {
    message.html = str;

    return nodemail.sendMail(message);
  });
};

module.exports.sendDashboardSnapshot = (data) => {
  const message = {
    from: settings.adminMail,
    to: data.recipients,
    subject: `ADDMAN-SmartChart - ${data.projectName} snapshot`,
  };

  ejs.renderFile(`${__dirname}/emailTemplates/snapshot.ejs`, {
    projectName: data.projectName,
    dashboardUrl: data.dashboardUrl,
    snapshotUrl: data.snapshotUrl,
  }, (err, str) => {
    if (err) {
      console.log(err); // eslint-disable-line no-console
    }
    message.html = str;

    return nodemail.sendMail(message);
  });
};
