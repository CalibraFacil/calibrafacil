import { defineStatusVocabulary } from "@calibra-facil/shared/status-vocabulary";

// The desktop store's statuses (the lab app shows them) with the pt-BR label and tone each
// surface reads. The lifecycles (which command moves a row where) are the machines in
// @calibra-facil/local-db/src/state-machines.ts, which imports these lists.

// outbox.status: one local change on its way to the cloud.
export const OUTBOX_STATUSES = [
  "pending",
  "failed",
  "synced",
  "dead",
  "conflict",
  "discarded",
] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

export const OUTBOX_STATUS = defineStatusVocabulary(OUTBOX_STATUSES, {
  pending: { label: "Pendente", tone: "warning" },
  failed: { label: "Falha ao enviar", tone: "critical" },
  synced: { label: "Sincronizada", tone: "ok" },
  dead: { label: "Recusada pela nuvem", tone: "critical" },
  conflict: { label: "Conflito", tone: "critical" },
  discarded: { label: "Descartada", tone: "neutral" },
});

/**
 * The `sync_state` of a local record (customer, asset, job, service order): the status of its
 * latest outbox event, `local` for a record created offline whose event is not queued yet, and
 * `deleted` for a record the cloud removed.
 */
export const LOCAL_RECORD_SYNC_STATES = [
  "local",
  ...OUTBOX_STATUSES,
  "deleted",
] as const;
export type LocalRecordSyncState = (typeof LOCAL_RECORD_SYNC_STATES)[number];

export const LOCAL_RECORD_SYNC_STATE = defineStatusVocabulary(
  LOCAL_RECORD_SYNC_STATES,
  {
    local: { label: "Pendente", tone: "warning" },
    ...OUTBOX_STATUS.presentation,
    deleted: { label: "Excluído", tone: "neutral" },
  },
);

// sync_conflicts.status: a change the cloud refused as stale.
export const SYNC_CONFLICT_STATUSES = [
  "open",
  "resolved",
  "discarded_by_user",
] as const;
export type SyncConflictStatus = (typeof SYNC_CONFLICT_STATUSES)[number];

/**
 * Every status a stored conflict can hold: the machine's three, plus `ignored`, which older
 * builds wrote for what is now a discard (history only: no code writes it now).
 */
export const RECORDED_SYNC_CONFLICT_STATUSES = [
  ...SYNC_CONFLICT_STATUSES,
  "ignored",
] as const;
export type RecordedSyncConflictStatus =
  (typeof RECORDED_SYNC_CONFLICT_STATUSES)[number];

export const SYNC_CONFLICT_STATUS = defineStatusVocabulary(
  RECORDED_SYNC_CONFLICT_STATUSES,
  {
    open: { label: "Aberto", tone: "critical" },
    resolved: { label: "Mantida a alteração local", tone: "ok" },
    discarded_by_user: { label: "Descartado pelo usuário", tone: "neutral" },
    ignored: { label: "Ignorado (versão anterior)", tone: "neutral" },
  },
);

// attachments.upload_status: the bytes of a file captured offline.
export const ATTACHMENT_UPLOAD_STATUSES = [
  "pending",
  "uploaded",
  "synced",
  "dead",
] as const;
export type AttachmentUploadStatus =
  (typeof ATTACHMENT_UPLOAD_STATUSES)[number];
