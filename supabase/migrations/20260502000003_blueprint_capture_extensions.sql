-- Blueprint capture extensions.
--
-- The wizard now collects more identity + reachability + context
-- than v1's first cut. business_name / owner_name / owner_email were
-- already present; this migration adds the remaining contact field
-- (whatsapp_number) so it lives as a typed column rather than buried
-- in the answers JSONB. Other new wizard fields (business_location,
-- operating_mode, existing_presence, domain_ideas) stay in answers
-- because they aren't read by integrations — only by Claude.
--
-- Column type is text (not phone-specific) but the application
-- normalises to E.164 (+91XXXXXXXXXX) on insert, so anything stored
-- here is dial-ready for Twilio / WhatsApp Business API.

alter table website_blueprints
  add column whatsapp_number text;

-- Lowercase index for future "have we already heard from this owner?"
-- lookups by phone, mirroring the owner_email index pattern. The case
-- normalisation is symbolic for phone numbers (digits only after
-- normalisation) but keeps the index expression consistent.
create index website_blueprints_whatsapp_number_idx
  on website_blueprints (whatsapp_number);
