#!/usr/bin/env node
/* Integration test: drive state changes through the modular APIs and verify
   the displayed totals respond (support changes, item toggles, map wiring). */
import fs from "node:fs";
const ROOT = new URL("../", import.meta.url).pathname.replace(/\/$/, "");

function fakeEl(tag = "div") {
  const el = {
    tagName: tag.toUpperCase(), children: [], dataset: {}, style: {}, _innerHTML: "",
    appendChild(c) { el.children.push(c); return c; }, append(...cs) { el.children.push(...cs); },
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
    get(t, p) { return p === "innerHTML" ? t._innerHTML : (p in t ? t[p] : undefined); },
    set(t, p, v) { if (p === "innerHTML") t._innerHTML = String(v); else t[p] = v; return true; },
  });
}
const ids = {};
globalThis.document = {
  getElementById(id) { return ids[id] || (ids[id] = fakeEl()); },
  querySelector() { return fakeEl(); }, querySelectorAll() { return []; },
  createElement(tag) { return fakeEl(tag); }, createElementNS(ns, tag) { return fakeEl(tag); },
  addEventListener() {}, baseURI: "http://localhost/simulator.html",
  body: fakeEl("body"), documentElement: fakeEl("html"), activeElement: null,
};
globalThis.window = globalThis;
globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {};
globalThis.innerWidth = 1440;
globalThis.location = { hash: "", href: "http://localhost/simulator.html", search: "" };
globalThis.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
globalThis.alert = () => {};
globalThis.fetch = async (url) => {
  const m = String(url).match(/data\/([a-z-]+\.json)/);
  if (!m) throw new Error("unexpected fetch: " + url);
  return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(ROOT + "/data/" + m[1], "utf8")) };
};

const core = await import(ROOT + "/js/sim-core.js");
await new Promise(r => setTimeout(r, 300));
const { S } = await import(ROOT + "/js/session.js");
const ce = await import(ROOT + "/js/cost-engine.js");
const map = await import(ROOT + "/js/visual-map.js");

let pass = 0, fail = 0;
const eq = (n, got, want, tol = 0.01) => { Math.abs(got - want) <= tol ? pass++ : (fail++, console.log(`FAIL ${n}: got ${got}, want ${want}`)); };
const parseMoney = s => parseFloat(String(s).replace(/[^0-9.-]/g, "")) || 0;
const shownTotal = () => parseMoney(ids["grand-total"].textContent);

// 1. baseline: displayed total matches direct recomputation
S.sector = "retail"; core.loadTypical(); core.recalc();
const inp = S.getInputs();
let direct = 0;
for (const it of ce.allItems()) direct += ce.itemMonthly(it, inp);
eq("displayed total = sum of itemMonthly", shownTotal(), direct, 0.5);
console.log(`   baseline monthly total: $${shownTotal().toFixed(2)}`);

// 2. support change moves the total: station-builder printer addon, hybrid (Epson US$24.78/yr)
{
  const st = S.state["station"];
  const addon = st && ce.findItem("station").addons.find(a => a.id === "printer");
  const priced = addon && ce.supportMonthlyFor(addon, "hybrid", 1);
  if (st && st.checked && st.reqs && st.reqs.printer && priced > 0) {
    const before = shownTotal();
    st.reqSupport = Object.assign({}, st.reqSupport, { printer: "hybrid" });
    st.reqInc = 1;
    core.recalc();
    const after = shownTotal();
    console.log(`   hybrid support on station:printer: $${before.toFixed(2)} -> $${after.toFixed(2)}`);
    (after > before) ? pass++ : (fail++, console.log("FAIL hybrid support should raise monthly"));
    eq("hybrid support recorded", st.reqSupport.printer === "hybrid" ? 1 : 0, 1);
    // Joseph rule: support choices survive a typical reset (sector nav)
    core.loadTypical();
    eq("support survives typical reset", S.state["station"].reqSupport && S.state["station"].reqSupport.printer === "hybrid" ? 1 : 0, 1);
    core.recalc();
  } else { fail++; console.log("FAIL no priced addon-support candidate (station:printer)"); }
}

// 3. unchecking an item lowers the total (pick one that actually contributes)
const someId = Object.keys(S.state).find(k => {
  const it = ce.findItem(k);
  return S.state[k].checked && it && ce.itemMonthly(it, S.getInputs()) > 1;
});
const tBefore = shownTotal();
S.state[someId].checked = false; core.recalc();
(shownTotal() < tBefore) ? pass++ : (fail++, console.log("FAIL uncheck should lower total"));
console.log(`   unchecked ${someId}: $${tBefore.toFixed(2)} -> $${shownTotal().toFixed(2)}`);

// 4. map reacts to wiring changes: wifi on a payment zone adds warning content
map.renderMap();
const svgBefore = ids["floorplan"].innerHTML;
const payZone = S.DATA.network.find(z => z.pay);
S.NET[payZone.id] = "wifi";
map.renderMap();
const svgAfter = ids["floorplan"].innerHTML;
(svgAfter !== svgBefore && /wifi|wireless|warning/i.test(svgAfter)) ? pass++ : (fail++, console.log("FAIL map should reflect wifi change"));
console.log(`   map wifi warning for ${payZone.id}: ${svgAfter !== svgBefore ? "rendered" : "UNCHANGED"}`);

// 5. pay-now vs monthly split: install-tier items contribute 0 monthly
let installMonthly = 0;
for (const it of S.DATA.hardware.install) installMonthly += ce.itemMonthly(it, inp);
eq("install-tier monthly = 0", installMonthly, 0);

console.log(`\nINTEGRATION: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
