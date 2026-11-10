// PlanPrice static site generator — reads data/products.json, renders the whole site.
// Idempotent: output depends only on data + SITE_HOST. No timestamps in output.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startPriceNumeric, startPriceText } from "./price-parse.mjs";
import { slugify } from "./slugify.mjs";
import { tierSavings, allSavings, firstYear } from "./savings.mjs";
import { rankByAvg, rankByReviews } from "./review-rank.mjs";
import { fmtDate, isStale } from "./freshness.mjs";
import { PRICES_VERIFIED_DATE, comparePageDate } from "./site-data.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOST = process.env.SITE_HOST || "staging.planprice.local";
const SITE_URL = `https://${HOST}`;
const CHECKED = PRICES_VERIFIED_DATE;

const data = JSON.parse(readFileSync(join(ROOT, "data", "products.json"), "utf8"));
const products = data.products;

/* ---- Third-party review scores (PP-REVIEW-SCORES) ----
 * data/review-scores.json: {checked: "YYYY-MM-DD", scores: {<slug>: {g2?: {score, reviews, url}, capterra?: {...}}}}.
 * A source object exists only when it was verified on a source page; a missing
 * product or missing source renders nothing (honest gap, never a guess). */
const reviewScores = JSON.parse(readFileSync(join(ROOT, "data", "review-scores.json"), "utf8"));

/* ---- Committed-only page content absorbed at PP-GEN-DRIFT (2026-11-10) ----
 * data/page-images.json: {"<page key>": ["<figure class=\"post-figure\">…</figure>", …]}
 * extracted verbatim from the committed (live) pages; figFor() returns the
 * page's figures glued the way the committed pages glue them (figure block
 * + two blank lines), or "" when the page has none.
 * data/page-extras.json: {"<page key>": "<section …>…</section>"} — the
 * hand-written guide/guidance sections the committed listing pages carry
 * (category buying-guidance, canadian/deals/free/compare/top-rated guides),
 * extracted verbatim; emitted at the committed position per page type. */
const pageImages = JSON.parse(readFileSync(join(ROOT, "data", "page-images.json"), "utf8"));
const pageExtras = JSON.parse(readFileSync(join(ROOT, "data", "page-extras.json"), "utf8"));
const figFor = (key) => {
  const figs = pageImages[key];
  return figs && figs.length ? figs.join("\n") + "\n\n" : "";
};
const extraFor = (key) => (pageExtras[key] ? "\n    " + pageExtras[key] : "");

/* data/compare-vendors.json: vendor-summary rows whose "start" field is the
 * committed deals-index price convention (see the deals-index writer). */
const compareVendors = new Map(
  JSON.parse(readFileSync(join(ROOT, "data", "compare-vendors.json"), "utf8")).map((e) => [e.slug, e])
);

/* ---- Head-to-head compare sets (PP-SECTIONS) ----
 * data/compare.json: {sets: [{slug, title, products}]}. Membership is
 * explicit and authorable; new products in products.json do NOT auto-join.
 * Build FAILS on: unknown product slug, cross-category set, duplicate or
 * non-kebab slug, wrong member count (2–4), or a title that is not the
 * mechanical " vs "-join of the product names (no editorial wording).
 * PP-GEN-DRIFT (2026-11-10): sets flagged "editorial": true are the 12
 * hand-written pair pages under compare/ (editorial H1s and prose, NOT
 * generated columns). They are validated and listed on the compare index
 * like the generated sets, but the generator NEVER writes their pages
 * (same treatment as the article guides, R4e) and they do not create
 * head-to-head links on deal/category pages. compareSets below holds only
 * the generated sets; allCompareSets holds all 15 for the index. */
const productBySlug = new Map(products.map((p) => [p.slug, p]));
const compareSets = [];
const allCompareSets = [];
{
  const cfg = JSON.parse(readFileSync(join(ROOT, "data", "compare.json"), "utf8"));
  const seen = new Set();
  for (const set of cfg.sets || []) {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(set.slug || ""))
      throw new Error(`compare.json: invalid set slug "${set.slug}"`);
    if (seen.has(set.slug))
      throw new Error(`compare.json: duplicate set slug "${set.slug}"`);
    seen.add(set.slug);
    const slugs = set.products || [];
    if (slugs.length < 2 || slugs.length > 4)
      throw new Error(`compare.json: set "${set.slug}" must list 2-4 products, got ${slugs.length}`);
    const members = slugs.map((s) => {
      const p = productBySlug.get(s);
      if (!p)
        throw new Error(`compare.json: set "${set.slug}" references unknown product slug "${s}"`);
      return p;
    });
    const cats = [...new Set(members.map((p) => p.category))];
    if (cats.length > 1)
      throw new Error(`compare.json: set "${set.slug}" spans categories: ${cats.join(", ")}`);
    const mechanicalTitle = members.map((p) => p.name).join(" vs ");
    if (set.title !== mechanicalTitle)
      throw new Error(
        `compare.json: set "${set.slug}" title is not the mechanical vs-join of product names`
      );
    const entry = {
      slug: set.slug,
      title: set.title,
      products: members,
      category: members[0].category,
      editorial: !!set.editorial,
    };
    allCompareSets.push(entry);
    if (!entry.editorial) compareSets.push(entry);
  }
}

// Compare set containing the product slug, or null for non-participants.
// Map built once at load (same pattern as productBySlug). Keep-first
// semantics match the old compareSets.find() on overlapping membership.
const setByProductSlug = new Map();
for (const s of compareSets)
  for (const p of s.products)
    if (!setByProductSlug.has(p.slug)) setByProductSlug.set(p.slug, s);
const setForSlug = (slug) => setByProductSlug.get(slug) || null;
// Distinct categories, sorted (used by category pages and the homepage chips).
const categories = [...new Set(products.map((p) => p.category))].sort();
// Compare sets whose members all belong to the category (banner lookup).
const setsForCategory = (cat) => compareSets.filter((s) => s.category === cat);

/* ---- Buyer's guides + glossary (PP-ADSENSE-READINESS) ----
 * data/guides.json: [{category (exact match of products[].category),
 * slug (kebab, MUST equal slugify(category)), title, meta_description,
 * intro[1-3 paragraphs], sections[{h2, body[1-4 paragraphs]}],
 * checklist[4-8 items], updated: "YYYY-MM-DD"}]. Copy is original prose
 * written by the content-creator (verified, never invented by the
 * developer) — the generator only validates and renders it.
 * data/glossary.json: [{term, slug (kebab-case), definition (1-2
 * sentences), why_it_matters (1 paragraph, pricing-comparison angle),
 * related_slugs[] (product slugs from products.json, may be empty)}].
 * Build FAILS on: unknown category, slug != slugify(category), duplicate
 * slugs, empty intro/section body, short checklist, invalid term slug,
 * unknown related_slug. A renamed category or product slug must break the
 * build, not ship a dead link. */
const guidesData = JSON.parse(readFileSync(join(ROOT, "data", "guides.json"), "utf8"));
const glossaryData = JSON.parse(readFileSync(join(ROOT, "data", "glossary.json"), "utf8"));
const guideBySlug = new Map();
const termBySlug = new Map();
{
  const categorySet = new Set(products.map((p) => p.category));
  for (const g of guidesData) {
    if (!categorySet.has(g.category))
      throw new Error(`guides.json: unknown category "${g.category}"`);
    if (g.slug !== slugify(g.category))
      throw new Error(`guides.json: slug "${g.slug}" != slugify("${g.category}")`);
    if (guideBySlug.has(g.slug))
      throw new Error(`guides.json: duplicate guide slug "${g.slug}"`);
    if (!Array.isArray(g.intro) || !g.intro.length)
      throw new Error(`guides.json: guide "${g.slug}" has empty intro`);
    for (const s of g.sections || []) {
      if (!Array.isArray(s.body) || !s.body.length)
        throw new Error(`guides.json: guide "${g.slug}" section "${s.h2}" has empty body`);
    }
    if (!Array.isArray(g.checklist) || g.checklist.length < 4)
      throw new Error(`guides.json: guide "${g.slug}" checklist needs 4+ items`);
    guideBySlug.set(g.slug, g);
  }
  for (const t of glossaryData) {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(t.slug || ""))
      throw new Error(`glossary.json: invalid term slug "${t.slug}"`);
    if (termBySlug.has(t.slug))
      throw new Error(`glossary.json: duplicate term slug "${t.slug}"`);
    for (const s of t.related_slugs || []) {
      if (!productBySlug.has(s))
        throw new Error(`glossary.json: term "${t.slug}" references unknown product slug "${s}"`);
    }
    termBySlug.set(t.slug, t);
  }
}

/* ---- Affiliate state (PP-AFFILIATE-CLARITY) ----
 * affiliateLive(p) is true only when a product's affiliate status is "live".
 * Until programs are approved every product is "pending-approval", and the
 * site renders the INTERIM disclosure wording: no affiliate links exist yet,
 * deal-page CTAs are plain outbound vendor links, and no commissions are being earned.
 * The moment a product flips to "live", its deal page gets the blunt live
 * disclosure plus a real affiliate link. */
const affiliateLive = (p) => !!(p.affiliate && p.affiliate.status === "live");
const affiliateNone = (p) => !!(p.affiliate && p.affiliate.status === "none");
const anyAffiliateLive = products.some(affiliateLive);

const AFFILIATE_BLUNT =
  "The product links on PlanPrice are affiliate links: if you buy through them, we may earn a commission at no extra cost to you.";
const AFFILIATE_INTERIM =
  "PlanPrice is funded by affiliate commissions. Right now our affiliate partnerships are still being set up, so the links on this site are plain links to vendors, when affiliate links go live, this page will say so, and buying through them will never cost you extra.";

/* ---- Freshness flags (PP-PRICE-DROP-FLAGS) ----
 * Diff current prices/deals against the most recent monthly sweep snapshot
 * strictly BEFORE the current CHECKED month. The first-ever snapshot is the
 * baseline: with no prior sweep there is nothing to diff, so no flags
 * render — an honest "no flags" beats invented ones. */
function loadPriorSweep() {
  const dir = join(ROOT, "data", "sweeps");
  if (!existsSync(dir)) return null;
  const curMonth = CHECKED.slice(0, 7); // "2026-09"
  const files = readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}\.json$/.test(f) && f.slice(0, 7) < curMonth)
    .sort();
  if (!files.length) return null;
  return JSON.parse(readFileSync(join(dir, files[files.length - 1]), "utf8"));
}

const priorSweep = loadPriorSweep();

/* ---- Price history (PP-GEN-DRIFT) ----
 * Every deal page carries a Price history table built from ALL sweep files
 * in data/sweeps/ whose sweep_date is on or before the site CHECKED date
 * (the 2026-11-02 snapshot postdates the 2026-10-25 verification date and,
 * per the site-data registry note, is a carried-forward snapshot, not a
 * verification sweep — including it would fabricate a 2026-11-02 check).
 * Rows sorted by sweep date; a product absent from a sweep gets no row. */
const allSweeps = (() => {
  const dir = join(ROOT, "data", "sweeps");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")))
    .filter((s) => s.sweep_date && s.sweep_date <= CHECKED)
    .sort((a, b) => (a.sweep_date < b.sweep_date ? -1 : 1));
})();

// slug -> sweep rows, built once (priceHistorySection looks up, never rescans).
const sweepRowsBySlug = (() => {
  const map = new Map();
  for (const s of allSweeps) {
    for (const e of s.products || []) {
      if (!map.has(e.slug)) map.set(e.slug, []);
      map.get(e.slug).push({ date: s.sweep_date, start_price_text: e.start_price_text, deal_headline: e.deal_headline });
    }
  }
  return map;
})();

