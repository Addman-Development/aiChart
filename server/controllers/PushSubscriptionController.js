const db = require("../models/models");

class PushSubscriptionController {
  /**
   * Store (or refresh) a browser push subscription for a user. Keyed on the
   * endpoint so re-subscribing the same device replaces its row, and so a
   * shared device gets reassigned to whoever is currently logged in.
   *
   * @param {number} userId
   * @param {{ endpoint: string, keys: { p256dh: string, auth: string }, userAgent?: string }} sub
   */
  async subscribe(userId, sub) {
    const endpoint = sub && sub.endpoint;
    const p256dh = sub && sub.keys && sub.keys.p256dh;
    const auth = sub && sub.keys && sub.keys.auth;

    if (!endpoint || !p256dh || !auth) {
      throw new Error("400");
    }

    const userAgent = typeof sub.userAgent === "string" ? sub.userAgent.slice(0, 255) : null;

    const existing = await db.PushSubscription.findOne({ where: { endpoint } });
    if (existing) {
      await existing.update({
        user_id: userId, p256dh, auth, userAgent,
      });
      return existing;
    }

    return db.PushSubscription.create({
      user_id: userId, endpoint, p256dh, auth, userAgent,
    });
  }

  /**
   * Remove a single subscription (this device) for a user.
   */
  async unsubscribe(userId, endpoint) {
    if (!endpoint) throw new Error("400");
    await db.PushSubscription.destroy({ where: { user_id: userId, endpoint } });
    return { unsubscribed: true };
  }

  findByUser(userId) {
    return db.PushSubscription.findAll({ where: { user_id: userId } });
  }
}

module.exports = PushSubscriptionController;
