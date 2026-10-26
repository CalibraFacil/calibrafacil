import { and, eq } from "drizzle-orm";
import type { OrgExecutor } from "@calibra-facil/db/for-org";
import {
  correctiveActionAuditLog,
  member,
  user,
} from "@calibra-facil/db/schema";
import {
  hasPermissionLocally,
  roleNameFromUnknown,
} from "../middleware/permission";

/**
 * Who may verify the effectiveness of a CAPA (ISO/IEC 17025 §8.7; decision Q50).
 *
 * A verifier is NOT independent when they are the CAPA's current owner
 * (`responsibleId`), were ever its responsible person (the audit history of
 * `responsibleId` changes, so reassigning the CAPA does not launder the rule), or
 * recorded its implementation (an "implement" audit entry).
 *
 * The outcome for a verifier:
 *   - `independent`: nobody tied to the CAPA is verifying it;
 *   - `blocked`: not independent, and another eligible verifier exists (a member
 *     whose role can `capa:verify`, not banned, not themselves tied to the CAPA);
 *   - `waivable`: not independent, and nobody else is eligible: the sole verifier
 *     may verify with a written justification, recorded as
 *     `verification_independence: "waived_single_verifier"`.
 */
export type VerifierIndependence =
  | { status: "independent" }
  | { status: "blocked" }
  | { status: "waivable" };

function plainRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}

/** The `responsibleId` values an audit entry's `changes` payload names. */
function responsibleIdsIn(changes: unknown): string[] {
  const payload = plainRecord(changes);
  if (!payload) return [];
  const holders = [
    payload,
    plainRecord(payload.before),
    plainRecord(payload.after),
    plainRecord(payload.initial),
  ];
  return holders.flatMap((holder) => {
    const id = holder?.responsibleId;
    return typeof id === "string" && id ? [id] : [];
  });
}

export async function assessCapaVerifierIndependence(
  executor: Pick<OrgExecutor, "select">,
  params: {
    organizationId: string;
    capaId: number;
    currentResponsibleId: string | null;
    verifierUserId: string;
  },
): Promise<VerifierIndependence> {
  const history = await executor
    .select({
      action: correctiveActionAuditLog.action,
      changes: correctiveActionAuditLog.changes,
      performedBy: correctiveActionAuditLog.performedBy,
    })
    .from(correctiveActionAuditLog)
    .where(
      and(
        eq(correctiveActionAuditLog.organizationId, params.organizationId),
        eq(correctiveActionAuditLog.capaId, params.capaId),
      ),
    );

  const tied = new Set<string>();
  if (params.currentResponsibleId) tied.add(params.currentResponsibleId);
  for (const entry of history) {
    for (const id of responsibleIdsIn(entry.changes)) tied.add(id);
    if (entry.action === "implement") tied.add(entry.performedBy);
  }

  if (!tied.has(params.verifierUserId)) return { status: "independent" };

  const members = await executor
    .select({ userId: member.userId, role: member.role, banned: user.banned })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, params.organizationId));
  const otherEligible = members.some(
    (candidate) =>
      !tied.has(candidate.userId) &&
      candidate.banned !== true &&
      hasPermissionLocally(roleNameFromUnknown(candidate.role), {
        capa: ["verify"],
      }),
  );

  return { status: otherEligible ? "blocked" : "waivable" };
}
