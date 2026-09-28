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
  listSimStates, importSimStates, deleteSimState, renameSimState, setupStatus,
  listGuestSimStates, clearGuestSimStates,
  listRateRuns, listFeeEntries, detectCreep,
  listAlertSubs, referralLink, claimPendingReferral, getReferralStats, guestNudge,
  getProfile, updateDisplayName, logActivity, listActivity, getActivityCounts,
  listAuditRequests, listAudits, adoptAuditRequests,
} from './db.fd18dc7a.js';
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
/* "3 hours ago" / "2 days ago" — for the resume card and activity lists. */
function relTime(iso) {
  try {
    const t = new Date(iso).getTime();
    if (!isFinite(t)) return "";
    const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
    if (s < 60) return "just now";
    const m = Math.floor(s / 60);
    if (m < 60) return m + (m === 1 ? " minute ago" : " minutes ago");
    const h = Math.floor(m / 60);
    if (h < 24) return h + (h === 1 ? " hour ago" : " hours ago");
    const d = Math.floor(h / 24);
    if (d < 30) return d + (d === 1 ? " day ago" : " days ago");
    const mo = Math.floor(d / 30);
    if (mo < 12) return mo + (mo === 1 ? " month ago" : " months ago");
    const y = Math.floor(mo / 12);
    return y + (y === 1 ? " year ago" : " years ago");
  } catch (e) { return ""; }
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

/* --- one-time guest → account import offer (signed-in only) --- */
function guestImportBanner() {
  const sec = el(`<div class="acct-import" role="region" aria-live="polite"></div>`);
  return sec;
}
/* Fill the import banner; returns true if something was shown. */
function renderImportBanner(sec, user) {
  const seenKey = "fra_import_done_" + (user.id || "anon");
  let seen = false, hadGuestData = false;
  try {
    seen = localStorage.getItem(seenKey) === "1";
    hadGuestData = localStorage.getItem("fra_had_guest_data") === "1";
  } catch (e) {}
  if (seen) return false;
  const guestSetups = listGuestSimStates();
  if (guestSetups.length) {
    const n = guestSetups.length;
    sec.innerHTML = `<strong>You have ${n} saved simulator setup${n === 1 ? "" : "s"} from a guest session.</strong>
      <p>Bring ${n === 1 ? "it" : "them"} into this account? This is a one-time offer — after you import, the guest copies are cleared.</p>
      <div class="btn-row"><button type="button" class="btn primary" data-import-guest>Import ${n === 1 ? "it" : "them"}</button>
      <button type="button" class="btn" data-dismiss-import>Not now</button></div>
      <p class="acct-msg" data-import-msg role="status" aria-live="polite"></p>`;
    return true;
  }
  if (hadGuestData) {
    /* Flag says guest setups once existed, but this browser has none left. */
    sec.innerHTML = `<strong>Your browser data looks cleared.</strong>
      <p>You saved simulator setups in a guest session before, but this browser no longer has them — they were probably cleared with your browsing data. Nothing to import. If you remember the setup, build it again and save it while signed in so it sticks.</p>
      <div class="btn-row"><button type="button" class="btn" data-dismiss-import>Got it</button></div>`;
    return true;
  }
  return false;
}
/* Move every guest simulator setup into the account. Guest storage is
   cleared only after ALL writes succeed — a partial failure keeps the
   guest copies so nothing is lost. */
async function doImportGuest(user, msgEl) {
  const say = (t) => { if (msgEl) msgEl.textContent = t; };
  const guestSetups = listGuestSimStates();
  if (!guestSetups.length) { say("Nothing to import."); return 0; }
  say(`Importing ${guestSetups.length} setup${guestSetups.length === 1 ? "" : "s"}…`);
  // Fold each guest record's top-level sector into its payload, then write
  // all rows in one bulk insert (importSimState) instead of N round-trips.
  const rows = guestSetups.map((g) => {
    const payload = { ...(g._payload || g.payload || {}) };
    if (!payload.sector && g.sector) payload.sector = g.sector;
    return { name: g.name || "Imported setup", payload };
  });
  const saved = await importSimStates(rows);
  const n = saved ? saved.length : 0;
  clearGuestSimStates();
  try { localStorage.setItem("fra_import_done_" + (user.id || "anon"), "1"); } catch (e) {}
  try { await logActivity("guest.imported", "Guest setups imported", n + " setup" + (n === 1 ? "" : "s")); } catch (e) {}
  return n;
}

/* --- resume card --- */
function resumeSection(states, resume, guest) {
  const sec = el(`<section class="acct-block">
    <h2 class="section-title">Pick up where you left off</h2>
    <div class="acct-body"></div></section>`);
  const body = sec.querySelector(".acct-body");
  if (resume === null) {
    body.innerHTML = `<p class="acct-msg">Couldn't load your last position — try refreshing the page.</p>`;
    return sec;
  }
  let r = resume;
  if (!r && guest) {
    try {
      const g = JSON.parse(localStorage.getItem("fra_last_page") || "null");
      if (g && g.page) r = { page: g.page, title: g.title, at: g.at };
    } catch (e) { r = null; }
  }
  if (!r || !r.page) {
    body.innerHTML = `<p>No recent activity yet. Open the <a href="simulator.html">payment simulator</a> and your last position will show up here.</p>`;
    return sec;
  }
  const page = String(r.page).replace(/[^a-z0-9_.-]/gi, "");
  const title = r.title || cap(String(r.page).replace(/-/g, " "));
  let setup = null;
  if (r.setupId && states) setup = states.find((s) => String(s.id) === String(r.setupId));
  let html = `<p>You were last on <a href="${esc(page)}.html">${esc(title)}</a>`;
  if (r.setupName) html += ` — setup “${esc(r.setupName)}”`;
  else if (setup) html += ` — setup “${esc(setup.name || "Untitled") }”`;
  if (r.setupId && !setup && r.setupName) {
    html += ` <span class="acct-warn">(that setup no longer exists — the tool will open fresh)</span>`;
  }
  if (r.at) html += ` <span class="meta">${esc(relTime(r.at))}</span>`;
  html += `</p>`;
  body.innerHTML = html;
  return sec;
}

/* --- profile --- */
function profileSection(profile, user, counts) {
  const sec = el(`<section class="acct-block">
    <h2 class="section-title">Profile</h2>
    <div class="acct-body"></div></section>`);
  const body = sec.querySelector(".acct-body");
  if (profile === null) {
    body.innerHTML = `<p class="acct-msg">Couldn't load your profile — try refreshing the page.</p>`;
    return sec;
  }
  const email = (user && user.email) || "";
  const name = (profile && profile.display_name) || "";
  const since = profile && profile.created_at
    ? new Date(profile.created_at).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })
    : "—";
  const visits = counts && typeof counts.visits === "number" ? counts.visits : 0;
  const saves = counts && typeof counts.saves === "number" ? counts.saves : 0;
  const form = el(`<form id="acct-profile-form" class="acct-form" novalidate>
      <label>Display name
        <input type="text" id="acct-display-name" name="display_name" value="${esc(name)}"
          maxlength="80" autocomplete="name" placeholder="What should we call you?"></label>
      <label>Email (can't be changed)
        <input type="email" value="${esc(email)}" readonly disabled></label>
      <p class="meta">Member since ${esc(since)} · ${visits} visit${visits === 1 ? "" : "s"} · ${saves} simulator save${saves === 1 ? "" : "s"}</p>
      <p class="acct-msg" id="acct-profile-msg" role="status" aria-live="polite"></p>
      <button type="submit" class="btn primary">Save profile</button></form>`);
  body.appendChild(form);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = form.querySelector("#acct-profile-msg");
    const btn = form.querySelector('button[type="submit"]');
    const val = form.querySelector("#acct-display-name").value;
    msg.textContent = "";
    btn.disabled = true;
    try {
      await updateDisplayName(val);
      try { await logActivity("profile.updated", "Profile updated"); } catch (err) {}
      msg.textContent = "Saved.";
    } catch (err) {
      msg.textContent = err && err.message ? err.message : "Couldn't save — try again.";
    } finally { btn.disabled = false; }
  });
  return sec;
}

