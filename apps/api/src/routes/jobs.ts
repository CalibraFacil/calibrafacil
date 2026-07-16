import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "@calibra-facil/db";
import {
  renderLabel,
  defaultRenderOptions,
} from "@calibra-facil/label-rendering";
import { enqueueBackgroundJob } from "../lib/background-jobs";
import { sendServiceOrdersToFinance } from "../lib/finance";
import type { IntegrationsEnv } from "../lib/integrations";
import {
  calibrationJob,
  jobAuditLog,
  asset,
  assetType,
  customer,
  organization,
  service,
  referenceStandard,
  referenceStandardCertificateDocument,
  user,
  member,
  memberUnitAssignment,
  environmentalLimits,
  personnelCompetence,
  type MethodSnapshot,
  type MethodInputField,
  type AssetSnapshot,
  type StandardSnapshot,
  type EnvironmentalSnapshot,
  type EnvironmentalLimitsSnapshot,
  type CalibrationLocationSnapshot,
  type CalibrationPhaseSnapshot,
} from "@calibra-facil/db/schema";
import {
  notifyJobSubmittedForReview,
  notifyJobRejected,
  notifyJobAssigned,
  notifyCertificateAmended,
} from "@calibra-facil/notifications";
import {
  CreateJobSchema,
  UpdateJobSchema,
  ListJobsQuerySchema,
  AssignTechnicianSchema,
  SubmitForReviewSchema,
  ApproveJobSchema,
  RejectJobSchema,
  CancelJobSchema,
  ExecuteJobSchema,
  AmendJobSchema,
  FlagJobOutOfToleranceSchema,
} from "@calibra-facil/schemas";
import { flagJobOutOfTolerance } from "../lib/oot-notifications";
import { syncJobStandardLinks } from "../lib/job-standards";
import { classifyJobScopeCompliance } from "../lib/scope-compliance";
import {
  addServerTiming,
  withLabPermission,
  type AuthVariables,
} from "../middleware/permission";
import { normalizeStandardsForOfficialExecution } from "@calibra-facil/shared";
import { normalizeMethodDataForStorage } from "@calibra-facil/shared/units";
import { type CertificateTemplateSnapshot } from "@calibra-facil/shared/certificate-templates";
import {
  requirePlanLimit,
  assertPlanLimitInTransaction,
} from "../middleware/tier-guard";
import { selectEffectiveEnvironmentalLimits } from "../lib/unit-operational-settings";
import {
  eq,
  and,
  ilike,
  desc,
  count,
  lte,
  gte,
  inArray,
  isNull,
  like,
  not,
  or,
  sql,
} from "drizzle-orm";
import {
  createR2Client,
  generatePresignedUrl,
  extractKeyFromUrl,
  type R2Env,
  type R2BucketLike,
} from "../lib/storage";
import { createCalibrationJob, jobCreationClientErrors } from "../lib/jobs";
import { generateCertificateIdentity } from "../lib/certificate-numbering";
import { loadJobFinancialContexts } from "../lib/finance";
import { alias } from "drizzle-orm/pg-core";
import { getExecuteRows } from "../lib/db";
import { buildUnitScopeCondition } from "../lib/units";
import { syncVisitStatusFromJobs } from "../lib/visits";
import { parseLegacyNumericIdentifier } from "../lib/route-identifiers";
import {
  getEffectiveCertificateTemplateSnapshot,
  serializeCertificateTemplateSnapshot,
} from "../lib/certificate-template-snapshots";
import {
  executeCompiledMethod,
  type CalculationEngineLike,
  type CompiledMethod,
  type CompiledMethodExecutionResult,
  type MethodDiagnostic,
} from "@calibra-facil/method-definition";
import {
  createCalculationEngine,
  METHOD_ENGINE_OPTIONS,
} from "@calibra-facil/math-engine";
import {
  decodeRouteIdentifier,
  shouldUseLocalR2Download,
  r2EnvFromUnknown,
  methodInputFieldsFromSnapshot,
  methodSnapshotDisplay,
  isCompiledMethod,
  certificateTemplateSnapshotFromUnknown,
  buildLocalJobFileUrl,
  checkEnvironmentWithinLimits,
  findMissingRequiredAssetSpecs,
  stripAssetSpecData,
} from "../modules/jobs/helpers";
import { approveJob } from "../modules/jobs/approve-job";

// Aliases for multiple user joins
const approverUser = alias(user, "approverUser");
const rejectorUser = alias(user, "rejectorUser");

const CommandPaletteJobSearchQuerySchema = z.object({
  query: z.string().trim().min(2),
  limit: z.coerce.number().min(1).max(10).default(5),
});

async function resolveJobRouteId(
  identifier: string,
  memberData: AuthVariables["member"],
): Promise<number | null> {
  const routeIdentifier = decodeRouteIdentifier(identifier);
  const legacyId = parseLegacyNumericIdentifier(routeIdentifier);

  const [job] = await db
    .select({ id: calibrationJob.id })
    .from(calibrationJob)
    .where(
      and(
        legacyId
          ? or(
              eq(calibrationJob.id, legacyId),
              eq(calibrationJob.jobId, routeIdentifier),
            )
          : eq(calibrationJob.jobId, routeIdentifier),
        eq(calibrationJob.organizationId, memberData.organizationId),
        buildUnitScopeCondition(calibrationJob.unitId, memberData),
      ),
    )
    .limit(1);

  return job?.id ?? null;
}

