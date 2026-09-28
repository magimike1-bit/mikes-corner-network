-- 001_init.sql — FairRate Audit accounts schema
-- Paste into Supabase Dashboard → SQL Editor → New query → Run.
-- Idempotent: safe to run more than once.
--
-- Tables: profiles, simulator_states, rate_runs, fee_entries,
--         alert_subscriptions, referrals, wall_submissions,
--         surcharge_runs, settlement_runs,
--         audit_requests (contact/audit lead capture),
--         briefs (rate-change brief archive),
--         audits (shared-savings deal pipeline — dashboard-managed)
-- RLS is enabled on EVERY table. Clients only ever use the anon key.

-- ============ helpers ============
create extension if not exists "pgcrypto";

-- ============ profiles ============
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  referral_code text unique not null default upper(substring(md5(gen_random_uuid()::text), 1, 8)),
  referred_by uuid references public.profiles(id),
  is_accountant boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
drop policy if exists "profiles read own" on public.profiles;
create policy "profiles read own" on public.profiles
  for select using (auth.uid() = id);
drop policy if exists "profiles insert own" on public.profiles;
create policy "profiles insert own" on public.profiles
  for insert with check (auth.uid() = id);
drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- auto-create a profile row on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

-- ============ simulator_states ============
create table if not exists public.simulator_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  sector text not null,
  state jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.simulator_states enable row level security;
drop policy if exists "simstates own all" on public.simulator_states;
create policy "simstates own all" on public.simulator_states
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============ rate_runs ============
create table if not exists public.rate_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  fees numeric not null check (fees >= 0),
  volume numeric not null check (volume > 0),
  rate_bp integer not null check (rate_bp > 0 and rate_bp < 1500),
  sector text,
  verdict text,
  created_at timestamptz not null default now()
);
alter table public.rate_runs enable row level security;
drop policy if exists "rateruns own all" on public.rate_runs;
create policy "rateruns own all" on public.rate_runs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============ fee_entries (fee-creep tracker) ============
create table if not exists public.fee_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  month date not null,
  fees numeric not null check (fees >= 0),
  volume numeric not null check (volume > 0),
  rate_bp integer not null check (rate_bp > 0 and rate_bp < 1500),
  created_at timestamptz not null default now(),
  unique (user_id, month)
);
alter table public.fee_entries enable row level security;
drop policy if exists "feeentries own all" on public.fee_entries;
create policy "feeentries own all" on public.fee_entries
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============ alert_subscriptions (CASL: consent captured) ============
create table if not exists public.alert_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  email text not null unique
    check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  topics text[] not null default '{}',
  consent_at timestamptz not null default now(),
  consent_source text not null default 'site-form',
  unsub_token uuid not null default gen_random_uuid(),
  unsubscribed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.alert_subscriptions enable row level security;
-- anyone may subscribe (anon insert); only the owning user may read/manage
drop policy if exists "alertsubs anon insert" on public.alert_subscriptions;
create policy "alertsubs anon insert" on public.alert_subscriptions
  for insert to anon, authenticated with check (true);
drop policy if exists "alertsubs read own" on public.alert_subscriptions;
create policy "alertsubs read own" on public.alert_subscriptions
  for select using (auth.uid() = user_id);
drop policy if exists "alertsubs update own" on public.alert_subscriptions;
create policy "alertsubs update own" on public.alert_subscriptions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- token-based unsubscribe without login (link in every email)
create or replace function public.unsubscribe(p_token uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare r int;
begin
  update public.alert_subscriptions
     set unsubscribed_at = now()
   where unsub_token = p_token and unsubscribed_at is null;
  get diagnostics r = row_count;
  return r > 0;
end $$;

-- ============ referrals ============
create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references public.profiles(id) on delete cascade,
  referee_id uuid references public.profiles(id) on delete set null,
  referee_email text,
  status text not null default 'link-clicked'
    check (status in ('link-clicked', 'signed-up', 'audit-signed')),
  lane text not null default 'owner' check (lane in ('owner', 'accountant')),
  created_at timestamptz not null default now(),
  unique (referrer_id, referee_id)
);
alter table public.referrals enable row level security;
drop policy if exists "referrals referrer reads" on public.referrals;
create policy "referrals referrer reads" on public.referrals
  for select using (auth.uid() = referrer_id);
