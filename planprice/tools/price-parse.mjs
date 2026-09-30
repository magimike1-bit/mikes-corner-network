// tools/price-parse.mjs — shared starting-price helpers for PlanPrice.
//
// Used by both tools/generate.mjs (deals index + price-sort keys) and
// tools/snapshot.mjs (monthly sweep baselines). Keep the parsing rules in
// exactly one place so the generator and the snapshots can never disagree
// about what a product's "starting price" is.

// Numeric starting price: first pricing tier's first number (commas stripped).
// Returns 0 for free tiers, null for quote-priced or unparseable tiers
// (quote products sort last in the directory filter).
export function startPriceNumeric(p) {
  const t = p.pricing_tiers && p.pricing_tiers[0];
  if (!t || t.cadence === "quote") return null;
  const m = String(t.price).replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

// Plain-text starting price for display, e.g. "From $15 per seat/month".
// Quote-priced products render their price as-is.
export function startPriceText(p) {
  const t = p.pricing_tiers && p.pricing_tiers[0];
  if (!t) return "";
  if (t.cadence === "quote") return String(t.price);
  return `From ${t.price} ${t.cadence}`;
}
