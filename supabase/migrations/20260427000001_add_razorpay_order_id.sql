-- Add Razorpay order_id mapping to scans for secure /api/payment/verify lookups.
-- Without this column the verify route cannot prove that an order_id corresponds
-- to a particular scan_id, allowing an attacker to pay for a cheap scan and
-- claim the payment is for an expensive one (signature would still verify
-- because it is mathematically valid for the cheap order).

alter table scans add column razorpay_order_id text;

-- Unique because one Razorpay order belongs to exactly one scan.
-- Postgres allows multiple NULLs in a unique index, so pre-payment rows
-- (razorpay_order_id IS NULL) coexist fine.
create unique index scans_razorpay_order_id_idx on scans (razorpay_order_id);
