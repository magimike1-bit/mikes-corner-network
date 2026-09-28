/* rate-calculator.js — "What's my real rate?" calculator page module.
 *
 * Node-safe: no top-level document/window/localStorage. All DOM work runs
 * inside DOMContentLoaded.
 *
 * Logic:
 *  - effective rate = fees ÷ volume (rate_bp = Math.round(rate * 10000))
 *  - verdict vs data/benchmarks.json. ONLY figures with status "verified"
 *    may be stated as fact (2.36% MPC 2025 average; 2.07% KoronaPOS worked
 *    example, labeled illustrative). Sectors are "verify-before-publishing",
 *    so the page shows "sector benchmark pending verification" instead of a number.
 *  - every run is stored via db.saveRateRun (localStorage fallback in guest mode).
 */
import { saveRateRun, isConfigured, guestNudge } from './db.e456647d.js';

const AVG_BP = 236; // verified: MPC 2025 average Visa/Mastercard effective rate

function $(id) { return document.getElementById(id); }

const fmtMoney = (n) => "$" + Math.round(n).toLocaleString("en-CA");
const fmtPct = (bp) => (bp / 100).toFixed(2) + "%";

const SECTOR_LABELS = {
  retail: "Retail", restaurant: "Restaurant", qsr: "Quick service / café",
  hotel: "Hotel / hospitality", grocery: "Grocery / convenience", salon: "Salon / services",
};

async function loadBenchmarks() {
  try {
    const res = await fetch("data/benchmarks.json");
    if (!res.ok) return null;
    return await res.json();
  } catch (e) { return null; }
}

function verdictFor(rateBp) {
  const diff = rateBp - AVG_BP;
  if (Math.abs(diff) <= 5) return { band: "near-average", diff };
  if (diff > 0) return { band: "above-average", diff };
  return { band: "below-average", diff };
}

function wire() {
  const form = $("rate-form"), out = $("rate-result"), note = $("rate-note");
  if (!form || !out) return;

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    out.hidden = false;
    const fees = parseFloat($("in-fees").value);
    const volume = parseFloat($("in-volume").value);
    const sector = $("in-sector").value;

    if (!(fees > 0) || !(volume > 0)) {
      out.innerHTML = "<p class=\"tool-err\">Enter numbers above zero for both fees and volume.</p>";
      return;
    }
    const rateBp = Math.round((fees / volume) * 10000);
    if (!(rateBp > 0 && rateBp < 1500)) {
      out.innerHTML = "<p class=\"tool-err\">That works out to a rate over 15% — check the numbers and try again.</p>";
      return;
    }

    const bm = await loadBenchmarks();
    const v = verdictFor(rateBp);
    let verdictCopy;
    if (v.band === "above-average") {
      const gap$ = (v.diff / 10000) * volume;
      verdictCopy =
        `<p>Your effective rate is <strong>${fmtPct(rateBp)}</strong> — ` +
        `that's <strong>${fmtPct(v.diff)} above</strong> the 2.36% national average ` +
        `(MPC, 2025). On your volume, the gap is roughly ` +
        `<strong>${fmtMoney(gap$)} a month</strong> — money you're paying over what the average merchant pays.</p>` +
        `<p><a class="btn" href="contact.html">A free audit finds out why — we only get paid if we find it.</a></p>`;
    } else if (v.band === "below-average") {
      verdictCopy =
        `<p>Your effective rate is <strong>${fmtPct(rateBp)}</strong> — ` +
        `that's <strong>${fmtPct(-v.diff)} below</strong> the 2.36% national average ` +
        `(MPC, 2025). That's genuinely good shape.</p>` +
        `<p>Still curious whether there's anything hiding in the fine print? A free audit confirms it — or finds the part the average doesn't catch.</p>` +
        `<p><a class="btn outline" href="contact.html">Get the free audit</a></p>`;
    } else {
      verdictCopy =
        `<p>Your effective rate is <strong>${fmtPct(rateBp)}</strong> — ` +
        `right around the 2.36% national average (MPC, 2025). Average is the starting point, not the goal.</p>` +
        `<p><a class="btn outline" href="contact.html">See if the free audit can beat it</a></p>`;
    }

    const sectorBm = bm && bm.sectors && bm.sectors[sector];
    const sectorLine = (sectorBm && sectorBm.status === "verified" && Array.isArray(sectorBm.band_bp))
      ? `Sector benchmark for ${SECTOR_LABELS[sector] || sector}: ${fmtPct(sectorBm.band_bp[0])}–${fmtPct(sectorBm.band_bp[1])}.`
      : `Sector benchmark for ${SECTOR_LABELS[sector] || sector} is pending verification — we don't quote it as a number until it's sourced.`;

    out.innerHTML =
      `<div class="play">` +
        `<span class="badge">Your result</span>` +
        verdictCopy +
        `<p class="fine">${sectorLine}</p>` +
        `<p class="fine"><strong>One month is a snapshot — the audit reads twelve.</strong> ` +
        `One statement can't tell creep from a seasonal card mix. Twelve months can.</p>` +
        `<p class="fine">Sources: 2.36% = average Visa/Mastercard effective rate across merchants, ` +
        `Merchants Payments Coalition via KoronaPOS (2025). 2.07% = KoronaPOS's worked statement ` +
        `example for a restaurant — <em>illustrative, not a benchmark</em>. No other figures on ` +
        `this page are stated as fact.</p>` +
        `<p><a href="alerts.html">Email me my result</a> · ` +
        `<a href="fee-tracker.html">Track this rate over time</a></p>` +
      `</div>`;

    try {
      await saveRateRun({ fees, volume, rate_bp: rateBp, sector, verdict: v.band });
      if (note && !isConfigured()) note.innerHTML = `<p class="fine">${guestNudge}</p>`;
      else if (note) note.innerHTML = "";
    } catch (e) {
      if (note) note.innerHTML = `<p class="fine">Couldn't save this run (${e && e.message}). The result above is still yours.</p>`;
    }
  });
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
}
