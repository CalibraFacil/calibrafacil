# Desktop push permissions and offline attachments (sync protocol 4)

Runbook moved out of [`DEPLOYMENT.md`](../../DEPLOYMENT.md#runbooks) (roadmap 2 G5).

Design and tables: `docs/architecture/sync-push-rbac-attachments.md`.

- **Per-operation permissions.** `POST /api/sync/push` no longer gates the whole request on
  `calibration:create`: each event is checked against the permission of the online route that does
  the same thing, with the pushing member's effective role. The unit role counts for the event's own
  unit (`event.unitId`, then `payload.unitId`, then the active unit), not for the active unit alone:
  the desktop sends no `x-active-unit-id` header, so a member who is a technician in one unit and a
  plain member in another is judged in the unit the event is applied to. A denied event is answered
  `SYNC_PERMISSION_DENIED`, a permanent refusal: a desktop of this version moves it to its refused
  list, where a person discards it or re-queues it after a role change. A desktop that predates the
  code (protocol 3 or earlier) does not know it and treats an unknown code as transient, so it
  retries the event with backoff (noise, not loss) until a person discards it. Nothing is applied or
  claimed for a denied event, and a retry of an event that was already applied is acknowledged even
  after a role downgrade. There is nothing to configure; a member who only holds service-order rights
  (for example the `member` role) can now push the service orders they may create online.
- **Attachment files.** A desktop of protocol 4 uploads an attachment's file before pushing its
  `create_local_attachment` event: `init-upload` returns a presigned PUT bound to the declared size and
  content type (the store must honour the signed `content-length` and `content-type` headers; the
  self-hosted S3 gateway does, and `complete-upload` re-verifies size, type and SHA-256 whatever the
  store does), `complete-upload` reads the object back and records it in the organization event log
  (`sync_attachment.upload_completed`), and the event is refused (`SYNC_ATTACHMENT_NOT_UPLOADED`) unless
  that record exists and the object is unchanged. Accepted types: JPEG, PNG, WebP, HEIC/HEIF, PDF,
  plain text; at most 25 MiB. The objects live under `org/<id>/sync-attachments/` in
  `R2_BUCKET_NAME` (the documents bucket): include that prefix in its backup and retention policy.
- **Compatibility.** The push wire format is unchanged. A desktop of protocol 3 or earlier cannot upload
  files, so its attachment events are refused for good with `SYNC_ATTACHMENT_UPLOAD_UNSUPPORTED` (before
  this change they were acknowledged without any file, which is how field evidence stayed on the
  laptop). That code is permanent only for a desktop that knows it; an older desktop treats it as an
  unknown code and retries with backoff until the app is updated, after which its attachments upload
  and are sent normally. On its first start the updated desktop also queues again every attachment an
  older build had marked synced without a remote key.
- **Rolling the cloud.** A protocol 4 desktop against a cloud that predates protocol 4 is answered
  `SYNC_PROTOCOL_UNSUPPORTED` and pushes again with protocol 3, as for protocol 3 above, **without its
  attachment events**: such a cloud acknowledges an attachment event without verifying any file
  (the audit-only behaviour this change removes), so the desktop keeps them pending instead. It
  remembers the downgrade for ten minutes, then asks with protocol 4 again, so attachments flow once the
  cloud is upgraded; the same holds for the pull and bootstrap, which keep stating protocol 3.
  Against a protocol 3 cloud the upload endpoints exist but verify nothing server-side. Upgrade the
  cloud before relying on offline attachments. `SYNC_MIN_DESKTOP_VERSION` need not be raised for this
  change.
