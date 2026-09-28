-- 002_dashboard_v2.sql — account dashboard v2 + audit intake form (PS-FORM)
--
-- What it does and why:
--  1. activity_log: per-user event log backing the dashboard's "Activity
--     history", "Simulator logs", and the Profile counts (visits, saves).
--     Client inserts its own rows; never updated or deleted.
--  2. simulator_states.saved_from_step: mirrors the savedFromStep field in
--     the state JSON so the dashboard can render Complete/In progress/
--     Unknown chips without parsing JSONB.
--  3. profiles.resume_state: per-account "where you left off" (cross-device);
--     the existing "profiles update own" policy already covers the new column.
--  4. audits read-own policy: lets a signed-in client read the pipeline rows
--     Joseph linked to their user_id (dashboard "Free audit results").
--  5. audit_requests: two new nullable columns for the intake form
--     (business_type, current_processor) + an adoption policy so a guest
--     submission is claimed by the account with the matching email on signup.
--
-- Run in the Supabase dashboard SQL editor. Idempotent — safe to re-run.

-- ============ 1. activity_log ============
create table if not exists public.activity_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  label text not null,
  detail jsonb,
  created_at timestamptz not null default now()
);
alter table public.activity_log enable row level security;
drop policy if exists "activitylog read own" on public.activity_log;
create policy "activitylog read own" on public.activity_log
  for select using (auth.uid() = user_id);
drop policy if exists "activitylog insert own" on public.activity_log;
create policy "activitylog insert own" on public.activity_log
  for insert with check (auth.uid() = user_id);
-- no update / delete policies: the log is append-only.
create index if not exists idx_activity_log_user_created
  on public.activity_log(user_id, created_at desc);

-- ============ 2. simulator_states.saved_from_step ============
alter table public.simulator_states
  add column if not exists saved_from_step smallint;

-- ============ 3. profiles.resume_state ============
-- { page, title, at, setupId, setupName } — per-account resume, cross-device.
-- Written by the client on page views (only when changed); read by the
-- dashboard's "Pick up where you left off" card. Covered by the existing
-- "profiles update own" / "profiles read own" policies (auth.uid() = id).
alter table public.profiles
  add column if not exists resume_state jsonb;

-- ============ 4. audits: client read-own ============
-- Joseph manages the pipeline in the dashboard; clients may read only rows
-- he linked to their user_id. No anon access, no client writes.
drop policy if exists "audits read own" on public.audits;
create policy "audits read own" on public.audits
  for select using (auth.uid() = user_id);

-- ============ 5. audit_requests: intake-form columns + adoption ============
alter table public.audit_requests
  add column if not exists business_type text;
alter table public.audit_requests
  add column if not exists current_processor text;

-- Guest submitted, then signed up: let the new account claim its own
-- anonymous rows by matching the verified email on the JWT. The USING clause
-- limits the claim to rows with no owner; the WITH CHECK forces user_id to
-- the caller's own id — a user can never adopt anyone else's rows.
drop policy if exists "auditreq adopt own" on public.audit_requests;
create policy "auditreq adopt own" on public.audit_requests
  for update to authenticated
  using (user_id is null and email = (auth.jwt() ->> 'email'))
  with check (auth.uid() = user_id);

-- The adoption policy matches on email — index it.
create index if not exists idx_audit_requests_email on public.audit_requests(email);
