// NOTE: we need this to clean authcache when some auth fails
// due to user closing window and continuing auth on mobile device
// very rare case, but just in case, so we don't pollute authcache table
const moment = require("moment");
const cron = require("node-cron");

const db = require("../models/models");
const logger = require("./logger").child({ module: "CleanAuthCache" });

function clean() {
  return db.AuthCache.findAll()
    .then((cache) => {
      const cleanPromises = [];
      for (const item of cache) {
        const timeDiff = moment().diff(item.createdAt, "hours");

        if (timeDiff > 23) {
          cleanPromises.push(db.AuthCache.destroy({ where: { id: item.id } }));
        }
      }

      if (cleanPromises.length > 0) return Promise.all(cleanPromises);

      return [];
    })
    .catch((err) => {
      logger.warn({ err }, "Error while cleaning auth caches; manual cleanup may be required");
    });
}

module.exports = () => {
  clean();

  // now run the cron job every hour
  cron.schedule("0 * * * *", () => {
    clean();
  });

  return true;
};
