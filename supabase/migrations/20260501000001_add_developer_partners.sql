-- developer_partners + developer_leads — SPEC §19 partner network
-- v1.0.1: registration flow only. Admin approval, lead matching, and
-- the agency dashboard land in later migrations / routes.

-- ===========================================================================
-- developer_partners
-- ===========================================================================
create table developer_partners (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  email             text not null,
  phone             text not null,
  city              text not null,
  skills            text[] not null default '{}',
  portfolio_url     text,
  years_exp         int,
  plan              text not null default 'free',
  rating            numeric(3,2),
  jobs_completed    int not null default 0,
  referral_count    int not null default 0,
  earnings_total    int not null default 0,           -- paise
  verified          boolean not null default false,
  active            boolean not null default true,
  agency_name       text,
  agency_logo_url   text,                              -- R2 signed URL
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint developer_partners_plan_chk
    check (plan in ('free', 'agency')),
  constraint developer_partners_years_exp_chk
    check (years_exp is null or (years_exp >= 0 and years_exp <= 60)),
  constraint developer_partners_rating_chk
    check (rating is null or (rating >= 0 and rating <= 5))
);

-- Case-insensitive unique on email — applicants who type Email@x.com vs
-- email@x.com should not be allowed to double-register.
create unique index developer_partners_email_lower_idx
  on developer_partners (lower(email));

create index developer_partners_city_idx       on developer_partners (city);
create index developer_partners_verified_idx   on developer_partners (verified, active);
create index developer_partners_created_at_idx on developer_partners (created_at desc);

create trigger developer_partners_set_updated_at
before update on developer_partners
for each row
execute function set_updated_at();

-- ===========================================================================
-- developer_leads (table created now; lead-matching logic ships later)
-- ===========================================================================
create table developer_leads (
  id              uuid primary key default gen_random_uuid(),
  scan_id         uuid references scans(id) on delete cascade,
  developer_id    uuid references developer_partners(id) on delete set null,
  status          text not null default 'sent',
  fee_paise       int,
  fee_collected   boolean not null default false,
  owner_rating    int,
  owner_review    text,
  sent_at         timestamptz not null default now(),
  responded_at    timestamptz,
  completed_at    timestamptz,

  constraint developer_leads_status_chk
    check (status in ('sent', 'accepted', 'declined', 'completed')),
  constraint developer_leads_owner_rating_chk
    check (owner_rating is null or (owner_rating >= 1 and owner_rating <= 5))
);

create index developer_leads_scan_id_idx      on developer_leads (scan_id);
create index developer_leads_developer_id_idx on developer_leads (developer_id);
create index developer_leads_status_idx       on developer_leads (status);

-- ---------------------------------------------------------------------------
-- Row Level Security — same pattern as the other tables in this project.
-- RLS enabled, NO policies. All access goes through server-side routes
-- using SUPABASE_SERVICE_ROLE_KEY (which bypasses RLS).
-- ---------------------------------------------------------------------------

alter table developer_partners enable row level security;
alter table developer_leads    enable row level security;
