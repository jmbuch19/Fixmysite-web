-- Enterprise inquiries — Path A (global enterprise), Path B (Indian enterprise),
-- and Path C (institution) all converge into this table once a domain-matching
-- email has been entered and an OTP has been sent. Inquiries are reviewed
-- manually by the admin and either approved with a quoted price or rejected.
--
-- Self-serve scans (Path D) and fun-seeker exits (Path E) never write here.
--
-- All otp_code values are bcrypt hashes — never store the plain OTP.

create table enterprise_inquiries (
  id                    uuid primary key default gen_random_uuid(),
  url                   text not null,
  url_normalized        text not null,
  url_class             text not null,
  claimed_email         text not null,
  email_domain          text not null,
  url_domain            text not null,
  domain_match          boolean not null,

  -- OTP state
  otp_code              text,            -- bcrypt hash, never plain text
  otp_sent_at           timestamptz,
  otp_verified          boolean not null default false,
  otp_verified_at       timestamptz,
  otp_attempts          int not null default 0,

  -- Admin workflow
  manually_approved     boolean not null default false,
  manually_approved_by  text,
  status                text not null default 'pending',
  institution_type      text,
  quoted_price          int,             -- in paise; admin sets per inquiry
  notes                 text,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint enterprise_inquiries_url_class_chk
    check (url_class in ('global_enterprise','indian_enterprise','institution')),
  constraint enterprise_inquiries_status_chk
    check (status in ('pending','otp_verified','approved','rejected','converted')),
  constraint enterprise_inquiries_institution_type_chk
    check (institution_type is null or institution_type in
      ('ngo','college','university','government','research')),
  constraint enterprise_inquiries_otp_attempts_chk
    check (otp_attempts >= 0)
);

create index enterprise_inquiries_url_normalized_idx
  on enterprise_inquiries (url_normalized);

create index enterprise_inquiries_status_idx
  on enterprise_inquiries (status);

create index enterprise_inquiries_created_at_desc_idx
  on enterprise_inquiries (created_at desc);

-- Reuse the trigger function from the initial migration to keep updated_at fresh.
create trigger enterprise_inquiries_set_updated_at
before update on enterprise_inquiries
for each row
execute function set_updated_at();

-- RLS enabled with no policies — service-role-only access via API routes,
-- matching the policy applied to all other tables in 20260426000001.
alter table enterprise_inquiries enable row level security;
