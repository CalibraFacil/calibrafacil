# Desktop push: per-operation permissions and the attachment upload leg (sync protocol 4)

Roadmap 2 A2 (architecture review P0-2 and P0-5). Code: `apps/api/src/modules/sync/{operation-permissions,attachment-uploads,apply-attachment}.ts`,
`apps/api/src/routes/sync/{push,attachments}.ts`, `packages/contracts/src/{sync-attachments,outbox-rejections,sync-protocol}.ts`,
`apps/local-server/src/attachment-upload.ts`, `packages/local-db/src/{attachments,outbox}.ts` and migration `0024_attachment_upload_leg`.
Operators: `DEPLOYMENT.md`, _Desktop push permissions and offline attachments_.

## 1. Per-operation permissions on the push (P0-2)

`POST /api/sync/push` used to be guarded by `withLabPermission({ calibration: ["create"] })` and then applied every
operation, so a technician or operator could offline do what the online routes deny them (a quote, a delivery document,
a non-conformance, a service order). The route now only requires authentication, membership and a LAB organization; each
event is checked, after its schema and scope checks and before anything is prepared or applied, against
`SYNC_OPERATION_PERMISSIONS`.

The check is the online one: `getEffectivePermissionRole(member, permission)` (a unit role elevates only on unit-scoped
resources) then `hasPermissionLocally(role, permission)`, the two functions `requirePermission` uses. The table is exhaustive by
type (`satisfies Record<SyncCommandOperation, ...>`): a new push operation does not compile until someone says who may send it.
`operation-permissions.spec.ts` reads the online route sources and fails when a route's `withLabPermission(...)` and the table
disagree, and pins who is allowed per role by hand.

| Operation                                            | Permission                   | Online route                                     |
| ---------------------------------------------------- | ---------------------------- | ------------------------------------------------ |
| `create_local_job_draft`                             | `calibration:create`         | `POST /api/jobs`                                 |
| `create_local_asset`                                 | `equipment:create`           | `POST /api/assets`                               |
| `update_local_asset`                                 | `equipment:update`           | `PUT /api/assets/:id`                            |
| `create_local_customer`                              | `client:create`              | `POST /api/customers`                            |
| `update_local_customer`                              | `client:update`              | `PUT /api/customers/:id`                         |
| `update_local_customer_compliance`                   | `client:update`              | `PUT /api/customers/:id/compliance`              |
| `save_local_execution`                               | `calibration:execute`        | `POST /api/jobs/:id/execute`                     |
| `submit_local_execution`                             | `calibration:submit`         | `POST /api/jobs/:id/submit`                      |
| `create_local_service_order_intake`                  | `service_order:create`       | `POST /api/service-orders`                       |
| `create_local_non_conformance`                       | `non_conformance:create`     | `POST /api/non-conformances`                     |
| `create_local_service_order_quote_draft`             | `service_order:quote_create` | `POST /api/service-orders/:id/quotes`            |
| `save_local_service_order_execution_notes`           | `service_order:execute`      | `PATCH /api/service-orders/:id/execution`        |
| `create_local_service_order_delivery_document_draft` | `service_order:deliver`      | `POST /api/service-orders/:id/delivery-document` |
| `create_local_attachment`                            | `calibration:create`         | `/api/sync/attachments/*` (same permission)      |
| `create_local_certificate_draft` (legacy marker)     | `calibration:create`         | the push's former gate                           |
| `generate_local_certificate_pdf` (legacy, refused)   | `calibration:approve`        | `POST /api/jobs/:id/approve`                     |

A denied event is rejected with `SYNC_PERMISSION_DENIED`, classified `permanent` in `OUTBOX_REJECTION_CLASSES`: the desktop
moves it to its refused list (pt-BR copy in `apps/web/src/runtime/sync-dead-events.ts`), where a person discards it or re-queues
it after the role changes. Nothing is claimed, applied, audited or provisioned for it (a denied `create_local_customer`
does not create the CLIENT organization). An older desktop does not know the code and retries with backoff (unknown codes are
transient), which is noise, not loss.

## 2. The attachment upload leg (P0-5)

Before: nothing on the desktop called `init-upload`/`complete-upload`, the cloud treated `create_local_attachment` as audit-only and
the outbox marked the attachment `synced` with `remote_key` NULL. Field evidence existed only on the laptop while the screen said it
had been sent.

```
desktop                                           cloud
  read file, check size + SHA-256 vs recorded
  POST init-upload  ───────────────────────────▶  type/size allowed? presign bound to size + type
  PUT bytes to the presigned URL (no credentials) ─▶ object store (refuses another size or type)
  POST complete-upload ────────────────────────▶  HEAD (size, type) + read back + SHA-256, then
                                                  audit row sync_attachment.upload_completed {etag, hash, size}
  attachment -> uploaded (remote_key set)
  POST push (create_local_attachment) ─────────▶  prepare: row exists, object still has that ETag
                                                  apply: audit row, acknowledges remoteEntityId = object key
  attachment -> synced
```