function priceHistorySection(p, batch = false) {
  const rows = (sweepRowsBySlug.get(p.slug) || []).map((e) => `<tr>
      <th scope="row">${esc(e.date)}</th>
      <td>${esc(e.start_price_text)}</td>
      <td>${esc(e.deal_headline || "No public promo")}</td>
    </tr>`);
  if (!rows.length) return "";
  return `<section class="section price-history">
      <h2>Price history</h2>
      <p>What our verification snapshots recorded for ${esc(p.name)}. Snapshots are periodic checks, not a continuous feed, a change between two dates happened somewhere in between.</p>
      <div class="table-scroll">
      <table class="tiers">
        <caption>${esc(p.name)}. PlanPrice verification snapshots.</caption>
        <thead><tr><th scope="col">Checked</th><th scope="col">Starting price</th><th scope="col">Promo recorded</th></tr></thead>
        <tbody>${rows.join("\n")}
</tbody>
      </table>
      </div>${batch ? "\n      <p class=\"fine\">First PlanPrice snapshot for this vendor, future verification sweeps will add points here.</p>" : p.history_stable_fine ? "\n      <p class=\"fine\">No price changes recorded since Sep 2026, the starting price and promo status above have been stable across every snapshot we hold.</p>" : ""}
    </section>`;
}
const priceFlags = {}; // slug -> array of "price-drop" | "new-deal"
if (!priorSweep) {
  console.log(
    `Price-drop flags: no sweep snapshot before ${CHECKED.slice(0, 7)} — no flags rendered (first snapshot is the baseline).`
  );
} else {
  const prev = new Map(priorSweep.products.map((s) => [s.slug, s]));
  let flagged = 0;
  for (const p of products) {
    const s = prev.get(p.slug);
    if (!s) continue;
    const f = [];
    const curNum = startPriceNumeric(p);
    if (
      typeof curNum === "number" &&
      typeof s.start_price_numeric === "number" &&
      curNum < s.start_price_numeric
    )
      f.push("price-drop");
    const curDeal = p.deal ? p.deal.headline : null;
    if (
      (s.deal_headline == null && curDeal != null) ||
      (s.deal_headline != null && curDeal != null && s.deal_headline !== curDeal)
    )
      f.push("new-deal");
    if (f.length) {
      priceFlags[p.slug] = f;
      flagged++;
    }
  }
  console.log(`Price-drop flags: ${flagged} product(s) flagged against ${priorSweep.sweep_month} sweep.`);
}

// Optional display fields (defaults per brief §5); all other fields are
// read exactly as stored in products.json — never invented.
const sortPriority = (p) => (typeof p.sort_priority === "number" ? p.sort_priority : 999);

// A deal is expired when a real vendor-sourced end date exists in the data
// AND it is earlier than the check date. No end_date → not expired (nothing
// is invented; this renders nothing today).
const isExpiredDeal = (p) =>
  !!(p.deal && p.deal.end_date && p.deal.end_date < CHECKED);

// Deals that are live right now: non-null and not expired.
const liveDeals = (ps) => ps.filter((p) => p.deal && !isExpiredDeal(p));

/* ---- Vendor reviews (PP-VENDOR-REVIEWS) ----
 * Optional per-product `reviews` object in products.json: {strengths, weaknesses}.
 * Rendered as a "What users report" section on deal pages only when present
 * and non-empty. Kept off the compare table (stays scannable). */
const hasReviews = (p) =>
  !!(
    p.reviews &&
    ((p.reviews.strengths || []).length || (p.reviews.weaknesses || []).length)
  );

function reviewsSection(p) {
  if (!hasReviews(p)) return "";
  const list = (items) =>
    items.map((x) => `      <li>${esc(x)}</li>`).join("\n");
  const strengths = p.reviews.strengths || [];
  const weaknesses = p.reviews.weaknesses || [];
  return `<section class="section reviews">
      <h2>What users report</h2>
      ${strengths.length ? `<h3>Commonly praised</h3>\n      <ul class="review-list pros">\n${list(strengths)}\n      </ul>` : ""}
      ${weaknesses.length ? `<h3>Commonly criticized</h3>\n      <ul class="review-list cons">\n${list(weaknesses)}\n      </ul>` : ""}
      <p class="fine">Summarized from user reviews on G2 and Capterra; not a PlanPrice rating.</p>
    </section>`;
}

/* ---- Review scores (PP-REVIEW-SCORES) ----
 * Per-product third-party aggregate ratings in data/review-scores.json.
 * Rendered as a "Review scores" section on deal pages only when the product
 * has at least one verified source. Each source line shows the score, the
 * review count (when known), and links to the source's review page.
 * Kept off the compare table and directory rows (stays scannable), like
 * reviewsSection. Everything from the data file goes through esc(). */
function scoreSection(p) {
  const entry = reviewScores.scores[p.slug];
  if (!entry) return "";
  const sources = [
    ["G2", entry.g2],
    ["Capterra", entry.capterra],
  ].filter(([, s]) => s && typeof s.score === "number" && typeof s.url === "string");
  if (!sources.length) return "";
  const reviewsText = (n) =>
    typeof n === "number" ? ` (${n.toLocaleString("en-US")} reviews)` : "";
  const lis = sources
    .map(
      ([label, s]) =>
        `      <li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(label)}</a>: <strong>${esc(String(s.score))}/5</strong>${esc(reviewsText(s.reviews))}</li>`
    )
    .join("\n");
  return `<section class="section scores">
      <h2>Review scores</h2>
      <ul class="score-list">
${lis}
      </ul>
      <p class="fine">Scores are aggregate user ratings from third-party review sites, checked ${esc(reviewScores.checked)}. They are not PlanPrice ratings.</p>
    </section>`;
}

/* ---- Canadian vendors (PP-CANADIAN-VENDORS) ----
 * Optional per-product `canadian` object: {founded?, founded_place, hq}.
 * The framing is about the VENDOR being Canadian, never "for Canadian customers".
 * Full sentence on deal pages; a small badge on directory rows. Kept off the
 * compare table (stays scannable). */
function canadianLine(p) {
  if (!p.canadian) return "";
  const c = p.canadian;
  const founded = c.founded
    ? `founded in ${esc(c.founded_place)} (${esc(c.founded)})`
    : `founded in ${esc(c.founded_place)}`;
  return `<p class="canadian-note">🇨🇦 Canadian company, ${founded}, headquartered in ${esc(c.hq)}.</p>`;
}

function canadianBadge(p) {
  if (!p.canadian) return "";
  return ` <span class="badge canadian">🇨🇦 Canadian company</span>`;
}

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// Starting-price line: "From $X per month" — or plain "Custom quote" for
// quote-based pricing (no "From $").
// PP-SERP-DESC-PAGES (2026-10-11): guard for products with no pricing_tiers
// (6 new-vendor products added 2026-10-09 lack tiers) — previously the
// generator CRASHED on these and the committed pages shipped a broken
// "From " with no price. Honest "Pricing on request" instead of a guess.
// Price display modes for fromPrice(): STANDARD is the full line, PAREN keeps
// the compare-vendors parenthetical, AMOUNT shows the amount alone with a
// trailing space (the batch generation's related-row convention).
const PRICE_MODE = { STANDARD: false, PAREN: "paren", AMOUNT: "amount" };

function fromPrice(p, strong = true, mode = PRICE_MODE.STANDARD) {
  // PP-GEN-DRIFT: the committed site derives the starting-price line from
  // data/compare-vendors.json "start" (paren suffix stripped, amount bolded)
  // wherever a CV entry exists — that convention, not the pricing_tiers
  // cadence text, is what the committed facts strips and directory rows
  // show (e.g. Wave "From $0 free", Sage 50 "From C$916 per year").
  const cvEntry = compareVendors.get(p.slug);
  if (cvEntry && typeof cvEntry.start === "string") {
    const start = mode === PRICE_MODE.PAREN ? cvEntry.start : cvEntry.start.replace(/\s*\(.*?\)\s*$/, "");
    const m = start.match(/^(C?\$[\d,.]+(?:\s*\+\s*\S+)?|[\d.]+%(?:\s*\+\s*\S+)?)/);
    if (m) {
      // Batch-template related rows show the amount alone plus a trailing
      // space ("From $139.95 ") — a distinct convention of that generation.
      // PP-PRICE-DISPLAY still applies to flag amounts (a % rate or $0 is
      // THE price, not a floor): those rows drop the "From" too.
      if (mode === PRICE_MODE.AMOUNT) {
        const restAmt = start.slice(m[0].length);
        const isFlagAmt = /^[\d.]+%/.test(m[0]) || /^C?\$0(?:\.00)?$/.test(m[0]) || /free/i.test(restAmt);
        return isFlagAmt ? `<strong>${esc(m[0])}</strong> ` : `From <strong>${esc(m[0])}</strong> `;
      }
      const price = strong ? `<strong>${esc(m[0])}</strong>` : esc(m[0]);
      // PP-PRICE-DISPLAY: "From" reads wrong on single/flag values — a $0
      // or free starting price and a transaction rate are THE price, not a
      // range floor. Drop the prefix for those; keep it for tiered prices.
      const rest = start.slice(m[0].length);
      const isFlag = /^[\d.]+%/.test(m[0]) || /^C?\$0(?:\.00)?$/.test(m[0]) || /free/i.test(rest);
      return isFlag ? `${price}${esc(rest)}` : `From ${price}${esc(rest)}`;
    }
    if (mode === PRICE_MODE.AMOUNT) {
      const w = start.match(/^[A-Za-z]+/);
      if (w) return `From <strong>${esc(w[0])}</strong> `;
    }
  }
  if (!p.pricing_tiers || !p.pricing_tiers.length) return "Pricing on request";
  const t = p.pricing_tiers[0];
  if (t.cadence === "quote") return esc(t.price);
  const price = strong ? `<strong>${esc(t.price)}</strong>` : esc(t.price);
  // PP-PRICE-DISPLAY: same flag rule on the tier-derived line.
  if (t.cadence === "free" || /^C?\$0(?:\.00)?$/.test(t.price)) return `${price} ${esc(t.cadence)}`;
  return `From ${price} ${esc(t.cadence)}`;
}

// Short badge used inline in rows and at the top of deal pages.
function dealBadge(p) {
  if (p.deal && !isExpiredDeal(p)) {
    return `<span class="badge deal">${esc(p.deal.headline.split("(")[0].trim())}</span>`;
  }
  return `<span class="badge none">No current promo</span>`;
}

function vendorHost(url) {
  return esc(new URL(url).hostname);
}

// ---------------------------------------------------------------------------
// Homepage blocks
// ---------------------------------------------------------------------------

/* Price/freshness flag badges (PP-PRICE-DROP-FLAGS). Rendered only when the
 * sweep diff actually produced a flag for the slug — never invented. */
function flagBadges(p) {
  const flags = priceFlags[p.slug] || [];
  return flags
    .map((f) =>
      f === "price-drop"
        ? `<span class="badge flag">Price dropped since last check</span>`
        : `<span class="badge flag">New deal</span>`
    )
    .join(" ");
}

function dirRow(p, priceFn = null) {
  const live = p.deal && !isExpiredDeal(p);
  const flags = flagBadges(p);
  return `<li class="dir-row${live ? " has-deal" : ""}" data-slug="${esc(p.slug)}">
    <div class="dir-row-main">
      <h3 class="dir-row-name"><a href="/deals/${esc(p.slug)}.html">${esc(p.name)}</a></h3>
      <p class="dir-row-tag">${esc(p.tagline)}</p>
      <p class="dir-row-best"><strong>Best for:</strong> ${esc(p.best_for)}</p>
    </div>
    <div class="dir-row-side">
      <p class="dir-row-price">${priceFn ? priceFn(p) : fromPrice(p)}</p>
      <p class="dir-row-badge">${dealBadge(p)}${flags ? " " + flags : ""}${canadianBadge(p)} <span class="verified-pill">✓ Verified ${esc(p.last_verified)}</span></p>
    </div>
  </li>`;
}

/* ---- Deal filter UI (PP-DEAL-FILTER) ----
 * Progressive enhancement only: the form ships with `hidden` so no-JS
 * visitors (and crawlers) see the full static list untouched. filter.js
 * fetches /data/deals-index.json, reveals the form, and shows/hides/reorders
 * rows — it never adds deal content. All deal content stays in the static
 * HTML for SEO; the JSON index just makes rows addressable by slug.
 *
 * The filter.js facets are declarative: to add a new facet (e.g. a
 * "Canadian only" toggle), add the control's markup below and one entry in
 * its FACETS array — the UI structure doesn't need rebuilding. */
/* Category pages (PP-SECTIONS) pass includeCategory=false: a single-category
 * page ships no #f-category control, and filter.js skips the missing facet
 * instead of throwing (fail-safe rule).
 * Phase 2 (PP-SECTIONS-PHASE2) adds the `facets` option: {dealsOnly, canadian}
 * booleans toggle the Deals-only and Canadian-only checkboxes, for pages
 * where a facet would be vacuous (e.g. every row on /deals.html is a deal). */
/* filterForm() is the bare filter form (no wrapper). The 11 filter pages
 * (9 category pages, /deals.html, /canadian.html) drop it directly into
 * their own <div class="wrap"> so it is never double-wrapped. */
