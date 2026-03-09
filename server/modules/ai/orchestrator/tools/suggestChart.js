const { aiClient, aiModel } = require("../../aiClient");

async function suggestChart(payload) {
  const {
    question, result_shape
  } = payload;

  if (!aiClient) {
    return {
      type: "table",
      title: "Query Results",
      encodings: {},
      options: {},
    };
  }

  // Use AI to suggest appropriate chart type
  const prompt = `Based on the question "${question}" and result columns ${JSON.stringify(result_shape.columns)}, suggest the most appropriate chart type and configuration.

Available chart types: line, bar, pie, doughnut, radar, polar, table, kpi, avg, gauge.

Respond with JSON only: { "type": "...", "title": "...", "encodings": {}, "options": {} }`;

  try {
    const response = await aiClient.chat.completions.create({
      model: aiModel,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 300,
    });

    const suggestion = JSON.parse(response.choices[0].message.content);
    return suggestion;
  } catch (error) {
    return {
      type: "table",
      title: "Query Results",
      encodings: {},
      options: {},
      notes: `Chart suggestion failed: ${error.message}`,
    };
  }
}

module.exports = suggestChart;
