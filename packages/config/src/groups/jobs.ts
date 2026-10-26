import { choice, defineGroup, example, integer, text, url } from "../define";

export const jobsGroup = defineGroup({
  name: "jobs",
  title: "Background jobs",
  intro: [
    "BACKGROUND_JOBS_MODE: local = the API runs PDF/integration jobs in-process",
    "(development); queue = jobs wait in the database for apps/worker (polling, or",
    "woken through DOCUMENT_WORKER_URL); inline = run inside the request (tests).",
  ],
  vars: {
    mode: choice({
      env: "BACKGROUND_JOBS_MODE",
      description: "Where background jobs run: local, queue or inline.",
      values: ["local", "queue", "inline"],
      default: "local",
      example: example.active("local"),
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
        "A GENERATING_PDF certificate older than this with no live queue row is rejected (default 60 minutes). An unusable value means the default.",
      min: 1,
      default: 3_600_000,
      tolerant: true,
      example: example.commented("3600000"),
    }),
    queueStaleAfterMs: integer({
      env: "QUEUE_STALE_AFTER_MS",
      description:
        "A claimed queue job idle for longer than this is released for another worker (default 10 minutes). An unusable value means the default.",
      min: 1,
      default: 600_000,
      tolerant: true,
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
        "`internal` runs the cron schedule inside the API process, for installs without an external scheduler (the Docker setup turns it on). Any other value leaves scheduling to an external trigger.",
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
        "Identifies a worker process in the queue (default <host>-<pid>-<random>, unique per replica). If you set it, keep it unique per replica.",
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
  },
});
