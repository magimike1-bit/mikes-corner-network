#!/usr/bin/env node
/* Headless boot smoke test: runs the modular sim-core boot with a Proxy DOM
   that absorbs rendering. Catches: bad imports, undefined fns, JSON shape
   mismatches, cross-module wiring errors. Does NOT validate visual output. */
import fs from "node:fs";

const ROOT = new URL("../", import.meta.url).pathname.replace(/\/$/, "");

// ---- fake element: absorbs everything, is chainable ----
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
};
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.location = { hash: "", href: "http://localhost/simulator.html", search: "" };
globalThis.localStorage = {
  _m: {}, getItem(k) { return this._m[k] ?? null; },
  setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; },
};
globalThis.alert = () => {};
// fetch reads from disk
globalThis.fetch = async (url) => {
  const u = String(url);
  const m = u.match(/data\/([a-z-]+\.json)/);
  if (!m) throw new Error("unexpected fetch: " + u);
  const p = ROOT + "/data/" + m[1];
  return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(p, "utf8")) };
};

const errors = [];
process.on("unhandledRejection", e => { errors.push("unhandled: " + (e && e.stack || e)); });

try {
  await import(ROOT + "/js/sim-core.js");
  // let top-level await boot finish + any queued microtasks
  await new Promise(r => setTimeout(r, 500));
} catch (e) {
  errors.push("boot threw: " + (e && e.stack || e));
}

if (errors.length) { console.log("BOOT FAIL:"); errors.forEach(e => console.log(e)); process.exit(1); }
console.log("BOOT OK — sim-core loaded and boot() completed without throwing");
