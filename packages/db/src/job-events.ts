import { jobAuditLog } from "./schema.js";

// appendJobEvent: the ONE writer of job_audit_log (ISO/IEC 17025 §7.5 records of
// the calibration, §8.4 control of records).
//
// Every state change of a calibration job leaves a row here, in the SAME
// transaction as the change: the caller passes its transaction handle, so the
// audit row commits or rolls back with it (an audit failure rolls the state
// change back instead of leaving it unaudited). The calibra oxlint rule
// `no-job-audit-insert-outside-owner` forbids `insert(jobAuditLog)` and
// `INSERT INTO job_audit_log` anywhere else.
//
// It lives in packages/db because both apps/api (Drizzle over postgres.js) and
// apps/worker (Drizzle over its pg client) already depend on this package, and
// neither may depend on the other.
//
// The union below is keyed by `action`. The action strings and the `changes`
// shapes are exactly what production rows already hold: the audit timeline,
// the exports and the auditors' queries read them by shape. Do not rename a
// key or an action here without a migration of the stored rows.

/** `{ old, new }`: a field before and after the event. */
export type Change<T = unknown> = { old: T; new: T };

/**
 * HOW the actor reached the API, merged into the `changes` of a job command:
 * nothing for a signed-in user, the sync source for a desktop, the channel and
 * key identity for an API key (`jobActorAuditFields` in apps/api).
 */
export type JobActorAuditFields = {
  source?: "desktop_sync" | "public_api";
  /**
   * Desktop sync only: the pushing device's clock minus the server's, in ms
   * (roadmap 2 E2), recorded when it exceeds the tolerance. The instants the
   * device reported (performedAt, the backdate base) came from that clock.
   */
  deviceClockSkewMs?: number;
  channel?: "api_key";
  apiKeyId?: string;
  apiKeyName?: string;
  apiKeyPrefix?: string;
};

/**
 * WHO the row is recorded against.
 *
 * `job_audit_log.performed_by` is a NOT NULL foreign key to the user table and
 * there is no system user, so an automatic event is recorded against the user
 * it ran on behalf of (the approver whose release the worker is finishing) and
 * says so: `kind: "system"` names the automatic source, and the stored row is
 * the same one the worker wrote before this function existed.
 */
export type JobEventActor =
  | { kind: "user"; userId: string }
  | {
      kind: "system";
      source: "worker" | "queue-backstop";
      /** The user whose action the system is carrying out. */
      onBehalfOf: string;
    };

/** Why the queue backstop rejected a certificate render. */
export type RenderRejectionTrigger = "dead-lettered" | "stuck-render";

type JobEventBase = {
  organizationId: string;
  jobId: number;
  actor: JobEventActor;
  ipAddress?: string | null;
  reason?: string | null;
  /** Defaults to the database clock; the worker records its own instant. */
  performedAt?: Date;
};

export type JobCreatedChanges = {
  initial: {
    assetId: number;
    serviceId: number;
    technicianId?: string | null;
    dueDate?: string;
    methodSnapshot: {
      methodId: number;
      methodName: string;
      methodVersion: number;
    };
    sourceRequestId?: number;
    sourceRequestItemId?: number;
    sourceServiceOrderId: number | null;
  };
};

export type JobUpdatedChanges = JobActorAuditFields & {
  technicianId?: Change;
  dueDate?: Change;
};

/** What a submit or an execute recorded: the before/after of what it touched. */
export type JobExecutionChanges = JobActorAuditFields & {
  methodSnapshotEngine?: Change<{
    engineVersion?: string | null;
    methodFingerprint?: string | null;
  }>;
  status?: Change<string>;
  data: Change;
  results: Change;
  /** What a desktop claimed its results were; they were not used. */
  desktopSubmittedResults?: Record<string, unknown>;
  /** What an online client claimed its results were; they were not used. */
  clientSubmittedResults?: Record<string, unknown>;
  methodDeviations?: Change;
  officialExecution: {
    methodFingerprint: string;
    inputFingerprint: string;
    calculationFingerprint: string;
    resultFingerprint: string;
  };
  standardsSnapshot?: Change;
  environmentalSnapshot?: Change;
  calibrationLocationSnapshot?: Change;
  calibrationPhaseSnapshot?: Change;
  unitConversions?: unknown;
  assetSnapshot?: Change;
  standardsJudgedAt?: {
    performedAt: string;
    standardIds: number[];
    validOnlyBecauseBackdated: string[];
  };
};

/**
 * What a submit recorded: the execution changes, and whether the calibration
 * location and phase reasons were validated. "legacy_exempt" is a desktop event
 * from a build that predates the rule, so an auditor can list jobs whose
 * location was never validated.
 */
export type JobSubmitChanges = JobExecutionChanges & {
  calibrationRecordCheck: "enforced" | "legacy_exempt";
};

/**
 * What a draft save (`execute`) recorded when it accepted standards of the
 * saved snapshot that have since gone stale: one entry per reason, the same
 * shape the API answers. A submit never accepts one, so it never records this.
 */
export type JobExecuteChanges = JobExecutionChanges & {
  standardsWarnings?: Array<{
    code: "standard_no_longer_valid";
    reason: "standard_deleted" | "standard_inactive" | "standard_expired";
    standardIds: number[];
    standardNames: string[];
  }>;
};

export type JobApprovedChanges = {
  status: Change<string>;
  /** An API-key approval records the credential next to the person it acted for. */
  approvedVia?: {
    channel: "api_key";
    apiKeyId: string;
    apiKeyName: string;
    apiKeyPrefix: string;
  };
  scopeComplianceStatus?: Change;
  scopeOverrideJustification?: Change;
  /**
   * SHA-256 (hex) of the frozen certificate input written in the same
   * transaction (`certificate_input.sha256`): what the certificate will be
   * rendered from. Absent on approvals recorded before migration 0120, whose
   * certificates render through the legacy live path.
   */
  certificateInputSha256?: string;
};

