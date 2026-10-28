# Certificates stuck in generation

Runbook moved out of [`DEPLOYMENT.md`](../../DEPLOYMENT.md#runbooks) (roadmap 2 G5).

A certificate is `GENERATING_PDF` from approval until the worker issues it. The worker rejects it
itself when a render fails for good, but it cannot when the process dies mid-render (out of
memory, a crash) or when its queue row is gone after the retries. The `queue-backstop`
job covers both, so such a certificate ends up `REJECTED` (reason `Erro ao gerar certificado: ...`,
plus a `job_audit_log` entry) and can be sent for approval again, instead of staying
`GENERATING_PDF` forever:

- A queue row whose lease expired (`QUEUE_STALE_AFTER_MS`, default 10 minutes) on its final
  attempt (`attempts >= max_attempts`) is dead-lettered to `FAILED` instead of being re-queued, so a
  job that crashes the worker is not retried forever. Rows with attempts left are re-queued as
  before. The certificate that row was rendering is rejected.
- A certificate that has been `GENERATING_PDF` for longer than `STUCK_RENDER_AFTER_MS` (default
  `3600000`, 60 minutes, counted from its last update) and has no `PENDING` or `PROCESSING` queue
  row is rejected the same way. Keep it well above the longest render plus the retry
  window, so a certificate that is still being retried is not rejected.

Only a job still in `GENERATING_PDF` is rejected. An `APPROVED` or `SUPERSEDED` certificate, its
issued snapshot and its number are never touched. Every automatic rejection is recorded in
`job_audit_log` with `changes.source = "queue-backstop"` and `changes.reason` set to
`dead-lettered` or `stuck-render`. `rejected_by` and the audit `performed_by` name the user who
released the certificate (there is no system user), so that marker is how an automatic rejection
is told apart from the approver's own action.

The backstop runs on the `queue-backstop` cron, every 30 minutes, so
recovery is not immediate: a crashed job is dead-lettered after its lease expires (default 10
minutes) plus up to 30 minutes until the next run, and a certificate with no queue row is rejected at
`STUCK_RENDER_AFTER_MS` plus up to 30 minutes. The drain on the always-on worker also
dead-letters expired leases each time it wakes, so it can be faster there.
