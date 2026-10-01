// lint-invented-strings.mjs — PP-SECTIONS acceptance: zero invented strings.
// Extracts text nodes from the NEW generated pages (categories/*,
// compare.html, compare/*), normalizes whitespace, and asserts every
// sentence is either a substring of the verified corpus (products.json +
// review-scores.json + compare.json + all pre-existing page text) or a
// whitelisted mechanical string (counts, dates, vs-joined titles, nav
// words). Exits non-zero on the first invented sentence found.
//
// Usage: node tools/lint-invented-strings.mjs
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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
for (const f of ["products.json", "review-scores.json", "compare.json"]) {
  const strings = [];
  collectStrings(JSON.parse(readFileSync(join(DATA, f), "utf8")), strings);
  corpusParts.push(strings.map(norm).join("\n"));
}

// All pre-existing page text (everything except the 13 new pages): the new
// pages reuse header/footer/dir-row/facts-strip/pricing/reviews/scores
// components, so any sentence they render from those must already appear.
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
  if (rel.startsWith("categories/") || rel.startsWith("compare/") || rel === "compare.html")
    continue;
  corpusParts.push(extractText(readFileSync(f, "utf8")).text);
}
const corpus = norm(corpusParts.join("\n"));

// ---- mechanical allowlist (no verdicts, no copy — counts/dates/titles) ----
const products = JSON.parse(readFileSync(join(DATA, "products.json"), "utf8")).products;
const compare = JSON.parse(readFileSync(join(DATA, "compare.json"), "utf8"));
const categories = [...new Set(products.map((p) => p.category))];
const names = products.map((p) => p.name);
const setTitles = compare.sets.map((s) => s.title);
const dateRe = String.raw`\d{4}-\d{2}-\d{2}`;

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
];

const isMechanical = (s) => mechanical.some((re) => re.test(s));

// ---- lint the 13 new pages ------------------------------------------------
const newPages = [];
for (const c of categories) newPages.push(`categories/${c.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}.html`);
newPages.push("compare.html");
for (const s of compare.sets) newPages.push(`compare/${s.slug}.html`);

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
