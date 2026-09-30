// PlanPrice static site generator — reads data/products.json, renders the whole site.
// Idempotent: output depends only on data + SITE_HOST. No timestamps in output.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOST = process.env.SITE_HOST || "staging.planprice.local";
const SITE_URL = `https://${HOST}`;
const CHECKED = "2026-09-30";

const data = JSON.parse(readFileSync(join(ROOT, "data", "products.json"), "utf8"));
const products = data.products;

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

function dirRow(p) {
  const live = p.deal && !isExpiredDeal(p);
  return `<li class="dir-row${live ? " has-deal" : ""}">
    <div class="dir-row-main">
      <h3 class="dir-row-name"><a href="/deals/${esc(p.slug)}.html">${esc(p.name)}</a></h3>
      <p class="dir-row-tag">${esc(p.tagline)}</p>
      <p class="dir-row-best"><strong>Best for:</strong> ${esc(p.best_for)}</p>
    </div>
    <div class="dir-row-side">
      <p class="dir-row-price">${fromPrice(p)}</p>
      <p class="dir-row-badge">${dealBadge(p)} <span class="verified-pill">✓ Verified ${esc(p.last_verified)}</span></p>
    </div>
  </li>`;
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
      return `<section class="dir-cat" aria-label="${esc(c)}">
    <h2 class="dir-cat-title">${esc(c)}</h2>
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
    "PlanPrice tracks verified list prices and current promotions for 12 essential B2B software products — accounting, CRM, ecommerce, POS, and more. Every deal is checked against the vendor's own site.",
    "/"
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
  const expiry = p.deal && p.deal.end_date
    ? `<div class="facts-item"><dt>Offer ends</dt><dd><time datetime="${esc(p.deal.end_date)}">${esc(p.deal.end_date)}</time></dd></div>`
    : "";
  return `<dl class="facts-strip">
    <div class="facts-item"><dt>Starting price</dt><dd>${fromPrice(p)}</dd></div>
    <div class="facts-item"><dt>Current promo</dt><dd>${promo}</dd></div>
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

function cta(p) {
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
  return `<aside class="section related">
        <h2>Related deals</h2>
        <ul class="dir-rows">${rel}</ul>
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
      <div class="facts-wrap">
        ${factsStrip(p)}
      </div>
      <section class="section overview">
        <p>${esc(p.description)}</p>
        <p><strong>Best for:</strong> ${esc(p.best_for)}</p>
      </section>
      ${pricingTable(p)}
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
// Shared chrome — disclosure banner + footer text are byte-identical to v1.
// ---------------------------------------------------------------------------

function head(title, description, path) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(SITE_URL + path)}">
<link rel="stylesheet" href="/style.css">
<!-- AdSense: ad code goes here -->
</head>`;
}

function header(active) {
  const nav = (href, label) =>
    `<a href="${href}"${active === href ? ' class="active"' : ""}>${label}</a>`;
  return `<body>
<div class="disclosure-bar">PlanPrice may earn a commission if you buy through links on this page. <a href="/disclosure.html">Read our affiliate disclosure</a>.</div>
<header class="site-header">
  <div class="wrap header-inner">
    <a class="brand" href="/"><span class="brand-mark">P</span> PlanPrice</a>
    <nav class="main-nav">
      ${nav("/", "Deals")}
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
    <p class="fine">Prices verified ${CHECKED} by the PlanPrice research team. Always confirm current pricing on the vendor's own site before buying. PlanPrice may earn a commission on qualifying purchases.</p>
  </div>
</footer>
</body>
</html>`;
}

// Static-page bodies are byte-identical to v1 (new CSS containers only).
const STATIC_PAGES = {
  "about.html": {
    title: "About PlanPrice — PlanPrice",
    description: "What PlanPrice is: a B2B software deals directory where every price and promotion is verified against the vendor's own site.",
    path: "/about.html",
    h1: "About PlanPrice",
    body: `<section class="section"><div class="wrap">
      <p>PlanPrice is a deals directory for business software. We track list prices and current promotions for the tools small businesses actually buy — accounting, CRM, ecommerce, point of sale, scheduling, and more.</p>
      <p><strong>Our standard:</strong> every discount headline on this site links to the vendor's own page. If we couldn't find a public promotion, the page says so plainly instead of dressing up standard list prices as a deal.</p>
      <p>Prices are checked by the PlanPrice research team and dated. Vendors change prices and promotions without notice, so always confirm on the vendor's pricing page before purchasing.</p>
      <p>PlanPrice is funded by affiliate commissions: when you buy through a link on this site, we may earn a commission at no extra cost to you. See our <a href="/disclosure.html">affiliate disclosure</a> for the full explanation.</p>
    </div></section>`
  },
  "disclosure.html": {
    title: "Affiliate Disclosure — PlanPrice",
    description: "PlanPrice's affiliate disclosure: how we earn money and what it means for our deal listings.",
    path: "/disclosure.html",
    h1: "Affiliate Disclosure",
    body: `<section class="section"><div class="wrap">
      <p>PlanPrice is reader-supported. When you buy through links on our site, we may earn an affiliate commission from the vendor — at no additional cost to you.</p>
      <p><strong>What this means in practice:</strong></p>
      <ul>
        <li>Commissions never change the prices we list. The prices shown are the vendor's own list prices.</li>
        <li>Commissions never create deals out of thin air. Every promotion we headline links to the vendor's own page, and pages with no public promotion say so explicitly.</li>
        <li>Our verification standard (a live source link for every deal claim) applies whether or not we have an affiliate relationship with a vendor.</li>
      </ul>
      <p>As of our current check (${CHECKED}), affiliate partnerships are being established — buttons on deal pages are placeholders until programs are approved. No commissions are being earned yet.</p>
      <p>If you have questions about how we make money, this page is the answer: affiliate commissions, fully disclosed, never at your expense.</p>
    </div></section>`
  },
  "privacy-policy.html": {
    title: "Privacy Policy — PlanPrice",
    description: "PlanPrice privacy policy: what data we collect (almost nothing) and how we use it.",
    path: "/privacy-policy.html",
    h1: "Privacy Policy",
    body: `<section class="section"><div class="wrap">
      <p><strong>Last updated: ${CHECKED}.</strong></p>
      <p>PlanPrice is a static informational site. We collect almost nothing:</p>
      <ul>
        <li><strong>No accounts, no signups, no email capture.</strong> There is nothing to subscribe to and nothing to log into.</li>
        <li><strong>No cookies set by us.</strong> Our pages do not use analytics cookies or tracking pixels.</li>
        <li><strong>Third parties.</strong> Our hosting provider may log basic server data (IP address, pages requested) for security. When affiliate links go live, clicking one takes you to the vendor's site, which is governed by that vendor's privacy policy — not ours.</li>
      </ul>
      <p>We do not sell personal information because we do not collect any. If you contact us about the site, we use your message only to respond.</p>
    </div></section>`
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
    ...products.map(p => `/deals/${p.slug}.html`)];
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
write("sitemap.xml", sitemap());
write("robots.txt", robots());

console.log(`Generated ${1 + products.length + Object.keys(STATIC_PAGES).length} HTML files + sitemap.xml + robots.txt for host ${HOST}`);
