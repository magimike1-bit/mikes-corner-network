import { S } from './session.d6748862.js';
import { $, money, pct1 } from './util.03612f15.js';
import { allItems, itemMonthly } from './cost-engine.622d97a6.js';
/* me.js — generated module. Source of truth: js/ (edit here, then run tools/build-assets.mjs). */

  function ensureME(){
    if(!S.ME) S.ME = {platform:"doordash", plan:0, sales:null, share:15, site:49, fee:"", ticket:40,
                  oName:"", oPct:"", oBase:""};
  }

  function meSales(){
    ensureME();
    return S.ME.sales !== null && S.ME.sales !== "" ? Math.max(0, +S.ME.sales || 0) : Math.max(0, +($("in-marketplace") ? $("in-marketplace").value : 0) || 0);
  }

  function renderMarginEaters(){
    ensureME();
    const pSel = $("me-platform"), plSel = $("me-plan");
    if(pSel && !pSel.options.length){
      Object.keys(S.DATA.sim.commissionPlans).forEach(k => {
        const o = document.createElement("option"); o.value = k; o.textContent = S.DATA.sim.commissionPlans[k].label;
        pSel.appendChild(o);
      });
    }
    if(pSel) pSel.value = S.ME.platform;
    const plat = S.DATA.sim.commissionPlans[S.ME.platform] || S.DATA.sim.commissionPlans.doordash;
    if(plSel){
      plSel.innerHTML = "";
      plat.plans.forEach((p, i) => {
        const o = document.createElement("option"); o.value = i; o.textContent = p.name + " (" + Math.round(p.rate * 100) + "%)";
        plSel.appendChild(o);
      });
      plSel.value = Math.min(S.ME.plan, plat.plans.length - 1);
    }
    const plan = plat.plans[Math.min(S.ME.plan, plat.plans.length - 1)];
    if($("me-plan-src")) $("me-plan-src").textContent = "Source: " + plat.src;
    const sales = meSales();
    if($("me-sales") && document.activeElement !== $("me-sales")) $("me-sales").value = sales || "";
    if($("me-share")) $("me-share").value = S.ME.share;
    if($("me-share-v")) $("me-share-v").textContent = S.ME.share + "%";
    const inp = S.getInputs();
    // --- card 1: commission cost ---
    const comm = sales * plan.rate;
    let revPct = "";
    if(inp.revenue > 0 && comm > 0) revPct = " \u2014 that\u2019s " + pct1(comm * 12 / inp.revenue * 100) + " of your revenue";
    $("me-comm-result").innerHTML = sales > 0
      ? 'At&nbsp;<b>' + money(sales) + '/mo</b>&nbsp;in delivery sales, ' + plat.label + " " + plan.name +
        ' costs you&nbsp;<span class="big">' + money(comm) + '/mo</span>' + revPct +
        '.<br>Cost-of-sales, not IT \u2014 kept out of your tech stack total on purpose.'
      : "Enter your monthly delivery-app sales above \u2014 then watch what the % really costs.";
    // --- card 2: first-party comparison ---
    const ticket = Math.max(1, +S.ME.ticket || 40);
    const orders = sales > 0 ? sales / ticket : 0;
    const fee = S.ME.fee === "" ? null : Math.max(0, +S.ME.fee || 0);
    const site = +S.ME.site || 0;
    let cmp;
    if(sales <= 0) cmp = "Enter delivery sales on the left to run the comparison.";
    else if(fee === null) cmp = "Enter <em>your</em> per-order delivery cost above to see the break-even.";
    else {
      const flat = site + fee * orders;
      const diff = comm - flat;
      const perOrderRate = fee / ticket;
      let be = "";
      if(plan.rate > perOrderRate && site > 0)
        be = " The flat setup wins once delivery passes <b>" + money(site / (plan.rate - perOrderRate)) + "/mo</b>.";
      else if(site === 0 && plan.rate > perOrderRate)
        be = " With no website cost, your own setup wins at any volume.";
      cmp = "At " + money(sales) + "/mo in delivery sales, the " + Math.round(plan.rate * 100) + "% commission costs you <b>" +
        money(comm) + "/mo</b> \u2014 your own ordering setup costs ~<b>" + money(flat) + "/mo</b> flat (" +
        money(site) + " website + " + money(fee * orders) + " delivery)." +
        (diff >= 0 ? " You\u2019d keep <b>" + money(diff) + "/mo</b> going first-party." + be
                   : " At this volume the apps are cheaper by <b>" + money(-diff) + "/mo</b> \u2014 but that flips as you grow." + be);
    }
    $("me-compare-result").innerHTML = cmp;
    // --- card 3: other platform cut ---
    const oPct = Math.max(0, +S.ME.oPct || 0), oBase = Math.max(0, +S.ME.oBase || 0);
    $("me-other-result").innerHTML = (oPct > 0 && oBase > 0)
      ? "<b>" + money(oBase * oPct / 100) + "/mo</b> to " + (S.ME.oName || "the platform") + " (" + oPct + "% of " + money(oBase) + "). Also cost-of-sales."
      : "Fill in the three fields to price any revenue-based cut.";
    // --- total ---
    const other = (oPct > 0 && oBase > 0) ? oBase * oPct / 100 : 0;
    const total = comm + other;
    let techTotal = 0;
    allItems().forEach(item => { techTotal += itemMonthly(item, inp); });
    $("me-total").innerHTML = "<span>Total margin eaters: " + money(total) + "/mo</span>" +
      '<span class="sub">on top of your ' + money(techTotal) + '/mo tech stack \u2014 two different budgets, two different decisions</span>';
  }

  function meEvents(){
    const bind = (id, key, parse) => {
      const el = $(id); if(!el) return;
      el.addEventListener("input", () => {
        ensureME(); S.ME[key] = parse(el.value);
        if(id === "me-sales" && $("in-marketplace")) $("in-marketplace").value = el.value;
        S.recalc();
      });
      el.addEventListener("change", () => { ensureME(); S.ME[key] = parse(el.value); renderMarginEaters(); });
    };
    bind("me-platform", "platform", v => v);
    bind("me-plan", "plan", v => +v || 0);
    bind("me-sales", "sales", v => (v === "" ? null : Math.max(0, +v || 0)));
    bind("me-site", "site", v => +v || 0);
    bind("me-fee", "fee", v => (v === "" ? "" : Math.max(0, +v || 0)));
    bind("me-ticket", "ticket", v => Math.max(1, +v || 40));
    bind("me-other-name", "oName", v => v);
    bind("me-other-pct", "oPct", v => (v === "" ? "" : Math.max(0, +v || 0)));
    bind("me-other-base", "oBase", v => (v === "" ? "" : Math.max(0, +v || 0)));
    const sh = $("me-share");
    if(sh){
      sh.addEventListener("input", () => {
        ensureME(); S.ME.share = +sh.value || 0;
        const rev = Math.max(0, +($("in-revenue") ? $("in-revenue").value : 0) || 0);
        if(rev > 0){
          S.ME.sales = Math.round(rev / 12 * S.ME.share / 100);
          if($("in-marketplace")) $("in-marketplace").value = S.ME.sales;
        }
        S.recalc();
      });
      sh.addEventListener("change", () => renderMarginEaters());
    }
  }

export { ensureME, meSales, renderMarginEaters, meEvents };
