// lint-invented-strings.mjs — PP-SECTIONS + PP-SECTIONS-PHASE2 acceptance:
// zero invented strings.
// Extracts text nodes from the NEW generated pages (categories/*,
// compare.html, compare/*, deals.html, canadian.html), normalizes whitespace, and asserts every
// sentence is either a substring of the verified corpus (products.json +
// review-scores.json + compare.json + all pre-existing page text) or a
// whitelisted mechanical string (counts, dates, vs-joined titles, nav
// words). Exits non-zero on the first invented sentence found.
//
// Usage: node tools/lint-invented-strings.mjs
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { slugify } from "./slugify.mjs";
import { tierSavings, allSavings, firstYear } from "./savings.mjs";
import { rankByAvg, rankByReviews } from "./review-rank.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "data");

const norm = (s) => s.replace(/\s+/g, " ").trim();
const decodeEntities = (s) =>
  s
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&rsquo;", "’");

// ---- text extraction ------------------------------------------------------
// Shared chrome (header/footer/disclosure-bar) is byte-identical on every
// page and pre-approved — it is skipped so the lint only judges new copy.
function extractText(html) {
  let t = html;
  t = t.replace(/<script[\s\S]*?<\/script>/gi, " ");
  t = t.replace(/<style[\s\S]*?<\/style>/gi, " ");
  t = t.replace(/<div class="disclosure-bar">[\s\S]*?<\/div>/, " ");
  t = t.replace(/<header class="site-header">[\s\S]*?<\/header>/, " ");
  t = t.replace(/<footer class="site-footer">[\s\S]*?<\/footer>/, " ");
  const meta = [...t.matchAll(/<meta name="description" content="([^"]*)"/g)].map((m) => m[1]);
  const title = [...t.matchAll(/<title>([\s\S]*?)<\/title>/gi)].map((m) => m[1]);
  t = t.replace(/<title>[\s\S]*?<\/title>/gi, " "); // title linted separately
  // Block-level boundaries become sentence breaks so adjacent text nodes in
  // different elements (e.g. facts-strip dt/dd pairs) are not glued into one
  // uncheckable blob.
  t = t.replace(/<\/(p|li|div|dt|dd|section|h[1-6]|tr|td|th|dl|ul|ol|table|aside|main|article|header|footer|nav|form|label|caption)>/gi, "\n");
  t = t.replace(/<(br|hr)[^>]*>/gi, "\n");
  t = t.replace(/<[^>]+>/g, " ");
  t = decodeEntities(t);
  return {
    // NOTE: text is NOT whitespace-normalized here — block boundaries are
    // encoded as newlines and sentencesOf() splits on them before norm().
    text: t,
    meta: meta.map((m) => norm(decodeEntities(m))),
    titles: title.map((m) => norm(decodeEntities(m))),
  };
}

