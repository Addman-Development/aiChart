// Helpers for rendering a dashboard as a single full-width vertical stack on
// phones (< sm), bypassing react-grid-layout. Shared by ProjectDashboard,
// PublicDashboard and Report so the mobile reading order and chart heights stay
// consistent across the authenticated and public views.

// Largest -> smallest breakpoint preference for deriving a reading order.
const BP_ORDER = ["xxxl", "xxl", "xl", "lg", "md", "sm", "xs", "xxs"];

// chart.layout is keyed by breakpoint, each value an [x, y, w, h] array.
function firstLayoutBreakpoint(chart) {
  if (!chart?.layout) return null;
  return BP_ORDER.find((key) => Array.isArray(chart.layout[key])) || null;
}

// Order charts top-to-bottom / left-to-right from their saved grid layout so the
// stacked phone view matches the desktop reading order. Charts without a saved
// layout keep their original array order (stable, appended after positioned ones).
export function sortChartsForStack(charts) {
  if (!Array.isArray(charts)) return [];

  return charts
    .map((chart, index) => {
      const bp = firstLayoutBreakpoint(chart);
      const pos = bp ? { x: chart.layout[bp][0] || 0, y: chart.layout[bp][1] || 0 } : null;
      return { chart, index, pos };
    })
    .sort((a, b) => {
      if (a.pos && b.pos) {
        if (a.pos.y !== b.pos.y) return a.pos.y - b.pos.y;
        if (a.pos.x !== b.pos.x) return a.pos.x - b.pos.x;
        return a.index - b.index;
      }
      if (a.pos) return -1;
      if (b.pos) return 1;
      return a.index - b.index;
    })
    .map((entry) => entry.chart);
}

// A sensible full-width chart height for the phone stack, derived from the chart's
// saved grid height (h) but clamped so charts are neither tiny nor absurdly tall.
export function getMobileChartHeight(chart) {
  const bp = firstLayoutBreakpoint(chart);
  const h = bp ? (chart.layout[bp][3] || 2) : 2;
  return Math.min(Math.max(h * 130, 220), 480);
}
