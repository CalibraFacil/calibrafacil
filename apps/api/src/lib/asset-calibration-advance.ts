/**
 * Advance an asset's calibration dates when a calibration job is APPROVED.
 *
 * Before this existed, nothing moved `asset.last_calibration_date` /
 * `next_calibration_date` / `next_legal_verification_date` after a calibration
 * was actually performed — the lab had to PATCH the asset by hand, and until it
 * did, the due-recalibration and legal-verification sweeps kept re-reminding
 * for an instrument that had just been calibrated.
 *
 * Rules (Track 1 — customer-owned interval, §7.8.4.3 + ILAC-G24):
 *  - `last_calibration_date` advances to the job's calibration date
 *    (`performed_at`, falling back to the approval time). It only ever moves
 *    FORWARD — an amendment/re-approval of an older job never rewinds it —
 *    which also makes the advance idempotent.
 *  - `next_calibration_date` = last + the customer-owned interval
 *    (REQ-INTERVAL-003); null when the customer has not set an interval —
 *    the lab still never authors a next-cal date here.
 *
 * Track 2 (legal metrology): when the asset carries a `regulated_interval`,
 * `next_legal_verification_date` is re-derived from the new date, using the
 * same last-verification proxy (`last_calibration_date`) as every other write
 * path (assets route / sync push).
 */

import type { OrgDb } from "@calibra-facil/db/for-org";
import { asset, assetAuditLog } from "@calibra-facil/db/schema";
import { RegulatedIntervalSchema } from "@calibra-facil/schemas";
import { calendarDateKey } from "@calibra-facil/shared";
import { and, eq, isNull } from "drizzle-orm";
import { deriveNextCalibrationDate } from "./portal-asset-interval";
import { deriveRegulatedNextDate } from "./regulated-interval";

export type AssetCalibrationAdvanceInput = {
  /** The job's calibration date (`performed_at` ?? approval time). */
  calibrationDate: Date | null;
  asset: {
    lastCalibrationDate: Date | null;
    calibrationIntervalMonths: number | null;
    /** Raw jsonb column value; parsed defensively here. */
    regulatedInterval: unknown;
    installedAt: Date | null;
  };
};

export type AssetCalibrationAdvance = {
  lastCalibrationDate: Date;
  nextCalibrationDate: Date | null;
  /** Present only when the asset carries a regulated interval (Track 2). */
  nextLegalVerificationDate?: Date | null;
};

/** Pure decision — testable without a DB. Returns null when nothing advances. */
export function decideAssetCalibrationAdvance(
  input: AssetCalibrationAdvanceInput,
): AssetCalibrationAdvance | null {
  const { calibrationDate } = input;
  if (!calibrationDate) return null;

  const { lastCalibrationDate, calibrationIntervalMonths } = input.asset;
  // Forward-only: never rewind on amendments / re-approvals of older work.
  // last_calibration_date is a calendar day (UTC midnight when read back), the
  // calibration date an instant: compare the days they name, so work done later
  // on the day already recorded is not a second "advance".
  if (
    lastCalibrationDate !== null &&
    calendarDateKey(lastCalibrationDate) >= calendarDateKey(calibrationDate)
  ) {
    return null;
  }

  const advance: AssetCalibrationAdvance = {
    lastCalibrationDate: calibrationDate,
    nextCalibrationDate:
      calibrationIntervalMonths === null
        ? null
        : deriveNextCalibrationDate(calibrationDate, calibrationIntervalMonths),
  };

  const parsedRegulated = RegulatedIntervalSchema.safeParse(
    input.asset.regulatedInterval,
  );
  if (parsedRegulated.success && parsedRegulated.data !== null) {
    advance.nextLegalVerificationDate = deriveRegulatedNextDate(
      parsedRegulated.data,
      {
        lastVerificationDate: calibrationDate,
        firstVerificationDate: calibrationDate,
        installDate: input.asset.installedAt,
      },
    ).date;
  }

  return advance;
}

/** What an advance changed, kept by the approval so a reverted approval can undo it. */
export type AssetCalibrationAdvanceApplied = {
  assetId: number;
  labOrganizationId: string;
  previous: {
    lastCalibrationDate: Date | null;
    nextCalibrationDate: Date | null;
    nextLegalVerificationDate: Date | null;
  };
  next: AssetCalibrationAdvance;
};

