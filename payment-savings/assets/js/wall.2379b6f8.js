/* wall.js — transparency wall for transparency-wall.html.
 * Submission → db.submitWallEntry; table ← db.getWallAggregates
 * (medians + sample sizes only; raw rows are never client-readable).
 * Node-safe: no top-level document/window/localStorage — DOM work is
 * inside init(), which only runs where document exists.
 */
import { submitWallEntry, getWallAggregates, guestNudge } from './db.e456647d.js';

const SECTOR_LABELS = {
  retail: "Retail",
  restaurant: "Restaurant (full-service)",
  qsr: "Quick-service / café",
  hotel: "Hotel / hospitality",
  grocery: "Grocery / convenience",
  salon: "Salon / services",
};

function fmtMedian(medianBp) {
  return (Number(medianBp) / 100).toFixed(2) + "%";
}

function setStatus(el, msg, kind) {
  el.textContent = msg;
  el.className = "wall-status" + (kind ? " " + kind : "");
}

async function renderAggregates(doc) {
  const table = doc.getElementById("wall-table");
  const tbody = doc.getElementById("wall-tbody");
  const empty = doc.getElementById("wall-empty");
  let rows;
  try {
    rows = await getWallAggregates();
  } catch (e) {
    // Never show an error wall — fall back to the empty state.
    rows = [];
  }
  if (!rows || rows.length === 0) {
    table.hidden = true;
    empty.hidden = false;
    empty.textContent = "No published aggregates yet — be the first to report.";
    return;
  }
  tbody.textContent = "";
  for (const r of rows) {
    const tr = doc.createElement("tr");
    const cells = [
      r.processor,
      SECTOR_LABELS[r.sector] || r.sector,
      r.volume_band,
      fmtMedian(r.median_bp),
      String(r.n),
    ];
    for (const c of cells) {
      const td = doc.createElement("td");
      td.textContent = c == null ? "" : c;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.hidden = false;
  empty.hidden = true;
}

function bindForm(doc) {
  const form = doc.getElementById("wall-form");
  const status = doc.getElementById("wall-status");
  const submit = doc.getElementById("wall-submit");
  if (!form || !status || !submit) return;
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const processor = doc.getElementById("wall-processor").value.trim();
    const sector = doc.getElementById("wall-sector").value;
    const volume_band = doc.getElementById("wall-volume").value;
    const rate = Number(doc.getElementById("wall-rate").value);
    if (!processor) { setStatus(status, "Tell us which processor — suggestions or free text, your call.", "err"); return; }
    if (!sector || !volume_band) { setStatus(status, "Pick a sector and a volume band so your report lands in the right cell.", "err"); return; }
    if (!(rate > 0 && rate < 15)) { setStatus(status, "That rate looks off — enter your effective rate as a percent, like 2.65.", "err"); return; }
    submit.disabled = true;
    setStatus(status, "Submitting…");
    try {
      const res = await submitWallEntry({ processor, sector, volume_band, rate });
      form.reset();
      if (res && res.pending) {
        setStatus(status, "Thanks — your report is saved in this browser. " + guestNudge, "ok");
      } else {
        setStatus(status, "Thanks — your report is in. Once its cell has 3+ reports, it shows up in the aggregates below.", "ok");
      }
      await renderAggregates(doc);
    } catch (e) {
      // Friendly inline message only — never an error wall.
      setStatus(status, "That didn't go through — check the fields and try again.", "err");
    } finally {
      submit.disabled = false;
    }
  });
}

function init() {
  const doc = typeof document === "undefined" ? null : document;
  if (!doc) return;
  bindForm(doc);
  renderAggregates(doc);
}

init();
