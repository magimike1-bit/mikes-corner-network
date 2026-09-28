/* sim-save.js — "Save this setup" for simulator.html.
 * Captures the full simulator state (sector, all question inputs, item
 * states, training, flags) so it can be stored per-user and restored later.
 * Loaded as a second module on simulator.html; sim-core is already booted
 * by the time this module's top-level code runs (import ordering).
 */
import { S } from './session.d6748862.js';
import {
  loadTypical, renderCatalog, renderSectors, recalc, applySectorInfraDefaults,
} from './sim-core.11b52452.js';
import { saveSimState, loadSimState, updateSimState, logActivity, isConfigured, guestNudge } from './db.fd18dc7a.js';

const INPUT_IDS = ["in-locations", "in-stations", "in-terminals", "in-employees",
  "in-volume", "in-ticket", "in-subsector", "in-rate", "in-revenue", "in-marketplace", "in-tables", "in-bar",
  "in-takeout", "in-drivethru", "in-seats", "in-kiosks", "in-sqft-r", "in-weigh",
  "in-sco", "in-rooms", "in-floors", "in-fb", "in-sqft-g", "in-deli", "in-lottery",
  "in-chairs", "in-trooms", "in-retailct",
  "in-o-how", "in-o-spots", "in-o-cof"];

const clone = (o) => JSON.parse(JSON.stringify(o == null ? {} : o));

/* Which wizard step the setup is being saved from (1–6, from the #step-N
   hash). Drives the dashboard's Complete / In progress / Unknown chips and
   the Edit flow's "reopen at the saved step". Null when unknown. */
function currentStep() {
  const m = /^#step-([1-6])$/.exec(location.hash || "");
  return m ? +m[1] : null;
}

export function captureSetup() {
  const inputs = {};
  INPUT_IDS.forEach((id) => { const el = document.getElementById(id); if (el) inputs[id] = el.value; });
  return {
    v: 1, savedAt: new Date().toISOString(), sector: S.sector, subsector: S.subsector, inputs,
    state: clone(S.state), TRAIN: clone(S.TRAIN),
    techRate: S.techRate, guestWifi: S.guestWifi,
    terminalsTouched: S.terminalsTouched, pinSync: S.pinSync,
    stationsAuto: S.stationsAuto, terminalsAuto: S.terminalsAuto,
    reqsAuto: clone(S.reqsAuto), mapViewPref: S.mapViewPref,
    savedFromStep: currentStep(),
  };
}

export function applySetup(saved) {
  if (!saved || saved.v !== 1 || !saved.state) throw new Error("incompatible-saved-setup");
  S.sector = saved.sector || "retail";
  S.subsector = saved.subsector || null; // P3: null = sector default (first listed sub-sector)
  renderSectors(); applySectorInfraDefaults(); loadTypical();
  Object.entries(saved.inputs || {}).forEach(([id, v]) => {
    const el = document.getElementById(id); if (el && v !== undefined) el.value = v;
  });
  renderCatalog(); // re-derive from the restored question inputs
  Object.keys(S.state).forEach((k) => delete S.state[k]);
  Object.assign(S.state, clone(saved.state));
  if (saved.TRAIN) { Object.keys(S.TRAIN).forEach((k) => delete S.TRAIN[k]); Object.assign(S.TRAIN, clone(saved.TRAIN)); }
  if (saved.techRate != null) S.techRate = saved.techRate;
  S.guestWifi = !!saved.guestWifi;
  S.terminalsTouched = !!saved.terminalsTouched; S.pinSync = !!saved.pinSync;
  if (saved.stationsAuto !== undefined) S.stationsAuto = saved.stationsAuto;
  if (saved.terminalsAuto !== undefined) S.terminalsAuto = saved.terminalsAuto;
  if (saved.reqsAuto) S.reqsAuto = clone(saved.reqsAuto);
  S.mapViewPref = saved.mapViewPref || null;
  renderCatalog(); recalc();
}

function note(msg) {
  // Save feedback lives on the results step (step 6); fall back to the
  // catalog note when the stepper shell is absent.
  const n = document.getElementById("save-note") || document.getElementById("typical-note");
  if (n) n.textContent = msg;
}

async function onSave() {
  // Edit flow: the dashboard stored the setup being edited. Offer to update
  // it in place, or fall through to save-as-new.
  let editInfo = null;
  try { editInfo = JSON.parse(window.sessionStorage.getItem("fra_edit_setup") || "null"); } catch (e) {}
  if (editInfo && editInfo.id) {
    window.sessionStorage.removeItem("fra_edit_setup");
    const doUpdate = window.confirm(
      `Update "${editInfo.name || "Untitled setup"}" with the current values?\n\nOK = update this setup\nCancel = save as a new setup`);
    if (doUpdate) {
      try {
        const rec = await updateSimState(editInfo.id, editInfo.name, captureSetup());
        logActivity("simulator.setup_updated", `Updated setup "${rec.name}"`, { setup_id: editInfo.id });
        note(`💾 Updated "${rec.name}".`);
      } catch (e) {
        note("Couldn't update: " + (e && e.message ? e.message : "unknown error"));
      }
      return;
    }
    // Cancel → fall through to save-as-new below.
  }
  const name = window.prompt("Name this setup (e.g. “Downtown café — 2 lanes”):", "");
  if (name === null) return;
  try {
    const rec = await saveSimState(name.trim() || "Untitled setup", captureSetup());
    logActivity("simulator.setup_saved", `Saved setup "${rec.name}"`,
      { setup_id: rec.id, sector: rec.sector || null });
    note("💾 Saved “" + rec.name + "”" +
      (isConfigured() ? " to your account — find it under My account → My simulators." : ". " + guestNudge));
  } catch (e) {
    note("Couldn't save: " + (e && e.message ? e.message : "unknown error"));
  }
}

function wire() {
  const btn = document.getElementById("btn-save-setup");
  if (btn) btn.addEventListener("click", onSave);
  // cross-page handoff: account.html "Open"/"Edit" stores the id here.
  // fra_load_setup_step carries the step to land on (6 = results for Open,
  // the saved step for Edit); fra_load_setup_name feeds the resume card.
  const loadId = window.sessionStorage.getItem("fra_load_setup");
  if (loadId) {
    const loadName = window.sessionStorage.getItem("fra_load_setup_name") || "";
    const stepRaw = parseInt(window.sessionStorage.getItem("fra_load_setup_step") || "", 10);
    const loadStep = stepRaw >= 1 && stepRaw <= 6 ? stepRaw : 6;
    window.sessionStorage.removeItem("fra_load_setup");
    window.sessionStorage.removeItem("fra_load_setup_name");
    window.sessionStorage.removeItem("fra_load_setup_step");
    // Stash for the resume writer (site-auth.js runs after this module, so
    // this is in place before it writes).
    try {
      window.sessionStorage.setItem("fra_resume_setup",
        JSON.stringify({ setupId: loadId, setupName: loadName || null }));
    } catch (e) {}
    loadSimState(loadId).then((saved) => {
      applySetup(saved);
      logActivity("simulator.setup_loaded", `Opened setup "${loadName || "Untitled setup"}"`, { setup_id: loadId });
      note("📂 Loaded your saved setup — adjust anything and re-save as needed.");
      if (location.hash !== "#step-" + loadStep) location.hash = "#step-" + loadStep;
      else window.scrollTo({ top: 0, behavior: "smooth" });
    }).catch(() => note("That saved setup couldn't be loaded."));
  }
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
}
