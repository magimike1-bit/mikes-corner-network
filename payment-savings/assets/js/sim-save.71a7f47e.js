/* sim-save.js — "Save this setup" for simulator.html.
 * Captures the full simulator state (sector, all question inputs, item
 * states, training, flags) so it can be stored per-user and restored later.
 * Loaded as a second module on simulator.html; sim-core is already booted
 * by the time this module's top-level code runs (import ordering).
 */
import { S } from './session.babf8dd5.js';
import {
  loadTypical, renderCatalog, renderSectors, recalc, applySectorInfraDefaults,
} from './sim-core.a70ec671.js';
import { saveSimState, loadSimState, isConfigured, guestNudge } from './db.e456647d.js';

const INPUT_IDS = ["in-locations", "in-stations", "in-terminals", "in-employees",
  "in-volume", "in-rate", "in-revenue", "in-marketplace", "in-tables", "in-bar",
  "in-takeout", "in-drivethru", "in-seats", "in-kiosks", "in-sqft-r", "in-weigh",
  "in-sco", "in-rooms", "in-floors", "in-fb", "in-sqft-g", "in-deli", "in-lottery",
  "in-chairs", "in-trooms", "in-retailct"];

const clone = (o) => JSON.parse(JSON.stringify(o == null ? {} : o));

export function captureSetup() {
  const inputs = {};
  INPUT_IDS.forEach((id) => { const el = document.getElementById(id); if (el) inputs[id] = el.value; });
  return {
    v: 1, savedAt: new Date().toISOString(), sector: S.sector, inputs,
    state: clone(S.state), TRAIN: clone(S.TRAIN),
    techRate: S.techRate, guestWifi: S.guestWifi,
    terminalsTouched: S.terminalsTouched, pinSync: S.pinSync,
    stationsAuto: S.stationsAuto, terminalsAuto: S.terminalsAuto,
    reqsAuto: clone(S.reqsAuto), mapViewPref: S.mapViewPref,
  };
}

export function applySetup(saved) {
  if (!saved || saved.v !== 1 || !saved.state) throw new Error("incompatible-saved-setup");
  S.sector = saved.sector || "retail";
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
  const n = document.getElementById("typical-note");
  if (n) n.textContent = msg;
}

async function onSave() {
  const name = window.prompt("Name this setup (e.g. “Downtown café — 2 lanes”):", "");
  if (name === null) return;
  try {
    const rec = await saveSimState(name.trim() || "Untitled setup", captureSetup());
    note("💾 Saved “" + rec.name + "”" +
      (isConfigured() ? " to your account — find it under My account → Saved setups." : ". " + guestNudge));
  } catch (e) {
    note("Couldn't save: " + (e && e.message ? e.message : "unknown error"));
  }
}

function wire() {
  const btn = document.getElementById("btn-save-setup");
  if (btn) btn.addEventListener("click", onSave);
  // cross-page handoff: account.html "Load" stores the id here
  const loadId = window.sessionStorage.getItem("fra_load_setup");
  if (loadId) {
    window.sessionStorage.removeItem("fra_load_setup");
    loadSimState(loadId).then((saved) => {
      applySetup(saved);
      note("📂 Loaded your saved setup — adjust anything and re-save as needed.");
      window.scrollTo({ top: 0, behavior: "smooth" });
    }).catch(() => note("That saved setup couldn't be loaded."));
  }
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
}
