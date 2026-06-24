-- Add a lease marker to the service-order email outbox so a drain run killed
-- mid-send no longer strands the claimed row. Previously `processed_at` doubled
-- as both the in-flight claim marker (set at claim time) and the terminal "done"
-- marker, so a row claimed-but-not-sent was indistinguishable from a sent one
-- and could never be safely retried. Now `claimed_at` is the lease (set at
-- claim, cleared on failure) and `processed_at` means "done" only (set on
-- success). The drain reclaims any row whose `claimed_at` is older than its
-- lease window, so stranded rows auto-recover. Additive + nullable: existing
-- pending rows (claimed_at NULL) remain immediately claimable.
ALTER TABLE "service_order_email_outbox" ADD COLUMN "claimed_at" timestamp;
