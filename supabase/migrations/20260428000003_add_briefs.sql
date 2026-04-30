-- Briefs — developer-brief module (SPEC §15).
--
-- A brief is a translation of an owner's plain-language website
-- improvement requests into a structured technical document for their
-- developer. Linked to the scan that triggered the post-scan upsell.
--
-- Brief generation is a separate Claude call from the report (CLAUDE.md
-- rule 28). brief_json is the structured output; brief_pdf_url is the
-- on-demand R2 link with 24-hour expiry (CLAUDE.md PDF rules).

create table briefs (
  id                     uuid primary key default gen_random_uuid(),
  scan_id                uuid references scans(id) on delete set null,

  -- Input
  owner_input            text,                                 -- preserved verbatim, any language
  detected_language      text,                                 -- ISO 639-1 (en | hi | gu | mr | ta …)
  business_type          text,                                 -- Claude-detected category
  screenshots            jsonb,                                -- array of R2 signed URLs
  predefined_selections  jsonb,                                -- array of nudge card keys

  -- Output
  brief_json             jsonb,                                -- structured brief from Claude
  brief_pdf_url          text,                                 -- R2 signed URL, 24-hr expiry

  -- Payment
  payment_id             text,
  payment_status         text not null default 'unpaid',

  -- Recipients
  owner_email            text,
  dev_email              text,

  created_at             timestamptz not null default now(),
  sent_at                timestamptz,

  constraint briefs_payment_status_chk
    check (payment_status in ('unpaid','paid','refunded','failed'))
);

create index briefs_scan_id_idx          on briefs (scan_id);
create index briefs_payment_status_idx   on briefs (payment_status);
create index briefs_owner_email_idx      on briefs (owner_email);
create index briefs_created_at_desc_idx  on briefs (created_at desc);

-- RLS enabled with no policies — service-role-only access via API routes,
-- matching every other fixmysite table.
alter table briefs enable row level security;
