#!/usr/bin/env node
/* smoke-dashboard-v2.mjs — focused behavioral/static checks for the
 * dashboard v2 + audit intake build (production build, 2026-09-28).
 * Asserts the new sections exist with independent error states, the audit
 * form's anti-spam + validation + success paths, and the supporting
 * db/site-auth/sim-save behavior. Exit non-zero on failure.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
let fails = 0;
const check = (name, cond) => {
  if (cond) console.log("ok: " + name);
  else { fails++; console.error("FAIL: " + name); }
};

const account = read("js/account.js");
const audit = read("js/audit.js");
const auditHtml = read("audit.html");
const db = read("js/db.js");
const auth = read("js/site-auth.js");
const simSave = read("js/sim-save.js");

/* --- dashboard v2 sections, each with its own error state --- */
for (const fn of ["resumeSection", "profileSection", "mySimulatorsSection",
                  "simulatorLogsSection", "auditResultsSection", "activityHistorySection"]) {
  check("account.js defines " + fn, new RegExp("function " + fn + "\\(").test(account));
}
check("every new section has an inline error state",
  (account.match(/Couldn't load your (last position|profile|saved setups|simulator logs|audit status|activity)/g) || []).length >= 6);

/* section order: resume, profile, simulators, logs, audit results, activity, then legacy */
{
  const order = ["resumeSection(", "profileSection(", "mySimulatorsSection(",
    "simulatorLogsSection(", "auditResultsSection(", "activityHistorySection(",
    "rateSection(", "feeSection(", "alertsSection(", "referralsSection("];
  const idx = order.map((s) => account.indexOf(s));
  check("dashboard sections render in the required order",
    idx.every((i) => i > 0) && idx.every((v, i) => i === 0 || v > idx[i - 1]));
}

/* --- simulator rows: status chips, open/edit/rename/delete --- */
check("status chip vocabulary complete/in-progress/unknown",
  /complete.*Complete.*in-progress.*In progress.*unknown.*Unknown/s.test(account));
check("Open + Edit-at-saved-step stash id/name/step",
  /fra_load_setup_step/.test(account) && /data-edit/.test(account));
check("delete clears fra_load_setup when it was the loaded setup",
  /fra_load_setup["']\) === String\(delBtn/.test(account) || /getItem\("fra_load_setup"\) === String/.test(account));
check("rename uses renameSimState with inline editor", /renameSimState\(id, val\)/.test(account));
check("delete/rename/load log activity", /simulator\.setup_(deleted|updated|loaded)/.test(account));

/* --- guest import: one-time offer + lost-data message --- */
check("import offer lists guest setups via listGuestSimStates", /listGuestSimStates\(\)/.test(account));
check("lost-data message shown when flag set but setups gone",
  /browser data looks cleared/.test(account));
check("import clears guest storage only after all writes succeed",
  /await importSimStates\(rows\)[\s\S]*?clearGuestSimStates\(\)/.test(account));
check("import logs guest.imported", /guest\.imported/.test(account));
check("import is one-time per user (fra_import_done_)", /fra_import_done_/.test(account));

/* --- audit adoption + profile --- */
check("audit adoption runs once after login", /adoptOnce\(\)[\s\S]*?adoptAuditRequests/.test(account));
check("profile form edits display name, email read-only", /updateDisplayName\(val\)/.test(account) && /readonly disabled/.test(account));
check("resume falls back to guest fra_last_page", /fra_last_page/.test(account));

/* --- audit form: validation, honeypot, throttle, success --- */
check("honeypot field present in HTML", /id="audit-website"/.test(auditHtml) && /name="website"/.test(auditHtml));
check("honeypot checked in JS with silent success", /audit-website["']\) && \$\("#audit-website"\)\.value/.test(audit) || /\$\("#audit-website"\)\.value/.test(audit));
check("60s client throttle", /THROTTLE_MS = 60000/.test(audit) && /fra_audit_last_sent/.test(audit));
check("in-flight guard disables submit", /inFlight = true/.test(audit) && /btn\.disabled = true/.test(audit));
check("inline validation for name/email/business/volume", /data-err-for="name"/.test(auditHtml) && /VOLUME_BANDS\.has/.test(audit));
check("first-invalid focus on failure", /firstBad\.focus\(\)/.test(audit));
check("values preserved on failure (no form reset)", !/form\.reset\(\)/.test(audit));
check("“2–5 business days” beside submit and in success",
  /We reply within <strong>2–5 business days<\/strong>/.test(auditHtml) && /reply within <strong>2–5 business days<\/strong>/.test(audit));
check("no-banking-details warning present", /Don't send banking details until we ask/.test(auditHtml));
check("noscript mailto fallback", /<noscript>[\s\S]*?mailto:/.test(auditHtml));
check("success shows dashboard tracking link when logged in", /account\.html">dashboard/.test(audit));
check("audit submit logs activity", /audit\.request_submitted/.test(audit));
check("volume bands complete", ["under-10k","10k-25k","25k-50k","50k-100k","100k-250k","over-250k"].every((b) => auditHtml.includes('value="' + b + '"')));
check("business types complete", ["retail","restaurant","qsr","hotel","grocery","salon","other"].every((b) => auditHtml.includes('value="' + b + '"')));
check("logged-in prefill keeps fields editable", /getProfile\(\)/.test(audit) && !/readOnly/.test(audit));

/* --- db.js: status vocabulary, counts, import helpers --- */
check("setupStatus: 6→complete, 1–5→in-progress, else unknown",
  /step === 6\) return "complete"/.test(db) && /step >= 1 && step <= 5\) return "in-progress"/.test(db));
check("getActivityCounts uses head-only count queries", /count: "exact", head: true/.test(db));
check("guest import helpers exported", /export function listGuestSimStates/.test(db) && /export function clearGuestSimStates/.test(db));

/* --- site-auth: avatar + sign-in logging + resume writer --- */
check("logged-in avatar dropdown with sign-out", /fra-avatar/.test(auth) && /Sign out/.test(auth));
check("auth.sign_in logged once per tab", /auth\.sign_in/.test(auth));
check("cross-device resume writer skips account page", /resume_state/.test(auth) && /account\.html/.test(auth));

/* --- sim-save: step tracking + edit stash --- */
check("save captures savedFromStep", /savedFromStep/.test(simSave));
check("load stash carries step for Open(6)/Edit", /fra_load_setup_step/.test(simSave));
check("edit/update/delete logged", /simulator\.setup_(saved|loaded|updated)/.test(simSave));

/* --- CTA repoint sanity: no audit-intent link left on contact.html --- */
{
  let bad = 0;
  for (const f of fs.readdirSync(ROOT).filter((x) => x.endsWith(".html"))) {
    const h = read(f);
    for (const m of h.matchAll(/<a\b[^>]*href="contact\.html"[^>]*>(.*?)<\/a>/gs)) {
      const t = m[1].replace(/<[^>]+>/g, "").toLowerCase();
      if (t.includes("audit") || t.includes("measuring your effective processing rate")) bad++;
    }
  }
  check("no audit-intent link still points at contact.html", bad === 0);
}

console.log(fails ? `\n${fails} check(s) FAILED` : "\nall dashboard-v2 checks passed");
process.exit(fails ? 1 : 0);