/* --- my simulators (was setupsSection) --- */
const STATUS_LABEL = { complete: "Complete", "in-progress": "In progress", unknown: "Unknown" };
function mySimulatorsSection(states) {
  const sec = el(`<section class="acct-block">
    <h2 class="section-title">My simulators</h2>
    <p class="section-sub">Reopen a saved configuration in the cost simulator, edit where you left off, rename, or remove it.</p>
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
    const status = setupStatus(s);
    const step = s.saved_from_step != null ? +s.saved_from_step
      : (s._payload && s._payload.savedFromStep != null ? +s._payload.savedFromStep : null);
    const row = el(`<div class="acct-row" data-id="${esc(s.id)}">
      <div><h3 class="acct-row-name">${esc(s.name || "Untitled setup")}
        <span class="acct-chip acct-chip-${esc(status)}">${esc(STATUS_LABEL[status] || "Unknown")}</span></h3>
      <div class="meta">${esc(cap(s.sector))} · updated ${esc(fmtDate(s.updated_at))}</div></div>
      <div class="btn-row" style="margin-top:0">
        <button type="button" class="btn" data-load="${esc(s.id)}" data-name="${esc(s.name || "Untitled setup")}">Open</button>
        <button type="button" class="btn outline" data-edit="${esc(s.id)}" data-name="${esc(s.name || "Untitled setup")}" data-step="${step == null ? "" : step}" ${step == null ? "disabled title='Saved before step tracking — opens at results'" : ""}>Edit at saved step</button>
        <button type="button" class="btn outline" data-rename="${esc(s.id)}">Rename</button>
        <button type="button" class="btn outline" data-del="${esc(s.id)}" data-name="${esc(s.name || "Untitled setup")}">Delete</button>
      </div></div>`);
    rows.appendChild(row);
  }
  body.appendChild(rows);
  rows.addEventListener("click", async (e) => {
    const loadBtn = e.target.closest("[data-load]");
    const editBtn = e.target.closest("[data-edit]");
    const renameBtn = e.target.closest("[data-rename]");
    const delBtn = e.target.closest("[data-del]");
    const stash = (id, name, step) => {
      try {
        sessionStorage.setItem("fra_load_setup", id);
        sessionStorage.setItem("fra_load_setup_name", name || "");
        if (step != null && step !== "") sessionStorage.setItem("fra_load_setup_step", String(step));
        else sessionStorage.removeItem("fra_load_setup_step");
      } catch (err) {}
    };
    if (loadBtn) {
      stash(loadBtn.dataset.load, loadBtn.dataset.name, 6);
      try { await logActivity("simulator.setup_loaded", "Simulator setup opened", loadBtn.dataset.name); } catch (err) {}
      window.location.href = "simulator.html";
    } else if (editBtn) {
      const step = editBtn.dataset.step !== "" ? +editBtn.dataset.step : 6;
      stash(editBtn.dataset.edit, editBtn.dataset.name, step);
      try { await logActivity("simulator.setup_loaded", "Simulator setup opened for editing", editBtn.dataset.name); } catch (err) {}
      window.location.href = "simulator.html";
    } else if (renameBtn) {
      startRename(rows, renameBtn.dataset.rename);
    } else if (delBtn) {
      if (!window.confirm(`Delete “${delBtn.dataset.name}”? This can't be undone.`)) return;
      try {
        await deleteSimState(delBtn.dataset.del);
        try {
          if (sessionStorage.getItem("fra_load_setup") === String(delBtn.dataset.del)) {
            sessionStorage.removeItem("fra_load_setup");
            sessionStorage.removeItem("fra_load_setup_name");
            sessionStorage.removeItem("fra_load_setup_step");
          }
        } catch (err) {}
        try { await logActivity("simulator.setup_deleted", "Simulator setup deleted", delBtn.dataset.name); } catch (err) {}
        const fresh = mySimulatorsSection(await listSimStates().catch(() => null));
        sec.replaceWith(fresh);
      } catch (err) {
        window.alert("Couldn't delete that setup — try again.");
      }
    }
  });
  return sec;
}
/* Turn a row's name into an inline editor. Enter/blur saves, Escape cancels. */
function startRename(rowsEl, id) {
  const row = rowsEl.querySelector(`[data-id="${CSS.escape(String(id))}"]`);
  if (!row || row.querySelector(".acct-rename-input")) return;
  const nameEl = row.querySelector(".acct-row-name");
  const chip = nameEl.querySelector(".acct-chip");
  const current = nameEl.firstChild ? nameEl.firstChild.textContent : "";
  const originalHTML = nameEl.innerHTML; // restore on cancel/failure — no re-render
  const input = document.createElement("input");
  input.type = "text";
  input.maxLength = 80;
  input.value = current.trim();
  input.className = "acct-rename-input";
  input.setAttribute("aria-label", "Setup name");
  nameEl.textContent = "";
  nameEl.appendChild(input);
  if (chip) nameEl.appendChild(chip);
  input.focus();
  input.select();
  let done = false;
  const finish = async (save) => {
    if (done) return;
    done = true;
    const val = String(input.value || "").trim().slice(0, 80);
    if (!save || !val) { nameEl.innerHTML = originalHTML; return; }
    try {
      const updated = await renameSimState(id, val);
      const newName = (updated && updated.name) || val;
      // Update the row in place: name text + the buttons' data-name attrs.
      nameEl.textContent = "";
      nameEl.appendChild(document.createTextNode(newName));
      if (chip) nameEl.appendChild(chip);
      row.querySelectorAll("[data-name]").forEach((b) => { b.dataset.name = newName; });
      try { await logActivity("simulator.setup_updated", "Simulator setup renamed", newName); } catch (err) {}
    } catch (err) {
      nameEl.innerHTML = originalHTML;
      window.alert(err && err.message ? err.message : "Couldn't rename — try again.");
    }
  };
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") finish(true);
    else if (ev.key === "Escape") finish(false);
  });
  input.addEventListener("blur", () => finish(true));
}

