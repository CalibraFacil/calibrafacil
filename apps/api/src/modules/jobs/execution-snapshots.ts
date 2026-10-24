import type { OrgExecutor } from "@calibra-facil/db/for-org";
import {
  asset,
  assetType,
  environmentalLimits,
  referenceStandard,
  referenceStandardCertificateDocument,
  type AssetSnapshot,
  type CalibrationLocationSnapshot,
  type CalibrationPhaseSnapshot,
  type EnvironmentalLimitsSnapshot,
  type EnvironmentalSnapshot,
  type MethodSnapshot,
  type StandardSnapshot,
} from "@calibra-facil/db/schema";
import {
  judgeDraftExecutionStandards,
  type StandardsDraftWarning,
} from "@calibra-facil/schemas";
import { and, desc, eq, inArray, isNull, like, not, or } from "drizzle-orm";
import { withOrgReader } from "../../lib/org-transaction";
import { selectEffectiveEnvironmentalLimits } from "../../lib/unit-operational-settings";
import {
  checkEnvironmentWithinLimits,
  findMissingRequiredAssetSpecs,
} from "./helpers";
import {
  snapshotStandardIds,
  type StandardsRefusal,
} from "./standards-judgement";

/**
 * The frozen records a calibration is recorded with (asset, reference
 * standards, environment, location, phases) and how the submit/execute command
 * builds each of them from what a caller sends. Moved verbatim from the cloud
 * job route so every entry point builds them the same way.
 */

export function buildCalibrationLocationSnapshot(
  input:
    | {
        type: "customer_site" | "lab" | "other";
        addressText: string;
        notes?: string | null;
      }
    | undefined,
  existing: CalibrationLocationSnapshot | null | undefined,
  actorUserId: string,
): CalibrationLocationSnapshot | undefined {
  if (!input) return existing ?? undefined;

  return {
    type: input.type,
    addressText: input.addressText.trim(),
    ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
    recordedAt: new Date().toISOString(),
    recordedBy: actorUserId,
  };
}

export function buildCalibrationPhaseSnapshot(
  input:
    | {
        blocks: Record<
          string,
          {
            mode:
              | "before_and_after"
              | "before_only"
              | "after_only"
              | "not_performed";
            reason?: string | null;
          }
        >;
      }
    | undefined,
  existing: CalibrationPhaseSnapshot | null | undefined,
  actorUserId: string,
): CalibrationPhaseSnapshot | undefined {
  if (!input) return existing ?? undefined;

  const blocks: CalibrationPhaseSnapshot["blocks"] = {};
  for (const [key, block] of Object.entries(input.blocks ?? {})) {
    if (!key.trim()) continue;
    if (!isCalibrationPhaseMode(block.mode)) continue;
    blocks[key] = {
      mode: block.mode,
      ...(block.reason?.trim() ? { reason: block.reason.trim() } : {}),
    };
  }

  return {
    blocks,
    recordedAt: new Date().toISOString(),
    recordedBy: actorUserId,
  };
}

function isCalibrationPhaseMode(
  mode: unknown,
): mode is CalibrationPhaseSnapshot["blocks"][string]["mode"] {
  return (
    mode === "before_and_after" ||
    mode === "before_only" ||
    mode === "after_only" ||
    mode === "not_performed"
  );
}

function standardCertificateDocumentSnapshot(
  document: typeof referenceStandardCertificateDocument.$inferSelect,
) {
  return {
    documentId: document.id,
    r2Key: document.r2Key,
    fileName: document.fileName,
    fileSize: document.fileSize,
    sha256: document.sha256,
    uploadedAt: document.uploadedAt,
    certificateNumber: document.certificateNumber,
    calibrationDate: document.calibrationDate,
    nextCalibrationDate: document.nextCalibrationDate,
  };
}

function finalizedStandardCertificateDocumentCondition() {
  return not(like(referenceStandardCertificateDocument.r2Key, "pending/%"));
}

/** What these builders read through: the caller's org-bound handle or its own transaction. */
type Reader = Pick<OrgExecutor, "select">;

async function buildAssetSnapshot(
  assetId: number,
  organizationId: string,
  reader: Reader,
): Promise<
  { ok: true; snapshot: AssetSnapshot } | { ok: false; error: string }
