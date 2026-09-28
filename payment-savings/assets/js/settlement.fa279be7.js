/* settlement.js — flat-rate settlement trap calculator page module.
 *
 * Node-safe: no top-level document/window/localStorage. All DOM work runs
 * inside DOMContentLoaded.
 *
 * Logic: the revised Visa/Mastercard settlement proposes a 0.10-point
 * (0.001) interchange cut. Only interchange-plus merchants see it pass
 * through; flat-rate/bundled merchants see $0 unless they switch pricing
 * models. Runs stored via db.saveSettlementRun (localStorage fallback in
 * guest mode).
 */
import { saveSettlementRun, logActivity, isConfigured, guestNudge } from './db.fd18dc7a.js';

const CUT = 0.001; // proposed settlement interchange cut, in decimal terms

function $(id) { return document.getElementById(id); }
const fmtMoney = (n) => "$" + Math.round(n).toLocaleString("en-CA");

function resultFor(volume, model) {
  if (model === "plus") {
    const monthly = volume * CUT;
    return {
      monthly,
      html:
        `<span class="badge">Interchange-plus</span>` +
        `<h3>About <strong>${fmtMoney(monthly)}/month</strong> — automatic.</h3>` +
        `<p>On interchange-plus, wholesale interchange passes through at cost. When the cut lands, your statements drop by roughly ` +
        `<strong>0.10% of volume</strong> — about <strong>${fmtMoney(monthly * 12)}/year</strong> at your volume — with no action from you.</p>` +
        `<p class="fine">Assumes the settlement is finalized as proposed and the cut applies to your card mix. Illustrative — not a quote or a promise.</p>` +
        `<p><a class="btn outline" href="contact.html">Confirm your pricing model with a free audit</a></p>`,
    };
  }
  if (model === "flat") {
    return {
      monthly: 0,
      html:
        `<span class="badge">Flat-rate / bundled</span>` +
        `<h3>Worth to you: <strong>$0/month</strong> unless you switch pricing models.</h3>` +
        `<p>Your bundled rate doesn't move when interchange drops. The full <strong>0.10-point cut</strong> — about ` +
        `<strong>${fmtMoney(volume * CUT)}/month</strong> at your volume — stays with your processor, every month, for the life of the cut. ` +
        `That's the trap: the settlement lowers the wholesale cost, but nothing forces it through to you.</p>` +
        `<p>This is exactly what the audit negotiates: a pricing model where wholesale cuts reach your statements instead of your processor's margin. ` +
        `If we find nothing worth changing, you owe nothing.</p>` +
        `<p><a class="btn" href="contact.html">Start your free audit</a></p>`,
    };
  }
  return {
    monthly: null,
    html:
      `<span class="badge">Not sure</span>` +
      `<h3>Check your statement first — it takes one look.</h3>` +
      `<p><strong>Single flat percentage</strong> on nearly every transaction (e.g. 2.65% + 10¢) with no card-type breakdown → you're on <strong>flat-rate</strong>. ` +
      `<strong>Itemized interchange categories</strong> (standard, premium, commercial…) plus a separate markup line → you're on <strong>interchange-plus</strong>.</p>` +
      `<p>Can't tell from one statement? Send us 3–6 months and we'll read them for you — free, no obligation.</p>` +
      `<p><a class="btn" href="contact.html">Get the free audit</a></p>`,
  };
}

function wire() {
  const form = $("settlement-form"), out = $("settlement-result"), note = $("settlement-note");
  if (!form || !out) return;

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    out.hidden = false;
    const volume = parseFloat($("in-volume").value);
    const picked = form.querySelector('input[name="pricing-model"]:checked');
    const model = picked ? picked.value : "flat";

    if (!(volume > 0)) {
      out.innerHTML = '<p class="tool-err">Enter a monthly card volume above zero.</p>';
      return;
    }

    const r = resultFor(volume, model);
    out.innerHTML = `<div class="play">${r.html}</div>`;

    try {
      await saveSettlementRun({
        volume,
        pricing_model: model,
        result: { monthly_value: r.monthly, cut_bp: 10 },
      });
      logActivity("tool.settlement_run", `Settlement analysis (${model})`, { volume, pricing_model: model });
      if (note && !isConfigured()) note.innerHTML = `<p class="fine">${guestNudge}</p>`;
      else if (note) note.innerHTML = "";
    } catch (e) {
      if (note) note.innerHTML = `<p class="fine">Couldn't save this run (${e && e.message}). The result above is still yours.</p>`;
    }
  });
}

if (typeof document !== "undefined" && document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
else if (typeof document !== "undefined") wire();
