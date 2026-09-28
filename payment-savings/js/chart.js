/* chart.js — tiny dependency-free SVG line chart for rate history. */
export function lineChart(el, points, opts = {}) {
  // points: [{x: label, y: number}]. Renders an SVG line + dots + labels.
  const W = opts.w || 560, H = opts.h || 200, P = 34;
  const ys = points.map((p) => p.y);
  const lo = Math.min(...ys), hi = Math.max(...ys);
  const span = Math.max(hi - lo, 1);
  const X = (i) => points.length === 1 ? W / 2 : P + (i * (W - 2 * P)) / (points.length - 1);
  const Y = (v) => H - P - ((v - lo) / span) * (H - 2 * P);
  const d = points.map((p, i) => (i ? "L" : "M") + X(i).toFixed(1) + "," + Y(p.y).toFixed(1)).join(" ");
  const dots = points.map((p, i) =>
    `<circle cx="${X(i).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="4" fill="#1b9e57">` +
    `<title>${esc(p.x)}: ${(p.y / 100).toFixed(2)}%</title></circle>`).join("");
  const xlabels = points.map((p, i) =>
    `<text x="${X(i).toFixed(1)}" y="${H - 8}" font-size="10" text-anchor="middle" fill="#5b6b7d">${esc(p.x)}</text>`).join("");
  el.innerHTML =
    `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(opts.label || "Rate history chart")}">` +
    `<text x="${P}" y="16" font-size="11" fill="#5b6b7d">${(hi / 100).toFixed(2)}%</text>` +
    `<text x="${P}" y="${H - P + 4}" font-size="11" fill="#5b6b7d">${(lo / 100).toFixed(2)}%</text>` +
    `<path d="${d}" fill="none" stroke="#1b9e57" stroke-width="2.5"/>${dots}${xlabels}</svg>`;
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); }
}
export function fmtBp(bp) { return (bp / 100).toFixed(2) + "%"; }