/* --- simulator logs --- */
function simulatorLogsSection(logs) {
  const sec = el(`<section class="acct-block">
    <h2 class="section-title">Simulator logs</h2>
    <p class="section-sub">Your saves, opens, edits, and deletes — newest first.</p>
    <div class="acct-body"></div></section>`);
  const body = sec.querySelector(".acct-body");
  if (logs === null) {
    body.innerHTML = `<p class="acct-msg">Couldn't load your simulator logs — try refreshing the page.</p>`;
    return sec;
  }
  if (!logs.length) {
    body.innerHTML = `<p>Nothing logged yet. Saving or opening a <a href="simulator.html">simulator</a> setup records it here.</p>`;
    return sec;
  }
  const LOG_LABEL = {
    "simulator.setup_saved": "Saved setup",
    "simulator.setup_loaded": "Opened setup",
    "simulator.setup_updated": "Updated setup",
    "simulator.setup_deleted": "Deleted setup",
  };
  const ul = el(`<ul class="acct-log"></ul>`);
  for (const a of logs.slice(0, 50)) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="acct-log-kind">${esc(LOG_LABEL[a.kind] || a.kind)}</span>
      ${a.label ? `<span class="acct-log-label">${esc(a.label)}</span>` : ""}
      ${a.detail ? `<span class="meta"> — ${esc(a.detail)}</span>` : ""}
      <span class="meta">${esc(relTime(a.at))}</span>`;
    ul.appendChild(li);
  }
  body.appendChild(ul);
  return sec;
}

/* --- free audit results --- */
const AUDIT_REQ_LABEL = {
  new: "Received", contacted: "We've been in touch",
  "statements-received": "Statements received", analyzing: "Under analysis",
  "proposal-sent": "Proposal sent", signed: "Signed", closed: "Closed",
};
const AUDIT_LABEL = {
  lead: "Lead", statements: "Statements received", analysis: "Under analysis",
  proposal: "Proposal sent", signed: "Signed", monitoring: "Monitoring",
  paused: "Paused", lost: "Closed",
};
function auditResultsSection(requests, audits) {
  const sec = el(`<section class="acct-block">
    <h2 class="section-title">Free audit results</h2>
    <p class="section-sub">Track your free audit request — we reply within 2–5 business days.</p>
    <div class="acct-body"></div></section>`);
  const body = sec.querySelector(".acct-body");
  if (requests === null || audits === null) {
    body.innerHTML = `<p class="acct-msg">Couldn't load your audit status — try refreshing the page.</p>`;
    return sec;
  }
  if (!requests.length && !audits.length) {
    body.innerHTML = `<p>No audit requests yet. <a href="audit.html">Request your free audit</a> — it takes a minute, and we reply within 2–5 business days.</p>`;
    return sec;
  }
  const rows = el(`<div class="acct-rows"></div>`);
  for (const r of requests) {
    rows.appendChild(el(`<div class="acct-row"><div>
      <h3>Audit request — ${esc(r.business_name || "your business")}</h3>
      <div class="meta">Requested ${esc(fmtDate(r.created_at))}</div></div>
      <div><span class="acct-chip acct-chip-${esc(r.status === "new" ? "progress" : "complete")}">${esc(AUDIT_REQ_LABEL[r.status] || cap(r.status))}</span></div></div>`));
  }
  for (const a of audits) {
    const aBits = [];
    const num = (v) => (v == null || v === "" ? NaN : +v);
    const vol = num(a.monthly_volume), base = num(a.baseline_rate_bp),
      cur = num(a.current_rate_bp), share = num(a.savings_share_bp);
    if (isFinite(vol) && vol > 0) aBits.push(`Volume ${fmtMoney(vol)}/mo`);
    if (isFinite(base) && isFinite(cur)) aBits.push(`${fmtBp(base)} → ${fmtBp(cur)}`);
    if (isFinite(share) && share > 0) aBits.push(`${fmtBp(share)} / ${fmtBp(10000 - share)} split`);
    rows.appendChild(el(`<div class="acct-row"><div>
      <h3>Audit — ${esc(a.merchant_name || "your business")}</h3>
      <div class="meta">Updated ${esc(fmtDate(a.updated_at))}${aBits.length ? " · " + esc(aBits.join(" · ")) : ""}</div></div>
      <div><span class="acct-chip acct-chip-${esc(a.status === "signed" || a.status === "monitoring" ? "complete" : "progress")}">${esc(AUDIT_LABEL[a.status] || cap(a.status))}</span></div></div>`));
  }
  body.appendChild(rows);
  return sec;
}

