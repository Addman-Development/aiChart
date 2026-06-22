const moment = require("moment");
const cron = require("node-cron");
const fs = require("fs");

const db = require("../models/models");
const logger = require("./logger").child({ module: "CleanChartCache" });

function clean() {
  return db.ChartCache.findAll()
    .then((cache) => {
      const cleanPromises = [];
      for (const item of cache) {
        const timeDiff = moment().diff(item.createdAt, "hours");

        if (timeDiff < 23 || !item.filePath) {
          // clean the data field in each cache item
          try {
            if (item.filePath) fs.unlink(item.filePath, () => {});
          } catch (e) { /**/ }
          cleanPromises.push(db.ChartCache.destroy({ where: { id: item.id } }));
        }
      }

      if (cleanPromises.length > 0) return Promise.all(cleanPromises);

      return [];
    })
    .catch((err) => {
      logger.warn({ err }, "Error while cleaning chart caches; manual cleanup may be required");
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
