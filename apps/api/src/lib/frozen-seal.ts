import { calibrationJob, certificateInput } from "@calibra-facil/db/schema";
import {
  resolveIssuedAccreditationSeal,
  type AccreditationSealEligibilityParams,
} from "@calibra-facil/shared";
import { and, eq, sql } from "drizzle-orm";

/**
 * The accreditation-seal decision of an issued certificate is the one frozen at
 * approval (`certificate_input.seal`, Q42); the screens that show it (public
 * verification, the portal, the lab's job page) read it from here and never
 * re-decide it from the lab's live accreditation fields.
 *
 * Usage: `leftJoin(certificateInput, frozenSealJoin)` and select
 * `frozenSeal: frozenSealColumn`. The join carries the organization predicate
 * (a record approved before the input was frozen has no row: `null`).
 */
export const frozenSealJoin = and(
  eq(certificateInput.jobId, calibrationJob.id),
  eq(certificateInput.organizationId, calibrationJob.organizationId),
);

export const frozenSealColumn = sql<unknown>`${certificateInput.input} -> 'seal'`;

/** The seal as the lab's job page and the public pages show it. */
export type IssuedSeal = {
  accredited: boolean;
  /** Reason code when the seal was withheld (frozen decisions only). */
  withheldReason: string | null;
  /** The frozen decision, or the pre-freeze rule for a record that has none. */
  source: "frozen" | "legacy";
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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
  legacy: AccreditationSealEligibilityParams;
}): IssuedSeal {
  const { accredited, withheldReason, source } = resolveIssuedAccreditationSeal(
    {
      frozenSeal: isRecord(params.frozenSeal) ? params.frozenSeal : null,
      legacy: params.legacy,
    },
  );
  return { accredited, withheldReason, source };
}
