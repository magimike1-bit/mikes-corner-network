#!/usr/bin/env node
// Tests for tools/site-data.mjs (the registry loader used by generate.mjs).
//
// Run: node tools/test_site_data.mjs
// Asserts the real registry values, that unknown compare slugs throw, and
// that a missing registry file (via the SITE_DATA_PATH override) throws.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { PRICES_VERIFIED_DATE, comparePageDate } from "./site-data.mjs";

const TOOLS = dirname(fileURLToPath(import.meta.url));

assert.equal(
  PRICES_VERIFIED_DATE,
  "2026-10-25",
  "loader returns the registry prices_verified_date"
);
console.log("ok - PRICES_VERIFIED_DATE == 2026-10-25");

assert.equal(
  comparePageDate("housecall-pro-vs-jobber"),
  "2026-09-30",
  "comparePageDate returns the registry page date (min of members)"
);
console.log("ok - comparePageDate('housecall-pro-vs-jobber') == 2026-09-30");

assert.equal(
  comparePageDate("capsule-vs-pipedrive"),
  "2026-10-10",
  "partial compare page still resolves to its registry date"
);
console.log("ok - comparePageDate('capsule-vs-pipedrive') == 2026-10-10");

assert.throws(
  () => comparePageDate("no-such-compare-page"),
  /no page_checked_dates entry/,
  "unknown compare slug throws"
);
console.log("ok - unknown compare slug throws");

// Missing registry: point SITE_DATA_PATH at a file that does not exist and
// import the loader in a child process; it must fail loudly.
const child = spawnSync(
  process.execPath,
  ["--input-type=module", "-e", "import('./site-data.mjs').then(() => process.exit(0))"],
  {
    cwd: TOOLS,
    env: { ...process.env, SITE_DATA_PATH: "/tmp/planprice-no-such-site-data.json" },
    encoding: "utf8",
  }
);
assert.notEqual(child.status, 0, "loader fails when the registry file is missing");
assert.match(
  child.stderr,
  /site-data: cannot load registry/,
  "missing-registry error names the loader and path"
);
console.log("ok - missing registry file throws (child process, SITE_DATA_PATH override)");

console.log("test_site_data.mjs: all assertions passed");
