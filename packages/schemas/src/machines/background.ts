// Background work as data: the database queue, its idempotency receipts, the
// portal's export jobs and the cron heartbeat.
import { defineStateMachine } from "../state-machine";

// app_queue_job.status (packages/db/src/queue.ts, the only writer)
//   create         enqueue: PENDING
//   claim          a worker leases the row (FOR UPDATE SKIP LOCKED)
//   complete       the lease holder finished it
//   fail           the lease holder failed: back to PENDING with a backoff, or
//                    FAILED when attempts are exhausted
//   dead_letter    the lease holder gives up at once (a permanent error)
//   reclaim_stale  a lease that expired: PENDING again, or FAILED when exhausted
//   settle_inline  the demo seed runs a queued job inline and marks it done
const APP_QUEUE_JOB_STATUSES = [
  "PENDING",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
] as const;
export type AppQueueJobStatus = (typeof APP_QUEUE_JOB_STATUSES)[number];

export const APP_QUEUE_JOB_MACHINE = defineStateMachine({
  name: "queue job",
  states: APP_QUEUE_JOB_STATUSES,
  commands: [
    "create",
    "claim",
    "complete",
    "fail",
    "dead_letter",
    "reclaim_stale",
    "settle_inline",
  ],
  transitions: [
    { from: null, command: "create", to: "PENDING" },
    { from: "PENDING", command: "claim", to: "PROCESSING" },
    { from: "PROCESSING", command: "complete", to: "COMPLETED" },
    { from: "PROCESSING", command: "fail", to: "PENDING" },
    { from: "PROCESSING", command: "fail", to: "FAILED" },
    { from: "PROCESSING", command: "dead_letter", to: "FAILED" },
    { from: "PROCESSING", command: "reclaim_stale", to: "PENDING" },
    { from: "PROCESSING", command: "reclaim_stale", to: "FAILED" },
    { from: "PENDING", command: "settle_inline", to: "COMPLETED" },
  ],
});

// queue_job_receipt.status: the idempotency ledger of a consumer
// (packages/db/src/queue-receipts.ts). A failed run is an expired lease on a
// RUNNING receipt, claimed again by the next delivery.
//   claim     insert RUNNING, or re-lease a RUNNING one whose lease expired
//   complete  the consumer finished: COMPLETED, never claimed again
const QUEUE_JOB_RECEIPT_STATUSES = ["RUNNING", "COMPLETED"] as const;
export type QueueJobReceiptStatus = (typeof QUEUE_JOB_RECEIPT_STATUSES)[number];

export const QUEUE_JOB_RECEIPT_MACHINE = defineStateMachine({
  name: "queue job receipt",
  states: QUEUE_JOB_RECEIPT_STATUSES,
  commands: ["claim", "complete"],
  transitions: [
    { from: null, command: "claim", to: "RUNNING" },
    { from: "RUNNING", command: "claim", to: "RUNNING" },
    { from: "RUNNING", command: "complete", to: "COMPLETED" },
  ],
});

// portal_export_job.status: a customer's audit-pack export (portal).
//   create    apps/api/src/routes/portal.ts: PENDING
//   claim     packages/jobs-core/src/audit-pack.ts (a redelivery re-claims a
//               PROCESSING one)
//   complete  the pack was stored
//   fail      the build failed; a finished export is never overwritten
const PORTAL_EXPORT_JOB_STATUSES = [
  "PENDING",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
] as const;
export type PortalExportJobStatus = (typeof PORTAL_EXPORT_JOB_STATUSES)[number];

export const PORTAL_EXPORT_JOB_MACHINE = defineStateMachine({
  name: "portal export job",
  states: PORTAL_EXPORT_JOB_STATUSES,
  commands: ["create", "claim", "complete", "fail"],
  transitions: [
    { from: null, command: "create", to: "PENDING" },
    { from: "PENDING", command: "claim", to: "PROCESSING" },
    { from: "PROCESSING", command: "claim", to: "PROCESSING" },
    { from: "PROCESSING", command: "complete", to: "COMPLETED" },
    { from: "PENDING", command: "fail", to: "FAILED" },
    { from: "PROCESSING", command: "fail", to: "FAILED" },
  ],
});

// cron_run.last_status: the outcome of a cron's last run (apps/api/src/cron/
// cron-run.ts). NULL until the first outcome is recorded.
const CRON_RUN_STATUSES = ["ok", "error"] as const;

export const CRON_RUN_MACHINE = defineStateMachine({
  name: "cron run",
  states: CRON_RUN_STATUSES,
  commands: ["record"],
  transitions: [
    { from: null, command: "record", to: "ok" },
    { from: null, command: "record", to: "error" },
    { from: "ok", command: "record", to: "error" },
    { from: "error", command: "record", to: "ok" },
  ],
});
