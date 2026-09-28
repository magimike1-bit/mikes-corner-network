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
  src = src.replace(/from\s+['"]\.\/([a-z-]+\.js)['"]/g, (m, dep) => {
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

// rewrite simulator.html references
const htmlP = path.join(ROOT, "simulator.html");
let html = fs.readFileSync(htmlP, "utf8");
const coreHashed = "sim-core." + jsHash["sim-core.js"] + ".js";
const cssHashed = "simulator." + cssHash["simulator.css"] + ".css";
const probe = html.replace(/assets\/js\/sim-core(\.[0-9a-f]{8})?\.js/, "X");
if (probe === html) throw new Error("simulator.html asset references not found");
const html2 = html
  .replace(/assets\/js\/sim-core(\.[0-9a-f]{8})?\.js/, "assets/js/" + coreHashed)
  .replace(/assets\/simulator(\.[0-9a-f]{8})?\.css/, "assets/" + cssHashed);
if (html2 !== html) { fs.writeFileSync(htmlP, html2); console.log("simulator.html updated"); }
else console.log("simulator.html already current");
console.log("build complete");