> {
  const [row] = await reader
    .select({
      id: asset.id,
      assetTypeId: asset.assetTypeId,
      name: asset.name,
      tag: asset.tag,
      serialNumber: asset.serialNumber,
      manufacturer: asset.manufacturer,
      model: asset.model,
      baseMeasurementUnit: asset.baseMeasurementUnit,
      specifications: asset.specifications,
      assetTypeName: assetType.name,
      assetTypeSlug: assetType.slug,
    })
    .from(asset)
    .innerJoin(assetType, eq(asset.assetTypeId, assetType.id))
    .where(
      and(eq(asset.id, assetId), eq(asset.labOrganizationId, organizationId)),
    )
    .limit(1);

  if (!row) {
    return { ok: false, error: "Ativo nao encontrado" };
  }

  return {
    ok: true,
    snapshot: {
      assetId: row.id,
      assetTypeId: row.assetTypeId,
      assetTypeName: row.assetTypeName,
      assetTypeSlug: row.assetTypeSlug,
      baseMeasurementUnit: row.baseMeasurementUnit,
      name: row.name,
      tag: row.tag,
      serialNumber: row.serialNumber,
      manufacturer: row.manufacturer,
      model: row.model,
      specifications: row.specifications,
      capturedAt: new Date().toISOString(),
    },
  };
}

/**
 * The asset snapshot a calibration is recorded with: the one frozen on the job,
 * else one built from the asset now. Nothing is written here: the command
 * persists a freshly built snapshot in its own compare-and-set write, so a
 * refusal later on leaves the job untouched.
 */
export async function resolveAssetSnapshot(
  job: {
    organizationId: string;
    assetId: number;
    assetSnapshot: AssetSnapshot | null;
    methodSnapshot: MethodSnapshot;
  },
  executor?: Reader,
): Promise<
  | { ok: true; snapshot: AssetSnapshot; built: boolean }
  | {
      ok: false;
      kind: "asset_not_found" | "specification_missing";
      error: string;
    }
> {
  const frozen = job.assetSnapshot;
  const resolved = frozen
    ? { ok: true as const, snapshot: frozen }
    : await withOrgReader(job.organizationId, executor, (reader) =>
        buildAssetSnapshot(job.assetId, job.organizationId, reader),
      );
  if (!resolved.ok) {
    return { ok: false, kind: "asset_not_found", error: resolved.error };
  }

  const missing = findMissingRequiredAssetSpecs(
    job.methodSnapshot,
    resolved.snapshot,
  );
  if (missing.length > 0) {
    return {
      ok: false,
      kind: "specification_missing",
      error: `O ativo não possui a especificação obrigatória "${missing[0]?.label}". Atualize o cadastro do ativo antes de executar a calibração.`,
    };
  }

  return { ok: true, snapshot: resolved.snapshot, built: frozen === null };
}

/**
 * The moment a calibration is recorded as performed, for judging whether its
 * reference standards were valid: the date sent with the request, else the one
 * already saved on the job, else now. An unreadable or future date falls back
 * the same way (the route rejects it with its own error right after).
 */
export function standardsPerformedAt(
  requested: string | null | undefined,
  saved: Date | null | undefined,
): Date {
  const now = new Date();
  if (requested) {
    const parsed = new Date(requested);
    if (!Number.isNaN(parsed.getTime()) && parsed.getTime() <= now.getTime()) {
      return parsed;
    }
  }
  return saved ?? now;
}

type ReferenceStandardRow = typeof referenceStandard.$inferSelect;

/**
 * The snapshot entry of each standard record, as the cloud freezes it (with the
 * current certificate document). The one builder behind every entry this module
 * writes, so a standard is frozen the same way whoever asked.
 */
async function standardSnapshotEntries(
  standards: readonly ReferenceStandardRow[],
  reader: Reader,
): Promise<Map<number, StandardSnapshot>> {
  if (standards.length === 0) return new Map();

  const currentDocuments = await reader
    .select()
    .from(referenceStandardCertificateDocument)
    .where(
      and(
        eq(referenceStandardCertificateDocument.isCurrent, true),
        finalizedStandardCertificateDocumentCondition(),
        or(
          ...standards.map((standard) =>
            and(
              eq(referenceStandardCertificateDocument.standardId, standard.id),
              eq(
                referenceStandardCertificateDocument.certificateNumber,
                standard.certificateNumber,
              ),
            ),
          ),
        ),
      ),
    );
  const documentsByStandardId = new Map(
    currentDocuments.map((document) => [
      document.standardId,
      standardCertificateDocumentSnapshot(document),
    ]),
  );
  return new Map(
    standards.map((s) => [
      s.id,
      {
        id: s.id,
        name: s.name,
        type: s.type,
        kind: s.kind,
        certificateNumber: s.certificateNumber,
        calibratedBy: s.calibratedBy,
        calibrationDate: s.calibrationDate,
        nextCalibrationDate: s.nextCalibrationDate,
        uncertainty: s.uncertainty,
        uncertaintyUnit: s.uncertaintyUnit,
        coverageFactor: s.coverageFactor,
        distribution: s.distribution,
        drift: s.drift,
        certifiedValues: s.certifiedValues,
        metrologyData: s.metrologyData,
        certificateDocument: documentsByStandardId.get(s.id) ?? null,
      } satisfies StandardSnapshot,
    ]),
  );
}

