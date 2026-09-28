/* fee-tracker.js — fee-creep tracker page module.
 *
 * Node-safe: no top-level document/window/localStorage. All DOM work runs
 * inside DOMContentLoaded.
 *
 * Flow: month + fees + volume → effective rate → db.saveFeeEntry (upsert,
 * one per month). Renders the entry table + SVG line chart (chart.js), and
 * db.detectCreep(entries) → prominent banner with the dollar cost of the creep.
 */
import { saveFeeEntry, listFeeEntries, detectCreep, isConfigured, guestNudge } from './db.786d07d3.js';
import { lineChart, fmtBp } from './chart.42f77134.js';

function $(id) { return document.getElementById(id); }
const fmtMoney = (n) => "$" + Math.round(n).toLocaleString("en-CA");
function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); }

function fmtMonth(ym) {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return esc(ym);
  return new Date(y, m - 1, 1).toLocaleDateString("en-CA", { month: "short", year: "numeric" });
}

async function render() {
  const tableWrap = $("entry-table"), chartWrap = $("rate-chart"), banner = $("creep-banner");
  if (!tableWrap || !chartWrap) return;
  let entries = [];
  try { entries = await listFeeEntries(); } catch (e) {
    tableWrap.innerHTML = `<p class="tool-err">Couldn't load your entries (${esc(e && e.message)}).</p>`;
    return;
  }

  if (!entries.length) {
    tableWrap.innerHTML = "<p>Nothing tracked yet. Add your first month above — two minutes.</p>";
    chartWrap.innerHTML = "";
    banner.hidden = true;
    return;
  }

  tableWrap.innerHTML =
    `<table><tr><th>Month</th><th>Fees</th><th>Volume</th><th>Effective rate</th></tr>` +
    entries.map((e) =>
      `<tr><td>${fmtMonth(e.month)}</td><td>${fmtMoney(e.fees)}</td>` +
      `<td>${fmtMoney(e.volume)}</td><td>${fmtBp(e.rate_bp)}</td></tr>`).join("") +
    `</table>`;

  chartWrap.innerHTML = "";
  lineChart(chartWrap, entries.map((e) => ({ x: fmtMonth(e.month), y: e.rate_bp })), {
    label: "Effective rate history",
  });

  const { creepBp, baselineBp, latestBp } = detectCreep(entries);
  if (creepBp > 0) {
    const latest = entries[entries.length - 1];
    const costMonth = Math.round((creepBp / 10000) * latest.volume);
    banner.hidden = false;
    banner.innerHTML =
      `<div class="creep-banner" role="alert">` +
      `<strong>Fee creep detected.</strong> Your rate is up ${creepBp} basis points ` +
      `(from ${fmtBp(baselineBp)} to ${fmtBp(latestBp)}) vs your median — that's roughly ` +
      `<strong>${fmtMoney(costMonth)}/month</strong> you didn't agree to. ` +
      `<a href="contact.html">Free audit?</a> The audit reads twelve months and finds exactly ` +
      `where the extra is coming from.</div>`;
  } else {
    banner.hidden = true;
  }
}

function wire() {
  const form = $("tracker-form"), note = $("tracker-note");
  if (!form) return;

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const month = $("in-month").value;
    const fees = parseFloat($("in-fees").value);
    const volume = parseFloat($("in-volume").value);
    if (!month) { note.innerHTML = "<p class=\"tool-err\">Pick a month.</p>"; return; }
    if (!(fees > 0) || !(volume > 0)) {
      note.innerHTML = "<p class=\"tool-err\">Enter numbers above zero for both fees and volume.</p>";
      return;
    }
    const rateBp = Math.round((fees / volume) * 10000);
    if (!(rateBp > 0 && rateBp < 1500)) {
      note.innerHTML = "<p class=\"tool-err\">That works out to a rate over 15% — check the numbers and try again.</p>";
      return;
    }
    try {
      await saveFeeEntry({ month, fees, volume, rate_bp: rateBp });
      form.reset();
      note.innerHTML = `<p class="fine">${!isConfigured() ? guestNudge + " " : ""}` +
        `Saved — ${fmtBp(rateBp)} for ${esc(month)}. Come back after next month's statement — two minutes.</p>`;
      await render();
    } catch (e) {
      note.innerHTML = `<p class="tool-err">Couldn't save (${esc(e && e.message)}).</p>`;
    }
  });

  render();
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
}
