const moment = require("moment");
const db = require("../../../../models/models");
const ChartController = require("../../../../controllers/ChartController");
const ensureGhostProject = require("./ensureGhostProject");

const chartController = new ChartController();

/**
 * Detects whether a query uses {{start_date}} and/or {{end_date}} variables.
 */
function queryUsesDateVars(query) {
  if (!query) return false;
  return query.includes("{{start_date}}") || query.includes("{{end_date}}");
}

/**
 * Create a chart from an existing dataset.
 *
 * The primary chart record always lives in the team's ghost project so that
 * AI chat history keeps a stable reference.  If the caller specifies a real
 * (non-ghost) project_id, a clone is automatically placed on that dashboard
 * via moveChartToDashboard.
 */
async function createChart(payload) {
  const {
    dataset_id, team_id, spec,
    name, legend, type, subType, displayLegend, pointRadius,
    dataLabels, includeZeros, timeInterval, stacked, horizontal,
    xLabelTicks, showGrowth, invertGrowth, mode, maxValue, minValue, ranges,
  } = payload;

  if (!team_id) {
    throw new Error("team_id is required to create a chart");
  }

  if (!name) {
    throw new Error("name is required to create a chart");
  }

  // Provide default chart spec if not provided
  const defaultSpec = {
    type: "line",
    title: "AI Generated Chart",
    timeInterval: "day",
    chartSize: 2,
    displayLegend: true,
    pointRadius: 0,
    dataLabels: false,
    includeZeros: true,
    stacked: false,
    horizontal: false,
    xLabelTicks: "default",
    showGrowth: false,
    invertGrowth: false,
    mode: "chart",
    options: {}
  };

  const chartSpec = spec || defaultSpec;

  try {
    // Get the dataset to get its legend for default values
    const dataset = await db.Dataset.findByPk(dataset_id);
    if (!dataset) {
      throw new Error("Dataset not found");
    }

    // Always create the primary chart in the ghost project so the AI chat
    // history has a stable reference that survives dashboard removals.
    const ghostProject = await ensureGhostProject(team_id);

    // Use the quick-create function to create chart with chart dataset config in one go
    // Layout will be auto-calculated by the controller
    const chart = await chartController.createWithChartDatasetConfigs({
      project_id: ghostProject.id,
      name: name || chartSpec.title || "AI Generated Chart",
      type: type || chartSpec.type,
      subType: subType || chartSpec.subType,
      draft: false,
      // eslint-disable-next-line no-nested-ternary
      displayLegend: displayLegend !== undefined
        ? displayLegend
        : chartSpec.displayLegend !== undefined
          ? chartSpec.displayLegend
          : true,
      pointRadius: pointRadius || chartSpec.pointRadius || 0,
      dataLabels: dataLabels || chartSpec.dataLabels || false,
      // eslint-disable-next-line no-nested-ternary
      includeZeros: includeZeros !== undefined
        ? includeZeros
        : chartSpec.includeZeros !== undefined
          ? chartSpec.includeZeros
          : true,
      timeInterval: timeInterval || chartSpec.timeInterval || "day",
      stacked: stacked ?? chartSpec.stacked ?? chartSpec.options?.stacked ?? false,
      horizontal: horizontal ?? chartSpec.horizontal ?? chartSpec.options?.horizontal ?? false,
      xLabelTicks: xLabelTicks || chartSpec.xLabelTicks || "default",
      showGrowth: showGrowth || chartSpec.showGrowth || false,
      invertGrowth: invertGrowth || chartSpec.invertGrowth || false,
      mode: mode || chartSpec.mode || "chart",
      maxValue: maxValue || chartSpec.maxValue,
      minValue: minValue || chartSpec.minValue,
      ranges: ranges || chartSpec.ranges,
      chartDatasetConfigs: [{
        dataset_id,
        formula: chartSpec.formula,
        datasetColor: chartSpec.datasetColor || chartSpec.options?.color || "#4285F4",
        fillColor: chartSpec.fillColor,
        fill: chartSpec.fill || false,
        multiFill: chartSpec.multiFill || false,
        legend: legend || chartSpec.title || dataset.legend,
        pointRadius: pointRadius || chartSpec.pointRadius || 0,
        excludedFields: chartSpec.excludedFields || [],
        sort: chartSpec.sort,
        columnsOrder: chartSpec.columnsOrder,
        order: 1,
        maxRecords: chartSpec.maxRecords,
        goal: chartSpec.goal,
        configuration: chartSpec.configuration || {}
      }]
    }, null); // No user for AI-created charts

    // Auto-enable scopeDateToQuery when the dataset's query uses date variables
    const dataRequest = await db.DataRequest.findByPk(dataset.main_dr_id);
    if (dataRequest && queryUsesDateVars(dataRequest.query)) {
      const defaultStart = moment().subtract(30, "days").startOf("day").toDate();
      const defaultEnd = moment().endOf("day").toDate();
      await db.Chart.update({
        scopeDateToQuery: true,
        startDate: defaultStart,
        endDate: defaultEnd,
        currentEndDate: true,
      }, { where: { id: chart.id } });
    }

    // Take a snapshot of the chart for visualization
    let snapshot = null;
    try {
      snapshot = await chartController.takeSnapshot(chart.id);
    } catch (snapshotError) {
      // Ignore snapshot errors - chart creation was successful
    }

    return {
      chart_id: chart.id,
      name: chart.name,
      type: chart.type,
      project_id: ghostProject.id,
      ghost_project_id: ghostProject.id,
      is_temporary: true,
      snapshot,
    };
  } catch (error) {
    throw new Error(`Chart creation failed: ${error.message}`);
  }
}

module.exports = createChart;
