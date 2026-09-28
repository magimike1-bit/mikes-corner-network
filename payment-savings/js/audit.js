/* audit.js — free-audit intake form.
 *
 * Five fields max (Joseph: don't force 50 questions when 5 will do).
 * Anti-spam is deliberately light for v2: honeypot + 60s client throttle +
 * server-side RLS triage. Revisit CAPTCHA only if abuse appears.
 */
import { getUser } from "./sb.js";
import { getProfile, submitAuditRequest, logActivity } from "./db.js";
import { esc } from "./util.js";

const $ = (s) => document.querySelector(s);
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const VOLUME_BANDS = new Set(["under-10k", "10k-25k", "25k-50k", "50k-100k", "100k-250k", "over-250k"]);
const THROTTLE_MS = 60000;
let inFlight = false;
let loggedIn = false;

const FIELDS = {
  name: "#audit-name",
  email: "#audit-email",
  business_name: "#audit-business",
  volume_band: "#audit-volume",
};

function setErr(field, msg) {
  const input = $(FIELDS[field]);
  const err = document.querySelector(`[data-err-for="${field}"]`);
  if (input) input.setAttribute("aria-invalid", "true");
  if (err) { err.textContent = msg; err.hidden = false; }
}
function clearErrs() {
  for (const sel of Object.values(FIELDS)) {
    const input = $(sel);
    if (input) input.removeAttribute("aria-invalid");
  }
  for (const e of document.querySelectorAll("[data-err-for]")) {
    e.textContent = ""; e.hidden = true;
  }
}

/* Client-side validation mirrors db.js so the user gets inline errors
   without a round trip; db.js re-validates on submit regardless. */
function validate() {
  const v = (sel) => ($(sel) ? $(sel).value.trim() : "");
  let firstBad = null;
  const bad = (field, msg) => {
    setErr(field, msg);
    if (!firstBad) firstBad = $(FIELDS[field]);
  };
  if (v(FIELDS.name).length < 2) bad("name", "Please enter your name.");
  if (!EMAIL_RE.test(v(FIELDS.email))) bad("email", "Please check your email address.");
  if (v(FIELDS.business_name).length < 2) bad("business_name", "Please enter your business name.");
  if (!VOLUME_BANDS.has(v(FIELDS.volume_band))) bad("volume_band", "Please choose your monthly card volume.");
  return firstBad;
}

/* Map a db.js validation message back to its field for focus. */
function fieldForMessage(msg) {
  const m = String(msg || "").toLowerCase();
  if (m.includes("name") && !m.includes("business")) return "name";
  if (m.includes("email")) return "email";
  if (m.includes("business")) return "business_name";
  if (m.includes("volume")) return "volume_band";
  return null;
}

function showSuccess(email) {
  const wrap = $("#audit-form-wrap");
  wrap.innerHTML = `<div class="audit-success" role="status" aria-live="polite">
      <h2>Request received.</h2>
      <p>Thanks — we'll reply within <strong>2–5 business days</strong> at ${esc(email)}.</p>
      <p>Keep an eye on your inbox (and spam folder, just in case). There's nothing else you need to do.</p>
      ${loggedIn ? `<p>You can track its status on your <a href="account.html">dashboard</a>.</p>` : ""}
    </div>`;
  wrap.scrollIntoView({ behavior: "smooth", block: "start" });
}
async function prefill() {
  try {
    const u = await getUser();
    if (!u) return;
    loggedIn = true;
    if (u.email && !$("#audit-email").value) $("#audit-email").value = u.email;
    try {
      const p = await getProfile();
      if (p && p.display_name && !$("#audit-name").value) $("#audit-name").value = p.display_name;
    } catch (e) { /* profile is optional for prefill */ }
  } catch (e) { /* stay logged-out */ }
}

function boot() {
  const form = $("#audit-form");
  if (!form) return;
  const msg = $("#audit-form-msg");
  const btn = $("#audit-submit");
  prefill();
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (inFlight) return;
    clearErrs();
    msg.textContent = "";
    msg.classList.remove("err");
    // Honeypot: bots fill it; pretend success without submitting.
    if ($("#audit-website") && $("#audit-website").value) {
      showSuccess($("#audit-email").value.trim() || "your email");
      return;
    }
    // 60s in-browser throttle (set only on successful send).
    try {
      const last = +localStorage.getItem("fra_audit_last_sent") || 0;
      if (Date.now() - last < THROTTLE_MS) {
        msg.textContent = "You've just sent a request — give it a minute before sending another.";
        msg.classList.add("err");
        return;
      }
    } catch (e) { /* storage unavailable: skip throttle */ }
    const firstBad = validate();
    if (firstBad) { firstBad.focus(); return; }
    inFlight = true;
    btn.disabled = true;
    btn.setAttribute("aria-busy", "true");
    const data = {
      name: $("#audit-name").value.trim(),
      email: $("#audit-email").value.trim(),
      business_name: $("#audit-business").value.trim(),
      volume_band: $("#audit-volume").value,
      business_type: $("#audit-type").value || null,
      current_processor: $("#audit-processor").value.trim() || null,
      phone: $("#audit-phone").value.trim() || null,
      message: $("#audit-message").value.trim() || null,
    };
    try {
      const res = await submitAuditRequest(data);
      try { localStorage.setItem("fra_audit_last_sent", String(Date.now())); } catch (e) {}
      try { await logActivity("audit.request_submitted", "Free audit requested", res.email); } catch (e) {}
      showSuccess(res.email);
    } catch (err) {
      // Values are preserved — the user fixes and resubmits.
      const m = (err && err.message) || "Couldn't send — check your connection and try again.";
      msg.textContent = m;
      msg.classList.add("err");
      const f = fieldForMessage(m);
      if (f && FIELDS[f]) { setErr(f, m); $(FIELDS[f]).focus(); }
      else btn.focus();
    } finally {
      inFlight = false;
      btn.disabled = false;
      btn.removeAttribute("aria-busy");
    }
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
