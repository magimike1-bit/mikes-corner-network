/* account.js — My account page: auth card + dashboard.
 *
 * Loaded as a module from account.html (unhashed — the build hashes it later).
 * Node-safe: no top-level document/window/localStorage access; all DOM work
 * happens inside boot(), which runs on DOMContentLoaded. In node the module
 * imports cleanly and does nothing.
 *
 * Guest mode (logged out or Supabase not configured): every db.* function
 * degrades to localStorage, the dashboard still renders from that data, and a
 * banner shows the signup nudge — never an error.
 */
import {
  getUser, signUp, signIn, signInMagic, resetPassword, signOut, onAuthChange,
} from './sb.c957517c.js';
import {
  listSimStates, deleteSimState, listRateRuns, listFeeEntries, detectCreep,
  listAlertSubs, referralLink, claimPendingReferral, getReferralStats, guestNudge,
} from './db.e456647d.js';
import { lineChart, fmtBp } from './chart.42f77134.js';

/* ---------- tiny DOM helpers (browser only, called after boot) ---------- */
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
function fmtDate(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d)) return "";
    return d.toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
  } catch (e) { return ""; }
}
function fmtMonth(m) {
  const m2 = /^(\d{4})-(\d{2})$/.exec(String(m || ""));
  if (!m2) return esc(m);
  const names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return names[+m2[2] - 1] + " " + m2[1];
}
function fmtMoney(n) {
  const v = +n;
  if (!isFinite(v)) return "—";
  return v.toLocaleString("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });
}
function cap(s) {
  const t = String(s == null ? "" : s);
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "—";
}
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; }
  catch (e) {
    const ta = document.createElement("textarea");
    ta.value = t; ta.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (e2) {}
    ta.remove(); return ok;
  }
}

/* ---------- auth card (logged out) ---------- */
function renderAuthCard(app) {
  const card = el(`
    <section id="auth-card" class="acct-block">
      <div class="acct-card">
        <div class="acct-tabs" role="tablist">
          <button type="button" class="acct-tab active" data-tab="signin">Sign in</button>
          <button type="button" class="acct-tab" data-tab="signup">Create account</button>
          <button type="button" class="acct-tab" data-tab="magic">Magic link</button>
        </div>
        <div class="acct-panel" data-panel="signin">
          <form id="f-signin" novalidate>
            <label>Email<input type="email" name="email" required autocomplete="email"></label>
            <label>Password<input type="password" name="password" required autocomplete="current-password"></label>
            <p class="acct-msg" id="m-signin" hidden></p>
            <button class="btn" type="submit">Sign in</button>
            <p class="acct-forgot"><a href="#auth-card" id="forgot-link">Forgot password?</a></p>
          </form>
          <div class="acct-reset" id="reset-box">
            <form id="f-reset" novalidate>
              <label>Email<input type="email" name="email" required autocomplete="email"></label>
              <p class="acct-msg" id="m-reset" hidden></p>
              <button class="btn outline" type="submit">Send reset email</button>
            </form>
          </div>
        </div>
        <div class="acct-panel" data-panel="signup" hidden>
          <form id="f-signup" novalidate>
            <label>Email<input type="email" name="email" required autocomplete="email"></label>
            <label>Password <span class="meta">(min 8 characters)</span><input type="password" name="password" required minlength="8" autocomplete="new-password"></label>
            <p class="acct-msg" id="m-signup" hidden></p>
            <button class="btn" type="submit">Create free account</button>
          </form>
        </div>
        <div class="acct-panel" data-panel="magic" hidden>
          <form id="f-magic" novalidate>
            <label>Email<input type="email" name="email" required autocomplete="email"></label>
            <p class="acct-msg" id="m-magic" hidden></p>
            <button class="btn outline" type="submit">Email me a sign-in link</button>
          </form>
          <p class="acct-note" style="border:none;padding-top:0">No password to remember — the link signs you straight in.</p>
        </div>
        <p class="acct-note">Your saved setups and tracker history follow you to any device once you sign in.</p>
      </div>
    </section>`);
  app.appendChild(card);

  // tabs
  card.querySelectorAll(".acct-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      card.querySelectorAll(".acct-tab").forEach((t) => t.classList.toggle("active", t === tab));
      card.querySelectorAll(".acct-panel").forEach((p) => { p.hidden = p.dataset.panel !== tab.dataset.tab; });
    });
  });

  const showMsg = (id, text, ok) => {
    const m = card.querySelector("#" + id);
    m.hidden = false; m.textContent = text; m.classList.toggle("ok", !!ok);
  };

  card.querySelector("#f-signin").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const res = await signIn(f.get("email"), f.get("password"));
    showMsg("m-signin", res.ok ? "Signed in — loading your dashboard…" : res.error, res.ok);
  });
  card.querySelector("#f-signup").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const email = String(f.get("email") || "").trim();
    const pw = String(f.get("password") || "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showMsg("m-signup", "Enter a valid email address."); return; }
    if (pw.length < 8) { showMsg("m-signup", "Your password needs at least 8 characters."); return; }
    const res = await signUp(email, pw);
    if (res.ok) {
      showMsg("m-signup", res.needsConfirm
        ? "Account created — check your inbox to confirm, then sign in."
        : "Account created and you're signed in — loading your dashboard…", true);
    } else showMsg("m-signup", res.error);
  });
  card.querySelector("#f-magic").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const res = await signInMagic(f.get("email"));
    showMsg("m-magic", res.ok ? "Check your inbox — we sent a sign-in link." : res.error, res.ok);
  });
  card.querySelector("#forgot-link").addEventListener("click", (e) => {
    e.preventDefault();
    card.querySelector("#reset-box").classList.add("open");
  });
  card.querySelector("#f-reset").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const res = await resetPassword(f.get("email"));
    showMsg("m-reset", res.ok ? "Check your inbox for the reset link." : res.error, res.ok);
  });
}

