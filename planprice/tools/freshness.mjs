// tools/freshness.mjs — F3 verification-freshness helpers.
//
// Pure functions over ISO dates from the data (product.last_verified,
// deal.verified_date) and the build CHECKED date. No wall clock anywhere —
// output is idempotent. Shared by tools/generate.mjs and
// tools/lint-invented-strings.mjs.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-09-30" -> "Sep 30, 2026" (absolute, idempotent — "days ago" is banned). */
export function fmtDate(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

const dayNum = (iso) => {
  const [y, m, d] = String(iso).split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
};

/** True when verifiedDate is more than 45 days older than the check date. */
export function isStale(verifiedDate, checked) {
  return dayNum(checked) - dayNum(verifiedDate) > 45;
}
