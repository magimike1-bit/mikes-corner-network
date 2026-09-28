import { S } from './session.d6748862.js';
import { $, esc, money } from './util.03612f15.js';
import { dispAmt, lifeLabel, installHoursTotal, allItems, cadOf, installHrsLabel, installHrsMid, itemQty, itemUpfront, lifeDataFor, manualDef, manualMonthly } from './cost-engine.622d97a6.js';
import { netZoneDevices, netDevCounts, netWiredDrops, ensureNET } from './net-plan.a1631221.js';
/* map.js — generated module. Source of truth: js/ (edit here, then run tools/build-assets.mjs). */

  const MAP_NETZONE = { // item id -> S.NET zone id: how each device reaches the network
    station:"tills", terminal:"tills", pinpad:"tills", custdisplay:"tills", scanner:"tills",
    kprinter:"printers", labelprinter:"printers", signage:"printers",
    kds:"kds", kiosk:"kiosks", selfcheckout:"kiosks",
    tablets:"tablets", handheld:"tablets", mprinter:"tablets", bopc:"backoffice"
  };

  const MAP_NET_IDS = ["ap","switch","firewall","ups","failover"]; // network gear: drawn, never edged

  const MAP_SW_IDS = ["pos","ecom","acct","payroll","inventory","booking","pms"]; // software/services: no link

  const MAP_GEAR = { // infra items with no item.map of their own — presentation icons only; prices untouched
    ap:{icon:"📶", label:"AP"}, switch:{icon:"🔀", label:"Switch"}, firewall:{icon:"🧱", label:"Firewall"},
    ups:{icon:"🔋", label:"UPS"}, failover:{icon:"📡", label:"Failover"}, internet:{icon:"🌐", label:"Internet"}
  };

  const MAP_ADDON_ICON = {printer:"🧾", scanner:"🔍", drawer:"🗄️", scale:"⚖️", pinpad:"💳"};

  function mapCostOf(o){
    if(!o || o.info_only) return {quote:true};
    const hasUp = o.upfront != null, hasMo = o.monthly != null;
    const up = hasUp ? cadOf(o.upfront, o.cur) : 0;
    const mo = hasMo ? cadOf(o.monthly, o.cur) : 0;
    if(!up && !mo){
      if(!hasUp && !hasMo) return {quote:true};
      if(/quote/i.test(o.label || "")) return {quote:true};
      return {free:true};
    }
    return {up:up, mo:mo, lease:!!o.lease};
  }

  function mapPaidText(c){
    if(c.quote) return "Quote-based";
    if(c.free) return "Free";
    if(c.up && c.mo) return "Up front " + money(c.up) + " + " + money(c.mo) + "/mo" + (c.lease ? " (lease)" : "");
    if(c.up) return "Up front " + money(c.up);
    return money(c.mo) + "/mo" + (c.lease ? " (lease)" : "");
  }

  function mapSupLabel(p){ return S.DATA.sim.mapSupportLabel[p] || "None"; }

  function mapLife(opt){ return lifeDataFor(opt) ? lifeLabel(opt) : null; }

  function mapCollect(){
    const s = S.DATA.hardware.sectors[S.sector];
    const inp = S.getInputs();
    ensureNET();
    const nodes = [], rows = [];
    const boZone = s.zones.filter(z => z.id === "backoffice")[0] || s.zones[s.zones.length - 1];
    const zoneById = id => s.zones.filter(z => z.id === id)[0] || boZone;
    const netDef = id => S.DATA.network.filter(z => z.id === id)[0];
    allItems().forEach(item => {
      const st = S.state[item.id];
      if(!st || !st.checked) return;
      const gear = MAP_GEAR[item.id];
      const map = item.map || (gear ? {zone:boZone.id, icon:gear.icon, label:gear.label} : null);
      if(!map) return;
      const isNet = MAP_NET_IDS.indexOf(item.id) !== -1;
      const isSw = MAP_SW_IDS.indexOf(item.id) !== -1;
      const zone = zoneById(map.zone);
      const qty = Math.max(0, itemQty(item, inp));
      const n = item.builder ? Math.max(0, inp.stations) : qty;
      if(n <= 0) return;
      let link = null, payWarn = false;
      if(!isNet && !isSw){
        const nzId = MAP_NETZONE[item.id];
        const nz = nzId ? netDef(nzId) : null;
        link = nzId ? S.NET[nzId] : null;
        payWarn = !!(nz && nz.pay && link === "wifi");
      }
      const base = {itemId:item.id, name:item.name, icon:map.icon, label:map.label,
        zoneId:zone.id, zoneLabel:zone.label, qty:n,
        kind: isNet ? "net" : (isSw ? "sw" : "hw"), link:link, payWarn:payWarn};
      if(item.builder){ mapCollectBuilder(item, st, base, nodes, rows, netDef); return; }
      const opt = item.options[st.optIdx || 0] || {};
      const manual = st.manual && manualDef(item);
      const cost = manual ? {manual:true} : mapCostOf(opt);
      base.cost = cost;
      base.costTint = cost.manual ? "mo" : cost.free ? "free" : cost.quote ? "quote" : (cost.up && cost.mo) ? "both" : (cost.up ? "up" : "mo");
      base.lifeText = !isSw ? mapLife(opt) : null;
      base.supportText = opt.support ? mapSupLabel(st.support) : null;
      base.installText = installHrsLabel(opt);
      let paid = mapPaidText(cost);
      if(item.base) paid = money(item.base) + "/mo base + " + paid.charAt(0).toLowerCase() + paid.slice(1);
      if(manual) paid = "Manual \u2014 about " + money(manualMonthly(item, st)) + "/mo in labor";
      base.paidText = paid;
      nodes.push(base);
      rows.push({device:item.name, zone:zone.label, qty:n, link:link, payWarn:payWarn, kind:base.kind,
        paid:paid, life:base.lifeText || "\u2014", support:base.supportText || "\u2014", install:base.installText || "\u2014"});
    });
    // Install & setup: one back-office node aggregating checked install items (materials +
    // one-time services). Upfront math reuses itemUpfront() — the same function as the totals.
    // Tech install LABOR is reported separately in the install-labor line below the map.
    const instItems = S.DATA.hardware.install.filter(it => { const st = S.state[it.id]; return st && st.checked; });
    if(instItems.length){
      let instUp = 0, instQuoted = 0;
      const instNames = [];
      instItems.forEach(it => {
        instUp += itemUpfront(it, inp);
        const st = S.state[it.id];
        const opt = it.options[st.optIdx || 0];
        if(!opt || opt.info_only || !opt.upfront) instQuoted++;
        instNames.push(it.name);
      });
      const inCost = instUp > 0 ? {up:instUp} : {quote:true};
      const inPaid = instUp > 0 ? "Up front " + money(instUp) + " one-time" : "Quote-based";
      nodes.push({itemId:"install", name:"Install & setup", icon:"🔧", label:"Install",
        zoneId:boZone.id, zoneLabel:boZone.label, qty:1, kind:"svc", link:null, payWarn:false,
        cost:inCost, costTint:inCost.quote ? "quote" : "up",
        lifeText:null, supportText:null, installText:null, paidText:inPaid,
        chipsFull:instNames.join(", ") + (instQuoted ? " (" + instQuoted + " quote-based)" : ""),
        jumpText:"Press Enter to jump to the install section."});
      rows.push({device:"Install & setup (" + instItems.length + " item" + (instItems.length === 1 ? "" : "s") + ")",
        zone:boZone.label, qty:1, link:null, payWarn:false, kind:"svc", paid:inPaid,
        life:"\u2014", support:"\u2014", install:"\u2014"});
    }
    return {nodes:nodes, rows:rows};
  }

  function mapCollectBuilder(item, st, base, nodes, rows, netDef){
    const n = base.qty;
    if(st.path === "aio"){
      const cost = mapCostOf(item.aio);
      base.cost = cost;
      base.costTint = cost.free ? "free" : cost.quote ? "quote" : (cost.up ? "up" : "mo");
      base.lifeText = mapLife(item.aio);
      base.supportText = item.aio.support ? mapSupLabel(st.aioSupport) : null;
      base.installText = installHrsLabel(item.aio);
      base.paidText = mapPaidText(cost);
      base.chipsText = "all-in-one box";
      base.chipsFull = "all-in-one box (screen, reader and software in one)";
      nodes.push(base);
      rows.push({device:item.name + " (all-in-one)", zone:base.zoneLabel, qty:n, link:base.link,
        payWarn:base.payWarn, kind:"hw", paid:base.paidText, life:base.lifeText || "\u2014",
        support:base.supportText || "\u2014", install:base.installText || "\u2014"});
      return;
    }
    const addons = item.addons.filter(a => st.reqs && st.reqs[a.id]);
    let up = 0, hrs = 0;
    const lives = {}, sups = {}, names = [];
    // One grouped node per checked add-on type (qty = station count), plus the station node.
    // Network mapping: printer -> printers S.NET zone, scanner/pinpad -> tills S.NET zone;
    // drawer/scale are local devices with no network link.
    const ADDON_NET = {printer:"printers", scanner:"tills", pinpad:"tills"};
    const ADDON_SHORT = {printer:"Printer", scanner:"Scanner", drawer:"Cash drawer", scale:"Scale", pinpad:"PIN pad"};
    addons.forEach(a => {
      if(a.upfront) up += cadOf(a.upfront, a.cur);
      const L = mapLife(a); if(L) lives[L] = 1;
      if(a.support) sups[mapSupLabel(st.reqSupport && st.reqSupport[a.id])] = 1;
      hrs += installHrsMid(a);
      const aName = a.label.replace(/\s*\(.*?\)/g, "").trim();
      names.push((MAP_ADDON_ICON[a.id] || "") + " " + aName);
      const aNzId = ADDON_NET[a.id];
      const aNz = aNzId ? netDef(aNzId) : null;
      const aLink = aNzId ? S.NET[aNzId] : null;
      const aCost = mapCostOf(a);
      const an = {itemId:item.id, name:aName, icon:MAP_ADDON_ICON[a.id] || "🔧",
        label:ADDON_SHORT[a.id] || aName.slice(0, 14),
        zoneId:base.zoneId, zoneLabel:base.zoneLabel, qty:n,
        kind:"hw", link:aLink, payWarn:!!(aNz && aNz.pay && aLink === "wifi"), cost:aCost,
        costTint:aCost.free ? "free" : aCost.quote ? "quote" : (aCost.up ? "up" : "mo"),
        lifeText:mapLife(a),
        supportText:a.support ? mapSupLabel(st.reqSupport && st.reqSupport[a.id]) : null,
        installText:installHrsLabel(a)};
      an.paidText = aCost.up ? "Up front " + money(aCost.up) + " per station" : mapPaidText(aCost);
      nodes.push(an);
      rows.push({device:item.name + " — " + a.label, zone:base.zoneLabel, qty:n, link:aLink,
        payWarn:an.payWarn, kind:"hw", paid:an.paidText, life:an.lifeText || "—",
        support:an.supportText || "—", install:an.installText || "—"});
    });
    const cost = up > 0 ? {up:up} : {quote:true};
    base.cost = cost;
    base.costTint = cost.quote ? "quote" : "up";
    const lk = Object.keys(lives), sk = Object.keys(sups);
    base.lifeText = lk.length === 1 ? lk[0] : (lk.length ? "mixed — see list" : null);
    base.supportText = sk.length === 1 ? sk[0] : (sk.length ? "mixed — see list" : null);
    base.installText = hrs > 0 ? "~" + (Math.round(hrs * 10) / 10) + " hrs/station" : null;
    base.paidText = up > 0 ? "Up front " + money(up) + " per station" : "Quote-based";
    base.chipsFull = names.join(", ") + " — shown as separate nodes";
    base.chipsText = names.join(" · ");
    if(base.chipsText.length > 34) base.chipsText = base.chipsText.slice(0, 32) + "…";
    nodes.push(base);
    rows.push({device:item.name + " — station unit (add-ons listed separately)", zone:base.zoneLabel, qty:n,
      link:base.link, payWarn:base.payWarn, kind:"hw", paid:base.paidText,
      life:base.lifeText || "—", support:base.supportText || "—", install:base.installText || "—"});
  }

  function mapNodeAria(n){
    let t = n.name + ", " + n.zoneLabel + ", quantity " + n.qty + ". ";
    if(n.kind === "hw"){
      t += n.link === "wifi" ? "Connected over Wi-Fi. " : n.link === "wired" ? "Wired connection. " : "Local device — no network connection. ";
      if(n.payWarn) t += "Warning: this device takes payment over Wi-Fi. A dropped signal mid-transaction can mean a lost sale or a double charge. See the network-plan warning. ";
    } else if(n.kind === "net") t += "Network gear. ";
    else if(n.kind === "svc") t += "One-time setup service. ";
    else t += "Software or service. ";
    t += "Cost: " + n.paidText + ". ";
    if(n.lifeText) t += "Expected life " + n.lifeText + ". ";
    if(n.supportText) t += "Support: " + n.supportText + ". ";
    if(n.installText) t += "Install " + n.installText + ". ";
    if(n.chipsFull) t += "Includes: " + n.chipsFull + ". ";
    return t.replace(/\s+/g, " ").trim();
  }

  function mapApplyView(){
    const svgOn = S.mapViewPref === "svg";
    const bS = $("map-view-svg"), bL = $("map-view-list");
    if(bS){ bS.setAttribute("aria-pressed", svgOn ? "true" : "false"); bS.classList.toggle("active", svgOn); }
    if(bL){ bL.setAttribute("aria-pressed", svgOn ? "false" : "true"); bL.classList.toggle("active", !svgOn); }
    const sm = $("sim-map"), tw = $("map-table-wrap");
    if(sm) sm.hidden = !svgOn;
    if(tw) tw.hidden = svgOn;
  }

  function renderMapTable(rows){
    const tb = $("map-tbody");
    if(!tb) return;
    if(!rows.length){
      tb.innerHTML = '<tr><td colspan="8">Tick items in your stack \u2014 they\u2019ll appear here.</td></tr>';
      return;
    }
    tb.innerHTML = rows.map(r => {
      const link = r.link === "wired" ? "Wired" : r.link === "wifi"
        ? (r.payWarn ? '<span class="warn-cell">\u26a0 Wi-Fi \u2014 payment on Wi-Fi</span>' : "Wi-Fi")
        : (r.kind === "net" ? "— (network gear)" : r.kind === "hw" ? "— (local)" : r.kind === "svc" ? "— (service)" : "— (software)");
      return "<tr><td><strong>" + esc(r.device) + "</strong></td><td>" + esc(r.zone) + "</td><td>" +
        (r.qty > 1 ? "\u00d7" + r.qty : "1") + "</td><td>" + link + "</td><td>" + esc(r.paid) + "</td><td>" +
        esc(r.life) + "</td><td>" + esc(r.support) + "</td><td>" + esc(r.install) + "</td></tr>";
    }).join("");
  }

  function renderMapAlert(nodes){
    const el = $("map-alert");
    if(!el) return;
    const bad = nodes.filter(n => n.payWarn);
    if(!bad.length){ el.innerHTML = ""; return; }
    const names = bad.map(n => n.label + (n.qty > 1 ? " \u00d7" + n.qty : "")).join(", ");
    const totalQty = bad.reduce((s, n) => s + n.qty, 0);
    el.innerHTML = '<div class="map-warn">\u26a0\ufe0f <strong>' + totalQty + " payment device" +
      (totalQty === 1 ? "" : "s") + " on Wi-Fi (" + esc(names) + ").</strong> " +
      "When the signal drops mid-transaction, the terminal can lose its connection in the middle of the authorization \u2014 " +
      "a lost sale, or a card charged with no record on your end. " +
      '<a href="#net-plan">Read the full warning in the network plan</a> \u2014 the devices that take money should get cables.</div>';
  }

  function renderMapInstallLine(){
    const el = $("map-install-line");
    if(!el) return;
    const hrs = installHoursTotal(S.getInputs());
    el.innerHTML = hrs > 0
      ? "\ud83d\udd27 Install labor across your stack: <strong>~" + (Math.round(hrs * 10) / 10) +
        " hrs</strong> \u00d7 $" + S.techRate + "/hr = <strong>" + money(hrs * S.techRate) + "</strong> one-time, paid at install."
      : "";
  }

  function mapNodeSvg(n, ni, CW, CH){
    const warn = n.payWarn;
    const tint = n.costTint === "up" ? "#dbeafe" : n.costTint === "mo" ? "#dcfce7" :
      n.costTint === "free" ? "#eef4ee" :
      n.costTint === "both" ? "url(#mapgrad" + ni + ")" : "#eef2f6";
    let h = '<g class="map-node" tabindex="0" role="button" data-node="' + n.itemId + '" aria-label="' +
      esc(mapNodeAria(n) + " " + (n.jumpText || "Press Enter to jump to this item in your stack.")) +
      '" transform="translate(' + n._x + "," + n._y + ')">';
    h += '<rect class="focus-ring" x="-5" y="-5" width="' + (CW + 10) + '" height="' + (CH + 10) +
      '" rx="15" fill="none" stroke="#1b9e57" stroke-width="3"/>';
    if(n.costTint === "both")
      h += '<defs><linearGradient id="mapgrad' + ni + '" x1="0" y1="0" x2="1" y2="0">' +
        '<stop offset="50%" stop-color="#dbeafe"/><stop offset="50%" stop-color="#dcfce7"/></linearGradient></defs>';
    h += '<clipPath id="mapclip' + ni + '"><rect width="' + CW + '" height="' + CH + '" rx="10"/></clipPath>' +
      '<rect width="' + CW + '" height="' + CH + '" rx="10" fill="#ffffff" stroke="' +
      (warn ? "#dc2626" : "#c9d8d2") + '" stroke-width="' + (warn ? 2.5 : 1.5) + '"/>' +
      '<g clip-path="url(#mapclip' + ni + ')"><rect width="' + CW + '" height="36" fill="' + tint + '"/>' +
      '<rect y="36" width="' + CW + '" height="1.5" fill="#e2e9f1"/></g>';
    h += '<text x="12" y="25" font-size="20">' + n.icon + "</text>" +
      '<text x="40" y="24" font-size="13" font-weight="700" fill="#0e2a47">' + esc(n.label) + "</text>";
    let hx = CW - 12;
    if(n.qty > 1){
      h += '<text x="' + hx + '" y="24" font-size="12" font-weight="700" fill="#5a6b66" text-anchor="end">\u00d7' + n.qty + "</text>";
      hx -= 34;
    }
    if(warn) h += '<text x="' + hx + '" y="26" font-size="17" text-anchor="end">\u26a0\ufe0f</text>';
    let px = 12;
    const pill = (txt, bg, fg) => {
      const w = Math.round(txt.length * 6.6 + 18);
      const s = '<rect x="' + px + '" y="46" width="' + w + '" height="22" rx="11" fill="' + bg + '"/>' +
        '<text x="' + (px + 9) + '" y="61.5" font-size="11.5" font-weight="700" fill="' + fg + '">' + esc(txt) + "</text>";
      px += w + 8;
      return s;
    };
    if(n.cost.manual) h += pill("manual labor", "#dcfce7", "#15803d");
    else if(n.cost.free) h += pill("free", "#eef4ee", "#3f7d4e");
    else if(n.cost.quote) h += pill("quote-based", "#eef2f6", "#64748b");
    else {
      if(n.cost.up) h += pill("\u2191 " + money(n.cost.up), "#dbeafe", "#1d4ed8");
      if(n.cost.mo) h += pill("\u21bb " + money(n.cost.mo) + "/mo" + (n.cost.lease ? " lease" : ""), "#dcfce7", "#15803d");
    }
    const r2 = n.chipsText ? n.chipsText : (n.kind === "sw" ? "software / service" : (n.lifeText ? "\u23f3 life " + n.lifeText : null));
    const r3 = n.chipsText ? (n.lifeText ? "\u23f3 life " + n.lifeText : null)
                           : (n.supportText ? "\ud83d\udee1\ufe0f support: " + n.supportText : null);
    const r4 = n.chipsText
      ? [n.supportText ? "\ud83d\udee1\ufe0f " + n.supportText : null, n.installText ? "\ud83d\udd27 " + n.installText : null].filter(Boolean).join(" \u00b7 ") || null
      : (n.installText ? "\ud83d\udd27 install " + n.installText : null);
    [r2, r3, r4].forEach((t, ri) => {
      if(t) h += '<text x="12" y="' + (86 + ri * 20) + '" font-size="11.5" fill="#5a6b66">' + esc(t) + "</text>";
    });
    return h + "</g>";
  }

  function renderMap(){
    const svg = $("floorplan");
    if(!svg) return;
    if(S.mapViewPref === null) S.mapViewPref = S.mapNarrow ? "list" : "svg";
    mapApplyView();
    const built = mapCollect();
    renderMapTable(built.rows);
    renderMapAlert(built.nodes);
    renderMapInstallLine();
    if(S.mapViewPref !== "svg"){ svg.innerHTML = ""; svg.setAttribute("viewBox", "0 0 640 80"); return; }
    const s = S.DATA.hardware.sectors[S.sector];
    const CW = 196, CH = 140, CG = 14, ZP = 16, ZT = 38, ZGAP = 18;
    const MAXW = S.mapNarrow ? 640 : 1180;
    const byZone = {};
    s.zones.forEach(z => byZone[z.id] = []);
    const lastZone = s.zones[s.zones.length - 1];
    built.nodes.forEach(n => { (byZone[n.zoneId] || byZone[lastZone.id]).push(n); });
    const boxes = s.zones.map(z => ({z:z, list:byZone[z.id]})).filter(b => b.list.length);
    if(!boxes.length){
      svg.setAttribute("viewBox", "0 0 640 80");
      svg.innerHTML = '<text x="16" y="46" font-size="17" fill="#9aa8a3">Tick items in your stack \u2014 they\u2019ll appear here.</text>';
      return;
    }
    boxes.forEach(b => {
      const n = b.list.length;
      b.cols = n === 1 ? 1 : n <= 4 ? 2 : 3;
      b.rowsN = Math.ceil(n / b.cols);
      b.w = b.cols * (CW + CG) - CG + ZP * 2;
      b.h = ZT + b.rowsN * (CH + CG) - CG + ZP + 4;
    });
    let x = 0, y = 0, rowH = 0, W = 0;
    boxes.forEach(b => {
      if(x > 0 && x + b.w > MAXW){ x = 0; y += rowH + ZGAP; rowH = 0; }
      b.x = x; b.y = y; x += b.w + ZGAP; rowH = Math.max(rowH, b.h);
      W = Math.max(W, b.x + b.w);
    });
    const H = y + rowH + 10;
    const byId = {};
    boxes.forEach(b => b.list.forEach((n, i) => {
      n._x = b.x + ZP + (i % b.cols) * (CW + CG);
      n._y = b.y + ZT + Math.floor(i / b.cols) * (CH + CG);
      byId[n.itemId] = n;
    }));
    // network hub: the switch node, else a ghost marker in the back office
    const swNode = byId["switch"];
    const boBox = boxes.filter(b => b.z.id === "backoffice")[0] || boxes[boxes.length - 1];
    const hub = swNode ? {x:swNode._x + CW / 2, y:swNode._y + CH / 2}
                       : {x:boBox.x + boBox.w - 46, y:boBox.y + boBox.h - 36};
    // Wired-run callout uses the single authoritative count shared with the network plan
    // (netWiredDrops) — never a separate node tally, so the two views always agree.
    const wiredN = netWiredDrops();
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    const apOn = !!(S.state["ap"] && S.state["ap"].checked);
    const wifiAt = {};
    boxes.forEach(b => {
      if(b.list.some(n => n.kind === "hw" && n.link === "wifi")) wifiAt[b.z.id] = {x:b.x + b.w - 32, y:b.y + 22};
    });
    let h = "";
    boxes.forEach(b => {
      h += '<rect x="' + b.x + '" y="' + b.y + '" width="' + b.w + '" height="' + b.h +
        '" rx="10" fill="#f4f8f6" stroke="#c9d8d2"/>' +
        '<text x="' + (b.x + 14) + '" y="' + (b.y + 25) + '" font-size="15" font-weight="700" fill="#5a6b66">' +
        esc(b.z.label) + "</text>";
    });
    // edges, drawn under the nodes
    built.nodes.forEach(n => {
      if(n.kind !== "hw" || !n.link) return;
      const cx = n._x + CW / 2;
      if(n.link === "wired"){
        h += '<line x1="' + cx + '" y1="' + (n._y + CH) + '" x2="' + hub.x + '" y2="' + hub.y +
          '" stroke="#0f766e" stroke-width="2" opacity="0.5"/>';
      } else {
        const m = wifiAt[n.zoneId];
        if(m) h += '<line x1="' + cx + '" y1="' + n._y + '" x2="' + m.x + '" y2="' + m.y +
          '" stroke="' + (n.payWarn ? "#dc2626" : "#b45309") + '" stroke-width="2" stroke-dasharray="7,5" opacity="0.75"/>';
      }
    });
    // wi-fi markers (link targets)
    Object.keys(wifiAt).forEach(zid => {
      const m = wifiAt[zid];
      h += '<g><title>' + (apOn ? "Wi-Fi access point" : "Wi-Fi here \u2014 no access point in your stack yet (see Infrastructure)") + "</title>" +
        '<text x="' + m.x + '" y="' + m.y + '" font-size="24" text-anchor="middle"' + (apOn ? "" : ' opacity="0.4"') + ">\ud83d\udcf6</text>" +
        '<text x="' + m.x + '" y="' + (m.y + 18) + '" font-size="11" text-anchor="middle" fill="#8a9a94">wi-fi</text></g>';
    });
    if(!swNode){
      h += '<g><title>No switch in your stack yet \u2014 wired devices need one (see Infrastructure)</title>' +
        '<circle cx="' + hub.x + '" cy="' + hub.y + '" r="17" fill="#ffffff" stroke="#9aa8a3" stroke-width="2" stroke-dasharray="4,3"/>' +
        '<text x="' + hub.x + '" y="' + (hub.y + 8) + '" font-size="20" text-anchor="middle" opacity="0.55">\ud83d\udd00</text></g>';
    }
    // wired-run callout lives in the back-office header's empty top-right: never clips, never overlaps nodes
    if(wiredN > 0)
      h += '<text x="' + (boBox.x + boBox.w - 12) + '" y="' + (boBox.y + 25) + '" font-size="12" fill="#0f766e" text-anchor="end">\ud83d\udd0c ' +
        wiredN + " wired run" + (wiredN === 1 ? "" : "s") + " shown</text>";
    built.nodes.forEach((n, ni) => { h += mapNodeSvg(n, ni, CW, CH); });
    svg.innerHTML = h;
  }

  function mapJumpToItem(itemId){
    let t = document.querySelector('[data-item="' + itemId + '"]');
    if(!t && itemId === "install") t = document.getElementById("install-list");
    if(!t) return;
    const card = t.closest ? t.closest(".sim-item") : null;
    if(t.scrollIntoView) t.scrollIntoView({behavior:"smooth", block:"center"});
    if(card){
      card.style.boxShadow = "0 0 0 3px var(--accent)";
      setTimeout(() => { card.style.boxShadow = ""; }, 1600);
    }
    if(t.tagName === "INPUT") t.focus({preventScroll:true});
  }

  /* Map-owned event wiring: view toggle, keyboard traversal, node activation,
     responsive re-layout. Called once by sim-core boot — the map section owns
     its listeners; core never touches map DOM directly. */
  function initMapEvents(){
    const mapBtnS = document.getElementById("map-view-svg"), mapBtnL = document.getElementById("map-view-list");
    if(mapBtnS) mapBtnS.addEventListener("click", () => { S.mapViewPref = "svg"; renderMap(); });
    if(mapBtnL) mapBtnL.addEventListener("click", () => { S.mapViewPref = "list"; renderMap(); });

    const fpSvg = document.getElementById("floorplan");
    if(fpSvg){
      fpSvg.addEventListener("keydown", e => {
        const k = e.key;
        const nodes = Array.prototype.slice.call(fpSvg.querySelectorAll(".map-node"));
        const i = nodes.indexOf(document.activeElement);
        if(i === -1) return;
        if(k === "Enter" || k === " "){
          e.preventDefault();
          mapJumpToItem(nodes[i].getAttribute("data-node"));
        } else if(k === "ArrowRight" || k === "ArrowDown" || k === "ArrowLeft" || k === "ArrowUp"){
          e.preventDefault();
          const d = (k === "ArrowRight" || k === "ArrowDown") ? 1 : -1;
          const nx = nodes[(i + d + nodes.length) % nodes.length];
          if(nx) nx.focus();
        }
      });
      fpSvg.addEventListener("click", e => {
        const g = e.target && e.target.closest ? e.target.closest(".map-node") : null;
        if(g && fpSvg.contains(g)) mapJumpToItem(g.getAttribute("data-node"));
      });
    }

    let mapResizeT = null;
    window.addEventListener("resize", () => {
      const narrow = window.innerWidth < 720;
      if(narrow === S.mapNarrow) return;
      S.mapNarrow = narrow;
      clearTimeout(mapResizeT);
      mapResizeT = setTimeout(() => { if(S.mapViewPref === "svg") renderMap(); }, 250);
    });
  }

export { renderMap, mapJumpToItem, initMapEvents };
