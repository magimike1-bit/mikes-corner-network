/* email.js — OUTBOUND EMAIL SEAM (stubbed, honest).
 *
 * The site captures CASL-compliant consent and shows alerts in the in-app
 * alert center. Actually SENDING email is not wired: this module throws a
 * clear error instead of faking it.
 *
 * TO ENABLE (Joseph's call):
 *   1. Create a Supabase Edge Function (e.g. `send-alert`) that calls Resend
 *      (or Postmark) using a key stored as a Supabase secret — never in this repo.
 *   2. Implement `sendAlertEmail()` below to POST to that function.
 *   3. Every email MUST include the unsubscribe link:
 *        <site>/alerts.html?unsub=<unsub_token>
 *      (alerts.html already handles ?unsub= via the unsubscribe() SQL function.)
 *   4. CASL: only mail addresses with a stored consent_at; honor
 *      unsubscribed_at; include your business name + contact info in the footer.
 */
import { isConfigured } from "./config.js";

export function emailSendingEnabled() { return false; }

export async function sendAlertEmail({ to, subject, html }) {
  void to; void subject; void html;
  if (!isConfigured()) throw new Error("Accounts are not connected yet.");
  throw new Error(
    "Outbound email is not wired. Create the Supabase Edge Function + Resend " +
    "key per the instructions in js/email.js, then implement sendAlertEmail()."
  );
}
