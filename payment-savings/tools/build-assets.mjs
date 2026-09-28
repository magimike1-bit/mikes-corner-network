#!/usr/bin/env node
/* build-assets.mjs — cache-friendly asset build for the payment-savings simulator.
 *
 * Workflow: edit js/ or css/ or data/ -> run `node tools/build-assets.mjs`
 * -> commit the regenerated assets/ + simulator.html.
 *
 * What it does:
 *  1. Content-hashes js/*.js and css/*.css -> assets/js/<name>.<hash8>.js,
 *     assets/<name>.<hash8>.css. Unchanged files keep their hashes across
 *     deploys, so browsers only re-download what actually changed.
 *  2. Rewrites relative `from './x.js'` imports inside the hashed copies to
 *     point at the hashed filenames.
 *  3. Stamps per-file data/*.json content hashes into the hashed data.js copy
 *     (DATA_VERSIONS), so edited JSON is re-fetched but untouched JSON stays cached.
 *  4. Rewrites the simulator.html asset references to the hashed filenames.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = "/home/hatch/workspace/sites/github-network/payment-savings";
const hash8 = buf => crypto.createHash("sha1").update(buf).digest("hex").slice(0, 8);

// clean previous build
for (const d of ["assets", "assets/js"]) fs.mkdirSync(path.join(ROOT, d), { recursive: true });
for (const f of fs.readdirSync(path.join(ROOT, "assets/js"))) fs.unlinkSync(path.join(ROOT, "assets/js", f));
for (const f of fs.readdirSync(path.join(ROOT, "assets")))
  if (f.endsWith(".css")) fs.unlinkSync(path.join(ROOT, "assets", f));

// hash sources
const jsFiles = fs.readdirSync(path.join(ROOT, "js")).filter(f => f.endsWith(".js"));
const cssFiles = fs.readdirSync(path.join(ROOT, "css")).filter(f => f.endsWith(".css"));
const jsHash = {}, cssHash = {};
for (const f of jsFiles) jsHash[f] = hash8(fs.readFileSync(path.join(ROOT, "js", f)));
for (const f of cssFiles) cssHash[f] = hash8(fs.readFileSync(path.join(ROOT, "css", f)));

// per-file data versions
const dataVersions = {};
for (const f of fs.readdirSync(path.join(ROOT, "data")).filter(f => f.endsWith(".json")))
  dataVersions[f] = hash8(fs.readFileSync(path.join(ROOT, "data", f)));

// write hashed JS with rewritten imports + data versions
for (const f of jsFiles) {
  let src = fs.readFileSync(path.join(ROOT, "js", f), "utf8");
  src = src.replace(/from\s+['"]\.\/([a-z0-9-]+\.js)['"]/g, (m, dep) => {
    if (!jsHash[dep]) throw new Error("unknown js dep: " + dep + " in " + f);
    return `from './${dep.replace(/\.js$/, "")}.${jsHash[dep]}.js'`;
  });
  if (f === "data.js") {
    const map = "const DATA_VERSIONS = " + JSON.stringify(dataVersions) + ";";
    if (!src.includes("const DATA_VERSIONS = {};")) throw new Error("DATA_VERSIONS hook missing in data.js");
    src = src.replace("const DATA_VERSIONS = {};", map);
  }
  const out = f.replace(/\.js$/, "") + "." + jsHash[f] + ".js";
  fs.writeFileSync(path.join(ROOT, "assets/js", out), src);
  console.log("assets/js/" + out);
}
// write hashed CSS
for (const f of cssFiles) {
  const out = f.replace(/\.css$/, "") + "." + cssHash[f] + ".css";
  fs.copyFileSync(path.join(ROOT, "css", f), path.join(ROOT, "assets", out));
  console.log("assets/" + out);
}

// ---- page manifest: which entry modules + css each page needs.
// The build rewrites unhashed `assets/js/<name>.js` / `assets/<name>.css`
// references in each page to their content-hashed filenames. site-auth.js
// (header sign-in widget) is injected on every page.
const PAGES = {
  "simulator.html":             { js: ["sim-core.js", "sim-save.js", "stepper.js"], css: ["simulator.css"] },
  "account.html":               { js: ["account.js"], css: [] },
  "rate-calculator.html":       { js: ["rate-calculator.js"], css: [] },
  "fee-tracker.html":           { js: ["fee-tracker.js"], css: [] },
  "alerts.html":                { js: ["alerts.js"], css: [] },
  "settlement-calculator.html": { js: ["settlement.js"], css: [] },
  "surcharge-tool.html":        { js: ["surcharge.js"], css: [] },
  "referrals.html":             { js: ["referrals.js"], css: [] },
  "transparency-wall.html":     { js: ["wall.js"], css: [] },
};
const AUTH_JS = "site-auth.js";

// rewrite asset references in every page
let touched = [];
for (const [page, spec] of Object.entries(PAGES)) {
  const htmlP = path.join(ROOT, page);
  if (!fs.existsSync(htmlP)) { console.log(page + " not present yet, skipped"); continue; }
  let html = fs.readFileSync(htmlP, "utf8");
  const orig = html;
  for (const f of [...spec.js, AUTH_JS]) {
    if (!jsHash[f]) throw new Error("unknown js entry: " + f + " (page " + page + ")");
    const base = f.replace(/\.js$/, "").replace(/\./g, "\\.");
    const hashed = f.replace(/\.js$/, "") + "." + jsHash[f] + ".js";
    html = html.replace(new RegExp("assets/js/" + base + "(\\.[0-9a-f]{8})?\\.js"), "assets/js/" + hashed);
  }
  for (const f of spec.css) {
    if (!cssHash[f]) throw new Error("unknown css: " + f + " (page " + page + ")");
    const base = f.replace(/\.css$/, "").replace(/\./g, "\\.");
    const hashed = f.replace(/\.css$/, "") + "." + cssHash[f] + ".css";
    html = html.replace(new RegExp("assets/" + base + "(\\.[0-9a-f]{8})?\\.css"), "assets/" + hashed);
  }
  if (html !== orig) { fs.writeFileSync(htmlP, html); touched.push(page); }
}
// also keep site-auth.js hashed on pages outside the manifest (all *.html get it)
{
  const hashed = "site-auth." + jsHash[AUTH_JS] + ".js";
  // every hashed entry module, for the manifest-miss check below
  const knownHashed = new Set();
  for (const f of jsFiles) knownHashed.add(f.replace(/\.js$/, "") + "." + jsHash[f] + ".js");
  for (const other of fs.readdirSync(ROOT).filter(f => f.endsWith(".html") && !PAGES[f])) {
    const htmlP = path.join(ROOT, other);
    let html = fs.readFileSync(htmlP, "utf8");
    const orig = html;
    html = html.replace(/assets\/js\/site-auth(\.[0-9a-f]{8})?\.js/, "assets/js/" + hashed);
    if (html !== orig) { fs.writeFileSync(htmlP, html); touched.push(other); }
    // fail loudly: a page entry module with no manifest entry would keep an
    // unhashed assets/js/<name>.js reference and 404 at runtime.
    for (const m of html.matchAll(/assets\/js\/([a-z0-9-]+)\.js/g)) {
      if (!knownHashed.has(m[1] + ".js"))
        throw new Error("page " + other + " references unhashed assets/js/" + m[1] + ".js — add it to the PAGES manifest");
    }
  }
}
console.log(touched.length ? "pages updated: " + touched.join(", ") : "all pages already current");
console.log("build complete");
