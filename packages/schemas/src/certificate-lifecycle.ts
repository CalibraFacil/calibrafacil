import { z } from "zod";

// The lifecycle of an ISSUED certificate (ISO/IEC 17025 §7.8.8 amendments, §7.10
// nonconforming work), derived from its append-only status events
// (`issued_certificate_status_event`, migration 0132). Pure: every runtime
// (API, worker, verification page, portal) asks this one function.
//
//   ISSUED ──amendment issued──▶ SUPERSEDED
//   ISSUED | SUPERSEDED ──withdraw──▶ WITHDRAWN ──reinstate──▶ (back to the
//                                     state the job's own supersession says)
//
// The job's own status (APPROVED / SUPERSEDED) is a different axis: it drives the
// workflow and is frozen by the database. A withdrawal never changes it, the
// events carry it.

export const CERTIFICATE_STATUS_EVENT_TYPES = [
  "ISSUED",
  "SUPERSEDED",
  "WITHDRAWN",
  "REINSTATED",
] as const;
export type CertificateStatusEventType =
  (typeof CERTIFICATE_STATUS_EVENT_TYPES)[number];

export const CERTIFICATE_LIFECYCLE_STATUSES = [
  "ISSUED",
  "SUPERSEDED",
  "WITHDRAWN",
] as const;
export type CertificateLifecycleStatus =
  (typeof CERTIFICATE_LIFECYCLE_STATUSES)[number];

/** The fields of a stored status event the derivation reads. */
export type CertificateStatusEventLike = {
  id: number;
  event: CertificateStatusEventType;
  reason: string | null;
  occurredAt: Date | string;
};

export type CertificateLifecycle = {
  status: CertificateLifecycleStatus;
  /** The event the state comes from; null for a certificate with no events yet. */
  latest: CertificateStatusEventLike | null;
};

/**
 * The current state of a certificate: its LATEST event (highest id; the stream is
 * append-only and ids only grow).
 *
 * `supersededByJobId` is the job's own `superseded_by_id`. It decides the state of
 * a certificate with no events at all (nothing writes it before the issuance, and
 * the 0132 backfill covers the old ones) and what a REINSTATED event returns to.
 */
export function deriveCertificateLifecycle(
  events: readonly CertificateStatusEventLike[],
  supersededByJobId: number | null,
): CertificateLifecycle {
  let latest: CertificateStatusEventLike | null = null;
  for (const event of events) {
    if (latest === null || event.id > latest.id) latest = event;
  }
  const settled: CertificateLifecycleStatus =
    supersededByJobId === null ? "ISSUED" : "SUPERSEDED";
  if (latest === null) return { status: settled, latest };
  switch (latest.event) {
    case "ISSUED":
      return { status: "ISSUED", latest };
    case "SUPERSEDED":
      return { status: "SUPERSEDED", latest };
    case "WITHDRAWN":
      return { status: "WITHDRAWN", latest };
    case "REINSTATED":
      return { status: settled, latest };
  }
}

/** POST /jobs/:id/certificate/withdraw: the written reason is mandatory. */
export const WithdrawCertificateSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(10, "Motivo da retirada deve ter pelo menos 10 caracteres")
    .max(2000, "Motivo da retirada deve ter no máximo 2000 caracteres"),
});
export type WithdrawCertificateInput = z.infer<
  typeof WithdrawCertificateSchema
>;
