// slugify.mjs — shared slug helper for the planprice build tools.
// Extracted from tools/generate.mjs (PP-SECTIONS-PHASE2 hygiene): a single
// definition shared by generate.mjs and lint-invented-strings.mjs so the
// two can never drift. Behavior: lowercase, runs of non-[a-z0-9] collapse
// to one hyphen, leading/trailing hyphens stripped.
export function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