function sentencesOf(text) {
  return text
    .split(/(?<=[.!?…]["”']?)[\s\n]+|\n+/)
    .map(norm)
    .filter((s) => s.length > 0)
    // Tokens with no letters/digits/emoji ("›", "·", "—") are separators,
    // not sentences.
    .filter((s) => /[a-zA-Z0-9\u{1F300}-\u{1FAFF}]/u.test(s));
}

// ---- corpus: every string already on the site or in verified data ---------
function collectStrings(v, out) {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => collectStrings(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => collectStrings(x, out));
}

const corpusParts = [];
// Read each data file exactly once; the parsed docs are reused for both the
// corpus and the mechanical allowlist below.
const productsDoc = JSON.parse(readFileSync(join(DATA, "products.json"), "utf8"));
const reviewScoresDoc = JSON.parse(readFileSync(join(DATA, "review-scores.json"), "utf8"));
const compareDoc = JSON.parse(readFileSync(join(DATA, "compare.json"), "utf8"));
for (const doc of [productsDoc, reviewScoresDoc, compareDoc]) {
  const strings = [];
  collectStrings(doc, strings);
  corpusParts.push(strings.map(norm).join("\n"));
}

// All pre-existing page text (everything except the linted pages): the new
// pages reuse header/footer/dir-row/facts-strip/pricing/reviews/scores
// components, so any sentence they render from those must already appear.
// NOTE: deals/*.html are linted pages (PP-OVERNIGHT-5 extended the lint to
// the modified deal pages), so they are EXCLUDED from the corpus — otherwise
// they would self-pass and the check would be vacuous. Same for the two new
// collection pages.
function listHtml(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) listHtml(p, out);
    else if (e.name.endsWith(".html")) out.push(p);
  }
  return out;
}
for (const f of listHtml(ROOT)) {
  const rel = f.slice(ROOT.length + 1).replace(/\\/g, "/");
  if (rel.startsWith("categories/") || rel.startsWith("compare/") || rel === "compare.html" ||
      rel === "deals.html" || rel === "canadian.html" ||
      rel === "free.html" || rel === "top-rated.html" || rel.startsWith("deals/"))
    continue;
  corpusParts.push(extractText(readFileSync(f, "utf8")).text);
}
const corpus = norm(corpusParts.join("\n"));

// ---- mechanical allowlist (no verdicts, no copy — counts/dates/titles) ----
const products = productsDoc.products;
const compare = compareDoc;
const categories = [...new Set(products.map((p) => p.category))];
const names = products.map((p) => p.name);
const setTitles = compare.sets.map((s) => s.title);
const dateRe = String.raw`\d{4}-\d{2}-\d{2}`;

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const monthDateRe = String.raw`(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}, \d{4}`;
const mechanical = [
  /^Compare$/,
  /^Compare — PlanPrice$/,
  new RegExp(`^\\d+ products? tracked · prices checked ${dateRe}$`),
  new RegExp(`^${setTitles.map(escRe).join("|")}$`),
  ...setTitles.map((t) => new RegExp(`^${escRe(t)} — PlanPrice$`)),
  ...setTitles.map((t) => new RegExp(`^Head-to-head: ${escRe(t)}$`)),
  ...setTitles.map(
    (t) =>
      new RegExp(
        `^${escRe(t)}: compare verified pricing, current deals, and user feedback side by side\\. Prices checked ${dateRe}\\.$`
      )
  ),
  ...categories.map((c) => new RegExp(`^${escRe(c)} Pricing & Deals — PlanPrice$`)),
  ...categories.map(
    (c) =>
      new RegExp(
        `^${escRe(c)} software: verified pricing and current promotions\\. \\d+ products? tracked, checked ${dateRe}\\.$`
      )
  ),
  ...categories.map((c) => new RegExp(`^${escRe(c)} · \\d+ products$`)),
  ...categories.map((c) => new RegExp(`^All deals › ${escRe(c)}$`)),
  ...setTitles.map((t) => new RegExp(`^Compare › ${escRe(t)}$`)),
  /^All deals › Compare$/,
  ...names.map((n) => new RegExp(`^Consider ${escRe(n)} if…$`)),
  new RegExp(`^\\d+ products, side by side · prices checked ${dateRe}$`),
  new RegExp(`^\\d+ head-to-head comparisons tracked$`),
  new RegExp(
    `^Head-to-head comparisons of rival B2B software: verified pricing, current deals, and user feedback side by side\\. \\d+ comparisons tracked\\.$`
  ),
  // Phase-2 pages (PP-SECTIONS-PHASE2): mechanical counts/dates/titles only.
  /^Current promos$/,
  /^Canadian vendors$/,
  /^Current promos — PlanPrice$/,
  /^Canadian vendors — PlanPrice$/,
  /^All deals › Current promos$/,
  /^All deals › Canadian vendors$/,
  new RegExp(`^\\d+ active promos? · prices checked ${dateRe}$`),
  new RegExp(`^\\d+ Canadian vendors? · prices checked ${dateRe}$`),
  new RegExp(
    `^Current promotions on B2B software: \\d+ active promos?, verified against vendor sites\\. Checked ${dateRe}\\.$`
  ),
  new RegExp(
    `^Canadian B2B software vendors: \\d+ verified Canadian (company|companies) — list prices and promos checked ${dateRe}\\.$`
  ),
  // AdSense-readiness (PP-ADSENSE-READINESS): guide banner on category
  // pages — mechanical "Buyer's guide: how to choose <category> software".
  ...categories.map((c) => new RegExp(`^Buyer's guide: how to choose ${escRe(c)} software$`)),
  // Empty-state copy (renders only when zero promos; listed so a future
  // zero-promo build stays lint-clean — the sentence itself is mechanical).
  /^No active promos right now — check back after the next price sweep\.$/,

  // ---- PP-OVERNIGHT-5: deal-page template chrome + §4 mechanical templates.
  // Deal pages are linted now, so their fixed-shape template sentences need
  // allowlist entries (they previously passed via the corpus). Every entry
  // below is either a fixed template string or an exact enumeration derived
  // from the data by the shared tools/savings.mjs + tools/review-rank.mjs
  // modules — the same code the generator uses, so the lint pins the exact
  // numbers instead of trusting a shaped regex.
  // Facts-strip / pricing-table / section chrome (fixed wording).
  /^Starting price$/,
  /^Current promo$/,
  /^Verified$/,
  /^Vendor$/,
  /^Category$/,
  /^Offer ends$/,
  /^First-year cost \(starting tier\)$/,
  /^Pricing$/,
  /^Plan$/,
  /^Price$/,
  /^Cadence$/,
  /^Notes$/,
  /^Deal verification$/,
  /^What users report$/,
  /^Commonly praised$/,
  /^Commonly criticized$/,
  /^Review scores$/,
  /^Related deals$/,
  /^No current promo$/,
  /^No public promo — standard list prices$/,
  /^Always confirm on the vendor's pricing page before purchasing — plans and prices change\.$/,
  /^Summarized from user reviews on G2 and Capterra; not a PlanPrice rating\.$/,
  /^Promotions change\.$/,
  /^Confirm the current offer on the vendor's page before buying\.$/,
  /^Check the current price$/,
  /^Affiliate link pending approval — this button is inert for now\.$/,
  /^See our affiliate disclosure \.$/,
  // F3 freshness sentences (§4: absolute dates only, idempotent).
  new RegExp(`^Prices verified ${monthDateRe}$`),
  new RegExp(`^Deal verified ${monthDateRe}$`),
  new RegExp(`^Re-check before buying — last verified ${monthDateRe}$`),
  new RegExp(`^No public promotion found \\(checked ${dateRe}\\)\\.$`),
  /^Prices below are standard list\.$/,
  new RegExp(`^This promotion ended ${dateRe}\\. Prices below are standard list\\.$`),
  new RegExp(`^Vendor offer ends ${dateRe}\\.$`),
  // Per-product deal-page templates (title/meta checked whole, not split).
  ...products.map(
    (p) => new RegExp(`^${escRe(p.name)} Pricing & Deals \\(Verified ${dateRe}\\) — PlanPrice$`)
  ),
  ...products.map(
    (p) =>
      new RegExp(
        `^${escRe(p.name)} verified list pricing and current promotions\\. ${escRe(p.tagline)} Checked ${dateRe} by the PlanPrice research team\\.$`
      )
  ),
  ...products.map((p) => new RegExp(`^All deals › ${escRe(p.name)}$`)),
  ...products.map((p) => new RegExp(`^${escRe(p.name)} list prices, verified ${dateRe}\\.$`)),
  ...products
    .filter((p) => p.similar_to)
    .map((p) => new RegExp(`^Think of it as: ${escRe(p.similar_to)} \\.$`)),
  ...products
    .filter((p) => p.canadian)
    .map(() => new RegExp(`^🇨🇦 Canadian company — founded in .+, headquartered in .+\\.$`)),
  ...products
    .filter((p) => p.affiliate && p.affiliate.status === "none")
    .map((p) => new RegExp(`^Visit ${escRe(p.name)} →$`)),
  ...products
    .filter((p) => p.affiliate && p.affiliate.status === "none")
    .map(
      (p) =>
        new RegExp(
          `^PlanPrice has no affiliate relationship with ${escRe(p.name)} — we earn nothing if you choose them\\.$`
        )
    ),
  // Deal verify-src host line (host is a substring of the data's source_url;
  // the stripped link leaves a space before the final period).
  ...products
    .filter((p) => p.deal)
    .map((p) => new RegExp(`^Source: ${escRe(new URL(p.deal.source_url).hostname)} \\.$`)),
  // Review-score source lines, exact from review-scores.json.
  ...products.flatMap((p) => {
    const entry = reviewScoresDoc.scores[p.slug];
    if (!entry) return [];
    return [
      ["G2", entry.g2],
      ["Capterra", entry.capterra],
    ]
      .filter(([, s]) => s && typeof s.score === "number")
      .map(([label, s]) => {
        const reviews =
          typeof s.reviews === "number" ? ` \\(${s.reviews.toLocaleString("en-US")} reviews\\)` : "";
        // The stripped <a> label leaves "G2 :" / "Capterra :" (space before colon).
        return new RegExp(`^${label} : ${escRe(String(s.score))}/5${reviews}$`);
      });
  }),
  new RegExp(
    `^Scores are aggregate user ratings from third-party review sites, checked ${dateRe}\\.$`
  ),
  /^They are not PlanPrice ratings\.$/,
  // F1 §4 template: exact callout strings, derived by tools/savings.mjs.
  ...products.flatMap((p) =>
    (p.pricing_tiers || [])
      .map((t) => tierSavings(t))
      .filter(Boolean)
      .map((sv) => new RegExp(`^${escRe(sv.callout)}$`))
  ),
  // F5 §4 template: exact first-year cells, derived by tools/savings.mjs.
  ...products
    .map((p) => firstYear(p))
    .filter(Boolean)
    .map((fy) => new RegExp(`^${escRe(fy.text)}$`)),
  // F1 biggest-savers strip: exact top-5 lines.
  /^Biggest annual-billing savings$/,
  /^Top 5 tier-level savings when billed annually, computed from verified list prices\.$/,
  ...allSavings(products)
    .slice(0, 5)
    .map((s) => new RegExp(`^${escRe(s.line)}$`)),
  // F2 /free.html.
  /^Free to start — PlanPrice$/,
  /^All deals › Free to start$/,
  /^Free to start$/,
  new RegExp(`^Start free: \\d+ products with a \\$0 tier — verified pricing, checked ${dateRe}\\.$`),
  new RegExp(`^\\d+ products with a free tier · prices checked ${dateRe}$`),
  ...products.flatMap((p) =>
    (p.pricing_tiers || [])
      .filter((t) => t.price === "$0")
      .map((t) => new RegExp(`^${escRe(t.name)} — ${escRe(t.price)}$`))
  ),
  // F4 /top-rated.html.
  /^Top rated — PlanPrice$/,
  /^All deals › Top rated$/,
  /^Top rated$/,
  new RegExp(
    `^The highest-rated B2B software by verified G2 and Capterra scores: \\d+ products ranked\\. Scores checked ${dateRe}\\.$`
  ),
  new RegExp(`^\\d+ products ranked by average G2/Capterra score · scores checked ${dateRe}$`),
  /^Highest average score$/,
  /^Most reviewed$/,
  ...rankByAvg(products, reviewScoresDoc).map((r) => new RegExp(`^${escRe(r.line)}$`)),
  ...rankByReviews(products, reviewScoresDoc).map((r) => new RegExp(`^${escRe(r.mostLine)}$`)),
  /^Averages are the mean of each product's available G2 and Capterra scores — not a PlanPrice rating\.$/,
  new RegExp(`^Scores checked ${dateRe}\\.$`),
];

const isMechanical = (s) => mechanical.some((re) => re.test(s));

// ---- lint the new + modified pages ----------------------------------------
// PP-OVERNIGHT-5 extended the page list: the two new collection pages plus
// every modified deal page (deals/*.html). Compare pages were already
// covered. Every new sentence must be corpus-verbatim or a whitelisted
// mechanical template from brief §4 (counts, SAVE values, dates).
const newPages = [];
for (const c of categories) newPages.push(`categories/${slugify(c)}.html`);
newPages.push("deals.html");
newPages.push("canadian.html");
newPages.push("free.html");
newPages.push("top-rated.html");
newPages.push("compare.html");
for (const s of compare.sets) newPages.push(`compare/${s.slug}.html`);
for (const p of products) newPages.push(`deals/${p.slug}.html`);

let failures = 0;
for (const rel of newPages) {
  const html = readFileSync(join(ROOT, rel), "utf8");
  const { text, meta, titles } = extractText(html);
  const all = [...titles, ...meta, ...sentencesOf(text)];
  const seen = new Set();
  for (const s of all) {
    if (seen.has(s)) continue;
    seen.add(s);
    if (isMechanical(s)) continue;
    if (corpus.includes(s)) continue;
    failures++;
    console.log(`INVENTED [${rel}]: ${s.slice(0, 160)}`);
  }
}

if (failures) {
  console.log(`\nFAIL: ${failures} invented sentence(s) on new pages.`);
  process.exit(1);
}
console.log(`OK: ${newPages.length} new pages linted — zero invented sentences.`);