function buildCalibrationLocationSnapshot(
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

function validateCalibrationLocationForSubmit(
  snapshot: CalibrationLocationSnapshot | null | undefined,
): string | null {
  if (!snapshot) return "Local da calibração é obrigatório";
  if (!["customer_site", "lab", "other"].includes(snapshot.type)) {
    return "Tipo de local da calibração é inválido";
  }
  if (!snapshot.addressText.trim()) {
    return "Endereço/local da calibração é obrigatório";
  }
  return null;
}

function buildCalibrationPhaseSnapshot(
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

function validateCalibrationPhasesForSubmit(
  snapshot: CalibrationPhaseSnapshot | null | undefined,
): string | null {
  for (const [blockKey, block] of Object.entries(snapshot?.blocks ?? {})) {
    if (block.mode !== "not_performed") continue;
    if (!block.reason?.trim()) {
      return `Informe o motivo para não executar o bloco ${blockKey}`;
    }
  }
  return null;
}

function createMethodExecutionEngine(): CalculationEngineLike {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- math-engine exposes a narrower concrete type than the method-definition execution adapter.
  return createCalculationEngine(
    METHOD_ENGINE_OPTIONS,
  ) as unknown as CalculationEngineLike;
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

function jobExecutionDiagnostic(
  code: string,
  message: string,
  path: string,
): MethodDiagnostic {
  return {
    code,
    severity: "error",
    message,
    path,
  };
}

function getCompiledMethodSnapshot(
  methodSnapshot: MethodSnapshot | null | undefined,
):
  | { ok: true; compiledMethod: CompiledMethod }
  | { ok: false; diagnostics: MethodDiagnostic[]; message: string } {
  const compiledMethod = methodSnapshot?.compiledMethod;
  if (
    !methodSnapshot ||
    !compiledMethod ||
    typeof compiledMethod !== "object" ||
    !methodSnapshot.methodFingerprint ||
    !methodSnapshot.engineVersion ||
    !methodSnapshot.engineOptionsFingerprint ||
    !methodSnapshot.normalizedMethodJson
  ) {
    const message =
      "Snapshot compilado do método é obrigatório para execução regulada";
    return {
      ok: false,
      message,
      diagnostics: [
        jobExecutionDiagnostic(
          "COMPILED_METHOD_SNAPSHOT_REQUIRED",
          message,
          "methodSnapshot.compiledMethod",
        ),
      ],
    };
  }

  if (!isCompiledMethod(compiledMethod)) {
    const message = "Snapshot compilado do método possui formato inválido";
    return {
      ok: false,
      message,
      diagnostics: [
        jobExecutionDiagnostic(
          "COMPILED_METHOD_SNAPSHOT_INVALID",
          message,
          "methodSnapshot.compiledMethod",
        ),
      ],
    };
  }

  const candidate = compiledMethod;
  const mismatches: MethodDiagnostic[] = [];
  if (candidate.methodFingerprint !== methodSnapshot.methodFingerprint) {
    mismatches.push(
      jobExecutionDiagnostic(
        "COMPILED_METHOD_SNAPSHOT_MISMATCH",
        "Fingerprint do método compilado diverge do snapshot do job",
        "methodSnapshot.methodFingerprint",
      ),
    );
  }
  if (candidate.engine?.version !== methodSnapshot.engineVersion) {
    mismatches.push(
      jobExecutionDiagnostic(
        "COMPILED_METHOD_SNAPSHOT_MISMATCH",
        "Versão do engine compilado diverge do snapshot do job",
        "methodSnapshot.engineVersion",
      ),
    );
  }
  if (
    candidate.engine?.optionsFingerprint !==
    methodSnapshot.engineOptionsFingerprint
  ) {
    mismatches.push(
      jobExecutionDiagnostic(
        "COMPILED_METHOD_SNAPSHOT_MISMATCH",
        "Fingerprint das opções do engine diverge do snapshot do job",
        "methodSnapshot.engineOptionsFingerprint",
      ),
    );
  }
  if (candidate.normalizedMethodJson !== methodSnapshot.normalizedMethodJson) {
    mismatches.push(
      jobExecutionDiagnostic(
        "COMPILED_METHOD_SNAPSHOT_MISMATCH",
        "JSON normalizado do método compilado diverge do snapshot do job",
        "methodSnapshot.normalizedMethodJson",
      ),
    );
  }
  if (mismatches.length > 0) {
    return {
      ok: false,
      message: "Snapshot compilado do método diverge dos metadados do job",
      diagnostics: mismatches,
    };
  }

  return { ok: true, compiledMethod };
}

function buildOfficialExecutionInputs(params: {
  methodSnapshot: MethodSnapshot;
  data: Record<string, unknown>;
  assetSnapshot: AssetSnapshot;
  standardsSnapshot: StandardSnapshot[] | null | undefined;
  environmentalSnapshot: EnvironmentalSnapshot | null | undefined;
}): Record<string, unknown> {
  const inputs: Record<string, unknown> = { ...params.data };

  for (const field of params.methodSnapshot.dataFields ?? []) {
    if (field.source !== "asset_spec" || !field.assetSpecKey) continue;
    const value = params.assetSnapshot.specifications?.[field.assetSpecKey];
    if (value !== undefined) {
      inputs[field.key] = value;
    }
  }

  if (params.environmentalSnapshot) {
    inputs.environment = {
      temperature: params.environmentalSnapshot.temperature,
      humidity: params.environmentalSnapshot.humidity,
      pressure: params.environmentalSnapshot.pressure,
    };
  }

  if (params.standardsSnapshot !== undefined) {
    inputs.standards =
      normalizeStandardsForOfficialExecution(params.standardsSnapshot) ?? [];
  }

  return inputs;
}

function executeOfficialCompiledSnapshot(params: {
  methodSnapshot: MethodSnapshot;
  data: Record<string, unknown>;
  assetSnapshot: AssetSnapshot;
  standardsSnapshot: StandardSnapshot[] | null | undefined;
  environmentalSnapshot: EnvironmentalSnapshot | null | undefined;
  calibrationPhaseSnapshot: CalibrationPhaseSnapshot | null | undefined;
  requireSuccess?: boolean;
}):
  | { ok: true; results: Record<string, unknown>; execution: null }
  | {
      ok: true;
      results: Record<string, unknown>;
      execution: CompiledMethodExecutionResult;
    }
  | { ok: false; diagnostics: MethodDiagnostic[]; message: string } {
  const snapshot = getCompiledMethodSnapshot(params.methodSnapshot);
  if (!snapshot.ok) {
    return snapshot;
  }

  const execution = executeCompiledMethod(
    snapshot.compiledMethod,
    {
      inputs: buildOfficialExecutionInputs(params),
      calibrationPhases: params.calibrationPhaseSnapshot ?? undefined,
    },
    { engine: createMethodExecutionEngine() },
  );

  if (!execution.ok && params.requireSuccess !== false) {
    return {
      ok: false,
      diagnostics: execution.diagnostics,
      message:
        execution.diagnostics.find((item) => item.severity === "error")
          ?.message ?? "Execução oficial do método compilado falhou",
    };
  }

  return {
    ok: true,
    results: {
      ...execution.outputs,
      __compiledExecution: {
        methodFingerprint: execution.methodFingerprint,
        engineVersion: execution.engineVersion,
        engineOptionsFingerprint: execution.engineOptionsFingerprint,
        inputFingerprint: execution.inputFingerprint,
        calculationFingerprint: execution.calculationFingerprint,
        resultFingerprint: execution.resultFingerprint,
        canonicalResultJson: execution.canonicalResultJson,
        formulaResults: execution.formulaResults,
        measurementModelResults: execution.measurementModelResults,
        acceptanceCriteriaResults: execution.acceptanceCriteriaResults,
        diagnostics: execution.diagnostics,
      },
    },
    execution,
  };
}

async function buildAssetSnapshot(
  assetId: number,
): Promise<
  | { ok: true; snapshot: AssetSnapshot; assetTypeDefinition: unknown }
  | { ok: false; error: string }
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
      assetTypeDefinition: assetType.definition,
    })
    .from(asset)
    .innerJoin(assetType, eq(asset.assetTypeId, assetType.id))
    .where(eq(asset.id, assetId))
    .limit(1);

  if (!row) {
    return { ok: false, error: "Ativo nao encontrado" };
  }

  return {
    ok: true,
    assetTypeDefinition: row.assetTypeDefinition,
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

async function ensureEditableJobAssetSnapshot(existing: {
  id: number;
  assetId: number;
  assetSnapshot: AssetSnapshot | null;
  methodSnapshot: MethodSnapshot;
}) {
  if (existing.assetSnapshot) {
    const missing = findMissingRequiredAssetSpecs(
      existing.methodSnapshot,
      existing.assetSnapshot,
    );
    if (missing.length > 0) {
      return {
        ok: false as const,
        error: `O ativo não possui a especificação obrigatória "${missing[0]?.label}". Atualize o cadastro do ativo antes de executar a calibração.`,
      };
    }

    return { ok: true as const, snapshot: existing.assetSnapshot };
  }

  const result = await buildAssetSnapshot(existing.assetId);
  if (!result.ok) {
    return result;
  }

  const missing = findMissingRequiredAssetSpecs(
    existing.methodSnapshot,
    result.snapshot,
  );
  if (missing.length > 0) {
    return {
      ok: false as const,
      error: `O ativo não possui a especificação obrigatória "${missing[0]?.label}". Atualize o cadastro do ativo antes de executar a calibração.`,
    };
  }

  await db
    .update(calibrationJob)
    .set({ assetSnapshot: result.snapshot })
    .where(eq(calibrationJob.id, existing.id));

  return { ok: true as const, snapshot: result.snapshot };
}

async function buildStandardsSnapshot(
  selectedStandardIds: number[] | undefined,
  organizationId: string,
  unitId: number,
): Promise<
  | { ok: true; snapshot: StandardSnapshot[] | null | undefined }
  | { ok: false; error: string }
> {
  if (selectedStandardIds === undefined) {
    return { ok: true, snapshot: undefined };
  }

  if (selectedStandardIds.length === 0) {
    return { ok: true, snapshot: null };
  }

  const standards = await db
    .select()
    .from(referenceStandard)
    .where(
      and(
        inArray(referenceStandard.id, selectedStandardIds),
        eq(referenceStandard.organizationId, organizationId),
        eq(referenceStandard.unitId, unitId),
      ),
    );

  if (standards.length !== selectedStandardIds.length) {
    const foundIds = new Set(standards.map((s) => s.id));
    const missingIds = selectedStandardIds.filter((id) => !foundIds.has(id));
    return {
      ok: false,
      error: `Padroes nao encontrados ou nao pertencem a organizacao: ${missingIds.join(", ")}`,
    };
  }

  const inactiveStandards = standards.filter((s) => s.status !== "ACTIVE");
  if (inactiveStandards.length > 0) {
    return {
      ok: false,
      error: `Os seguintes padroes nao estao ativos: ${inactiveStandards.map((s) => s.name).join(", ")}`,
    };
  }

  const now = new Date();
  const expiredStandards = standards.filter((s) => s.nextCalibrationDate < now);
  if (expiredStandards.length > 0) {
    return {
      ok: false,
      error: `Os seguintes padroes estao com certificado vencido: ${expiredStandards.map((s) => s.name).join(", ")}`,
    };
  }

  const standardsById = new Map(
    standards.map((standard) => [standard.id, standard]),
  );
  const orderedStandards = selectedStandardIds.map(
    (id) => standardsById.get(id)!,
  );

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

async function buildEnvironmentalSnapshot(
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
    .where(eq(asset.id, existing.assetId))
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

/**
 * Calibration Jobs Router - Work Orders (ISO 17025 Operational Layer)
 *
 * The Job is the most critical entity in the system. It connects:
 * Customer + Asset + Service + Method into a single record of work.
 *
 * Key Design Decision: Method Snapshotting
 * - When a job is created, the Method configuration is FROZEN into the job
 * - This ensures future changes to the Method do not affect historical jobs
 * - Critical for ISO 17025 compliance: reproduce calculations exactly as performed
 *
 * Permissions:
 * - GET /: calibration:read (all roles)
 * - GET /:id: calibration:read (all roles)
 * - POST /: calibration:create (LAB only - operator, technician, admin, owner)
 * - PUT /:id: calibration:update (LAB only)
 * - DELETE /:id: calibration:delete (LAB only) - sets status to CANCELED
 * - POST /:id/assign: calibration:assign_technician (LAB only)
 * - POST /:id/execute: calibration:execute (LAB only)
 * - POST /:id/submit: calibration:submit (LAB only)
 * - POST /:id/approve: calibration:approve (admin, owner only)
 * - POST /:id/reject: calibration:reject (admin, owner only)
 */
export const jobsRouter = new Hono<{
  Variables: AuthVariables;
  Bindings: IntegrationsEnv;
}>()
  // =========================================================================
  // GET /search - Lightweight search for command palette
  // =========================================================================
  .get(
    "/search",
    ...withLabPermission({ calibration: ["read"] }),
    zValidator("query", CommandPaletteJobSearchQuerySchema),
    async (c) => {
      const memberData = c.get("member");
      const { query, limit } = c.req.valid("query");

      try {
        const results = await db
          .select({
            id: calibrationJob.id,
            jobId: calibrationJob.jobId,
            status: calibrationJob.status,
          })
          .from(calibrationJob)
          .where(
            and(
              eq(calibrationJob.organizationId, memberData.organizationId),
              buildUnitScopeCondition(calibrationJob.unitId, memberData),
              or(
                ilike(calibrationJob.jobId, `%${query}%`),
                ilike(calibrationJob.certificateName, `%${query}%`),
              )!,
            ),
          )
          .orderBy(desc(calibrationJob.createdAt))
          .limit(limit);

        return c.json(results);
      } catch (error) {
        console.error("Error searching jobs:", error);
        return c.json({ error: "Erro ao buscar ordens de serviço" }, 500);
      }
    },
  )

  // =========================================================================
  // GET / - List jobs with pagination and filtering
  // =========================================================================
  .get(
    "/",
    ...withLabPermission({ calibration: ["read"] }),
    zValidator("query", ListJobsQuerySchema),
    async (c) => {
      const memberData = c.get("member");
      const {
        page,
        limit,
        query,
        status,
        customerId,
        assetId,
        serviceId,
        technicianId,
        dateFrom,
        dateTo,
        dueSoon,
        overdue,
      } = c.req.valid("query");
      const offset = (page - 1) * limit;

      // Build conditions - always scope to organization
      const conditions = [
        eq(calibrationJob.organizationId, memberData.organizationId),
        buildUnitScopeCondition(calibrationJob.unitId, memberData),
      ];

      if (query) {
        conditions.push(
          or(
            ilike(calibrationJob.jobId, `%${query}%`),
            ilike(calibrationJob.certificateName, `%${query}%`),
          )!,
        );
      }

      if (status) {
        conditions.push(eq(calibrationJob.status, status));
      }

      if (customerId) {
        conditions.push(eq(calibrationJob.customerId, customerId));
      }

      if (assetId) {
        conditions.push(eq(calibrationJob.assetId, assetId));
      }

      if (serviceId) {
        conditions.push(eq(calibrationJob.serviceId, serviceId));
      }

      if (technicianId) {
        conditions.push(eq(calibrationJob.technicianId, technicianId));
      }

      if (dateFrom) {
        conditions.push(gte(calibrationJob.createdAt, new Date(dateFrom)));
      }

      if (dateTo) {
        conditions.push(lte(calibrationJob.createdAt, new Date(dateTo)));
      }

      // Filter jobs due within 7 days
      if (dueSoon) {
        const now = new Date();
        const sevenDaysFromNow = new Date();
        sevenDaysFromNow.setDate(now.getDate() + 7);
        conditions.push(gte(calibrationJob.dueDate, now));
        conditions.push(lte(calibrationJob.dueDate, sevenDaysFromNow));
      }

      // Filter overdue jobs
      if (overdue) {
        const now = new Date();
        conditions.push(lte(calibrationJob.dueDate, now));
        conditions.push(
          inArray(calibrationJob.status, ["DRAFT", "IN_PROGRESS", "REVIEW"]),
        );
      }

      const whereCondition = and(...conditions);

      // Get total count
      const [countResult] = await db
        .select({ total: count() })
        .from(calibrationJob)
        .where(whereCondition);

      // Get paginated data with joins
      const jobs = await db
        .select({
          id: calibrationJob.id,
          jobId: calibrationJob.jobId,
          certificateName: calibrationJob.certificateName,
          status: calibrationJob.status,
          dueDate: calibrationJob.dueDate,
          performedAt: calibrationJob.performedAt,
          createdAt: calibrationJob.createdAt,
          updatedAt: calibrationJob.updatedAt,
          approvedAt: calibrationJob.approvedAt,
          // Related entities
          customerId: calibrationJob.customerId,
          customerName: customer.name,
          assetId: calibrationJob.assetId,
          assetName: asset.name,
          assetTag: asset.tag,
          serviceId: calibrationJob.serviceId,
          serviceName: service.name,
          technicianId: calibrationJob.technicianId,
          technicianName: user.name,
          // Method snapshot summary
          methodSnapshot: calibrationJob.methodSnapshot,
        })
        .from(calibrationJob)
        .leftJoin(customer, eq(calibrationJob.customerId, customer.id))
        .leftJoin(asset, eq(calibrationJob.assetId, asset.id))
        .leftJoin(service, eq(calibrationJob.serviceId, service.id))
        .leftJoin(user, eq(calibrationJob.technicianId, user.id))
        .where(whereCondition)
        .orderBy(desc(calibrationJob.createdAt))
        .limit(limit)
        .offset(offset);

      // Add computed fields
      const now = new Date();
      const financialContexts = await loadJobFinancialContexts(
        memberData.organizationId,
        jobs.map((job) => job.id),
      );
      const jobsWithComputedFields = jobs.map((job) => ({
        ...job,
        isOverdue:
          job.dueDate &&
          job.dueDate < now &&
          ["DRAFT", "IN_PROGRESS", "REVIEW"].includes(job.status),
        daysUntilDue: job.dueDate
          ? Math.ceil(
              (job.dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
            )
          : null,
        // Extract method name from snapshot for display
        methodName: methodSnapshotDisplay(job.methodSnapshot).methodName,
        methodVersion: methodSnapshotDisplay(job.methodSnapshot).methodVersion,
        ...financialContexts.get(job.id),
      }));

      return c.json({
        data: jobsWithComputedFields,
        pagination: {
          page,
          limit,
          total: countResult?.total ?? 0,
          totalPages: Math.ceil((countResult?.total ?? 0) / limit),
        },
      });
    },
  )

  // =========================================================================
  // GET /:id/label - Get job label by ID
  // =========================================================================
  .get(
    "/:id/label",
    ...withLabPermission({ calibration: ["read"] }),
    async (c) => {
      const memberData = c.get("member");
      const id = await resolveJobRouteId(c.req.param("id"), memberData);

      if (id === null) {
        return c.json({ error: "Job nao encontrado" }, 404);
      }

      const [job] = await db
        .select({
          id: calibrationJob.id,
          label: calibrationJob.jobId,
        })
        .from(calibrationJob)
        .where(
          and(
            eq(calibrationJob.id, id),
            eq(calibrationJob.organizationId, memberData.organizationId),
            buildUnitScopeCondition(calibrationJob.unitId, memberData),
          ),
        )
        .limit(1);

      if (!job) {
        return c.json({ error: "Job nao encontrado" }, 404);
      }

      const financialContextMap = await loadJobFinancialContexts(
        memberData.organizationId,
        [job.id],
      );

      return c.json({
        ...job,
        ...financialContextMap.get(job.id),
      });
    },
  )

  // =========================================================================
  // GET /:id - Get single job with full details
  // =========================================================================
  .get("/:id", ...withLabPermission({ calibration: ["read"] }), async (c) => {
    const memberData = c.get("member");
    const id = await resolveJobRouteId(c.req.param("id"), memberData);

    if (id === null) {
      return c.json({ error: "Job nao encontrado" }, 404);
    }

    const [job] = await db
      .select({
        id: calibrationJob.id,
        jobId: calibrationJob.jobId,
        certificateName: calibrationJob.certificateName,
        certificateNumberingSnapshot:
          calibrationJob.certificateNumberingSnapshot,
        organizationId: calibrationJob.organizationId,
        status: calibrationJob.status,
        dueDate: calibrationJob.dueDate,
        performedAt: calibrationJob.performedAt,
        data: calibrationJob.data,
        results: calibrationJob.results,
        standardsSnapshot: calibrationJob.standardsSnapshot,
        environmentalSnapshot: calibrationJob.environmentalSnapshot,
        calibrationLocationSnapshot: calibrationJob.calibrationLocationSnapshot,
        calibrationPhaseSnapshot: calibrationJob.calibrationPhaseSnapshot,
        scopeComplianceStatus: calibrationJob.scopeComplianceStatus,
        scopeComplianceFindings: calibrationJob.scopeComplianceFindings,
        assetSnapshot: calibrationJob.assetSnapshot,
        certificateUrl: calibrationJob.certificateUrl,
        labelUrl: calibrationJob.labelUrl,
        methodSnapshot: calibrationJob.methodSnapshot,
        createdAt: calibrationJob.createdAt,
        createdBy: calibrationJob.createdBy,
        updatedAt: calibrationJob.updatedAt,
        approvedBy: calibrationJob.approvedBy,
        approvedAt: calibrationJob.approvedAt,
        rejectedBy: calibrationJob.rejectedBy,
        rejectedAt: calibrationJob.rejectedAt,
        rejectionReason: calibrationJob.rejectionReason,
        // Amendment fields - ISO 17025 Clause 7.8.4.1
        supersedesId: calibrationJob.supersedesId,
        supersededById: calibrationJob.supersededById,
        amendmentNumber: calibrationJob.amendmentNumber,
        amendmentReason: calibrationJob.amendmentReason,
        supersededAt: calibrationJob.supersededAt,
        // Related entities
        customerId: calibrationJob.customerId,
        customerName: customer.name,
        customerTaxId: customer.taxId,
        customerAddress: customer.address,
        labName: organization.name,
        labStreet: organization.street,
        labNumber: organization.number,
        labComplement: organization.complement,
        labNeighbourhood: organization.neighbourhood,
        labCity: organization.city,
        labState: organization.state,
        labCep: organization.cep,
        assetId: calibrationJob.assetId,
        assetName: asset.name,
        assetTag: asset.tag,
        assetTypeId: asset.assetTypeId,
        assetSerialNumber: asset.serialNumber,
        assetManufacturer: asset.manufacturer,
        assetModel: asset.model,
        assetBaseMeasurementUnit: asset.baseMeasurementUnit,
        assetSpecifications: asset.specifications,
        assetTypeName: assetType.name,
        assetTypeSlug: assetType.slug,
        assetTypeDefinition: assetType.definition,
        serviceId: calibrationJob.serviceId,
        serviceName: service.name,
        servicePrice: service.price,
        serviceTat: service.tat,
        technicianId: calibrationJob.technicianId,
        technicianName: user.name,
        approverName: approverUser.name,
        rejectorName: rejectorUser.name,
      })
      .from(calibrationJob)
      .leftJoin(customer, eq(calibrationJob.customerId, customer.id))
      .leftJoin(
        organization,
        eq(calibrationJob.organizationId, organization.id),
      )
      .leftJoin(asset, eq(calibrationJob.assetId, asset.id))
      .leftJoin(assetType, eq(asset.assetTypeId, assetType.id))
      .leftJoin(service, eq(calibrationJob.serviceId, service.id))
      .leftJoin(user, eq(calibrationJob.technicianId, user.id))
      .leftJoin(approverUser, eq(calibrationJob.approvedBy, approverUser.id))
      .leftJoin(rejectorUser, eq(calibrationJob.rejectedBy, rejectorUser.id))
      .where(
        and(
          eq(calibrationJob.id, id),
          eq(calibrationJob.organizationId, memberData.organizationId),
          buildUnitScopeCondition(calibrationJob.unitId, memberData),
        ),
      )
      .limit(1);

    if (!job) {
      return c.json({ error: "Job nao encontrado" }, 404);
    }

    const financialContextMap = await loadJobFinancialContexts(
      memberData.organizationId,
      [job.id],
    );
    const derivedAssetSnapshot =
      job.assetSnapshot ??
      (["DRAFT", "IN_PROGRESS", "REVIEW", "REJECTED"].includes(job.status)
        ? ({
            assetId: job.assetId,
            assetTypeId: job.assetTypeId ?? 0,
            assetTypeName: job.assetTypeName ?? "",
            assetTypeSlug: job.assetTypeSlug ?? "",
            baseMeasurementUnit: job.assetBaseMeasurementUnit ?? null,
            name: job.assetName ?? "",
            tag: job.assetTag ?? "",
            serialNumber: job.assetSerialNumber ?? "",
            manufacturer: job.assetManufacturer,
            model: job.assetModel,
            specifications: job.assetSpecifications,
            capturedAt: new Date().toISOString(),
          } satisfies AssetSnapshot)
        : null);

    // Add computed fields
    const now = new Date();
    const result = {
      ...job,
      assetSnapshot: derivedAssetSnapshot,
      isOverdue:
        job.dueDate &&
        job.dueDate < now &&
        ["DRAFT", "IN_PROGRESS", "REVIEW"].includes(job.status),
      daysUntilDue: job.dueDate
        ? Math.ceil(
            (job.dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
          )
        : null,
      ...financialContextMap.get(job.id),
    };

    return c.json(result);
  })

  // =========================================================================
  // POST / - Create new job (THE CRITICAL SNAPSHOT LOGIC)
  // =========================================================================
  .post(
    "/",
    ...withLabPermission({ calibration: ["create"] }),
    requirePlanLimit("certificates"), // Check plan limit before creating job
    zValidator("json", CreateJobSchema),
    async (c) => {
      const memberData = c.get("member");
      const session = c.get("session");
      const input = c.req.valid("json");

      const activeUnitId = memberData.activeUnitId;
      if (!activeUnitId) {
        return c.json(
          { error: "Selecione uma unidade específica para criar ordens" },
          400,
        );
      }

      try {
        const newJob = await db.transaction(async (tx) => {
          // The requirePlanLimit middleware above is a fast, non-transactional
          // pre-check (good UX, but two concurrent requests can both pass it
          // and both proceed to insert past the limit). Re-check the limit
          // here under an advisory lock, inside the SAME transaction as the
          // insert, closing that TOCTOU window (REQ-DOM-QTA-001) the same way
          // calibration-requests.ts's POST /:id/convert already does.
          await assertPlanLimitInTransaction(tx, {
            organizationId: memberData.organizationId,
            resource: "certificates",
          });

          return createCalibrationJob({
            organizationId: memberData.organizationId,
            unitId: activeUnitId,
            createdBy: session.user.id,
            assetId: input.assetId,
            serviceId: input.serviceId,
            technicianId: input.technicianId,
            dueDate: input.dueDate,
            // DOM-02 (#655): back-link to the repair OS this calibration came
            // from, when opened from the pending-after-repair flow. Org-scoped
            // in createCalibrationJob.
            sourceServiceOrderId: input.sourceServiceOrderId ?? null,
            ipAddress: c.req.header("x-forwarded-for") || null,
            executor: tx,
            // Defer the assignment notification until after commit (below) —
            // sending it from inside an open transaction that might still
            // roll back would notify a technician about a job that never
            // existed.
            notifyOnAssignment: false,
          });
        });

        if (newJob.technicianId) {
          try {
            await notifyJobAssigned(
              newJob.id,
              newJob.technicianId,
              session.user.id,
            );
          } catch (error) {
            console.error("Error sending job assignment notification:", error);
          }
        }

        return c.json(newJob, 201);
      } catch (error) {
        // A plan-limit or subscription-status re-check failure inside the
        // transaction throws HTTPException (same as the pre-check middleware
        // above) — let Hono handle it identically rather than mapping it to
        // the generic 500 below.
        if (error instanceof HTTPException) {
          throw error;
        }

        console.error("Error creating job:", error);
        const message =
          error instanceof Error ? error.message : "Erro ao criar job";

        if (
          message === "Ativo nao encontrado" ||
          message === "Servico nao encontrado"
        ) {
          return c.json({ error: message }, 404);
        }

        if (message === "Ativo nao pertence a esta organizacao") {
          return c.json({ error: message }, 403);
        }

        if (jobCreationClientErrors.has(message)) {
          return c.json({ error: message }, 400);
        }

        return c.json({ error: "Erro ao criar job" }, 500);
      }
    },
  )

  // =========================================================================
  // PUT /:id - Update job (technician, due date)
  // =========================================================================
  .put(
    "/:id",
    ...withLabPermission({ calibration: ["update"] }),
    zValidator("json", UpdateJobSchema),
    async (c) => {
      const memberData = c.get("member");
      const session = c.get("session");
      const id = await resolveJobRouteId(c.req.param("id"), memberData);
      const input = c.req.valid("json");

      if (id === null) {
        return c.json({ error: "Job nao encontrado" }, 404);
      }

      // Get existing job
      const [existing] = await db
        .select()
        .from(calibrationJob)
        .where(
          and(
            eq(calibrationJob.id, id),
            eq(calibrationJob.organizationId, memberData.organizationId),
            buildUnitScopeCondition(calibrationJob.unitId, memberData),
          ),
        )
        .limit(1);

      if (!existing) {
        return c.json({ error: "Job nao encontrado" }, 404);
      }

      // Cannot update approved or canceled jobs
      if (existing.status === "APPROVED" || existing.status === "CANCELED") {
        return c.json(
          {
            error: `Nao e possivel atualizar um job com status ${existing.status}`,
          },
          400,
        );
      }

      // Build changes object for audit log
      const changes: Record<string, { old: unknown; new: unknown }> = {};
      const updateData: Record<string, unknown> = {};

      if (
        input.technicianId !== undefined &&
        input.technicianId !== existing.technicianId
      ) {
        // Validate technician
        if (input.technicianId) {
          const [techMember] = await db
            .select()
            .from(member)
            .where(
              and(
                eq(member.userId, input.technicianId),
                eq(member.organizationId, memberData.organizationId),
                inArray(member.role, ["technician", "admin", "owner"]),
              ),
            )
            .limit(1);

          if (!techMember) {
            return c.json(
              { error: "Tecnico nao encontrado ou sem permissao" },
              400,
            );
          }

          if (
            existing.unitId &&
            !["admin", "owner"].includes(techMember.role)
          ) {
            const [assignment] = await db
              .select({ id: memberUnitAssignment.id })
              .from(memberUnitAssignment)
              .where(
                and(
                  eq(memberUnitAssignment.memberId, techMember.id),
                  eq(
                    memberUnitAssignment.organizationId,
                    memberData.organizationId,
                  ),
                  eq(memberUnitAssignment.unitId, existing.unitId),
                  inArray(memberUnitAssignment.role, [
                    "technician",
                    "unit_admin",
                  ]),
                ),
              )
              .limit(1);

            if (!assignment) {
              return c.json(
                { error: "Tecnico nao encontrado ou sem permissao" },
                400,
              );
            }
          }
        }

        changes.technicianId = {
          old: existing.technicianId,
          new: input.technicianId,
        };
        updateData.technicianId = input.technicianId;
      }

      if (input.dueDate !== undefined) {
        const newDueDate = input.dueDate ? new Date(input.dueDate) : null;
        const oldDueDate = existing.dueDate;
        if (newDueDate?.getTime() !== oldDueDate?.getTime()) {
          changes.dueDate = {
            old: oldDueDate?.toISOString() || null,
            new: newDueDate?.toISOString() || null,
          };
          updateData.dueDate = newDueDate;
        }
      }

      if (Object.keys(updateData).length === 0) {
        return c.json(existing);
      }

      // Update job
      const [updated] = await db
        .update(calibrationJob)
        .set(updateData)
        .where(eq(calibrationJob.id, id))
        .returning();

      // Audit log
      await db.insert(jobAuditLog).values({
        jobId: id,
        action: "update",
        changes,
        performedBy: session.user.id,
        ipAddress: c.req.header("x-forwarded-for") || null,
      });

      // Notify technician if changed
      if (changes.technicianId && input.technicianId) {
        try {
          await notifyJobAssigned(id, input.technicianId, session.user.id);
        } catch (err) {
          console.error("[Jobs] Failed to send assignment notification:", err);
        }
      }

      return c.json(updated);
    },
  )

  // =========================================================================
  // POST /:id/assign - Assign technician to job
  // =========================================================================
  .post(
    "/:id/assign",
    ...withLabPermission({ calibration: ["assign_technician"] }),
    zValidator("json", AssignTechnicianSchema),
    async (c) => {
      const memberData = c.get("member");
      const session = c.get("session");
      const id = await resolveJobRouteId(c.req.param("id"), memberData);
      const input = c.req.valid("json");

      if (id === null) {
        return c.json({ error: "Job nao encontrado" }, 404);
      }

      // Get existing job
      const [existing] = await db
        .select()
        .from(calibrationJob)
        .where(
          and(
            eq(calibrationJob.id, id),
            eq(calibrationJob.organizationId, memberData.organizationId),
            buildUnitScopeCondition(calibrationJob.unitId, memberData),
          ),
        )
        .limit(1);

      if (!existing) {
        return c.json({ error: "Job nao encontrado" }, 404);
      }

      // Validate technician
      const [techMember] = await db
        .select({
          id: member.id,
          userId: member.userId,
          userName: user.name,
          role: member.role,
        })
        .from(member)
        .innerJoin(user, eq(member.userId, user.id))
        .where(
          and(
            eq(member.userId, input.technicianId),
            eq(member.organizationId, memberData.organizationId),
          ),
        )
        .limit(1);

      if (!techMember) {
        return c.json(
          { error: "Tecnico nao encontrado ou sem permissao" },
          400,
        );
      }

      if (existing.unitId) {
        const [assignment] =
          techMember.role === "admin" || techMember.role === "owner"
            ? [{ id: 1 }]
            : await db
                .select({ id: memberUnitAssignment.id })
                .from(memberUnitAssignment)
                .where(
                  and(
                    eq(memberUnitAssignment.memberId, techMember.id),
                    eq(
                      memberUnitAssignment.organizationId,
                      memberData.organizationId,
                    ),
                    eq(memberUnitAssignment.unitId, existing.unitId),
                    inArray(memberUnitAssignment.role, [
                      "technician",
                      "unit_admin",
                    ]),
                  ),
                )
                .limit(1);

        if (!assignment) {
          return c.json(
            { error: "Tecnico nao encontrado ou sem permissao" },
            400,
          );
        }
      }

      // Validate competence (auto-detect enforcement)
      // Get asset type from the job's service
      const [jobService] = await db
        .select({ assetTypeId: service.assetTypeId })
        .from(service)
        .where(eq(service.id, existing.serviceId))
        .limit(1);

      if (jobService?.assetTypeId) {
        const [competenceCount] = await db
          .select({ total: count() })
          .from(personnelCompetence)
          .where(
            and(
              eq(personnelCompetence.organizationId, memberData.organizationId),
              isNull(personnelCompetence.deletedAt),
            ),
          );

        if ((competenceCount?.total ?? 0) > 0) {
          const [activeCompetence] = await db
            .select({
              id: personnelCompetence.id,
              expiresAt: personnelCompetence.expiresAt,
            })
            .from(personnelCompetence)
            .where(
              and(
                eq(personnelCompetence.userId, input.technicianId),
                eq(
                  personnelCompetence.organizationId,
                  memberData.organizationId,
                ),
                eq(personnelCompetence.assetTypeId, jobService.assetTypeId),
                eq(personnelCompetence.status, "ACTIVE"),
                isNull(personnelCompetence.deletedAt),
              ),
            )
            .limit(1);

          if (
            !activeCompetence ||
            (activeCompetence.expiresAt &&
              activeCompetence.expiresAt < new Date())
          ) {
            return c.json(
              {
                error:
                  "Técnico não possui competência ativa para este tipo de instrumento",
              },
              400,
            );
          }
        }
      }

      // Update job
      const [updated] = await db
        .update(calibrationJob)
        .set({ technicianId: input.technicianId })
        .where(eq(calibrationJob.id, id))
        .returning();

      // Audit log
      await db.insert(jobAuditLog).values({
        jobId: id,
        action: "assign",
        changes: {
          technicianId: { old: existing.technicianId, new: input.technicianId },
          technicianName: { old: null, new: techMember.userName },
        },
        performedBy: session.user.id,
        ipAddress: c.req.header("x-forwarded-for") || null,
      });

      // Send notification to assigned technician
      try {
        await notifyJobAssigned(id, input.technicianId, session.user.id);
      } catch (err) {
        console.error("[Jobs] Failed to send assignment notification:", err);
      }

      return c.json({
        message: `Job atribuido a ${techMember.userName}`,
        data: updated,
      });
    },
  )

  // =========================================================================
  // POST /:id/submit - Submit job for review (transition from DRAFT/IN_PROGRESS to REVIEW)
  // =========================================================================
  .post(
    "/:id/submit",
    ...withLabPermission({ calibration: ["submit"] }),
    zValidator("json", SubmitForReviewSchema),
    async (c) => {
      const BACKDATE_REASON_THRESHOLD_DAYS = 7;
      const memberData = c.get("member");
      const session = c.get("session");
      const id = await resolveJobRouteId(c.req.param("id"), memberData);
      const input = c.req.valid("json");

      if (id === null) {
        return c.json({ error: "Job nao encontrado" }, 404);
      }

      // Get existing job
      const [existing] = await db
        .select()
        .from(calibrationJob)
        .where(
          and(
            eq(calibrationJob.id, id),
            eq(calibrationJob.organizationId, memberData.organizationId),
            buildUnitScopeCondition(calibrationJob.unitId, memberData),
          ),
        )
        .limit(1);

      if (!existing) {
        return c.json({ error: "Job nao encontrado" }, 404);
      }

      // Can only submit from DRAFT, IN_PROGRESS, or REJECTED
      if (!["DRAFT", "IN_PROGRESS", "REJECTED"].includes(existing.status)) {
        return c.json(
          {
            error: `Nao e possivel submeter um job com status ${existing.status}`,
          },
          400,
        );
      }

      const assetSnapshotResult = await ensureEditableJobAssetSnapshot({
        id: existing.id,
        assetId: existing.assetId,
        assetSnapshot: existing.assetSnapshot,
        methodSnapshot: existing.methodSnapshot,
      });
      if (!assetSnapshotResult.ok) {
        return c.json({ error: assetSnapshotResult.error }, 400);
      }

      const standardsResult = await buildStandardsSnapshot(
        input.selectedStandardIds,
        memberData.organizationId,
        existing.unitId,
      );
      if (!standardsResult.ok) {
        return c.json({ error: standardsResult.error }, 400);
      }

      const environmentalSnapshot = await buildEnvironmentalSnapshot(
        input.environment,
        existing,
        memberData.organizationId,
        session.user.id,
      );

      const normalizedData = normalizeMethodDataForStorage(
        input.data,
        methodInputFieldsFromSnapshot(existing.methodSnapshot),
        assetSnapshotResult.snapshot.baseMeasurementUnit ?? null,
      );

      const nextStandardsSnapshot =
        standardsResult.snapshot === undefined
          ? existing.standardsSnapshot
          : standardsResult.snapshot;
      const nextEnvironmentalSnapshot =
        environmentalSnapshot ?? existing.environmentalSnapshot;
      const nextCalibrationLocationSnapshot = buildCalibrationLocationSnapshot(
        input.calibrationLocation,
        existing.calibrationLocationSnapshot,
        session.user.id,
      );
      const nextCalibrationPhaseSnapshot = buildCalibrationPhaseSnapshot(
        input.calibrationPhases,
        existing.calibrationPhaseSnapshot,
        session.user.id,
      );
      const calibrationLocationError = validateCalibrationLocationForSubmit(
        nextCalibrationLocationSnapshot,
      );
      if (calibrationLocationError) {
        return c.json({ error: calibrationLocationError }, 400);
      }
      const calibrationPhaseError = validateCalibrationPhasesForSubmit(
        nextCalibrationPhaseSnapshot,
      );
      if (calibrationPhaseError) {
        return c.json({ error: calibrationPhaseError }, 400);
      }
      const nextAssetSnapshot = assetSnapshotResult.snapshot;
      const nextData = stripAssetSpecData(
        normalizedData.data,
        existing.methodSnapshot,
      );
      const performedAt = input.performedAt
        ? new Date(input.performedAt)
        : new Date();
      if (Number.isNaN(performedAt.getTime())) {
        return c.json({ error: "Data de execução inválida" }, 400);
      }
      const now = new Date();
      if (performedAt.getTime() > now.getTime()) {
        return c.json(
          { error: "A data de execução não pode estar no futuro" },
          400,
        );
      }
      const diffMs = now.getTime() - performedAt.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      const normalizedBackdateReason = input.backdateReason?.trim();
      if (
        diffDays > BACKDATE_REASON_THRESHOLD_DAYS &&
        !normalizedBackdateReason
      ) {
        return c.json(
          {
            error: `Motivo obrigatório para lançamentos com mais de ${BACKDATE_REASON_THRESHOLD_DAYS} dias`,
          },
          400,
        );
      }
      const executionData = normalizedData.data ?? {};
      const officialExecution = executeOfficialCompiledSnapshot({
        methodSnapshot: existing.methodSnapshot,
        data: executionData,
        assetSnapshot: nextAssetSnapshot,
        standardsSnapshot: nextStandardsSnapshot,
        environmentalSnapshot: nextEnvironmentalSnapshot,
        calibrationPhaseSnapshot: nextCalibrationPhaseSnapshot,
        requireSuccess: true,
      });
      if (!officialExecution.ok) {
        return c.json(
          {
            error: officialExecution.message,
            diagnostics: officialExecution.diagnostics,
          },
          422,
        );
      }
      const nextResults = officialExecution.execution
        ? officialExecution.results
        : (input.results ?? existing.results);

      // Accredited-scope (CMC) guard — ISO/IEC 17025 §7.6/§7.8.3, ILAC P14
      // (#427 Phase 0). Classified here so the technician and the signer see
      // the warning during review; approval re-classifies at the emission
      // date and is authoritative. Warn-only: never blocks the submit.
      const scopeCompliance = await classifyJobScopeCompliance({
        organizationId: memberData.organizationId,
        unitId: existing.unitId,
        methodSnapshot: existing.methodSnapshot,
        assetSnapshot: nextAssetSnapshot,
        data: nextData ?? null,
        results: nextResults ?? null,
        // `now`, not performedAt: predicts the seal decision approval will
        // make at the emission date (backdated executions stay comparable).
        atDate: now,
      });

      // Update job with execution data and set status to REVIEW
      const [updated] = await db
        .update(calibrationJob)
        .set({
          data: nextData,
          results: nextResults,
          scopeComplianceStatus: scopeCompliance?.status ?? null,
          scopeComplianceFindings: scopeCompliance?.findings ?? null,
          assetSnapshot: nextAssetSnapshot,
          standardsSnapshot: nextStandardsSnapshot,
          environmentalSnapshot: nextEnvironmentalSnapshot,
          calibrationLocationSnapshot: nextCalibrationLocationSnapshot,
          calibrationPhaseSnapshot: nextCalibrationPhaseSnapshot,
          status: "REVIEW",
          performedAt,
        })
        .where(eq(calibrationJob.id, id))
        .returning();

      // Reverse traceability (#426 Phase 1): mirror the frozen snapshot into
      // the indexed job_standard projection.
      await syncJobStandardLinks(id, nextStandardsSnapshot, performedAt);

      // Audit log
      await db.insert(jobAuditLog).values({
        jobId: id,
        action: "submit",
        changes: {
          status: { old: existing.status, new: "REVIEW" },
          data: { old: existing.data, new: nextData },
          results: { old: existing.results, new: nextResults },
          officialExecution: officialExecution.execution
            ? {
                methodFingerprint:
                  officialExecution.execution.methodFingerprint,
                inputFingerprint: officialExecution.execution.inputFingerprint,
                calculationFingerprint:
                  officialExecution.execution.calculationFingerprint,
                resultFingerprint:
                  officialExecution.execution.resultFingerprint,
              }
            : undefined,
          standardsSnapshot:
            standardsResult.snapshot !== undefined
              ? {
                  old: existing.standardsSnapshot,
                  new: standardsResult.snapshot,
                }
              : undefined,
          environmentalSnapshot: environmentalSnapshot
            ? {
                old: existing.environmentalSnapshot,
                new: environmentalSnapshot,
              }
            : undefined,
          calibrationLocationSnapshot: input.calibrationLocation
            ? {
                old: existing.calibrationLocationSnapshot,
                new: nextCalibrationLocationSnapshot,
              }
            : undefined,
          calibrationPhaseSnapshot: input.calibrationPhases
            ? {
                old: existing.calibrationPhaseSnapshot,
                new: nextCalibrationPhaseSnapshot,
              }
            : undefined,
          unitConversions:
            normalizedData.conversions.length > 0
              ? normalizedData.conversions
              : undefined,
          assetSnapshot: existing.assetSnapshot
            ? undefined
            : { old: null, new: nextAssetSnapshot },
        },
        performedBy: session.user.id,
        ipAddress: c.req.header("x-forwarded-for") || null,
        reason:
          [
            nextEnvironmentalSnapshot && !nextEnvironmentalSnapshot.withinLimits
              ? "Submetido com condições ambientais fora dos limites"
              : null,
            scopeCompliance?.status === "OUT_OF_SCOPE"
              ? "Submetido com ponto fora do escopo acreditado (CMC)"
              : scopeCompliance?.status === "U_BELOW_CMC"
                ? "Submetido com incerteza menor que a CMC acreditada"
                : null,
            diffDays > BACKDATE_REASON_THRESHOLD_DAYS
              ? `Registro retroativo (${diffDays} dias): ${normalizedBackdateReason}`
              : null,
          ]
            .filter(Boolean)
            .join(" | ") || undefined,
      });

      // Send notifications to admins/owners (fire and forget)
      notifyJobSubmittedForReview(id, session.user.id).catch((err) => {
        console.error("[Jobs] Failed to send submit notification:", err);
      });

      return c.json({
        message: "Job submetido para revisao",
        data: updated,
      });
    },
  )

  // =========================================================================
  // POST /:id/execute - Save execution data (worksheet auto-save / manual save)
  // =========================================================================
  .post(
    "/:id/execute",
    ...withLabPermission({ calibration: ["execute"] }),
    zValidator("json", ExecuteJobSchema),
    async (c) => {
      const memberData = c.get("member");
      const session = c.get("session");
      const id = await resolveJobRouteId(c.req.param("id"), memberData);
      const input = c.req.valid("json");

      if (id === null) {
        return c.json({ error: "Job nao encontrado" }, 404);
      }

      // Get existing job
      const [existing] = await db
        .select()
        .from(calibrationJob)
        .where(
          and(
            eq(calibrationJob.id, id),
            eq(calibrationJob.organizationId, memberData.organizationId),
            buildUnitScopeCondition(calibrationJob.unitId, memberData),
          ),
        )
        .limit(1);

      if (!existing) {
        return c.json({ error: "Job nao encontrado" }, 404);
      }

      // Can only execute from DRAFT, IN_PROGRESS, or REJECTED
      if (!["DRAFT", "IN_PROGRESS", "REJECTED"].includes(existing.status)) {
        return c.json(
          {
            error: `Nao e possivel executar um job com status ${existing.status}`,
          },
          400,
        );
      }

      const assetSnapshotResult = await ensureEditableJobAssetSnapshot({
        id: existing.id,
        assetId: existing.assetId,
        assetSnapshot: existing.assetSnapshot,
        methodSnapshot: existing.methodSnapshot,
      });
      if (!assetSnapshotResult.ok) {
        return c.json({ error: assetSnapshotResult.error }, 400);
      }

      const standardsResult = await buildStandardsSnapshot(
        input.selectedStandardIds,
        memberData.organizationId,
        existing.unitId,
      );
      if (!standardsResult.ok) {
        return c.json({ error: standardsResult.error }, 400);
      }

      const environmentalSnapshot = await buildEnvironmentalSnapshot(
        input.environment,
        existing,
        memberData.organizationId,
        session.user.id,
      );

      const normalizedData = normalizeMethodDataForStorage(
        input.data,
        methodInputFieldsFromSnapshot(existing.methodSnapshot),
        assetSnapshotResult.snapshot.baseMeasurementUnit ?? null,
      );

      const nextStandardsSnapshot =
        standardsResult.snapshot === undefined
          ? existing.standardsSnapshot
          : standardsResult.snapshot;
      const nextEnvironmentalSnapshot =
        environmentalSnapshot ?? existing.environmentalSnapshot;
      const nextCalibrationLocationSnapshot = buildCalibrationLocationSnapshot(
        input.calibrationLocation,
        existing.calibrationLocationSnapshot,
        session.user.id,
      );
      const nextCalibrationPhaseSnapshot = buildCalibrationPhaseSnapshot(
        input.calibrationPhases,
        existing.calibrationPhaseSnapshot,
        session.user.id,
      );
      const nextAssetSnapshot = assetSnapshotResult.snapshot;
      const nextData = stripAssetSpecData(
        normalizedData.data,
        existing.methodSnapshot,
      );
      const executionData = normalizedData.data ?? {};
      const officialExecution = executeOfficialCompiledSnapshot({
        methodSnapshot: existing.methodSnapshot,
        data: executionData,
        assetSnapshot: nextAssetSnapshot,
        standardsSnapshot: nextStandardsSnapshot,
        environmentalSnapshot: nextEnvironmentalSnapshot,
        calibrationPhaseSnapshot: nextCalibrationPhaseSnapshot,
        requireSuccess: false,
      });
      if (!officialExecution.ok) {
        return c.json(
          {
            error: officialExecution.message,
            diagnostics: officialExecution.diagnostics,
          },
          422,
        );
      }
      const nextResults = officialExecution.execution
        ? officialExecution.results
        : (input.results ?? null);

      // Determine new status
      const newStatus =
        existing.status === "DRAFT" ? "IN_PROGRESS" : existing.status;

      // Persist the chosen execution date on draft saves so it survives a
      // reload. Only updated when a valid value is sent (never cleared here);
      // the strict not-future / backdate-reason gating happens on submit.
      const parsedPerformedAt = input.performedAt
        ? new Date(input.performedAt)
        : null;
      const nextPerformedAt =
        parsedPerformedAt && !Number.isNaN(parsedPerformedAt.getTime())
          ? parsedPerformedAt
          : null;

      // Update job with execution data
      const [updated] = await db
        .update(calibrationJob)
        .set({
          data: nextData,
          results: nextResults,
          assetSnapshot: nextAssetSnapshot,
          standardsSnapshot: nextStandardsSnapshot,
          environmentalSnapshot: nextEnvironmentalSnapshot,
          calibrationLocationSnapshot: nextCalibrationLocationSnapshot,
          calibrationPhaseSnapshot: nextCalibrationPhaseSnapshot,
          status: newStatus,
          ...(nextPerformedAt ? { performedAt: nextPerformedAt } : {}),
        })
        .where(eq(calibrationJob.id, id))
        .returning();

      // Reverse traceability (#426 Phase 1): mirror the frozen snapshot into
      // the indexed job_standard projection.
      await syncJobStandardLinks(id, nextStandardsSnapshot, nextPerformedAt);

      // Audit log
      await db.insert(jobAuditLog).values({
        jobId: id,
        action: "execute",
        changes: {
          status:
            existing.status !== newStatus
              ? { old: existing.status, new: newStatus }
              : undefined,
          data: { old: existing.data, new: nextData },
          results: { old: existing.results, new: nextResults },
          officialExecution: officialExecution.execution
            ? {
                methodFingerprint:
                  officialExecution.execution.methodFingerprint,
                inputFingerprint: officialExecution.execution.inputFingerprint,
                calculationFingerprint:
                  officialExecution.execution.calculationFingerprint,
                resultFingerprint:
                  officialExecution.execution.resultFingerprint,
              }
            : undefined,
          standardsSnapshot:
            standardsResult.snapshot !== undefined
              ? {
                  old: existing.standardsSnapshot,
                  new: standardsResult.snapshot,
                }
              : undefined,
          environmentalSnapshot: environmentalSnapshot
            ? {
                old: existing.environmentalSnapshot,
                new: environmentalSnapshot,
              }
            : undefined,
          calibrationLocationSnapshot: input.calibrationLocation
            ? {
                old: existing.calibrationLocationSnapshot,
                new: nextCalibrationLocationSnapshot,
              }
            : undefined,
          calibrationPhaseSnapshot: input.calibrationPhases
            ? {
                old: existing.calibrationPhaseSnapshot,
                new: nextCalibrationPhaseSnapshot,
              }
            : undefined,
          unitConversions:
            normalizedData.conversions.length > 0
              ? normalizedData.conversions
              : undefined,
          assetSnapshot: existing.assetSnapshot
            ? undefined
            : { old: null, new: nextAssetSnapshot },
        },
        performedBy: session.user.id,
        ipAddress: c.req.header("x-forwarded-for") || null,
      });

      // On-site visits roll forward to IN_PROGRESS once any of their jobs starts.
      if (existing.status === "DRAFT" && updated?.visitId) {
        try {
          await syncVisitStatusFromJobs(updated.visitId);
        } catch (error) {
          console.error("[Jobs] Failed to sync visit status:", error);
        }
      }

      return c.json({
        message: "Dados salvos com sucesso",
        data: updated,
      });
    },
  )

  // =========================================================================
  // POST /:id/approve - Approve job (manager only)
  // Enqueues certificate generation instead of directly approving
  // =========================================================================
  .post(
    "/:id/approve",
    ...withLabPermission({ calibration: ["approve"] }),
    zValidator("json", ApproveJobSchema),
    async (c) => {
      const memberData = c.get("member");
      const session = c.get("session");
      const id = await resolveJobRouteId(c.req.param("id"), memberData);
      const input = c.req.valid("json");

      if (id === null) {
        return c.json({ error: "Job nao encontrado" }, 404);
      }

      const result = await approveJob({
        jobId: id,
        member: memberData,
        approverId: session.user.id,
        values: input,
        metadata: { ipAddress: c.req.header("x-forwarded-for") || null },
        sendServiceOrdersToFinance: (params) =>
          sendServiceOrdersToFinance({
            ...params,
            scope: memberData,
            env: c.env,
          }),
      });

      switch (result.status) {
        case "not_found":
          return c.json({ error: "Job nao encontrado" }, 404);
        case "invalid_status":
          return c.json(
            {
              error: `Nao e possivel aprovar um job com status ${result.currentStatus}. O job deve estar em REVIEW.`,
            },
            400,
          );
        case "self_approval_blocked":
          return c.json(
            {
              error:
                "Separação de responsabilidades (ISO/IEC 17025): quem executou ou criou a calibração não pode aprová-la. Solicite a aprovação a outro membro autorizado.",
              code: "SELF_APPROVAL_BLOCKED",
            },
            403,
          );
        case "not_authorized_signatory":
          return c.json(
            {
              error:
                "O aprovador não é um signatário autorizado para este tipo de instrumento (ISO/IEC 17025 §6.2.6). A liberação do certificado deve ser feita por um signatário autorizado.",
              code: "APPROVER_NOT_AUTHORIZED_SIGNATORY",
            },
            403,
          );
        case "environmental_justification_required":
          return c.json(
            {
              error:
                "Condições ambientais fora dos limites. Forneça uma justificativa para aprovar.",
              environmentalSnapshot: result.environmentalSnapshot,
            },
            400,
          );
        case "approved":
          return c.json({
            message: "Gerando certificado...",
            data: result.job,
          });
      }
    },
  )

  // =========================================================================
  // POST /:id/reject - Reject job (manager only)
  // =========================================================================
  .post(
    "/:id/reject",
    ...withLabPermission({ calibration: ["reject"] }),
    zValidator("json", RejectJobSchema),
    async (c) => {
      const memberData = c.get("member");
      const session = c.get("session");
      const id = await resolveJobRouteId(c.req.param("id"), memberData);
      const input = c.req.valid("json");

      if (id === null) {
        return c.json({ error: "Job nao encontrado" }, 404);
      }

      // Get existing job
      const [existing] = await db
        .select()
        .from(calibrationJob)
        .where(
          and(
            eq(calibrationJob.id, id),
            eq(calibrationJob.organizationId, memberData.organizationId),
            buildUnitScopeCondition(calibrationJob.unitId, memberData),
          ),
        )
        .limit(1);

      if (!existing) {
        return c.json({ error: "Job nao encontrado" }, 404);
      }

      // Can only reject from REVIEW status
      if (existing.status !== "REVIEW") {
        return c.json(
          {
            error: `Nao e possivel rejeitar um job com status ${existing.status}. O job deve estar em REVIEW.`,
          },
          400,
        );
      }

      // Update job
      const [updated] = await db
        .update(calibrationJob)
        .set({
          status: "REJECTED",
          rejectedBy: session.user.id,
          rejectedAt: new Date(),
          rejectionReason: input.reason,
        })
        .where(eq(calibrationJob.id, id))
        .returning();

      // Audit log
      await db.insert(jobAuditLog).values({
        jobId: id,
        action: "reject",
        changes: {
          status: { old: existing.status, new: "REJECTED" },
        },
        performedBy: session.user.id,
        ipAddress: c.req.header("x-forwarded-for") || null,
        reason: input.reason,
      });

      // Send notification to technician (fire and forget)
      notifyJobRejected(id, session.user.id, input.reason).catch((err) => {
        console.error("[Jobs] Failed to send rejection notification:", err);
      });

      return c.json({
        message: "Job rejeitado",
        data: updated,
      });
    },
  )

  // =========================================================================
  // POST /:id/flag-oot - Flag an approved job as out-of-tolerance (as found):
  // opens a typed NC and generates the §7.10 customer notification (#426).
  // Never gates certificate issuance — it opens a quality workflow only.
  // =========================================================================
  .post(
    "/:id/flag-oot",
    ...withLabPermission({ non_conformance: ["create"] }),
    zValidator("json", FlagJobOutOfToleranceSchema),
    async (c) => {
      const memberData = c.get("member");
      const session = c.get("session");
      const id = await resolveJobRouteId(c.req.param("id"), memberData);
      const input = c.req.valid("json");

      if (id === null) {
        return c.json({ error: "Job nao encontrado" }, 404);
      }

      // Unit scope check here — the shared creator (also used by the desktop
      // sync ingest) only scopes by organization.
      const [scoped] = await db
        .select({
          id: calibrationJob.id,
          asFoundConformity: calibrationJob.asFoundConformity,
        })
        .from(calibrationJob)
        .where(
          and(
            eq(calibrationJob.id, id),
            eq(calibrationJob.organizationId, memberData.organizationId),
            buildUnitScopeCondition(calibrationJob.unitId, memberData),
          ),
        )
        .limit(1);

      if (!scoped) {
        return c.json({ error: "Job nao encontrado" }, 404);
      }

      const result = await flagJobOutOfTolerance({
        organizationId: memberData.organizationId,
        actorUserId: session.user.id,
        jobId: id,
        description: input.description,
        affectedScope: input.affectedScope,
        notifyCustomer: input.notifyCustomer,
        triggerSource:
          scoped.asFoundConformity === "NON_CONFORMING"
            ? "as_found_verdict"
            : "manual",
        ipAddress: c.req.header("x-forwarded-for") || null,
      });

      if (!result.ok) {
        return c.json(
          { error: result.message, code: result.code },
          result.status,
        );
      }

      return c.json(
        {
          message: "Nao conformidade registrada",
          data: { nc: result.nc, notification: result.notification },
        },
        201,
      );
    },
  )

  // =========================================================================
  // DELETE /:id - Cancel job (soft delete - sets status to CANCELED)
  // =========================================================================
  .delete(
    "/:id",
    ...withLabPermission({ calibration: ["delete"] }),
    zValidator("json", CancelJobSchema),
    async (c) => {
      const memberData = c.get("member");
      const session = c.get("session");
      const id = await resolveJobRouteId(c.req.param("id"), memberData);
      const input = c.req.valid("json");

      if (id === null) {
        return c.json({ error: "Job nao encontrado" }, 404);
      }

      // Get existing job
      const [existing] = await db
        .select()
        .from(calibrationJob)
        .where(
          and(
            eq(calibrationJob.id, id),
            eq(calibrationJob.organizationId, memberData.organizationId),
            buildUnitScopeCondition(calibrationJob.unitId, memberData),
          ),
        )
        .limit(1);

      if (!existing) {
        return c.json({ error: "Job nao encontrado" }, 404);
      }

      // Cannot cancel approved jobs (ISO 17025 immutability requirement)
      if (existing.status === "APPROVED") {
        return c.json(
          {
            error:
              "Nao e possivel cancelar um job aprovado. Jobs aprovados sao imutaveis para conformidade ISO 17025.",
          },
          400,
        );
      }

      // Cannot cancel already canceled jobs
      if (existing.status === "CANCELED") {
        return c.json({ error: "Job ja foi cancelado" }, 400);
      }

      // Update job
      const [updated] = await db
        .update(calibrationJob)
        .set({ status: "CANCELED" })
        .where(eq(calibrationJob.id, id))
        .returning();

      // Audit log
      await db.insert(jobAuditLog).values({
        jobId: id,
        action: "cancel",
        changes: {
          status: { old: existing.status, new: "CANCELED" },
        },
        performedBy: session.user.id,
        ipAddress: c.req.header("x-forwarded-for") || null,
        reason: input.reason,
      });

      return c.json({
        message: "Job cancelado",
        data: updated,
      });
    },
  )

  // =========================================================================
  // POST /:id/amend - Create an amended version of an approved certificate
  // ISO 17025:2017 Clause 7.8.4.1 - Amendments to reports and certificates
  // =========================================================================
  .post(
    "/:id/amend",
    ...withLabPermission({ calibration: ["approve"] }), // Only admin/owner can amend
    zValidator("json", AmendJobSchema),
    async (c) => {
      const memberData = c.get("member");
      const session = c.get("session");
      const id = await resolveJobRouteId(c.req.param("id"), memberData);
      const input = c.req.valid("json");

      if (id === null) {
        return c.json({ error: "Job nao encontrado" }, 404);
      }

      // Get existing job
      const [originalJob] = await db
        .select()
        .from(calibrationJob)
        .where(
          and(
            eq(calibrationJob.id, id),
            eq(calibrationJob.organizationId, memberData.organizationId),
            buildUnitScopeCondition(calibrationJob.unitId, memberData),
          ),
        )
        .limit(1);

      if (!originalJob) {
        return c.json({ error: "Job nao encontrado" }, 404);
      }

      // Can only amend APPROVED jobs
      if (originalJob.status !== "APPROVED") {
        return c.json(
          {
            error: `Apenas certificados aprovados podem ser retificados. Status atual: ${originalJob.status}`,
          },
          400,
        );
      }

      // Check if already superseded
      if (originalJob.supersededById) {
        return c.json(
          {
            error: "Este certificado ja foi retificado",
            supersededBy: originalJob.supersededById,
          },
          400,
        );
      }

      // Calculate amendment number
      let amendmentNumber = 1;
      if (originalJob.supersedesId) {
        // This is already an amendment, increment
        amendmentNumber = (originalJob.amendmentNumber || 0) + 1;
      }

      // Generate a lab-specific certificate number for the amended job.
      const certificateIdentity = await generateCertificateIdentity({
        organizationId: memberData.organizationId,
        generatedAt: new Date(),
        performedBy: session.user.id,
      });
      const amendmentTemplateSnapshot =
        certificateTemplateSnapshotFromUnknown(
          originalJob.certificateTemplateSnapshot,
        ) ??
        (await getEffectiveCertificateTemplateSnapshot(
          originalJob.organizationId,
        ));

      // Create new job as a clone of the original
      const [amendedJob] = await db
        .insert(calibrationJob)
        .values({
          jobId: certificateIdentity.certificateNumber,
          certificateName: certificateIdentity.certificateName,
          certificateNumberingSnapshot: certificateIdentity.snapshot,
          organizationId: originalJob.organizationId,
          unitId: originalJob.unitId,
          customerId: originalJob.customerId,
          assetId: originalJob.assetId,
          serviceId: originalJob.serviceId,
          technicianId: originalJob.technicianId,
          methodSnapshot: originalJob.methodSnapshot,
          standardsSnapshot: originalJob.standardsSnapshot,
          certificateTemplateId:
            originalJob.certificateTemplateId ?? amendmentTemplateSnapshot.id,
          certificateTemplateSnapshot:
            originalJob.certificateTemplateSnapshot ??
            serializeCertificateTemplateSnapshot(amendmentTemplateSnapshot),
          status: "DRAFT", // Start in DRAFT for corrections
          dueDate: originalJob.dueDate,
          data: originalJob.data, // Clone calibration data
          results: originalJob.results, // Clone results
          supersedesId: originalJob.id, // Link to original
          amendmentNumber,
          amendmentReason: input.reason,
          createdBy: session.user.id,
        })
        .returning();

      if (!amendedJob) {
        return c.json({ error: "Falha ao criar retificacao" }, 500);
      }

      // Reverse traceability (#426 Phase 1): the amendment clones the frozen
      // standards snapshot verbatim, so mirror the links for the new job too.
      await syncJobStandardLinks(
        amendedJob.id,
        originalJob.standardsSnapshot,
        originalJob.performedAt,
      );

      // Update original job to SUPERSEDED
      // Store the reason on the original job so it's visible when viewing the superseded certificate
      await db
        .update(calibrationJob)
        .set({
          status: "SUPERSEDED",
          supersededById: amendedJob.id,
          supersededAt: new Date(),
          amendmentReason: input.reason, // Store reason on original job too
        })
        .where(eq(calibrationJob.id, originalJob.id));

      await enqueueBackgroundJob({
        jobId: originalJob.id,
        userId: session.user.id,
      });

      // Audit log for original job (superseded)
      await db.insert(jobAuditLog).values({
        jobId: originalJob.id,
        action: "supersede",
        changes: {
          status: { old: "APPROVED", new: "SUPERSEDED" },
          supersededById: amendedJob.id,
        },
        performedBy: session.user.id,
        ipAddress: c.req.header("x-forwarded-for") || null,
        reason: `Certificado retificado. Novo: ${amendedJob.jobId}. Motivo: ${input.reason}`,
      });

      // Audit log for amended job (created)
      await db.insert(jobAuditLog).values({
        jobId: amendedJob.id,
        action: "create_amendment",
        changes: {
          supersedesId: originalJob.id,
          amendmentNumber,
          reason: input.reason,
        },
        performedBy: session.user.id,
        ipAddress: c.req.header("x-forwarded-for") || null,
        reason: input.reason,
      });

      // Notify customer (async)
      notifyCertificateAmended(
        originalJob.id,
        amendedJob.id,
        input.reason,
      ).catch((err) => {
        console.error("[Jobs] Failed to send amendment notification:", err);
      });

      return c.json(
        {
          message: "Retificacao criada com sucesso",
          originalJob: {
            id: originalJob.id,
            jobId: originalJob.jobId,
            status: "SUPERSEDED",
          },
          amendedJob: {
            id: amendedJob.id,
            jobId: amendedJob.jobId,
            status: "DRAFT",
            amendmentNumber,
          },
        },
        201,
      );
    },
  )

  // =========================================================================
  // GET /:id/amendment-chain - Get the full amendment history for a job
  // ISO 17025:2017 Clause 7.8.4.1 - Traceability of amendments
  // =========================================================================
  .get(
    "/:id/amendment-chain",
    ...withLabPermission({ calibration: ["read"] }),
    async (c) => {
      const handlerStartedAt = performance.now();
      const memberData = c.get("member");
      const id = await resolveJobRouteId(c.req.param("id"), memberData);

      try {
        if (id === null) {
          return c.json({ error: "Job nao encontrado" }, 404);
        }

        // Verify job exists and belongs to organization
        const [job] = await db
          .select({ id: calibrationJob.id })
          .from(calibrationJob)
          .where(
            and(
              eq(calibrationJob.id, id),
              eq(calibrationJob.organizationId, memberData.organizationId),
              buildUnitScopeCondition(calibrationJob.unitId, memberData),
            ),
          )
          .limit(1);

        if (!job) {
          return c.json({ error: "Job nao encontrado" }, 404);
        }

        // Safety limit to prevent infinite loops from corrupted data
        const MAX_CHAIN_LENGTH = 100;

        const dbStartedAt = performance.now();
        const chainResult = await db.execute(sql`
        WITH RECURSIVE ancestors AS (
          SELECT
            id,
            supersedes_id,
            0::integer AS depth,
            ARRAY[id]::integer[] AS path
          FROM calibration_job
          WHERE id = ${id}
            AND organization_id = ${memberData.organizationId}

          UNION ALL

          SELECT
            parent.id,
            parent.supersedes_id,
            ancestors.depth + 1,
            ancestors.path || parent.id
          FROM calibration_job parent
          INNER JOIN ancestors ON parent.id = ancestors.supersedes_id
          WHERE parent.organization_id = ${memberData.organizationId}
            AND ancestors.depth < ${MAX_CHAIN_LENGTH}
            AND NOT (parent.id = ANY(ancestors.path))
        ),
        root_job AS (
          SELECT id
          FROM ancestors
          ORDER BY depth DESC
          LIMIT 1
        ),
        chain AS (
          SELECT
            job.id,
            job.job_id,
            job.status,
            job.amendment_number,
            job.amendment_reason,
            job.approved_at,
            job.superseded_at,
            job.superseded_by_id,
            0::integer AS depth,
            ARRAY[job.id]::integer[] AS path
          FROM calibration_job job
          INNER JOIN root_job ON root_job.id = job.id
          WHERE job.organization_id = ${memberData.organizationId}

          UNION ALL

          SELECT
            child.id,
            child.job_id,
            child.status,
            child.amendment_number,
            child.amendment_reason,
            child.approved_at,
            child.superseded_at,
            child.superseded_by_id,
            chain.depth + 1,
            chain.path || child.id
          FROM calibration_job child
          INNER JOIN chain ON child.id = chain.superseded_by_id
          WHERE child.organization_id = ${memberData.organizationId}
            AND chain.depth < ${MAX_CHAIN_LENGTH}
            AND NOT (child.id = ANY(chain.path))
        )
        SELECT
          id,
          job_id,
          status,
          amendment_number,
          amendment_reason,
          approved_at,
          superseded_at,
          depth
        FROM chain
        ORDER BY depth ASC;
      `);
        addServerTiming(c, "amendment_chain_db", dbStartedAt);

        const chainRows = getExecuteRows<{
          id: number;
          job_id: string;
          status: string;
          amendment_number: number | null;
          amendment_reason: string | null;
          approved_at: Date | string | null;
          superseded_at: Date | string | null;
        }>(chainResult);

        const chain = chainRows.map((row) => ({
          id: Number(row.id),
          jobId: row.job_id,
          status: row.status,
          amendmentNumber:
            row.amendment_number === null ? null : Number(row.amendment_number),
          amendmentReason: row.amendment_reason,
          approvedAt: row.approved_at ? new Date(row.approved_at) : null,
          supersededAt: row.superseded_at ? new Date(row.superseded_at) : null,
          isCurrent: Number(row.id) === job.id,
        }));

        return c.json({
          data: chain,
          originalJobId: chain[0]?.id,
          latestJobId: chain[chain.length - 1]?.id,
          totalAmendments: chain.length - 1,
        });
      } finally {
        addServerTiming(c, "amendment_chain_handler", handlerStartedAt);
      }
    },
  )

  // =========================================================================
  // GET /:id/audit-log - Get audit log for a job
  // =========================================================================
  .get(
    "/:id/audit-log",
    ...withLabPermission({ calibration: ["read"] }),
    async (c) => {
      const memberData = c.get("member");
      const id = await resolveJobRouteId(c.req.param("id"), memberData);

      if (id === null) {
        return c.json({ error: "Job nao encontrado" }, 404);
      }

      // Verify job exists and belongs to organization
      const [existing] = await db
        .select({ id: calibrationJob.id })
        .from(calibrationJob)
        .where(
          and(
            eq(calibrationJob.id, id),
            eq(calibrationJob.organizationId, memberData.organizationId),
            buildUnitScopeCondition(calibrationJob.unitId, memberData),
          ),
        )
        .limit(1);

      if (!existing) {
        return c.json({ error: "Job nao encontrado" }, 404);
      }

      // Get audit logs with performer details
      const logs = await db
        .select({
          id: jobAuditLog.id,
          action: jobAuditLog.action,
          changes: jobAuditLog.changes,
          performedBy: jobAuditLog.performedBy,
          performedAt: jobAuditLog.performedAt,
          ipAddress: jobAuditLog.ipAddress,
          reason: jobAuditLog.reason,
          performerName: user.name,
        })
        .from(jobAuditLog)
        .leftJoin(user, eq(jobAuditLog.performedBy, user.id))
        .where(eq(jobAuditLog.jobId, id))
        .orderBy(desc(jobAuditLog.performedAt));

      return c.json({ data: logs });
    },
  )

  // =========================================================================
  // GET /technicians - Get list of technicians for assignment dropdown
  // =========================================================================
  .get(
    "/technicians/list",
    ...withLabPermission({ calibration: ["read"] }),
    async (c) => {
      const memberData = c.get("member");

      const baseQuery = db
        .select({
          id: user.id,
          name: user.name,
          email: user.email,
          role: member.role,
        })
        .from(member)
        .innerJoin(user, eq(member.userId, user.id));

      const technicians = memberData.activeUnitId
        ? await baseQuery
            .leftJoin(
              memberUnitAssignment,
              eq(memberUnitAssignment.memberId, member.id),
            )
            .where(
              and(
                eq(member.organizationId, memberData.organizationId),
                inArray(member.role, ["technician", "admin", "owner"]),
                or(
                  inArray(member.role, ["admin", "owner"]),
                  and(
                    eq(memberUnitAssignment.unitId, memberData.activeUnitId),
                    inArray(memberUnitAssignment.role, [
                      "technician",
                      "unit_admin",
                    ]),
                  ),
                ),
              ),
            )
            .orderBy(user.name)
        : await baseQuery
            .where(
              and(
                eq(member.organizationId, memberData.organizationId),
                inArray(member.role, ["technician", "admin", "owner"]),
              ),
            )
            .orderBy(user.name);

      return c.json({ data: technicians });
    },
  )

  // =========================================================================
  // GET /:id/download - Generate presigned URL for certificate download
  // =========================================================================
  .get(
    "/:id/download",
    ...withLabPermission({ calibration: ["read"] }),
    async (c) => {
      const memberData = c.get("member");
      const id = await resolveJobRouteId(c.req.param("id"), memberData);

      if (id === null) {
        return c.json({ error: "Job nao encontrado" }, 404);
      }

      const [job] = await db
        .select({ certificateUrl: calibrationJob.certificateUrl })
        .from(calibrationJob)
        .where(
          and(
            eq(calibrationJob.id, id),
            eq(calibrationJob.organizationId, memberData.organizationId),
            buildUnitScopeCondition(calibrationJob.unitId, memberData),
          ),
        )
        .limit(1);

      if (!job) {
        return c.json({ error: "Job nao encontrado" }, 404);
      }

      if (!job.certificateUrl) {
        return c.json({ error: "Certificado ainda nao foi gerado" }, 400);
      }

      const env = r2EnvFromUnknown(c.env);
      if (shouldUseLocalR2Download(env)) {
        return c.json({
          url: buildLocalJobFileUrl(
            c.req.url,
            c.req.param("id"),
            "certificate",
            env.API_URL,
          ),
        });
      }

      const key = extractKeyFromUrl(job.certificateUrl);
      const client = createR2Client(env);
      const url = await generatePresignedUrl(client, env.R2_BUCKET_NAME, key);

      return c.json({ url });
    },
  )

  // =========================================================================
  // GET /:id/file - Stream certificate from R2 during local dev
  // =========================================================================
  .get(
    "/:id/file",
    ...withLabPermission({ calibration: ["read"] }),
    async (c) => {
      const env = r2EnvFromUnknown(c.env);
      if (!shouldUseLocalR2Download(env)) {
        return c.json(
          { error: "Disponivel apenas em desenvolvimento local" },
          404,
        );
      }

      const memberData = c.get("member");
      const id = await resolveJobRouteId(c.req.param("id"), memberData);

      if (id === null) {
        return c.json({ error: "Job nao encontrado" }, 404);
      }

      const [job] = await db
        .select({ certificateUrl: calibrationJob.certificateUrl })
        .from(calibrationJob)
        .where(
          and(
            eq(calibrationJob.id, id),
            eq(calibrationJob.organizationId, memberData.organizationId),
            buildUnitScopeCondition(calibrationJob.unitId, memberData),
          ),
        )
        .limit(1);

      if (!job?.certificateUrl) {
        return c.json({ error: "Certificado ainda nao foi gerado" }, 400);
      }

      const key = extractKeyFromUrl(job.certificateUrl);
      const object = await env.CERTIFICATES_BUCKET.get(key);

      if (!object) {
        return c.json({ error: "Arquivo nao encontrado no R2 local" }, 404);
      }

      return new Response(object.body, {
        headers: {
          "Content-Type": object.httpMetadata?.contentType ?? "application/pdf",
          "Content-Disposition": 'inline; filename="certificado.pdf"',
        },
      });
    },
  )

  // =========================================================================
  // POST /:id/generate-label - Enqueue thermal label generation
  // =========================================================================
  .post(
    "/:id/generate-label",
    ...withLabPermission({ calibration: ["read"] }),
    async (c) => {
      const memberData = c.get("member");
      const session = c.get("session");
      const id = await resolveJobRouteId(c.req.param("id"), memberData);

      if (id === null) {
        return c.json({ error: "Job nao encontrado" }, 404);
      }

      const [job] = await db
        .select({
          id: calibrationJob.id,
          status: calibrationJob.status,
          labelUrl: calibrationJob.labelUrl,
        })
        .from(calibrationJob)
        .where(
          and(
            eq(calibrationJob.id, id),
            eq(calibrationJob.organizationId, memberData.organizationId),
            buildUnitScopeCondition(calibrationJob.unitId, memberData),
          ),
        )
        .limit(1);

      if (!job) {
        return c.json({ error: "Job nao encontrado" }, 404);
      }

      // Only approved jobs can have labels generated
      if (job.status !== "APPROVED") {
        return c.json(
          { error: "Apenas jobs aprovados podem ter etiquetas geradas" },
          400,
        );
      }

      await enqueueBackgroundJob({
        type: "LABEL",
        jobId: id,
        userId: session.user.id,
      });

      return c.json({
        message: "Gerando etiqueta...",
        jobId: id,
      });
    },
  )

  // =========================================================================
  // GET /:id/download-label - Generate presigned URL for label download
  // =========================================================================
  .get(
    "/:id/download-label",
    ...withLabPermission({ calibration: ["read"] }),
    async (c) => {
      const memberData = c.get("member");
      const id = await resolveJobRouteId(c.req.param("id"), memberData);

      if (id === null) {
        return c.json({ error: "Job nao encontrado" }, 404);
      }

      const [job] = await db
        .select({ labelUrl: calibrationJob.labelUrl })
        .from(calibrationJob)
        .where(
          and(
            eq(calibrationJob.id, id),
            eq(calibrationJob.organizationId, memberData.organizationId),
            buildUnitScopeCondition(calibrationJob.unitId, memberData),
          ),
        )
        .limit(1);

      if (!job) {
        return c.json({ error: "Job nao encontrado" }, 404);
      }

      if (!job.labelUrl) {
        return c.json({ error: "Etiqueta ainda nao foi gerada" }, 400);
      }

      const env = r2EnvFromUnknown(c.env);
      if (shouldUseLocalR2Download(env)) {
        return c.json({
          url: buildLocalJobFileUrl(
            c.req.url,
            c.req.param("id"),
            "label",
            env.API_URL,
          ),
        });
      }

      const key = extractKeyFromUrl(job.labelUrl);
      const client = createR2Client(env);
      const url = await generatePresignedUrl(client, env.R2_BUCKET_NAME, key);

      return c.json({ url });
    },
  )

  // =========================================================================
  // GET /:id/label-commands - Native printer commands for direct thermal printing
  // =========================================================================
  // Rendered server-side (the verification token isn't exposed in the general
  // job DTO) in the requested language (?lang=zpl|tspl). The browser fetches
  // this, then hands the commands to a transport (desktop local-server, Zebra
  // Browser Print, WebUSB, or Web Serial).
  .get(
    "/:id/label-commands",
    ...withLabPermission({ calibration: ["read"] }),
    async (c) => {
      const memberData = c.get("member");
      const id = await resolveJobRouteId(c.req.param("id"), memberData);

      if (id === null) {
        return c.json({ error: "Job nao encontrado" }, 404);
      }

      const [job] = await db
        .select({
          jobId: calibrationJob.jobId,
          performedAt: calibrationJob.performedAt,
          verificationToken: calibrationJob.verificationToken,
          labName: organization.name,
          assetTag: asset.tag,
        })
        .from(calibrationJob)
        .leftJoin(asset, eq(calibrationJob.assetId, asset.id))
        .leftJoin(
          organization,
          eq(calibrationJob.organizationId, organization.id),
        )
        .where(
          and(
            eq(calibrationJob.id, id),
            eq(calibrationJob.organizationId, memberData.organizationId),
            buildUnitScopeCondition(calibrationJob.unitId, memberData),
          ),
        )
        .limit(1);

      if (!job) {
        return c.json({ error: "Job nao encontrado" }, 404);
      }

      const dpi = c.req.query("dpi") === "300" ? 300 : 203;
      const language = c.req.query("lang") === "tspl" ? "tspl" : "zpl";
      const commands = renderLabel(
        {
          certNumber: job.jobId,
          labName: job.labName ?? "Laboratório",
          assetTag: job.assetTag ?? "-",
          calibrationDate: job.performedAt,
          // Same public verification URL the worker encodes into the PDF QR.
          verifyUrl: `https://verify.calibrafacil.com/v/${job.verificationToken}`,
        },
        defaultRenderOptions(language, dpi),
      );

      return c.text(commands);
    },
  )

  // =========================================================================
  // GET /:id/label-file - Stream label from R2 during local dev
  // =========================================================================
  .get(
    "/:id/label-file",
    ...withLabPermission({ calibration: ["read"] }),
    async (c) => {
      const env = r2EnvFromUnknown(c.env);
      if (!shouldUseLocalR2Download(env)) {
        return c.json(
          { error: "Disponivel apenas em desenvolvimento local" },
          404,
        );
      }

      const memberData = c.get("member");
      const id = await resolveJobRouteId(c.req.param("id"), memberData);

      if (id === null) {
        return c.json({ error: "Job nao encontrado" }, 404);
      }

      const [job] = await db
        .select({ labelUrl: calibrationJob.labelUrl })
        .from(calibrationJob)
        .where(
          and(
            eq(calibrationJob.id, id),
            eq(calibrationJob.organizationId, memberData.organizationId),
            buildUnitScopeCondition(calibrationJob.unitId, memberData),
          ),
        )
        .limit(1);

      if (!job?.labelUrl) {
        return c.json({ error: "Etiqueta ainda nao foi gerada" }, 400);
      }

      const key = extractKeyFromUrl(job.labelUrl);
      const object = await env.CERTIFICATES_BUCKET.get(key);

      if (!object) {
        return c.json({ error: "Arquivo nao encontrado no R2 local" }, 404);
      }

      return new Response(object.body, {
        headers: {
          "Content-Type": object.httpMetadata?.contentType ?? "application/pdf",
          "Content-Disposition": 'inline; filename="etiqueta.pdf"',
        },
      });
    },
  );
