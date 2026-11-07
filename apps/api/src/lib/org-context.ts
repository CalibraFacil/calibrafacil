import {
  afterTransactionCommit,
  db,
  isInTransactionScope,
} from "@calibra-facil/db";
import {
  forOrg,
  setTransactionOrganization,
  type OrgDb,
} from "@calibra-facil/db/for-org";
import {
  accreditedScopeLineAuditLog,
  assetAuditLog,
  authorizedSignatoryAuditLog,
  calibrationRequestAuditLog,
  controlChartAuditLog,
  correctiveActionAuditLog,
  customerAuditLog,
  methodAuditLog,
  nonConformanceAuditLog,
  personnelCompetenceAuditLog,
  proficiencyTestAuditLog,
  referenceStandardAuditLog,
  serviceAuditLog,
  trainingRecordAuditLog,
  visitAuditLog,
} from "@calibra-facil/db/schema";
import type { BackgroundJobMessage } from "@calibra-facil/schemas";
import {
  dispatchStagedBackgroundJob,
  stageBackgroundJob,
} from "./background-job-outbox";
import { enqueueBackgroundJob } from "./background-jobs";
import type { OrgRawTransaction } from "./org-transaction";

/** Who is changing the laboratory's records, for the audit trail. */
export type OrgActor = {
  /** The user the change is recorded against (`performed_by`). */
  userId: string;
  ipAddress: string | null;
  userAgent?: string | null;
};

export type AuditEntry = {
  action: string;
  changes?: unknown;
  /** Why (ISO/IEC 17025 asks for it on status changes and deletions). */
  reason?: string | null;
};

type AfterCommitTask = () => unknown;

/**
 * One write in a laboratory: the org-bound handle, the raw transaction for the
 * statements the handle cannot express (advisory locks, queue staging), and the
 * effects that belong to it.
 */
export type OrgContext = {
  readonly org: string;
  readonly actor: OrgActor;
  readonly o: OrgDb;
  readonly tx: OrgRawTransaction;
  /** Appends the entity's audit row in this transaction. */
  audit(
    entity: AuditedEntity,
    entityId: number,
    entry: AuditEntry,
  ): Promise<void>;
  /**
   * A background job this change owes: its queue row commits with the change
   * (an in-process dispatch mode runs it after the commit instead).
   */
  emit(message: BackgroundJobMessage): Promise<void>;
  /**
   * Work that reads the committed rows (a notification). Runs after the commit;
   * a failure is logged, never thrown at the caller.
   */
  afterCommit(task: AfterCommitTask): void;
};

type AuditWriter = (
  ctx: Pick<OrgContext, "o" | "org" | "actor">,
  entityId: number,
  entry: AuditEntry,
) => Promise<unknown>;

function common(ctx: Pick<OrgContext, "org" | "actor">, entry: AuditEntry) {
  return {
    organizationId: ctx.org,
    action: entry.action,
    changes: entry.changes ?? null,
    performedBy: ctx.actor.userId,
    ipAddress: ctx.actor.ipAddress,
  };
}

