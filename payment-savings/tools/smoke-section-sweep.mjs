#!/usr/bin/env node
/* Section sweep: boots the modular simulator, then for each of the 6 sectors
   runs every section renderer (catalog, map, training, net plan, margin
   eaters, totals). Catches per-sector/per-section runtime errors. */
import fs from "node:fs";

const ROOT = new URL("../", import.meta.url).pathname.replace(/\/$/, "");

function fakeEl(tag = "div") {
  const el = {
    tagName: tag.toUpperCase(), children: [], dataset: {}, style: {},
    _innerHTML: "", _text: "",
    appendChild(c) { el.children.push(c); return c; },
    append(...cs) { el.children.push(...cs); },
    addEventListener() {}, removeEventListener() {},
    setAttribute() {}, getAttribute() { return null; },
    querySelector() { return fakeEl(); }, querySelectorAll() { return []; },
    getElementsByTagName() { return []; },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    focus() {}, click() {}, scrollIntoView() {},
    getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0 }; },
    closest() { return null; }, matches() { return false; },
    insertAdjacentHTML() {}, remove() {},
    value: "", checked: false, disabled: false, textContent: "",
    options: [], selectedIndex: 0,
  };
  return new Proxy(el, {
    get(t, p) {
      if (p === "innerHTML") return t._innerHTML;
      if (p in t) return t[p];
      return undefined;
    },
    set(t, p, v) {
      if (p === "innerHTML") { t._innerHTML = String(v); return true; }
      t[p] = v; return true;
    },
  });
}

const ids = {};
globalThis.document = {
  getElementById(id) { return ids[id] || (ids[id] = fakeEl()); },
  querySelector() { return fakeEl(); },
  querySelectorAll() { return []; },
  createElement(tag) { return fakeEl(tag); },
  createElementNS(ns, tag) { return fakeEl(tag); },
  addEventListener() {},
  baseURI: "http://localhost/simulator.html",
  body: fakeEl("body"),
  documentElement: fakeEl("html"),
  activeElement: null,
};
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.innerWidth = 1440;
globalThis.location = { hash: "", href: "http://localhost/simulator.html", search: "" };
globalThis.localStorage = {
  _m: {}, getItem(k) { return this._m[k] ?? null; },
  setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; },
};
globalThis.alert = () => {};
globalThis.fetch = async (url) => {
  const m = String(url).match(/data\/([a-z-]+\.json)/);
  if (!m) throw new Error("unexpected fetch: " + url);
  return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(ROOT + "/data/" + m[1], "utf8")) };
};

const errors = [];
process.on("unhandledRejection", e => errors.push("unhandled: " + (e && e.stack || e)));

const core = await import(ROOT + "/js/sim-core.js");
await new Promise(r => setTimeout(r, 300));
const { S } = await import(ROOT + "/js/session.js");
const map = await import(ROOT + "/js/visual-map.js");
const training = await import(ROOT + "/js/training.js");
const net = await import(ROOT + "/js/net-plan.js");
const me = await import(ROOT + "/js/margin-eaters.js");

const sectors = ["restaurant", "qsr", "retail", "hotel", "grocery", "salon"];
let ran = 0;
for (const sec of sectors) {
  try {
    S.sector = sec;
    core.loadTypical();          // derive + auto-build + renderCatalog
    map.renderMap();             // visual setup map
    training.renderTrainingTier(fakeEl());
    training.updateTrainMath();
    net.renderNetPlan();
    me.renderMarginEaters();
    core.recalc();               // totals
    // support-box path per item: toggle support choices on first priced item
    ran++;
    console.log(`  sector ${sec}: OK`);
  } catch (e) {
    errors.push(`sector ${sec}: ` + (e && e.stack || e));
  }
}

// map list/svg toggle + keyboard path
try { S.mapViewPref = "list"; map.renderMap(); S.mapViewPref = "svg"; map.renderMap(); console.log("  map toggle: OK"); }
catch (e) { errors.push("map toggle: " + (e && e.stack || e)); }

if (errors.length) { console.log("SWEEP FAIL:"); errors.forEach(e => console.log(e)); process.exit(1); }
console.log(`SWEEP OK — ${ran}/6 sectors x all sections rendered without throwing`);