/**
 * Load, decide, persist + audit, on `o` (the caller's transaction). Since
 * roadmap 2 B2 this runs INSIDE the approval's own transaction: the read, the
 * forward-only update and its audit row commit or roll back with the approval
 * (no date change without its audit trail, no approval without the advance), so
 * there is no retry and no swallowed failure: an error rolls the approval back.
 * Returns what changed, or null when nothing advanced (no asset, no date, or the
 * recorded date is not older: forward-only, hence idempotent).
 */
export async function advanceAssetCalibrationDates(
  o: OrgDb,
  input: {
    assetId: number | null;
    calibrationDate: Date | null;
    performedBy: string;
    source: "job_approval" | "job_approval_reconciliation";
  },
): Promise<AssetCalibrationAdvanceApplied | null> {
  if (input.assetId === null) return null;
  const assetId = input.assetId;

  const [existing] = await o
    .select({
      id: asset.id,
      labOrganizationId: asset.labOrganizationId,
      lastCalibrationDate: asset.lastCalibrationDate,
      nextCalibrationDate: asset.nextCalibrationDate,
      nextLegalVerificationDate: asset.nextLegalVerificationDate,
      calibrationIntervalMonths: asset.calibrationIntervalMonths,
      regulatedInterval: asset.regulatedInterval,
      installedAt: asset.installedAt,
    })
    .from(asset)
    .where(and(eq(asset.id, assetId), isNull(asset.deletedAt)))
    .limit(1);
  if (!existing) return null;

  const advance = decideAssetCalibrationAdvance({
    calibrationDate: input.calibrationDate,
    asset: existing,
  });
  if (!advance) return null;

  await o
    .update(asset)
    .set({ ...advance, updatedAt: new Date() })
    .where(eq(asset.id, existing.id));

  const changes: Record<string, { old: unknown; new: unknown }> = {
    lastCalibrationDate: {
      old: existing.lastCalibrationDate,
      new: advance.lastCalibrationDate,
    },
    nextCalibrationDate: {
      old: existing.nextCalibrationDate,
      new: advance.nextCalibrationDate,
    },
  };
  if (advance.nextLegalVerificationDate !== undefined) {
    changes.nextLegalVerificationDate = {
      old: existing.nextLegalVerificationDate,
      new: advance.nextLegalVerificationDate,
    };
  }
  await o.insert(assetAuditLog).values({
    organizationId: existing.labOrganizationId,
    assetId: existing.id,
    action: "update",
    changes: { source: input.source, ...changes },
    performedBy: input.performedBy,
  });

  return {
    assetId: existing.id,
    labOrganizationId: existing.labOrganizationId,
    previous: {
      lastCalibrationDate: existing.lastCalibrationDate,
      nextCalibrationDate: existing.nextCalibrationDate,
      nextLegalVerificationDate: existing.nextLegalVerificationDate,
    },
    next: advance,
  };
}

/**
 * Undo `advanceAssetCalibrationDates` for an approval that is being reverted
 * before it was released (the certificate job could not be dispatched, in-process
 * dispatch only). It restores the previous dates only while the asset still
 * carries the dates this advance wrote (a later edit or advance is never
 * overwritten) and appends an audit entry saying so.
 */
export async function revertAssetCalibrationAdvance(
  o: OrgDb,
  applied: AssetCalibrationAdvanceApplied,
  params: { performedBy: string; reason: string },
): Promise<void> {
  const restored = await o
    .update(asset)
    .set({
      lastCalibrationDate: applied.previous.lastCalibrationDate,
      nextCalibrationDate: applied.previous.nextCalibrationDate,
      ...(applied.next.nextLegalVerificationDate !== undefined
        ? {
            nextLegalVerificationDate:
              applied.previous.nextLegalVerificationDate,
          }
        : {}),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(asset.id, applied.assetId),
        eq(asset.lastCalibrationDate, applied.next.lastCalibrationDate),
      ),
    )
    .returning({ id: asset.id });
  if (restored.length === 0) return;

  await o.insert(assetAuditLog).values({
    organizationId: applied.labOrganizationId,
    assetId: applied.assetId,
    action: "update",
    changes: {
      source: "job_approval_reverted",
      lastCalibrationDate: {
        old: applied.next.lastCalibrationDate,
        new: applied.previous.lastCalibrationDate,
      },
      nextCalibrationDate: {
        old: applied.next.nextCalibrationDate,
        new: applied.previous.nextCalibrationDate,
      },
    },
    performedBy: params.performedBy,
    reason: params.reason,
  });
}
