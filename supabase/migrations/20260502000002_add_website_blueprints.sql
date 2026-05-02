-- Website Blueprint Engine — SPEC §20.
--
-- Second door of fixmysite.in: businesses with no website yet. Cascading
-- question engine collects intent + business reality + technical context,
-- Claude turns it into a reasoned recommendation (feature | platform |
-- ecommerce | custom) with explicit "why this is right / why the
-- alternatives are wrong" reasoning.
--
-- Session 1 lands the table + question UI + draft persistence only.
-- Claude generation, payment, and PDF ship in later sessions.

create table website_blueprints (
  id                    uuid primary key default gen_random_uuid(),

  -- Identity (all optional — spec calls out the question engine doesn't
  -- gate on identity until the payment step).
  business_type         text,
  business_name         text,
  owner_name            text,
  owner_email           text,

  -- Cascading question answers. JSONB rather than a wide column set
  -- because Branch 2 questions differ by Branch 1 answer — the answer
  -- shape is genuinely dynamic. Default '{}' (not null '{}') so an
  -- empty insert reads back as a valid object.
  answers               jsonb not null default '{}'::jsonb,
  free_text             text,
  free_text_language    text,                              -- Claude-detected ISO 639-1

  -- Claude output (filled after generation step in a later session)
  recommendation        text,                              -- feature | platform | ecommerce | custom
  blueprint_json        jsonb,
  health_score          int,                               -- always null per SPEC; column present for schema parity with scans

  -- Payment
  payment_id            text,
  razorpay_order_id     text,
  payment_status        text not null default 'unpaid',

  -- State
  status                text not null default 'draft',     -- draft | generated | paid | complete
  created_at            timestamptz not null default now(),
  completed_at          timestamptz,

  constraint blueprints_recommendation_chk
    check (recommendation is null
           or recommendation in ('feature', 'platform', 'ecommerce', 'custom')),
  constraint blueprints_payment_status_chk
    check (payment_status in ('unpaid', 'paid', 'refunded', 'failed')),
  constraint blueprints_status_chk
    check (status in ('draft', 'generated', 'paid', 'complete'))
);

-- One Razorpay order belongs to exactly one blueprint. NULLs allowed
-- (drafts have no order yet); pattern mirrors scans + briefs.
create unique index website_blueprints_razorpay_order_id_idx
  on website_blueprints (razorpay_order_id);

create index website_blueprints_status_idx          on website_blueprints (status, payment_status);
create index website_blueprints_owner_email_idx     on website_blueprints (lower(owner_email));
create index website_blueprints_created_at_desc_idx on website_blueprints (created_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security — same pattern as every other fixmysite table.
-- RLS enabled, no policies. All access via SUPABASE_SERVICE_ROLE_KEY
-- which bypasses RLS.
-- ---------------------------------------------------------------------------

alter table website_blueprints enable row level security;
