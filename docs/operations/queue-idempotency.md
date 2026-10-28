# Queue idempotency and lease fencing

Runbook moved out of [`DEPLOYMENT.md`](../../DEPLOYMENT.md#runbooks) (roadmap 2 G5).

Queue delivery is at-least-once: a `PROCESSING` row whose lease expired (`QUEUE_STALE_AFTER_MS`) is
handed to another worker. Two guards keep a duplicate or a slow worker from doing harm:

- **Lease fencing.** A worker may complete or fail a queue row only while it still holds the lease
  (`locked_by` is its `WORKER_ID` and the row is `PROCESSING`). A worker whose lease expired and
  whose row was reclaimed can no longer overwrite the new owner's state: its late completion or
  failure is ignored and logged as `[Queue] fenced out ...`, never retried. Nothing to configure.
- **Idempotency receipts** (`QUEUE_RECEIPTS_MODE`). Each delivery unit claims a receipt before it runs.
  - `enforce` (default, also for an unset or unrecognised value): a duplicate of a unit that already
    completed is skipped, and a unit whose lease another worker holds is retried later instead of
    running twice.
  - `shadow`: duplicates are only logged (`[QueueReceipt] duplicate delivery`) and still run. Use it
    to observe duplicates without trusting the ledger.
  - `off`: no receipts at all.

Existing deployments that did not set `QUEUE_RECEIPTS_MODE` ran in `shadow` and now enforce. Set
`QUEUE_RECEIPTS_MODE=shadow` to keep the old behaviour. If the ledger table is unreachable the unit
runs anyway (fail open), so enforcement never blocks a job on bookkeeping.
