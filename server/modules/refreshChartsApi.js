const settings = require("../settings");

module.exports = (projectId, charts, authorization) => {
  charts.forEach((chart) => {
    const url = new URL(`http://${settings.api}:${settings.port}/project/${projectId}/chart/${chart.id}/query`);
    url.searchParams.append("getCache", "true");

    fetch(url.toString(), {
      method: "POST",
      headers: {
        authorization,
        accept: "application/json",
      },
    }).catch(() => {
      // fire and forget
    });
  });
};
