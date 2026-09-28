/* db.js — data layer for FairRate Audit accounts.
 *
 * Logged in  → reads/writes the user's own rows in Supabase (RLS enforced).
 * Logged out (or Supabase not configured) → localStorage fallback under
 * fra_guest_*, plus a "create an account to sync across devices" nudge.
 * Alert subscriptions and transparency-wall submissions accept anonymous
 * rows by design (RLS allows anon INSERT only).
 */
import { isConfigured } from './config.0aae547a.js';
import { getClient, getUser } from './sb.c957517c.js';

export { isConfigured };

/* ---------- guest storage ---------- */
const G = (k) => "fra_guest_" + k;
function gget(k, dflt) {
  try { const v = localStorage.getItem(G(k)); return v == null ? dflt : JSON.parse(v); }
  catch (e) { return dflt; }
}
function gset(k, v) { try { localStorage.setItem(G(k), JSON.stringify(v)); } catch (e) {} }
export const guestNudge = "Create a free account to keep this on all your devices — it stays in this browser only for now.";

async function uid() {
  const u = await getUser();
  return u ? u.id : null;
}
function rid() {
  return "xxxx-xxxx".replace(/x/g, () => Math.floor(Math.random() * 16).toString(16)) +
    "-" + Date.now().toString(36);
}

/* ---------- simulator states ---------- */
export async function listSimStates() {
  const id = await uid();
  if (!id) return gget("simstates", []);
  const sb = await getClient();
  const { data, error } = await sb.from("simulator_states")
    .select("id,name,sector,saved_from_step,updated_at").eq("user_id", id).order("updated_at", { ascending: false }).limit(100);
  if (error) throw new Error(error.message);
  return data;
}
/* Setup status chip vocabulary (derived, never stored): complete = saved
   from the results step; in-progress = saved mid-flow; unknown = old rows
   or guest rows without step info. */
export function setupStatus(s) {
  const step = s.saved_from_step != null ? s.saved_from_step
    : (s._payload && s._payload.savedFromStep != null ? s._payload.savedFromStep : null);
  if (step === 6) return "complete";
  if (step >= 1 && step <= 5) return "in-progress";
  return "unknown";
}
export async function saveSimState(name, payload) {
  const clean = String(name || "Untitled setup").slice(0, 80);
  const step = payload && payload.savedFromStep != null ? payload.savedFromStep : null;
  const id = await uid();
  if (!id) {
    const all = gget("simstates", []);
    const rec = { id: rid(), name: clean, sector: payload.sector, updated_at: new Date().toISOString(), _payload: payload };
    gset("simstates", [rec, ...all].slice(0, 25));
    try { localStorage.setItem("fra_had_guest_data", "1"); } catch (e) {}
    return rec;
  }
  const sb = await getClient();
  const { data, error } = await sb.from("simulator_states").insert({
    user_id: id, name: clean, sector: payload.sector, state: payload,
    saved_from_step: step,
  }).select("id,name,sector,saved_from_step,updated_at").single();
  if (error) throw new Error(error.message);
  return data;
}
/* Overwrite an existing setup in place (the simulator's "Update this setup").
   RLS: the existing "simstates own all" policy already covers UPDATE. */
/* Bulk insert for the guest→account import: one round-trip instead of N.
   Rows: [{ name, payload }]. Guest storage is NOT touched here — the caller
   clears it only after this resolves, so a failure keeps the guest copies. */
