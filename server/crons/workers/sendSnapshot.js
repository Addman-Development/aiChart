const { Op } = require("sequelize");
const { DateTime } = require("luxon");

const mail = require("../../modules/mail");
const { snapDashboard } = require("../../modules/snapshots");
const db = require("../../models/models");

const settings = require("../../settings");

const fullApiUrl = process.env.VITE_APP_API_HOST;

async function sendToWebhook({
  project, snapshotUrl, blocks, integration
}) {
  const response = await fetch(integration.config.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      project: project.name,
      snapshotUrl,
      blocks,
    }),
  });

  if (!response.ok) {
    throw new Error(`Webhook request failed with status ${response.status}`);
  }

  return response.text();
}

async function sendSnapshotToEmail(project, snapshotPath, customEmails) {
  if (!project.snapshotSchedule?.mediums?.email?.enabled) {
    return;
  }

  const recipients = customEmails || [];
  const dashboardUrl = `${settings.client}/dashboard/${project.id}`;
  const snapshotUrl = `${fullApiUrl}/${snapshotPath}`;

  await mail.sendDashboardSnapshot({
    projectName: project.name,
    recipients,
    dashboardUrl,
    snapshotUrl,
  });
}

async function sendSnapshotToIntegrations(project, snapshotPath, integrations) {
  if (!integrations || integrations.length === 0) {
    return;
  }

  const dashboardUrl = `${settings.client}/dashboard/${project.id}`;
  const snapshotUrl = `${fullApiUrl}/${snapshotPath}`;

  const integrationPromises = integrations.map(async (integration) => {
    if (integration.type === "webhook") {
      const blocks = [{
        type: "section",
        text: {
          type: "mrkdwn",
          text: `:camera: New dashboard snapshot for *${project.name}*`,
        },
      }, {
        type: "divider",
      }, {
        "type": "section",
        "text": {
          "type": "mrkdwn",
          "text": `<${dashboardUrl}|*View live dashboard*>`,
        }
      }];

      // localhost is not a valid url for the image_url
      if (snapshotUrl && snapshotUrl?.indexOf("localhost") === -1) {
        blocks.push({
          type: "image",
          image_url: snapshotUrl,
          alt_text: `${project.name} snapshot`,
        });
      }

      return sendToWebhook({
        integration,
        project,
        snapshotUrl,
        blocks: integration.config.slackMode ? blocks : [],
      });
    }

    return null;
  });

  await Promise.all(integrationPromises);
}

module.exports = async (job) => {
  try {
    const project = await db.Project.findByPk(job.data.id);
    if (!project) {
      throw new Error("Project not found");
    }

    // Take the snapshot
    const snapshotPath = await snapDashboard(project, project.snapshotSchedule);

    if (!snapshotPath) {
      throw new Error("Failed to take snapshot");
    }

    let integrations = [];
    if (project.snapshotSchedule?.integrations) {
      integrations = await db.Integration.findAll({
        where: {
          id: {
            [Op.in]: project.snapshotSchedule?.integrations?.map((i) => i.integration_id),
          },
        },
      });
    }

    // Send to configured channels
    await sendSnapshotToEmail(project, snapshotPath, project.snapshotSchedule?.customEmails);

    if (integrations.length > 0) {
      await sendSnapshotToIntegrations(project, snapshotPath, integrations);
    }

    // Update last snapshot sent time
    await db.Project.update(
      { lastSnapshotSentAt: DateTime.now().toJSDate(), currentSnapshot: snapshotPath },
      { where: { id: project.id } }
    );

    return true;
  } catch (error) {
    throw new Error(error);
  }
};
