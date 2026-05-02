-- Brief payment extensions
--
-- Two columns needed before brief payment + Razorpay flow can ship:
--
--   1. razorpay_order_id — same defence-in-depth pattern the scans table
--      uses (see migration 20260427000001). Without binding order to
--      brief_id, an attacker could pay for a cheap brief and claim the
--      payment unlocks an expensive one. Razorpay signature verification
--      alone is not enough — the order_id has to match the brief_id we
--      think the payment is for.
--
--   2. price_paise — current pricing is fixed at ₹99 (9900 paise) for the
--      text-only tier. Storing the price per-row rather than reading it
--      from a config means future tier additions (₹199 with_screenshots,
--      ₹199 scan+brief bundle) won't need either a schema change or
--      historical-record rewriting.

alter table briefs
  add column razorpay_order_id text,
  add column price_paise       int not null default 9900;

-- Unique partial index — one Razorpay order belongs to exactly one brief.
-- Postgres allows multiple NULLs in a unique index, so pre-payment rows
-- (razorpay_order_id IS NULL) coexist fine. Mirrors
-- scans_razorpay_order_id_idx exactly.
create unique index briefs_razorpay_order_id_idx
  on briefs (razorpay_order_id);