/* ---------- dashboard sections (shared by logged-in + guest) ---------- */
function guestBanner() {
  return el(`<div class="acct-guest-banner"><strong>${esc(guestNudge)}</strong>
    <br><a class="btn outline" style="margin-top:10px" href="#auth-card">Sign in</a></div>`);
}

/* Sections take pre-fetched data (renderDashboard fetches everything in
   parallel). A null dataset means the fetch failed → friendly error state. */
function setupsSection(states) {
  const sec = el(`<section class="acct-block">
    <h2 class="section-title">Saved simulator setups</h2>
    <p class="section-sub">Reopen a saved configuration in the cost simulator, or remove one you no longer need.</p>
    <div class="acct-body"></div></section>`);
  const body = sec.querySelector(".acct-body");
  if (states === null) {
    body.innerHTML = `<p class="acct-msg">Couldn't load your saved setups — try refreshing the page.</p>`;
    return sec;
  }
  if (!states.length) {
    body.innerHTML = `<p>No saved setups yet. Open the <a href="simulator.html">cost simulator</a>, build your stack, and hit “Save this setup”.</p>`;
    return sec;
  }
  const rows = el(`<div class="acct-rows"></div>`);
  for (const s of states) {
    const row = el(`<div class="acct-row">
      <div><h3>${esc(s.name || "Untitled setup")}</h3>
      <div class="meta">${esc(cap(s.sector))} · updated ${esc(fmtDate(s.updated_at))}</div></div>
      <div class="btn-row" style="margin-top:0">
        <button type="button" class="btn" data-load="${esc(s.id)}">Load</button>
        <button type="button" class="btn outline" data-del="${esc(s.id)}" data-name="${esc(s.name || "Untitled setup")}">Delete</button>
      </div></div>`);
    rows.appendChild(row);
  }
  body.appendChild(rows);
  rows.addEventListener("click", async (e) => {
    const loadBtn = e.target.closest("[data-load]");
    const delBtn = e.target.closest("[data-del]");
    if (loadBtn) {
      try { sessionStorage.setItem("fra_load_setup", loadBtn.dataset.load); } catch (err) {}
      window.location.href = "simulator.html";
    } else if (delBtn) {
      if (!window.confirm(`Delete “${delBtn.dataset.name}”? This can't be undone.`)) return;
      try {
        await deleteSimState(delBtn.dataset.del);
        const fresh = setupsSection(await listSimStates().catch(() => null));
        sec.replaceWith(fresh);
      } catch (err) {
        window.alert("Couldn't delete that setup — try again.");
      }
    }
  });
  return sec;
}