export async function importSimStates(rows) {
  const list = (rows || []).map((r) => {
    const payload = r.payload || {};
    return {
      name: String(r.name || "Imported setup").slice(0, 80),
      sector: payload.sector,
      state: payload,
      saved_from_step: payload.savedFromStep != null ? payload.savedFromStep : null,
    };
  });
  const me = await uid();
  if (!me) {
    const all = gget("simstates", []);
    const recs = list.map((c) => ({
      id: rid(), name: c.name, sector: c.sector,
      updated_at: new Date().toISOString(), _payload: c.state,
    }));
    gset("simstates", [...recs, ...all].slice(0, 25));
    return recs;
  }
  const sb = await getClient();
  const { data, error } = await sb.from("simulator_states").insert(
    list.map((c) => ({ user_id: me, ...c }))
  ).select("id,name,sector,saved_from_step,updated_at");
  if (error) throw new Error(error.message);
  return data;
}
export async function updateSimState(id, name, payload) {
  const clean = String(name || "Untitled setup").slice(0, 80);
  const step = payload && payload.savedFromStep != null ? payload.savedFromStep : null;
  const me = await uid();
  if (!me) {
    const all = gget("simstates", []);
    const rec = all.find((r) => r.id === id);
    if (!rec) throw new Error("Saved setup not found.");
    rec.name = clean; rec.sector = payload.sector; rec._payload = payload;
    rec.updated_at = new Date().toISOString();
    gset("simstates", all);
    return rec;
  }
  const sb = await getClient();
  const { data, error } = await sb.from("simulator_states").update({
    name: clean, sector: payload.sector, state: payload,
    saved_from_step: step, updated_at: new Date().toISOString(),
  }).eq("id", id).select("id,name,sector,saved_from_step,updated_at").single();
  if (error) throw new Error(error.message);
  return data;
}
/* Rename only — leaves sector/state untouched. */
export async function renameSimState(id, name) {
  const clean = String(name || "").trim().slice(0, 80);
  if (!clean) throw new Error("Name can't be empty.");
  const me = await uid();
  if (!me) {
    const all = gget("simstates", []);
    const rec = all.find((r) => r.id === id);
    if (!rec) throw new Error("Saved setup not found.");
    rec.name = clean;
    gset("simstates", all);
    return rec;
  }
  const sb = await getClient();
  const { data, error } = await sb.from("simulator_states").update({ name: clean })
    .eq("id", id).select("id,name,sector,saved_from_step,updated_at").single();
  if (error) throw new Error(error.message);
  return data;
}
export async function loadSimState(id) {
  const me = await uid();
  if (!me) {
    const rec = gget("simstates", []).find((r) => r.id === id);
    if (!rec) throw new Error("Saved setup not found.");
    return rec._payload;
  }
  const sb = await getClient();
  const { data, error } = await sb.from("simulator_states").select("state").eq("id", id).single();
  if (error) throw new Error(error.message);
  return data.state;
}
export async function deleteSimState(id) {
  const me = await uid();
  if (!me) { gset("simstates", gget("simstates", []).filter((r) => r.id !== id)); return; }
  const sb = await getClient();
  const { error } = await sb.from("simulator_states").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/* ---------- effective-rate runs ---------- */
export async function saveRateRun(run) {
  const id = await uid();
  const rec = { ...run, at: new Date().toISOString(), id: rid() };
  if (!id) { gset("rateruns", [rec, ...gget("rateruns", [])].slice(0, 50)); return rec; }
  const sb = await getClient();
  const { error } = await sb.from("rate_runs").insert({
    user_id: id, fees: run.fees, volume: run.volume,
    rate_bp: run.rate_bp, sector: run.sector || null, verdict: run.verdict || null,
  });
  if (error) throw new Error(error.message);
  return rec;
}
export async function listRateRuns(limit = 50) {
  const id = await uid();
  if (!id) return gget("rateruns", []).slice(0, limit);
  const sb = await getClient();
  const { data, error } = await sb.from("rate_runs").select("fees,volume,rate_bp,sector,verdict,created_at")
    .eq("user_id", id).order("created_at", { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return data.map((r) => ({ fees: +r.fees, volume: +r.volume, rate_bp: r.rate_bp, sector: r.sector, verdict: r.verdict, at: r.created_at }));
}

/* ---------- fee-creep tracker entries ---------- */
export async function saveFeeEntry(entry) {
  const id = await uid();
  const rec = { ...entry, at: new Date().toISOString(), id: rid() };
  if (!id) {
    const all = gget("feeentries", []).filter((e) => e.month !== entry.month);
    gset("feeentries", [...all, rec].sort((a, b) => a.month < b.month ? -1 : 1));
    return rec;
  }
  // <input type="month"> yields "YYYY-MM" but the column is date: Postgres
  // rejects it (22P02). Coerce to the first of the month for the DB write;
  // the UI keeps working with "YYYY-MM" everywhere else.
  const dbMonth = entry.month && entry.month.length === 7 ? entry.month + "-01" : entry.month;
  const sb = await getClient();
  const { error } = await sb.from("fee_entries").upsert({
    user_id: id, month: dbMonth, fees: entry.fees, volume: entry.volume, rate_bp: entry.rate_bp,
  }, { onConflict: "user_id,month" });
  if (error) throw new Error(error.message);
  return rec;
}
export async function listFeeEntries() {
  const id = await uid();
  if (!id) return gget("feeentries", []);
  const sb = await getClient();
  const { data, error } = await sb.from("fee_entries").select("month,fees,volume,rate_bp")
    .eq("user_id", id).order("month", { ascending: true });
  if (error) throw new Error(error.message);
  // DB stores a full date; the UI speaks "YYYY-MM".
  return data.map((r) => ({ month: String(r.month).slice(0, 7), fees: +r.fees, volume: +r.volume, rate_bp: r.rate_bp }));
}
/* Creep detection: latest rate vs median of previous entries. Returns the
   basis-point increase, or 0 when there is no meaningful creep. */
export function detectCreep(entries, thresholdBp = 15) {
  if (!entries || entries.length < 3) return { creepBp: 0, baselineBp: null };
  const sorted = [...entries].sort((a, b) => a.month < b.month ? -1 : 1);
  const prev = sorted.slice(0, -1).map((e) => e.rate_bp).sort((a, b) => a - b);
  const baseline = prev[Math.floor(prev.length / 2)];
  const latest = sorted[sorted.length - 1].rate_bp;
  const creep = latest - baseline;
  return { creepBp: creep >= thresholdBp ? creep : 0, baselineBp: baseline, latestBp: latest };
}

/* ---------- alert subscriptions (CASL) ---------- */
export async function subscribeAlerts(email, topics, source) {
  const clean = String(email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) throw new Error("Enter a valid email address.");
  if (!isConfigured()) {
    // Not wired yet: keep the intent locally and surface the seam honestly.
    const all = gget("alertsubs", []);
    gset("alertsubs", [...all.filter((s) => s.email !== clean),
      { email: clean, topics, source, at: new Date().toISOString(), pending: true }]);
    return { ok: true, pending: true };
  }
  const sb = await getClient();
  const me = await uid();
  const row = {
    user_id: me, email: clean, topics,
    consent_at: new Date().toISOString(), consent_source: source || "site-form",
    unsubscribed_at: null,
  };
  const { error } = await sb.from("alert_subscriptions").upsert(row, { onConflict: "email" });
  if (!error) return { ok: true, pending: false };
  // A logged-out resubscribe on an already-subscribed email hits the upsert's
  // UPDATE path, which RLS rejects (42501). Say so plainly instead of
  // leaking the raw "row-level security policy" message.
  if (!me && error.code === "42501") throw new Error("That email is already subscribed.");
  // An anonymous row for this email may already exist (subscribed before
  // signing up). The upsert's UPDATE is then rejected by RLS (42501) because
  // the row's user_id is NULL. Claim it via the SECURITY DEFINER function.
  if (me && error.code === "42501") {
    const { error: rpcErr } = await sb.rpc("adopt_alert_subscription", { p_email: clean, p_topics: topics });
    if (rpcErr) throw new Error(rpcErr.message);
    return { ok: true, pending: false };
  }
  throw new Error(error.message);
}
export async function listAlertSubs() {
  if (!isConfigured()) return gget("alertsubs", []);
  const me = await uid();
  const sb = await getClient();
  if (!me) return [];
  const { data, error } = await sb.from("alert_subscriptions").select("email,topics,consent_at,unsubscribed_at")
    .eq("user_id", me).is("unsubscribed_at", null);
  if (error) throw new Error(error.message);
  return data;
}

/* ---------- surcharge + settlement runs ---------- */
export async function saveSurchargeRun(run) {
  const id = await uid();
  const rec = { ...run, at: new Date().toISOString(), id: rid() };
  if (!id) { gset("surchargeruns", [rec, ...gget("surchargeruns", [])].slice(0, 50)); return rec; }
  const sb = await getClient();
  const { error } = await sb.from("surcharge_runs").insert({
    user_id: id, volume: run.volume, avg_ticket: run.avg_ticket, result: run.result,
  });
  if (error) throw new Error(error.message);
  return rec;
}
export async function saveSettlementRun(run) {
  const id = await uid();
  const rec = { ...run, at: new Date().toISOString(), id: rid() };
  if (!id) { gset("settlementruns", [rec, ...gget("settlementruns", [])].slice(0, 50)); return rec; }
  const sb = await getClient();
  const { error } = await sb.from("settlement_runs").insert({
    user_id: id, volume: run.volume, pricing_model: run.pricing_model, result: run.result,
  });
  if (error) throw new Error(error.message);
  return rec;
}

/* ---------- referrals ---------- */
export async function getProfile() {
  const me = await uid();
  if (!me || !isConfigured()) return null;
  const sb = await getClient();
  const { data, error } = await sb.from("profiles")
    .select("referral_code,is_accountant,display_name,email,created_at,resume_state")
    .eq("id", me).single();
  if (error) return null;
  return data;
}
/* Update the editable profile fields (display name only for v2). */
export async function updateDisplayName(name) {
  const clean = String(name || "").trim().slice(0, 60);
  if (!clean) throw new Error("Display name can't be empty.");
  const me = await uid();
  if (!me) throw new Error("Sign in to update your profile.");
  const sb = await getClient();
  const { error } = await sb.from("profiles").update({ display_name: clean }).eq("id", me);
  if (error) throw new Error(error.message);
  return clean;
}
/* Per-account resume state ("where you left off"), cross-device.
   Shape: { page, title, at, setupId, setupName }. Covered by the existing
   "profiles update own" policy (auth.uid() = id). */
export async function saveResumeState(state) {
  const me = await uid();
  if (!me || !isConfigured()) return false;
  try {
    const sb = await getClient();
    const { error } = await sb.from("profiles").update({ resume_state: state }).eq("id", me);
    if (error) return false;
    return true;
  } catch (e) { return false; }
}
export async function referralLink(kind, profile) {
  // Optional profile: callers that already fetched it (e.g. the dashboard)
  // pass it in to avoid a duplicate SELECT on profiles. Omitted (undefined)
  // keeps the old behavior; an explicit null means "no profile, don't fetch".
  const p = profile !== undefined ? profile : await getProfile();
  const base = new URL("referrals.html", window.location.href);
  if (p && p.referral_code) {
    base.searchParams.set("ref", p.referral_code);
    if (kind === "accountant" || (p.is_accountant && kind !== "owner")) base.searchParams.set("lane", "accountant");
  }
  return base.toString();
}
export async function recordReferralClick(code) {
  if (!isConfigured() || !code) return;
  try {
    const sb = await getClient();
    await sb.rpc("record_referral_click", { p_code: String(code).toUpperCase().slice(0, 12) });
  } catch (e) { /* best-effort */ }
}
export async function claimPendingReferral() {
  const code = localStorage.getItem("fra_pending_ref");
  if (!code || !isConfigured()) return;
  try {
    const me = await uid();
    if (!me) return;
    const sb = await getClient();
    await sb.rpc("record_referral_signup", { p_code: code });
    localStorage.removeItem("fra_pending_ref");
  } catch (e) { /* best-effort */ }
}
export async function getReferralStats() {
  const me = await uid();
  if (!me || !isConfigured()) return { clicks: 0, signups: 0, audits: 0 };
  const sb = await getClient();
  // Count server-side; never pull the whole referral list into the browser.
  const countFor = (status) => sb.from("referrals")
    .select("id", { count: "exact", head: true }).eq("referrer_id", me).eq("status", status)
    .then(({ count, error }) => { if (error) throw new Error(error.message); return count || 0; });
  const [clicks, signups, audits] = await Promise.all(
    ["link-clicked", "signed-up", "audit-signed"].map(countFor));
  return { clicks, signups, audits };
}

/* ---------- transparency wall ---------- */
export async function submitWallEntry(entry) {
  const rateBp = Math.round(entry.rate * 100);
  if (!(rateBp > 0 && rateBp < 1500)) throw new Error("That rate looks off — check the numbers and try again.");
  if (!isConfigured()) {
    const all = gget("wallsubs", []);
    gset("wallsubs", [...all, { ...entry, at: new Date().toISOString(), pending: true }]);
    return { ok: true, pending: true };
  }
  const sb = await getClient();
  const me = await uid();
  const { error } = await sb.from("wall_submissions").insert({
    user_id: me, processor: String(entry.processor).slice(0, 60),
    sector: String(entry.sector).slice(0, 40), volume_band: String(entry.volume_band).slice(0, 40),
    rate_bp: rateBp,
  });
  if (error) throw new Error(error.message);
  return { ok: true, pending: false };
}
/* Aggregates only — the raw table is never readable by clients. Cells with
   fewer than 3 submissions are suppressed by the view itself. */
export async function getWallAggregates() {
  if (!isConfigured()) return [];
  const sb = await getClient();
  const { data, error } = await sb.from("wall_aggregates").select("*").order("n", { ascending: false }).limit(200);
  if (error) throw new Error(error.message);
  return data;
}

/* ---------- activity log (dashboard analytics) ----------
 * Per-user event log: sign-ins, simulator saves/loads/deletes, tool runs,
 * audit requests, profile updates. Powers the dashboard's Profile counts,
 * Simulator logs, and Activity history sections.
 * Best-effort by design: a logging failure must never break the action
 * being logged, so logActivity never throws. */
const ACTIVITY_KINDS = new Set([
  "auth.sign_in", "simulator.setup_saved", "simulator.setup_loaded",
  "simulator.setup_deleted", "simulator.setup_updated",
  "tool.rate_run", "tool.fee_entry", "tool.surcharge_run", "tool.settlement_run",
  "audit.request_submitted", "profile.updated", "guest.imported",
]);
export async function logActivity(kind, label, detail) {
  try {
    if (!ACTIVITY_KINDS.has(kind)) return;
    const cleanLabel = String(label || "").slice(0, 120) || kind;
    const me = await uid();
    if (!me) {
      const all = gget("activity", []);
      all.unshift({ kind, label: cleanLabel, detail: detail || null, at: new Date().toISOString() });
      gset("activity", all.slice(0, 50));
      return;
    }
    if (!isConfigured()) return;
    const sb = await getClient();
    if (!sb) return;
    await sb.from("activity_log").insert({
      user_id: me, kind, label: cleanLabel, detail: detail || null,
    });
  } catch (e) { /* never break the caller */ }
}
/* Newest first. kindPrefix filters (e.g. "simulator." for the Simulator
   logs section). Guest reads the local log. */
export async function listActivity(limit = 50, kindPrefix) {
  const n = Math.max(1, Math.min(100, +limit || 50));
  const me = await uid();
  if (!me) {
    const all = gget("activity", []);
    const f = kindPrefix ? all.filter((a) => String(a.kind || "").startsWith(kindPrefix)) : all;
    return f.slice(0, n);
  }
  if (!isConfigured()) return [];
  const sb = await getClient();
  let q = sb.from("activity_log").select("kind,label,detail,created_at")
    .eq("user_id", me).order("created_at", { ascending: false }).limit(n);
  if (kindPrefix) q = q.like("kind", kindPrefix.replace(/[%_]/g, "") + "%");
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data || []).map((r) => ({ kind: r.kind, label: r.label, detail: r.detail, at: r.created_at }));
}
/* Cheap head-counts for the dashboard profile (visits, simulator saves).
   Head-only queries — no row data crosses the wire. */
export async function getActivityCounts() {
  const me = await uid();
  if (!me || !isConfigured()) {
    const all = gget("activity", []);
    return {
      visits: all.filter((a) => a.kind === "auth.sign_in").length,
      saves: all.filter((a) => a.kind === "simulator.setup_saved").length,
    };
  }
  const sb = await getClient();
  const countKind = async (kind) => {
    const { count, error } = await sb.from("activity_log")
      .select("id", { count: "exact", head: true })
      .eq("user_id", me).eq("kind", kind);
    if (error) throw new Error(error.message);
    return count || 0;
  };
  const [visits, saves] = await Promise.all([
    countKind("auth.sign_in"), countKind("simulator.setup_saved"),
  ]);
  return { visits, saves };
}

/* ---------- guest → account import helpers ---------- */
/* The guest's own simulator list, readable even when signed in — used only
   by the one-time import offer on the dashboard. */
export function listGuestSimStates() {
  return gget("simstates", []);
}
/* Clear guest simulator data after a successful import. Runs only after
   every guest setup has been written to the account. */
export function clearGuestSimStates() {
  gset("simstates", []);
  try { localStorage.removeItem("fra_had_guest_data"); } catch (e) {}
}

/* ---------- audit requests (free-audit intake) ---------- */
const VOLUME_BANDS = new Set(["under-10k", "10k-25k", "25k-50k", "50k-100k", "100k-250k", "over-250k"]);
const BUSINESS_TYPES = new Set(["retail", "restaurant", "qsr", "hotel", "grocery", "salon", "other"]);
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/; // mirrors the DB check constraint
const nullIfEmpty = (v, max) => {
  const t = String(v == null ? "" : v).trim();
  return t ? t.slice(0, max) : null;
};
/* Insert shape: { name, email, business_name, volume_band, business_type?,
   current_processor?, phone?, message? }. Empty optionals become null, never
   "". Throws with a human message on validation failure. */
export async function submitAuditRequest(d) {
  const name = nullIfEmpty(d.name, 80);
  const email = nullIfEmpty(d.email, 254);
  const businessName = nullIfEmpty(d.business_name, 120);
  if (!name || name.length < 2) throw new Error("Please enter your name.");
  if (!email || !EMAIL_RE.test(email)) throw new Error("Please check your email address.");
  if (!businessName || businessName.length < 2) throw new Error("Please enter your business name.");
  if (!VOLUME_BANDS.has(d.volume_band)) throw new Error("Please choose your monthly card volume.");
  const businessType = d.business_type && BUSINESS_TYPES.has(d.business_type) ? d.business_type : null;
  const row = {
    name, email: email.toLowerCase(), business_name: businessName,
    phone: nullIfEmpty(d.phone, 40),
    volume_band: d.volume_band,
    business_type: businessType,
    current_processor: nullIfEmpty(d.current_processor, 80),
    message: nullIfEmpty(d.message, 2000),
  };
  const me = await uid().catch(() => null);
  // Session may have expired mid-form (was logged in): try authenticated
  // first, fall back to anonymous rather than losing the lead. The F4
  // adoption (or Joseph's manual link) recovers it via the email.
  const sb = await getClient();
  if (!sb) throw new Error("Couldn't send — check your connection and try again.");
  let withUser = me ? { ...row, user_id: me } : { ...row, user_id: null };
  let { error } = await sb.from("audit_requests").insert(withUser);
  if (error && me) {
    ({ error } = await sb.from("audit_requests").insert({ ...row, user_id: null }));
  }
  if (error) throw new Error(error.message || "Couldn't send — check your connection and try again.");
  return { ok: true, email: row.email };
}
/* The signed-in user's own requests, newest first. Spam-triaged rows are
   hidden — the user never sees their request labeled spam. */
export async function listAuditRequests() {
  const me = await uid();
  if (!me || !isConfigured()) return [];
  const sb = await getClient();
  const { data, error } = await sb.from("audit_requests")
    .select("id,business_name,status,created_at,volume_band")
    .eq("user_id", me).neq("status", "spam")
    .order("created_at", { ascending: false }).limit(20);
  if (error) throw new Error(error.message);
  return data || [];
}
/* F4 adoption: guest submitted, then signed up. Claims the caller's own
   anonymous rows by matching the verified JWT email (see the
   "auditreq adopt own" RLS policy). Idempotent. */
export async function adoptAuditRequests() {
  const me = await uid();
  if (!me || !isConfigured()) return 0;
  try {
    const sb = await getClient();
    const user = await getUser();
    const email = user && user.email ? String(user.email).toLowerCase() : null;
    if (!email) return 0;
    const { data, error } = await sb.from("audit_requests")
      .update({ user_id: me }).is("user_id", null).eq("email", email)
      .select("id");
    if (error) return 0;
    return (data || []).length;
  } catch (e) { return 0; }
}
/* Pipeline rows Joseph linked to this account (dashboard "Free audit
   results"). The "audits read own" policy gates this. */
export async function listAudits() {
  const me = await uid();
  if (!me || !isConfigured()) return [];
  const sb = await getClient();
  const { data, error } = await sb.from("audits")
    .select("id,merchant_name,status,monthly_volume,baseline_rate_bp,current_rate_bp,savings_share_bp,updated_at")
    .eq("user_id", me).order("updated_at", { ascending: false }).limit(20);
  if (error) throw new Error(error.message);
  return data || [];
}
