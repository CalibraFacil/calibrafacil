import { db } from "@calibra-facil/db";
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
import { judgeExecutionStandards } from "@calibra-facil/schemas";
import { and, desc, eq, inArray, isNull, like, not, or } from "drizzle-orm";
import { selectEffectiveEnvironmentalLimits } from "../../lib/unit-operational-settings";
import {
  checkEnvironmentWithinLimits,
  findMissingRequiredAssetSpecs,
} from "./helpers";
import type { StandardsRefusal } from "./standards-judgement";

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

async function buildAssetSnapshot(
  assetId: number,
  organizationId: string,
): Promise<
  { ok: true; snapshot: AssetSnapshot } | { ok: false; error: string }
> {
  const [row] = await db
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
export async function resolveAssetSnapshot(job: {
  organizationId: string;
  assetId: number;
  assetSnapshot: AssetSnapshot | null;
  methodSnapshot: MethodSnapshot;
}): Promise<
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
    : await buildAssetSnapshot(job.assetId, job.organizationId);
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

export async function buildStandardsSnapshot(
  selectedStandardIds: number[] | undefined,
  organizationId: string,
  unitId: number,
  performedAt: Date,
): Promise<
  | { ok: true; snapshot: StandardSnapshot[] | null | undefined }
  | { ok: false; refusal: StandardsRefusal }
> {
  if (selectedStandardIds === undefined) {
    return { ok: true, snapshot: undefined };
  }

  if (selectedStandardIds.length === 0) {
    return { ok: true, snapshot: null };
  }

  // A standard named twice is one standard: the snapshot lists it once, in the
  // order it was first named.
  const standardIds = [...new Set(selectedStandardIds)];

  const standards = await db
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
  const judgement = judgeExecutionStandards(
    {
      standardIds,
      performedAt,
      today: new Date(),
      mode: "cloud",
      requireBackdateReason: false,
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

  const standardsById = new Map(
    standards.map((standard) => [standard.id, standard]),
  );
  const orderedStandards = standardIds.map((id) => standardsById.get(id)!);

  const currentDocuments = await db
    .select()
    .from(referenceStandardCertificateDocument)
    .where(
      and(
        eq(referenceStandardCertificateDocument.isCurrent, true),
        finalizedStandardCertificateDocumentCondition(),
        or(
          ...orderedStandards.map((standard) =>
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

  return {
    ok: true,
    snapshot: orderedStandards.map((s) => ({
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
    })),
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
): Promise<EnvironmentalSnapshot | undefined> {
  if (!environment) return undefined;

  const [jobAsset] = await db
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
    const limits = await db
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
