// tools/savings.mjs — F1 annual-billing savings + F5 first-year cost derivations.
//
// Mechanical derivations from products.json pricing_tier data only. Shared by
// tools/generate.mjs (renders the strings) and tools/lint-invented-strings.mjs
// (pins the exact rendered strings) so the lint can verify every number
// instead of trusting a shaped regex.
//
// F1 patterns (brief §4) — a tier gets a callout ONLY when its notes match
// one of these exact shapes; anything else is an honest gap (no callout).
//   P1 `Billed annually ($M/month if billed monthly)` + tier price $A  → (M-A)*12  (monday, calendly)
//   P2 `$A/month billed annually` + tier price $M                    → (M-A)*12  (shopify)
//   P3 `$Y/year if billed annually` + tier price $M/month            → M*12-Y    (wave)
//   P4 `C$M/month` price + `C$A/month with annual prepayment`        → (M-A)*12  (jobber)
//   `~N% off with annual billing` (semrush) → NO dollar computation; notes render verbatim only.
import { startPriceNumeric } from "./price-parse.mjs";

/** Money string with the data's sigil verbatim and a thousands separator: $36, C$240, $1,200. */
export function fmtMoney(sigil, n) {
  const rounded = Math.round(n * 100) / 100;
  const body = Number.isInteger(rounded)
    ? rounded.toLocaleString("en-US")
    : rounded.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${sigil}${body}`;
}

export const numOf = (s) => {
  const m = String(s).replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : NaN;
};

// Leading non-digit run of a price string: "$9" -> "$", "C$49" -> "C$".
export const sigilOf = (s) => {
  const m = String(s).match(/^[^\d]+/);
  return m ? m[0].trim() : "";
};

/**
 * F1: annual-billing savings for one tier. Returns null when the tier's
 * notes match none of the P1–P4 patterns (honest gap — no callout).
 * Otherwise { save, saveText, perSeat, callout, stripLine }.
 */
export function tierSavings(t) {
  const price = numOf(t.price);
  if (!Number.isFinite(price)) return null;
  const sigil = sigilOf(t.price);
  const perSeat = /seat/i.test(t.cadence || "");
  const notes = t.notes || "";
  let A, M, aUnit, mUnit, save;
  let m;
  if ((m = notes.match(/Billed annually \(\$([\d,]+(?:\.\d+)?)\/month if billed monthly\)/))) {
    // P1: the tier price IS the annual-billed monthly rate ($A); notes state the monthly-billed rate ($M).
    A = price; M = numOf(m[1]); aUnit = "/mo"; mUnit = "/mo";
    save = (M - A) * 12;
  } else if ((m = notes.match(/^\$([\d,]+(?:\.\d+)?)\/month billed annually/))) {
    // P2: notes state the annual-billed rate ($A); the tier price is the monthly rate ($M).
    A = numOf(m[1]); M = price; aUnit = "/mo"; mUnit = "/mo";
    save = (M - A) * 12;
  } else if ((m = notes.match(/\$([\d,]+(?:\.\d+)?)\/year if billed annually/))) {
    // P3: notes state the annual total ($Y); the tier price is the monthly rate ($M).
    A = numOf(m[1]); M = price; aUnit = "/yr"; mUnit = "/mo";
    save = M * 12 - A;
  } else if ((m = notes.match(/C\$([\d,]+(?:\.\d+)?)\/month with annual prepayment/))) {
    // P4: notes state the annual-prepayment rate (C$A); the tier price is the month-to-month rate (C$M).
    A = numOf(m[1]); M = price; aUnit = "/mo"; mUnit = "/mo";
    save = (M - A) * 12;
  } else {
    return null;
  }
  if (!Number.isFinite(A) || !Number.isFinite(M)) return null;
  save = Math.round(save * 100) / 100;
  const seatQ = perSeat ? " per seat" : "";
  const saveText = fmtMoney(sigil, save);
  return {
    save,
    saveText,
    perSeat,
    callout: `Pay annually: ${sigil}${A}${aUnit} instead of ${sigil}${M}${mUnit}, saves ${saveText}/yr${seatQ}`,
    stripLine: (name, tierName) =>
      `${name} — ${tierName}: save ${saveText}/yr${seatQ}`,
  };
}

/**
 * Every tier-level saving site-wide, sorted save desc, then product name
 * asc, then tier name asc (deterministic — the tie order is pinned).
 */
export function allSavings(products) {
  const out = [];
  for (const p of products) {
    for (const t of p.pricing_tiers || []) {
      const sv = tierSavings(t);
      if (sv) {
        out.push({
          slug: p.slug,
          name: p.name,
          tier: t.name,
          save: sv.save,
          saveText: `save ${sv.saveText}/yr${sv.perSeat ? " per seat" : ""}`,
          line: sv.stripLine(p.name, t.name),
          perSeat: sv.perSeat,
        });
      }
    }
  }
  out.sort(
    (a, b) => b.save - a.save || a.name.localeCompare(b.name) || a.tier.localeCompare(b.tier)
  );
  return out;
}

/** Cadence classifiers shared by seatYearCosts() and firstYear() so the
 * per-transaction and banded rules live in exactly one place. */
export const TEAM_SIZES = [5, 10, 25];
const isTxnCadence = (cad) => /transaction/.test(String(cad || "").toLowerCase());
const hasTxnTier = (tiers) => tiers.some((x) => isTxnCadence(x.cadence));
const isBandedCadence = (cad) => /per year,\s*\d/.test(String(cad || "").toLowerCase());

/**
 * PP-FIRSTYEAR-COST: first-year cost of a product's starting PAID tier at
 * standard team sizes (5/10/25 seats), from verified list prices only.
 * Returns { tier, costs: {5,10,25}, sigil } or { excluded: reason } or null
 * when no paid tier exists. Per-seat/user/employee/contractor cadences
 * scale with seats; flat monthly cadences annualize x12; per-year cadences
 * are already annual. Usage-metered cadences (contacts, subscribers,
 * sends, profiles), per-transaction pricing, user-banded cadences
 * (a price that covers a band of users, not one user), and composite
 * prices (a base plus a per-person charge) are excluded with a reason —
 * never estimated. A dollar monthly minimum stated in the tier's notes
 * floors the monthly figure before annualizing.
 */
export function seatYearCosts(p, sizes = TEAM_SIZES) {
  const tiers = p.pricing_tiers || [];
  // A product whose core starting offer is a per-transaction rate is
  // transaction-priced for this table's purpose, even if it also sells
  // add-on subscriptions (Square POS: free + 2.9% + 30c, with Appointments
  // plans as a separate line). Pricing the add-on here would mislead.
  const first = tiers[0];
  if (first && isTxnCadence(first.cadence)) {
    return { excluded: "per-transaction" };
  }
  // Same conclusion when the starting tier is free software whose notes
  // carry the per-transaction processing rate (Square POS: "$0 free",
  // notes "2.6% + 15c per transaction") — the paid tiers that follow are
  // add-on lines, not the core offer.
  if (
    first &&
    String(first.cadence || "").toLowerCase() === "free" &&
    /per transaction/.test(String(first.notes || "").toLowerCase())
  ) {
    return { excluded: "per-transaction" };
  }
  const parsed = tiers.map((x) => ({
    t: x,
    cad: String(x.cadence || "").toLowerCase(),
    n: numOf(x.price),
  }));
  const hit = parsed.find(
    (x) => x.cad !== "quote" && x.cad !== "free" && !isTxnCadence(x.cad) && Number.isFinite(x.n) && x.n > 0
  );
  if (!hit) {
    // Tiers exist but none is a payable subscription (all free/quote/
    // transaction): report per-transaction when a transaction tier exists.
    if (hasTxnTier(tiers)) return { excluded: "per-transaction" };
    return null;
  }
  const { t, cad, n } = hit;
  if (isBandedCadence(cad)) return { excluded: "user-banded" };
  if (/contacts|subscribers|sends|profiles/.test(cad)) return { excluded: "usage-metered" };
  // A composite price ("C$20 + C$4/employee") has two components; taking
  // only the first number would understate the cost, so it is excluded
  // rather than estimated.
  if (String(t.price).includes("+")) return { excluded: "composite-price" };
  // The per-seat signal can live in the price string instead of the
  // cadence (Setmore Pro: "$5/user", cadence "per month").
  const perSeat = /seat|user|employee|contractor/.test(`${cad} ${t.price}`);
  const perYear = /per year/.test(cad) && !/per month/.test(cad);
  // A dollar monthly minimum stated in the tier's verified notes floors
  // the monthly figure (Humi Payroll: $7 per employee, "$70/month
  // minimum" — at 5 employees the floor, not the product, sets the cost).
  const minMatch = /\$([\d,]+(?:\.\d{1,2})?)\/month minimum/.exec(String(t.notes || ""));
  const monthlyMin = minMatch ? Number(minMatch[1].replace(/,/g, "")) : null;
  const costs = {};
  for (const s of sizes) {
    let v;
    if (perYear) v = perSeat ? n * s : n;
    else {
      const monthly = perSeat ? n * s : n;
      v = (monthlyMin != null ? Math.max(monthly, monthlyMin) : monthly) * 12;
    }
    costs[s] = Math.round(v * 100) / 100;
  }
  return { tier: t.name, costs, sigil: sigilOf(t.price) };
}

/**
 * F5: first-year cost for a product's starting tier.
 * Skipped (null) when the starting price is null/quote/free or the cadence
 * is per-transaction — an honest gap, never a guess.
 */
export function firstYear(p) {
  const t = p.pricing_tiers && p.pricing_tiers[0];
  if (!t) return null;
  const cad = String(t.cadence || "").toLowerCase();
  if (cad === "quote" || cad === "free" || isTxnCadence(cad)) return null;
  const n = startPriceNumeric(p);
  if (n == null) return null;
  const fy = Math.round(n * 12 * 100) / 100;
  const seatQ = /seat/i.test(t.cadence || "") ? " per seat" : "";
  return {
    text: `${fmtMoney(sigilOf(t.price), fy)}/yr (${t.price} ${t.cadence} × 12)${seatQ}`,
  };
}

/* Billed seats under monday.com-style bucket pricing (PP-SEAT-BUCKET-COST,
 * verified on monday.com support, checked 2026-11-10): plans start at a
 * minimum of 3 seats, then ascend in multiples of 5. A team of 4 is billed
 * for 5 seats; a team of 6 for 10. */
export function billedSeats(n) {
  if (!Number.isFinite(n) || n < 1) return null;
  if (n <= 3) return 3;
  return Math.ceil(n / 5) * 5;
}
