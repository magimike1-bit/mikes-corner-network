import { S } from './session.js';
import { $, money } from './util.js';
/* cost.js — generated module. Source of truth: js/ (edit here, then run tools/build-assets.mjs). */

function dispAmt(v, cur){ const c = cadOf(v, cur);
  if(cur && cur !== "CAD") return money(c) + ' <span class="fx-src">(orig. ' + (cur === "USD" ? "US$" : "£") + v + " @ " + S.DATA.fx[cur] + ", " + S.DATA.fx.date + ")<\/span>";
  return money(c); }

  function manualDef(item){ return S.DATA.manual.hours[item.id] || null; }

  function ensureManual(st, item){
    const md = manualDef(item); if(!md) return;
    if(st.mhrs === undefined) st.mhrs = (md.hrs[0] + md.hrs[1]) / 2;
    if(st.mwage === undefined) st.mwage = S.DATA.manual.wageDefault;
  }

  function manualMonthly(item, st){
    const md = manualDef(item); if(!md || !st.manual) return 0;
    return st.mhrs * st.mwage * (S.DATA.manual.perFactor[md.per] || 4.33);
  }

  function manualNetNote(item, opt){
    const st = S.state[item.id];
    const labor = manualMonthly(item, st);
    const soft = itemMonthlyPreview(item, opt);
    const net = labor - soft;
    const per = {week:"week", payperiod:"pay period", month:"month"}[manualDef(item).per];
    let t = "Going manual saves you " + money(soft) + "/mo in software but costs ~" + money(labor) +
      "/mo in manager time (" + st.mhrs + " hrs/" + per + " \u00d7 CA$" + st.mwage + "/hr) \u2014 ";
    t += net >= 0 ? "net: you lose " + money(net) + "/mo." : "net: you come out " + money(-net) + "/mo ahead on paper \u2014 double-check the hours before believing it.";
    return t;
  }

  // Sector norms for the % of revenue view (from _research/sector-it-cost-benchmarks.md, accessed 2026-09-28)

  function switchFor(wired, aps){
    const need = wired + aps + 4;
    for(const s of [8, 16, 24, 48]) if(s >= need) return s;
    return 48;
  }

  function itemQty(item, inp){
    switch(item.calc){
      case "per_location": return inp.locations;
      case "per_station": return inp.stations;
      case "per_terminal": return inp.terminals;
      case "per_employee": return inp.employees;
      case "per_unit": return (S.state[item.id] && S.state[item.id].qty) || 0;
      default: return 1;
    }
  }

  /* ---- Equipment lifecycle: expected useful life in YEARS per option/addon.
     Amortized monthly = upfront ÷ (life × 12). Falls back to the legacy 36-month
     divisor (meta.amortize_months) for anything without researched lifecycle data.
     Sources: _research/equipment-lifecycles.md (2026-09-28). ---- */

  function lifeMonths(opt){
    const L = lifeDataFor(opt);
    /* Hard-fail: every hardware option must carry explicit lifecycle data (S.DATA.lifecycle table
       or per-option life). The old universal 36-month amortization is retired — never silently use it. */
    if(!L) throw new Error("Missing lifecycle data for: " + (opt && opt.label));
    return Math.max(1, Math.round(L.yrs * 12));
  }

  function lifeLabel(opt){
    const L = lifeDataFor(opt);
    if(L) return "~" + L.range + (L.est ? " (estimate)" : "");
    return "life n/a";
  }

  function builderPerStation(item, st){
    const inc = st.reqInc == null ? 1 : st.reqInc;
    if(st.path === "aio"){
      let per = cadOf(item.aio.upfront, item.aio.cur) / lifeMonths(item.aio);
      if(st.aioSupport && st.aioSupport !== "none" && item.aio.support)
        per += supportMonthlyFor(item.aio, st.aioSupport, inc);
      return per;
    }
    let per = 0;
    item.addons.forEach(a => {
      if(!(st.reqs && st.reqs[a.id])) return;
      if(a.upfront) per += cadOf(a.upfront, a.cur) / lifeMonths(a);
      const sp = st.reqSupport && st.reqSupport[a.id];
      if(sp && sp !== "none" && a.support) per += supportMonthlyFor(a, sp, inc);
    });
    return per;
  }

  /* ---- Support plans: THREE types per option, Joseph's model.
     - "contract": monthly support contract, tech on site (monthly and/or upfront over term)
     - "breakfix": pay per incident — perIncident × expected calls/yr ÷ 12
     - "hybrid": lighter contract + reduced per-incident rate
     The incident rate is an adjustable owner assumption (default 1/yr), never a fact.
     TCO comparison shows all three + none, with plain-language profile guidance. ---- */

  function supportMonthlyFor(opt, plan, incidentsPerYear){
    const s = opt && opt.support && opt.support[plan];
    if(!s) return 0;
    const inc = Math.max(0, +incidentsPerYear || 0);
    const termMonths = Math.max(1, Math.round((s.years || 1) * 12));
    const base = (s.upfront ? cadOf(s.upfront, s.cur) / termMonths : 0) + cadOf(s.monthly, s.cur);
    if(plan === "contract") return base;
    if(plan === "breakfix") return (cadOf(s.perIncident, s.cur) * inc) / 12;
    if(plan === "hybrid") return base + (cadOf(s.perIncident, s.cur) * inc) / 12;
    return 0;
  }

  function supportPlanPriced(opt, plan){
    const s = opt && opt.support && opt.support[plan];
    if(!s) return false;
    return !!(s.upfront || s.monthly || s.perIncident || s.included);
  }

  function itemMonthly(item, inp){
    const st = S.state[item.id]; if(!st || !st.checked) return 0;
    if(item.calc === "training_init") return 0; // one-time — pay-now only, never monthly
    if(item.calc === "training_ongoing") return trainingOngoingMonthly(inp);
    if(item.builder) return builderPerStation(item, st) * itemQty(item, inp);
    if(st.manual && manualDef(item)) return manualMonthly(item, st);
    // Install & setup is one-time — paid UP FRONT at install, NEVER presented as monthly.
    if(S.DATA.hardware.install.indexOf(item) !== -1) return 0;
    const opt = item.options[st.optIdx || 0];
    if(opt.info_only) return 0;
    const q = itemQty(item, inp);
    let m = 0;
    if(item.calc === "percent_marketplace") m = inp.marketplace * (item.rate || 0);
    else m = ((opt.upfront ? cadOf(opt.upfront, opt.cur) / lifeMonths(opt) : 0) + cadOf(opt.monthly, opt.cur)) * q; // amortized hardware (CAD-converted) over its expected life + recurring
    if(st.support && st.support !== "none" && opt.support) m += supportMonthlyFor(opt, st.support, st.incidents == null ? 1 : st.incidents) * q;
    if(item.base) m += item.base * (item.calc === "per_location" ? inp.locations : 1);
    return m;
  }

  /* ---- Upfront (pay-now) math: purchase prices + install items + station hardware.
     Leased hardware has no upfront by definition — it lives in the monthly column.
     Install items are one-time: always pay-now, never amortized into monthly. ---- */

  function itemUpfront(item, inp){
    const st = S.state[item.id]; if(!st || !st.checked) return 0;
    if(st.manual && manualDef(item)) return 0;
    if(item.calc === "training_init") return trainingInitCost(inp); // go-live: staff time + trainer
    if(item.builder){
      const q = Math.max(0, inp.stations);
      let u = 0;
      if(st.path === "aio"){ if(item.aio.upfront) u += cadOf(item.aio.upfront, item.aio.cur); }
      else item.addons.forEach(a => { if(st.reqs && st.reqs[a.id] && a.upfront) u += cadOf(a.upfront, a.cur); });
      return u * q;
    }
    const opt = item.options[st.optIdx || 0];
    if(!opt || opt.info_only || !opt.upfront) return 0;
    return cadOf(opt.upfront, opt.cur) * itemQty(item, inp);
  }

  function allItems(){
    const s = S.DATA.hardware.sectors[S.sector];
    return s.needs.concat(S.DATA.hardware.infra, S.DATA.hardware.install, S.DATA.hardware.training, s.toys);
  }
  /* ---- Training cost math. trainEmps: employees trained (follows the employees
     input until the merchant overrides it in the training section). ---- */

  function trainEmps(inp){
    if(!S.TRAIN.empsTouched) S.TRAIN.emps = Math.max(0, inp.employees);
    return Math.max(0, S.TRAIN.emps || 0);
  }

  function trainingInitCost(inp){
    const emps = trainEmps(inp);
    const staff = emps * S.TRAIN.hrsPerEmp * S.TRAIN.wage;
    const trainer = S.TRAIN.trainerMode === "tech" ? S.TRAIN.trainerHrs * S.techRate : 0;
    return staff + trainer;
  }

  function trainingOngoingMonthly(inp){
    const emps = trainEmps(inp);
    return emps * S.TRAIN.turnover * S.TRAIN.hireHrs * S.TRAIN.wage / 12;
  }

  function perLabel(item){
    return {flat:"/mo flat", per_location:"/mo per location", per_station:"/mo per station",
      per_terminal:"/mo per terminal", per_employee:"/mo per employee + base",
      per_unit:"/mo per " + (item.unit || "unit"), percent_marketplace:"of delivery sales"}[item.calc] || "/mo";
  }

  function installHrsMid(opt){
    if(!opt || opt.installHrs == null) return 0;
    const h = opt.installHrs;
    return Array.isArray(h) ? (h[0] + h[1]) / 2 : +h;
  }

  function installHrsLabel(opt){
    if(!opt || opt.installHrs == null) return null;
    const h = opt.installHrs;
    const txt = Array.isArray(h) ? (h[0] + "–" + h[1] + " hrs") : (h + (h === 1 ? " hr" : " hrs"));
    return "~" + txt;
  }

  /* ---- Install math: total tech hours on site = Σ installHrs × qty over every
     selected hardware item (station builder included). Install labor = hours ×
     the adjustable tech rate. One-time, pay-now — never monthly. ---- */

  function installHoursTotal(inp){
    let hrs = 0;
    allItems().forEach(item => {
      const st = S.state[item.id]; if(!st || !st.checked) return;
      if(item.calc === "training_init" || item.calc === "training_ongoing") return; // training has no install hours
      if(S.DATA.hardware.install.indexOf(item) !== -1) return; // install items don't install themselves
      if(item.builder){
        const q = Math.max(0, inp.stations);
        if(st.path === "aio") hrs += installHrsMid(item.aio) * q;
        else item.addons.forEach(a => { if(st.reqs && st.reqs[a.id]) hrs += installHrsMid(a) * q; });
        return;
      }
      if(st.manual && manualDef(item)) return;
      const opt = item.options[st.optIdx || 0];
      if(!opt || opt.info_only) return;
      hrs += installHrsMid(opt) * itemQty(item, inp);
    });
    return hrs;
  }

