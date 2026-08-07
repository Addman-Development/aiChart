// Helpers for navigating into the Edison chat page.
//
// The chat lives on its own full-viewport route, so it can no longer read the
// dashboard/dataset params off the active URL the way the old modal could
// (the modal was mounted inside whatever route was showing). Entry points
// instead record the path they left behind in navigation state, and the page
// parses the ids back out of it to pre-seed context chips — and to know where
// the Back control should return to.

export const EDISON_PATH = "/edison";

/** Navigation options every Edison entry point should pass. */
export function edisonNavState(pathname) {
  return { state: { from: pathname } };
}

/**
 * Pull the entity ids Edison can use as context out of a client path.
 * Mirrors the flat route scheme in App.jsx / Main.jsx.
 */
export function parseContextFromPath(pathname) {
  const context = {
    projectId: null, chartId: null, connectionId: null, datasetId: null,
  };
  if (!pathname || typeof pathname !== "string") return context;

  const toId = (value) => {
    const parsed = parseInt(value, 10);
    return Number.isNaN(parsed) ? null : parsed;
  };

  // Chart edit is checked before the plain dashboard match so both ids land.
  const chart = pathname.match(/^\/dashboard\/(\d+)\/chart\/(\d+)\/edit/);
  if (chart) {
    context.projectId = toId(chart[1]);
    context.chartId = toId(chart[2]);
    return context;
  }

  const dashboard = pathname.match(/^\/dashboard\/(\d+)/);
  if (dashboard) {
    context.projectId = toId(dashboard[1]);
    return context;
  }

  const connection = pathname.match(/^\/connections\/(\d+)/);
  if (connection) {
    context.connectionId = toId(connection[1]);
    return context;
  }

  const dataset = pathname.match(/^\/datasets\/(\d+)/);
  if (dataset) {
    context.datasetId = toId(dataset[1]);
  }

  return context;
}
