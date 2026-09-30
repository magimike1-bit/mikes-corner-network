// tools/snapshot.mjs — PlanPrice monthly price-sweep snapshot.
//
// MONTHLY REVIEW-SCORE RE-CHECK (PP-REVIEW-SCORES): during each monthly
// verification sweep, re-verify every score in data/review-scores.json
// against its source URL (G2/Capterra product page); update score, reviews
// count, and the top-level checked date; drop any source that can no longer
// be verified (honest gap, never a guess); then regenerate the site.
//
// Usage: node tools/snapshot.mjs [YYYY-MM-DD]   (defaults to today)
//
// Reads data/products.json and writes data/sweeps/YYYY-MM.json: one record
// per product with its starting price (text + numeric), current deal
// headline (or null), and last_verified date. The generator diffs each
// month's build against the most recent sweep BEFORE the current CHECKED
// month to render "Price dropped since last check" / "New deal" flags.
//
// Idempotent per month: re-running within the same month overwrites that
// month's snapshot with fresh data from products.json. A snapshot is only
// useful as a baseline if the prices it captured were actually verified,
// so it should be run on (or just after) the sweep/check date.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startPriceNumeric, startPriceText } from "./price-parse.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const when = process.argv[2] || new Date().toISOString().slice(0, 10);
const month = when.slice(0, 7);
if (!/^\d{4}-\d{2}$/.test(month) || month < "2020-01") {
  console.error(`snapshot.mjs: bad date "${when}" — expected YYYY-MM-DD`);
  process.exit(1);
}

const data = JSON.parse(readFileSync(join(ROOT, "data", "products.json"), "utf8"));

const snap = {
  sweep_month: month,
  sweep_date: when,
  source: "products.json",
  products: data.products.map((p) => ({
    slug: p.slug,
    start_price_text: startPriceText(p),
    start_price_numeric: startPriceNumeric(p),
    deal_headline: p.deal ? p.deal.headline : null,
    last_verified: p.last_verified,
  })),
};

mkdirSync(join(ROOT, "data", "sweeps"), { recursive: true });
writeFileSync(
  join(ROOT, "data", "sweeps", `${month}.json`),
  JSON.stringify(snap, null, 2) + "\n",
  "utf8"
);
console.log(`Wrote data/sweeps/${month}.json (${snap.products.length} products)`);
