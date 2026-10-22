# Frozen certificate input

ISO/IEC 17025 §7.8 asks the report to reflect the approved record. Before
migration 0120 the worker read the lab, signatory, customer, asset and standards
live when it rendered the certificate, so an edit between the approval and the
render (or on a later re-render: retries, dead-letter recovery) changed what the
certificate said.

## What is frozen

The approval command (`apps/api/src/modules/jobs/approve-job.ts`) builds one
document, in the **same transaction** as the status change and its
`job_audit_log` row, and stores it in `certificate_input` (1:1 with the job,
`organization_id` + the composite `(job_id, organization_id)` tenant key of
migration 0118). The document type is `CertificateInput`
(`packages/certificate-data/src/certificate-input.ts`):

- `schemaVersion`, `layout` (`key`, `version`), `engineVersion`, `verificationUrl`
- `seal`: the accreditation-seal decision **as of `approved_at`** (`accredited`,
  `evaluatedAt`), never re-evaluated at render time
- `job`: lab identity and accreditation, the technical manager's title, the
  approver's name and drawn signature, customer, asset, method snapshot (name,
  version, procedure, reference standards, formulas), standards snapshot,
  environmental and location snapshots, execution data and results, method
  deviations, the amendment link, and the service-order receipt data

The logo and the signature are embedded as `data:` URIs: the logo object is
deleted when the lab uploads another one. They are read from object storage
BEFORE the approval opens its transaction (no network I/O while the job row is
locked), each read under a 10 s timeout. A storage failure or timeout aborts the
approval (retryable), and so does a missing storage configuration in production
when an image key exists; only a key that no object backs is frozen as absent
(and, in development and test, an unconfigured storage). If the lab or the
approver changed the image between the read and the lock, the transaction
refuses it and the approval answers `concurrent_approval` (409): retry.

`certificate_input.sha256` is the SHA-256 of the canonical JSON of the document
(keys sorted, since `jsonb` does not keep their order). The approve audit event
records it as `changes.certificateInputSha256`.

## One assembly, two loaders

`assembleCertificateJobData` (pure) turns the already-read rows into the
`CertificateJobData` the layout consumes. Its callers read the rows:

- `@calibra-facil/db/certificate-input` (drizzle, on the approval transaction,
  every read scoped by the job's organization) — the **frozen** path;
- `apps/worker/src/certificate/fetch-job-data.ts` (SQL) — the **legacy** path,
  for jobs approved before migration 0120.

`apps/worker/src/certificate-input.int.spec.ts` asserts both produce the same
document and the same render data on a seeded job.

## The worker

`processJob` renders from the frozen input when there is one and logs
`Rendering from the frozen certificate input (sha256 …)`, for the first issuance
and for the SUPERSEDED watermark re-render alike. The legacy live read is used
only when the job's latest `approve` audit event records no
`certificateInputSha256` (an approval made before migration 0120): it logs
`LEGACY render path`, and the issued snapshot's
`render_metadata.certificateInput.source` says `legacy_live` (`frozen`
otherwise, with the input's `sha256`). An approval that DID record a hash whose
`certificate_input` row is missing fails permanently
(`certificate_input missing for a post-0120 approval`), like a stored document
whose hash no longer matches its content or the hash the approval recorded: it
is never replaced by a live read.

`render_metadata.certificateInput.layoutDataSha256` is the hash of exactly what
the template was handed. The same frozen input and layout version give the same
hash on any later render (the PDF bytes may differ: they embed timestamps and
the signature).

## Immutability

`calibra_certificate_input_guard` (trigger `certificate_input_immutable_guard`,
migration 0120 and `sql/schema-extras.sql`): UPDATE is always refused; DELETE is
allowed only while the job is back in `REVIEW` (an approval whose dispatch
failed is reverted, or a rejected job is approved again — the approval command
removes the stale row before the status moves). The seed escape hatch
`calibra.allow_audit_rewrite` lifts it for one transaction, which is also how
the records purge job erases an organization.

An amendment is a new job: it is approved on its own and freezes its own input.
