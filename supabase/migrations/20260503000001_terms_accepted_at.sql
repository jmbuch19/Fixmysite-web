-- T&C acceptance audit trail across all paid-product tables.
--
-- Set when /api/.../payment/create-order accepts an order; the create-
-- order routes refuse to create an order without `terms_accepted: true`
-- in the body, so a populated timestamp here proves the owner ticked
-- the consent box before the Razorpay modal opened.
--
-- Used for dispute defence: a chargeback claiming "I never agreed to
-- your terms" can be answered with the timestamp + the row's
-- razorpay_order_id binding.

alter table scans
  add column terms_accepted_at timestamptz;

alter table briefs
  add column terms_accepted_at timestamptz;

alter table website_blueprints
  add column terms_accepted_at timestamptz;