/* --- activity history --- */
function activityHistorySection(activity) {
  const sec = el(`<section class="acct-block">
    <h2 class="section-title">Activity history</h2>
    <p class="section-sub">Everything you've done across the tools — newest first.</p>
    <div class="acct-body"></div></section>`);
  const body = sec.querySelector(".acct-body");
  if (activity === null) {
    body.innerHTML = `<p class="acct-msg">Couldn't load your activity — try refreshing the page.</p>`;
    return sec;
  }
  if (!activity.length) {
    body.innerHTML = `<p>Nothing here yet. Run a <a href="rate-calculator.html">rate calculation</a> or save a <a href="simulator.html">simulator setup</a> and it'll show up.</p>`;
    return sec;
  }
  const ul = el(`<ul class="acct-log"></ul>`);
  for (const a of activity.slice(0, 100)) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="acct-log-kind">${esc(a.label || a.kind)}</span>
      ${a.detail ? `<span class="meta"> — ${esc(a.detail)}</span>` : ""}
      <span class="meta">${esc(relTime(a.at))}</span>`;
    ul.appendChild(li);
  }
  body.appendChild(ul);
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
      <a href="fee-tracker.html">Review the months</a> or <a href="audit.html">ask for a free audit</a>.</div>`));
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

/* One-time wire-up for the guest-import banner buttons. */
function wireImport(sec, user) {
  sec.addEventListener("click", async (e) => {
    const imp = e.target.closest("[data-import-guest]");
    const dis = e.target.closest("[data-dismiss-import]");
    if (imp) {
      imp.disabled = true;
      const msg = sec.querySelector("[data-import-msg]");
      try {
        const n = await doImportGuest(user, msg);
        if (msg) msg.textContent = n ? `Imported ${n} setup${n === 1 ? "" : "s"}. Refreshing…` : "Nothing to import.";
        boot();
      } catch (err) {
        if (msg) msg.textContent = (err && err.message) || "Import failed — your guest setups are still saved. Try again.";
        imp.disabled = false;
      }
    } else if (dis) {
      try { localStorage.setItem("fra_import_done_" + (user.id || "anon"), "1"); } catch (err) {}
      sec.remove();
    }
  });
}

