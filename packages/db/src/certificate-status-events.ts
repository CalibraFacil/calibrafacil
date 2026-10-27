import { issuedCertificateStatusEvent } from "./schema.js";

// appendCertificateStatusEvent: the ONE writer of issued_certificate_status_event
// (ISO/IEC 17025 §7.8.8 amendments, §7.10 nonconforming work; roadmap 2 B3).
//
// Like appendJobEvent, the caller passes the handle of the transaction that
// makes the change the row records, so the event commits or rolls back with it:
// the original's SUPERSEDED row is written in the transaction that issues the
// replacement, the WITHDRAWN row in the transaction of the withdraw command. It
// lives in packages/db because apps/api (Drizzle over postgres.js) and
// packages/jobs-core (Drizzle over the worker's pg client) both write it.
//
// The table is append-only (trigger + no UPDATE/DELETE grant for the application
// role, migration 0132): there is no function here that changes or removes a row.

export type CertificateStatusEventInput = {
  organizationId: string;
  certificateId: number;
  jobId: number;
  source: "api" | "worker";
  /** The user the event is recorded against; null only for a process with none. */
  actorUserId: string | null;
  /** Defaults to the database clock; the worker records its own instant. */
  occurredAt?: Date;
} & (
  | { event: "ISSUED" }
  | {
      event: "SUPERSEDED";
      /** The job whose issuance replaced this certificate. */
      supersededByJobId: number;
      reason?: string | null;
    }
  | { event: "WITHDRAWN" | "REINSTATED"; reason: string }
);

/** The slice of a Drizzle database or transaction the writer needs. */
export type CertificateStatusEventTransaction = {
  insert(table: typeof issuedCertificateStatusEvent): {
    values(
      row: typeof issuedCertificateStatusEvent.$inferInsert,
    ): PromiseLike<unknown>;
  };
};

/** Appends one row to issued_certificate_status_event on `tx`. */
export async function appendCertificateStatusEvent(
  tx: CertificateStatusEventTransaction,
  input: CertificateStatusEventInput,
): Promise<void> {
  if (input.organizationId.length === 0) {
    throw new Error(
      `Certificate ${input.certificateId}: a status event needs its organizationId (the rows are tenant rows)`,
    );
  }
  const reason = "reason" in input ? (input.reason?.trim() ?? null) : null;
  if (
    (input.event === "WITHDRAWN" || input.event === "REINSTATED") &&
    !reason
  ) {
    throw new Error(
      `Certificate ${input.certificateId}: a ${input.event} event needs a written reason`,
    );
  }
  await tx.insert(issuedCertificateStatusEvent).values({
    organizationId: input.organizationId,
    certificateId: input.certificateId,
    jobId: input.jobId,
    event: input.event,
    supersededByJobId:
      input.event === "SUPERSEDED" ? input.supersededByJobId : null,
    reason,
    actorUserId: input.actorUserId,
    source: input.source,
    ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
  });
}
