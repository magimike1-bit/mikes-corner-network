import { S } from './session.babf8dd5.js';
/* util.js — generated module. Source of truth: js/ (edit here, then run tools/build-assets.mjs). */

  const $ = id => document.getElementById(id);

  const money = n => "$" + Math.round(n).toLocaleString("en-CA");
  /* Display: converted CAD amount, with the original foreign figure beside it. */

  function pyRound(x){
    const f = Math.floor(x), d = x - f;
    if(d < 0.5) return f;
    if(d > 0.5) return f + 1;
    return (f % 2 === 0) ? f : f + 1;
  }

  function clampN(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }

  function esc(s){
    return String(s == null ? "" : s).replace(/&/g,"&amp;").replace(/</g,"&lt;")
      .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }
  // Cost treatment in CAD — converted via cadOf(), never raw foreign figures.
  // No price keys at all, or a label that says quote-based -> quote (unknown price).
  // Otherwise $0 -> free/included.

  const pct1 = n => (Math.round(n * 100) / 100).toFixed(n < 0.1 ? 2 : 1) + "%";
export { $, money, esc, pyRound, clampN, pct1 };
