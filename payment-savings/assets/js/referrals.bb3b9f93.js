/* referrals.js — referral engine page module.
 *
 * Node-safe: no top-level document/window/localStorage. All DOM work runs
 * inside DOMContentLoaded.
 *
 * - ?ref=CODE → stored in localStorage as fra_pending_ref, click recorded
 *   via db.recordReferralClick (best-effort), priority banner shown.
 * - Logged in → referral link (db.referralLink) with copy button, stats
 *   (db.getReferralStats: clicks / sign-ups / audits signed), plus the
 *   accountant-lane link variant for bookkeepers (db.referralLink('accountant')).
 * - Logged out → nudge to create a free account to get a link.
 */
import { getUser } from './sb.c957517c.js';
import {
  getProfile, referralLink, recordReferralClick, getReferralStats, guestNudge,
} from './db.786d07d3.js';

function $(id) { return document.getElementById(id); }
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function copyText(text, btn) {
  const done = () => { btn.textContent = "Copied ✓"; setTimeout(() => { btn.textContent = "Copy link"; }, 2000); };
  const fail = () => { btn.textContent = "Select and copy manually"; };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, fail);
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand("copy"); done(); } catch (e) { fail(); }
  document.body.removeChild(ta);
}

function linkBox(label, sub) {
  return (
    `<div class="link-box">` +
      `<h3 style="margin-top:0">${esc(label)}</h3>` +
      `<p class="fine">${esc(sub)}</p>` +
      `<div class="link-row">` +
        `<input type="text" readonly value="" data-link-input>` +
        `<button class="btn outline" type="button" data-copy-btn>Copy link</button>` +
      `</div>` +
    `</div>`
  );
}

async function handleRefParam() {
  const params = new URLSearchParams(window.location.search);
  const code = (params.get("ref") || "").trim().toUpperCase().slice(0, 12);
  if (!code) return;
  try { localStorage.setItem("fra_pending_ref", code); } catch (e) { /* private mode */ }
  try { await recordReferralClick(code); } catch (e) { /* best-effort */ }
  const notice = $("ref-notice");
  if (notice) notice.hidden = false;
}

async function renderPanel() {
  const panel = $("ref-panel");
  if (!panel) return;
  let user = null;
  try { user = await getUser(); } catch (e) { user = null; }

  if (!user) {
    panel.innerHTML =
      `<div class="link-box">` +
        `<h3 style="margin-top:0">Get your link</h3>` +
        `<p>Create a free account and your personal referral link appears here in seconds — plus your stats as referrals roll in. Audits stay free either way.</p>` +
        `<p><a class="btn" href="account.html">Create my free account</a></p>` +
        `<p class="fine">${guestNudge}</p>` +
      `</div>`;
    return;
  }

  let stats = { clicks: 0, signups: 0, audits: 0 };
  let ownerLink = "", accountantLink = "", isAccountant = false;
  try {
    const p = await getProfile();
    isAccountant = !!(p && p.is_accountant);
    ownerLink = await referralLink("owner");
    accountantLink = await referralLink("accountant");
    stats = await getReferralStats();
  } catch (e) {
    panel.innerHTML = `<p class="fine">Couldn't load your referral info right now (${e && e.message}). Try refreshing.</p>`;
    return;
  }

  panel.innerHTML =
    linkBox("Your referral link", "One month of your shared-savings fee waived per signed audit.") +
    linkBox("Accountant lane", "A co-branded link variant for bookkeepers — hand it to the firms you work with.") +
    `<div class="stat-row">` +
      `<div class="stat"><div class="num">${stats.clicks}</div><div class="lbl">Link clicks</div></div>` +
      `<div class="stat"><div class="num">${stats.signups}</div><div class="lbl">Sign-ups</div></div>` +
      `<div class="stat"><div class="num">${stats.audits}</div><div class="lbl">Audits signed</div></div>` +
    `</div>` +
    `<p class="fine">Rewards trigger on <strong>signed audits</strong>, not signups — audit-signed status is confirmed by us manually. ` +
    `Waived months apply to your next shared-savings fee month.</p>`;

  const inputs = panel.querySelectorAll("[data-link-input]");
  const links = [ownerLink, accountantLink];
  inputs.forEach((inp, i) => { inp.value = links[i] || ""; });
  panel.querySelectorAll("[data-copy-btn]").forEach((btn, i) => {
    btn.addEventListener("click", () => copyText(links[i] || "", btn));
  });
}

function wire() {
  handleRefParam();
  renderPanel();
}

if (typeof document !== "undefined" && document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
else if (typeof document !== "undefined") wire();
