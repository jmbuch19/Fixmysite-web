-- fixmysite.in — initial schema
-- Tables: scans, issues, subscriptions, developer_sends
-- RLS enabled with no policies → all access goes through server-side routes
-- using SUPABASE_SERVICE_ROLE_KEY (which bypasses RLS).

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Helper: shared trigger to keep updated_at fresh
-- ---------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ===========================================================================
-- scans
-- ===========================================================================
create table scans (
  id                 uuid primary key default gen_random_uuid(),
  url                text not null,
  url_normalized     text not null,
  page_count         int,
  tier               text,
  status             text,
  phase1_result      jsonb,
  phase2_result      jsonb,
  report_json        jsonb,
  health_score       int,
  created_at         timestamptz not null default now(),
  completed_at       timestamptz,
  payment_id         text,
  payment_status     text not null default 'unpaid',
  owner_email        text,
  previous_scan_id   uuid references scans(id) on delete set null,
  is_free_rescan     boolean not null default false,
  fix_rate           numeric(4,2),
  resolved_count     int,
  new_issues_count   int,
  unchanged_count    int,
  return_message     text,

  constraint scans_tier_chk
    check (tier is null or tier in ('small','medium','large','enterprise')),
  constraint scans_status_chk
    check (status is null or status in ('phase1_complete','paid','scanning','complete','failed')),
  constraint scans_payment_status_chk
    check (payment_status in ('unpaid','paid','refunded','failed')),
  constraint scans_health_score_chk
    check (health_score is null or (health_score >= 0 and health_score <= 100)),
  constraint scans_fix_rate_chk
    check (fix_rate is null or (fix_rate >= 0 and fix_rate <= 1))
);

create index scans_url_normalized_idx on scans (url_normalized);
create index scans_payment_status_status_idx on scans (payment_status, status);
create index scans_created_at_desc_idx on scans (created_at desc);

-- ===========================================================================
-- issues
-- ===========================================================================
create table issues (
  id          uuid primary key default gen_random_uuid(),
  scan_id     uuid not null references scans(id) on delete cascade,
  category    text,
  item        text,
  status      text,
  detail      text,
  priority    text,
  effort      text,
  action      text,

  constraint issues_category_chk
    check (category is null or category in
      ('contact','links','trust','content','visual','workflow','technical')),
  constraint issues_status_chk
    check (status is null or status in ('ok','fail','warning')),
  constraint issues_priority_chk
    check (priority is null or priority in ('high','medium','low')),
  constraint issues_effort_chk
    check (effort is null or effort in ('low','medium','high'))
);

create index issues_scan_id_idx on issues (scan_id);

-- ===========================================================================
-- subscriptions
-- ===========================================================================
create table subscriptions (
  id              uuid primary key default gen_random_uuid(),
  url             text not null,
  owner_email     text not null,
  plan            text,
  razorpay_sub_id text,
  status          text not null default 'active',
  last_scan_id    uuid references scans(id) on delete set null,
  next_scan_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint subscriptions_plan_chk
    check (plan is null or plan in ('monthly','agency')),
  constraint subscriptions_status_chk
    check (status in ('active','cancelled','paused'))
);

create index subscriptions_next_scan_at_idx on subscriptions (next_scan_at);
create index subscriptions_url_idx on subscriptions (url);

create trigger subscriptions_set_updated_at
before update on subscriptions
for each row
execute function set_updated_at();

-- ===========================================================================
-- developer_sends
-- ===========================================================================
create table developer_sends (
  id          uuid primary key default gen_random_uuid(),
  scan_id     uuid not null references scans(id) on delete cascade,
  dev_email   text not null,
  sent_at     timestamptz not null default now(),
  status      text,

  constraint developer_sends_status_chk
    check (status is null or status in ('sent','failed'))
);

create index developer_sends_scan_id_idx on developer_sends (scan_id);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- RLS is enabled on every table with NO policies defined.
-- Effect: anon and authenticated roles cannot read or write any row.
-- All application access must go through server-side API routes that use
-- SUPABASE_SERVICE_ROLE_KEY (which bypasses RLS).
-- If direct client access is ever needed (e.g. realtime scan progress),
-- add scoped policies in a follow-up migration.

alter table scans            enable row level security;
alter table issues           enable row level security;
alter table subscriptions    enable row level security;
alter table developer_sends  enable row level security;
