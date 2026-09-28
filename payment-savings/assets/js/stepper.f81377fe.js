import { S } from './session.d6748862.js';
import { money } from './util.03612f15.js';
/* stepper.js — guided 6-step workflow shell for the cost simulator.
   Owns: sticky chrome (progress bar + "Your numbers" strip), hash routing
   (#step-1…#step-6, so browser Back/Forward navigates steps), legacy anchor
   resolution, per-step Back/Continue nav, visited-step shortcuts, and the
   Margin-eaters skip. Calculations and the saved-setup format are untouched —
   it only reads S.totals (written by sim-core's recalc) and the session-only
   flag S.meSkipped.
   Source of truth: js/ (edit here, then run tools/build-assets.mjs). */

/* Step definition table. Section ids live in simulator.html; the data-step
   attributes there mirror this table for the pre-JS CSS default. */
const STEPS = [
  { n: 1, title: "Pick your sector",   sections: ["sim-start"] },
  { n: 2, title: "Your business",      sections: ["sim-questions"] },
  { n: 3, title: "Build your stack",   sections: ["sim-catalog", "sim-map-section"] },
  { n: 4, title: "Network + training", sections: ["sim-network"] },
  { n: 5, title: "Margin eaters",      sections: ["margin-eaters"] },
  { n: 6, title: "Your numbers",       sections: ["sim-results"] },
];

const visited = new Set([1]);
let current = 0;

function sectionsOf(n){
  const st = STEPS.find(s => s.n === n);
  return st ? st.sections.map(id => document.getElementById(id)).filter(Boolean) : [];
}

/* ---- "Your numbers" strip (persistent on steps 1–5) ----
   Same figures as the results step: Pay now = install-time total,
   Per month = the monthly stack total, You save = the 0.5% illustration. */
function renderStrip(){
  const t = S.totals;
  const el = document.getElementById("wf-strip");
  if(!el) return;
  if(!t){
    /* sim-core is still loading its data (sequential JSON fetches) — show a
       neutral loading state, never misleading $0s. sim-core's recalc() calls
       S.renderStrip() as soon as the first real totals exist. */
    el.innerHTML =
      "<span>Pay now <strong>…</strong></span><span class=\"wf-sep\">·</span>" +
      "<span>Per month <strong>…</strong></span><span class=\"wf-sep\">·</span>" +
      "<span>You save <strong>…</strong></span>";
    return;
  }
  el.innerHTML =
    "<span>Pay now <strong>" + money(t.payNow) + "</strong></span><span class=\"wf-sep\">·</span>" +
    "<span>Per month <strong>" + money(t.monthly) + "</strong></span><span class=\"wf-sep\">·</span>" +
    "<span>You save <strong>" + money(t.save) + "/mo</strong></span>";
}
S.renderStrip = renderStrip; // sim-core's recalc() calls this when present

/* ---- skipped Margin-eaters note on step 6 ---- */
function updateMeNote(){
  const n = document.getElementById("me-skipped-note");
  if(!n) return;
  if(S.meSkipped){
    n.hidden = false;
    n.innerHTML = "🦈 You skipped <strong>Margin eaters</strong> — those costs aren't in your totals. " +
      "<a href=\"#step-5\">Price them instead →</a>";
  } else {
    n.hidden = true;
    n.innerHTML = "";
  }
}

/* ---- sticky progress bar ---- */
function renderProgress(){
  const ol = document.getElementById("wf-dots");
  const st = STEPS.find(s => s.n === current);
  const head = document.getElementById("wf-stepcount");
  if(head) head.textContent = "Step " + current + " of 6" + (st ? " · " + st.title : "");
  if(!ol) return;
  ol.innerHTML = STEPS.map(s => {
    const cur = s.n === current ? " aria-current=\"step\"" : "";
    const dis = visited.has(s.n) ? "" : " disabled";
    return "<li><button type=\"button\" data-goto=\"" + s.n + "\"" + cur + dis +
      " aria-label=\"Go to step " + s.n + ": " + s.title + "\">" +
      "<span class=\"wf-dot\">" + s.n + "</span><span class=\"wf-dotlabel\">" + s.title + "</span></button></li>";
  }).join("");
}

