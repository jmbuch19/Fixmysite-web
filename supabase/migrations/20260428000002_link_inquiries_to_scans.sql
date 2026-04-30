-- Link enterprise_inquiries to scans for the size-based Complex-tier OTP gate
-- (SPEC §4 size-based email rules). Self-serve URLs that hit Large tier
-- (51–200 pages) require domain verification before they can be charged.
-- The inquiry stores OTP state and references the scan it's verifying.
--
-- Existing rows (Path A/B/C — enterprise + institution) have scan_id = null.
-- New Path D Large-tier inquiries get scan_id set + url_class = 'self_serve'.

alter table enterprise_inquiries
  add column scan_id uuid references scans(id) on delete cascade;

create index enterprise_inquiries_scan_id_idx
  on enterprise_inquiries (scan_id);

-- Extend url_class to include 'self_serve' for Complex-tier verifications.
alter table enterprise_inquiries
  drop constraint enterprise_inquiries_url_class_chk;

alter table enterprise_inquiries
  add constraint enterprise_inquiries_url_class_chk
  check (url_class in (
    'global_enterprise',
    'indian_enterprise',
    'institution',
    'self_serve'
  ));
