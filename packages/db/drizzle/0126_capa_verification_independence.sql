-- Independent CAPA verification (decision Q50, architecture review A1).
--
-- A CAPA's effectiveness is verified by someone who is neither its owner (now or ever) nor
-- anyone who implemented it. When the laboratory has no other eligible verifier, the sole one
-- may verify with a written justification: the verification records how independent it was and,
-- for the waiver, why. Both columns are nullable: CAPAs verified before this migration carry
-- neither value.
--
-- Idempotent (IF NOT EXISTS): this project applies migration DDL by hand and the drizzle
-- bookkeeping table lags behind it. SET LOCAL lock_timeout fails fast instead of queueing
-- behind a long transaction while the short ACCESS EXCLUSIVE lock is taken.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "corrective_action" ADD COLUMN IF NOT EXISTS "verification_independence" text;
--> statement-breakpoint
ALTER TABLE "corrective_action" ADD COLUMN IF NOT EXISTS "verification_independence_justification" text;