function filterForm(includeCategory = true, facets = {}) {
  const showDealsOnly = facets.dealsOnly !== false;
  const showCanadian = facets.canadian !== false;
  let catField = "";
  if (includeCategory) {
    const cats = categories;
    const opts = [`<option value="all">All categories</option>`]
      .concat(cats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`))
      .join("\n          ");
    catField = `<label class="filter-field">Category
          <select id="f-category" name="category">
          ${opts}
          </select>
        </label>\n        `;
  }
  const dealsField = showDealsOnly
    ? `<label class="filter-check"><input type="checkbox" id="f-deals" name="deals-only"> Deals only</label>\n        `
    : "";
  const canadianField = showCanadian
    ? `<label class="filter-check"><input type="checkbox" id="f-canadian" name="canadian-only"> 🇨🇦 Canadian only</label>\n        `
    : "";
  return `<form class="filter-ui" id="deal-filter" hidden aria-label="Filter and sort deals">
      <div class="filter-controls">
        ${catField}${dealsField}${canadianField}<label class="filter-field">Sort by
          <select id="f-sort" name="sort">
            <option value="featured">Featured</option>
            <option value="price-asc">Price: low to high</option>
            <option value="name-asc">Name A, Z</option>
          </select>
        </label>
      </div>
      <p class="filter-count" id="f-count" aria-live="polite"></p>
    </form>`;
}

function indexPage() {
  // PP-GEN-DRIFT (R5): the committed 2026-10-11 homepage restructure is the
  // template (hero, featured-deal editorial cards, tools grid, guide list,
  // category chips, how-we-verify, page-local <style>, and its own header
  // nav). Dynamic slots only: product count in the meta description, the
  // live-deal count in the hero CTA and trust strip, the registry CHECKED
  // date, the hero figure (page-images.json), and the category chips with
  // computed counts. Featured cards are editorial picks and stay static.
  const homeChips = categories
    .map((c) => `        <li><a href="/categories/${slugify(c)}.html">${esc(c)} (${products.filter((p) => p.category === c).length})</a></li>`)
    .join("\n");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>PlanPrice | Verified B2B Software Deals &amp; Pricing</title>
<meta name="description" content="PlanPrice tracks verified list prices and promotions for ${products.length} essential B2B software products. Every deal is checked against the vendor's own site.">
<link rel="canonical" href="${SITE_URL}/">
<!-- Open Graph / Twitter cards (PP-OG-IMAGE, 2026-10-04) -->
<meta property="og:type" content="website">
<meta property="og:site_name" content="PlanPrice">
<meta property="og:title" content="PlanPrice | Verified B2B Software Deals &amp; Pricing">
<meta property="og:description" content="PlanPrice tracks verified list prices and promotions for ${products.length} essential B2B software products. Every deal is checked against the vendor's own site.">
<meta property="og:url" content="${SITE_URL}/">
<meta property="og:image" content="${SITE_URL}/og-image.jpg">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="PlanPrice | Verified B2B Software Deals &amp; Pricing">
<meta name="twitter:description" content="PlanPrice tracks verified list prices and promotions for ${products.length} essential B2B software products. Every deal is checked against the vendor's own site.">
<meta name="twitter:image" content="${SITE_URL}/og-image.jpg">
<link rel="stylesheet" href="/style.css">
<link rel="icon" type="image/png" href="/favicon.png">
<!-- AdSense account verification (Joseph's AdSense signup, 2026-10-01).
     Publisher ID is public by design — AdSense requires it in page source.
     Ad units and ads.txt only AFTER Google approves the account. -->
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-9041438524909240"
     crossorigin="anonymous"></script>
<meta name='impact-site-verification' value='d3933dd0-8d52-4dd7-b099-5f505aec37fa'>
<script src="/filter.js" defer></script>
<!-- Cloudflare Web Analytics --><script type='module' src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "${CF_BEACON_TOKEN}"}'></script><!-- End Cloudflare Web Analytics -->
<style>
/* Homepage-only section styles (2026-10-11 restructure). Page-local: nothing
   here touches style.css or other pages. */
.tools-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; margin: 18px 0; }
.tool-card { display: block; border: 1px solid var(--line, #e9dfc9); border-radius: 12px; padding: 16px; background: #fffdf8; }
.tool-card h3 { margin: 0 0 6px; font-size: 1.05rem; }
.tool-card p { margin: 0 0 10px; font-size: 0.95rem; }
.guide-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; margin: 18px 0; list-style: none; padding: 0; }
.guide-list li { border: 1px solid var(--line, #e9dfc9); border-radius: 10px; padding: 12px 14px; background: #fff; }
.guide-list a { font-weight: 700; }
.guide-list p { margin: 6px 0 0; font-size: 0.92rem; }
.cat-chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0 4px; list-style: none; padding: 0; }
.cat-chips a { display: inline-block; padding: 8px 14px; border: 1px solid var(--line, #e9dfc9); border-radius: 999px; background: #fff; text-decoration: none; font-size: 0.92rem; }
.cat-chips a:hover { border-color: #166534; }

.hero-ctas { display: flex; gap: 12px; flex-wrap: wrap; margin: 20px 0 6px; }
.btn-secondary { background: transparent; color: #166534; border: 2px solid #166534; }
.btn-secondary:hover { background: #166534; color: #fff; }
.hero .post-figure img { max-height: 420px; object-fit: cover; width: 100%; }
.featured-deals { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin: 18px 0 4px; }
.featured-deal { border: 1px solid var(--line, #e9dfc9); border-radius: 12px; padding: 18px; background: #fffdf8; }
.featured-deal h3 { margin: 0 0 6px; font-size: 1.15rem; }
.featured-deal .src { font-size: .85rem; color: #6b6252; }
@media (max-width: 700px) { .featured-deals { grid-template-columns: 1fr; } }
.tool-card { transition: border-color .18s ease, transform .18s ease; }
.tool-card:hover { border-color: #166534; transform: translateY(-3px); }
.tool-icon { font-size: 1.6rem; line-height: 1.3; }
.guide-list li { transition: border-color .18s ease; }
.guide-list li:hover { border-color: #166534; }
.verify-strip-list { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
.verify-strip-list li { font-size: .93rem; }
@media (max-width: 700px) { .verify-strip-list { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<div class="disclosure-bar">PlanPrice is setting up affiliate partnerships, right now, links on this page are plain vendor links. <a href="/disclosure.html">Read our affiliate disclosure</a>.</div>
<header class="site-header">
  <div class="wrap header-inner">
    <a class="brand" href="/"><img src="/logo.svg" alt="PlanPrice" height="34"></a>
    <nav class="main-nav">
      <a href="/deals.html" class="active">Deals</a>
      <a href="/canadian.html">Canadian</a>
      <a href="/free.html">Free</a>
      <a href="/top-rated.html">Top rated</a>
      <a href="/compare.html">Compare</a>
      <a href="/guides.html">Guides</a>
      <a href="/marketing.html">Marketing</a>
      <a href="/glossary.html">Glossary</a>
      <a href="/tools.html">Tools</a>
      <a href="/calculators.html">Calculators</a>
      <a href="/about.html">About</a>
    </nav>
  </div>
</header>
<section class="hero">
  <div class="wrap">
    <p class="kicker">Verified pricing · Checked ${CHECKED}</p>
    <h1>B2B software deals, with the receipts.</h1>
    <p class="lead">Real list prices and current promotions, every deal claim links to the vendor's own page so you can check it yourself.</p>
    <div class="hero-ctas"><a class="btn" href="/deals.html">Browse ${liveDeals(products).length} verified deals</a><a class="btn btn-secondary" href="/tools/deal-verifier.html">Verify a deal free</a></div>${figFor("index").trim()}


  </div>
</section>
<div class="trust-strip">
  <div class="wrap trust-strip-inner">
    <span class="trust-stat"><strong>${products.length}</strong> products tracked</span>
    <span class="trust-dot" aria-hidden="true">·</span>
    <span class="trust-stat"><strong>${liveDeals(products).length}</strong> live deals</span>
    <span class="trust-dot" aria-hidden="true">·</span>
    <span class="trust-stat">Promos re-verified <time datetime="${CHECKED}">${CHECKED}</time></span>
  </div>
</div>
<main>
    <section class="section featured" aria-label="Featured deals">
    <div class="wrap">
      <h2 class="section-title">Featured deals</h2>
      <p class="section-sub">Live promotions we've confirmed on the vendor's own site. <a href="/deals.html">See all current promos</a>.</p>
      <div class="featured-deals">
        <div class="featured-deal">
          <p class="kicker">Deal spotlight</p>
          <h3><a href="/deals/freshbooks.html">FreshBooks</a></h3>
          <p><strong>80% off for 4 months</strong> for new subscribers</p>
          <p>Simple invoicing and accounting built for Canadian freelancers and small teams.</p>
          <p class="src">✓ Vendor-verified <time datetime="2026-10-25">2026-10-25</time>, source: <a href="https://www.freshbooks.com/en-ca/pricing" target="_blank" rel="noopener">www.freshbooks.com</a>.</p>
          <p><a class="btn" href="/deals/freshbooks.html">See pricing &amp; deal</a></p>
        </div>
        <div class="featured-deal">
          <p class="kicker">Verified promo</p>
          <h3><a href="/deals/quickbooks.html">QuickBooks Online</a></h3>
          <p><strong>90% off</strong> for new subscribers (Lite C$2/mo, list C$20)</p>
          <p>The accounting suite most Canadian accountants already know.</p>
          <p class="src">✓ Vendor-verified <time datetime="2026-10-25">2026-10-25</time>, details on the deal page.</p>
          <p><a class="btn" href="/deals/quickbooks.html">See pricing &amp; deal</a></p>
        </div>
        <div class="featured-deal">
          <p class="kicker">New promo</p>
          <h3><a href="/deals/xero.html">Xero</a></h3>
          <p><strong>80% off your first 3 months</strong> for new customers</p>
          <p>Cloud accounting with unlimited users on every plan.</p>
          <p class="src">✓ Vendor-verified <time datetime="2026-10-25">2026-10-25</time>, source: <a href="https://www.xero.com/ca/pricing-plans" target="_blank" rel="noopener">www.xero.com</a>.</p>
          <p><a class="btn" href="/deals/xero.html">See pricing &amp; deal</a></p>
        </div>
        <div class="featured-deal">
          <p class="kicker">New promo</p>
          <h3><a href="/deals/shopify.html">Shopify</a></h3>
          <p><strong>$1/month for 3 months</strong> for new merchants (Basic, Grow and Advanced)</p>
          <p>The default storefront platform for selling online.</p>
          <p class="src">✓ Vendor-verified <time datetime="2026-10-25">2026-10-25</time>, source: <a href="https://www.shopify.com" target="_blank" rel="noopener">www.shopify.com</a>.</p>
          <p><a class="btn" href="/deals/shopify.html">See pricing &amp; deal</a></p>
        </div>
        <div class="featured-deal">
          <p class="kicker">New promo</p>
          <h3><a href="/deals/mailchimp.html">Mailchimp</a></h3>
          <p><strong>15% off your first 12 months</strong> (accounts with 10,000+ contacts)</p>
          <p>Email and SMS marketing for growing lists.</p>
          <p class="src">✓ Vendor-verified <time datetime="2026-10-25">2026-10-25</time>, source: <a href="https://mailchimp.com" target="_blank" rel="noopener">mailchimp.com</a>.</p>
          <p><a class="btn" href="/deals/mailchimp.html">See pricing &amp; deal</a></p>
        </div>

      </div>
    </div>
  </section>
  <section class="section tools-feature" aria-label="Free pricing tools">
    <div class="wrap">
      <h2 class="section-title">Free pricing tools</h2>
      <p class="section-sub">Free interactive tools built on our verified pricing data, plus twenty small business calculators. No sign-up, everything runs in your browser. <a href="/tools.html">See all tools</a>.</p>
      <div class="tools-grid">
        <div class="tool-card">
          <div class="tool-icon" aria-hidden="true">🔍</div>
          <h3><a href="/tools/deal-verifier.html">Deal Verifier</a></h3>
          <p>A vendor claims "50% off"? See the real percentage off, the true annual cost, and red flags, checked against verified list prices.</p>
        </div>
        <div class="tool-card">
          <div class="tool-icon" aria-hidden="true">📈</div>
          <h3><a href="/tools/renewal-hike-checker.html">Renewal Hike Checker</a></h3>
          <p>Your renewal went up. Enter last year's and this year's totals for the real percentage change and a plain-English read.</p>
        </div>
        <div class="tool-card">
          <div class="tool-icon" aria-hidden="true">🧾</div>
          <h3><a href="/tools/fee-decoder.html">Fee Decoder</a></h3>
          <p>Paste pricing-page fine print; get hidden-cost phrases highlighted with plain-English explainers. Private by design.</p>
        </div>
        <div class="tool-card">
          <div class="tool-icon" aria-hidden="true">🧱</div>
          <h3><a href="/tools/stack-budget-builder.html">Stack Budget Builder</a></h3>
          <p>Pick one product per category and watch your whole software stack's monthly and annual cost add up.</p>
        </div>
        <div class="tool-card">
          <div class="tool-icon" aria-hidden="true">🎯</div>
          <h3><a href="/tools/tier-finder.html">Tier Finder</a></h3>
          <p>Six questions, one honest answer: free, starter, or professional tier, with the reasoning shown.</p>
        </div>
        <div class="tool-card">
          <div class="tool-icon" aria-hidden="true">🧮</div>
          <h3><a href="/tools/true-cost-calculator.html">True Cost Calculator</a></h3>
          <p>Compare per-seat vs flat-rate pricing for your team size, with CAD conversion and year-two projections.</p>
        </div>
        <div class="tool-card">
          <div class="tool-icon" aria-hidden="true">📊</div>
          <h3><a href="/calculators.html">Small Business Calculators</a></h3>
          <p>Twenty free calculators beyond software pricing: break-even, Canadian payroll cost, HST/GST, freelance rates, CAC, LTV, runway, and more.</p>
        </div>
      </div>
    </div>
  </section>
  <section class="section home-guides" aria-label="Buying guides">
    <div class="wrap">
      <h2 class="section-title">Buying guides</h2>
      <p class="section-sub">The playbooks behind the tools, how to negotiate, when vendors discount, and where the hidden fees live. <a href="/guides.html">All 150 guides</a>.</p>
      <ul class="guide-list">
        <li><a href="/guides/negotiate-saas-renewal.html">How to Negotiate Your SaaS Renewal (and What Discounts to Ask For)</a><p>When to start, what to ask for, and realistic discount ranges for Canadian small businesses.</p></li>
        <li><a href="/guides/stack-saas-discounts.html">How to Stack SaaS Discounts Without Breaking Terms</a><p>Which discounts legitimately combine: annual billing, promo codes, nonprofit pricing, referral credits.</p></li>
        <li><a href="/guides/saas-discount-calendar.html">When SaaS Actually Goes on Sale: A Deal-Timing Guide</a><p>Black Friday season, fiscal year-end, new year, back-to-school, the vendor discount calendar.</p></li>
        <li><a href="/guides/annual-vs-monthly-math.html">Annual vs Monthly Billing: The Prepay Math for Small Businesses</a><p>Break-even months, effective discount rates, and the cash-flow trade-off of paying annually.</p></li>
        <li><a href="/guides/hidden-payment-fees.html">Hidden Fees in Payment Processing (What Canadian Businesses Actually Pay)</a><p>Beyond the headline rate: the fees that inflate what Canadian businesses actually pay.</p></li>
        <li><a href="/guides/per-seat-vs-flat-pricing.html">Per-Seat vs Flat-Rate Pricing: Which Actually Costs Less?</a><p>Real math on per-seat, flat-rate, and usage-based pricing, and the crossover point.</p></li>
      </ul>
    </div>
  </section>
    <section class="section browse" aria-label="Browse by category">
    <div class="wrap">
      <h2 class="section-title">Browse by category</h2>
      <p class="section-sub">${products.length} products across ${categories.length} categories. <a href="/deals.html">See all ${products.length} products on Deals →</a></p>
      <ul class="cat-chips">
${homeChips}
      </ul>
    </div>
  </section>
  <section class="verify-steps section">
  <div class="wrap">
    <h2 class="section-title">How we verify</h2>
    <ol class="verify-steps-list verify-strip-list">
      <li><strong>Check the vendor's own pricing page.</strong> We read current list prices straight from the vendor's public pricing page, not a review, not an aggregator.</li>
      <li><strong>Link every deal claim.</strong> When a vendor runs a public promotion, the headline links to the vendor's own page so you can confirm the offer yourself.</li>
      <li><strong>Re-check on a schedule.</strong> Every product's prices and promos are re-verified regularly, and each page shows the date it was last checked.</li>
    </ol>
  </div>
</section>
  
</main>
<footer class="site-footer">
  <div class="wrap">
    <p class="ai-disclosure">Built with <a href="https://muse.ai/join">Muse</a>.</p>
    <p class="footer-brand">PlanPrice, verified B2B software pricing and deals.</p>
    <nav class="footer-nav">
      <a href="/about.html">About</a>
      <a href="/contact.html">Contact</a>
      <a href="/guides.html">Guides</a>
      <a href="/glossary.html">Glossary</a>
      <a href="/verified.html">Verification log</a>
      <a href="/disclosure.html">Affiliate disclosure</a>
      <a href="/privacy-policy.html">Privacy</a>
      <a href="/terms.html">Terms</a>
    </nav>
    <p class="fine">Prices verified 2026-10-25 by the PlanPrice research team. Always confirm current pricing on the vendor's own site before buying. PlanPrice currently earns no affiliate commissions, partnerships are still being set up.</p>
  </div>
</footer>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Deal pages
// ---------------------------------------------------------------------------

/* F3 verification-freshness (PP-OVERNIGHT-5): the Verified row renders the
 * product's last_verified as an absolute date ("Sep 30, 2026" — idempotent,
 * never "days ago"). The optional `extra` slot lets compare pages append
 * the F5 first-year-cost item without touching deal pages. */
function factsStrip(p, extra = "", batch = false) {
  const promo = p.deal && !isExpiredDeal(p)
    ? `<span class="badge deal">${esc(p.deal.headline)}</span>`
    : "No public promo, standard list prices";
  const flags = flagBadges(p);
  const expiry = p.deal && p.deal.end_date
    ? `<div class="facts-item"><dt>Offer ends</dt><dd><time datetime="${esc(p.deal.end_date)}">${esc(p.deal.end_date)}</time></dd></div>`
    : "";
  return `<dl class="facts-strip">
    <div class="facts-item"><dt>Starting price</dt><dd>${fromPrice(p, true, p.hand_built ? PRICE_MODE.PAREN : PRICE_MODE.STANDARD)}</dd></div>
    <div class="facts-item"><dt>Current promo</dt><dd>${promo}${flags ? " " + flags : ""}</dd></div>
    <div class="facts-item"><dt>Category</dt><dd>${esc(p.category)}</dd></div>
    <div class="facts-item"><dt>Verified</dt><dd>Prices verified <time datetime="${esc(p.last_verified)}">${esc(fmtDate(p.last_verified))}</time></dd></div>
    <div class="facts-item"><dt>Vendor</dt><dd><a href="${esc(p.vendor_homepage)}" target="_blank" rel="noopener">${vendorHost(p.vendor_homepage)}</a></dd></div>${expiry || extra ? `
    ${expiry}${extra}
  </dl>` : batch ? `
  </dl>` : `
    
  </dl>`}`;
}

/* F3: "Deal verified <date>" for deals with a verified_date; when the deal
 * is more than 45 days older than the build CHECKED date, a staleness badge
 * renders instead of silent trust. isStale() is pure (freshness.mjs) so the
 * comparator is unit-testable. */
function dealVerifiedLine(p) {
  if (!(p.deal && p.deal.verified_date)) return "";
  const vd = p.deal.verified_date;
  const badge = isStale(vd, CHECKED)
    ? ` <span class="badge stale">Re-check before buying, last verified ${esc(fmtDate(vd))}</span>`
    : "";
  return `<p class="deal-verified">Deal verified <time datetime="${esc(vd)}">${esc(fmtDate(vd))}</time>${badge}</p>`;
}

/* F5 first-year cost (PP-OVERNIGHT-5): compare pages only — starting-tier
 * price × 12, labeled. Returns "" (renders nothing) for quote/free/
 * per-transaction starting tiers: an honest gap, never a guess. */
function firstYearItem(p) {
  const fy = firstYear(p);
  if (!fy) return "";
  return `<div class="facts-item"><dt>First-year cost (starting tier)</dt><dd>${esc(fy.text)}</dd></div>`;
}

function verificationBox(p, batch = false) {
  const base = `<aside class="verify">
      <h2>Deal verification</h2>`;
  if (p.deal && !isExpiredDeal(p)) {
    const expiry = p.deal.end_date
      ? `<p class="verify-expiry">Vendor offer ends <time datetime="${esc(p.deal.end_date)}">${esc(p.deal.end_date)}</time>.</p>`
      : "";
    return `${base}
      <p class="verify-headline">${esc(p.deal.headline)}</p>
      ${dealVerifiedLine(p)}
      <p class="verify-src">Source: <a href="${esc(p.deal.source_url)}" target="_blank" rel="noopener">${vendorHost(p.deal.source_url)}</a>.</p>
      ${expiry}<p class="verify-note">Promotions change. Confirm the current offer on the vendor's page before buying.</p>
    </aside>`;
  }
  if (p.deal && isExpiredDeal(p)) {
    return `${base}
      <p class="verify-headline">${esc(p.deal.headline)}</p>
      ${dealVerifiedLine(p)}
      <p class="verify-note">This promotion ended <time datetime="${esc(p.deal.end_date)}">${esc(p.deal.end_date)}</time>. Prices below are standard list.</p>
    </aside>`;
  }
  return `${base}
      <p>No public promotion found (checked ${batch ? esc(p.batch_checked_date || p.last_verified) : CHECKED}). Prices ${batch ? "shown are" : "below are"} standard list.</p>
    </aside>`;
}

// Conditional per §11: rendered only when a vendor-sourced claim
// instruction exists in the data (deal.claim). Absent today.
function claimBlock(p) {
  if (!(p.deal && p.deal.claim)) return "";
  return `<section class="section claim">
      <h2>How to claim this offer</h2>
      <p>${esc(p.deal.claim)}</p>
    </section>`;
}

/* F1 annual-billing savings (PP-OVERNIGHT-5): a callout renders under a
 * tier's notes ONLY when the notes match one of the P1–P4 shapes in
 * tools/savings.mjs. No match → no callout (honest gap, never an estimate).
 * `~N% off` notes (semrush) render verbatim with no dollar figure. The
 * callout is derived in savings.mjs so the lint can pin the exact strings. */
function annualCallout(t) {
  const sv = tierSavings(t);
  if (!sv) return "";
  return `\n      <p class="annual-callout">${esc(sv.callout)}</p>`;
}

// PP-SERP-DESC-PAGES (2026-10-11): products without pricing_tiers get an
// honest "pricing on request" block instead of crashing the generator.
function pricingTable(p) {
  if (!p.pricing_tiers || !p.pricing_tiers.length) {
    return `<section class="section pricing">
      <h2>Pricing</h2>
      <p>Pricing is not published on the vendor's site — contact the vendor for a quote.</p>
    </section>`;
  }
  const rows = p.pricing_tiers.map(t => `<tr>
      <th scope="row">${esc(t.name)}</th>
      <td class="price">${esc(t.price)}</td>
      <td>${esc(t.cadence)}</td>
      <td>${esc(t.notes)}${annualCallout(t)}</td>
    </tr>`).join("\n");
  return `<section class="section pricing">
      <h2>Pricing</h2>
      <div class="table-scroll">
      <table class="tiers">
        <caption>${esc(p.name)} list prices, verified ${esc(p.last_verified)}.</caption>
        <thead><tr><th scope="col">Plan</th><th scope="col">Price</th><th scope="col">Cadence</th><th scope="col">Notes</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      </div>
      <p class="fine">Always confirm on the vendor's pricing page before purchasing, plans and prices change.</p>
    </section>`;
}

/* PP-NON-AFFILIATE-VENDORS: products with affiliate status "none" get a
 * plain outbound button — never "sponsored", never an affiliate URL — plus a
 * blunt no-relationship line. PP-GEN-DRIFT (2026-11-10, R2): every other
 * non-live product (pending-approval, or no affiliate object at all) renders
 * the plain vendor-link form the committed tree uses — a real link to the
 * vendor homepage plus the direct-link fine print. The old inert "#"
 * placeholder button is gone; it never matched the live site. */
function cta(p, batch = false) {
  if (affiliateLive(p)) {
    if (p.affiliate.url) {
      return `<a href="${esc(p.affiliate.url)}" class="btn affiliate-cta" data-program="${esc(p.affiliate.program)}" target="_blank" rel="sponsored noopener">Check the current price</a>
    <p class="fine">${AFFILIATE_BLUNT} See our <a href="/disclosure.html">affiliate disclosure</a>.</p>`;
    }
    console.warn(`WARN: ${p.slug} has a live affiliate status but no affiliate URL in data — rendering the plain vendor-link CTA.`);
  }
  if (affiliateNone(p)) {
    return `<a href="${esc(p.vendor_homepage)}" class="btn vendor-cta" target="_blank" rel="noopener">Visit ${esc(p.name)} →</a>
    <p class="fine no-affiliate">PlanPrice has no affiliate relationship with ${esc(p.name)}, we earn nothing if you choose them.</p>`;
  }
  return `${batch ? "" : `<!-- AFFILIATE PLACEHOLDER: light when Joseph approves -->
    `}<a href="${esc(p.vendor_homepage)}" class="btn" target="_blank" rel="noopener">Check the current price</a>
    <p class="fine">Direct link to the vendor site. See our <a href="/disclosure.html">affiliate disclosure</a>.</p>`;
}

function relatedRows(p, batch = false) {
  const rel = products
    .filter((q) => q.slug !== p.slug)
    .sort((a, b) => Number(b.category === p.category) - Number(a.category === p.category))
    .slice(0, 3)
    .map((r) => `<li class="dir-row">
    <div class="dir-row-main">
      <h3 class="dir-row-name"><a href="/deals/${esc(r.slug)}.html">${esc(r.name)}</a></h3>
      <p class="dir-row-tag">${esc(r.tagline)}</p>
    </div>
    <div class="dir-row-side">
      <p class="dir-row-price">${batch ? fromPrice(r, true, p.batch_amount_related ? PRICE_MODE.AMOUNT : PRICE_MODE.PAREN) : fromPrice(r)}</p>
      <p class="dir-row-badge">${dealBadge(r)}</p>
    </div>
  </li>`)
    .join("\n");
  // Head-to-head link (PP-SECTIONS): participants only — non-participants
  // get nothing. Link copy is mechanical ("Head-to-head: <vs-join title>").
  const set = setForSlug(p.slug);
  const h2h = set
    ? `<p class="h2h-link"><a href="/compare/${esc(set.slug)}.html">Head-to-head: ${esc(set.title)}</a></p>`
    : "";
  return `<aside class="section related">
        <h2>Related deals</h2>
        ${h2h}<ul class="dir-rows">${rel}</ul>
      </aside>`;
}

function dealPage(p) {
  const batch = !!p.batch_template;
  const slotBare = batch || !!p.hand_built;
  const canLine = canadianLine(p);
  return `${head(
    `${p.name} Pricing & Deals (Verified ${p.last_verified}) | PlanPrice`,
    // PP-GEN-DRIFT (R10): the committed SERP copy wins. products.json carries
    // a per-product meta_description extracted verbatim from the committed
    // deal pages (incl. the " Checked <date> by the PlanPrice research team."
    // suffix on 37 of them); the PP-SERP-DESC-PAGES formula remains only as
    // the fallback for a future product that has no extracted meta yet.
    p.meta_description || `${p.name} verified list pricing and current promotions. ${p.tagline}`,
    `/deals/${p.slug}.html`,
    "",
    { bare: batch, noTrunc: !!p.meta_description }
  )}
${header(batch ? null : "/")}
<main>
  <div class="wrap">
    <p class="breadcrumbs"><a href="/">All deals</a> › ${esc(p.name)}</p>
    <article class="product">
      <p class="card-cat">${esc(p.category)}</p>
      <h1>${esc(p.name)}</h1>
      <p class="lead">${esc(p.lead || p.tagline)}</p>${figFor(`deals/${p.slug}`)}${canLine ? `
      ${canLine}` : slotBare ? "" : "\n      "}
      <div class="facts-wrap">
        ${factsStrip(p, "", batch)}
      </div>
      <section class="section overview">${p.similar_to ? `
        <p class="similar-to">Think of it as: <strong>${esc(p.similar_to)}</strong>.</p>` : slotBare ? "" : "\n        "}
        <p>${esc(p.description)}</p>
        <p><strong>Best for:</strong> ${esc(p.best_for)}</p>${p.canadian_note ? `
        <p><strong>Canadian note:</strong> ${esc(p.canadian_note)}</p>` : ""}
      </section>
      ${batch ? pricingTable(p).replace("</tr></tbody>", "</tr>\n</tbody>") : pricingTable(p)}${!batch && pageExtras[`deals/${p.slug}`] ? `
      ${pageExtras[`deals/${p.slug}`]}` : ""}${batch ? `
      ${extraFor(`deals/${p.slug}`).trimStart()}
      ${verificationBox(p, true)}
      ${priceHistorySection(p, true)}` : `
      ${reviewsSection(p)}
      ${scoreSection(p)}
      ${verificationBox(p)}
      ${claimBlock(p)}
      ${priceHistorySection(p)}`}
      <section class="section cta-block">${batch ? `
    ${cta(p, batch)}` : `
        ${cta(p, batch)}`}
      </section>
      ${relatedRows(p, batch)}
    </article>
  </div>
</main>
${footer()}${batch ? "\n" : ""}`;
}

// ---------------------------------------------------------------------------
// Category pages + head-to-head compare pages (PP-SECTIONS)
// ---------------------------------------------------------------------------

/* "Head-to-head" banner for a category page: rendered only when a compare
 * set exists for the category (Accounting / Payments & POS / SEO &
 * Marketing today). Categories with no set get no banner. */
function h2hBannerLink(c) {
  const sets = setsForCategory(c);
  if (!sets.length) return "";
  return `<p class="h2h-banner">${sets
    .map((s) => `<a href="/compare/${esc(s.slug)}.html">Head-to-head: ${esc(s.title)}</a>`)
    .join("\n")}</p>`;
}

/* One page per distinct products[].category. H1 is the category name
 * verbatim; the intro line is a mechanical count/date — no category
 * descriptions exist in the data, so none are written. Rows reuse dirRow()
 * (with data-slug for no-JS addressability); the filter ships with only
 * #f-deals, #f-canadian, #f-sort — no category facet. */
function categoryPage(c) {
  const items = products
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.category === c)
    .sort((a, b) => sortPriority(a.p) - sortPriority(b.p) || a.i - b.i);
  const rows = items.map(({ p }) => dirRow(p)).join("\n");
  const n = items.length;
  const plural = n === 1 ? "" : "s";
  return `${head(
    `${c} Pricing & Deals | PlanPrice`,
    `${c} software: verified pricing and current promotions. ${n} product${plural} tracked, checked ${CHECKED}.`,
    `/categories/${slugify(c)}.html`,
    '\n<script src="/filter.js" defer></script>'
  )}
${header(null)}
<main>
  <div class="wrap" id="all-deals">
    <p class="breadcrumbs"><a href="/">All deals</a> › ${esc(c)}</p>
    <h1 class="page-title">${esc(c)}</h1>
    <p class="section-sub">${n} product${plural} tracked · prices checked <time datetime="${CHECKED}">${CHECKED}</time></p>${figFor(`categories/${slugify(c)}`)}
    <p class="guide-banner"><a href="/guides/${slugify(c)}.html">Buyer's guide: how to choose ${esc(c)} software</a></p>
    ${h2hBannerLink(c)}${extraFor(`categories/${slugify(c)}`)}
    ${filterForm(false)}
    <section class="dir-cat" id="cat-${slugify(c)}" aria-label="${esc(c)}">
      <ul class="dir-rows">${rows}</ul>
    </section>
  </div>
</main>
${footer()}`;
}

/* Compare index: mechanical list of the 3 sets. Set titles are the
 * vs-joined product names (validated mechanical in the loader above). */
function compareIndexPage() {
  const items = allCompareSets
    .map((s) => `<li class="compare-row">
      <h2 class="compare-row-title"><a href="/compare/${esc(s.slug)}.html">${esc(s.title)}</a></h2>
      <p class="compare-row-meta">${s.editorial ? s.category : esc(s.category)} · ${s.products.length} products</p>
    </li>`)
    .join("\n");
  return `${head(
    "Compare | PlanPrice",
    `Head-to-head comparisons of rival B2B software: verified pricing, current deals, and user feedback side by side. ${allCompareSets.length} comparisons tracked.`,
    "/compare.html"
  )}
${header("/compare.html")}
<main>
  <div class="wrap">
    <p class="breadcrumbs"><a href="/">All deals</a> › Compare</p>
    <h1 class="page-title">Compare</h1>
    <p class="section-sub">${allCompareSets.length} head-to-head comparisons tracked</p>${extraFor("compare-index")}
    <ul class="compare-rows">${items}</ul>
  </div>
</main>
${footer()}`;
}

/* "Consider X if…" is the ONLY fit guidance on compare pages: the verbatim
 * best_for string per product. No synthesis, no verdict, no winner language. */
function fitBlock(p) {
  return `<section class="section fit">
      <h2>Consider ${esc(p.name)} if…</h2>
      <p><strong>Best for:</strong> ${esc(p.best_for)}</p>
    </section>`;
}

/* One page per compare set: per-product columns reusing factsStrip(),
 * pricingTable(), reviewsSection() (only when hasReviews(p)) and
 * scoreSection() (renders nothing on a missing entry) — the identical
 * components and strings as the deal pages. The F5 first-year-cost item is
 * appended to each column's facts strip (compare pages only). */
function compareSetPage(set) {
  const pageDate = comparePageDate(set.slug);
  const cols = set.products
    .map((p) => `<section class="compare-col" id="cmp-${esc(p.slug)}" aria-label="${esc(p.name)}">
      <h2 class="compare-col-name"><a href="/deals/${esc(p.slug)}.html">${esc(p.name)}</a></h2>
      ${fitBlock(p)}
      ${factsStrip(p, firstYearItem(p))}
      ${pricingTable(p)}
      ${reviewsSection(p)}
      ${scoreSection(p)}
    </section>`)
    .join("\n");
  return `${head(
    `${set.title} | PlanPrice`,
    `${set.title}: compare verified pricing, current deals, and user feedback side by side. Prices checked ${pageDate}.`,
    `/compare/${set.slug}.html`
  )}
${header("/compare.html")}
<main>
  <div class="wrap">
    <p class="breadcrumbs"><a href="/compare.html">Compare</a> › ${esc(set.title)}</p>
    <h1 class="page-title">${esc(set.title)}</h1>
    <p class="section-sub">${set.products.length} products, side by side · prices checked <time datetime="${pageDate}">${pageDate}</time></p>${figFor(`compare/${set.slug}`)}
    <div class="compare-cols">
      ${cols}
    </div>
  </div>
</main>
${footer()}`;
}

// ---------------------------------------------------------------------------
// Deals + Canadian vendors pages (PP-SECTIONS-PHASE2)
// ---------------------------------------------------------------------------

/* F1 "biggest annual-billing savings" strip (PP-OVERNIGHT-5): the top 5
 * tier-level savings site-wide, each "Product — Tier: save $X/yr (per
 * seat)". Rendered on /deals.html (directory intent); the homepage carries
 * a one-line pointer (see indexPage). Derived in savings.mjs. */
function saversStrip() {
  const top = allSavings(products).slice(0, 5);
  const items = top
    .map(
      (s) =>
        `<li class="saver-row"><a href="/deals/${esc(s.slug)}.html">${esc(s.name)}</a>. ${esc(s.tier)}: ${esc(s.saveText)}</li>`
    )
    .join("\n");
  return `<section class="section savers" id="biggest-savers" aria-label="Biggest annual-billing savings">
  <div class="wrap">
    <h2 class="section-title">Biggest annual-billing savings</h2>
    <p class="section-sub">Top 5 tier-level savings when billed annually, computed from verified list prices.</p>
    <ol class="saver-rows">
    ${items}
    </ol>
  </div>
</section>`;
}

/* /deals.html — "Current promos". Every product with a current, non-expired
 * promo (reuses liveDeals() / isExpiredDeal()). Intro line is a mechanical
 * count/date. Empty state (zero promos) is honest: no invented urgency, no
 * placeholders. Facets: #f-canadian + #f-sort only (no category facet, no
 * deals-only facet — every row is a deal). */
function dealsPage() {
  const items = liveDeals(products)
    .map((p, i) => ({ p, i }))
    .sort((a, b) => sortPriority(a.p) - sortPriority(b.p) || a.i - b.i);
  const n = items.length;
  const plural = n === 1 ? "" : "s";
  const rows = items.map(({ p }) => dirRow(p)).join("\n");
  const body = items.length
    ? `<ul class="dir-rows">${rows}</ul>`
    : `<p class="section-sub">No active promos right now — check back after the next price sweep.</p>`;
  return `${head(
    "Current promos | PlanPrice",
    `Current promotions on B2B software: ${n} active promo${plural}, verified against vendor sites. Checked ${CHECKED}.`,
    "/deals.html",
    '\n<script src="/filter.js" defer></script>'
  )}
${header("/deals.html")}
<main>
  <div class="wrap" id="all-deals">
    <p class="breadcrumbs"><a href="/">All deals</a> › Current promos</p>
    <h1 class="page-title">Current promos</h1>
    <p class="section-sub">${n} active promo${plural} · prices checked <time datetime="${CHECKED}">${CHECKED}</time></p>${extraFor("deals")}
    ${saversStrip()}
    ${filterForm(false, { dealsOnly: false })}
    <section class="dir-cat" id="cat-deals" aria-label="Current promos">
      ${body}
    </section>
  </div>
</main>
${footer()}`;
}

/* /canadian.html — "Canadian vendors". Every product whose `country` field
 * is "CA" in the data index (p.canadian ? "CA" : null — the same mapping the
 * index and the 🇨🇦 badge use; nulls are excluded, never guessed). Filter
 * view, not an essay: mechanical intro, no editorial claims. Facets:
 * #f-deals + #f-sort (no category facet; the canadian-only facet would be
 * vacuous on a page where every row is Canadian). */
function canadianPage() {
  const items = products
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.canadian)
    .sort((a, b) => sortPriority(a.p) - sortPriority(b.p) || a.i - b.i);
  const n = items.length;
  const plural = n === 1 ? "" : "s";
  const rows = items.map(({ p }) => dirRow(p)).join("\n");
  return `${head(
    "Canadian vendors | PlanPrice",
    `Canadian B2B software vendors: ${n} verified Canadian ${n === 1 ? "company" : "companies"}, list prices and promos checked ${CHECKED}.`,
    "/canadian.html",
    '\n<script src="/filter.js" defer></script>'
  )}
${header("/canadian.html")}
<main>
  <div class="wrap" id="all-deals">
    <p class="breadcrumbs"><a href="/">All deals</a> › Canadian vendors</p>
    <h1 class="page-title">Canadian vendors</h1>
    <p class="section-sub">${n} Canadian vendors · each row shows its own verification date</p>${extraFor("canadian")}
    ${filterForm(false, { canadian: false })}
    <section class="dir-cat" id="cat-canadian" aria-label="Canadian vendors">
      <ul class="dir-rows">${rows}</ul>
    </section>
  </div>
</main>
${footer()}`;
}

/* ---- Buyer's guides + glossary (PP-ADSENSE-READINESS) ----
 * All copy comes from data/guides.json and data/glossary.json (original
 * prose, content-creator owned, validated at load). Every interpolated
 * string is esc()'d. No prices, no verdicts, no vendor capability claims
 * beyond what products.json already states. New pages go through the same
 * head() + header() + footer() chrome — never forked. No JS on these
 * pages (works with JS disabled). */

/* /free.html — "Free to start" (PP-OVERNIGHT-5, F2). The products with a
 * $0 tier: one card each showing the product's name, its tagline verbatim,
 * and each $0 tier's name + notes verbatim. No computed strings on the
 * cards — anything not in the data renders as nothing. */
function freePage() {
  const items = products
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => (p.pricing_tiers || []).some((t) => t.price === "$0"))
    .sort((a, b) => sortPriority(a.p) - sortPriority(b.p) || a.i - b.i);
  const n = items.length;
  const cards = items
    .map(({ p }) => {
      const freeTiers = p.pricing_tiers.filter((t) => t.price === "$0");
      const tierBlocks = freeTiers
        .map(
          (t) =>
            `<p class="free-tier"><strong>${esc(t.name)}</strong>, ${esc(t.price)}</p>\n      <p class="free-notes">${esc(t.notes)}</p>`
        )
        .join("\n      ");
      return `<li class="dir-row free-card" data-slug="${esc(p.slug)}">
      <div class="dir-row-main">
        <h3 class="dir-row-name"><a href="/deals/${esc(p.slug)}.html">${esc(p.name)}</a></h3>
        <p class="dir-row-tag">${esc(p.tagline)}</p>
        ${tierBlocks}
      </div>
    </li>`;
    })
    .join("\n");
  return `${head(
    "Free to start | PlanPrice",
    `Start free: ${n} products with a $0 tier, verified pricing, checked ${CHECKED}.`,
    "/free.html"
  )}
${header("/free.html")}
<main>
  <div class="wrap" id="all-deals">
    <p class="breadcrumbs"><a href="/">All deals</a> › Free to start</p>
    <h1 class="page-title">Free to start</h1>
    <p class="section-sub">${n} products with a free tier · prices checked <time datetime="${CHECKED}">${CHECKED}</time></p>${extraFor("free")}
    <section class="dir-cat" id="cat-free" aria-label="Free to start">
      <ul class="dir-rows">${cards}</ul>
    </section>
  </div>
</main>
${footer()}`;
}

/* /top-rated.html — leaderboard (PP-OVERNIGHT-5, F4). Products ranked by
 * the average of their available G2/Capterra scores (rowFor in
 * tools/review-rank.mjs), then a second list ranked by total review count.
 * Products with no verified scores are excluded entirely — never
 * zero-filled. Rank numbers come from CSS counters, not text. */
function topRatedPage() {
  const byAvg = rankByAvg(products, reviewScores);
  const byReviews = rankByReviews(products, reviewScores);
  const n = byAvg.length;
  const SCORES_CHECKED = reviewScores.checked;
  // R4d: the committed "How this leaderboard is built" section, with its
  // hard-coded date/counts parameterized from the live score data.
  const monday = byReviews.find((r) => r.slug === "monday");
  const plausible = byAvg.find((r) => r.slug === "plausible");
  const ratedGuide = (pageExtras["top-rated"] || "")
    .replace("the 16 products PlanPrice currently tracks", `the ${n} products PlanPrice currently tracks`)
    .replace("re-checked on 2026-09-30", `re-checked on ${SCORES_CHECKED}`)
    .replace("23,267 (Monday.com)", monday ? `${monday.totalReviews.toLocaleString("en-US")} (Monday.com)` : "23,267 (Monday.com)")
    // The worked example in the prose ("A 4.6 average built on 12 reviews
    // (Plausible) ... a 4.7 built on ...") must track the same rank rows the
    // leaderboard renders, or the guide contradicts the page it sits on.
    .replace("A 4.6 average built on 12 reviews (Plausible)", plausible ? `A ${plausible.avgText} average built on ${plausible.totalReviews} reviews (Plausible)` : "A 4.6 average built on 12 reviews (Plausible)")
    .replace("than a 4.7 built on", monday ? `than a ${monday.avgText} built on` : "than a 4.7 built on");
  const avgRows = byAvg
    .map((r) => `<li class="rated-row">${esc(r.line)}</li>`)
    .join("\n      ");
  const revRows = byReviews
    .map((r) => `<li class="rated-row">${esc(r.mostLine)}</li>`)
    .join("\n      ");
  return `${head(
    "Top rated | PlanPrice",
    `The highest-rated B2B software by verified G2 and Capterra scores: ${n} products ranked. Scores checked ${SCORES_CHECKED}.`,
    "/top-rated.html"
  )}
${header("/top-rated.html")}
<main>
  <div class="wrap">
    <p class="breadcrumbs"><a href="/">All deals</a> › Top rated</p>
    <h1 class="page-title">Top rated</h1>
    <p class="section-sub">${n} products ranked by average G2/Capterra score · scores checked <time datetime="${SCORES_CHECKED}">${SCORES_CHECKED}</time></p>${ratedGuide ? "\n    " + ratedGuide : ""}
    <section class="section rated" aria-label="Highest average score">
      <h2 class="section-title">Highest average score</h2>
      <ol class="rated-list">
      ${avgRows}
      </ol>
    </section>
    <section class="section rated" aria-label="Most reviewed">
      <h2 class="section-title">Most reviewed</h2>
      <ol class="rated-list">
      ${revRows}
      </ol>
    </section>
    <p class="fine">Averages are the mean of each product's available G2 and Capterra scores, not a PlanPrice rating. Scores checked ${SCORES_CHECKED}.</p>
  </div>
</main>
${footer()}`;
}

function guidePage(g) {
  const c = g.category;
  const items = products
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.category === c)
    .sort((a, b) => sortPriority(a.p) - sortPriority(b.p) || a.i - b.i);
  // Directory-not-ad-page rule: link ALL products in the category,
  // regardless of affiliate status.
  const productLinks = items
    .map(({ p }) => `<li><a href="/deals/${esc(p.slug)}.html">${esc(p.name)}</a></li>`)
    .join("\n");
  const paras = (arr) => arr.map((t) => `<p>${esc(t)}</p>`).join("\n");
  const sections = g.sections
    .map((s) => `<h2>${esc(s.h2)}</h2>\n${paras(s.body)}`)
    .join("\n");
  return `${head(g.title, g.meta_description, `/guides/${g.slug}.html`)}
${header("/guides.html")}
<main>
  <div class="wrap wrap-prose">
    <p class="breadcrumbs"><a href="/">All deals</a> › <a href="/guides.html">Buyer's guides</a> › ${esc(c)}</p>
    <h1 class="page-title">${esc(g.title)}</h1>
    <p class="section-sub">${g.published ? `Published <time datetime="${esc(g.published)}">${esc(g.published)}</time> · ` : ""}Last updated <time datetime="${esc(g.updated)}">${esc(g.updated)}</time></p>${figFor(`guides/${g.slug}`)}
    ${paras(g.intro)}
    ${sections}
    <h2>Quick checklist</h2>
    <ul>
      ${g.checklist.map((li) => `<li>${esc(li)}</li>`).join("\n")}
    </ul>
    <h2>${esc(c)} products on PlanPrice</h2>
    <p>Every ${esc(c)} product we track, see verified pricing and current promotions on each deal page:</p>
    <ul>
      ${productLinks}
    </ul>
    <p><a href="/categories/${slugify(c)}.html">Browse all ${esc(c)} software →</a></p>
  </div>
</main>
${footer()}`;
}

function glossaryTermPage(t) {
  const related = (t.related_slugs || []).map((s) => productBySlug.get(s));
  const relatedSection = related.length
    ? `<h2>Related products</h2>
    <p>PlanPrice tracks verified pricing for these products:</p>
    <ul>
      ${related.map((p) => `<li><a href="/deals/${esc(p.slug)}.html">${esc(p.name)}</a></li>`).join("\n")}
    </ul>`
    : "";
  // PP-SERP-DESC-PAGES (2026-10-11): word-boundary truncation (was a raw
  // slice(0,157)+"…" = 158 chars, often mid-word).
  const metaDesc = truncMeta(t.definition);
  return `${head(
    `${t.term} | Pricing glossary | PlanPrice`,
    metaDesc,
    `/glossary/${t.slug}.html`
  )}
${header("/glossary.html")}
<main>
  <div class="wrap wrap-prose">
    <p class="breadcrumbs"><a href="/">All deals</a> › <a href="/glossary.html">Glossary</a> › ${esc(t.term)}</p>
    <h1 class="page-title">${esc(t.term)}</h1>
    <p class="glossary-definition"><strong>Definition:</strong> ${esc(t.definition)}</p>
    <h2>Why it matters when comparing prices</h2>
    <p>${esc(t.why_it_matters)}</p>${t.extra_html || ""}
    ${relatedSection}
    <p><a href="/glossary.html">← All glossary terms</a></p>
  </div>
</main>
${footer()}`;
}

function glossaryIndexPage() {
  const terms = [...glossaryData].sort((a, b) => a.term.localeCompare(b.term));
  const items = terms
    .map((t) => `<li class="glossary-row">
      <h2 class="glossary-row-title"><a href="/glossary/${esc(t.slug)}.html">${esc(t.term)}</a></h2>
      <p>${esc(t.definition)}</p>
    </li>`)
    .join("\n");
  return `${head(
    "B2B Software Pricing Glossary | PlanPrice",
    "Plain-English definitions of B2B software pricing terms: seat-based pricing, tiered pricing, usage-based pricing, freemium, SLAs, and more.",
    "/glossary.html"
  )}
${header("/glossary.html")}
<main>
  <div class="wrap">
    <p class="breadcrumbs"><a href="/">All deals</a> › Glossary</p>
    <h1 class="page-title">B2B software pricing glossary</h1>
    <p class="section-sub">${glossaryData.length} terms · plain-English definitions</p>
    <ul class="glossary-rows">${items}</ul>
  </div>
</main>
${footer()}`;
}

// ---------------------------------------------------------------------------
// Shared chrome — disclosure banner + footer text are byte-identical to v1.
// ---------------------------------------------------------------------------

// PP-SERP-DESC-PAGES (2026-10-11): SERP-safe truncation. Meta descriptions are
// capped at 155 chars at a word boundary so no page can ever ship with an
// over-long <meta name="description"> again (Google truncates ~155-160).
function truncMeta(s, max = 155) {
  s = String(s || "").trim().replace(/\s+/g, " ");
  if (s.length <= max) return s;
  let cut = s.slice(0, max - 1); // leave room for the ellipsis
  const lastSpace = cut.lastIndexOf(" ");
  if (lastSpace > 0) cut = cut.slice(0, lastSpace);
  return cut + "…";
}

function head(title, description, path, extraHead = "", opts = {}) {
  // PP-GEN-DRIFT: opts.noTrunc keeps an extracted committed meta verbatim
  // (the batch deal pages carry untruncated SERP copy); opts.bare omits the
  // OG/AdSense HTML comments (the batch deal-page template never had them).
  if (!opts.noTrunc) description = truncMeta(description);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(SITE_URL + path)}">${opts.bare ? "" : "\n<!-- Open Graph / Twitter cards (PP-OG-IMAGE, 2026-10-04) -->"}
<meta property="og:type" content="website">
<meta property="og:site_name" content="PlanPrice">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(SITE_URL + path)}">
<meta property="og:image" content="${esc(SITE_URL + '/og-image.jpg')}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(SITE_URL + '/og-image.jpg')}">
<link rel="stylesheet" href="/style.css">
<link rel="icon" type="image/png" href="/favicon.png">
${opts.bare ? "" : `<!-- AdSense account verification (Joseph's AdSense signup, 2026-10-01).
     Publisher ID is public by design — AdSense requires it in page source.
     Ad units and ads.txt only AFTER Google approves the account. -->
`}<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-9041438524909240"
     crossorigin="anonymous"></script>${extraHead}${beaconTag()}
</head>`;}

/* Cloudflare Web Analytics beacon (PP-ANALYTICS). Returns "" while
 * CF_BEACON_TOKEN is empty — the beacon is inert until Joseph pastes the
 * token, and empty-token output stays byte-identical to pre-beacon builds. */
function beaconTag() {
  if (!CF_BEACON_TOKEN) return "";
  return `\n<!-- Cloudflare Web Analytics --><script type='module' src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "${esc(CF_BEACON_TOKEN)}"}'></script><!-- End Cloudflare Web Analytics -->`;
}

// Impact site-verification tag (Joseph's affiliate work, 2026-09-30).
// Rendered on the homepage <head> only, byte-verbatim — do not alter.
const IMPACT_TAG = `<meta name='impact-site-verification' value='d3933dd0-8d52-4dd7-b099-5f505aec37fa'>`;

/* ---- Cloudflare Web Analytics beacon (PP-ANALYTICS) ----
 * CF_BEACON_TOKEN is the public-by-design token from the Cloudflare
 * dashboard (Web Analytics → Add site → planprice.ca). Joseph pastes it
 * here when he adds the site; until then it stays "" and head() renders
 * no beacon tag at all (output stays byte-identical to pre-beacon builds). */
const CF_BEACON_TOKEN = "6ff87ae657ed400c827b091d871dc609";

/* Header nav (PP-SECTIONS-PHASE2): "/" was labeled "Deals" in phase 1, which
 * would collide with the new /deals.html "Deals" entry — so the homepage
 * link is "All deals" (matching the existing breadcrumb copy), and the nav
 * gains "Deals" → /deals.html and "Canadian" → /canadian.html. */
function header(active) {
  const nav = (href, label) =>
    `<a href="${href}"${active === href ? ' class="active"' : ""}>${label}</a>`;
  return `<body>
<div class="disclosure-bar">${
  anyAffiliateLive
    ? `PlanPrice may earn a commission if you buy through links on this page. <a href="/disclosure.html">Read our affiliate disclosure</a>.`
    : `PlanPrice is setting up affiliate partnerships, right now, links on this page are plain vendor links. <a href="/disclosure.html">Read our affiliate disclosure</a>.`
}</div>
<header class="site-header">
  <div class="wrap header-inner">
    <a class="brand" href="/"><img src="/logo.svg" alt="PlanPrice" height="34"></a>
    <nav class="main-nav">
      ${nav("/", "All deals")}
      ${nav("/deals.html", "Deals")}
      ${nav("/canadian.html", "Canadian")}
      ${nav("/free.html", "Free")}
      ${nav("/top-rated.html", "Top rated")}
      ${nav("/compare.html", "Compare")}
      ${nav("/guides.html", "Guides")}
      ${nav("/glossary.html", "Glossary")}
      ${nav("/search.html", "Search")}
      ${nav("/disclosure.html", "Disclosure")}
      ${nav("/about.html", "About")}
    </nav>
  </div>
</header>`;
}

function footer() {
  return `<footer class="site-footer">
  <div class="wrap">
    <p class="ai-disclosure">Built with <a href="https://muse.ai/join">Muse</a>.</p>
    <p class="footer-brand">PlanPrice, verified B2B software pricing and deals.</p>
    <nav class="footer-nav">
      <a href="/about.html">About</a>
      <a href="/contact.html">Contact</a>
      <a href="/guides.html">Guides</a>
      <a href="/glossary.html">Glossary</a>
      <a href="/verified.html">Verification log</a>
      <a href="/disclosure.html">Affiliate disclosure</a>
      <a href="/privacy-policy.html">Privacy</a>
      <a href="/terms.html">Terms</a>
    </nav>
    <p class="fine">Prices verified ${CHECKED} by the PlanPrice research team. Always confirm current pricing on the vendor's own site before buying. ${
      anyAffiliateLive
        ? "PlanPrice may earn a commission on qualifying purchases."
        : "PlanPrice currently earns no affiliate commissions, partnerships are still being set up."
    }</p>
  </div>
</footer>
</body>
</html>`;
}

// Static-page bodies are byte-identical to v1 (new CSS containers only).
/* ---- Static-page bodies (PP-AFFILIATE-CLARITY) ----
 * The funding paragraph on about.html and the disclosure.html body switch
 * between the INTERIM wording (partnerships being set up, zero commissions
 * being earned) and the LIVE wording (affiliate links exist) based on
 * affiliate state, so rebuilds always keep the wording honest. */
function aboutBody() {
  const funding = anyAffiliateLive
    ? `<p>PlanPrice is funded by affiliate commissions: when you buy through a link on this site, we may earn a commission at no extra cost to you. See our <a href="/disclosure.html">affiliate disclosure</a> for the full explanation.</p>`
    : `<p>${AFFILIATE_INTERIM}</p>`;
  // PP-GEN-DRIFT (R4a): body extracted verbatim from the committed about.html
  // (incl. the How we verify prices / What PlanPrice doesn't do / AI
  // disclosure sections). Only two dynamic slots: the funding paragraph
  // (affiliate-state conditional, as before) and the site-wide verification
  // date claim, which now follows the registry date (was a stale 2026-09-30
  // literal in the committed prose).
  return `<section class="section"><div class="wrap">
      <p>PlanPrice is a deals directory for business software. We track list prices and current promotions for the tools small businesses actually buy, accounting, CRM, ecommerce, point of sale, scheduling, and more.</p>
      <p><strong>Our standard:</strong> every discount headline on this site links to the vendor's own page. If we couldn't find a public promotion, the page says so plainly instead of dressing up standard list prices as a deal.</p>
      <p><strong>Review scores:</strong> deal pages show aggregate user ratings from third-party review sites (G2 and Capterra), these are not PlanPrice's own ratings. We re-check every score during the monthly verification sweep; each score shows its source and the date it was last checked.</p>
      <p>Prices are checked by the PlanPrice research team and dated. Vendors change prices and promotions without notice, so always confirm on the vendor's pricing page before purchasing.</p>
      ${funding}
    </div></section><section class="section"><div class="wrap">
      <h2>How we verify prices</h2>
      <p>Every price on PlanPrice is checked against the vendor's own pricing page by the research team, and the check date is printed next to the price, the current site-wide verification date is ${CHECKED}. When a vendor runs a public promotion, the deal page shows the promo terms and links to the vendor's own offer page; when no public promotion exists, the page says so plainly instead of dressing up list prices as a deal. Prices are re-checked on a regular sweep, and the verified date moves with each pass.</p>
      <p>Review scores work the same way: the G2 and Capterra aggregates shown on deal pages are third-party user ratings, not PlanPrice's own opinions, and each score is re-checked during the verification sweep with its source and check date shown. Scores describe other users' experience; they don't include pricing, and a high score on an expensive tool doesn't make it the right tool for a tight budget.</p>
      <h2>What PlanPrice doesn't do</h2>
      <p>PlanPrice doesn't sell software and doesn't take a cut of anything you buy, right now our affiliate partnerships are still being set up, so every outbound link is a plain link to the vendor (see the <a href="/disclosure.html">affiliate disclosure</a>). We don't invent prices, fabricate promotions, or publish "deals" we couldn't find on the vendor's own site. And we're a pricing directory, not an advisor: nothing here is financial or tax advice, and the final price is always whatever the vendor's own checkout shows.</p>
      <p>Spot something wrong? A price that changed, a promo that ended, a product we should track, <a href="/contact.html">tell us</a>. Corrections get re-checked against the vendor's site, and the page gets updated when the correction checks out.</p>
    <h2>AI disclosure</h2>
      <p>AI assists with content production on this site, under human direction and review.</p>
    </div></section>`;
}

function disclosureBody() {
  const status = anyAffiliateLive
    ? `<p>PlanPrice is reader-supported. ${AFFILIATE_BLUNT}</p>`
    : `<p><strong>Current status: no affiliate links are live yet.</strong> PlanPrice is reader-supported: our plan is to fund the site through affiliate commissions. Right now our affiliate partnerships are still being set up, so the links on this site are plain links to vendors, no commissions are being earned. When affiliate links go live, this page will say so, and buying through them will never cost you extra.</p>`;
  const statusBullet = anyAffiliateLive
    ? `<li>We label affiliate links as affiliate links. If a link earns us a commission, the page says so.</li>`
    : `<li>Right now, zero commissions are being earned. Deal-page buttons are plain outbound links to vendors we have no affiliate relationship with, no commissions are earned, and outbound links go straight to the vendor.</li>`;
  return `<section class="section"><div class="wrap">
      ${status}
      <p><strong>What this means in practice:</strong></p>
      <ul>
        ${statusBullet}
        <li>Commissions never change the prices we list. The prices shown are the vendor's own list prices.</li>
        <li>Commissions never create deals out of thin air. Every promotion we headline links to the vendor's own page, and pages with no public promotion say so explicitly.</li>
        <li>Our verification standard (a live source link for every deal claim) applies whether or not we have an affiliate relationship with a vendor.</li>
      </ul>
      <p>As of our current check (${CHECKED}), ${
        anyAffiliateLive
          ? "affiliate partnerships are active and earning commissions."
          : "affiliate partnerships are still being established and no commissions are being earned yet. Buttons on deal pages are plain outbound links that go straight to the vendor, they are not placeholders."
      }</p>
      <p>If you have questions about how we make money: ${
        anyAffiliateLive
          ? "this page is the answer — affiliate commissions, fully disclosed, never at your expense."
          : "the plan is affiliate commissions, fully disclosed, never at your expense. Until then, the site runs with no commission income at all."
      }</p>
    </div></section>`;
}

/* ---- Privacy policy analytics wording (PP-ANALYTICS) ----
 * Conditional on CF_BEACON_TOKEN: while the token is empty the Cloudflare
 * Web Analytics beacon is inert, so the page keeps the old "no analytics"
 * wording. The new wording (naming Cloudflare Web Analytics) ships ONLY
 * when a token is set — never ship it while the beacon is inert. */
function privacyBody() {
  const analytics = CF_BEACON_TOKEN
    ? `<li><strong>No cookies set by us.</strong> We measure site visits with Cloudflare Web Analytics, a cookieless, privacy-first measurement tool that sets no cookies and collects no personal data.</li>`
    : `<li><strong>No cookies set by us.</strong> Our pages do not use analytics cookies or tracking pixels.</li>`;
  return `<section class="section"><div class="wrap">
      <p><strong>Last updated: ${CHECKED}.</strong></p>
      <p>PlanPrice is a static informational site. We collect almost nothing:</p>
      <ul>
        <li><strong>No accounts, no signups, no email capture.</strong> There is nothing to subscribe to and nothing to log into.</li>
        ${analytics}
        <li><strong>Third parties.</strong> Our hosting provider may log basic server data (IP address, pages requested) for security. When affiliate links go live, clicking one takes you to the vendor's site, which is governed by that vendor's privacy policy, not ours.</li>
        <li><strong>Advertising.</strong> We've signed up for Google AdSense and placed the account-verification code on our pages, but ads aren't showing yet, they start only if Google approves this site. When they do, Google and its partners may use cookies, including the DoubleClick cookie, to show personalized ads based on your visits to this site and other sites. You can opt out of personalized advertising at <a href="https://www.google.com/settings/ads" target="_blank" rel="noopener">Google Ads Settings</a> or <a href="https://www.aboutads.info" target="_blank" rel="noopener">aboutads.info</a>. Visitors in the European Economic Area, the UK, and Switzerland will see a consent message from Google's certified consent management platform before personalized ads can show.</li>
      </ul>
      <p>We do not sell personal information because we do not collect any. If you contact us about the site, we use your message only to respond.</p>
    </div></section>`;
}

/* ---- Contact page (PP-ADSENSE-READINESS) ----
 * Static page, mailto link only — no form, no email capture, no
 * response-time promise (per brief open Q2/Q3). */
function contactBody() {
  // PP-GEN-DRIFT (R4a): body extracted verbatim from the committed contact.html.
  return `<section class="section"><div class="wrap">
      <p>The best way to reach the PlanPrice team is email: <a href="mailto:magimike4@gmail.com">magimike4@gmail.com</a>.</p>
      <p><strong>Good reasons to write:</strong></p>
      <ul>
        <li>A price or promotion on the site looks wrong or out of date</li>
        <li>A product or category you think we should track</li>
        <li>Questions about how we verify prices and review scores</li>
        <li>Feedback on the site itself</li>
      </ul>
      <p>We read every message. There is no contact form and no mailing list, just email.</p>
      <h2>What to include</h2>
      <p>For pricing corrections, include the vendor and plan name, the price you saw, the date you saw it, and a link to the vendor's pricing page where you saw it, that lets us re-check the correction in one pass instead of trading emails. A screenshot of the vendor's pricing page helps when the price differs by region or account type. For product or category suggestions, tell us the product name and what it does; for site feedback, tell us which page you were on and what was unclear or missing.</p>
      <p>The more specific the report, the faster the fix: "QuickBooks Online's Simple Start plan shows C$32/month on the vendor's Canadian pricing page as of October 6" is actionable in minutes, while "your QuickBooks price looks off" needs a full re-verification from scratch. If you're a vendor with a correction or a public promotion we missed, include a link to the public offer page, we only list promotions we can verify on the vendor's own site.</p>
      <h2>What happens next</h2>
      <p>Every message is read by a person on the PlanPrice team. Pricing corrections get re-checked against the vendor's own site: if the correction checks out, the page is updated and the verified date moves; if the price we show is still the one the vendor lists, we'll say so. Product suggestions go onto the tracking shortlist, and site feedback gets folded into the next round of page improvements.</p>
      <p>There's no contact form, no mailing list, and no ticket system, just email, answered by the people who maintain the pages. We won't promise a reply time we can't guarantee, but corrections that affect a published price get priority, because an out-of-date price is the one thing this site can't afford to carry.</p>
    </div></section>`;
}

const STATIC_PAGES = {
  "about.html": {
    title: "About PlanPrice | PlanPrice",
    description: "What PlanPrice is: a B2B software deals directory where every price and promotion is verified against the vendor's own site.",
    path: "/about.html",
    h1: "About PlanPrice",
    body: aboutBody()
  },
  "disclosure.html": {
    title: "Affiliate Disclosure | PlanPrice",
    description: "PlanPrice's affiliate disclosure: how we earn money and what it means for our deal listings.",
    path: "/disclosure.html",
    h1: "Affiliate Disclosure",
    body: disclosureBody()
  },
  "privacy-policy.html": {
    title: "Privacy Policy | PlanPrice",
    description: "PlanPrice privacy policy: what data we collect (almost nothing) and how we use it.",
    path: "/privacy-policy.html",
    h1: "Privacy Policy",
    body: privacyBody()
  },
  "terms.html": {
    title: "Terms of Use | PlanPrice",
    description: "PlanPrice terms of use: informational content, pricing accuracy, and affiliate relationships.",
    path: "/terms.html",
    h1: "Terms of Use",
    body: `<section class="section"><div class="wrap">
      <p><strong>Last updated: ${CHECKED}.</strong></p>
      <ul>
        <li><strong>Informational only.</strong> PlanPrice provides pricing information for reference. It is not financial, accounting, or purchasing advice.</li>
        <li><strong>Prices change.</strong> Vendors change prices and promotions without notice. We date every verification; the vendor's own pricing page is always the final authority.</li>
        <li><strong>Affiliate relationships.</strong> We may earn commissions on purchases made through links on this site, as described in our <a href="/disclosure.html">affiliate disclosure</a>.</li>
        <li><strong>No warranties.</strong> Content is provided as-is. We work to keep it accurate, but we make no guarantees about completeness or currentness.</li>
        <li><strong>Vendor trademarks</strong> belong to their respective owners. Mention of a product does not imply endorsement by the vendor.</li>
      </ul>
    </div></section>`
  },
  "contact.html": {
    title: "Contact PlanPrice | PlanPrice",
    description: "Contact the PlanPrice team by email.",
    path: "/contact.html",
    h1: "Contact PlanPrice",
    body: contactBody()
  }
};

function staticPage(file, cfg) {
  return `${head(cfg.title, cfg.description, cfg.path)}
${header(cfg.path)}
<main><div class="wrap wrap-prose"><h1 class="page-title">${esc(cfg.h1)}</h1></div>${cfg.body}</main>
${footer()}`;
}

function sitemap() {
  // PP-GEN-DRIFT (R4e): the sitemap preserves the EXISTING sitemap.xml's URL
  // set, order, and per-entry elements (changefreq/priority included) — the
  // committed sitemap lists ~150 article-guide URLs and the 12 editorial
  // compare pages that this generator does not write, and dropping them at
  // regen would de-index live pages. lastmod is refreshed to CHECKED only
  // for pages this generator itself writes; every other entry is kept
  // byte-verbatim. On a tree with no existing sitemap, fall back to the
  // generated set.
  const generatedPaths = new Set([
    "/", "/about.html", "/disclosure.html", "/privacy-policy.html", "/terms.html",
    "/contact.html", "/deals.html", "/canadian.html", "/free.html", "/top-rated.html",
    ...products.filter((p) => !p.hand_built).map((p) => `/deals/${p.slug}.html`),
    ...[...new Set(products.map((p) => `/categories/${slugify(p.category)}.html`))].sort(),
    "/compare.html",
    ...compareSets.filter((x) => !x.editorial).map((x) => `/compare/${x.slug}.html`),
    ...guidesData.map((g) => `/guides/${g.slug}.html`),
    "/glossary.html",
    ...glossaryData.map((t) => `/glossary/${t.slug}.html`),
  ]);
  const existingPath = join(ROOT, "sitemap.xml");
  if (existsSync(existingPath)) {
    const existing = readFileSync(existingPath, "utf8");
    const blocks = existing.match(/<url>[\s\S]*?<\/url>/g);
    if (blocks && blocks.length) {
      const out = blocks.map((b0) => {
        const b = "  " + b0;
        const loc = (b.match(/<loc>([^<]+)<\/loc>/) || [])[1] || "";
        const path = loc.startsWith(SITE_URL) ? loc.slice(SITE_URL.length) : loc;
        if (!generatedPaths.has(path)) return b;
        return b.replace(/<lastmod>[^<]*<\/lastmod>/, `<lastmod>${CHECKED}</lastmod>`);
      });
      return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${out.join("\n")}\n</urlset>\n`;
    }
  }
  const paths = [...generatedPaths];
  const urls = paths.map((p) => `  <url>\n    <loc>${SITE_URL}${p}</loc>\n    <lastmod>${CHECKED}</lastmod>\n  </url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

function robots() {
  return `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`;
}

let filesWritten = 0;
function write(path, content) {
  const full = join(ROOT, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, "utf8");
  filesWritten += 1;
}

write("index.html", indexPage());
// Hand-built deal pages (products.json hand_built) carry custom pricing tables
// the data model cannot reproduce (dual price columns, fee-schedule captions).
// Like the editorial compare pairs, the generator validates their data but
// never overwrites the committed page. PP-GEN-DRIFT ruling, 2026-11-10.
for (const p of products) {
  if (!p.hand_built) write(`deals/${p.slug}.html`, dealPage(p));
}
for (const [file, cfg] of Object.entries(STATIC_PAGES)) write(file, staticPage(file, cfg));

// Category browse pages (one per distinct products[].category), the compare
// index, and the head-to-head set pages (PP-SECTIONS).
for (const c of categories) write(`categories/${slugify(c)}.html`, categoryPage(c));
write("compare.html", compareIndexPage());
for (const s of compareSets) write(`compare/${s.slug}.html`, compareSetPage(s));
// Phase-2 section pages (PP-SECTIONS-PHASE2).
write("deals.html", dealsPage());
write("canadian.html", canadianPage());
// Overnight-5 collection pages (PP-OVERNIGHT-5): /free.html + /top-rated.html.
write("free.html", freePage());
write("top-rated.html", topRatedPage());
// AdSense-readiness content (PP-ADSENSE-READINESS): contact page (via
// STATIC_PAGES above), buyer's guides, and the pricing glossary.
for (const g of guidesData) write(`guides/${g.slug}.html`, guidePage(g));
// PP-GEN-DRIFT (R4e): guides.html is a hand-built grouped index of ~150
// article guides — the generator does NOT write it (or the article guide
// pages). The sitemap fallback builds its page inventory from guidesData
// directly; no rendered guides index is kept in the generator.
for (const t of glossaryData) write(`glossary/${t.slug}.html`, glossaryTermPage(t));
write("glossary.html", glossaryIndexPage());
write("sitemap.xml", sitemap());
write("robots.txt", robots());

/* Machine-readable deal index for the client-side directory filter
 * (PP-DEAL-FILTER). Enhancement only — every field also exists in the
 * static HTML; the index just makes rows addressable by slug so the
 * filter can show/hide/reorder them without re-rendering content. */
write(
  "data/deals-index.json",
  JSON.stringify(
    {
      check_date: CHECKED,
      // PP-GEN-DRIFT (R6b): the committed index derives priceText/priceSort
      // from data/compare-vendors.json "start" (paren suffix stripped,
      // "From " prefixed for price-like starts; non-price starts such as
      // "Custom" pass through). This reproduces the committed values for
      // all 22 legacy entries — including the 5 formerly tier-less products
      // and wagepoint, whose tier text differs — and extends the same
      // convention to the full 49. Fallback: price-parse on pricing_tiers.
      products: products.map((p) => {
        const cvEntry = compareVendors.get(p.slug);
        let priceText = startPriceText(p);
        let priceSort = startPriceNumeric(p);
        if (cvEntry && typeof cvEntry.start === "string" && cvEntry.start) {
          const start = cvEntry.start.replace(/\s*\(.*?\)\s*$/, "");
          const num = start.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
          priceSort = num ? parseFloat(num[0]) : null;
          priceText = /^\$|^C\$|^\d/.test(start) ? `From ${start}` : start;
        }
        return {
        slug: p.slug,
        name: p.name,
        category: p.category,
        priceText,
        priceSort,
        dealHeadline: p.deal && !isExpiredDeal(p) ? p.deal.headline : null,
        country: p.canadian ? "CA" : null,
        url: `/deals/${p.slug}.html`,
        };
      }),
    },
    null,
    1
  ) + "\n"
);

console.log(`Generated ${filesWritten} files (HTML + sitemap.xml + robots.txt + data/deals-index.json) for host ${HOST}`);
