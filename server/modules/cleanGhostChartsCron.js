const moment = require("moment");
const cron = require("node-cron");
const { Op } = require("sequelize");

const db = require("../models/models");
const logger = require("./logger").child({ module: "cleanGhostCharts" });

const RETENTION_HOURS = 24;
const CHART_TOOL_NAMES = ["create_chart", "update_chart", "create_temporary_chart"];

// Pull every chart_id mentioned in the tool results of persisted AI
// conversations. We keep these alive even when older than the retention
// window — deleting them would break conversation history (the in-chat chart
// card would render a permanent loading spinner).
async function collectReferencedChartIds() {
  const referenced = new Set();
  const messages = await db.AiMessage.findAll({
    attributes: ["content"],
    where: { role: "tool", tool_name: { [Op.in]: CHART_TOOL_NAMES } },
  });

  for (const msg of messages) {
    if (!msg.content) continue;
    try {
      const parsed = JSON.parse(msg.content);
      if (parsed?.chart_id != null) referenced.add(Number(parsed.chart_id));
      if (parsed?.cloned_chart_id != null) referenced.add(Number(parsed.cloned_chart_id));
    } catch { /* skip non-JSON */ }
  }

  return referenced;
}

async function clean() {
  try {
    const cutoff = moment().subtract(RETENTION_HOURS, "hours").toDate();

    const candidates = await db.Chart.findAll({
      attributes: ["id"],
      where: { createdAt: { [Op.lt]: cutoff } },
      include: [{
        model: db.Project,
        where: { ghost: true },
        required: true,
        attributes: [],
      }],
    });

    if (candidates.length === 0) {
      logger.info({ deleted: 0, candidates: 0 }, "Ghost-chart cleanup: nothing to do");
      return;
    }

    const referenced = await collectReferencedChartIds();
    const toDelete = candidates
      .map((c) => c.id)
      .filter((id) => !referenced.has(id));

    if (toDelete.length === 0) {
      logger.info(
        { deleted: 0, candidates: candidates.length, referenced: referenced.size },
        "Ghost-chart cleanup: all candidates still referenced",
      );
      return;
    }

    const deleted = await db.Chart.destroy({ where: { id: { [Op.in]: toDelete } } });
    logger.info(
      { deleted, candidates: candidates.length, referenced: referenced.size },
      "Ghost-chart cleanup complete",
    );
  } catch (err) {
    logger.warn({ err }, "Ghost-chart cleanup failed");
  }
}

module.exports = () => {
  // run every day at midnight
  cron.schedule("0 0 * * *", () => {
    clean();
  });

  return true;
};

module.exports.clean = clean;