/**
 * What a desktop draft save stores for a standard of its own snapshot that is
 * no longer valid (P1-11). The desktop's copy of that entry is never trusted:
 * the cloud's saved entry is kept verbatim when it has one, else the entry is
 * built from the cloud's own standards record. Entries of valid standards are
 * returned as the desktop froze them.
 */
export async function replaceStaleFrozenStandards(
  input: {
    frozen: StandardSnapshot[];
    staleIds: ReadonlySet<number>;
    savedSnapshot: StandardSnapshot[] | null;
    organizationId: string;
  },
  executor?: Reader,
): Promise<StandardSnapshot[]> {
  if (input.staleIds.size === 0) return input.frozen;

  const saved = new Map(
    (input.savedSnapshot ?? []).map((standard) => [standard.id, standard]),
  );
  const unsaved = [...input.staleIds].filter((id) => !saved.has(id));
  const built = await withOrgReader(
    input.organizationId,
    executor,
    async (reader) => {
      const rows =
        unsaved.length === 0
          ? []
          : await reader
              .select()
              .from(referenceStandard)
              .where(
                and(
                  inArray(referenceStandard.id, unsaved),
                  eq(referenceStandard.organizationId, input.organizationId),
                ),
              );
      return standardSnapshotEntries(rows, reader);
    },
  );

  return input.frozen.flatMap((entry) => {
    if (!input.staleIds.has(entry.id)) return [entry];
    const trusted = saved.get(entry.id) ?? built.get(entry.id);
    return trusted ? [trusted] : [];
  });
}

/**
 * The standards snapshot a save is recorded with, built from the standards the
 * caller names. `savedSnapshot` is what the job already has FROZEN and is the
 * one place a draft save is lenient: a standard of it that is named again and
 * has since gone stale (deleted, inactive, expired) is kept as frozen and
 * returned in `warnings`, instead of failing the save and losing the readings.
 * Every other standard is judged strictly. A submit passes no saved snapshot,
 * so for it nothing is lenient.
 */
export async function buildStandardsSnapshot(
  selectedStandardIds: number[] | undefined,
  organizationId: string,
  unitId: number,
  performedAt: Date,
  savedSnapshot: StandardSnapshot[] | null = null,
  executor?: Reader,
): Promise<
  | {
      ok: true;
      snapshot: StandardSnapshot[] | null | undefined;
      warnings: StandardsDraftWarning[];
    }
  | { ok: false; refusal: StandardsRefusal }
> {
  if (selectedStandardIds === undefined) {
    return { ok: true, snapshot: undefined, warnings: [] };
  }

  if (selectedStandardIds.length === 0) {
    return { ok: true, snapshot: null, warnings: [] };
  }

  // A standard named twice is one standard: the snapshot lists it once, in the
  // order it was first named.
  const standardIds = [...new Set(selectedStandardIds)];

  return withOrgReader(organizationId, executor, (reader) =>
    buildStandardsSnapshotOn(reader, {
      standardIds,
      organizationId,
      unitId,
      performedAt,
      savedSnapshot,
    }),
  );
}

async function buildStandardsSnapshotOn(
  reader: Reader,
  input: {
    standardIds: number[];
    organizationId: string;
    unitId: number;
    performedAt: Date;
    savedSnapshot: StandardSnapshot[] | null;
  },
): Promise<
  | {
      ok: true;
      snapshot: StandardSnapshot[] | null | undefined;
      warnings: StandardsDraftWarning[];
    }
  | { ok: false; refusal: StandardsRefusal }
