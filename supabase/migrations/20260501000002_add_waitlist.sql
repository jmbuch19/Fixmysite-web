-- waitlist — second-door capture for visitors without a website yet.
-- Lightweight: just enough to email them when website planning ships.
-- The full Blueprint Engine product comes later.

create table waitlist (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  source      text not null default 'landing',
  created_at  timestamptz not null default now()
);

-- Case-insensitive uniqueness on email — Email@x.com and email@x.com
-- represent the same person; one of them shouldn't be allowed in twice.
create unique index waitlist_email_lower_idx
  on waitlist (lower(email));

create index waitlist_created_at_idx on waitlist (created_at desc);
create index waitlist_source_idx     on waitlist (source);

-- ---------------------------------------------------------------------------
-- Row Level Security — same pattern as every other table in this project.
-- RLS enabled, no policies. All access via SUPABASE_SERVICE_ROLE_KEY
-- which bypasses RLS.
-- ---------------------------------------------------------------------------

alter table waitlist enable row level security;
