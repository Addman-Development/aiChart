const momentObj = require("moment");

/**
 * Resolves a chart's date range into final start/end dates, accounting for:
 * - timezone
 * - currentEndDate (shifting window to present)
 * - fixedStartDate (anchoring start date)
 * - timeInterval snapping (month/year boundaries)
 * - dashboard filter overrides
 * - dateVarsFormat formatting
 *
 * @param {Object} chart - Chart model instance (startDate, endDate, currentEndDate, fixedStartDate, timeInterval, dateVarsFormat)
 * @param {Array} filters - Dashboard filters array (may contain { type: "date", startDate, endDate })
 * @param {string} timezone - Timezone string (e.g. "America/New_York")
 * @returns {{ startDate: moment, endDate: moment, formattedStartDate: string, formattedEndDate: string } | null}
 */
function resolveChartDates(chart, filters, timezone) {
  if (!chart.startDate || !chart.endDate) {
    return null;
  }

  let moment;
  if (timezone) {
    moment = (...args) => momentObj(...args).tz(timezone);
  } else {
    moment = (...args) => momentObj(...args);
  }

  let startDate;
  let endDate;

  if (timezone) {
    startDate = moment(chart.startDate);
    endDate = moment(chart.endDate);
  } else {
    startDate = momentObj.utc(chart.startDate);
    endDate = momentObj.utc(chart.endDate);
  }

  // Snap start date based on timeInterval when using currentEndDate
  if (chart.timeInterval === "month" && chart.currentEndDate && !chart.fixedStartDate) {
    startDate = startDate.startOf("month").startOf("day");
  } else if (chart.timeInterval === "year" && chart.currentEndDate && !chart.fixedStartDate) {
    startDate = startDate.startOf("year").startOf("day");
  } else if (!chart.fixedStartDate) {
    startDate = startDate.startOf("day");
  }

  endDate = endDate.endOf("day");

  // Shift window to present when currentEndDate is enabled
  if (chart.currentEndDate) {
    const timeDiff = endDate.diff(startDate, chart.timeInterval || "day");
    endDate = moment().endOf(chart.timeInterval || "day");

    if (!chart.fixedStartDate) {
      startDate = endDate.clone()
        .subtract(timeDiff, chart.timeInterval || "day")
        .startOf(chart.timeInterval || "day");
    }
  }

  // Dashboard date filter overrides chart-level dates
  if (filters && filters.length > 0) {
    const dateRangeFilter = filters.find(
      (f) => f.type === "date" && f.startDate && f.endDate
    );
    if (dateRangeFilter) {
      startDate = moment(dateRangeFilter.startDate).startOf("day");
      endDate = moment(dateRangeFilter.endDate).endOf("day");
    }
  }

  // Format using dateVarsFormat or default to ISO 8601
  const format = chart.dateVarsFormat || undefined;
  const formattedStartDate = format ? startDate.format(format) : startDate.toISOString();
  const formattedEndDate = format ? endDate.format(format) : endDate.toISOString();

  return {
    startDate,
    endDate,
    formattedStartDate,
    formattedEndDate,
  };
}

module.exports = resolveChartDates;
