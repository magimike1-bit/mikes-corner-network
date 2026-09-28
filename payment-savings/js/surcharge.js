/* surcharge.js — Canadian surcharge decision tool page module.
 *
 * Node-safe: no top-level document/window/localStorage. All DOM work runs
 * inside DOMContentLoaded.
 *
 * Math: recoverable = volume × creditShare × 2.4% (the regulatory cap —
 * surcharge may never exceed it or the merchant's actual cost, whichever is
 * lower). Rules are rendered from data/surcharge-rules.json; anything with
 * status "verify-before-publishing" is flagged, never stated as fact.
 * Runs stored via db.saveSurchargeRun (localStorage fallback in guest mode).
 */
import { saveSurchargeRun, isConfigured, guestNudge } from "./db.js";

const CAP = 0.024; // Canadian surcharge cap

function $(id) { return document.getElementById(id); }
const fmtMoney = (n) => "$" + Math.round(n).toLocaleString("en-CA");
const fmtMoney2 = (n) => "$" + Number(n).toFixed(2);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

async function loadRules() {
  const list = $("rules-list");
  try {
    const res = await fetch("data/surcharge-rules.json");
    if (!res.ok) throw new Error("unavailable");
    const data = await res.json();
    const asof = $("rules-asof");
    if (asof && data.as_of) {
      asof.innerHTML += ` <strong>Rules current as of ${esc(data.as_of)}.</strong>`;
    }
    if (list) {
      list.innerHTML = (data.rules || []).map((r) => {
        const needsVerify = r.status === "verify-before-publishing";
        const src = r.url
          ? `<p class="rule-src">Source: <a href="${esc(r.url)}" rel="noopener">${esc(r.source || "link")}</a></p>`
          : (r.source ? `<p class="rule-src">Source: ${esc(r.source)}</p>` : "");
        const flag = needsVerify
          ? `<span class="verify-flag">⚠️ Verify before acting</span>` +
            (r.note ? `<p class="fine">${esc(r.note)}</p>` : "")
          : "";
        return `<li class="${needsVerify ? "verify" : ""}"><p>${esc(r.rule)}</p>${flag}${src}</li>`;
      }).join("");
      if (data.framing) {
        const fr = document.createElement("p");
        fr.className = "fine";
        fr.textContent = data.framing;
        list.after(fr);
      }
    }
  } catch (e) {
    if (list) list.innerHTML = `<li><p class="fine">The rules file couldn't be loaded right now. ` +
      `The short version: surcharging is credit-only, capped at 2.4% or your cost, and must be disclosed before the sale — ` +
      `but confirm every rule with your acquirer before surcharging.</p></li>`;
  }
}

function wire() {
  loadRules();

  const printBtn = $("btn-print-kit");
  if (printBtn) printBtn.addEventListener("click", () => window.print());

  const form = $("surcharge-form"), out = $("surcharge-result"), note = $("surcharge-note");
  if (!form || !out) return;

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    out.hidden = false;
    const volume = parseFloat($("in-volume").value);
    const ticket = parseFloat($("in-ticket").value);
    const sharePct = parseFloat($("in-share").value);

    if (!(volume > 0)) { out.innerHTML = '<p class="tool-err">Enter a monthly card volume above zero.</p>'; return; }
    if (!(ticket > 0)) { out.innerHTML = '<p class="tool-err">Enter an average ticket above zero.</p>'; return; }
    if (!(sharePct > 0) || sharePct > 100) { out.innerHTML = '<p class="tool-err">Enter a credit-card share between 0 and 100.</p>'; return; }

    const share = sharePct / 100;
    const recoverable = volume * share * CAP;
    const perTicket = ticket * CAP;
    const pctOfVolume = (recoverable / volume) * 100;

    out.innerHTML =
      `<div class="play">` +
        `<span class="badge">Your result</span>` +
        `<h3>Up to <strong>${fmtMoney(recoverable)}/month</strong> recoverable.</h3>` +
        `<p>That's the maximum: ${sharePct}% of your volume paid by credit × the 2.4% cap. On your average ticket, ` +
        `the surcharge would be about <strong>${fmtMoney2(perTicket)}</strong> — and your actual cap is lower if your ` +
        `cost of acceptance is below 2.4%.</p>` +
        `<p><strong>Now the other half:</strong> ${fmtMoney(recoverable)} is ${pctOfVolume.toFixed(1)}% of your volume, ` +
        `but <strong>every surcharged customer notices</strong>. Some will switch to debit, some will spend less, some ` +
        `won't come back. Weigh the recovered dollars against the friction — the math is the easy half of this decision.</p>` +
        `<p class="fine">Illustrative maximum at the regulatory cap — not a quote, a promise, or legal advice. ` +
        `Confirm your actual cost of acceptance with your acquirer before setting a surcharge.</p>` +
        `<p><a class="btn outline" href="contact.html">Ask us whether your rates leave anything to recover</a></p>` +
      `</div>`;

    try {
      await saveSurchargeRun({
        volume,
        avg_ticket: ticket,
        result: { recoverable: Math.round(recoverable * 100) / 100, credit_share_pct: sharePct },
      });
      if (note && !isConfigured()) note.innerHTML = `<p class="fine">${guestNudge}</p>`;
      else if (note) note.innerHTML = "";
    } catch (e) {
      if (note) note.innerHTML = `<p class="fine">Couldn't save this run (${e && e.message}). The result above is still yours.</p>`;
    }
  });
}

if (typeof document !== "undefined" && document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
else if (typeof document !== "undefined") wire();