/** Whether the issued PDF was signed, and by whom (never the key material). */
export type SignatureAudit =
  | { signed: true; signerName: string }
  | {
      signed: false;
      /** Q51: the unit issues unsigned on purpose; the reason it recorded. */
      unsignedByPolicy?: string;
    };

export type JobEvent =
  | (JobEventBase & { action: "create"; changes: JobCreatedChanges })
  | (JobEventBase & { action: "update"; changes: JobUpdatedChanges })
  | (JobEventBase & { action: "submit"; changes: JobSubmitChanges })
  | (JobEventBase & { action: "execute"; changes: JobExecuteChanges })
  | (JobEventBase & { action: "approve"; changes: JobApprovedChanges })
  | (JobEventBase & {
      action: "approve_reverted";
      changes: { status: Change<string> };
    })
  | (JobEventBase & {
      action: "reject";
      changes: JobActorAuditFields & { status: Change<string> };
    })
  | (JobEventBase & {
      action: "cancel";
      changes: JobActorAuditFields & { status: Change<string> };
    })
  | (JobEventBase & {
      action: "assign";
      changes: JobActorAuditFields & {
        technicianId: Change<string | null>;
        technicianName: Change<string | null>;
      };
    })
  | (JobEventBase & {
      action: "supersede";
      changes: JobActorAuditFields & {
        status: Change<string>;
        supersededById: number;
      };
    })
  | (JobEventBase & {
      action: "create_amendment";
      changes: JobActorAuditFields & {
        supersedesId: number;
        amendmentNumber: number;
        reason: string;
      };
    })
  // On the ORIGINAL, when an amendment is opened: the original stays APPROVED
  // (still the valid certificate) until the replacement is issued; the
  // `supersede` event then records the status change.
  | (JobEventBase & {
      action: "amendment_started";
      changes: JobActorAuditFields & {
        amendedJobId: number;
        amendmentNumber: number;
        reason: string;
      };
    })
  // On the ORIGINAL, when its amendment is cancelled before it was issued: the
  // original stays the valid certificate and may be amended again.
  | (JobEventBase & {
      action: "amendment_canceled";
      changes: JobActorAuditFields & {
        amendedJobId: number;
        amendmentStatus: Change<string>;
      };
    })
  // On the job whose issued certificate was withdrawn (ISO/IEC 17025 §7.10).
  // The job keeps its status; the certificate lifecycle moves to WITHDRAWN.
  | (JobEventBase & {
      action: "certificate_withdrawn";
      changes: JobActorAuditFields & {
        certificateStatus: Change<string>;
        reason: string;
      };
    })
  | (JobEventBase & {
      action: "certificate_generated";
      changes: {
        status: Change<string | null>;
        certificateUrl: Change<string | null>;
        signatureMetadata: SignatureAudit;
      };
    })
  | (JobEventBase & {
      action: "certificate_watermarked";
      changes: {
        // A text, not a before/after pair: this is what the worker stores today.
        status: "SUPERSEDED (watermark added)";
        certificateUrl: Change<string | null>;
        signatureMetadata: SignatureAudit;
      };
    })
  | (JobEventBase & {
      action: "certificate_error";
      changes: {
        status: Change<string>;
        // The queue backstop also says why and which queue row; the worker's
        // own rejection stores the status move alone.
        source?: string;
        reason?: RenderRejectionTrigger;
        queueJobId?: number;
      };
    })
  // A manager re-dispatched the render of a failed certificate (RENDER_FAILED ->
  // GENERATING_PDF, roadmap 2 C5); the approval and its frozen input stand.
  | (JobEventBase & {
      action: "render_retried";
      changes: JobActorAuditFields & {
        status: Change<string>;
        previousError: string | null;
      };
    })
  | (JobEventBase & {
      action: "label_generated";
      changes: { labelUrl: Change<string | null> };
    });

/**
 * The slice of a Drizzle database or transaction appendJobEvent needs. Both the
 * postgres.js transactions of apps/api and the node-postgres handle of the
 * worker satisfy it; it is what makes the caller's transaction explicit.
 */
export type JobEventTransaction = {
  insert(table: typeof jobAuditLog): {
    values(row: typeof jobAuditLog.$inferInsert): PromiseLike<unknown>;
  };
};

function performedByOf(actor: JobEventActor): string {
  return actor.kind === "user" ? actor.userId : actor.onBehalfOf;
}

/**
 * Appends one row to job_audit_log on `tx`. Call it inside the transaction of
 * the state change it records, after the compare-and-set matched.
 */
export async function appendJobEvent(
  tx: JobEventTransaction,
  event: JobEvent,
): Promise<void> {
  if (event.organizationId.length === 0) {
    throw new Error(
      `Job ${event.jobId}: a job event needs its organizationId (job_audit_log rows are tenant rows)`,
    );
  }
  const performedBy = performedByOf(event.actor);
  if (performedBy.length === 0) {
    throw new Error(
      `Job ${event.jobId}: a job event needs the actor it is recorded against`,
    );
  }

  await tx.insert(jobAuditLog).values({
    organizationId: event.organizationId,
    jobId: event.jobId,
    action: event.action,
    changes: event.changes,
    performedBy,
    ...(event.performedAt ? { performedAt: event.performedAt } : {}),
    // Passed through as given: an omitted value is NULL in the table either way.
    ipAddress: event.ipAddress,
    reason: event.reason,
  });
}
