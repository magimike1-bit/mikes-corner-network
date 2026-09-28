import { S } from './session.d6748862.js';
import { $, money } from './util.03612f15.js';
import { dispAmt, cadOf, findItem, itemQty } from './cost-engine.622d97a6.js';
/* netplan.js — generated module. Source of truth: js/ (edit here, then run tools/build-assets.mjs). */

  function ensureNET(){
    if(!S.NET){ S.NET = {}; S.DATA.network.forEach(z => { S.NET[z.id] = z.def; }); }
  }

  function netDevCounts(){
    // Authoritative device quantities: use itemQty (per_station/per_terminal/per_unit),
    // NOT st.qty — st.qty is 1 for terminal/station while the real counts live in inputs.
    const inp = S.getInputs();
    const q = id => { const item = findItem(id); const st = S.state[id];
      return (item && st && st.checked) ? Math.max(0, itemQty(item, inp)) : 0; };
    const c = { station:q("station"), terminal:q("terminal"), printer:q("printer"),
             kprinter:q("kprinter"), labelprinter:q("labelprinter"), kds:q("kds"),
             kiosk:q("kiosk"), selfcheckout:q("selfcheckout"), tablets:q("tablets"),
             bopc:q("bopc"), ap:q("ap") };
    // station-builder addons (per-lane printer/scanner/drawer/scale) also need network
    const sst = S.state["station"];
    if(sst && sst.checked){
      const n = Math.max(0, itemQty(findItem("station"), inp));
      ["printer","scanner","drawer","scale"].forEach(a => {
        if(sst.reqs && sst.reqs[a]) c[a] = (c[a] || 0) + n;
      });
    }
    return c;
  }

  function netZoneDevices(){
    ensureNET();
    const d = netDevCounts(), out = {};
    S.DATA.network.forEach(z => { out[z.id] = (z.dev || []).reduce((n, k) => n + (d[k] || 0), 0); });
    out.aps = d.ap;
    return out;
  }

  function netWiredDrops(){
    const zd = netZoneDevices();
    let n = zd.aps;
    S.DATA.network.forEach(z => { if(S.NET[z.id] === "wired") n += zd[z.id]; });
    return n;
  }

  function netWiredDesc(){
    const zd = netZoneDevices();
    let dev = 0;
    S.DATA.network.forEach(z => { if(S.NET[z.id] === "wired") dev += zd[z.id]; });
    return dev + " wired devices + " + zd.aps + " APs";
  }

  function dropUnitCost(){
    const item = findItem("drops"), st = S.state["drops"];
    if(item && st){ const opt = item.options[st.optIdx || 0]; if(opt && opt.upfront) return cadOf(opt.upfront, opt.cur); }
    return 175;
  }

  function renderNetPlan(){
    const host = $("net-plan");
    if(!host) return;
    ensureNET();
    const zd = netZoneDevices(), perRun = dropUnitCost();
    let h = '<div class="net-plan"><h4>🌐 Network plan — wired or Wi-Fi, per zone</h4>' +
      '<div class="net-trade"><strong>Hardwired:</strong> more secure and more reliable — a till that can\u2019t drop mid-transaction. ' +
      'But every cable run costs real money (~$' + perRun + ' installed, per your cable-drop selection below).<br>' +
      '<strong>Wi-Fi:</strong> far cheaper to scale — one good access point covers dozens of devices for the same money. ' +
      'But less secure and less reliable — a congested or dropped signal at the till is a failed sale.<br>' +
      '<strong>The realistic answer is hybrid</strong> (the default): the devices that take money get cables; the devices that move get Wi-Fi.</div>';
    S.DATA.network.forEach(z => {
      const n = zd[z.id], cur = S.NET[z.id];
      h += '<div class="net-zone"><span class="zname">' + z.label + '</span>' +
        '<span class="zdev">' + (n > 0 ? n + " device" + (n === 1 ? "" : "s") : "no devices selected") + '</span>' +
        '<label><input type="radio" name="net-' + z.id + '" data-zone="' + z.id + '" value="wired"' + (cur === "wired" ? " checked" : "") + '> Wired</label>' +
        '<label><input type="radio" name="net-' + z.id + '" data-zone="' + z.id + '" value="wifi"' + (cur === "wifi" ? " checked" : "") + '> Wi-Fi</label></div>';
    });
    // payment-on-wifi warning (unmissable, inline)
    const payOnWifi = S.DATA.network.some(z => z.pay && S.NET[z.id] === "wifi" && zd[z.id] > 0);
    if(payOnWifi){
      h += '<div class="wifi-warn"><span class="wt">\u26a0\ufe0f Read this before you put payment on Wi-Fi</span>' +
        'When the signal drops mid-transaction, the terminal loses its connection <strong>in the middle of the authorization</strong>. ' +
        'Two bad outcomes: the sale doesn\u2019t complete and you look down to find nothing went through — or worse, ' +
        'the customer\u2019s card <strong>is</strong> charged but your POS never sees the approval. You find out at closeout when the batch doesn\u2019t balance: ' +
        'a $48 charge the customer swears they paid, no record on your end. Voiding it and re-running means the customer sees ' +
        'two pending charges in their banking app and panics — <strong>while the line builds behind them</strong>.<br>' +
        '<strong>What\u2019s exposed:</strong> anything taking payment over Wi-Fi — tableside handhelds, mobile terminals, kiosks.<br>' +
        '<strong>How to protect yourself:</strong> (1) <strong>Offline mode</strong>, where your processor supports it — the terminal stores the transaction ' +
        'and submits when the signal returns, but if that card was maxed out or stolen, <em>you</em> eat it. ' +
        '(2) A <strong>second AP or failover Wi-Fi network</strong>, so one dead AP doesn\u2019t kill the floor. ' +
        '(3) Keep <strong>at least one wired till as the fallback</strong> — when Wi-Fi dies, you walk the customer to the till that can\u2019t drop.</div>';
    }
    // cost scenarios
    const allDev = S.DATA.network.reduce((s, z) => s + zd[z.id], 0);
    const scen = [
      {t:"All-wired", drops: allDev + zd.aps, rec:false,
       n:"Maximum reliability. Every device gets a cable — and every cable costs $" + perRun + "."},
      {t:"Your hybrid (recommended)", drops: netWiredDrops(), rec:true,
       n:"The devices that take money get cables; the devices that move get Wi-Fi."},
      {t:"All-Wi-Fi", drops: zd.aps, rec:false,
       n:"Cheapest to install — APs still need their own cable runs. Read the warning above before choosing this to save money."}
    ];
    h += '<div class="net-scen">';
    scen.forEach(s => {
      const one = s.drops * perRun;
      h += '<div class="sc' + (s.rec ? " rec" : "") + '"><div class="t">' + s.t + '</div>' +
        '<div class="c">' + money(one) + '</div>' +
        '<div class="m">one-time · ~' + money(one / 180) + '/mo equiv. over 15-yr cable life (' + s.drops + ' runs)</div>' +
        '<div class="n">' + s.n + '</div></div>';
    });
    h += "</div></div>";
    host.innerHTML = h;
    host.querySelectorAll('input[type=radio][data-zone]').forEach(r => {
      r.addEventListener("change", () => {
        ensureNET(); S.NET[r.dataset.zone] = r.value;
        const dSt = S.state["drops"]; if(dSt) dSt.auto = true; // plan drives the drops
        S.renderCatalog();
      });
    });
  }

export { ensureNET, netDevCounts, netZoneDevices, netWiredDrops, netWiredDesc, dropUnitCost, renderNetPlan };
