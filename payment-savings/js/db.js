/* db.js — data layer for FairRate Audit accounts.
 *
 * Logged in  → reads/writes the user's own rows in Supabase (RLS enforced).
 * Logged out (or Supabase not configured) → localStorage fallback under
 * fra_guest_*, plus a "create an account to sync across devices" nudge.
 * Alert subscriptions and transparency-wall submissions accept anonymous
 * rows by design (RLS allows anon INSERT only).
 */
import { isConfigured } from "./config.js";
import { getClient, getUser } from "./sb.js";

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
    .select("id,name,sector,updated_at").eq("user_id", id).order("updated_at", { ascending: false }).limit(100);
  if (error) throw new Error(error.message);
  return data;
}
export async function saveSimState(name, payload) {
  const clean = String(name || "Untitled setup").slice(0, 80);
  const id = await uid();
  if (!id) {
    const all = gget("simstates", []);
    const rec = { id: rid(), name: clean, sector: payload.sector, updated_at: new Date().toISOString(), _payload: payload };
    gset("simstates", [rec, ...all].slice(0, 25));
    return rec;
  }
  const sb = await getClient();
  const { data, error } = await sb.from("simulator_states").insert({
    user_id: id, name: clean, sector: payload.sector, state: payload,
  }).select("id,name,sector,updated_at").single();
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
  const { data, error } = await sb.from("profiles").select("referral_code,is_accountant,display_name").eq("id", me).single();
  if (error) return null;
  return data;
}
export async function referralLink(kind) {
  const p = await getProfile();
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
