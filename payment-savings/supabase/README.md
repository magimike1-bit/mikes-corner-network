# Supabase setup for FairRate Audit accounts

The site stays static on Sevalla. Supabase (free tier) provides auth + Postgres.
The frontend uses ONLY the anon (publishable) key — row-level security in
`migrations/001_init.sql` enforces that users can only touch their own rows.

## Joseph's setup checklist (exact clicks)

1. ~~Go to https://supabase.com → **Start your project** → sign in (GitHub is fine).~~ ✅ DONE — project created: `https://mmztfpxbglxhmbzwezga.supabase.co`
2. ~~**New project**...~~ ✅ DONE (free tier).
3. **Run the migration**: left sidebar → **SQL Editor** → **New query** →
   paste the entire contents of `supabase/migrations/001_init.sql` →
   **Run** (or ⌘/Ctrl+Enter). You should see "Success. No rows returned."
4. **Copy the key**: left sidebar → **Project Settings** (gear) → **API**:
   - `Project URL` ✅ already in `js/config.js`
   - `anon` `public` key → ⏳ PENDING — paste into `js/config.js` as `SUPABASE_ANON_KEY` when ready
   - ⚠️ NEVER copy the `service_role` `secret` key anywhere near this repo.
5. **Auth URLs**: left sidebar → **Authentication** → **URL Configuration**:
   - Site URL: `https://payment-savings-draft-lopgi.kinsta.page`
   - Redirect URLs → **Add URL**: `https://payment-savings-draft-lopgi.kinsta.page/account.html`
   - (When the draft graduates to production, add the production URLs too.)
6. **Email templates** (optional but recommended): **Authentication** →
   **Email Templates** → confirm the magic-link / reset templates mention
   FairRate Audit. Supabase sends these from its own mailer on the free tier.
7. Rebuild + deploy: `node tools/build-assets.mjs`, commit, push to `staging`.
   The account pages detect the config automatically — no code change needed.
8. Smoke test: open `account.html` on the draft site → create an account →
   save a simulator setup → open it on another device. That cross-device check
   is the whole point.

## Email alerts (fee-creep + rate-change wire) — not yet wired

The site captures CASL-compliant consent (express checkbox, purpose stated,
consent timestamp stored) and shows alerts in the in-app alert center TODAY.
Actual outbound email is stubbed behind `js/email.js`: to enable, create a
Supabase Edge Function that calls Resend (or Postmark) with your API key, then
point `js/email.js` at it. Do NOT paste the email API key into the repo.

## Backups

- Supabase free tier takes **daily automatic backups** (7-day retention).
  Dashboard → **Database** → **Backups** to verify/restore.
- Extra safety: `supabase/weekly-backup.sh` dumps the database weekly to your
  own storage. It reads the connection string from the environment
  (`FRA_SUPABASE_DB_URL`), never from the repo. Hand it to the ops backup
  routine when ready (script is written; scheduling is a separate decision).

## PIPEDA notes

- Personal data stored: email (auth + alert subscriptions), simulator inputs,
  rate/fee numbers the user typed. All of it is the user's own data, shown
  back only to them (RLS).
- Alert subscriptions store `consent_at` + `consent_source` for CASL.
- Unsubscribe: every email must include the token link
  `https://<site>/alerts.html?unsub=<token>` → calls the `unsubscribe()`
  SQL function. No login required.
- Deletion: deleting the Supabase auth user cascades to profiles and all
  user rows (`on delete cascade`). Wall submissions keep only anonymous
  aggregates.
