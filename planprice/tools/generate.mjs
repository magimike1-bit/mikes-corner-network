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

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function dealBadge(p) {
  if (p.deal) {
    return `<span class="badge deal">${esc(p.deal.headline.split("(")[0].trim())}</span>`;
  }
  return `<span class="badge none">No current promo</span>`;
}

function verificationBox(p) {
  if (p.deal) {
    return `<aside class="verify">
      <h2>Deal verification</h2>
      <p class="verify-headline">${esc(p.deal.headline)}</p>
      <p class="verify-src">Source: <a href="${esc(p.deal.source_url)}" rel="noopener">${esc(new URL(p.deal.source_url).hostname)}</a> — checked <time datetime="${esc(p.deal.verified_date)}">${esc(p.deal.verified_date)}</time>.</p>
      <p class="verify-note">Promotions change. Confirm the current offer on the vendor's page before buying.</p>
    </aside>`;
  }
  return `<aside class="verify">
      <h2>Deal verification</h2>
      <p>No public promotion found (checked ${CHECKED}). Prices below are standard list.</p>
    </aside>`;
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
      <table class="tiers">
        <caption>${esc(p.name)} list prices, verified ${esc(p.last_verified)}.</caption>
        <thead><tr><th scope="col">Plan</th><th scope="col">Price</th><th scope="col">Cadence</th><th scope="col">Notes</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="fine">Always confirm on the vendor's pricing page before purchasing — plans and prices change.</p>
    </section>`;
}

function cta(p) {
  return `<!-- AFFILIATE PLACEHOLDER: light when Joseph approves -->
    <a href="#" class="btn affiliate-cta" data-program="${esc(p.affiliate.program)}" data-status="pending-approval">Check the current price</a>
    <p class="fine">Affiliate link pending approval — this button is inert for now. See our <a href="/disclosure.html">affiliate disclosure</a>.</p>`;
}

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

function card(p) {
  const start = p.pricing_tiers[0];
  return `<article class="card">
    <p class="card-cat">${esc(p.category)}</p>
    <h3><a href="/deals/${esc(p.slug)}.html">${esc(p.name)}</a></h3>
    <p class="card-tag">${esc(p.tagline)}</p>
    <p class="card-price">From <strong>${esc(start.price)}</strong> ${esc(start.cadence)}</p>
    ${dealBadge(p)}
    <p><a class="btn small" href="/deals/${esc(p.slug)}.html">View deal &amp; pricing</a></p>
  </article>`;
}

function indexPage() {
  const cards = products.map(card).join("\n");
  const cats = [...new Set(products.map(p => p.category))].sort();
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
    <p class="lead">We list real list prices and current promotions for the software small businesses actually buy — and every discount claim links to the vendor's own page so you can check it yourself.</p>
  </div>
</section>
<main>
  <section class="section" id="deals">
    <div class="wrap">
      <h2 class="section-title">All deals <span class="count">(${products.length} products)</span></h2>
      <p class="section-sub">Categories: ${cats.map(esc).join(" · ")}</p>
      <div class="card-grid">${cards}</div>
    </div>
  </section>
</main>
${footer()}`;
}

function dealPage(p) {
  const related = products
    .filter(q => q.slug !== p.slug)
    .sort((a, b) => Number(b.category === p.category) - Number(a.category === p.category))
    .slice(0, 3)
    .map(r => `<li><a href="/deals/${esc(r.slug)}.html">${esc(r.name)}</a> — ${esc(r.tagline)}</li>`)
    .join("\n");
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
      ${dealBadge(p)}
      <section class="section">
        <p>${esc(p.description)}</p>
        <p><strong>Best for:</strong> ${esc(p.best_for)}</p>
        <p><strong>Vendor site:</strong> <a href="${esc(p.vendor_homepage)}" rel="noopener">${esc(new URL(p.vendor_homepage).hostname)}</a></p>
      </section>
      ${pricingTable(p)}
      ${verificationBox(p)}
      <section class="section cta-block">
        ${cta(p)}
      </section>
      <aside class="section related">
        <h2>Related deals</h2>
        <ul>${related}</ul>
      </aside>
    </article>
  </div>
</main>
${footer()}`;
}

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
<main><div class="wrap"><h1 class="page-title">${esc(cfg.h1)}</h1></div>${cfg.body}</main>
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
