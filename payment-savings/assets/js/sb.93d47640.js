/* sb.js — Supabase client + auth helpers (lazy, degrades gracefully).
 *
 * The supabase-js library is loaded from CDN only when real config exists AND
 * we're in a browser. In node (smoke tests) or without config, every function
 * resolves to a safe logged-out value so pages boot in local mode.
 */
import { SUPABASE_URL, SUPABASE_ANON_KEY, isConfigured } from './config.0aae547a.js';

export { isConfigured };

const SB_CDN = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.44.4/+esm";

let _client = null;
let _clientTried = false;

export async function getClient() {
  if (_clientTried) return _client;
  _clientTried = true;
  if (!isConfigured()) return null;
  if (typeof window === "undefined") return null; // node: stay in local mode
  try {
    const { createClient } = await import(/* @vite-ignore */ SB_CDN);
    _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  } catch (e) {
    console.warn("Supabase unavailable, using local mode:", e && e.message);
    _client = null;
  }
  return _client;
}

let _user = null;       // cached server-validated user
let _userToken = null;  // access token the cache was validated against

export async function getUser() {
  const sb = await getClient();
  if (!sb) return null;
  // getSession() is local (no network); getUser() hits the auth server.
  // Validate once per access token and cache: every db.* call shares it
  // instead of each doing its own round-trip. A token change (refresh,
  // re-login) re-validates automatically; sign-out clears the cache below.
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { _user = null; _userToken = null; return null; }
  if (_user && _userToken === session.access_token) return _user;
  const { data } = await sb.auth.getUser();
  _user = data && data.user ? data.user : null;
  _userToken = session.access_token;
  return _user;
}

export function onAuthChange(cb) {
  getClient().then((sb) => {
    if (!sb) { cb("LOCAL_MODE", null); return; }
    sb.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") { _user = null; _userToken = null; }
      cb(event, session);
    });
  });
}

function errMsg(e) {
  return (e && e.message) || "Something went wrong. Please try again.";
}

export async function signUp(email, password) {
  const sb = await getClient();
  if (!sb) return { ok: false, error: "Accounts are not connected yet — your data is saved in this browser for now." };
  const { data, error } = await sb.auth.signUp({
    email: String(email).trim().toLowerCase(),
    password,
    options: { emailRedirectTo: new URL("account.html", window.location.href).toString() },
  });
  if (error) return { ok: false, error: errMsg(error) };
  return { ok: true, needsConfirm: !(data && data.session), user: data && data.user };
}

export async function signIn(email, password) {
  const sb = await getClient();
  if (!sb) return { ok: false, error: "Accounts are not connected yet — your data is saved in this browser for now." };
  const { data, error } = await sb.auth.signInWithPassword({
    email: String(email).trim().toLowerCase(), password,
  });
  if (error) return { ok: false, error: errMsg(error) };
  return { ok: true, user: data && data.user };
}

export async function signInMagic(email) {
  const sb = await getClient();
  if (!sb) return { ok: false, error: "Accounts are not connected yet." };
  const { error } = await sb.auth.signInWithOtp({
    email: String(email).trim().toLowerCase(),
    options: { emailRedirectTo: new URL("account.html", window.location.href).toString() },
  });
  if (error) return { ok: false, error: errMsg(error) };
  return { ok: true };
}

export async function resetPassword(email) {
  const sb = await getClient();
  if (!sb) return { ok: false, error: "Accounts are not connected yet." };
  const { error } = await sb.auth.resetPasswordForEmail(String(email).trim().toLowerCase(), {
    redirectTo: new URL("account.html", window.location.href).toString(),
  });
  if (error) return { ok: false, error: errMsg(error) };
  return { ok: true };
}

export async function signOut() {
  const sb = await getClient();
  if (sb) await sb.auth.signOut();
  return { ok: true };
}
