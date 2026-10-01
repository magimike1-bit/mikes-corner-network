// PlanPrice static site generator — reads data/products.json, renders the whole site.
// Idempotent: output depends only on data + SITE_HOST. No timestamps in output.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startPriceNumeric, startPriceText } from "./price-parse.mjs";
import { slugify } from "./slugify.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOST = process.env.SITE_HOST || "staging.planprice.local";
const SITE_URL = `https://${HOST}`;
const CHECKED = "2026-09-30";

const data = JSON.parse(readFileSync(join(ROOT, "data", "products.json"), "utf8"));
const products = data.products;

/* ---- Third-party review scores (PP-REVIEW-SCORES) ----
 * data/review-scores.json: {checked: "YYYY-MM-DD", scores: {<slug>: {g2?: {score, reviews, url}, capterra?: {...}}}}.
 * A source object exists only when it was verified on a source page; a missing
 * product or missing source renders nothing (honest gap, never a guess). */
const reviewScores = JSON.parse(readFileSync(join(ROOT, "data", "review-scores.json"), "utf8"));

/* ---- Head-to-head compare sets (PP-SECTIONS) ----
 * data/compare.json: {sets: [{slug, title, products}]}. Membership is
 * explicit and authorable; new products in products.json do NOT auto-join.
 * Build FAILS on: unknown product slug, cross-category set, duplicate or
 * non-kebab slug, wrong member count (2–4), or a title that is not the
 * mechanical " vs "-join of the product names (no editorial wording). */
const productBySlug = new Map(products.map((p) => [p.slug, p]));
const compareSets = [];
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
    compareSets.push({
      slug: set.slug,
      title: set.title,
      products: members,
      category: members[0].category,
    });
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
// Compare sets whose members all belong to the category (banner lookup).
const setsForCategory = (cat) => compareSets.filter((s) => s.category === cat);

/* ---- Affiliate state (PP-AFFILIATE-CLARITY) ----
 * affiliateLive(p) is true only when a product's affiliate status is "live".
 * Until programs are approved every product is "pending-approval", and the
 * site renders the INTERIM disclosure wording: no affiliate links exist yet,
 * deal-page CTAs are inert placeholders, and no commissions are being earned.
 * The moment a product flips to "live", its deal page gets the blunt live
 * disclosure plus a real affiliate link. */
const affiliateLive = (p) => !!(p.affiliate && p.affiliate.status === "live");
const affiliateNone = (p) => !!(p.affiliate && p.affiliate.status === "none");
const anyAffiliateLive = products.some(affiliateLive);

const AFFILIATE_BLUNT =
  "The product links on PlanPrice are affiliate links: if you buy through them, we may earn a commission at no extra cost to you.";
const AFFILIATE_INTERIM =
  "PlanPrice is funded by affiliate commissions. Right now our affiliate partnerships are still being set up, so the links on this site are plain links to vendors — when affiliate links go live, this page will say so, and buying through them will never cost you extra.";

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
const expiredDeals = (ps) => ps.filter(isExpiredDeal);