function rateSection(runs) {
  const sec = el(`<section class="acct-block">
    <h2 class="section-title">Effective-rate history</h2>
    <p class="section-sub">What you actually paid per dollar processed — from the effective-rate calculator.</p>
    <div class="acct-body"></div></section>`);
  const body = sec.querySelector(".acct-body");
  if (runs === null) { body.innerHTML = `<p class="acct-msg">Couldn't load your rate history — try refreshing the page.</p>`; return sec; }
  if (!runs.length) {
    body.innerHTML = `<p>No runs yet. <a href="rate-calculator.html">Run the effective-rate calculator</a> and your history will land here.</p>`;
    return sec;
  }
  const latest = runs[0];
  const last12 = runs.slice(0, 12).slice().reverse();
  const pts = last12.map((r) => ({ x: fmtDate(r.at).replace(/,?\s?\d{4}$/, ""), y: +r.rate_bp }));
  const meta = [latest.sector ? cap(latest.sector) : null, fmtDate(latest.at)].filter(Boolean).join(" · ");
  const inner = el(`<div>
      <div class="acct-big">${esc(fmtBp(+latest.rate_bp))}</div>
      <div class="meta">${esc(meta)}</div>
      <div class="acct-chart" id="acct-chart"></div>
      <p style="margin-top:1em"><a class="btn outline" href="rate-calculator.html">Run another calculation</a></p>
    </div>`);
  body.appendChild(inner);
  if (pts.length >= 2) lineChart(inner.querySelector("#acct-chart"), pts, { label: "Effective rate history, last 12 runs" });
  else inner.querySelector("#acct-chart").innerHTML = `<p class="section-sub" style="margin:0">Your chart appears once you have two or more runs.</p>`;
  return sec;
}

function feeSection(entries) {
  const sec = el(`<section class="acct-block">
    <h2 class="section-title">Fee-creep tracker</h2>
    <p class="section-sub">Month by month, from the fee-creep tracker. We flag it when your latest rate drifts meaningfully above your median.</p>
    <div class="acct-body"></div></section>`);
  const body = sec.querySelector(".acct-body");
  if (entries === null) { body.innerHTML = `<p class="acct-msg">Couldn't load your fee entries — try refreshing the page.</p>`; return sec; }
  if (!entries.length) {
    body.innerHTML = `<p>No months logged yet. <a href="fee-tracker.html">Log a month in the fee-creep tracker</a> and we'll watch for drift.</p>`;
    return sec;
  }
  let creep = { creepBp: 0, baselineBp: null };
  try { creep = detectCreep(entries, 15); } catch (e) { /* keep default */ }
  if (creep.creepBp > 0) {
    const banner = el(`<div class="acct-creep" role="alert"><strong>⚠️ Fee creep detected:</strong>
      your latest rate is up ${esc(String(creep.creepBp))} basis points vs your median
      (${esc(creep.baselineBp != null ? fmtBp(creep.baselineBp) : "—")}) — worth an audit look.
      <a href="fee-tracker.html">Review the months</a></div>`);
    body.appendChild(banner);
  }
  const tbl = el(`<table class="acct-table"><thead><tr>
      <th>Month</th><th>Fees</th><th>Volume</th><th>Effective rate</th></tr></thead><tbody></tbody></table>`);
  const tb = tbl.querySelector("tbody");
  for (const e of entries) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${fmtMonth(e.month)}</td><td>${esc(fmtMoney(e.fees))}</td>
      <td>${esc(fmtMoney(e.volume))}</td><td>${esc(fmtBp(+e.rate_bp))}</td>`;
    tb.appendChild(tr);
  }
  body.appendChild(tbl);
  body.appendChild(el(`<p style="margin-top:1em"><a class="btn outline" href="fee-tracker.html">Log another month</a></p>`));
  return sec;
}

function alertsSection(creepActive, subs) {
  const sec = el(`<section class="acct-block">
    <h2 class="section-title">Alert center</h2>
    <p class="section-sub">What we've flagged for you, and which rate-change topics you're subscribed to.</p>
    <div class="acct-body"></div></section>`);
  const body = sec.querySelector(".acct-body");
  if (creepActive) {
    body.appendChild(el(`<div class="acct-alert"><strong>Fee creep</strong> — your latest month came in above your median rate.
      <a href="fee-tracker.html">Review the months</a> or <a href="contact.html">ask for a free audit</a>.</div>`));
  }
  subs = Array.isArray(subs) ? subs : [];
  if (subs.length) {
    const list = el(`<div></div>`);
    list.appendChild(el(`<h3>Your alert subscriptions</h3>`));
    for (const s of subs) {
      const topics = Array.isArray(s.topics) ? s.topics.join(", ") : String(s.topics || "");
      list.appendChild(el(`<div class="acct-alert"><strong>${esc(topics || "Rate alerts")}</strong>
        <div class="meta">${esc(s.email || "")}${s.pending ? " · email not connected yet — shows here for now" : ""}</div></div>`));
    }
    body.appendChild(list);
  }
  if (!creepActive && !subs.length) {
    body.appendChild(el(`<p>No alerts right now. New months you log in the <a href="fee-tracker.html">fee tracker</a> are checked automatically,
      and you can subscribe to rate-change topics on the <a href="alerts.html">alerts</a> page.</p>`));
  }
  body.appendChild(el(`<p class="acct-note">Email alerts aren't connected yet — once the mailer is wired, your subscribed topics arrive by email too. Nothing is sent today; everything shows here.</p>`));
  return sec;
}

