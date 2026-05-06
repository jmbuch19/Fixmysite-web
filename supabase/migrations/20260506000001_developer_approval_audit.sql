-- developer_partners: approval audit columns
-- Adds telemetry for the new approval flow (one-click admin links + 48h
-- auto-approval cron). Existing rows are unaffected and remain queryable
-- the same way; both columns are nullable.
--
-- The flow that uses these columns:
--   - Admin clicks Approve link in /api/developer/register's notification
--     email     → verified=true, verified_at=now(), decision_method='admin'
--   - Admin clicks Reject link → active=false (no decision_method change;
--     a reject is not an "approval method")
--   - 48h cron auto-approves any verified=false AND active=true row whose
--     created_at is older than 48h     → verified=true, verified_at=now(),
--     decision_method='auto'

alter table developer_partners
  add column if not exists verified_at      timestamptz,
  add column if not exists decision_method  text;

alter table developer_partners
  add constraint developer_partners_decision_method_chk
  check (decision_method is null or decision_method in ('admin', 'auto'));

-- Cron query hits this index every hour — keeps the auto-approval scan
-- O(log n) even after thousands of partners register. Partial index on
-- the pending state only, so it stays small as approved rows pile up.
create index if not exists developer_partners_pending_auto_approve_idx
  on developer_partners (created_at)
  where verified = false and active = true;
