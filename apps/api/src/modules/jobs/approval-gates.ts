import type { OrgExecutor } from "@calibra-facil/db/for-org";
import {
  member,
  organization,
  type calibrationJob,
} from "@calibra-facil/db/schema";
import { and, eq, inArray, ne } from "drizzle-orm";
import {
  judgeSnapshotStandards,
  snapshotStandardIds,
  type StandardsRefusal,
} from "./standards-judgement";

/**
 * The approval gates that depend on WHO did the work and on WHAT the
 * laboratory is, kept apart from `approveJob` so each rule is one small,
 * testable function (roadmap 2 B5, ISO/IEC 17025 §6.2.4, §6.2.6, §6.4, §7.10).
 */

type Reader = Pick<OrgExecutor, "select">;
type JobRow = typeof calibrationJob.$inferSelect;

/**
 * Is the laboratory accredited? An accredited laboratory (Q45) is held to the
 * gates unconditionally: the authorized-signatory roster is mandatory and the
 * "no other approver exists" exemption of a solo laboratory does not apply.
 * A laboratory that is not accredited keeps the auto-detected behaviour.
 */
export async function laboratoryIsAccredited(
  organizationId: string,
  reader: Reader,
): Promise<boolean> {
  const [lab] = await reader
    .select({ accreditationActive: organization.accreditationActive })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1);
  return lab?.accreditationActive === true;
}

/**
 * Who did the work this approval would release, as the job records it: the
 * assigned technician, the creator and (since 0134) the person who ACTUALLY
 * submitted it for review. An approver who is any of them is reviewing their
 * own work. `submittedBy` is null on a job that predates the column (and on
 * one approved before it existed): the other two still apply.
 */
export function isApproverTheWorkDoer(
  job: Pick<JobRow, "technicianId" | "createdBy" | "submittedBy">,
  approverId: string,
): boolean {
  return (
    job.technicianId === approverId ||
    job.createdBy === approverId ||
    job.submittedBy === approverId
  );
}

/**
 * Is there another member who could approve instead? Used only by the
 * auto-detected exemption of a laboratory that is not accredited (a genuine
 * solo lab would otherwise be left with a REVIEW job nobody can release). An
 * eligible alternate holds `calibration.approve`, which access.ts grants to
 * admin and owner only; both are global multi-unit roles, so any such member
 * can access the job's unit by construction.
 */
export async function hasAlternateApprover(
  params: { organizationId: string; approverId: string },
  reader: Reader,
): Promise<boolean> {
  const [alternate] = await reader
    .select({ id: member.id })
    .from(member)
    .where(
      and(
        eq(member.organizationId, params.organizationId),
        inArray(member.role, ["admin", "owner"]),
        ne(member.userId, params.approverId),
      ),
    )
    .limit(1);
  return Boolean(alternate);
}

/**
 * Separation of duties (ISO/IEC 17025 §6.2.4 / §7.1): must this approval be
 * refused because the approver did the work? Accredited laboratory: always.
 * Otherwise only when somebody else could approve (a solo laboratory is exempt).
 */
export async function selfApprovalBlocked(
  params: {
    job: Pick<JobRow, "technicianId" | "createdBy" | "submittedBy">;
    organizationId: string;
    approverId: string;
    accredited: boolean;
  },
  reader: Reader,
): Promise<boolean> {
  if (!isApproverTheWorkDoer(params.job, params.approverId)) return false;
  if (params.accredited) return true;
  return hasAlternateApprover(params, reader);
}

/**
 * The reference standards of the job, judged again at the moment of approval
 * with the ONE standards judgement the submit uses (`judgeSnapshotStandards`):
 * each standard must exist in this laboratory, not be deleted, be ACTIVE (a
 * standard flagged out of tolerance, i.e. recalled, or sent for calibration, i.e.
 * in quarantine, is not) and have been valid on the day the work was PERFORMED.
 * The back-date justification is not asked again: the submit recorded it.
 * Returns the refusal, or null when the job may go on.
 */
export async function standardsRefusalAtApproval(
  params: {
    job: Pick<JobRow, "standardsSnapshot" | "performedAt">;
    organizationId: string;
    now: Date;
  },
  reader: Reader,
): Promise<StandardsRefusal | null> {
  const standardIds = snapshotStandardIds(params.job.standardsSnapshot);
  if (standardIds.length === 0) return null;
  const judgement = await judgeSnapshotStandards(
    {
      standardIds,
      organizationId: params.organizationId,
      performedAt: params.job.performedAt,
      now: params.now,
      mode: "cloud",
      requireBackdateReason: false,
    },
    reader,
  );
  return judgement.ok ? null : judgement;
}
