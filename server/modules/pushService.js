const webpush = require("web-push");

const db = require("../models/models");
const settings = require("../settings");
const logger = require("./logger").child({ module: "pushService" });

// Configure web-push with this deployment's VAPID identity. When keys are
// absent, push is treated as disabled and every send becomes a no-op so the
// rest of the app (notifications, socket sync) keeps working untouched.
let configured = false;
try {
  if (settings.vapid && settings.vapid.publicKey && settings.vapid.privateKey) {
    webpush.setVapidDetails(
      settings.vapid.subject,
      settings.vapid.publicKey,
      settings.vapid.privateKey,
    );
    configured = true;
    logger.info("Web Push (VAPID) configured");
  } else {
    logger.info("Web Push not configured (CB_VAPID_* unset) — push notifications disabled");
  }
} catch (err) {
  logger.warn({ err }, "Failed to configure Web Push VAPID details — push notifications disabled");
  configured = false;
}

function isConfigured() {
  return configured;
}

function getPublicKey() {
  return configured ? settings.vapid.publicKey : null;
}

// Deliver a payload to a single stored subscription. Returns { ok, prune } so
// the caller can drop subscriptions the push service reports as gone.
async function sendToSubscription(subscriptionRow, payload) {
  const subscription = {
    endpoint: subscriptionRow.endpoint,
    keys: {
      p256dh: subscriptionRow.p256dh,
      auth: subscriptionRow.auth,
    },
  };

  try {
    await webpush.sendNotification(subscription, payload);
    return { ok: true, prune: false };
  } catch (err) {
    // 404/410 mean the subscription is permanently gone — prune it. Other
    // errors (e.g. transient 5xx) are logged but the row is kept.
    const status = err && err.statusCode;
    const prune = status === 404 || status === 410;
    if (!prune) {
      logger.warn({ err, status }, "Web Push send failed");
    }
    return { ok: false, prune };
  }
}

/**
 * Send a push notification to every device a user has subscribed, honouring
 * their master preference. Best-effort: never throws, prunes dead subscriptions.
 *
 * @param {number} userId
 * @param {{ title: string, body?: string, tag?: string, data?: object }} payload
 */
async function sendToUser(userId, payload) {
  if (!configured || !userId) return;

  try {
    const user = await db.User.findByPk(userId, { attributes: ["id", "pushNotificationsEnabled"] });
    // Respect the per-user master switch; default-on for legacy rows.
    if (!user || user.pushNotificationsEnabled === false) return;

    const subscriptions = await db.PushSubscription.findAll({ where: { user_id: userId } });
    if (!subscriptions.length) return;

    const body = JSON.stringify({
      title: payload.title || "Edison — SmartChart",
      body: payload.body || "",
      tag: payload.tag,
      data: payload.data || {},
    });

    const results = await Promise.allSettled(
      subscriptions.map((sub) => sendToSubscription(sub, body)),
    );

    const deadIds = [];
    results.forEach((res, i) => {
      if (res.status === "fulfilled" && res.value.prune) {
        deadIds.push(subscriptions[i].id);
      }
    });

    if (deadIds.length) {
      await db.PushSubscription.destroy({ where: { id: deadIds } });
      logger.debug({ userId, pruned: deadIds.length }, "Pruned expired push subscriptions");
    }
  } catch (err) {
    // Push is a best-effort side channel — swallow everything so it can never
    // break notification creation.
    logger.warn({ err, userId }, "sendToUser failed");
  }
}

module.exports = {
  isConfigured,
  getPublicKey,
  sendToUser,
};
