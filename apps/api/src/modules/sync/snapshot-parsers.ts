import {
  type CalibrationPhaseSnapshot,
  type CalibrationLocationSnapshot,
  type EnvironmentalSnapshot,
  type StandardSnapshot,
} from "@calibra-facil/db/schema";
import {
  StandardSnapshotSchema,
  METHOD_DEVIATIONS_MAX_LENGTH,
} from "@calibra-facil/schemas";
import { asRecord, isPositiveInteger, parseSnapshotDate } from "./helpers";

export function collectCompositionStandardIds(data: Record<string, unknown>) {
  const ids = new Set<number>();

  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }

    const record = asRecord(value);
    if (Object.keys(record).length === 0) return;

    if (
      record.kind === "mass_standard_composition" &&
      Array.isArray(record.items)
    ) {
      for (const item of record.items) {
        const compositionItem = asRecord(item);
        const standardIds = Array.isArray(compositionItem.standardIds)
          ? compositionItem.standardIds
          : [];
        if (standardIds.length > 0) {
          for (const standardId of standardIds) {
            if (isPositiveInteger(standardId)) ids.add(standardId);
          }
        } else if (isPositiveInteger(compositionItem.standardId)) {
          ids.add(compositionItem.standardId);
        }
      }
      return;
    }

    for (const child of Object.values(record)) visit(child);
  };

  visit(data);
  return Array.from(ids);
}

export function getStandardSnapshotsResult(
  row: Record<string, unknown>,
  key: string,
):
  | { ok: true; value: StandardSnapshot[] | null }
  | { ok: false; reason: string } {
  const value = row[key];
  if (value === null) return { ok: true, value: null };
  const parseResult = StandardSnapshotSchema.array().safeParse(value);
  if (!parseResult.success) {
    return {
      ok: false,
      reason:
        parseResult.error.issues[0]?.message ??
        "Desktop execution standardsSnapshot is invalid.",
    };
  }
  const normalized: StandardSnapshot[] = [];
  const seenIds = new Set<number>();
  for (const standard of parseResult.data) {
    // A standard listed twice is one standard: keep its first entry.
    if (seenIds.has(standard.id)) continue;
    seenIds.add(standard.id);
    const calibrationDate = parseSnapshotDate(standard.calibrationDate);
    const nextCalibrationDate =
      standard.nextCalibrationDate == null
        ? null
        : parseSnapshotDate(standard.nextCalibrationDate);
    if (
      !calibrationDate ||
      (standard.nextCalibrationDate && !nextCalibrationDate)
    ) {
      return {
        ok: false,
        reason: "Desktop execution standardsSnapshot contains invalid dates.",
      };
    }

    normalized.push({
      ...standard,
      calibrationDate,
      nextCalibrationDate,
    });
  }
  return { ok: true, value: normalized };
}

export function getEnvironmentalSnapshotOrNull(
  row: Record<string, unknown>,
  key: string,
): EnvironmentalSnapshot | null {
  const value = row[key];
  return isEnvironmentalSnapshot(value) ? value : null;
}

export function getCalibrationLocationSnapshotOrNull(
  row: Record<string, unknown>,
  key: string,
): CalibrationLocationSnapshot | null {
  const value = row[key];
  return isCalibrationLocationSnapshot(value) ? value : null;
}

export function getMethodDeviationsOrNull(
  row: Record<string, unknown>,
  key: string,
): string | null {
  const value = row[key];
  if (typeof value !== "string") return null;
  // Same cap the cloud's own ExecuteJobSchema applies. A desktop client that
  // skipped the check must not be able to write past it on sync.
  return value.trim().slice(0, METHOD_DEVIATIONS_MAX_LENGTH) || null;
}

export function getCalibrationPhaseSnapshotOrNull(
  row: Record<string, unknown>,
  key: string,
): CalibrationPhaseSnapshot | null {
  const value = row[key];
  return isCalibrationPhaseSnapshot(value) ? value : null;
}

function isEnvironmentalSnapshot(
  value: unknown,
): value is EnvironmentalSnapshot {
  const row = asRecord(value);
  return (
    ("temperature" in row || "humidity" in row || "pressure" in row) &&
    typeof row.recordedAt === "string" &&
    typeof row.recordedBy === "string"
  );
}

function isCalibrationLocationSnapshot(
  value: unknown,
): value is CalibrationLocationSnapshot {
  const row = asRecord(value);
  return (
    typeof row.type === "string" &&
    typeof row.addressText === "string" &&
    typeof row.recordedAt === "string" &&
    typeof row.recordedBy === "string"
  );
}

function isCalibrationPhaseSnapshot(
  value: unknown,
): value is CalibrationPhaseSnapshot {
  const row = asRecord(value);
  return (
    typeof row.blocks === "object" &&
    row.blocks !== null &&
    typeof row.recordedAt === "string" &&
    typeof row.recordedBy === "string"
  );
}

export function hasOwn(row: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(row, key);
}

export function getJobStatus(row: Record<string, unknown>, key: string) {
  const value = row[key];
  if (
    value === "DRAFT" ||
    value === "IN_PROGRESS" ||
    value === "REVIEW" ||
    value === "REJECTED"
  ) {
    return value;
  }

  return null;
}

export function parseSyncDate(value: string | null | undefined) {
  return value ? new Date(value) : null;
}