function cadOf(v, cur){ v = +v || 0; if(!cur || cur === "CAD") return v;
  const r = S.DATA.fx[cur]; if(!r) throw new Error("Unknown currency on priced option: " + cur); return v * r; }

function lifeDataFor(opt){
  if(!opt) return null;
  if(opt.life) return {yrs:+opt.life, range:(opt.lifeRange || ((+opt.life)+" yrs")), conf:opt.lifeConf||"Medium", src:opt.lifeSrc||"", est:!opt.lifeSrc};
  return (opt._item && S.DATA.lifecycle[opt._item]) || null;
}

export { cadOf, dispAmt, lifeDataFor, itemMonthlyPreview, itemMonthlyPreviewNoSupport, findItem, lifeMonths, lifeLabel, builderPerStation, supportMonthlyFor, supportPlanPriced, itemMonthly, itemUpfront, allItems, itemQty, installHrsMid, installHrsLabel, installHoursTotal, trainEmps, trainingInitCost, trainingOngoingMonthly, manualDef, ensureManual, manualMonthly, manualNetNote, switchFor, perLabel };

  function itemMonthlyPreviewNoSupport(item, opt){
    const inp = S.getInputs();
    const keep = S.state[item.id];
    const st = {checked:true, optIdx: item.options.indexOf(opt), qty: keep.qty, support:"none", incidents:1};
    const real = S.state[item.id]; S.state[item.id] = st;
    const m = itemMonthly(item, inp);
    S.state[item.id] = real;
    return m;
  }

  function itemMonthlyPreview(item, opt){
    const inp = S.getInputs();
    const keep = S.state[item.id];
    const st = {checked:true, optIdx: item.options.indexOf(opt), qty: keep.qty};
    const real = S.state[item.id]; S.state[item.id] = st;
    const m = itemMonthly(item, inp);
    S.state[item.id] = real;
    return m;
  }

  function findItem(id){
    return allItems().find(i => i.id === id);
  }
