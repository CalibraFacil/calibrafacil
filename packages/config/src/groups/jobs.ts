import {
  choice,
  defineGroup,
  example,
  integer,
  list,
  text,
  url,
} from "../define.ts";
import { vercelVar } from "./runtime.ts";

export const jobsGroup = defineGroup({
  name: "jobs",
  title: "Background jobs",
  intro: [
    "BACKGROUND_JOBS_MODE: local = the API runs PDF/integration jobs in-process",
    "(development); queue = jobs wait in the database for apps/worker (polling, or",
    "woken through DOCUMENT_WORKER_URL); vercel = jobs are published to Vercel Queue",
    "and consumed by apps/worker; inline = run inside the request (tests).",
  ],
  vars: {
    modeSetting: choice({
      env: "BACKGROUND_JOBS_MODE",
      description:
        "Where background jobs run: local, queue, vercel or inline (default: vercel on Vercel, local elsewhere).",
      values: ["local", "queue", "vercel", "inline"],
      example: example.active("local"),
    }),
    topic: text({
      env: "BACKGROUND_JOBS_TOPIC",
      description: "Vercel Queue topic the jobs are published to.",
      default: "calibra-facil-background-jobs",
      hidden: true,
    }),
    vercelQueueRegion: text({
      env: "VERCEL_QUEUE_REGION",
      description: "Vercel Queue region.",
      default: "gru1",
      hidden: true,
    }),
    maxDeliveries: integer({
      env: "BACKGROUND_JOBS_MAX_DELIVERIES",
      description:
        "Vercel deliveries before a certificate is rejected. An unusable value means the default.",
      min: 1,
      default: 3,
      tolerant: true,
      example: example.commented("3"),
    }),
    documentWorkerUrl: url({
      env: "DOCUMENT_WORKER_URL",
      description:
        "queue only: the document worker's drain server, woken after each enqueue.",
      example: example.commented("http://document-worker:8080"),
    }),
    documentWorkerToken: text({
      env: "DOCUMENT_WORKER_TOKEN",
      description: "Shared secret sent to the document worker's drain server.",
      secret: true,
    }),
    documentWorkerJobTypes: list({
      env: "DOCUMENT_WORKER_JOB_TYPES",
      description:
        "Job types routed to the document worker (comma-separated); empty means every queue job type.",
      hidden: true,
    }),
    documentWorkerWakeTimeoutMs: integer({
      env: "DOCUMENT_WORKER_WAKE_TIMEOUT_MS",
      description:
        "Per-attempt timeout of the wake-up ping to the document worker.",
      min: 1,
      default: 12_000,
      hidden: true,
    }),
    documentWorkerWakeAttempts: integer({
      env: "DOCUMENT_WORKER_WAKE_ATTEMPTS",
      description: "Attempts of the wake-up ping to the document worker.",
      min: 1,
      default: 2,
      hidden: true,
    }),
    documentWorkerWakeRetryDelayMs: integer({
      env: "DOCUMENT_WORKER_WAKE_RETRY_DELAY_MS",
      description: "Pause between wake-up attempts.",
      min: 0,
      default: 500,
      hidden: true,
    }),
    stuckRenderAfterMs: integer({
      env: "STUCK_RENDER_AFTER_MS",
      description:
        "A GENERATING_PDF certificate older than this with no live queue row is rejected (default 60 minutes).",
      min: 1,
      default: 3_600_000,
      example: example.commented("3600000"),
    }),
    queueStaleAfterMs: integer({
      env: "QUEUE_STALE_AFTER_MS",
      description:
        "A claimed queue job idle for longer than this is released for another worker (default 10 minutes).",
      min: 1,
      default: 600_000,
      example: example.commented("600000"),
    }),
    queueReceiptsMode: choice({
      env: "QUEUE_RECEIPTS_MODE",
      description:
        "Queue idempotency ledger: enforce (default) skips completed duplicates; shadow records and logs them but always runs; off disables it. An unrecognised value means enforce.",
      values: ["off", "shadow", "enforce"],
      default: "enforce",
      tolerant: true,
      example: example.commented("enforce"),
    }),
    queueReceiptLeaseMs: integer({
      env: "QUEUE_RECEIPT_LEASE_MS",
      description:
        "How long a queue receipt lease is held (default 10 minutes). An unusable value means the default.",
      min: 1,
      default: 600_000,
      tolerant: true,
      hidden: true,
    }),
    cronScheduler: choice({
      env: "CRON_SCHEDULER",
      description:
        "`internal` runs the vercel.json cron schedule inside the API process, for installs without an external scheduler (the Docker setup turns it on). Any other value leaves scheduling to an external trigger.",
      values: ["internal", "external"],
      default: "external",
      tolerant: true,
      example: example.commented("internal"),
    }),
    cronSecret: text({
      env: "CRON_SECRET",
      description:
        "Shared secret for the /api/cron/* endpoints (Authorization: Bearer). Without it the cron endpoints answer 503.",
      secret: true,
      requiredInProduction: ["api"],
      example: example.generated(),
    }),
    workerId: text({
      env: "WORKER_ID",
      description:
        "Identifies a worker process in the queue (default worker-<pid>).",
      hidden: true,
    }),
    queueBatchSize: integer({
      env: "QUEUE_BATCH_SIZE",
      description: "Queue jobs a worker claims per poll.",
      min: 1,
      default: 10,
      hidden: true,
    }),
    queuePollIntervalMs: integer({
      env: "QUEUE_POLL_INTERVAL_MS",
      description: "Pause between worker polls of the queue.",
      min: 1,
      default: 2_000,
      hidden: true,
    }),
    vercel: vercelVar,
  },
  derive: (values) => ({
    /** The effective mode: the setting, else vercel on Vercel, else local. */
    mode:
      values.modeSetting ?? (values.vercel !== undefined ? "vercel" : "local"),
  }),
});