async function renderDashboard(app, user) {
  const guest = !user;
  const dash = el(`<div id="acct-dash"></div>`);
  app.appendChild(dash);
  if (guest) {
    dash.appendChild(guestBanner());
  } else {
    const email = user && user.email ? esc(user.email) : "your account";
    dash.appendChild(el(`<p class="acct-email">Signed in as ${email}</p>`));
    const impSec = guestImportBanner();
    dash.appendChild(impSec);
    if (renderImportBanner(impSec, user)) wireImport(impSec, user);
    else impSec.remove();
  }

  // Profile first: referralLink() needs it and the resume card reads
  // resume_state — fetching it here avoids a duplicate SELECT on profiles.
  const profile = guest ? null : await getProfile().catch(() => null);
  // Fetch all independent datasets in parallel. Fee entries are fetched once
  // and shared: creep detection and the fee table use the same data.
  // Each dataset is null-safe: a failed fetch renders that section's own
  // error state, never a global spinner.
  const [states, runs, entries, subs, refStats, refLink,
         counts, simLogs, activity, requests, audits] = await Promise.all([
    listSimStates().catch(() => null),
    listRateRuns(50).catch(() => null),
    listFeeEntries().catch(() => null),
    listAlertSubs().catch(() => null),
    guest ? { clicks: 0, signups: 0, audits: 0 } : getReferralStats().catch(() => null),
    guest ? "" : referralLink(null, profile).catch(() => ""),
    guest ? Promise.resolve(null) : getActivityCounts().catch(() => null),
    listActivity(50, "simulator.").catch(() => null),
    listActivity(100).catch(() => null),
    guest ? Promise.resolve([]) : listAuditRequests().catch(() => null),
    guest ? Promise.resolve([]) : listAudits().catch(() => null),
  ]);
  let creepActive = false;
  try {
    const r = detectCreep(entries || [], 15);
    creepActive = !!(r && r.creepBp > 0);
  } catch (e) { /* alerts section handles its own data */ }

  const resume = guest ? null : (profile && profile.resume_state) || null;
  dash.appendChild(resumeSection(states, resume, guest));
  if (!guest) dash.appendChild(profileSection(profile, user, counts));
  dash.appendChild(mySimulatorsSection(states));
  dash.appendChild(simulatorLogsSection(simLogs));
  if (!guest) dash.appendChild(auditResultsSection(requests, audits));
  dash.appendChild(activityHistorySection(activity));
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
/* Adopt guest audit rows matching the sign-in email (one-time per tab). */
let adoptedAudits = false;
async function adoptOnce() {
  if (adoptedAudits) return;
  adoptedAudits = true;
  try { await adoptAuditRequests(); } catch (e) { /* best-effort */ }
}

let authWatching = false;
// Guards the double-render race: boot() runs on DOMContentLoaded AND again
// when onAuthStateChange fires INITIAL_SESSION, and sign-out triggers both
// the button and the SIGNED_OUT event. A superseded boot bails before it can
// append a second dashboard (duplicated IDs, doubled handlers).
let bootSeq = 0;
let bootDoneSeq = 0;  // seq of the last boot that finished rendering

async function boot() {
  const my = ++bootSeq;
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
  if (my !== bootSeq) return;
  if (user) {
    claimOnce();
    adoptOnce();
    await renderDashboard(app, user);
  } else {
    renderAuthCard(app);
    await renderDashboard(app, null);
  }
  // Superseded while rendering: clear only if no newer boot has finished
  // since (a newer boot that already rendered owns the DOM; a newer boot
  // still fetching will fill it).
  if (my !== bootSeq) {
    if (bootDoneSeq < my) app.innerHTML = "";
  } else {
    bootDoneSeq = my;
  }
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
}
