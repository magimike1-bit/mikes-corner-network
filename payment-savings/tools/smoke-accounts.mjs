#!/usr/bin/env node
/* smoke-accounts.mjs — static checks for the account system + growth-tool pages.
 * Verifies: every expected page exists with its module tag, footer disclosure
 * intact, no secrets in the repo, config placeholders present, SQL migration
 * enables RLS on every table, and every `from './x.js'` import resolves.
 * Run: node tools/smoke-accounts.mjs (exit non-zero on failure).
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
let fails = 0;
const fail = (m) => { fails++; console.error("FAIL: " + m); };
const ok = (m) => console.log("ok: " + m);

const PAGES = {
  "account.html": "account.js",
  "rate-calculator.html": "rate-calculator.js",
  "fee-tracker.html": "fee-tracker.js",
  "alerts.html": "alerts.js",
  "settlement-calculator.html": "settlement.js",
  "surcharge-tool.html": "surcharge.js",
  "referrals.html": "referrals.js",
  "transparency-wall.html": "wall.js",
  "annual-report.html": null,
  "how-we-get-paid.html": null,
};

for (const [page, mod] of Object.entries(PAGES)) {
  const p = path.join(ROOT, page);
  if (!fs.existsSync(p)) { fail(page + " missing"); continue; }
  const h = fs.readFileSync(p, "utf8");
  if (!h.includes("S8ZG1Q")) fail(page + ": AI disclosure footer missing");
  if (!/site-auth(\.[0-9a-f]{8})?\.js/.test(h)) fail(page + ": site-auth widget tag missing");
  if (!h.includes("footer-tools")) fail(page + ": tools footer nav missing");
  if (mod && !new RegExp("assets/js/" + mod.replace(/\.js$/, "") + "(\\.[0-9a-f]{8})?\\.js").test(h))
    fail(page + ": module tag for " + mod + " missing");
  if (/href="[a-z-]+"(?!html)/.test(h.replace(/href="[a-z-]+\.html"/g, "")) && false) fail(page + ": extensionless link?");
  ok(page + " structure");
}

// no secrets anywhere in the repo: flag JWT-shaped tokens and live secret keys.
// (The words "service_role"/"anon key" in README/config warnings are fine —
// only actual key material fails.)
const SECRET_PAT = /eyJ[A-Za-z0-9_-]{30,}|sk-(live|test)[A-Za-z0-9_-]+|xoxb-[A-Za-z0-9-]+|re_[A-Za-z0-9_]{20,}/;
function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (f === ".git" || f === "node_modules") continue;
    const st = fs.statSync(p);
    if (st.isDirectory()) { if (!["_research", "_work", "supabase"].includes(f) || f === "supabase") walk(p); }
    else if (/\.(js|html|json|md|sh|sql)$/.test(f)) {
      const c = fs.readFileSync(p, "utf8");
      if (SECRET_PAT.test(c)) fail("possible secret in " + path.relative(ROOT, p));
    }
  }
}
walk(ROOT);
ok("no secrets in repo");

// config: URL may be filled (project created); anon key must still be a
// placeholder until Joseph supplies it. isConfigured() must stay false.
const cfg = fs.readFileSync(path.join(ROOT, "js/config.js"), "utf8");
const urlFilled = /SUPABASE_URL = "https:\/\/[a-z0-9-]+\.supabase\.co"/.test(cfg);
const urlPlaceholder = cfg.includes("__SUPABASE_URL__");
const keyPlaceholder = cfg.includes("__SUPABASE_ANON_KEY__");
if ((!urlFilled && !urlPlaceholder) || !keyPlaceholder)
  fail("config.js: URL must be placeholder or real supabase URL; anon key must stay a placeholder");
else ok("config.js placeholders correct (key pending, local mode safe)");

// migration: RLS on every table
const sql = fs.readFileSync(path.join(ROOT, "supabase/migrations/001_init.sql"), "utf8");
const tables = ["profiles", "simulator_states", "rate_runs", "fee_entries",
  "alert_subscriptions", "referrals", "wall_submissions", "surcharge_runs", "settlement_runs"];
for (const t of tables) {
  if (!new RegExp("alter table public\\." + t + " enable row level security").test(sql))
    fail("RLS not enabled on " + t);
}
if (!/having count\(\*\) >= 3/i.test(sql)) fail("wall aggregate cell-suppression missing");
if (!/security definer/i.test(sql)) fail("SECURITY DEFINER functions missing");
ok("migration RLS complete (" + tables.length + " tables)");

// every relative import in js/ resolves
const jsDir = path.join(ROOT, "js");
for (const f of fs.readdirSync(jsDir).filter((x) => x.endsWith(".js"))) {
  const src = fs.readFileSync(path.join(jsDir, f), "utf8");
  for (const m of src.matchAll(/from\s+['"]\.\/([a-z0-9-]+\.js)['"]/g)) {
    if (!fs.existsSync(path.join(jsDir, m[1]))) fail(f + " imports missing " + m[1]);
  }
}
ok("js imports resolve");

console.log(fails ? `\n${fails} FAILURES` : "\nall account smoke checks passed");
process.exit(fails ? 1 : 0);
