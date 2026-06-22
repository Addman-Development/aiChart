const moment = require("moment");
const db = require("../../../../models/models");

/**
 * Detects whether a query uses {{start_date}} and/or {{end_date}} variables.
 */
function queryUsesDateVars(query) {
  if (!query) return false;
  return query.includes("{{start_date}}") || query.includes("{{end_date}}");
}

async function updateDataset(payload) {
  const {
    dataset_id, name, team_id,
    xAxis, yAxis, yAxisOperation, dateField, dateFormat,
    query, conditions, configuration, variables, transform
  } = payload;

  if (!dataset_id) {
    throw new Error("dataset_id is required to update a dataset");
  }

  if (!team_id) {
    throw new Error("team_id is required to update a dataset");
  }

  try {
    // Find the existing dataset
    const dataset = await db.Dataset.findByPk(dataset_id);
    if (!dataset) {
      throw new Error("Dataset not found");
    }

    // Verify team ownership
    if (dataset.team_id !== team_id) {
      throw new Error("Dataset does not belong to the specified team");
    }

    // Update dataset fields (only if provided)
    const datasetUpdates = {};
    if (name !== undefined) datasetUpdates.legend = name;
    if (xAxis !== undefined) datasetUpdates.xAxis = xAxis;
    if (yAxis !== undefined) datasetUpdates.yAxis = yAxis;
    if (yAxisOperation !== undefined) datasetUpdates.yAxisOperation = yAxisOperation;
    if (dateField !== undefined) datasetUpdates.dateField = dateField;
    if (dateFormat !== undefined) datasetUpdates.dateFormat = dateFormat;
    if (conditions !== undefined) datasetUpdates.conditions = conditions;

    if (Object.keys(datasetUpdates).length > 0) {
      await db.Dataset.update(datasetUpdates, { where: { id: dataset_id } });
    }

    // Find and update the main data request
    const dataRequest = await db.DataRequest.findByPk(dataset.main_dr_id);
    if (!dataRequest) {
      throw new Error("DataRequest not found for this dataset");
    }

    // Update data request fields (only if provided)
    const drUpdates = {};
    if (query !== undefined) drUpdates.query = query;
    if (conditions !== undefined) drUpdates.conditions = conditions;
    if (configuration !== undefined) drUpdates.configuration = configuration;
    if (variables !== undefined) drUpdates.variables = variables;
    if (transform !== undefined) drUpdates.transform = transform;

    if (Object.keys(drUpdates).length > 0) {
      await db.DataRequest.update(drUpdates, { where: { id: dataRequest.id } });
    }

    // If the query was updated and now uses date variables, retroactively enable
    // scopeDateToQuery on all charts linked to this dataset
    if (query !== undefined && queryUsesDateVars(query)) {
      const linkedConfigs = await db.ChartDatasetConfig.findAll({
        where: { dataset_id },
        attributes: ["chart_id"],
      });
      if (linkedConfigs.length > 0) {
        const chartIds = linkedConfigs.map((c) => c.chart_id);
        const defaultStart = moment().subtract(30, "days").startOf("day").toDate();
        const defaultEnd = moment().endOf("day").toDate();
        // Only update charts that don't already have scopeDateToQuery enabled
        await db.Chart.update(
          {
            scopeDateToQuery: true,
            startDate: defaultStart,
            endDate: defaultEnd,
            currentEndDate: true,
          },
          {
            where: {
              id: chartIds,
              scopeDateToQuery: false,
            },
          }
        );
      }
    }

    // Refresh the dataset to get updated values
    const updatedDataset = await db.Dataset.findByPk(dataset_id, {
      include: [{
        model: db.DataRequest,
        attributes: ["id", "query", "conditions", "configuration", "variables", "transform"]
      }]
    });

    return {
      dataset_id: updatedDataset.id,
      data_request_id: updatedDataset.main_dr_id,
      name: updatedDataset.legend,
      dataset_url: `${global.clientUrl}/${team_id}/dataset/${updatedDataset.id}`,
      updated_fields: {
        dataset: Object.keys(datasetUpdates),
        data_request: Object.keys(drUpdates)
      }
    };
  } catch (error) {
    throw new Error(`Dataset update failed: ${error.message}`);
  }
}

module.exports = updateDataset;