-- no direct client writes: only via the SECURITY DEFINER functions below
create or replace function public.record_referral_click(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare rid uuid; rlane text;
begin
  select id, case when is_accountant then 'accountant' else 'owner' end
    into rid, rlane from public.profiles where referral_code = p_code;
  if rid is null then return; end if;
  insert into public.referrals (referrer_id, status, lane)
  values (rid, 'link-clicked', rlane);
end $$;
create or replace function public.record_referral_signup(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare rid uuid; rlane text;
begin
  if auth.uid() is null then return; end if;
  select id, case when is_accountant then 'accountant' else 'owner' end
    into rid, rlane from public.profiles where referral_code = p_code;
  if rid is null or rid = auth.uid() then return; end if; -- no self-referral
  insert into public.referrals (referrer_id, referee_id, status, lane)
  values (rid, auth.uid(), 'signed-up', rlane)
  on conflict (referrer_id, referee_id) do update
    set status = 'signed-up' where public.referrals.status = 'link-clicked';
end $$;

-- ============ wall_submissions (anonymous aggregation) ============
create table if not exists public.wall_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  processor text not null,
  sector text not null,
  volume_band text not null,
  rate_bp integer not null check (rate_bp > 0 and rate_bp < 1500),
  created_at timestamptz not null default now()
);
alter table public.wall_submissions enable row level security;
-- anyone may submit; NOBODY reads raw rows via the API (aggregates only)
drop policy if exists "wall anon insert" on public.wall_submissions;
create policy "wall anon insert" on public.wall_submissions
  for insert to anon, authenticated with check (true);
-- public aggregate view: medians + sample sizes, cells with < 3 suppressed.
-- A plain view is correct here: it executes with the view owner's (postgres)
-- privileges, so it reads past the table's RLS while direct client queries
-- on wall_submissions stay blocked (no SELECT policy for anon/authenticated).
-- The GROUP BY + HAVING count(*) >= 3 keeps small cells suppressed.
create or replace view public.wall_aggregates as
select processor, sector, volume_band,
       count(*)::int as n,
       percentile_cont(0.5) within group (order by rate_bp)::int as median_bp,
       min(rate_bp)::int as min_bp, max(rate_bp)::int as max_bp
  from public.wall_submissions
 group by processor, sector, volume_band
having count(*) >= 3;
grant select on public.wall_aggregates to anon, authenticated;

-- ============ surcharge_runs / settlement_runs ============
create table if not exists public.surcharge_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  volume numeric not null check (volume >= 0),
  avg_ticket numeric not null check (avg_ticket > 0),
  result jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.surcharge_runs enable row level security;
drop policy if exists "surchargeruns insert any" on public.surcharge_runs;
create policy "surchargeruns insert any" on public.surcharge_runs
  for insert to anon, authenticated with check (user_id is null or auth.uid() = user_id);
drop policy if exists "surchargeruns read own" on public.surcharge_runs;
create policy "surchargeruns read own" on public.surcharge_runs
  for select using (auth.uid() = user_id);

create table if not exists public.settlement_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  volume numeric not null check (volume >= 0),
  pricing_model text not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.settlement_runs enable row level security;
drop policy if exists "settlementruns insert any" on public.settlement_runs;
create policy "settlementruns insert any" on public.settlement_runs
  for insert to anon, authenticated with check (user_id is null or auth.uid() = user_id);
drop policy if exists "settlementruns read own" on public.settlement_runs;
create policy "settlementruns read own" on public.settlement_runs
  for select using (auth.uid() = user_id);

-- ============ audit_requests (contact form / audit lead capture) ============
create table if not exists public.audit_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  name text not null,
  business_name text,
  email text not null
    check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone text,
  volume_band text,
  message text,
  status text not null default 'new'
    check (status in ('new', 'contacted', 'statements-received', 'analyzing',
                      'proposal-sent', 'signed', 'closed', 'spam')),
  created_at timestamptz not null default now()
);
alter table public.audit_requests enable row level security;
-- anyone may request an audit (public contact form); Joseph triages in the
-- dashboard. Logged-in users may read their own requests.
drop policy if exists "auditreq anon insert" on public.audit_requests;
create policy "auditreq anon insert" on public.audit_requests
  for insert to anon, authenticated with check (true);
drop policy if exists "auditreq read own" on public.audit_requests;
create policy "auditreq read own" on public.audit_requests
  for select using (auth.uid() = user_id);

-- ============ briefs (rate-change brief archive) ============
create table if not exists public.briefs (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  summary text,
  body_md text,
  published boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.briefs enable row level security;
-- public may read published briefs; only Joseph (dashboard) writes
drop policy if exists "briefs public read" on public.briefs;
create policy "briefs public read" on public.briefs
  for select to anon, authenticated using (published = true);

-- ============ audits (shared-savings deal pipeline) ============
create table if not exists public.audits (
  id uuid primary key default gen_random_uuid(),
  merchant_name text not null,
  contact_name text,
  contact_email text,
  user_id uuid references public.profiles(id) on delete set null,
  status text not null default 'lead'
    check (status in ('lead', 'statements', 'analysis', 'proposal',
                      'signed', 'monitoring', 'paused', 'lost')),
  monthly_volume numeric
    check (monthly_volume is null or monthly_volume >= 0),
  baseline_rate_bp integer
    check (baseline_rate_bp is null or (baseline_rate_bp > 0 and baseline_rate_bp < 1500)),
  current_rate_bp integer
    check (current_rate_bp is null or (current_rate_bp > 0 and current_rate_bp < 1500)),
  savings_share_bp integer not null default 5000
    check (savings_share_bp > 0 and savings_share_bp <= 10000), -- 5000 = 50/50
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.audits enable row level security;
-- no client policies: Joseph manages the pipeline in the Supabase dashboard.
-- merchant-facing reads get added when a client portal ships.