// Spotlight rule (§5): product with a non-null live deal and the lowest
// sort_priority; tie → products.json array order. Omitted when none qualify.
function spotlightProduct() {
  const cands = liveDeals(products).map((p, i) => ({ p, i }));
  if (cands.length === 0) return null;
  cands.sort((a, b) => sortPriority(a.p) - sortPriority(b.p) || a.i - b.i);
  return cands[0].p;
}

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
        `      <li><a href="${esc(s.url)}" rel="noopener">${esc(label)}</a>: <strong>${esc(String(s.score))}/5</strong>${esc(reviewsText(s.reviews))}</li>`
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
  return `<p class="canadian-note">🇨🇦 Canadian company — ${founded}, headquartered in ${esc(c.hq)}.</p>`;
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
function fromPrice(p, strong = true) {
  const t = p.pricing_tiers[0];
  if (t.cadence === "quote") return esc(t.price);
  const price = strong ? `<strong>${esc(t.price)}</strong>` : esc(t.price);
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

function trustStrip() {
  const live = liveDeals(products).length;
  return `<div class="trust-strip">
  <div class="wrap trust-strip-inner">
    <span class="trust-stat"><strong>${products.length}</strong> products tracked</span>
    <span class="trust-dot" aria-hidden="true">·</span>
    <span class="trust-stat"><strong>${live}</strong> live deals</span>
    <span class="trust-dot" aria-hidden="true">·</span>
    <span class="trust-stat">Prices checked <time datetime="${CHECKED}">${CHECKED}</time></span>
  </div>
</div>`;
}

function spotlightBlock(p) {
  if (!p) return "";
  return `<section class="spotlight">
  <div class="wrap">
    <p class="kicker spotlight-kicker">Deal spotlight</p>
    <h2 class="spotlight-name"><a href="/deals/${esc(p.slug)}.html">${esc(p.name)}</a></h2>
    <p class="spotlight-deal">${esc(p.deal.headline)}</p>
    <p class="spotlight-tag">${esc(p.tagline)}</p>
    <p class="spotlight-verify">✓ Vendor-verified <time datetime="${esc(p.deal.verified_date)}">${esc(p.deal.verified_date)}</time> — source: <a href="${esc(p.deal.source_url)}" rel="noopener">${vendorHost(p.deal.source_url)}</a>.</p>
    <p><a class="btn" href="/deals/${esc(p.slug)}.html">See pricing &amp; deal</a></p>
  </div>
</section>`;
}

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

function dirRow(p) {
  const live = p.deal && !isExpiredDeal(p);
  const flags = flagBadges(p);
  return `<li class="dir-row${live ? " has-deal" : ""}" data-slug="${esc(p.slug)}">
    <div class="dir-row-main">
      <h3 class="dir-row-name"><a href="/deals/${esc(p.slug)}.html">${esc(p.name)}</a></h3>
      <p class="dir-row-tag">${esc(p.tagline)}</p>
      <p class="dir-row-best"><strong>Best for:</strong> ${esc(p.best_for)}</p>
    </div>
    <div class="dir-row-side">
      <p class="dir-row-price">${fromPrice(p)}</p>
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
    const cats = [...new Set(products.map((p) => p.category))].sort();
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
            <option value="name-asc">Name A–Z</option>
          </select>
        </label>
      </div>
      <p class="filter-count" id="f-count" aria-live="polite"></p>
    </form>`;
}

/* Homepage wrapper: the homepage filter sits in <section class="section">
 * with no .wrap of its own, so it keeps the filterBlock() wrap (byte-stable
 * output — index.html must not change beyond nav/CSS). */
function filterBlock(includeCategory = true, facets = {}) {
  return `<div class="wrap">
    ${filterForm(includeCategory, facets)}
  </div>`;
}

function directorySections() {
  const cats = [...new Set(products.map((p) => p.category))].sort();
  const sections = cats
    .map((c) => {
      const items = products
        .map((p, i) => ({ p, i }))
        .filter(({ p }) => p.category === c)
        .sort((a, b) => sortPriority(a.p) - sortPriority(b.p) || a.i - b.i);
      const rows = items.map(({ p }) => dirRow(p)).join("\n");
      return `<section class="dir-cat" id="cat-${slugify(c)}" aria-label="${esc(c)}">
    <h2 class="dir-cat-title"><a href="/categories/${slugify(c)}.html">${esc(c)}</a></h2>
    <ul class="dir-rows">${rows}</ul>
  </section>`;
    })
    .join("\n");
  return `<div class="wrap" id="all-deals">
    <h2 class="section-title">Browse all deals</h2>
    <p class="section-sub">${products.length} products, grouped by category. Every deal claim links to the vendor's own page.</p>
    ${sections}
  </div>`;
}

function compareTable() {
  const rows = products
    .map((p) => {
      const promo = p.deal && !isExpiredDeal(p)
        ? `<span class="badge deal">${esc(p.deal.headline)}</span>`
        : `<span class="badge none">No public promo</span>`;
      return `<tr>
      <th scope="row"><a href="/deals/${esc(p.slug)}.html">${esc(p.name)}</a></th>
      <td>${esc(p.category)}</td>
      <td class="price">${fromPrice(p, false)}</td>
      <td>${promo}</td>
      <td><time datetime="${esc(p.last_verified)}">${esc(p.last_verified)}</time></td>
    </tr>`;
    })
    .join("\n");
  return `<section class="compare section">
  <div class="wrap">
    <h2 class="section-title">Every deal, side by side</h2>
    <p class="section-sub">All ${products.length} products in one table — the same data as the rows above, for scanners.</p>
    <div class="compare-scroll">
    <table class="tiers compare-table">
      <caption class="sr-only">Comparison of all ${products.length} tracked products: price, promotion, and verification date.</caption>
      <thead><tr><th scope="col">Product</th><th scope="col">Category</th><th scope="col">From price</th><th scope="col">Current promo</th><th scope="col">Verified</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    </div>
  </div>
</section>`;
}

function howWeVerify() {
  return `<section class="verify-steps section">
  <div class="wrap">
    <h2 class="section-title">How we verify</h2>
    <ol class="verify-steps-list">
      <li><strong>Check the vendor's own pricing page.</strong> We read current list prices straight from the vendor's public pricing page — not a review, not an aggregator.</li>
      <li><strong>Link every deal claim.</strong> When a vendor runs a public promotion, the headline links to the vendor's own page so you can confirm the offer yourself.</li>
      <li><strong>Re-check on a schedule.</strong> Every product's prices and promos are re-verified regularly, and each page shows the date it was last checked.</li>
    </ol>
  </div>
</section>`;
}

// Conditional per §11: rendered only when the data contains expired deals.
// Empty today; the mechanism exists for the first deal that lapses.
function expiredSection() {
  const gone = expiredDeals(products);
  if (gone.length === 0) return "";
  const rows = gone.map((p) => dirRow(p)).join("\n");
  return `<section class="section expired" aria-label="Expired deals">
  <div class="wrap">
    <h2 class="section-title">Expired deals</h2>
    <p class="section-sub">Promotions we verified that have since ended. Kept on record so the archive stays honest.</p>
    <ul class="dir-rows">${rows}</ul>
  </div>
</section>`;
}

function indexPage() {
  return `${head(
    "PlanPrice — Verified B2B Software Deals & Pricing",
    "PlanPrice tracks verified list prices and current promotions for " +
    products.length +
    " essential B2B software products — accounting, CRM, ecommerce, POS, and more. Every deal is checked against the vendor's own site.",
    "/",
    "\n" + IMPACT_TAG + '\n<script src="/filter.js" defer></script>'
  )}
${header("/")}
<section class="hero">
  <div class="wrap">
    <p class="kicker">Verified pricing · Checked ${CHECKED}</p>
    <h1>B2B software deals, with the receipts.</h1>
    <p class="lead">Real list prices and current promotions — every deal claim links to the vendor's own page so you can check it yourself.</p>
  </div>
</section>
${trustStrip()}
<main>
  ${spotlightBlock(spotlightProduct())}
  <section class="section directory">
    ${filterBlock()}
    ${directorySections()}
  </section>
  ${compareTable()}
  ${howWeVerify()}
  ${expiredSection()}
</main>
${footer()}`;
}

// ---------------------------------------------------------------------------
// Deal pages
// ---------------------------------------------------------------------------

function factsStrip(p) {
  const promo = p.deal && !isExpiredDeal(p)
    ? `<span class="badge deal">${esc(p.deal.headline)}</span>`
    : "No public promo — standard list prices";
  const flags = flagBadges(p);
  const expiry = p.deal && p.deal.end_date
    ? `<div class="facts-item"><dt>Offer ends</dt><dd><time datetime="${esc(p.deal.end_date)}">${esc(p.deal.end_date)}</time></dd></div>`
    : "";
  return `<dl class="facts-strip">
    <div class="facts-item"><dt>Starting price</dt><dd>${fromPrice(p)}</dd></div>
    <div class="facts-item"><dt>Current promo</dt><dd>${promo}${flags ? " " + flags : ""}</dd></div>
    <div class="facts-item"><dt>Category</dt><dd>${esc(p.category)}</dd></div>
    <div class="facts-item"><dt>Verified</dt><dd><time datetime="${esc(p.last_verified)}">${esc(p.last_verified)}</time></dd></div>
    <div class="facts-item"><dt>Vendor</dt><dd><a href="${esc(p.vendor_homepage)}" rel="noopener">${vendorHost(p.vendor_homepage)}</a></dd></div>
    ${expiry}
  </dl>`;
}

function verificationBox(p) {
  const base = `<aside class="verify">
      <h2>Deal verification</h2>`;
  if (p.deal && !isExpiredDeal(p)) {
    const expiry = p.deal.end_date
      ? `<p class="verify-expiry">Vendor offer ends <time datetime="${esc(p.deal.end_date)}">${esc(p.deal.end_date)}</time>.</p>`
      : "";
    return `${base}
      <p class="verify-headline">${esc(p.deal.headline)}</p>
      <p class="verify-src">Source: <a href="${esc(p.deal.source_url)}" rel="noopener">${vendorHost(p.deal.source_url)}</a> — checked <time datetime="${esc(p.deal.verified_date)}">${esc(p.deal.verified_date)}</time>.</p>
      ${expiry}<p class="verify-note">Promotions change. Confirm the current offer on the vendor's page before buying.</p>
    </aside>`;
  }
  if (p.deal && isExpiredDeal(p)) {
    return `${base}
      <p class="verify-headline">${esc(p.deal.headline)}</p>
      <p class="verify-note">This promotion ended <time datetime="${esc(p.deal.end_date)}">${esc(p.deal.end_date)}</time>. Prices below are standard list.</p>
    </aside>`;
  }
  return `${base}
      <p>No public promotion found (checked ${CHECKED}). Prices below are standard list.</p>
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

function pricingTable(p) {
  const rows = p.pricing_tiers.map(t => `<tr>
      <th scope="row">${esc(t.name)}</th>
      <td class="price">${esc(t.price)}</td>
      <td>${esc(t.cadence)}</td>
      <td>${esc(t.notes)}</td>
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
      <p class="fine">Always confirm on the vendor's pricing page before purchasing — plans and prices change.</p>
    </section>`;
}

/* PP-NON-AFFILIATE-VENDORS: products with affiliate status "none" get a
 * plain outbound button — never "sponsored", never an affiliate URL — plus a
 * blunt no-relationship line. Pending-approval behavior below is unchanged. */
function cta(p) {
  if (affiliateLive(p)) {
    if (p.affiliate.url) {
      return `<a href="${esc(p.affiliate.url)}" class="btn affiliate-cta" data-program="${esc(p.affiliate.program)}" rel="sponsored noopener">Check the current price</a>
    <p class="fine">${AFFILIATE_BLUNT} See our <a href="/disclosure.html">affiliate disclosure</a>.</p>`;
    }
    console.warn(`WARN: ${p.slug} has a live affiliate status but no affiliate URL in data — rendering the placeholder CTA.`);
  }
  if (affiliateNone(p)) {
    return `<a href="${esc(p.vendor_homepage)}" class="btn vendor-cta" rel="noopener">Visit ${esc(p.name)} →</a>
    <p class="fine no-affiliate">PlanPrice has no affiliate relationship with ${esc(p.name)} — we earn nothing if you choose them.</p>`;
  }
  return `<!-- AFFILIATE PLACEHOLDER: light when Joseph approves -->
    <a href="#" class="btn affiliate-cta" data-program="${esc(p.affiliate.program)}" data-status="pending-approval">Check the current price</a>
    <p class="fine">Affiliate link pending approval — this button is inert for now. See our <a href="/disclosure.html">affiliate disclosure</a>.</p>`;
}

function relatedRows(p) {
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
      <p class="dir-row-price">${fromPrice(r)}</p>
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
  return `${head(
    `${p.name} Pricing & Deals (Verified ${p.last_verified}) — PlanPrice`,
    `${p.name} verified list pricing and current promotions. ${p.tagline} Checked ${p.last_verified} by the PlanPrice research team.`,
    `/deals/${p.slug}.html`
  )}
${header("/")}
<main>
  <div class="wrap">
    <p class="breadcrumbs"><a href="/">All deals</a> › ${esc(p.name)}</p>
    <article class="product">
      <p class="card-cat">${esc(p.category)}</p>
      <h1>${esc(p.name)}</h1>
      <p class="lead">${esc(p.tagline)}</p>
      ${canadianLine(p)}
      <div class="facts-wrap">
        ${factsStrip(p)}
      </div>
      <section class="section overview">
        ${p.similar_to ? `<p class="similar-to">Think of it as: <strong>${esc(p.similar_to)}</strong>.</p>` : ""}
        <p>${esc(p.description)}</p>
        <p><strong>Best for:</strong> ${esc(p.best_for)}</p>
      </section>
      ${pricingTable(p)}
      ${reviewsSection(p)}
      ${scoreSection(p)}
      ${verificationBox(p)}
      ${claimBlock(p)}
      <section class="section cta-block">
        ${cta(p)}
      </section>
      ${relatedRows(p)}
    </article>
  </div>
</main>
${footer()}`;
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
    `${c} Pricing & Deals — PlanPrice`,
    `${c} software: verified pricing and current promotions. ${n} product${plural} tracked, checked ${CHECKED}.`,
    `/categories/${slugify(c)}.html`,
    '\n<script src="/filter.js" defer></script>'
  )}
${header(null)}
<main>
  <div class="wrap" id="all-deals">
    <p class="breadcrumbs"><a href="/">All deals</a> › ${esc(c)}</p>
    <h1 class="page-title">${esc(c)}</h1>
    <p class="section-sub">${n} product${plural} tracked · prices checked <time datetime="${CHECKED}">${CHECKED}</time></p>
    ${h2hBannerLink(c)}
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
  const items = compareSets
    .map((s) => `<li class="compare-row">
      <h2 class="compare-row-title"><a href="/compare/${esc(s.slug)}.html">${esc(s.title)}</a></h2>
      <p class="compare-row-meta">${esc(s.category)} · ${s.products.length} products</p>
    </li>`)
    .join("\n");
  return `${head(
    "Compare — PlanPrice",
    `Head-to-head comparisons of rival B2B software: verified pricing, current deals, and user feedback side by side. ${compareSets.length} comparisons tracked.`,
    "/compare.html"
  )}
${header("/compare.html")}
<main>
  <div class="wrap">
    <p class="breadcrumbs"><a href="/">All deals</a> › Compare</p>
    <h1 class="page-title">Compare</h1>
    <p class="section-sub">${compareSets.length} head-to-head comparisons tracked</p>
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
 * components and strings as the deal pages. */
function compareSetPage(set) {
  const cols = set.products
    .map((p) => `<section class="compare-col" id="cmp-${esc(p.slug)}" aria-label="${esc(p.name)}">
      <h2 class="compare-col-name"><a href="/deals/${esc(p.slug)}.html">${esc(p.name)}</a></h2>
      ${fitBlock(p)}
      ${factsStrip(p)}
      ${pricingTable(p)}
      ${reviewsSection(p)}
      ${scoreSection(p)}
    </section>`)
    .join("\n");
  return `${head(
    `${set.title} — PlanPrice`,
    `${set.title}: compare verified pricing, current deals, and user feedback side by side. Prices checked ${CHECKED}.`,
    `/compare/${set.slug}.html`
  )}
${header("/compare.html")}
<main>
  <div class="wrap">
    <p class="breadcrumbs"><a href="/compare.html">Compare</a> › ${esc(set.title)}</p>
    <h1 class="page-title">${esc(set.title)}</h1>
    <p class="section-sub">${set.products.length} products, side by side · prices checked <time datetime="${CHECKED}">${CHECKED}</time></p>
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
    "Current promos — PlanPrice",
    `Current promotions on B2B software: ${n} active promo${plural}, verified against vendor sites. Checked ${CHECKED}.`,
    "/deals.html",
    '\n<script src="/filter.js" defer></script>'
  )}
${header("/deals.html")}
<main>
  <div class="wrap" id="all-deals">
    <p class="breadcrumbs"><a href="/">All deals</a> › Current promos</p>
    <h1 class="page-title">Current promos</h1>
    <p class="section-sub">${n} active promo${plural} · prices checked <time datetime="${CHECKED}">${CHECKED}</time></p>
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
    "Canadian vendors — PlanPrice",
    `Canadian B2B software vendors: ${n} verified Canadian ${n === 1 ? "company" : "companies"} — list prices and promos checked ${CHECKED}.`,
    "/canadian.html",
    '\n<script src="/filter.js" defer></script>'
  )}
${header("/canadian.html")}
<main>
  <div class="wrap" id="all-deals">
    <p class="breadcrumbs"><a href="/">All deals</a> › Canadian vendors</p>
    <h1 class="page-title">Canadian vendors</h1>
    <p class="section-sub">${n} Canadian vendor${plural} · prices checked <time datetime="${CHECKED}">${CHECKED}</time></p>
    ${filterForm(false, { canadian: false })}
    <section class="dir-cat" id="cat-canadian" aria-label="Canadian vendors">
      <ul class="dir-rows">${rows}</ul>
    </section>
  </div>
</main>
${footer()}`;
}

// ---------------------------------------------------------------------------
// Shared chrome — disclosure banner + footer text are byte-identical to v1.
// ---------------------------------------------------------------------------

function head(title, description, path, extraHead = "") {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(SITE_URL + path)}">
<link rel="stylesheet" href="/style.css">
<link rel="icon" type="image/png" href="/favicon.png">
<!-- AdSense: ad code goes here -->${extraHead}${beaconTag()}
</head>`;}

/* Cloudflare Web Analytics beacon (PP-ANALYTICS). Returns "" while
 * CF_BEACON_TOKEN is empty — the beacon is inert until Joseph pastes the
 * token, and empty-token output stays byte-identical to pre-beacon builds. */
function beaconTag() {
  if (!CF_BEACON_TOKEN) return "";
  return `\n<!-- Cloudflare Web Analytics --><script defer src="https://static.cloudflare.com/beacon.min.js" data-cf-beacon='{"token": "${esc(CF_BEACON_TOKEN)}"}'></script>`;
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
    : `PlanPrice is setting up affiliate partnerships — right now, links on this page are plain vendor links. <a href="/disclosure.html">Read our affiliate disclosure</a>.`
}</div>
<header class="site-header">
  <div class="wrap header-inner">
    <a class="brand" href="/"><img src="/logo.svg" alt="PlanPrice" height="34"></a>
    <nav class="main-nav">
      ${nav("/", "All deals")}
      ${nav("/deals.html", "Deals")}
      ${nav("/canadian.html", "Canadian")}
      ${nav("/compare.html", "Compare")}
      ${nav("/disclosure.html", "Disclosure")}
      ${nav("/about.html", "About")}
    </nav>
  </div>
</header>`;
}

function footer() {
  return `<footer class="site-footer">
  <div class="wrap">
    <p class="footer-brand">PlanPrice — verified B2B software pricing and deals.</p>
    <nav class="footer-nav">
      <a href="/about.html">About</a>
      <a href="/disclosure.html">Affiliate disclosure</a>
      <a href="/privacy-policy.html">Privacy</a>
      <a href="/terms.html">Terms</a>
    </nav>
    <p class="fine">Prices verified ${CHECKED} by the PlanPrice research team. Always confirm current pricing on the vendor's own site before buying. ${
      anyAffiliateLive
        ? "PlanPrice may earn a commission on qualifying purchases."
        : "PlanPrice currently earns no affiliate commissions — partnerships are still being set up."
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
  return `<section class="section"><div class="wrap">
      <p>PlanPrice is a deals directory for business software. We track list prices and current promotions for the tools small businesses actually buy — accounting, CRM, ecommerce, point of sale, scheduling, and more.</p>
      <p><strong>Our standard:</strong> every discount headline on this site links to the vendor's own page. If we couldn't find a public promotion, the page says so plainly instead of dressing up standard list prices as a deal.</p>
      <p><strong>Review scores:</strong> deal pages show aggregate user ratings from third-party review sites (G2 and Capterra) — these are not PlanPrice's own ratings. We re-check every score during the monthly verification sweep; each score shows its source and the date it was last checked.</p>
      <p>Prices are checked by the PlanPrice research team and dated. Vendors change prices and promotions without notice, so always confirm on the vendor's pricing page before purchasing.</p>
      ${funding}
    </div></section>`;
}

function disclosureBody() {
  const status = anyAffiliateLive
    ? `<p>PlanPrice is reader-supported. ${AFFILIATE_BLUNT}</p>`
    : `<p><strong>Current status: no affiliate links are live yet.</strong> PlanPrice is reader-supported: our plan is to fund the site through affiliate commissions. Right now our affiliate partnerships are still being set up, so the links on this site are plain links to vendors — no commissions are being earned. When affiliate links go live, this page will say so, and buying through them will never cost you extra.</p>`;
  const statusBullet = anyAffiliateLive
    ? `<li>We label affiliate links as affiliate links. If a link earns us a commission, the page says so.</li>`
    : `<li>Right now, zero commissions are being earned. Deal-page buttons are either inert placeholders marked "Affiliate link pending approval" or plain outbound links to vendors we have no affiliate relationship with — either way, no commissions are earned, and outbound links go straight to the vendor.</li>`;
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
          : "affiliate partnerships are being established — buttons on deal pages are placeholders until programs are approved. No commissions are being earned yet."
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
    ? `<li><strong>No cookies set by us.</strong> We measure site visits with Cloudflare Web Analytics — a cookieless, privacy-first measurement tool that sets no cookies and collects no personal data.</li>`
    : `<li><strong>No cookies set by us.</strong> Our pages do not use analytics cookies or tracking pixels.</li>`;
  return `<section class="section"><div class="wrap">
      <p><strong>Last updated: ${CHECKED}.</strong></p>
      <p>PlanPrice is a static informational site. We collect almost nothing:</p>
      <ul>
        <li><strong>No accounts, no signups, no email capture.</strong> There is nothing to subscribe to and nothing to log into.</li>
        ${analytics}
        <li><strong>Third parties.</strong> Our hosting provider may log basic server data (IP address, pages requested) for security. When affiliate links go live, clicking one takes you to the vendor's site, which is governed by that vendor's privacy policy — not ours.</li>
      </ul>
      <p>We do not sell personal information because we do not collect any. If you contact us about the site, we use your message only to respond.</p>
    </div></section>`;
}

const STATIC_PAGES = {
  "about.html": {
    title: "About PlanPrice — PlanPrice",
    description: "What PlanPrice is: a B2B software deals directory where every price and promotion is verified against the vendor's own site.",
    path: "/about.html",
    h1: "About PlanPrice",
    body: aboutBody()
  },
  "disclosure.html": {
    title: "Affiliate Disclosure — PlanPrice",
    description: "PlanPrice's affiliate disclosure: how we earn money and what it means for our deal listings.",
    path: "/disclosure.html",
    h1: "Affiliate Disclosure",
    body: disclosureBody()
  },
  "privacy-policy.html": {
    title: "Privacy Policy — PlanPrice",
    description: "PlanPrice privacy policy: what data we collect (almost nothing) and how we use it.",
    path: "/privacy-policy.html",
    h1: "Privacy Policy",
    body: privacyBody()
  },
  "terms.html": {
    title: "Terms of Use — PlanPrice",
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
  }
};

function staticPage(file, cfg) {
  return `${head(cfg.title, cfg.description, cfg.path)}
${header(cfg.path)}
<main><div class="wrap wrap-prose"><h1 class="page-title">${esc(cfg.h1)}</h1></div>${cfg.body}</main>
${footer()}`;
}

function sitemap() {
  const paths = ["/", "/about.html", "/disclosure.html", "/privacy-policy.html", "/terms.html",
    "/deals.html", "/canadian.html",
    ...products.map(p => `/deals/${p.slug}.html`),
    ...[...new Set(products.map(p => `/categories/${slugify(p.category)}.html`))].sort(),
    "/compare.html",
    ...compareSets.map(s => `/compare/${s.slug}.html`)];
  const urls = paths.map(p => `  <url>\n    <loc>${SITE_URL}${p}</loc>\n    <lastmod>${CHECKED}</lastmod>\n  </url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

function robots() {
  return `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`;
}

function write(path, content) {
  const full = join(ROOT, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, "utf8");
}

write("index.html", indexPage());
for (const p of products) write(`deals/${p.slug}.html`, dealPage(p));
for (const [file, cfg] of Object.entries(STATIC_PAGES)) write(file, staticPage(file, cfg));

// Category browse pages (one per distinct products[].category), the compare
// index, and the head-to-head set pages (PP-SECTIONS).
const categories = [...new Set(products.map((p) => p.category))].sort();
for (const c of categories) write(`categories/${slugify(c)}.html`, categoryPage(c));
write("compare.html", compareIndexPage());
for (const s of compareSets) write(`compare/${s.slug}.html`, compareSetPage(s));
// Phase-2 section pages (PP-SECTIONS-PHASE2).
write("deals.html", dealsPage());
write("canadian.html", canadianPage());
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
      products: products.map((p) => ({
        slug: p.slug,
        name: p.name,
        category: p.category,
        priceText: startPriceText(p),
        priceSort: startPriceNumeric(p),
        dealHeadline: p.deal && !isExpiredDeal(p) ? p.deal.headline : null,
        country: p.canadian ? "CA" : null,
        url: `/deals/${p.slug}.html`,
      })),
    },
    null,
    2
  ) + "\n"
);

console.log(`Generated ${1 + products.length + Object.keys(STATIC_PAGES).length + categories.length + 1 + compareSets.length + 2} HTML files + sitemap.xml + robots.txt + data/deals-index.json for host ${HOST}`);
