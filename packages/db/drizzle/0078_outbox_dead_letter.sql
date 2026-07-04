-- REQ-REL-OBS-003 (issue #653 / REL-04): explicit dead-letter marker for the
-- service-order email outbox. The drain selects rows with attempts < maxAttempts;
-- once a release pushes attempts to maxAttempts the row is never selected again.
-- Previously that exhaustion was silent (no state, no alert). `dead_letter_at` is
-- set at that moment so the exhausted row becomes a queryable state: the
-- backoffice surfaces it and the operator-alert engine pages on it. Distinct from
-- `processed_at` (which means "succeeded"). Forward-only, additive (nullable, no
-- default) so it is safe to apply while the app is running.
ALTER TABLE "service_order_email_outbox" ADD COLUMN "dead_letter_at" timestamp;
