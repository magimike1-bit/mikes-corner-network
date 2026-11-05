// PlanPrice site-data registry loader.
//
// Single source for the site's checked dates in the generator: the values
// live in data/site-data.json (the registry), never as literals here.
// Fails loudly — a missing registry or variable is a build error, never a
// silent default.
//
// SITE_DATA_PATH (env var) overrides the registry path; it exists so tests
// can point the loader at a missing file and prove it throws.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REGISTRY_PATH =
  process.env.SITE_DATA_PATH ||
  join(dirname(fileURLToPath(import.meta.url)), "..", "data", "site-data.json");

let registry;
try {
  registry = JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
} catch (err) {
  throw new Error(
    `site-data: cannot load registry at ${REGISTRY_PATH}: ${err.message}`
  );
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const pricesVerified = registry?.variables?.prices_verified_date?.value;
if (typeof pricesVerified !== "string" || !ISO_DATE_RE.test(pricesVerified)) {
  throw new Error(
    `site-data: registry at ${REGISTRY_PATH} is missing a valid variables.prices_verified_date.value`
  );
}

export const PRICES_VERIFIED_DATE = pricesVerified;

export function comparePageDate(slug) {
  const entry = registry?.page_checked_dates?.[`compare/${slug}.html`];
  if (!entry || typeof entry.date !== "string" || !ISO_DATE_RE.test(entry.date)) {
    throw new Error(
      `site-data: no page_checked_dates entry for compare slug "${slug}" in ${REGISTRY_PATH}`
    );
  }
  return entry.date;
}