// One writer per audited entity: the tables share a shape but name the entity
// column differently, and three of them have no `reason`.
const AUDIT_WRITERS = {
  customer: (ctx, id, entry) =>
    ctx.o.insert(customerAuditLog).values({
      ...common(ctx, entry),
      customerId: id,
      reason: entry.reason ?? null,
    }),
  asset: (ctx, id, entry) =>
    ctx.o.insert(assetAuditLog).values({
      ...common(ctx, entry),
      assetId: id,
      reason: entry.reason ?? null,
    }),
  method: (ctx, id, entry) =>
    ctx.o.insert(methodAuditLog).values({
      ...common(ctx, entry),
      methodId: id,
      reason: entry.reason ?? null,
    }),
  service: (ctx, id, entry) =>
    ctx.o.insert(serviceAuditLog).values({
      ...common(ctx, entry),
      serviceId: id,
      reason: entry.reason ?? null,
    }),
  referenceStandard: (ctx, id, entry) =>
    ctx.o.insert(referenceStandardAuditLog).values({
      ...common(ctx, entry),
      standardId: id,
      reason: entry.reason ?? null,
    }),
  calibrationRequest: (ctx, id, entry) =>
    ctx.o.insert(calibrationRequestAuditLog).values({
      ...common(ctx, entry),
      requestId: id,
      reason: entry.reason ?? null,
    }),
  correctiveAction: (ctx, id, entry) =>
    ctx.o.insert(correctiveActionAuditLog).values({
      ...common(ctx, entry),
      capaId: id,
      reason: entry.reason ?? null,
    }),
  nonConformance: (ctx, id, entry) =>
    ctx.o.insert(nonConformanceAuditLog).values({
      ...common(ctx, entry),
      ncId: id,
      reason: entry.reason ?? null,
    }),
  proficiencyTest: (ctx, id, entry) =>
    ctx.o.insert(proficiencyTestAuditLog).values({
      ...common(ctx, entry),
      proficiencyTestId: id,
      reason: entry.reason ?? null,
    }),
  controlChart: (ctx, id, entry) =>
    ctx.o.insert(controlChartAuditLog).values({
      ...common(ctx, entry),
      controlChartId: id,
      reason: entry.reason ?? null,
    }),
  competence: (ctx, id, entry) =>
    ctx.o.insert(personnelCompetenceAuditLog).values({
      ...common(ctx, entry),
      competenceId: id,
      reason: entry.reason ?? null,
    }),
  trainingRecord: (ctx, id, entry) =>
    ctx.o.insert(trainingRecordAuditLog).values({
      ...common(ctx, entry),
      trainingRecordId: id,
      reason: entry.reason ?? null,
    }),
  authorizedSignatory: (ctx, id, entry) =>
    ctx.o.insert(authorizedSignatoryAuditLog).values({
      ...common(ctx, entry),
      signatoryId: id,
      reason: entry.reason ?? null,
    }),
  visit: (ctx, id, entry) =>
    ctx.o.insert(visitAuditLog).values({
      ...common(ctx, entry),
      visitId: id,
      userAgent: ctx.actor.userAgent ?? null,
      reason: entry.reason ?? null,
    }),
  accreditedScopeLine: (ctx, id, entry) =>
    ctx.o
      .insert(accreditedScopeLineAuditLog)
      .values({ ...common(ctx, entry), scopeLineId: id }),
} satisfies Record<string, AuditWriter>;

export type AuditedEntity = keyof typeof AUDIT_WRITERS;

/**
 * The one way to write in a laboratory. Opens the transaction that names the
 * laboratory for row-level security (a savepoint when the desktop sync already
 * opened one), hands `run` the context, and once the transaction has committed
 * runs the deferred work. A thrown error (a `DomainError` included) rolls back
 * every write, its audit rows and its queued jobs.
 */
export async function withOrg<R>(
  org: string,
  actor: OrgActor,
  run: (ctx: OrgContext) => Promise<R>,
): Promise<R> {
  const deferred: AfterCommitTask[] = [];
  let staged = false;

  const result = await db.transaction(async (tx) => {
    await setTransactionOrganization(tx, org);
    const o = forOrg(tx, org);
    const ctx: OrgContext = {
      org,
      actor,
      o,
      tx,
      audit: async (entity, entityId, entry) => {
        await AUDIT_WRITERS[entity]({ o, org, actor }, entityId, entry);
      },
      emit: async (message) => {
        if (await stageBackgroundJob(tx, message)) {
          staged = true;
          return;
        }
        deferred.push(() => enqueueBackgroundJob(message));
      },
      afterCommit: (task) => {
        deferred.push(task);
      },
    };
    return run(ctx);
  });

  if (staged) deferred.unshift(dispatchStagedBackgroundJob);
  for (const task of deferred) {
    // Inside the desktop sync's transaction this was a savepoint: the work
    // waits for that transaction's commit.
    if (isInTransactionScope()) afterTransactionCommit(() => runLogged(task));
    else await runLogged(task);
  }
  return result;
}

async function runLogged(task: AfterCommitTask): Promise<void> {
  try {
    await task();
  } catch (error) {
    console.error("[withOrg] after-commit task failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
