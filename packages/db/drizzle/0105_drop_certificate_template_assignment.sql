-- Companion to 0104: remove the scope/priority assignment machinery now that
-- template selection is the method's own certificate_template_id.
--
-- APPLY ONLY AFTER the 0104-aware build is live and verified — the previous
-- build's issuance resolver still queries this table.

DROP TABLE IF EXISTS "certificate_template_assignment";
