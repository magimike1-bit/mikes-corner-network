/* config.js — Supabase configuration for FairRate Audit accounts.
 *
 * Joseph: paste your real values below (from Supabase dashboard → Project Settings → API).
 *   SUPABASE_URL:      https://<your-project-ref>.supabase.co
 *   SUPABASE_ANON_KEY: the "anon" / "publishable" key (NOT the service_role key).
 *
 * NEVER put the service_role (secret) key here or anywhere in this repo — it
 * bypasses all database security. The frontend only ever uses the anon key;
 * row-level security (RLS) in Postgres enforces who can read/write what.
 *
 * Until real values are pasted, every account feature degrades gracefully to
 * logged-out local mode (data stays in this browser's localStorage, with a
 * nudge to create an account to sync across devices).
 */
export const SUPABASE_URL = "https://mmztfpxbglxhmbzwezga.supabase.co";
export const SUPABASE_ANON_KEY = "__SUPABASE_ANON_KEY__"; // Joseph to supply (Supabase → Project Settings → API → anon public key)

export function isConfigured() {
  return (
    typeof SUPABASE_URL === "string" &&
    SUPABASE_URL.startsWith("https://") &&
    !SUPABASE_URL.includes("__") &&
    typeof SUPABASE_ANON_KEY === "string" &&
    SUPABASE_ANON_KEY.length > 40 &&
    !SUPABASE_ANON_KEY.includes("__")
  );
}
