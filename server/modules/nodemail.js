const nodemailer = require("nodemailer");
const ejs = require("ejs");

const settings = require("../settings");
const logger = require("./logger").child({ module: "nodemail" });

const transportConfig = process.env.NODE_ENV === "test"
  ? { jsonTransport: true }
  : settings.mailSettings;

const nodemail = nodemailer.createTransport(transportConfig);

module.exports.sendInvite = (invite, admin, teamName) => {
  const inviteUrl = `${settings.client}/invite?team_id=${invite.team_id}&token=${invite.token}`;

  const message = {
    from: settings.adminMail,
    to: invite.email,
    subject: "Edison - Join the team",
    text: `
      Hi there,

      You have been invited to join ${teamName}. Please click the link below to register your account.

      ${inviteUrl}

      - Edison
    `,
    html: `
      <h3>Hi there 👋</h3>

      <p>You have been invited to join ${teamName}. Please click the link below to register your account.</p>

      <p>${inviteUrl}</p>

      - Edison
    `,
  };

  return nodemail.sendMail(message);
};

module.exports.sendUserCreatedInvite = (data) => {
  const message = {
    from: settings.adminMail,
    to: data.email,
    subject: "Edison - Your account has been created",
    text: `
      Hi ${data.name},

      An account has been created for you on ${data.teamName}.

      Click the link below to log in - your credentials will be filled in automatically:

      ${data.loginUrl}

      If the link doesn't work, you can log in manually with:
      Email: ${data.email}
      Temporary Password: ${data.temporaryPassword}

      You will be asked to change your password on your first login.

      - Edison
    `,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h3>Hi ${data.name},</h3>

        <p>An account has been created for you on <strong>${data.teamName}</strong>.</p>

        <p>Click the button below to log in - your credentials will be filled in automatically:</p>

        <div style="text-align: center; margin: 24px 0;">
          <a href="${data.loginUrl}"
             style="background-color: #006FEE; color: #ffffff; padding: 12px 32px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">
            Log in to Edison
          </a>
        </div>

        <p style="color: #666; font-size: 13px;">If the button doesn't work, copy and paste this link into your browser:</p>
        <p style="color: #666; font-size: 13px; word-break: break-all;">${data.loginUrl}</p>

        <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />

        <p style="color: #666; font-size: 13px;">Or log in manually with:</p>
        <table style="border-collapse: collapse; margin: 8px 0; font-size: 13px; color: #666;">
          <tr>
            <td style="padding: 4px 12px 4px 0; font-weight: bold;">Email</td>
            <td style="padding: 4px 0;">${data.email}</td>
          </tr>
          <tr>
            <td style="padding: 4px 12px 4px 0; font-weight: bold;">Temporary Password</td>
            <td style="padding: 4px 0;"><code>${data.temporaryPassword}</code></td>
          </tr>
        </table>

        <p><strong>You will be asked to change your password on your first login.</strong></p>

        <p>- Edison</p>
      </div>
    `,
  };

  return nodemail.sendMail(message);
};

module.exports.sendAccessRequest = (data) => {
  const reasonBlockText = data.reason ? `\n      Reason: ${data.reason}\n` : "";
  const reasonBlockHtml = data.reason
    ? `<p><strong>Reason:</strong><br/>${data.reason.replace(/\n/g, "<br/>")}</p>`
    : "";

  const message = {
    from: settings.adminMail,
    to: data.ownerEmail,
    subject: `Edison - Access request for ${data.teamName}`,
    text: `
      Hi ${data.ownerName || "there"},

      ${data.requesterName || data.requesterEmail} has requested access to ${data.teamName}.

      Email: ${data.requesterEmail}${reasonBlockText}

      Review and approve from the team members page:
      ${data.reviewUrl}

      - Edison
    `,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h3>Access request for ${data.teamName}</h3>

        <p><strong>${data.requesterName || data.requesterEmail}</strong> has requested access to <strong>${data.teamName}</strong>.</p>

        <table style="border-collapse: collapse; margin: 8px 0; font-size: 14px;">
          <tr>
            <td style="padding: 4px 12px 4px 0; font-weight: bold;">Email</td>
            <td style="padding: 4px 0;">${data.requesterEmail}</td>
          </tr>
          ${data.requesterName ? `<tr><td style="padding: 4px 12px 4px 0; font-weight: bold;">Name</td><td style="padding: 4px 0;">${data.requesterName}</td></tr>` : ""}
        </table>

        ${reasonBlockHtml}

        <div style="text-align: center; margin: 24px 0;">
          <a href="${data.reviewUrl}"
             style="background-color: #006FEE; color: #ffffff; padding: 12px 32px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">
            Review request
          </a>
        </div>

        <p style="color: #666; font-size: 13px;">If the button doesn't work, paste this link into your browser:</p>
        <p style="color: #666; font-size: 13px; word-break: break-all;">${data.reviewUrl}</p>

        <p>- Edison</p>
      </div>
    `,
  };

  return nodemail.sendMail(message);
};

module.exports.passwordReset = (data) => {
  const message = {
    from: settings.adminMail,
    to: data.email,
    subject: "Edison - Reset your password",
    text: `
      Reset your Edison password

      You can reset your password by clicking the link below:

      ${data.resetUrl}

      Cheers,
      Edison
    `,
    html: `
      <h3>Reset your Edison password 🔑</h3>

      <p>You can reset your password by clicking the link below:</p>

      <p>${data.resetUrl}</p>

      Cheers,
      Edison
    `,
  };

  return nodemail.sendMail(message);
};

module.exports.sendChartAlert = (data) => {
  const message = {
    from: settings.adminMail,
    bcc: data.recipients,
    subject: `Edison - ${data.chartName} alert`,
  };

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
  message.text += "- Edison";

  ejs.renderFile(`${__dirname}/emailTemplates/alert.ejs`, {
    chartName: data.chartName,
    thresholdText: data.thresholdText,
    alerts: data.alerts,
    dashboardUrl: data.dashboardUrl,
    snapshotUrl: data.snapshotUrl,
  }, (err, str) => {
    if (err) {
      logger.error({ err, template: "alert" }, "Failed to render email template");
    }
    message.html = str;

    return nodemail.sendMail(message);
  });
};

module.exports.emailUpdate = (data) => {
  const message = {
    from: settings.adminMail,
    to: data.email,
    subject: "Edison - new email confirmation",
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
    subject: `Edison - ${data.projectName} snapshot`,
  };

  ejs.renderFile(`${__dirname}/emailTemplates/snapshot.ejs`, {
    projectName: data.projectName,
    dashboardUrl: data.dashboardUrl,
    snapshotUrl: data.snapshotUrl,
  }, (err, str) => {
    if (err) {
      logger.error({ err, template: "snapshot" }, "Failed to render email template");
    }
    message.html = str;

    return nodemail.sendMail(message);
  });
};
