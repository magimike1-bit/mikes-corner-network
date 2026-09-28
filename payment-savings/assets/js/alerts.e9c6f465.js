/* alerts.js — rate-change alert wire page module.
 *
 * Node-safe: no top-level document/window/localStorage. All DOM work runs
 * inside DOMContentLoaded.
 *
 * (a) signup card → db.subscribeAlerts(email, topics, "alerts-page").
 *     Express consent checkbox is REQUIRED (CASL). States clearly that
 *     outbound email begins once the mailer is wired; in-app alerts work now.
 * (b) briefs archive is a static placeholder in the HTML — no invented briefs.
 * (c) ?unsub=<token> → Supabase `unsubscribe` RPC via getClient(),
 *     guarded when accounts are not configured.
 */
import { subscribeAlerts, isConfigured } from './db.fd18dc7a.js';
import { emailSendingEnabled } from './email.40dca101.js';
import { getClient } from './sb.c957517c.js';

function $(id) { return document.getElementById(id); }
function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function handleUnsub() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("unsub");
  const card = $("unsub-card"), msg = $("unsub-msg");
  if (!token || !card) return;
  card.hidden = false;
  if (!isConfigured()) {
    msg.innerHTML = "<p>Accounts aren't connected yet, so there's no online subscription to remove. " +
      "If you followed this link from one of our emails, <a href=\"contact.html\">contact us</a> " +
      "and we'll sort it out.</p>";
    return;
  }
  if (!UUID_RE.test(token)) {
    msg.innerHTML = "<p class=\"tool-err\">That unsubscribe link doesn't look right. " +
      "<a href=\"contact.html\">Contact us</a> if you'd like us to check your subscription.</p>";
    return;
  }
  msg.innerHTML = "<p>Processing…</p>";
  try {
    const sb = await getClient();
    if (!sb) throw new Error("Accounts are not connected yet.");
    const { data, error } = await sb.rpc("unsubscribe", { p_token: token });
    if (error) throw new Error(error.message);
    msg.innerHTML = data
      ? "<p><strong>You're unsubscribed.</strong> You won't get any more processing-fee alerts from us.</p>"
      : "<p>That link doesn't match any active subscription — it may already be used. " +
        "<a href=\"contact.html\">Contact us</a> if you'd like us to check.</p>";
  } catch (e) {
    msg.innerHTML = `<p class="tool-err">Couldn't complete that (${esc(e && e.message)}). ` +
      `<a href="contact.html">Contact us</a> and we'll unsubscribe you manually.</p>`;
  }
}

function wire() {
  handleUnsub();

  const form = $("alert-form"), status = $("alert-status");
  if (!form || !status) return;

  // Honest delivery status, shown before anyone signs up.
  const sending = emailSendingEnabled();
  const deliveryNote = $("delivery-note");
  if (deliveryNote) {
    deliveryNote.innerHTML = sending
      ? "<p class=\"fine\">Email alerts are sent from our mailer; in-app alerts appear on this page.</p>"
      : "<p class=\"fine\"><strong>Honest status:</strong> email alerts begin once our mailer is wired — " +
        "it isn't yet, so no email leaves today. Signups are saved so you're on the list when it goes live, " +
        "and in-app alerts work now.</p>";
  }

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const email = $("al-email").value.trim();
    const topics = [];
    if ($("al-topic-creep").checked) topics.push("fee-creep");
    if ($("al-topic-briefs").checked) topics.push("rate-briefs");
    if (!topics.length) {
      status.innerHTML = "<p class=\"tool-err\">Pick at least one topic.</p>";
      return;
    }
    if (!$("al-consent").checked) {
      status.innerHTML = "<p class=\"tool-err\">The consent checkbox is required — we can't email you without it.</p>";
      return;
    }
    status.innerHTML = "<p>Signing you up…</p>";
    try {
      const res = await subscribeAlerts(email, topics, "alerts-page");
      const inapp = "In-app alerts work now — check this page anytime for new briefs.";
      if (res.pending) {
        status.innerHTML =
          `<div class="play"><span class="badge">You're on the list</span>` +
          `<p>Your request is <strong>saved in this browser</strong> — our email sender isn't wired yet, ` +
          `so nothing is sent today. Your signup will join the real list when the mailer goes live. ${inapp}</p></div>`;
      } else {
        status.innerHTML =
          `<div class="play"><span class="badge">Subscribed</span>` +
          `<p>You're signed up. Emails begin once our mailer is wired; ${inapp.toLowerCase()}</p></div>`;
      }
      form.reset();
    } catch (e) {
      status.innerHTML = `<p class="tool-err">${esc(e && e.message)}</p>`;
    }
  });
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
}