/* ---- step visibility ---- */
function showStep(n, opts){
  opts = opts || {};
  n = Math.min(6, Math.max(1, n)) || 1;
  const changed = n !== current;
  current = n;
  visited.add(n);
  document.querySelectorAll(".wf-step").forEach(sec => {
    sec.classList.toggle("active", +sec.dataset.step === n);
  });
  const strip = document.getElementById("wf-strip");
  if(strip) strip.style.display = n === 6 ? "none" : ""; // step 6 IS the full numbers
  renderProgress();
  updateMeNote();
  if(opts.anchor){
    const el = document.getElementById(opts.anchor);
    if(el){ el.scrollIntoView({ block: "start" }); return; }
  }
  if(changed){
    const c = document.getElementById("wf-chrome");
    if(c) c.scrollIntoView({ block: "start" });
  }
}

/* ---- hash routing: #step-N wins; any other #id resolves to the step
   containing that element (legacy anchors keep working); anything else
   falls back to step 1. The hash is the single source of truth, so
   browser Back/Forward navigates steps via the hashchange event. ---- */
function stepForHash(hash){
  const m = /^#step-([1-6])$/.exec(hash || "");
  if(m) return { n: +m[1] };
  const id = (hash || "").replace(/^#/, "");
  if(id){
    const el = document.getElementById(id);
    const step = el && el.closest ? el.closest(".wf-step") : null;
    if(step && step.dataset.step) return { n: +step.dataset.step, anchor: id };
  }
  return { n: 1 };
}

function goStep(n){
  if(location.hash === "#step-" + n) showStep(n);
  else location.hash = "#step-" + n;
}

function onHashChange(){
  const r = stepForHash(location.hash);
  showStep(r.n, { anchor: r.anchor });
}
window.addEventListener("hashchange", onHashChange);

/* ---- chrome + per-step Back/Continue nav ---- */
function buildChrome(){
  const chrome = document.getElementById("wf-chrome");
  if(chrome){
    chrome.innerHTML =
      "<div class=\"wf-progress\" role=\"navigation\" aria-label=\"Simulator progress\">" +
        "<div class=\"wf-progress-head\"><span id=\"wf-stepcount\"></span></div>" +
        "<ol class=\"wf-dots\" id=\"wf-dots\"></ol>" +
      "</div>" +
      "<div class=\"wf-strip\" id=\"wf-strip\" aria-live=\"polite\"></div>";
  }
  STEPS.forEach(st => {
    const secs = sectionsOf(st.n);
    const last = secs[secs.length - 1];
    if(!last || last.querySelector(".wf-stepnav")) return;
    let nav = "<nav class=\"wf-stepnav\" aria-label=\"Step " + st.n + " navigation\">";
    nav += st.n > 1
      ? "<button type=\"button\" class=\"wf-back\" data-goto=\"" + (st.n - 1) + "\">← Back</button>"
      : "<span></span>";
    if(st.n === 5) nav += "<button type=\"button\" class=\"wf-skip\" id=\"btn-me-skip\">Skip for now →</button>";
    if(st.n < 6) nav += "<button type=\"button\" class=\"wf-continue\" data-goto=\"" + (st.n + 1) + "\">Continue →</button>";
    nav += "</nav>";
    last.insertAdjacentHTML("beforeend", nav);
  });
}

document.addEventListener("click", (e) => {
  const t = e.target && e.target.closest ? e.target : null;
  const skip = t && t.closest("#btn-me-skip");
  if(skip){
    S.meSkipped = true; // session-only flag; never saved
    updateMeNote();
    goStep(6);
    return;
  }
  const b = t && t.closest("[data-goto]");
  if(!b || b.disabled) return;
  goStep(+b.dataset.goto);
});

/* Touching any Margin-eater input un-skips (the user came back to price them). */
function watchMarginEaters(){
  const me = document.getElementById("margin-eaters");
  if(me) me.addEventListener("input", () => {
    if(S.meSkipped){ S.meSkipped = false; updateMeNote(); }
  });
}

/* ---- boot (sim-core has already run: S.totals is set) ---- */
buildChrome();
watchMarginEaters();
renderStrip();
{
  const initial = stepForHash(location.hash);
  current = initial.n; // boot must not scroll
  showStep(initial.n, { anchor: initial.anchor });
}
