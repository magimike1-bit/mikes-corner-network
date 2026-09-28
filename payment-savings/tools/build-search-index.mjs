#!/usr/bin/env node
/* build-search-index.mjs — generates data/search-index.json for the site-wide
 * client-side search (search.html). Runs as part of tools/build-assets.mjs so
 * new pages are picked up by the normal build flow; can also run standalone.
 *
 * Scope: every *.html in payment-savings/. account.html is indexed by title
 * only (no user-specific content exists — it is all static, but its logged-in
 * dashboard copy is not worth searching).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + "/../";

function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&rsquo;|&#39;/g, "'").replace(/&lsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;|&#8220;|&#8221;/g, '"')
    .replace(/&mdash;|&#8212;/g, "—").replace(/&ndash;/g, "–")
    .replace(/&amp;/g, "&").replace(/&nbsp;/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ").trim();
}

function first(re, html) {
  const m = html.match(re);
  return m ? stripTags(m[1]).trim() : "";
}

function buildSearchIndex() {
  const pages = fs.readdirSync(ROOT).filter(f => f.endsWith(".html")).sort();
  const index = [];
  for (const page of pages) {
    const html = fs.readFileSync(path.join(ROOT, page), "utf8");
    const title = first(/<title>([\s\S]*?)<\/title>/i, html) || page;
    const desc = first(/<meta\s+name="description"\s+content="([\s\S]*?)"/i, html);
    const entry = { url: page, title, desc: desc || "" };
    if (page === "account.html") { entry.titleOnly = true; index.push(entry); continue; }
    const headings = [];
    for (const m of html.matchAll(/<h[123][^>]*>([\s\S]*?)<\/h[123]>/gi)) {
      const t = stripTags(m[1]).trim();
      if (t && headings.indexOf(t) === -1) headings.push(t);
    }
    entry.headings = headings.slice(0, 12);
    const body = first(/<body[^>]*>([\s\S]*)<\/body>/i, html) || stripTags(html);
    entry.text = body.slice(0, 6000);
    entry.excerpt = body.slice(0, 600);
    index.push(entry);
  }
  const out = path.join(ROOT, "data", "search-index.json");
  fs.writeFileSync(out, JSON.stringify(index, null, 1) + "\n");
  console.log("data/search-index.json (" + index.length + " pages)");
  return index;
}

const directRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (directRun) buildSearchIndex();

export { buildSearchIndex };
