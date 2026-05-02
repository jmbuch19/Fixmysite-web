-- Blueprint share-to-developer audit trail.
--
-- The /api/blueprint/send-developer route writes the developer's
-- email here on successful forwarding. Mirrors briefs.dev_email —
-- gives the admin panel a quick "who saw this blueprint?" view and
-- lets us close the loop with the developer if the owner asks for
-- a follow-up.

alter table website_blueprints
  add column dev_email text;

-- Lowercase index for the future "any blueprints already shared with
-- this developer?" lookup. Same expression-index pattern as
-- briefs.dev_email and website_blueprints.owner_email.
create index website_blueprints_dev_email_idx
  on website_blueprints (lower(dev_email));
