import type { OrgExecutor } from "@calibra-facil/db/for-org";
import { calibrationJob, certificateInput } from "@calibra-facil/db/schema";
import {
  resolveIssuedAccreditationSeal,
  type AccreditationSealEligibilityParams,
} from "@calibra-facil/shared";
import { and, eq, sql } from "drizzle-orm";
import { isRecord } from "@calibra-facil/shared/record";

/**
 * The accreditation-seal decision of an issued certificate is the one frozen at
 * approval (`certificate_input.seal`); the screens that show it (public
 * verification, the portal, the lab's job page) read it through this module and
 * never re-decide it from the lab's live accreditation fields.
 */

// The seal as the frozen input stores it, and the accreditation number printed on
// the PDF (`certificate_input.input.job.lab.accreditationNumber`), whatever the
// lab's profile says today. `jobs.ts` selects them next to the job row; the other
// domains read them with `loadFrozenSeal`.
export const frozenSealJoin = and(
  eq(certificateInput.jobId, calibrationJob.id),
  eq(certificateInput.organizationId, calibrationJob.organizationId),
);

export const frozenSealColumn = sql<unknown>`${certificateInput.input} -> 'seal'`;

export const frozenAccreditationNumberColumn = sql<
  string | null
>`${certificateInput.input} #>> '{job,lab,accreditationNumber}'`;

/**
 * The frozen seal decision and accreditation number of one issued job, to be
 * handed to `issuedSealOf` (a record approved before the input was frozen has no
 * row: both are null). The query carries the organization predicate.
 */
export async function loadFrozenSeal(
  executor: Pick<OrgExecutor, "select">,
  job: { id: number; organizationId: string },
): Promise<{ frozenSeal: unknown; frozenAccreditationNumber: string | null }> {
  const [row] = await executor
    .select({
      frozenSeal: frozenSealColumn,
      frozenAccreditationNumber: frozenAccreditationNumberColumn,
    })
    .from(certificateInput)
    .where(
      and(
        eq(certificateInput.jobId, job.id),
        eq(certificateInput.organizationId, job.organizationId),
      ),
    )
    .limit(1);
  return {
    frozenSeal: row?.frozenSeal ?? null,
    frozenAccreditationNumber: row?.frozenAccreditationNumber ?? null,
  };
}

/** The seal as the lab's job page and the public pages show it. */
export type IssuedSeal = {
  accredited: boolean;
  /** Reason code when the seal was withheld (frozen decisions only). */
  withheldReason: string | null;
  /** The frozen decision, or the pre-freeze rule for a record that has none. */
  source: "frozen" | "legacy";
  /**
   * The accreditation number to show: the one frozen with the certificate when
   * there is one, else (a record approved before the input existed) the lab's
   * current number. Null when neither exists.
   */
  accreditationNumber: string | null;
};

/**
 * The frozen decision as the job detail DTO carries it (`accreditationSeal`),
 * or null when there is none (the job is not approved yet, or was approved
 * before the decision was frozen).
 */
export function frozenSealOf(frozenSeal: unknown): {
  accredited: boolean;
  withheldReason: string | null;
  evaluatedAt: string;
} | null {
  if (!isRecord(frozenSeal) || typeof frozenSeal.accredited !== "boolean") {
    return null;
  }
  return {
    accredited: frozenSeal.accredited,
    withheldReason:
      !frozenSeal.accredited && typeof frozenSeal.withheldReason === "string"
        ? frozenSeal.withheldReason
        : null,
    evaluatedAt:
      typeof frozenSeal.evaluatedAt === "string" ? frozenSeal.evaluatedAt : "",
  };
}

/**
 * The issued certificate's seal: the frozen decision, or, for a record
 * approved before the input existed, the rule it was issued under.
 */
export function issuedSealOf(params: {
  frozenSeal: unknown;
  /** `certificate_input.input.job.lab.accreditationNumber`, when the input exists. */
  frozenAccreditationNumber?: string | null;
  legacy: AccreditationSealEligibilityParams;
}): IssuedSeal {
  const { accredited, withheldReason, source } = resolveIssuedAccreditationSeal(
    {
      frozenSeal: isRecord(params.frozenSeal) ? params.frozenSeal : null,
      legacy: params.legacy,
    },
  );
  const frozenNumber = params.frozenAccreditationNumber;
  const accreditationNumber =
    source === "frozen" && typeof frozenNumber === "string"
      ? frozenNumber
      : (params.legacy.lab.accreditationNumber ?? null);
  return { accredited, withheldReason, source, accreditationNumber };
}