> {
  const { standardIds, organizationId, unitId, performedAt, savedSnapshot } =
    input;
  const standards = await reader
    .select()
    .from(referenceStandard)
    .where(
      and(
        inArray(referenceStandard.id, standardIds),
        eq(referenceStandard.organizationId, organizationId),
      ),
    );

  // The draft-time judgement is advisory (the submit re-judges the FINAL
  // snapshot and asks for the back-date reason), but it is the same judgement.
  const judgement = judgeDraftExecutionStandards(
    {
      standardIds,
      savedStandardIds: snapshotStandardIds(savedSnapshot),
      performedAt,
      today: new Date(),
      mode: "cloud",
    },
    standards.map((standard) => ({
      id: standard.id,
      name: standard.name,
      status: standard.status,
      deletedAt: standard.deletedAt,
      nextCalibrationDate: standard.nextCalibrationDate,
      inScope: standard.unitId === unitId,
    })),
  );
  if (!judgement.ok) {
    return { ok: false, refusal: judgement };
  }

  const staleIds = new Set(
    judgement.warnings.flatMap((warning) => warning.standardIds),
  );
  const savedById = new Map(
    (savedSnapshot ?? []).map((standard) => [standard.id, standard]),
  );
  const freshById = await standardSnapshotEntries(
    standards.filter((standard) => !staleIds.has(standard.id)),
    reader,
  );

  return {
    ok: true,
    // A stale standard keeps the entry the technician picked, frozen as saved.
    snapshot: standardIds.flatMap((id) => {
      const entry = staleIds.has(id) ? savedById.get(id) : freshById.get(id);
      return entry ? [entry] : [];
    }),
    warnings: judgement.warnings,
  };
}

export async function buildEnvironmentalSnapshot(
  environment:
    | {
        temperature: number | null;
        humidity: number | null;
        pressure: number | null;
      }
    | undefined,
  existing: { assetId: number; unitId: number },
  organizationId: string,
  userId: string,
  executor?: Reader,
): Promise<EnvironmentalSnapshot | undefined> {
  if (!environment) return undefined;

  return withOrgReader(organizationId, executor, (reader) =>
    buildEnvironmentalSnapshotOn(reader, {
      environment,
      existing,
      organizationId,
      userId,
    }),
  );
}

async function buildEnvironmentalSnapshotOn(
  reader: Reader,
  input: {
    environment: {
      temperature: number | null;
      humidity: number | null;
      pressure: number | null;
    };
    existing: { assetId: number; unitId: number };
    organizationId: string;
    userId: string;
  },
): Promise<EnvironmentalSnapshot> {
  const { environment, existing, organizationId, userId } = input;
  const [jobAsset] = await reader
    .select({ assetTypeId: asset.assetTypeId })
    .from(asset)
    .where(
      and(
        eq(asset.id, existing.assetId),
        eq(asset.labOrganizationId, organizationId),
      ),
    )
    .limit(1);

  let frozenLimits: EnvironmentalLimitsSnapshot | null = null;
  if (jobAsset && existing.unitId) {
    const limits = await reader
      .select()
      .from(environmentalLimits)
      .where(
        and(
          eq(environmentalLimits.organizationId, organizationId),
          eq(environmentalLimits.unitId, existing.unitId),
          or(
            eq(environmentalLimits.assetTypeId, jobAsset.assetTypeId),
            isNull(environmentalLimits.assetTypeId),
          ),
        ),
      )
      .orderBy(desc(environmentalLimits.assetTypeId));

    const { limits: effectiveLimits } =
      selectEffectiveEnvironmentalLimits(limits);
    if (effectiveLimits) {
      frozenLimits = {
        ...(effectiveLimits.temperatureMin != null &&
        effectiveLimits.temperatureMax != null
          ? {
              temperature: {
                min: effectiveLimits.temperatureMin,
                max: effectiveLimits.temperatureMax,
              },
            }
          : {}),
        ...(effectiveLimits.humidityMin != null &&
        effectiveLimits.humidityMax != null
          ? {
              humidity: {
                min: effectiveLimits.humidityMin,
                max: effectiveLimits.humidityMax,
              },
            }
          : {}),
        ...(effectiveLimits.pressureMin != null &&
        effectiveLimits.pressureMax != null
          ? {
              pressure: {
                min: effectiveLimits.pressureMin,
                max: effectiveLimits.pressureMax,
              },
            }
          : {}),
      };
    }
  }

  return {
    temperature: environment.temperature,
    humidity: environment.humidity,
    pressure: environment.pressure,
    recordedAt: new Date().toISOString(),
    recordedBy: userId,
    limits: frozenLimits,
    withinLimits: checkEnvironmentWithinLimits(environment, frozenLimits),
    outOfLimitsJustification: null,
  };
}
