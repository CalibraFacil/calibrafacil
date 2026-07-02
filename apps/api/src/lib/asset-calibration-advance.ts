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

import { db } from "@calibra-facil/db";
import { asset, assetAuditLog } from "@calibra-facil/db/schema";
import { RegulatedIntervalSchema } from "@calibra-facil/schemas";
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
  if (
    lastCalibrationDate !== null &&
    lastCalibrationDate.getTime() >= calibrationDate.getTime()
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

/**
 * Load, decide, persist + audit. Never throws — an advance failure must not
 * fail the approval itself (the job state change is the regulated record; this
 * is derived bookkeeping the next sweep/pull picks up).
 */
export async function advanceAssetCalibrationDatesOnApproval(input: {
  assetId: number | null;
  calibrationDate: Date | null;
  performedBy: string;
  source: "job_approval" | "desktop_certificate_publish";
}): Promise<void> {
  try {
    if (input.assetId === null) return;

    const [existing] = await db
      .select({
        id: asset.id,
        lastCalibrationDate: asset.lastCalibrationDate,
        nextCalibrationDate: asset.nextCalibrationDate,
        nextLegalVerificationDate: asset.nextLegalVerificationDate,
        calibrationIntervalMonths: asset.calibrationIntervalMonths,
        regulatedInterval: asset.regulatedInterval,
        installedAt: asset.installedAt,
      })
      .from(asset)
      .where(and(eq(asset.id, input.assetId), isNull(asset.deletedAt)))
      .limit(1);
    if (!existing) return;

    const advance = decideAssetCalibrationAdvance({
      calibrationDate: input.calibrationDate,
      asset: existing,
    });
    if (!advance) return;

    await db
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
    await db.insert(assetAuditLog).values({
      assetId: existing.id,
      action: "update",
      changes: { source: input.source, ...changes },
      performedBy: input.performedBy,
    });
  } catch (error) {
    console.error(
      `[asset-calibration-advance] Failed to advance asset ${input.assetId} dates:`,
      error,
    );
  }
}