function referralsSection(guest, stats, link) {
  const sec = el(`<section class="acct-block">
    <h2 class="section-title">Referrals</h2>
    <p class="section-sub">Share your link with a business owner who'd benefit from an audit.</p>
    <div class="acct-body"></div></section>`);
  const body = sec.querySelector(".acct-body");
  if (guest) {
    body.innerHTML = `<p>Your personal referral link appears here once you <a href="#auth-card">sign in</a>. <a href="referrals.html">Read the referral terms</a>.</p>`;
    return sec;
  }
  stats = stats || { clicks: 0, signups: 0, audits: 0 };
  link = link || "";
  body.appendChild(el(`<div class="acct-stat-grid">
      <div class="acct-stat"><div class="n">${esc(stats.clicks)}</div><div class="l">link clicks</div></div>
      <div class="acct-stat"><div class="n">${esc(stats.signups)}</div><div class="l">sign-ups</div></div>
      <div class="acct-stat"><div class="n">${esc(stats.audits)}</div><div class="l">audits signed</div></div>
    </div>`));
  if (link) {
    const row = el(`<div class="acct-reflink">
        <input id="acct-reflink" readonly value="${esc(link)}" aria-label="Your referral link">
        <button type="button" class="btn" id="acct-copy">Copy link</button>
      </div>`);
    body.appendChild(row);
    row.querySelector("#acct-copy").addEventListener("click", async (e) => {
      const ok = await copyText(link);
      e.target.textContent = ok ? "Copied ✓" : "Copy failed — select it manually";
      setTimeout(() => { e.target.textContent = "Copy link"; }, 2500);
    });
  }
  body.appendChild(el(`<p style="margin-top:1em"><a href="referrals.html">Referral terms and how rewards work</a></p>`));
  return sec;
}

async function renderDashboard(app, user) {
  const guest = !user;
  const dash = el(`<div id="acct-dash"></div>`);
  app.appendChild(dash);
  if (guest) dash.appendChild(guestBanner());
  else {
    const email = user && user.email ? esc(user.email) : "your account";
    dash.appendChild(el(`<p class="acct-email">Signed in as ${email}</p>`));
  }

  // Fetch all independent datasets in parallel. Fee entries are fetched once
  // and shared: creep detection and the fee table use the same data.
  const [states, runs, entries, subs, refStats, refLink] = await Promise.all([
    listSimStates().catch(() => null),
    listRateRuns(50).catch(() => null),
    listFeeEntries().catch(() => null),
    listAlertSubs().catch(() => null),
    guest ? { clicks: 0, signups: 0, audits: 0 } : getReferralStats().catch(() => null),
    guest ? "" : referralLink().catch(() => ""),
  ]);
  let creepActive = false;
  try {
    const r = detectCreep(entries || [], 15);
    creepActive = !!(r && r.creepBp > 0);
  } catch (e) { /* alerts section handles its own data */ }

  dash.appendChild(setupsSection(states));
  dash.appendChild(rateSection(runs));
  dash.appendChild(feeSection(entries));
  dash.appendChild(alertsSection(creepActive, subs));
  dash.appendChild(referralsSection(guest, refStats, refLink));

  const signout = el(`<section class="acct-block"><button type="button" class="btn outline" id="acct-signout">Sign out</button></section>`);
  dash.appendChild(signout);
  signout.querySelector("#acct-signout").addEventListener("click", async () => {
    try { await signOut(); } catch (e) { /* fall through; auth change re-renders */ }
    boot();
  });
}

/* ---------- boot ---------- */
let claimedRef = false;
function claimOnce() {
  if (claimedRef) return;
  claimedRef = true;
  try { claimPendingReferral(); } catch (e) { /* best-effort */ }
}

let authWatching = false;

async function boot() {
  const app = document.getElementById("account-app");
  if (!app) return;
  // Re-render only on real session changes. TOKEN_REFRESHED fires roughly
  // hourly and must not re-run the whole dashboard fetch waterfall.
  if (!authWatching) {
    authWatching = true;
    try {
      onAuthChange((event, session) => {
        if (session) claimOnce();
        if (event === "SIGNED_IN" || event === "SIGNED_OUT" ||
            event === "INITIAL_SESSION" || event === "LOCAL_MODE") boot();
      });
    }
    catch (e) { /* local mode */ }
  }
  app.innerHTML = "";
  let user = null;
  try { user = await getUser(); } catch (e) { user = null; }
  if (user) {
    claimOnce();
    await renderDashboard(app, user);
  } else {
    renderAuthCard(app);
    await renderDashboard(app, null);
  }
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
}
