import { S } from './session.js';
import { $, money, esc, pyRound, clampN, pct1 } from './util.js';
import { loadData } from './data.js';
import { cadOf, dispAmt, lifeDataFor, lifeMonths, lifeLabel, builderPerStation, supportMonthlyFor, supportBaseMonthly, supportIncidentMonthly, leaseMonthly, supportPlanPriced, itemMonthly, itemUpfront, allItems, itemQty, installHrsMid, installHrsLabel, installHoursTotal, trainEmps, trainingInitCost, trainingOngoingMonthly, manualDef, ensureManual, manualMonthly, manualNetNote, softwareLaborNote, stackLaborValue, switchFor, perLabel, itemMonthlyPreview, itemMonthlyPreviewNoSupport, findItem } from './cost-engine.js';
import { renderMap, mapJumpToItem, initMapEvents } from './visual-map.js';
import { trainMathHTML, updateTrainMath, renderTrainingTier } from './training.js';
import { ensureNET, netDevCounts, netZoneDevices, netWiredDrops, netWiredDesc, dropUnitCost, renderNetPlan } from './net-plan.js';
import { ensureME, meSales, renderMarginEaters, meEvents } from './margin-eaters.js';
/* core.js — generated module. Source of truth: js/ (edit here, then run tools/build-assets.mjs). */

  function recFor(item){ return S.DATA.recTiers[S.sector + ":" + item.id] || S.DATA.recTiers["*:" + item.id] || null; }

  function recBadge(item){
    const r = recFor(item); if(!r) return "";
    return '<span class="tier-badge ' + r[0] + '">' + S.DATA.sim.tierLabel[r[0]] + "</span>";
  }

  function bundledTag(opt){ return opt.bundled ? '<span class="bundled-tag">\u26a0\ufe0f Bundled processing</span>' : ""; }

  function recWhy(item){
    const r = recFor(item); if(!r) return "";
    return '<div class="tier-why"><strong>Why ' + r[0] + ":</strong> " + r[1] + "</div>";
  }



  function getInputs(){
    return {
      locations: Math.max(1, +$("in-locations").value || 1),
      stations: Math.max(0, +$("in-stations").value || 0),
      terminals: Math.max(0, +$("in-terminals").value || 0),
      employees: Math.max(0, +$("in-employees").value || 0),
      volume: Math.max(0, +$("in-volume").value || 0),
      rate: Math.max(0, +$("in-rate").value || 0),
      ticket: Math.max(1, +$("in-ticket").value || 1),
      revenue: Math.max(0, +$("in-revenue").value || 0),
      marketplace: Math.max(0, +$("in-marketplace").value || 0),
      tables: Math.max(0, +$("in-tables").value || 0)
    };
  }

  /* ---- Validated derivation rules: _research/simulator-derivation-rules.md (2026-09-28).
     Exact port of the Python model behind the 18 passing small/medium/large simulations.
     Python's round() rounds half to even — pyRound replicates it (JS Math.round does not). ---- */
  /* DERIVATION-START */

  function getQuestions(){
    const num = id => Math.max(0, +$(id).value || 0);
    const yn = id => $(id).value === "yes";
    return {
      tables: num("in-tables"), bar: yn("in-bar"), takeout: $("in-takeout").value,
      drivethru: yn("in-drivethru"), seats: num("in-seats"), kiosks: $("in-kiosks").value,
      sqft: S.sector === "grocery" ? num("in-sqft-g") : num("in-sqft-r"),
      weigh: yn("in-weigh"), sco: $("in-sco").value,
      rooms: num("in-rooms"), floors: Math.max(1, num("in-floors")), fb: yn("in-fb"),
      deli: yn("in-deli"), lottery: yn("in-lottery"),
      chairs: num("in-chairs"), trooms: num("in-trooms"), retailct: yn("in-retailct"),
      how: $("in-o-how").value, spots: num("in-o-spots"), cof: yn("in-o-cof")
    };
  }

  function renderSectors(){
    const g = $("sector-grid"); g.innerHTML = "";
    Object.keys(S.DATA.hardware.sectors).forEach(k => {
      const s = S.DATA.hardware.sectors[k];
      const d = document.createElement("div");
      d.className = "sector-card" + (k === S.sector ? " selected" : "");
      d.innerHTML = '<span class="emoji">' + s.emoji + "</span><strong>" + s.label + "</strong>";
      d.setAttribute("role", "button");
      d.setAttribute("tabindex", "0");
      d.setAttribute("aria-pressed", k === S.sector ? "true" : "false");
      const pick = () => { S.sector = k; renderSectors(); applySectorInfraDefaults(); loadTypical(); };
      d.onclick = pick;
      d.onkeydown = e => { if(e.key === "Enter" || e.key === " "){ e.preventDefault(); pick(); } };
      g.appendChild(d);
    });
    // sector-specific question blocks (3 questions each drive the auto-build)
    ["restaurant","qsr","retail","hotel","grocery","salon","other"].forEach(k => {
      const el = $("q-" + k); if(el) el.style.display = (k === S.sector) ? "" : "none";
    });
    renderSubsectors();
  }

  /* ---- P3: sub-sector picker. The picker (not a margin number from the user)
     applies the sub-sector's researched average net margin, used in the
     % of revenue view to show processing as a share of margin. ---- */
  function subsectorList(){
    return (S.DATA.subsectors && S.DATA.subsectors.sectors[S.sector]) || [];
  }

  function subsectorDef(){
    const list = subsectorList();
    return list.find(s => s.id === S.subsector) || list[0] || null;
  }

  function renderSubsectors(){
    const sel = $("in-subsector"); if(!sel) return;
    const list = subsectorList();
    if(!list.find(s => s.id === S.subsector)) S.subsector = list.length ? list[0].id : null;
    sel.innerHTML = list.map(s =>
      '<option value="' + s.id + '"' + (s.id === S.subsector ? " selected" : "") + ">" + esc(s.label) + "</option>"
    ).join("");
    const name = $("subsector-sector-name");
    if(name) name.textContent = (S.DATA.hardware.sectors[S.sector] || {}).label || S.sector;
    const d = subsectorDef();
    const note = $("subsector-margin-note");
    if(note) note.innerHTML = d
      ? "Typical net margin for <strong>" + esc(d.label) + "</strong>: <strong>" + d.margin + "%</strong>" +
        " (industry average" + (d.est ? ", estimate" : "") + " \u2014 your books win). " +
        "Used below to show processing as a share of your margin."
      : "";
  }

  /* ---- Infrastructure auto-derive: the owner answers business questions,
     the simulator does the engineering. ---- */

  function applySectorInfraDefaults(){
    S.ME = null;
    S.NET = null;
    const d = S.DATA.sim.infraDefaults[S.sector] || {guest:false};
    S.guestWifi = d.guest; S.terminalsTouched = false; S.pinSync = false;
    S.DATA.hardware.infra.forEach(item => { const st = S.state[item.id]; if(st) st.auto = true; });
  }

  /* ---- Auto-build: the 3 questions drive every derived number (sector RULES
     below — formulas are logic, kept in code, not in the JSON data files).
     Manual overrides stick via the auto flags; changing S.sector resets everything. ---- */
  const RULES = {
    restaurant(q){
      const T = q.tables, B = q.bar;
      const handhelds = T <= 10 ? 1 : (T <= 30 ? 2 : 3);
      const fixed = clampN(1 + (B ? 1 : 0) + Math.max(0, Math.ceil((T - 15) / 20)), 1, 6);
      const kds = T <= 30 ? 2 : (T <= 60 ? 3 : 4);
      const kprint = T <= 30 ? 1 : 2;
      const aps = Math.max(1, pyRound(T * 60 / 2000));
      const wired = fixed + kds + kprint + fixed;
      return { handhelds, fixed, kds, kprint, aps, wired_drops: wired, switch: switchFor(wired, aps),
               stations: fixed, terminals: fixed + handhelds };
    },
    qsr(q){
      const St = q.seats, Dr = q.drivethru;
      const counters = St === 0 ? 1 : (St <= 30 ? 2 : (St <= 80 ? 3 : 4));
      const kds = (St <= 40 ? 1 : 2) + (Dr ? 1 : 0);
      const kiosks = (q.kiosks === "have" || q.kiosks === "want") ? (St > 0 ? Math.max(2, pyRound(St / 40)) : 2) : 0;
      const aps = St === 0 ? 1 : Math.max(1, pyRound(St / 50));
      const wired = counters + kds + (Dr ? 1 : 0);
      return { counters, kds, dt_terms: Dr ? 1 : 0, kiosks, aps, wired_drops: wired, switch: switchFor(wired, aps),
               stations: counters, terminals: counters + (Dr ? 1 : 0) };
    },
    retail(q){
      const F = q.sqft;
      const lanes = clampN(pyRound(Math.sqrt(F / 800)), 1, 10);
      const backoffice = F < 3000 ? 1 : (F <= 15000 ? 2 : 3);
      const scale = q.weigh ? 1 : 0;
      const sco = q.sco === "want" ? Math.max(2, pyRound(lanes / 2)) : (q.sco === "have" ? 2 : 0);
      const aps = Math.max(1, pyRound(F / 5000));
      const wired = lanes + scale + sco + backoffice;
      return { lanes, backoffice, scale, sco, aps, wired_drops: wired, switch: switchFor(wired, aps),
               stations: lanes, terminals: lanes };
    },
    hotel(q){
      const R = q.rooms, N = q.floors, Fb = q.fb;
      const aps = Math.max(N, Math.ceil(R / 25)) + 1 + (Fb ? 1 : 0);
      const frontdesk = clampN(1 + Math.ceil(R / 75), 1, 5);
      const wired = aps + frontdesk + (Fb ? 4 : 0) + 2;
      return { aps, frontdesk, fb_pos: Fb ? 2 : 0, fb_kds: Fb ? 2 : 0, wired_drops: wired,
               switch: switchFor(wired, aps),
               stations: frontdesk + (Fb ? 2 : 0), terminals: frontdesk + (Fb ? 2 : 0) };
    },
    grocery(q){
      const F = q.sqft;
      const lanes = Math.max(1, pyRound(F / 3000));
      const aps = Math.max(1, pyRound(F / 5000));
      const wired = lanes + (q.deli ? 1 : 0) + (q.lottery ? 1 : 0);
      return { lanes, deli_pos: q.deli ? 1 : 0, deli_scale: q.deli ? 1 : 0, lottery: q.lottery ? 1 : 0,
               aps, wired_drops: wired, switch: switchFor(wired, aps),
               stations: lanes + (q.deli ? 1 : 0), terminals: lanes + (q.deli ? 1 : 0) };
    },
    salon(q){
      const C = q.chairs;
      const reception = C <= 10 ? 1 : 2;
      const aps = Math.max(1, pyRound(C / 12));
      return { reception, calendars: C, room_tablet: q.trooms > 0 ? 1 : 0, scanner: q.retailct ? 1 : 0,
               aps, wired_drops: reception, switch: switchFor(reception, aps),
               stations: reception, terminals: reception };
    },
    /* P6: "other" — warehouses, dropshippers, web-only stores, mobile trades,
       market stalls. Generic questions: how customers pay, how many payment
       spots, whether card-on-file/invoiced payments are taken. */
    other(q){
      const online = q.how === "online";
      const inperson = q.how === "inperson" || q.how === "both";
      const spots = clampN(q.spots || 0, 0, 8);
      const terminals = inperson ? Math.max(1, spots) : 0;
      const stations = inperson ? Math.max(1, spots) : 1;
      const aps = 1;
      const wired = terminals + 1;
      return { online, inperson, spots, terminals, stations, aps,
               wired_drops: wired, switch: switchFor(wired, aps) };
    }
  };

  function derive(){
    const q = getQuestions();
    S.D = RULES[S.sector](q);
    /* Joseph's redundancy rule: never recommend a single payment terminal.
       If it dies mid-rush, sales stop. The auto-build always includes a spare;
       dropping to one manually raises a risk warning, not a saving.
       Zero means "no physical terminals in this build" (all-online setup) —
       the floor only applies when hardware exists. */
    if(S.D.terminals > 0 && S.D.terminals < 2) S.D.terminals = 2;
    // Derived station / terminal counts fill the editable inputs (manual edits stick).
    if(S.stationsAuto){
      const el = $("in-stations");
      if(el && String(S.D.stations) !== el.value) el.value = S.D.stations;
    }
    if(S.terminalsAuto){
      const el = $("in-terminals");
      if(el && String(S.D.terminals) !== el.value) el.value = S.D.terminals;
    }
    const inp = getInputs();
    const plural = (n, w) => n + " " + w + (n === 1 ? "" : "s");
    // Derived catalog item: set qty/checked while still auto, always refresh the why-line.
    const setAuto = (id, qty, why) => {
      const st = S.state[id]; if(!st) return;
      st.why = why || "";
      st.rec = qty > 0;
      if(st.auto){ st.qty = qty; st.checked = qty > 0; }
    };
    const noteWhy = (id, why) => { const st = S.state[id]; if(st) st.why = why; };
    const sst = S.state["station"];

    /* ---- per-S.sector derived items ---- */
    if(S.sector === "restaurant"){
      setAuto("kds", S.D.kds, "Auto-added: " + plural(S.D.kds, "kitchen screen") + " for " + q.tables + " tables (cold line, hot line" + (S.D.kds > 2 ? ", expo" : "") + ").");
      setAuto("kprinter", S.D.kprint, "Auto-added: " + plural(S.D.kprint, "kitchen printer") + " — the backup when a screen goes dark.");
      const apps = q.takeout === "apps" || q.takeout === "both";
      setAuto("tablets", apps ? 2 : 0, apps ? "Auto-added: 2 aggregator tablets — one per delivery app. They rarely integrate with your POS, and they're wireless (no cable run)." : "");
      noteWhy("terminal", "Auto-added: " + plural(S.D.terminals, "terminal") + " — 1 per fixed station + " + plural(S.D.handhelds, "pay-at-table handheld") + "." + " Minimum 2 \u2014 if one dies mid-rush, the spare keeps you selling.");
    }
    if(S.sector === "qsr"){
      setAuto("kds", S.D.kds, "Auto-added: " + plural(S.D.kds, "kitchen screen") + " (make-line" + (S.D.kds > 1 ? " + expo" : "") + (q.drivethru ? " + drive-thru" : "") + ").");
      setAuto("kiosk", S.D.kiosks, S.D.kiosks > 0 ? "Auto-added: " + plural(S.D.kiosks, "self-order kiosk") + " — about 1 per 40 seats." : "");
      noteWhy("terminal", "Auto-added: " + plural(S.D.terminals, "terminal") + " — 1 per counter" + (q.drivethru ? " + drive-thru" : "") + "." + " Minimum 2 \u2014 if one dies mid-rush, the spare keeps you selling.");
    }
    if(S.sector === "retail"){
      setAuto("selfcheckout", S.D.sco, S.D.sco > 0 ? "Auto-added: " + plural(S.D.sco, "self-checkout unit") + " — priced by vendor quote." : "");
      if(sst && sst.reqs && S.reqsAuto.scale) sst.reqs.scale = q.weigh;
      setAuto("bopc", S.D.backoffice, "Auto-added: " + plural(S.D.backoffice, "back-office PC") + " — for the books and ordering, off the till.");
      noteWhy("terminal", "Auto-added: " + plural(S.D.terminals, "terminal") + " — 1 per lane." + " Minimum 2 \u2014 if one dies mid-rush, the spare keeps you selling.");
    }
    if(S.sector === "hotel"){
      noteWhy("terminal", "Auto-added: " + plural(S.D.terminals, "terminal") + " — 1 per front-desk station" + (q.fb ? " + F&B outlet" : "") + "." + " Minimum 2 \u2014 if one dies mid-rush, the spare keeps you selling.");
    }
    if(S.sector === "grocery"){
      if(sst && sst.reqs && S.reqsAuto.scale) sst.reqs.scale = q.deli;
      noteWhy("terminal", "Auto-added: " + plural(S.D.terminals, "terminal") + " — 1 per lane" + (q.deli ? " + deli" : "") + "." + " Minimum 2 \u2014 if one dies mid-rush, the spare keeps you selling.");
    }
    if(S.sector === "salon"){
      if(sst && sst.reqs && S.reqsAuto.scanner) sst.reqs.scanner = q.retailct;
      noteWhy("booking", "Auto-added: " + plural(S.D.calendars, "booking calendar") + " — 1 per chair (software seats, not hardware).");
      noteWhy("terminal", "Auto-added: " + plural(S.D.terminals, "terminal") + " — 1 per reception station." + " Minimum 2 \u2014 if one dies mid-rush, the spare keeps you selling.");
    }
    if(S.sector === "other"){
      const sellOnline = q.how === "online" || q.how === "both";
      setAuto("online", (sellOnline || q.cof) ? 1 : 0,
        "Auto-added: online checkout / invoicing \u2014 " + (sellOnline ? "you take payments online" : "you take card-on-file / invoiced payments") + ".");
      if(S.D.terminals > 0)
        noteWhy("terminal", "Auto-added: " + plural(S.D.terminals, "terminal") + " \u2014 1 per payment spot." + " Minimum 2 \u2014 if one dies mid-rush, the spare keeps you selling.");
      else
        noteWhy("terminal", "No physical terminal needed \u2014 all-online setup. If you ever take cards in person, a mobile reader is the cheap backup.");
    }

    /* ---- infrastructure: 1 cable run per wired device; switch = smallest of
       8/16/24/48 covering wired drops + APs + 4 spare ports ---- */
    const apSt = S.state["ap"], dSt = S.state["drops"], swSt = S.state["switch"];
    // Guest Wi-Fi toggle (play mode): the infra-list item mirrors the S.guestWifi S.state.
    const gwSt = S.state["guestwifi"];
    if(gwSt){ gwSt.checked = S.guestWifi; gwSt.rec = true; }
    if(apSt){
      apSt.why = "Auto-added: " + plural(S.D.aps, "access point") + " — " + apWhy(q) + " Adjust the count with +/−.";
      apSt.rec = true;
      if(apSt.auto){ apSt.qty = S.D.aps; apSt.checked = true; }
    }
    if(dSt){
      ensureNET();
      const nd = netWiredDrops();
      dSt.why = "Auto-added: " + nd + " cable runs — from your network plan above (" + netWiredDesc() + "). Change a zone and this updates.";
      dSt.rec = true;
      if(dSt.auto){ dSt.qty = nd; dSt.checked = nd > 0; }
    }
    const foSt = S.state["failover"], inetSt = S.state["internet"];
    if(foSt && inetSt){
      foSt.why = "Recommended: when the main line drops, card payments stop — cellular failover keeps the till taking cards. Real hardware + plan pricing above.";
      foSt.rec = true;
      if(foSt.auto) foSt.checked = inetSt.checked;
    }
    if(swSt){
      ensureNET();
      const need = netWiredDrops() + 4;
      swSt.why = "Auto-added: " + netWiredDrops() + " drops + 4 spare = " + need + " ports → " + S.D.switch + "-port PoE switch. Access points draw power through the network cable — no electrician needed at the ceiling.";
      swSt.rec = true;
      if(swSt.auto){ swSt.checked = true; swSt.optIdx = { 8: 0, 16: 1, 24: 2, 48: 3 }[S.D.switch]; }
    }

    // Delivery-app sales input only matters when apps are in play.
    $("wrap-marketplace").style.display =
      (S.sector === "qsr" || (S.sector === "restaurant" && (q.takeout === "apps" || q.takeout === "both"))) ? "" : "none";

    // PIN pad sync: station builder drives the payment-terminal count (+ handhelds for restaurants).
    // Skipped when the auto-build has zero physical terminals (all-online setup) —
    // a countertop station must not conjure terminals a web-only business doesn't need.
    S.pinSync = !!(sst && sst.checked && sst.path !== "aio" && sst.reqs && sst.reqs.pinpad);
    if(S.pinSync && !S.terminalsTouched && S.D.terminals > 0){
      const tEl = $("in-terminals");
      const want = Math.max(2, inp.stations + (S.D.handhelds || 0)); // redundancy floor
      if(tEl && document.activeElement !== tEl && String(want) !== tEl.value) tEl.value = want;
    }
    const sumEl = $("autobuild-summary");
    if(sumEl) sumEl.innerHTML = "<strong>Auto-build:</strong> " + summaryText(q);
    $("infra-sub").innerHTML = S.DATA.hardware.infra_notes[S.sector] +
      (S.guestWifi ? " <strong>Guest Wi-Fi runs on its own separate lane</strong> — customers never touch your payment network; the firewall keeps the lanes apart." : "");
  }

  function apWhy(q){
    switch(S.sector){
      case "restaurant": return "about 1 per 2,000 sq ft (~" + (q.tables * 60).toLocaleString("en-CA") + " sq ft est. from " + q.tables + " tables × 60).";
      case "qsr": return "about 1 per 50 eat-in seats.";
      case "retail":
      case "grocery": return "about 1 per 5,000 sq ft (staff coverage).";
      case "hotel": return "about 1 per 25 rooms + lobby" + (q.fb ? " + F&B" : "") + ", min 1 per floor.";
      case "salon": return "about 1 per 12 chairs (waiting-area guest Wi-Fi).";
      case "other": return "1 covers a counter + back office (mobile and online work doesn't need more).";
    }
    return "";
  }

  function dropsWhy(q){
    const p = (n, w) => n + " " + w + (n === 1 ? "" : "s");
    switch(S.sector){
      case "restaurant": return p(S.D.fixed, "fixed station") + " + " + p(S.D.kds, "KDS") + " + " + p(S.D.kprint, "kitchen printer") + " + " + p(S.D.fixed, "receipt printer");
      case "qsr": return p(S.D.counters, "counter") + " + " + p(S.D.kds, "KDS") + (q.drivethru ? " + 1 drive-thru terminal" : "");
      case "retail": return p(S.D.lanes, "lane") + (S.D.scale ? " + 1 scale" : "") + (S.D.sco ? " + " + p(S.D.sco, "self-checkout") : "") + " + " + p(S.D.backoffice, "back-office PC");
      case "hotel": return p(S.D.aps, "AP") + " + " + p(S.D.frontdesk, "front-desk station") + (q.fb ? " + 2 F&B POS + 2 F&B KDS" : "") + " + 2 back-office drops";
      case "grocery": return p(S.D.lanes, "lane") + (q.deli ? " + 1 deli POS" : "") + (q.lottery ? " + 1 lottery terminal" : "");
      case "salon": return p(S.D.reception, "reception station");
      case "other": return p(S.D.terminals, "payment spot") + " + 1 back-office drop";
    }
    return "";
  }

  function summaryText(q){
    const p = (n, w) => n + " " + w + (n === 1 ? "" : "s");
    switch(S.sector){
      case "restaurant":
        return "From " + p(q.tables, "table") + (q.bar ? " + bar" : "") + ": " +
          p(S.D.fixed, "fixed POS station") + ", " + p(S.D.handhelds, "pay-at-table handheld") + ", " +
          p(S.D.kds, "kitchen screen") + ", " + p(S.D.kprint, "kitchen printer") + ", " +
          p(S.D.aps, "Wi-Fi AP") + ", " + p(S.D.wired_drops, "cable run") + " → " + S.D.switch + "-port PoE switch." +
          ((q.takeout === "apps" || q.takeout === "both") ? " Delivery apps: 2 aggregator tablets (commissions under Margin eaters below)." : "") +
          (q.takeout === "none" ? " No takeout." : "");
      case "qsr":
        return "From " + p(q.seats, "seat") + (q.drivethru ? " + drive-thru" : "") + ": " +
          p(S.D.counters, "order counter") + ", " + p(S.D.kds, "kitchen screen") +
          (q.drivethru ? ", 1 drive-thru terminal" : "") +
          (S.D.kiosks ? ", " + p(S.D.kiosks, "self-order kiosk") : "") + ", " +
          p(S.D.aps, "Wi-Fi AP") + ", " + p(S.D.wired_drops, "cable run") + " → " + S.D.switch + "-port PoE switch.";
      case "retail":
        return "From " + q.sqft.toLocaleString("en-CA") + " sq ft" + (q.weigh ? " + weighed goods" : "") + ": " +
          p(S.D.lanes, "checkout lane") + ", " + p(S.D.backoffice, "back-office PC") +
          (S.D.scale ? ", 1 produce scale" : "") + (S.D.sco ? ", " + p(S.D.sco, "self-checkout") : "") + ", " +
          p(S.D.aps, "staff Wi-Fi AP") + ", " + p(S.D.wired_drops, "cable run") + " → " + S.D.switch + "-port PoE switch.";
      case "hotel":
        return "From " + p(q.rooms, "room") + " / " + p(q.floors, "floor") + (q.fb ? " + F&B" : "") + ": " +
          p(S.D.frontdesk, "front-desk station") +
          (q.fb ? ", F&B outlet: 2 POS stations + 2 kitchen screens" : "") + ", " +
          p(S.D.aps, "Wi-Fi AP") + ", " + p(S.D.wired_drops, "cable run") + " → " + S.D.switch + "-port PoE switch.";
      case "grocery":
        return "From " + q.sqft.toLocaleString("en-CA") + " sq ft: " + p(S.D.lanes, "checkout lane") +
          (q.deli ? ", deli: 1 POS + 1 scale" : "") + (q.lottery ? ", 1 lottery terminal" : "") + ", " +
          p(S.D.aps, "staff Wi-Fi AP") + ", " + p(S.D.wired_drops, "cable run") + " → " + S.D.switch + "-port PoE switch.";
      case "salon":
        return "From " + p(q.chairs, "chair") + ": " + p(S.D.reception, "reception POS station") + ", " +
          p(S.D.calendars, "booking calendar") + " (software seats)" +
          (S.D.room_tablet ? ", 1 wireless room tablet" : "") + (S.D.scanner ? ", 1 retail barcode scanner" : "") + ", " +
          p(S.D.aps, "Wi-Fi AP") + ", " + p(S.D.wired_drops, "cable run") + " → " + S.D.switch + "-port PoE switch.";
      case "other":
        return "From " + (q.how === "online" ? "online-only sales" : q.how === "inperson" ? "in-person sales" : "in-person + online sales") +
          (S.D.inperson ? " across " + p(S.D.spots, "payment spot") : "") + (q.cof ? " + card-on-file / invoicing" : "") + ": " +
          (S.D.terminals > 0 ? p(S.D.terminals, "terminal") + ", " : "no physical terminals, ") +
          p(S.D.aps, "Wi-Fi AP") + ", " + p(S.D.wired_drops, "cable run") + " → " + S.D.switch + "-port PoE switch.";
    }
    return "";
  }

  /* ---- POS station builder rendering ---- */

  function renderBuilder(d, item, st){
    const inp = getInputs();
    const perStation = builderPerStation(item, st);
    const q = Math.max(0, inp.stations);
    let inner = '<div><div class="name">' + item.name + recBadge(item) + ' <span class="conf reported">Reported</span></div>' +
      recWhy(item) +
      '<div class="detail">Tick what each station needs — we assemble the station and price it. Applies to every station you add in step 2.</div>' +
      '<div class="path-pick" role="radiogroup" aria-label="Station path">' +
      '<label><input type="radio" name="station-path" value="build"' + (st.path !== "aio" ? " checked" : "") + '> 🧩 <strong>Build your own</strong> — mix and match</label>' +
      '<label><input type="radio" name="station-path" value="aio"' + (st.path === "aio" ? " checked" : "") + '> 📦 <strong>All-in-one</strong> — one box does it all</label></div>';
    if(st.path === "aio"){
      inner += '<div class="aio-note">All-in-one (like the Square Register, ~$900 CAD): screen, card reader, POS software and customer display in one box — <strong>' + money(cadOf(item.aio.upfront, item.aio.cur) / lifeMonths(item.aio)) + '/mo equiv.</strong> ($900 upfront ÷ ' + lifeLabel(item.aio) + ').<br>' +
        '✅ Simpler — one thing to plug in, one vendor to call.<br>' +
        '⚠️ Trade-offs: you\'re locked to that processor\'s rates, and if one part dies the whole box goes for repair. Printer and cash drawer are usually sold separately.<br>' +
        '💡 It has its own card reader \u2014 but don\u2019t drop to a single payment path. If this box dies mid-rush, sales stop: keep a backup terminal.</div>';
      if(item.aio.support){
        inner += '<div class="req-support">🛡️ Support for this box: ' +
          supportMiniSelect(item.aio.support, st.aioSupport || "none", st.reqInc == null ? 1 : st.reqInc, "data-aiosup", item.id) + "</div>";
      }
    } else {
      inner += '<div class="reqs">';
      item.addons.forEach(a => {
        const on = !!(st.reqs && st.reqs[a.id]);
        const cost = a.upfront ? " — <strong>" + money(cadOf(a.upfront, a.cur) / lifeMonths(a)) + "/mo equiv.</strong> <span class=\"life-badge\">" + lifeLabel(a) + " life</span>" +
          (installHrsLabel(a) ? ' <span class="life-badge" title="Average tech install time">🔧 ' + installHrsLabel(a) + " install</span>" : "") : "";
        inner += '<label class="sim-check"><input type="checkbox" data-req="' + a.id + '"' + (on ? " checked" : "") + '> <span>' + a.label + cost +
          '<br><span style="opacity:.75;font-size:.95em">' + (a.note || "") + "</span></span></label>";
        if(on && a.support){
          const sp = (st.reqSupport && st.reqSupport[a.id]) || "none";
          inner += '<div class="req-support">🛡️ Support: ' +
            supportMiniSelect(a.support, sp, st.reqInc == null ? 1 : st.reqInc, "data-reqsup", a.id) + "</div>";
        }
      });
      inner += "</div>";
      const stHasSup = (st.path === "aio" && item.aio.support) ||
        item.addons.some(a => a.support && st.reqs && st.reqs[a.id]);
      if(stHasSup){
        const rinc = st.reqInc == null ? 1 : st.reqInc;
        inner += '<div class="incident-ctl"><span>Expected service calls/yr <em>(your guess — adjust it)</em>:</span> ' +
          '<button data-reqinc="-1" aria-label="fewer calls">−</button><strong>' + rinc + "</strong>" +
          '<button data-reqinc="1" aria-label="more calls">+</button></div>' +
          '<div class="detail">📋 contract suits busy lanes · 🔧 break/fix suits a single lane that can wait a day · 🧩 hybrid splits the difference.</div>';
      }
    }
    inner += "</div>";
    inner += '<div class="price"><label class="sim-check" style="margin:0 0 6px;justify-content:flex-end"><input type="checkbox" data-item="' + item.id + '" aria-label="Include ' + item.name + '"' + (st.checked ? " checked" : "") + '></label>' +
      '<span class="amt">' + money(perStation * q) + '/mo</span><span class="per">' + money(perStation) + " per station × " + q + "</span></div>";
    d.innerHTML = inner;
  }

  /* ---- Compact support selector for the station builder: same three plans,
     same math (supportMonthlyFor), rendered as a select to fit the lane UI. ---- */

  function supportMiniSelect(supObj, curPlan, curInc, attr, val){
    const labels = {contract:"📋 Monthly contract", breakfix:"🔧 Break/fix per visit", hybrid:"🧩 Hybrid"};
    let h = '<select ' + attr + '="' + val + '" aria-label="Support plan">';
    h += '<option value="none"' + (curPlan === "none" ? " selected" : "") + '>No support</option>';
    ["contract","breakfix","hybrid"].forEach(p => {
      const s = supObj[p]; if(!s) return;
      const fake = {support: supObj};
      const cost = supportPlanPriced(fake, p) ? " — " + money(supportMonthlyFor(fake, p, curInc)) + "/mo" : " — quote-based";
      h += '<option value="' + p + '"' + (curPlan === p ? " selected" : "") + ">" + labels[p] + cost + "</option>";
    });
    return h + "</select>";
  }

  /* ---- Average tech install time per hardware item (hours on site).
     opt.installHrs: number, or [min,max] range. Midpoint is used for the math;
     the range + installVar note explain the variance (retrofit vs new build).
     Sourced or estimate-labelled; feeds install labor = hours × tech rate. ---- */

  function renderInstallLabor(){
    const el = $("install-labor-line"); if(!el) return;
    const hrs = installHoursTotal(getInputs());
    el.innerHTML = '<div class="install-labor">⏱️ Estimated tech time on site: <strong id="install-labor-hrs">~' +
      (Math.round(hrs * 10) / 10) + ' hrs</strong> (from the install hours on each hardware item you selected)<br>' +
      '<label class="rate-ctl">Tech labor rate: $<input type="number" id="tech-rate" min="25" max="400" step="5" value="' + S.techRate + '" aria-label="Tech labor rate per hour">/hr ' +
      '<em>(adjustable — your installer\'s actual rate; default $125 = midpoint of researched CA$100–150/hr estimate)</em></label> ' +
      '= <strong id="install-labor-total">' + money(hrs * S.techRate) + '</strong> one-time, paid at install.</div>';
    $("tech-rate").addEventListener("change", () => {
      S.techRate = Math.max(0, +$("tech-rate").value || 0);
      updateInstallLaborTotal();
      recalc();
    });
    updateInstallLaborTotal();
  }

  function updateInstallLaborTotal(){
    const hrs = installHoursTotal(getInputs());
    const h = $("install-labor-hrs"), t = $("install-labor-total");
    if(h) h.textContent = "~" + (Math.round(hrs * 10) / 10) + " hrs";
    if(t) t.textContent = money(hrs * S.techRate);
  }

  /* ---- Pay now vs pay monthly breakout (Joseph's rule).
     PAY NOW: hardware purchases + install labor + install line items (one-time, incl. cable drops).
     PAY MONTHLY: leased hardware + SaaS + support contracts + expected break/fix + processing fees.
     Purchased hardware NEVER appears in the monthly column — its amortized equivalent
     lives in the grand total for comparison only. ---- */

  function renderPayBreakout(){
    const el = $("pay-breakout"); if(!el) return;
    const inp = getInputs();
    let hwUpfront = 0, installUpfront = 0, installQuoted = 0;
    let leaseMo = 0, saasMo = 0, contractMo = 0, breakfixMo = 0;
    allItems().forEach(item => {
      const st = S.state[item.id]; if(!st || !st.checked) return;
      if(item.calc === "training_init" || item.calc === "training_ongoing") return; // dedicated rows below
      const isInstall = S.DATA.hardware.install.indexOf(item) !== -1;
      if(item.builder){
        hwUpfront += itemUpfront(item, inp);
        const q = Math.max(0, inp.stations);
        const inc = st.reqInc == null ? 1 : st.reqInc;
        const addSup = (supObj, plan) => {
          if(!plan || plan === "none" || !supObj) return;
          // Contract-like priced base (upfront/term + monthly) -> contracts.
          // Expected per-incident part -> break/fix. Break/fix incident prices are
          // quote-based, so that part is $0 until a real price exists — never training.
          contractMo += supportBaseMonthly({support: supObj}, plan) * q;
          breakfixMo += supportIncidentMonthly({support: supObj}, plan, inc) * q;
        };
        if(st.path === "aio") addSup(item.aio.support, st.aioSupport);
        else item.addons.forEach(a => { if(st.reqs && st.reqs[a.id]) addSup(a.support, st.reqSupport && st.reqSupport[a.id]); });
        return;
      }
      if(st.manual && manualDef(item)) return;
      const opt = item.options[st.optIdx || 0];
      if(!opt || opt.info_only){ if(isInstall) installQuoted++; return; }
      const q = itemQty(item, inp);
      if(isInstall){ installUpfront += cadOf(opt.upfront, opt.cur) * q; return; }
      if(opt.upfront) hwUpfront += cadOf(opt.upfront, opt.cur) * q;
      leaseMo += leaseMonthly(item, inp); // single source of truth — never a parallel inline calc
      if(opt.monthly && !opt.lease) saasMo += cadOf(opt.monthly, opt.cur) * q;
      if(item.base) saasMo += item.base * (item.calc === "per_location" ? inp.locations : 1);
      if(st.support && st.support !== "none" && opt.support){
        // Contract-like priced base -> contracts; expected per-incident part -> break/fix.
        // Break/fix incident prices are quote-based ($0) — never derived from training.
        const inc = st.incidents == null ? 1 : st.incidents;
        contractMo += supportBaseMonthly(opt, st.support) * q;
        breakfixMo += supportIncidentMonthly(opt, st.support, inc) * q;
      }
    });
    const hrs = installHoursTotal(inp);
    const laborUpfront = hrs * S.techRate;
    const trI = S.state["tr-initial"], trO = S.state["tr-ongoing"];
    const trainNow = (trI && trI.checked) ? trainingInitCost(inp) : 0;
    const trainMo = (trO && trO.checked) ? trainingOngoingMonthly(inp) : 0;
    const payNow = hwUpfront + installUpfront + laborUpfront + trainNow;
    S.totals = Object.assign(S.totals || {}, { payNow });
    const proc = inp.volume * (inp.rate / 100);
    const r = (label, val, mo) => '<div class="pay-row"><span>' + label + "</span><strong>" + val + (mo ? "/mo" : "") + "</strong></div>";
    el.innerHTML = '<div class="pay-breakout"><h4>💰 Pay now vs pay monthly</h4><div class="pay-cols">' +
      '<div class="pay-col now"><h5>Pay now — due at install</h5>' +
      r("Hardware purchases", money(hwUpfront)) +
      r("Install labor (~" + (Math.round(hrs * 10) / 10) + " hrs × " + money(S.techRate) + "/hr)", money(laborUpfront)) +
      r("Install line items", installUpfront > 0 ? money(installUpfront) : (installQuoted > 0 ? "quote-based" : money(0))) +
      r("Training — go-live", money(trainNow)) +
      '<div class="pay-row total"><span>Total due at install</span><strong>' + money(payNow) + (installQuoted > 0 ? " +" : "") + "</strong></div>" +
      (installQuoted > 0 ? '<div class="pay-note">' + installQuoted + ' install item(s) still need installer quotes.</div>' : "") +
      "</div>" +
      '<div class="pay-col monthly"><h5>Pay monthly — recurring</h5>' +
      r("Leased hardware", money(leaseMo), true) +
      r("Subscriptions (SaaS)", money(saasMo), true) +
      r("Support contracts", money(contractMo), true) +
      (breakfixMo > 0 ? r("Expected break/fix", money(breakfixMo), true)
        : '<div class="pay-row"><span>Expected break/fix</span><strong>—</strong></div>') +
      r("New-hire training", money(trainMo), true) +
      r("Processing fees", money(proc), true) +
      "</div></div>" +
      '<p class="fine">Bought hardware is due in full at install — the monthly total above spreads it over its expected life for comparison only. ' +
      "Cable drops and setup are one-time: they never appear in the monthly column. " +
      "Leasing converts hardware to a real monthly bill — lease terms are quote-based, ask your reseller.<br>" +
      "Break/fix visits are quote-based, so Expected break/fix stays blank until a vendor prices a visit — it is never estimated from training costs.<br>" +
      "Foreign-currency research prices are converted to CAD at US$1 = C$1.416 and £1 = C$1.72 (market rates, 2026-09-28) — approximate; your bank\u2019s rate will differ slightly. No foreign-currency amount ever enters a total unconverted.</p></div>";
  }

  /* ---- Training materials: genuinely usable starter content, per S.sector.
     Two tracks (tech vs process), a quick-start checklist, and role cheat sheets.
     Plain language, actionable — print these and hand them to new hires. ---- */

  function loadTypical(){
    const t = S.DATA.typical.setups[S.sector]; if(!t) return;
    const set = (id, v) => { const el = $(id); if(el && v !== undefined) el.value = v; };
    // Processing rate is always shown with at most 2 decimals — never a float artifact like 2.6500000953674316.
    const setRate = v => { const el = $("in-rate"); if(el && v !== undefined && v !== null && v !== "") el.value = Math.round(+v * 100) / 100; };
    Object.values(t.q).forEach((v, i) => set(S.DATA.typical.qIds[S.sector][i], v));
    set("in-locations", t.basics.locations); set("in-employees", t.basics.employees);
    set("in-volume", t.basics.volume); setRate(t.basics.rate);
    set("in-ticket", t.basics.ticket);
    set("in-marketplace", t.basics.marketplace);
    /* Joseph rule: support-type selections survive navigation. Snapshot the support
       fields before the typical reset wipes S.state, re-apply after the rebuild. */
    const keepSup = {};
    Object.keys(S.state).forEach(k => { const st = S.state[k];
      keepSup[k] = {support:st.support, incidents:st.incidents,
        reqSupport: st.reqSupport ? Object.assign({}, st.reqSupport) : undefined,
        reqInc: st.reqInc, aioSupport: st.aioSupport}; });
    Object.keys(S.state).forEach(k => delete S.state[k]);
    S.stationsAuto = S.terminalsAuto = true;
    S.reqsAuto = { scale: true, scanner: true };
    S.guestWifi = t.guest; S.terminalsTouched = false; S.pinSync = false;
    renderCatalog(); // fresh S.state + auto-build from the questions
    (t.check || []).forEach(id => { if(S.state[id]) S.state[id].checked = true; });
    Object.entries(t.optIdx || {}).forEach(([id, i]) => { if(S.state[id]) S.state[id].optIdx = i; });
    if(S.state["station"] && t.station){
      S.state["station"].path = t.station.path;
      S.state["station"].reqs = Object.assign({}, S.state["station"].reqs, t.station.reqs);
    }
    if(S.state["firewall"] && t.firewall) S.state["firewall"].checked = true;
    Object.keys(keepSup).forEach(k => { const st = S.state[k]; if(!st) return; const ks = keepSup[k];
      if(ks.support) st.support = ks.support;
      if(ks.incidents != null) st.incidents = ks.incidents;
      if(ks.reqSupport) st.reqSupport = Object.assign({}, ks.reqSupport);
      if(ks.reqInc != null) st.reqInc = ks.reqInc;
      if(ks.aioSupport) st.aioSupport = ks.aioSupport; });
    const note = $("typical-note");
    if(note) note.textContent = t.label + " loaded — a starting point, not a recommendation. Adjust to match yours.";
    renderCatalog();
  }

  // Items whose qty/checked follow the 3 questions until the user overrides them.

  function planCostTxt(s, plan){
    if(!s) return "quote-based";
    if(plan === "contract"){
      if(s.included) return "included";
      const bits = [];
      if(s.monthly) bits.push(dispAmt(s.monthly, s.cur) + "/mo");
      if(s.upfront) bits.push(dispAmt(s.upfront, s.cur) + " upfront");
      if(s.years) bits.push(s.years + "-yr term");
      return bits.length ? bits.join(" · ") : "quote-based";
    }
    if(plan === "breakfix") return s.perIncident ? ("~" + dispAmt(s.perIncident, s.cur) + " per visit") : "quote-based";
    if(plan === "hybrid"){
      const bits = [];
      if(s.monthly) bits.push(dispAmt(s.monthly, s.cur) + "/mo");
      if(s.upfront) bits.push(dispAmt(s.upfront, s.cur) + " upfront");
      if(s.perIncident) bits.push(dispAmt(s.perIncident, s.cur) + "/visit");
      return bits.length ? bits.join(" + ") : "quote-based";
    }
    return "quote-based";
  }

  function supportBox(item, st, opt){
    const sup = opt.support;
    const inc = st.incidents == null ? 1 : st.incidents;
    const q = Math.max(1, itemQty(item, getInputs()));
    const base = itemMonthlyPreviewNoSupport(item, opt);
    const plans = ["contract", "breakfix", "hybrid"];
    const planLabels = {contract: "📋 Monthly contract", breakfix: "🔧 Break/fix per visit", hybrid: "🧩 Hybrid"};
    let html = '<div class="support-box"><div class="support-title">🛡️ Support — how do you want breakdowns handled?</div>';
    html += '<div class="support-pick" role="radiogroup" aria-label="Support plan for ' + item.name + '">';
    html += '<label class="sim-check"><input type="radio" name="sup-' + item.id + '" data-support-plan="none" data-item="' + item.id + '"' + (!st.support || st.support === "none" ? " checked" : "") + '> <span><strong>None</strong> — replace out of pocket</span></label>';
    plans.forEach(p => {
      const s = sup[p];
      if(!s) return;
      html += '<label class="sim-check"><input type="radio" name="sup-' + item.id + '" data-support-plan="' + p + '" data-item="' + item.id + '"' + (st.support === p ? " checked" : "") + '> ' +
        '<span><strong>' + planLabels[p] + "</strong> — " + s.label + " · " + planCostTxt(s, p) +
        (s.adv ? ' · <strong>advance replacement</strong>' : "") + "</span></label>";
    });
    html += "</div>";
    // TCO comparison across the three types + none
    html += '<div class="tco-lines"><div class="tco-row"><span>None</span><strong>' + money(base) + '/mo</strong></div>';
    plans.forEach(p => {
      const s = sup[p];
      if(!s) return;
      const tco = supportPlanPriced(opt, p)
        ? money(base + supportMonthlyFor(opt, p, inc) * q) + "/mo"
        : "quote-based";
      const incNote = (p !== "contract") ? ' <span class="tco-note">(at ' + inc + ' call' + (inc === 1 ? "" : "s") + '/yr)</span>' : "";
      html += '<div class="tco-row"><span>' + planLabels[p] + incNote + "</span><strong>" + tco + "</strong></div>";
    });
    html += "</div>";
    // adjustable incident assumption (break/fix + hybrid depend on it)
    html += '<div class="incident-ctl"><span>Expected service calls per year <em>(your guess — adjust it)</em>:</span> ' +
      '<button data-inc="-1" data-item="' + item.id + '" aria-label="fewer calls">−</button><strong>' + inc + "</strong>" +
      '<button data-inc="1" data-item="' + item.id + '" aria-label="more calls">+</button></div>';
    const cur = st.support && st.support !== "none" ? st.support : "none";
    html += '<div class="detail support-why">' + S.DATA.sim.supportGuide[cur] + "</div>";
    if(S.src) html += '<div class="life-src">Support sources: ' + S.src + "</div>";
    html += "</div>";
    return html;
  }

  // monthly for an item WITHOUT its support plan (for the TCO comparison line)



  function renderCatalog(){
    // make sure every item has S.state, then auto-build from the questions
    allItems().forEach(item => {
      if(!S.state[item.id]){
        const inNeeds = S.DATA.hardware.sectors[S.sector].needs.indexOf(item) !== -1;
        const base = {checked:false, optIdx:0, qty: inNeeds ? 1 : 0, auto: S.DATA.sim.derivedAuto[item.id] ? true : S.DATA.hardware.infra.indexOf(item) !== -1};
        if(item.calc === "training_init" || item.calc === "training_ongoing") base.checked = true; // training is the rule, not the exception
        if(item.builder){ base.path = "build"; base.reqs = Object.assign({}, item.defaultReqs); base.reqSupport = {}; base.reqInc = 1; base.aioSupport = "none"; }
        ensureManual(base, item);
        S.state[item.id] = base;
      }
    });
    derive();
    [["needs","needs-list"],["infra","infra-list"],["install","install-list"],["training","training-list"],["toys","toys-list"]].forEach(([tier, listId]) => {
      const list = $(listId);
      list.innerHTML = "";
      if(tier === "training"){ renderTrainingTier(list); return; }
      const items = tier === "infra" ? S.DATA.hardware.infra : tier === "install" ? S.DATA.hardware.install : S.DATA.hardware.sectors[S.sector][tier];
      items.forEach(item => {
        if(!S.state[item.id]){
          const base = {checked:false, optIdx:0, qty: tier === "needs" ? 1 : 0, auto: S.DATA.sim.derivedAuto[item.id] ? true : tier === "infra"};
          if(item.calc === "training_init" || item.calc === "training_ongoing") base.checked = true;
          if(item.builder){ base.path = "build"; base.reqs = Object.assign({}, item.defaultReqs); base.reqSupport = {}; base.reqInc = 1; base.aioSupport = "none"; }
          ensureManual(base, item);
          S.state[item.id] = base;
        }
        const st = S.state[item.id];
        const d = document.createElement("div");
        d.className = "sim-item";
        if(item.builder){ renderBuilder(d, item, st); list.appendChild(d); return; }
        const opt = item.options[st.optIdx];
        let inner = '<div><div class="name">' + item.name +
          (tier === "infra" && st.auto ? '<span class="auto-badge">auto</span>' : "") +
          recBadge(item) + bundledTag(opt) +
          '<span class="conf ' + opt.conf + '">' + S.DATA.sim.confLabel[opt.conf] + "</span></div>" +
          recWhy(item) +
          '<div class="detail">' + (opt.note || "") + "</div>";
        if(opt.upfront){ const LD = lifeDataFor(opt); inner += '<div class="life-line">⏳ Expected life: <strong>' + lifeLabel(opt) + "</strong>" + (LD ? ' <span class="life-src">(' + LD.conf + " confidence" + (LD.est ? " — estimate" : "") + (LD.src ? " — " + LD.src : "") + ")</span>" : (opt.lifeSrc ? ' <span class="life-src">(' + opt.lifeSrc + ")</span>" : "")) +
          (installHrsLabel(opt) ? ' · 🔧 Install: <strong>' + installHrsLabel(opt) + "</strong>" + (opt.installVar ? ' <span class="life-src">(' + opt.installVar + ")</span>" : "") : "") + "</div>"; }
        if(opt.support) inner += supportBox(item, st, opt);
        if(item.id === "terminal" && st.checked && getInputs().terminals <= 1)
          inner += '<div class="risk-line">' + S.DATA.sim.singleTerminalRisk + "</div>";
        if(st.why && st.checked) inner += '<div class="why-line">' + st.why + "</div>";
        if(tier === "infra" && st.rec && !st.checked) inner += '<div class="warn-line">' + (S.DATA.sim.infraWarns[item.id] || "") + "</div>";
        if(item.options.length > 1){
          inner += '<select data-item="' + item.id + '">';
          item.options.forEach((o,i) => {
            inner += '<option value="' + i + '"' + (i === st.optIdx ? " selected" : "") + ">" + o.label + "</option>";
          });
          inner += "</select>";
        } else {
          inner += '<div class="detail" style="margin-top:6px">' + opt.label + "</div>";
        }
        if(opt.bundled) inner += '<div class="detail">\u26a0\ufe0f <strong>Bundled processing:</strong> ' + S.DATA.sim.bundledNote + "</div>";
        if(item.sub) inner += '<div class="detail">' + item.sub + "</div>";
        if(item.calc === "per_unit"){
          inner += '<div class="qty"><button data-q="-1" data-item="' + item.id + '">−</button><span>' + st.qty + " " + (item.unit || "unit") + (st.qty === 1 ? "" : "s") + '</span><button data-q="1" data-item="' + item.id + '">+</button></div>';
        }
        const md = manualDef(item);
        if(md){
          inner += '<label class="sim-check"><input type="checkbox" data-manual="' + item.id + '"' + (st.manual ? " checked" : "") + '> <span><strong>Go manual instead</strong> — paper / Excel, $0 software</span></label>';
          if(st.manual){
            const perW = {week:"week", payperiod:"pay period", month:"month"}[md.per];
            inner += '<div class="manual-box">' +
              '<label class="mrow"><span>Manual time</span><input type="range" min="' + md.hrs[0] + '" max="' + md.hrs[1] + '" step="0.5" value="' + st.mhrs + '" data-mhrs="' + item.id + '" aria-label="Manual hours"><span><b>' + st.mhrs + " hrs/" + perW + "</b>" + (md.est ? " (est.)" : "") + "</span></label>" +
              '<label class="mrow"><span>Manager wage</span><input type="range" min="15" max="60" value="' + st.mwage + '" data-mwage="' + item.id + '" aria-label="Manager hourly wage"><span><b>CA$" + st.mwage + "/hr</b></span></label>' +
              '<div class="net-note">' + manualNetNote(item, opt) + "</div>" +
              '<div class="manual-src">Hours source: ' + md.src + "</div></div>";
          }
          /* P2: when the software is on (not manual), show the net labor value
             right on the card — residual hours already subtracted. */
          if(st.checked && !st.manual) inner += softwareLaborNote(item, st);
        }
        inner += "</div>";
        const isManual = md && st.manual;
        const isInstall = tier === "install";
        const priceTxt = isManual ? money(manualMonthly(item, st)) + "/mo"
          : isInstall ? (opt.info_only ? "quote-based" : dispAmt(opt.upfront, opt.cur) + " one-time")
          : opt.info_only ? "—" : money(itemMonthlyPreview(item, opt)) + "/mo" + ((opt.upfront && !opt.monthly) ? " equiv." : "");
        const perTxt = isManual ? "/mo manual labor"
          : isInstall ? (opt.info_only ? "get installer pricing" : "paid at install · never monthly")
          : opt.info_only ? "excluded from total"
          : (opt.upfront && opt.monthly) ? (dispAmt(opt.upfront, opt.cur) + " upfront + " + perLabel(item))
          : (opt.upfront && !opt.monthly) ? (dispAmt(opt.upfront, opt.cur) + " upfront ÷ " + lifeLabel(opt))
          : perLabel(item);
        inner += '<div class="price"><label class="sim-check" style="margin:0 0 6px;justify-content:flex-end"><input type="checkbox" data-item="' + item.id + '" aria-label="Include ' + item.name + '"' + (st.checked ? " checked" : "") + '></label>' +
          '<span class="amt">' + priceTxt + '</span><span class="per">' + perTxt + "</span></div>";
        d.innerHTML = inner;
        list.appendChild(d);
      });
    });
    listEvents();
    renderInstallLabor();
    recalc();
  }

  // preview monthly for one item using current inputs (for the per-item figure)



  function listEvents(){
    document.querySelectorAll("#needs-list select, #infra-list select, #install-list select, #toys-list select").forEach(sel => {
      sel.onchange = () => {
        const st = S.state[sel.dataset.item];
        st.optIdx = +sel.value;
        if(S.DATA.hardware.infra.some(i => i.id === sel.dataset.item)) st.auto = false; // manual override
        renderCatalog();
      };
    });
    document.querySelectorAll('#needs-list input[type="checkbox"][data-item], #infra-list input[type="checkbox"][data-item], #install-list input[type="checkbox"][data-item], #toys-list input[type="checkbox"][data-item]').forEach(cb => {
      cb.onchange = () => {
        const it = findItem(cb.dataset.item);
        const st = S.state[cb.dataset.item];
        st.checked = cb.checked;
        if(cb.dataset.item === "guestwifi") S.guestWifi = cb.checked; // play-mode toggle drives AP derivation
        if(cb.checked && it.calc === "per_unit" && st.qty < 1) st.qty = 1;
        if(S.DATA.hardware.infra.some(i => i.id === cb.dataset.item)) st.auto = false; // manual override
        renderCatalog();
      };
    });
    document.querySelectorAll('input[name="station-path"]').forEach(r => {
      r.onchange = () => { const st = S.state["station"]; if(st) st.path = r.value; renderCatalog(); };
    });
    document.querySelectorAll('input[data-req]').forEach(cb => {
      cb.onchange = () => {
        const st = S.state["station"]; if(!st || !st.reqs) return;
        st.reqs[cb.dataset.req] = cb.checked;
        if(cb.dataset.req === "scale") S.reqsAuto.scale = false; // manual override sticks
        if(cb.dataset.req === "scanner") S.reqsAuto.scanner = false;
        if(cb.dataset.req === "pinpad") S.terminalsTouched = false;
        if(cb.checked) st.checked = true;
        renderCatalog();
      };
    });
    document.querySelectorAll('input[data-support-plan]').forEach(r => {
      r.onchange = () => {
        const st = S.state[r.dataset.item];
        if(!st) return;
        st.support = r.dataset.supportPlan;
        renderCatalog();
      };
    });
    document.querySelectorAll('button[data-inc]').forEach(b => {
      b.onclick = () => {
        const st = S.state[b.dataset.item];
        if(!st) return;
        st.incidents = Math.max(0, Math.min(10, (st.incidents == null ? 1 : st.incidents) + (+b.dataset.inc)));
        renderCatalog();
      };
    });
    document.querySelectorAll('select[data-reqsup]').forEach(sel => {
      sel.onchange = () => {
        const st = S.state["station"]; if(!st) return;
        st.reqSupport = st.reqSupport || {};
        st.reqSupport[sel.dataset.reqsup] = sel.value;
        renderCatalog();
      };
    });
    document.querySelectorAll('select[data-aiosup]').forEach(sel => {
      sel.onchange = () => {
        const st = S.state[sel.dataset.aiosup]; if(!st) return;
        st.aioSupport = sel.value;
        renderCatalog();
      };
    });
    document.querySelectorAll('button[data-reqinc]').forEach(b => {
      b.onclick = () => {
        const st = S.state["station"]; if(!st) return;
        st.reqInc = Math.max(0, Math.min(10, (st.reqInc == null ? 1 : st.reqInc) + (+b.dataset.reqinc)));
        renderCatalog();
      };
    });
    document.querySelectorAll('input[data-manual]').forEach(cb => {
      cb.onchange = () => {
        const st = S.state[cb.dataset.manual];
        st.manual = cb.checked;
        if(cb.checked) st.checked = true;
        renderCatalog();
      };
    });
    const manualSlider = (sel, key) => {
      document.querySelectorAll(sel).forEach(r => {
        r.addEventListener("input", () => {
          const st = S.state[r.dataset.mhrs || r.dataset.mwage];
          st[key] = +r.value;
          const label = r.parentElement.querySelector("span:last-child b");
          if(label) label.textContent = key === "mhrs"
            ? (+r.value) + " hrs/" + ({week:"week", payperiod:"pay period", month:"month"}[manualDef(findItem(r.dataset.mhrs)).per])
            : "CA$" + r.value + "/hr";
          recalc();
        });
        r.addEventListener("change", () => renderCatalog());
      });
    };
    manualSlider('input[data-mhrs]', "mhrs");
    manualSlider('input[data-mwage]', "mwage");
    document.querySelectorAll(".qty button").forEach(b => {
      b.onclick = () => {
        const id = b.dataset.item;
        S.state[id].qty = Math.max(0, S.state[id].qty + (+b.dataset.q));
        if(S.state[id].qty > 0) S.state[id].checked = true;
        if(S.DATA.hardware.infra.some(i => i.id === id)) S.state[id].auto = false; // manual override
        renderCatalog();
      };
    });
  }



  /* ============================================================================
     VISUAL SETUP MAP — SVG floor plan of the merchant's checked devices.
     One node per checked item (the station builder = one node, qty = stations).
     Nodes sit in their S.sector zone (item.map.zone); infra gear with no item.map
     of its own (switch, firewall, APs, UPS, failover, internet) is drawn in the
     back office. Edges read the live S.NET wired/Wi-Fi per-zone plan: solid teal
     = wired run back to the switch, dashed amber = Wi-Fi to an AP. Payment
     devices (S.NET zone pay:true) on Wi-Fi get a warning badge tied to the
     dropped-signal warning in the network plan. Cost badges, lifecycle,
     support and install hours all come from the same data the catalog uses —
     nothing is invented here. renderMap() re-renders from `S.state` on every
     recalc() — there is no parallel store.
     ========================================================================== */

  function recalc(){
    const inp = getInputs();
    const s = S.DATA.hardware.sectors[S.sector];
    let total = 0;
    allItems().forEach(item => { total += itemMonthly(item, inp); });
    // processing line
    const proc = inp.volume * (inp.rate / 100);
    const save = inp.volume * 0.005;
    $("proc-cost").textContent = money(proc) + " / month";
    $("proc-save").innerHTML = "A 0.5% saving on that volume would be worth <strong>" + money(save) + "/month</strong> — " +
      "illustrative only; your statements decide the real number.";
    // % of revenue view (optional revenue input)
    const bm = S.DATA.sim.benchmarks[S.sector] || S.DATA.sim.benchmarks.retail;
    const sw = S.DATA.sim.sectorWord[S.sector] || "businesses";
    const sub = subsectorDef();
    // P1: transaction count from the average ticket (drives the per-transaction view)
    const txns = inp.volume > 0 && inp.ticket > 0 ? Math.round(inp.volume / inp.ticket) : 0;
    $("proc-tickets").innerHTML = txns > 0
      ? "That's ≈ <strong>" + txns.toLocaleString("en-CA") + " card transactions/month</strong> at your average ticket."
      : "";
    if(inp.revenue > 0){
      const techPct = (total * 12) / inp.revenue * 100;
      $("rev-lines").innerHTML = '<div class="row grand" style="font-size:1.1rem"><span>Your tech stack as % of revenue</span><span>' + pct1(techPct) + '</span></div>' +
        '<p class="fine" style="margin:.3em 0 0">Typical for ' + sw + ': <strong>' + bm.it + '</strong> of revenue on IT. (Processing fees sit outside published IT benchmarks — so your true tech-adjacent spend is higher than this line.)</p>';
      const procPct = (proc * 12) / inp.revenue * 100;
      $("proc-rev").innerHTML = "That's <strong>" + pct1(procPct) + " of your revenue</strong> going to processing " +
        "(typical " + sw + ": " + bm.proc + "). " + bm.note +
        ' <a href="contact.html">Find out your real processing % — free audit</a>.';
      // P3: the sub-sector's average margin turns processing into a share of profit.
      if(sub && sub.margin > 0){
        const share = Math.round(procPct / sub.margin * 100);
        $("proc-margin").innerHTML = "Typical net margin for " + esc(sub.label.toLowerCase()) + ": <strong>" + sub.margin +
          "%</strong> (industry average" + (sub.est ? ", estimate" : "") + ") — your " + pct1(procPct) +
          " processing eats <strong>" + share + "% of that margin</strong>, before a single fee saving.";
      } else {
        $("proc-margin").innerHTML = "";
      }
    } else {
      $("rev-lines").innerHTML = "";
      $("proc-rev").innerHTML = "";
      $("proc-margin").innerHTML = "";
    }
    // P2: stack-wide labor value — software time savings with residual labor subtracted.
    const lab = stackLaborValue();
    $("labor-line").innerHTML = lab.valMo > 0
      ? "💪 <strong>Labor value of this stack:</strong> saves ~" + (Math.round(lab.saveWk * 10) / 10) +
        " hrs/week vs doing it all by hand (≈ <strong>" + money(lab.valMo) + "/mo</strong> at your wage settings) — " +
        "the ~" + (Math.round(lab.resWk * 10) / 10) + " hrs/week of your time the software still needs is already subtracted." +
        (lab.est ? " (hours are estimates — your reality wins)" : "")
      : "";
    renderMap();
    updateTotalBar(total);
    updateInstallLaborTotal();
    renderPayBreakout();
    renderMarginEaters();
    renderNetPlan();
    S.totals = Object.assign(S.totals || {}, { monthly: total, save });
    if(typeof S.renderStrip === "function") S.renderStrip();
  }

  function updateTotalBar(total){
    if(total === undefined){
      const inp = getInputs(); const s = S.DATA.hardware.sectors[S.sector]; total = 0;
      allItems().forEach(item => { total += itemMonthly(item, inp); });
    }
    const inp = getInputs();
    const s = S.DATA.hardware.sectors[S.sector];
    let lines = "";
    allItems().forEach(item => {
      const m = itemMonthly(item, inp);
      if(m > 0){
        const mst = S.state[item.id];
        const conf = (mst.manual && manualDef(item)) ? "Manual labor" : item.builder ? "Reported" : item.calc === "training_ongoing" ? "Estimate" : S.DATA.sim.confLabel[item.options[mst.optIdx].conf];
        lines += '<div class="row"><span>' + item.name + ' <span style="opacity:.65;font-size:.9em">(' + conf + ")</span></span><span>" + money(m) + "/mo</span></div>";
      }
    });
    if(!lines) lines = '<div class="row"><span>No items selected yet</span><span>—</span></div>';
    $("total-lines").innerHTML = lines;
    $("grand-total").textContent = money(total) + "/mo";
  }

  ["in-locations","in-stations","in-terminals","in-employees","in-volume","in-ticket","in-rate","in-revenue","in-marketplace","in-subsector",
   "in-tables","in-bar","in-takeout","in-drivethru","in-seats","in-kiosks","in-sqft-r","in-weigh","in-sco",
   "in-rooms","in-floors","in-fb","in-sqft-g","in-deli","in-lottery","in-chairs","in-trooms","in-retailct",
   "in-o-how","in-o-spots","in-o-cof"]
    .forEach(id => {
      const el = $(id); if(!el) return;
      const h = () => {
        if(id === "in-stations") S.stationsAuto = false; // manual override sticks
        if(id === "in-terminals"){ S.terminalsAuto = false; S.terminalsTouched = true; }
        if(id === "in-subsector"){ S.subsector = $("in-subsector").value; renderSubsectors(); } // P3 picker state + refresh margin note
        if(id === "in-marketplace" && document.activeElement === $(id)){ ensureME(); S.ME.sales = null; }
        renderCatalog();
      };
      el.addEventListener("input", h);
      el.addEventListener("change", h);
    });
  // Keep the rate display clean: normalize any float artifact to max 2 decimals on edit.
  const rateEl = $("in-rate");
  if(rateEl) rateEl.addEventListener("change", () => {
    const v = parseFloat(rateEl.value);
    if(isFinite(v)) rateEl.value = Math.round(v * 100) / 100;
  });

  $("btn-typical").addEventListener("click", loadTypical);
  meEvents();

  initMapEvents(); // map section owns its listeners (visual-map.js)

  S.DATA = await loadData();
  S.recalc = recalc;
  S.getInputs = getInputs;
  S.renderCatalog = renderCatalog;
  applySectorInfraDefaults();
  renderSectors();
  loadTypical(); // auto-build a typical setup on load — instant first result, zero questions

/* Test hooks: named exports for the headless boot/section smoke test
   (tools-independent; harmless in production). */
export { getInputs, getQuestions, derive, loadTypical, renderCatalog, recalc, renderSectors, renderSubsectors, subsectorDef, applySectorInfraDefaults };