- **Cloud.** `init-upload` refuses types outside `SYNC_ATTACHMENT_ALLOWED_MIME_TYPES` (JPEG, PNG, WebP, HEIC/HEIF, PDF, plain
  text; never SVG or HTML) and sizes above 25 MiB (HTTP 422, codes `sync_attachment_type_not_allowed` / `sync_attachment_too_large` in the `{ error, code }` body), and
  signs `content-type` and `content-length` into the presigned PUT (`generateBoundPresignedUploadUrl`; checked against the
  self-hosted S3 gateway, whose store answers `SignatureDoesNotMatch` for another size or type). The object key is still
  `org/<lab>/sync-attachments/<entity type>/<entity id>/<hash16>-<event id><ext>`, and the existing laboratory-prefix check stays on
  `complete-upload` and `download`; `complete-upload` also requires the key to be the one those facts produce. It does not trust the
  presign: it HEADs the object, reads it back and compares size, type and SHA-256 with the declaration (another object is removed and
  answered 422 `sync_attachment_integrity_failed`; a missing one is 409 `sync_attachment_not_uploaded`) before writing the audit row
  that records it. That row (organization event log, entity `sync_attachment`, entity id the object key) is the "present and
  verified" record; it stores the ETag, so an object overwritten through the still-valid presigned URL after the check is
  detected when the event is applied. Hashing reads the object once (at most 25 MiB); no extra table or metadata write was needed.
- **The event.** `create_local_attachment` is recorded only when that row exists and the object still has its ETag and size;
  otherwise it is refused with `SYNC_ATTACHMENT_NOT_UPLOADED` (transient: the desktop uploads again) or
  `SYNC_ATTACHMENT_INTEGRITY_FAILED` (permanent). A push from protocol < 4 is refused with the permanent
  `SYNC_ATTACHMENT_UPLOAD_UNSUPPORTED` whatever the store holds: that build has no bytes to send.
- **Desktop.** `uploadAttachmentsBeforePush` runs before each push: at most 10 uploads per run, the rest waits. The endpoints' registry codes are the lower-case form of the push codes (`sync_attachment_not_uploaded` is
  `SYNC_ATTACHMENT_NOT_UPLOADED`), and the desktop sorts them with the same table. A transient failure
  (network, 5xx, 401, 404, 408, 425, 429, an expired signature) uses the outbox's backoff and starts the whole leg over; a permanent
  one (a 4xx that names a refusal code, a 4xx without one, a missing or changed file, a type or size the cloud would refuse) makes the
  attachment `dead` and its outbox event `dead` with the code, in the refused list; re-queueing it resets the attachment to `pending`.
  `attachments.upload_status` is `pending` -> `uploaded` (`remote_key` set by a completed upload) -> `synced` (event accepted), or
  `dead`; an acknowledgement never makes an attachment without a `remote_key` synced.
- **Existing installs.** Migration `0024_attachment_upload_leg` sets every attachment an older build had marked `synced` with no
  `remote_key` back to `pending` and queues a new `create_local_attachment` event for it (same author and device), so those files are
  uploaded after the update.

### Protocol and versions

`SYNC_PROTOCOL_VERSION` is 4 (`SYNC_ATTACHMENT_UPLOAD_PROTOCOL_VERSION`). The push wire format, the `SyncCommand` contracts, the cursor,
the ledger, conflict semantics and apply order are unchanged. The desktop keeps stating protocol 3 on the pull and the bootstrap
(`SYNC_CHANGE_SEQ_PROTOCOL_VERSION`), which did not change. A protocol 4 desktop against an older cloud is told
`SYNC_PROTOCOL_UNSUPPORTED` and pushes again with protocol 3 (existing mechanism). `SYNC_MIN_DESKTOP_VERSION` does not have to be raised.

### Not done

- **Download leg.** Nothing in the web app or the desktop UI lists or shows attachments captured on another device (the cloud
  `attachments` client method only throws, and the web has no attachment screen), so a pull of attachments is not built. The
  `GET /api/sync/attachments/:id/download` endpoint exists and is laboratory-scoped.
- **The attachment is not linked to the remote entity.** The audit row carries the local target ids (`entityType`/`entityId` of the
  payload), as the object key does; resolving them to cloud ids belongs with the download leg.
- **Cloudflare R2** was not exercised: the bound presign is verified against the self-hosted S3 gateway; `complete-upload` verifies size,
  type and SHA-256 whatever the store enforces, so a store that ignores the signed headers is still safe, only less strict at PUT time.
