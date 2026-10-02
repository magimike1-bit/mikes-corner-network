// tools/review-rank.mjs — F4 top-rated leaderboard derivations.
//
// Mechanical derivations from data/review-scores.json only. Shared by
// tools/generate.mjs (renders the rows) and tools/lint-invented-strings.mjs
// (pins the exact rendered strings).
//
// avg = mean of the available G2/Capterra scores, rounded to 1 decimal with
// exact decimal arithmetic (integer tenths — no binary-float rounding
// surprises); totalReviews = sum of available review counts (a null count
// contributes nothing). A missing source is omitted from the row; a product
// with no scores at all is excluded from the ranking (honest gap).

const fmtCount = (n) => n.toLocaleString("en-US");

function rowFor(p, entry) {
  const sources = [];
  if (entry.g2 && typeof entry.g2.score === "number") sources.push(["G2", entry.g2]);
  if (entry.capterra && typeof entry.capterra.score === "number")
    sources.push(["Capterra", entry.capterra]);
  if (!sources.length) return null;
  // Exact-decimal rounding: scores are 1-decimal, so work in integer tenths.
  const tenths = sources.map(([, s]) => Math.round(s.score * 10));
  const avgTenths = Math.round(tenths.reduce((a, b) => a + b, 0) / tenths.length);
  const avgText = (avgTenths / 10).toFixed(1);
  const totalReviews = sources.reduce(
    (a, [, s]) => a + (typeof s.reviews === "number" ? s.reviews : 0),
    0
  );
  const srcParts = sources.map(([label, s]) => `${s.score} on ${label}`);
  return {
    slug: p.slug,
    name: p.name,
    avg: avgTenths / 10,
    avgText,
    totalReviews,
    line: `${p.name} — ${avgText} (${srcParts.join(" · ")} · ${fmtCount(totalReviews)} reviews)`,
    mostLine: `${p.name} — ${fmtCount(totalReviews)} reviews`,
  };
}

/** Products ranked by avg desc, tiebreak totalReviews desc, then name asc (deterministic). */
export function rankByAvg(products, reviewScores) {
  const rows = [];
  for (const p of products) {
    const entry = reviewScores.scores[p.slug];
    if (!entry) continue;
    const r = rowFor(p, entry);
    if (r) rows.push(r);
  }
  rows.sort(
    (a, b) => b.avg - a.avg || b.totalReviews - a.totalReviews || a.name.localeCompare(b.name)
  );
  return rows;
}

/** Products ranked by total review count desc, tiebreak name asc (deterministic). */
export function rankByReviews(products, reviewScores) {
  const rows = [];
  for (const p of products) {
    const entry = reviewScores.scores[p.slug];
    if (!entry) continue;
    const r = rowFor(p, entry);
    if (r) rows.push(r);
  }
  rows.sort((a, b) => b.totalReviews - a.totalReviews || a.name.localeCompare(b.name));
  return rows;
}
