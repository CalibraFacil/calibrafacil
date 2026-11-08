import { createRouter } from "../../../server/router";
import { methodEndpoints } from "@calibra-facil/contracts";
import { zValidator } from "@hono/zod-validator";
import { mount } from "../../../lib/endpoint-mount";
import { orgDb } from "../../../lib/org-db";
import {
  calibrationMethod,
  methodAuditLog,
  assetType,
  user,
} from "@calibra-facil/db/schema";
import {
  CreateMethodSchema,
  UpdateMethodSchema,
  FromTemplateSchema,
  ListMethodsQuerySchema,
  ReturnMethodToDraftSchema,
  normalizeMethodValidationsInput,
} from "@calibra-facil/schemas";
import { listTemplates } from "@calibra-facil/method-templates";
import {
  compileMethodDraft,
  checkMethodRecordDimensions,
  checkMethodDraftDimensions,
  errorDiagnostic,
  fingerprintJson,
  canonicalJson,
  parseMethodDraft,
  parseMethodPreviewScenario,
  productFormatToMethodDraft,
  createMethodExecutionEngine,
  methodEngineMetadata,
  type CompiledMethod,
  type DimensionalDiagnostic,
  type MethodDraft,
  type MethodDiagnostic,
  type MethodPreviewResult,
} from "@calibra-facil/method-definition";
import { eq, and, ilike, or, count, desc, ne, inArray } from "drizzle-orm";
import {
  conflict,
  invalid,
  notFound,
  unprocessable,
} from "../../../lib/domain-errors";
import { withOrg } from "../../../lib/org-context";
import { requireLabMethod, requireMethodRouteId } from "../method-access";
import { requestActor } from "../../../middleware/request-actor";
import { METHOD_MACHINE, isMethodDraft } from "@calibra-facil/schemas/machines";
import {
  withLabPermission,
  type AuthVariables,
  requireRole,
} from "../../../middleware/permission";
import { alias } from "drizzle-orm/pg-core";
import { isRecord, toRecord } from "@calibra-facil/shared/record";

/** The template governance as the wire carries it (the registry's arrays are read-only). */
function wireGovernance(
  governance: NonNullable<
    ReturnType<typeof listTemplates>[number]["governance"]
  >,
) {
  const { workedExample } = governance;
  return {
    summary: governance.summary,
    measurand: governance.measurand,
    model: governance.model,
    sources: governance.sources.map((source) => ({ ...source })),
    conformanceNotes: governance.conformanceNotes.map((note) => ({
      ...note,
    })),
    verificarItems: governance.verificarItems.map((item) => ({
      item: item.item,
      severity: item.severity,
      ...(item.ref !== undefined ? { ref: item.ref } : {}),
      ...(item.fieldKeys ? { fieldKeys: [...item.fieldKeys] } : {}),
    })),
    omittedComponents: governance.omittedComponents.map((component) => ({
      ...component,
    })),
    ...(workedExample ? { workedExample: { ...workedExample } } : {}),
    reviewStatus: governance.reviewStatus,
  };
}

const technicalReviewerUser = alias(user, "technicalReviewerUser");
const approverUser = alias(user, "approverUser");

function compileDraftWithEngine(
  draft: MethodDraft,
  options: {
    requirePublishable?: boolean;
    previewScenarios?: MethodDraft["previewScenarios"];
    includePreviewScenariosInFingerprint?: boolean;
  } = {},
) {
  return compileMethodDraft(draft, {
    engine: createMethodExecutionEngine(),
    engineMetadata: methodEngineMetadata(),
    requirePublishable: options.requirePublishable,
    previewScenarios: options.previewScenarios,
    includePreviewScenariosInFingerprint:
      options.includePreviewScenariosInFingerprint,
  });
}

function normalizeMethodRecord<
  T extends {
    validations?: unknown;
    variableBindings?: unknown;
    measurementModels?: unknown;
  },
>(method: T) {
  return {
    ...method,
    variableBindings: Array.isArray(method.variableBindings)
      ? method.variableBindings
      : [],
    measurementModels: Array.isArray(method.measurementModels)
      ? method.measurementModels
      : [],
    validations: normalizeMethodValidationsInput(method.validations),
  };
}

function methodCompileResponse(result: ReturnType<typeof compileMethodDraft>) {
  if (!result.ok) {
    return {
      ok: false,
      diagnostics: result.diagnostics,
      fingerprint: null,
      normalizedFormulas: [],
      compiledMethod: null,
    };
  }

  return {
    ok: true,
    diagnostics: result.diagnostics,
    fingerprint: result.method.methodFingerprint,
    normalizedFormulas: result.method.formulas.map((formula) => ({
      outputKey: formula.key,
      expression: formula.expression,
      normalizedExpression: formula.normalizedFormula,
      formulaFingerprint: formula.formulaFingerprint,
      variables: formula.variables,
      scope: formula.scope ?? { kind: "scalar" },
    })),
    previewResults: result.previewResults,
    compiledMethod: result.method,
  };
}

function buildPublicationEvidence(params: {
  methodId: number;
  version: number;
  compiledMethod: CompiledMethod;
  previewScenarios?: MethodDraft["previewScenarios"];
  previewResults: MethodPreviewResult[];
  diagnostics: MethodDiagnostic[];
  reviewedBy?: string | null;
  publishedBy: string;
  reasonForChange?: string | null;
  certificateContent: unknown;
  uncertaintyParams: unknown;
  measurementModels: unknown;
}) {
  const evidenceBase = {
    methodId: String(params.methodId),
    version: params.version,
    methodFingerprint: params.compiledMethod.methodFingerprint,
    normalizedMethodJson: params.compiledMethod.normalizedMethodJson,
    engineVersion: params.compiledMethod.engine.version,
    engineOptionsFingerprint: params.compiledMethod.engine.optionsFingerprint,
    compiledAt: new Date().toISOString(),
    reviewedBy: params.reviewedBy ?? null,
    publishedBy: params.publishedBy,
    reasonForChange: params.reasonForChange ?? null,
    previewScenarios: params.previewScenarios ?? [],
    previewResults: params.previewResults,
    diagnostics: params.diagnostics,
    certificateContent: params.certificateContent ?? null,
    uncertaintyParams: params.uncertaintyParams ?? [],
    measurementModels: params.measurementModels ?? [],
  };
  return {
    ...evidenceBase,
    publicationFingerprint: fingerprintJson(
      {
        compiledMethod: params.compiledMethod,
        certificateContent: evidenceBase.certificateContent,
        uncertaintyParams: evidenceBase.uncertaintyParams,
        measurementModels: evidenceBase.measurementModels,
        previewScenarios: evidenceBase.previewScenarios,
        previewResults: params.previewResults,
      },
      "publication",
    ),
    publicationEvidenceJson: canonicalJson(evidenceBase),
  };
}

function unmodeledUncertaintyDiagnostics(params: {
  uncertaintyParams: unknown;
  compiledMethod: CompiledMethod;
}): MethodDiagnostic[] {
  if (
    !Array.isArray(params.uncertaintyParams) ||
    params.uncertaintyParams.length === 0 ||
    params.compiledMethod.measurementModels.length > 0
  ) {
    return [];
  }

  return [
    {
      code: "UNCERTAINTY_PARAMS_NOT_GUM_MODELED",
      severity: "error",
      path: "uncertaintyParams",
      message:
        "Parâmetros de incerteza Type B estão configurados, mas nenhum modelo GUM compilado foi definido para publicação.",
      details: {
        componentCount: params.uncertaintyParams.length,
      },
    },
  ];
}

function coerceMethodDraft(value: unknown): MethodDraft {
  const candidate = toRecord(value);

  if (
    typeof candidate.id === "string" &&
    typeof candidate.status === "string" &&
    Array.isArray(candidate.measurementModels) &&
    Array.isArray(candidate.acceptanceCriteria) &&
    Array.isArray(candidate.previewScenarios)
  ) {
    return parseMethodDraft(candidate);
  }

  return productFormatToMethodDraft(candidate);
}

function tryCoerceMethodDraft(
  value: unknown,
):
  | { ok: true; draft: MethodDraft }
  | { ok: false; diagnostics: MethodDiagnostic[] } {
  try {
    return { ok: true, draft: coerceMethodDraft(value) };
  } catch (error) {
    return {
      ok: false,
      diagnostics: [
        {
          code: "METHOD_SHAPE_INVALID",
          severity: "error",
          message:
            error instanceof Error ? error.message : "Invalid method draft",
          path: "draft",
        },
      ],
    };
  }
}

function methodRecordToDraft(method: {
  id: number;
  version: number;
  status?: string | null;
  name: string;
  description: string | null;
  assetTypeId: number | null;
  dataFields: unknown;
  variableBindings?: unknown;
  formulas: unknown;
  measurementModels?: unknown;
  validations: unknown;
}): MethodDraft {
  return coerceMethodDraft({
    id: method.id,
    version: method.version,
    name: method.name,
    description: method.description ?? undefined,
    assetTypeId: method.assetTypeId ?? undefined,
    status: method.status ?? undefined,
    dataFields: method.dataFields,
    variableBindings: method.variableBindings,
    formulas: method.formulas,
    measurementModels: method.measurementModels,
    validations: method.validations,
  });
}

function diagnosticsMessage(diagnostics: MethodDiagnostic[]): string {
  return (
    diagnostics.find((item) => item.severity === "error")?.message ??
    "Método não compilou"
  );
}

/**
 * Dimensional publish gate. Runs the publish-time dimensional lint over a
 * raw method shape (dataFields / formulas / measurementModels) and, when it
 * finds a dimensional incoherence, returns a structured pt-BR error carrying the
 * named `DIMENSIONAL_ERROR` code plus a per-formula diagnostics array. Returns
 * `null` when the method is dimensionally coherent (or has nothing to check).
 *
 * The response mirrors the existing compile-failure shape ({ error, diagnostics }
 * at HTTP 422) so the frontend handles a dimensional rejection identically — it
 * only adds the `code` discriminator and the formatted-dimension messages.
 */
function formatDimensionalDiagnostic(d: DimensionalDiagnostic): string {
  return `Erro dimensional na fórmula '${d.formulaId}': ${d.message}`;
}

function dimensionalErrorPayload(
  diagnostics: readonly DimensionalDiagnostic[],
) {
  const first = diagnostics[0];
  return {
    error: first
      ? formatDimensionalDiagnostic(first)
      : "Erro dimensional no método",
    code: "DIMENSIONAL_ERROR" as const,
    diagnostics: diagnostics.map((d) => ({
      formulaId: d.formulaId,
      code: d.code,
      message: formatDimensionalDiagnostic(d),
    })),
  };
}

function assertDimensionallyCoherent(shape: {
  dataFields?: unknown;
  variableBindings?: unknown;
  formulas?: unknown;
  measurementModels?: unknown;
}): void {
  const diagnostics = checkMethodRecordDimensions(shape);
  if (diagnostics.length === 0) return;
  const payload = dimensionalErrorPayload(diagnostics);
  throw unprocessable(payload.code, payload.error, {
    legacyBody: { diagnostics: payload.diagnostics },
  });
}

/** The 422 for a method draft the compiler refused (diagnostics ride along). */
function methodCompileFailure(diagnostics: MethodDiagnostic[]) {
  return unprocessable(
    "method_compile_failed",
    diagnosticsMessage(diagnostics),
    {
      legacyBody: { diagnostics },
    },
  );
}

/**
 * Map the dimensional diagnostics of a compiled draft to error-severity
 * {@link MethodDiagnostic}s so the live Method Builder compile/preview panel
 * (`compile-preview-panel.tsx`, which already lists `diagnostics[]` per formula)
 * surfaces them — no new UI, and a no-op for dimensionally coherent drafts.
 */
function dimensionalMethodDiagnostics(draft: MethodDraft): MethodDiagnostic[] {
  return checkMethodDraftDimensions(draft).map((d) =>
    errorDiagnostic(
      "DIMENSIONAL_ERROR",
      formatDimensionalDiagnostic(d),
      d.formulaId,
    ),
  );
}

/**
 * Append dimensional diagnostics to a compile response (and force `ok: false`
 * when present) so the editor treats a dimensional incoherence as a hard error
 * BEFORE save. Byte-identical to the input response when the draft is coherent.
 */
function augmentCompileResponseWithDimensions(
  response: ReturnType<typeof methodCompileResponse>,
  draft: MethodDraft,
): ReturnType<typeof methodCompileResponse> {
  const dimensional = dimensionalMethodDiagnostics(draft);
  if (dimensional.length === 0) return response;
  return {
    ...response,
    ok: false,
    diagnostics: [...response.diagnostics, ...dimensional],
  };
}

function buildAdhocPreviewScenarios(
  sampleData: Record<string, unknown> | undefined,
): MethodDraft["previewScenarios"] | undefined {
  if (!sampleData) return undefined;
  return [
    {
      key: "publish_preview",
      label: "Preview de publicação",
      inputs: sampleData,
    },
  ];
}

function buildReviewPreviewEvidence(params: {
  compiledMethod: CompiledMethod;
  previewScenarios: MethodDraft["previewScenarios"] | undefined;
  previewResults: MethodPreviewResult[];
  diagnostics: MethodDiagnostic[];
  compiledBy: string;
}) {
  const evidenceBase = {
    kind: "review_preview",
    methodFingerprint: params.compiledMethod.methodFingerprint,
    normalizedMethodJson: params.compiledMethod.normalizedMethodJson,
    engineVersion: params.compiledMethod.engine.version,
    engineOptionsFingerprint: params.compiledMethod.engine.optionsFingerprint,
    compiledAt: new Date().toISOString(),
    compiledBy: params.compiledBy,
    previewScenarios: params.previewScenarios ?? [],
    previewResults: params.previewResults,
    diagnostics: params.diagnostics,
  };

  return {
    ...evidenceBase,
    reviewPreviewFingerprint: fingerprintJson(evidenceBase, "review-preview"),
  };
}

function reviewPreviewScenariosFromEvidence(
  evidence: unknown,
  methodFingerprint: string | null | undefined,
): MethodDraft["previewScenarios"] | undefined {
  if (!isRecord(evidence) || evidence.kind !== "review_preview") {
    return undefined;
  }
  if (
    typeof methodFingerprint !== "string" ||
    evidence.methodFingerprint !== methodFingerprint
  ) {
    return undefined;
  }
  if (!Array.isArray(evidence.previewScenarios)) {
    return undefined;
  }

  return evidence.previewScenarios.flatMap((scenario) => {
    const parsed = parseMethodPreviewScenario(scenario);
    return parsed ? [parsed] : [];
  });
}

function scalarResultValue(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? value : null;
}

function resolvePublicationPreviewScenarios(
  sampleData: Record<string, unknown> | undefined,
  evidence: unknown,
  methodFingerprint: string | null | undefined,
): MethodDraft["previewScenarios"] | undefined {
  return (
    buildAdhocPreviewScenarios(sampleData) ??
    reviewPreviewScenariosFromEvidence(evidence, methodFingerprint)
  );
}

const PREFIX = "/api/methods";

export const methodsRouter = createRouter<{ Variables: AuthVariables }>();

mount(
  methodsRouter,
  PREFIX,
  methodEndpoints.list,
  withLabPermission({ template: ["read"] }),
  async (
    c,
    { query: { page, limit, status, assetTypeId, query, includeArchived } },
  ) => {
    const member = c.get("member");
    const offset = (page - 1) * limit;
    const conditions = [
      eq(calibrationMethod.organizationId, member.organizationId),
    ];

    if (status) {
      conditions.push(eq(calibrationMethod.status, status));
    } else if (!includeArchived) {
      conditions.push(ne(calibrationMethod.status, "ARCHIVED"));
    }

    if (assetTypeId) {
      conditions.push(eq(calibrationMethod.assetTypeId, assetTypeId));
    }

    if (query) {
      conditions.push(
        or(
          ilike(calibrationMethod.name, `%${query}%`),
          ilike(calibrationMethod.description, `%${query}%`),
        )!,
      );
    }

    const whereCondition = and(...conditions);

    return await orgDb(member.organizationId).transaction(async (tx) => {
      const [countResult] = await tx
        .select({ total: count() })
        .from(calibrationMethod)
        .where(whereCondition);

      const total = countResult?.total ?? 0;

      const methods = await tx
        .select({
          id: calibrationMethod.id,
          name: calibrationMethod.name,
          description: calibrationMethod.description,
          version: calibrationMethod.version,
          status: calibrationMethod.status,
          assetTypeId: calibrationMethod.assetTypeId,
          assetTypeName: assetType.name,
          dataFields: calibrationMethod.dataFields,
          variableBindings: calibrationMethod.variableBindings,
          formulas: calibrationMethod.formulas,
          measurementModels: calibrationMethod.measurementModels,
          validations: calibrationMethod.validations,
          certificateContent: calibrationMethod.certificateContent,
          accreditedScope: calibrationMethod.accreditedScope,
          methodFingerprint: calibrationMethod.methodFingerprint,
          methodEngine: calibrationMethod.methodEngine,
          methodCompiledAt: calibrationMethod.methodCompiledAt,
          createdAt: calibrationMethod.createdAt,
          publishedAt: calibrationMethod.publishedAt,
          parentId: calibrationMethod.parentId,
        })
        .from(calibrationMethod)
        .leftJoin(assetType, eq(calibrationMethod.assetTypeId, assetType.id))
        .where(whereCondition)
        .orderBy(desc(calibrationMethod.createdAt))
        .limit(limit)
        .offset(offset);

      return {
        data: methods.map(normalizeMethodRecord),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    });
  },
);

mount(
  methodsRouter,
  PREFIX,
  methodEndpoints.compileDraft,
  withLabPermission({ template: ["read"] }),
  async (c) => {
    const body = toRecord(await c.req.json().catch(() => ({})));
    const draftResult = tryCoerceMethodDraft(body.draft ?? body.method ?? body);
    if (!draftResult.ok) {
      return c.json(
        {
          ok: false,
          diagnostics: draftResult.diagnostics,
          fingerprint: null,
          normalizedFormulas: [],
          compiledMethod: null,
        },
        422,
      );
    }
    const result = compileDraftWithEngine(draftResult.draft);

    const response = augmentCompileResponseWithDimensions(
      methodCompileResponse(result),
      draftResult.draft,
    );
    return response.ok ? response : c.json(response, 422);
  },
);

mount(
  methodsRouter,
  PREFIX,
  methodEndpoints.previewDraft,
  withLabPermission({ template: ["read"] }),
  async (c) => {
    const body = toRecord(await c.req.json().catch(() => ({})));
    const draftResult = tryCoerceMethodDraft(body.draft ?? body.method ?? body);
    if (!draftResult.ok) {
      return c.json(
        {
          ok: false,
          diagnostics: draftResult.diagnostics,
          fingerprint: null,
          normalizedFormulas: [],
          compiledMethod: null,
        },
        422,
      );
    }
    const result = compileDraftWithEngine(draftResult.draft, {
      previewScenarios: [
        {
          key: "adhoc_preview",
          label: "Preview",
          inputs:
            (isRecord(body.sampleData) ? body.sampleData : null) ??
            (isRecord(body.inputs) ? body.inputs : null) ??
            {},
        },
      ],
      includePreviewScenariosInFingerprint: false,
    });

    if (!result.ok) {
      return c.json(
        augmentCompileResponseWithDimensions(
          methodCompileResponse(result),
          draftResult.draft,
        ),
        422,
      );
    }

    const preview = result.previewResults[0];
    const dimensional = dimensionalMethodDiagnostics(draftResult.draft);
    return {
      ok: (preview?.passed ?? false) && dimensional.length === 0,
      diagnostics: [
        ...result.diagnostics,
        ...(preview?.diagnostics ?? []),
        ...dimensional,
      ],
      fingerprint: result.method.methodFingerprint,
      previewResults: result.previewResults,
      results: Object.fromEntries([
        ...result.method.formulas.map((formula) => {
          const formulaResult = preview?.formulaResults.find(
            (item) => item.key === formula.key,
          );
          return [formula.key, formulaResult?.value ?? null] as const;
        }),
        ...result.method.measurementModels.map((model) => {
          const modelResult = preview?.measurementModelResults.find(
            (item) => item.key === model.key,
          );
          const resultRecord = toRecord(modelResult?.result);
          const value = modelResult
            ? Array.isArray(modelResult.result)
              ? modelResult.result.map((item) => item.value)
              : scalarResultValue(resultRecord.value)
            : null;
          return [model.key, value] as const;
        }),
      ]),
    };
  },
);

mount(
  methodsRouter,
  PREFIX,
  methodEndpoints.listMethodTemplates,
  withLabPermission({ template: ["read"] }),
  async (c) => {
    const entries = listTemplates().flatMap((template) => {
      const governance = template.governance;
      if (
        governance === undefined ||
        governance.sources.length === 0 ||
        governance.measurand.trim().length === 0 ||
        governance.verificarItems.length === 0 ||
        governance.reviewStatus !== "draft_pending_revalidation"
      ) {
        return [];
      }
      const def = template.productDefinition;
      return [
        {
          templateKey: template.key,
          templateVersion: template.templateVersion,
          discipline: template.discipline,
          defaultName: template.defaultName,
          defaultAccreditedScope: template.defaultAccreditedScope,
          assetTypeSlug: def.assetTypeSlug,
          description: def.description ?? "",
          model: governance.model,
          counts: {
            dataFields: def.dataFields.length,
            formulas: def.formulas.length,
            validations: def.validations.length,
            uncertaintyParams: def.uncertaintyParams.length,
            verificar: governance.verificarItems.length,
            omitted: governance.omittedComponents.length,
          },
          // Served verbatim: the picker's "informed, not trust-me" surface.
          governance: wireGovernance(governance),
          spec: {
            dataFields: [...def.dataFields],
            formulas: [...def.formulas],
            measurementModels: [...def.measurementModels],
            validations: [...def.validations],
            uncertaintyParams: [...def.uncertaintyParams],
            certificateContent: def.certificateContent,
          },
          previewScenarios: [...template.previewScenarios],
        },
      ];
    });

    return entries;
  },
);

// Not client-facing (nothing in the frontends calls it), so a plain route.
methodsRouter.get(
  "/:id/label",
  ...withLabPermission({ template: ["read"] }),
  async (c) => {
    const member = c.get("member");
    return await orgDb(member.organizationId).transaction(async (tx) => {
      const id = await requireMethodRouteId(
        c.req.param("id"),
        member.organizationId,
        tx,
      );

      const [method] = await tx
        .select({
          id: calibrationMethod.id,
          label: calibrationMethod.name,
        })
        .from(calibrationMethod)
        .where(
          and(
            eq(calibrationMethod.id, id),
            eq(calibrationMethod.organizationId, member.organizationId),
          ),
        )
        .limit(1);

      if (!method) {
        throw notFound("method_not_found", "Método nao encontrado");
      }

      return c.json(method);
    });
  },
);

mount(
  methodsRouter,
  PREFIX,
  methodEndpoints.get,
  withLabPermission({ template: ["read"] }),
  async (c, { params }) => {
    const member = c.get("member");
    return await orgDb(member.organizationId).transaction(async (tx) => {
      const id = await requireMethodRouteId(
        params.id,
        member.organizationId,
        tx,
      );

      const [method] = await tx
        .select({
          id: calibrationMethod.id,
          organizationId: calibrationMethod.organizationId,
          name: calibrationMethod.name,
          description: calibrationMethod.description,
          version: calibrationMethod.version,
          status: calibrationMethod.status,
          assetTypeId: calibrationMethod.assetTypeId,
          assetTypeName: assetType.name,
          dataFields: calibrationMethod.dataFields,
          variableBindings: calibrationMethod.variableBindings,
          formulas: calibrationMethod.formulas,
          measurementModels: calibrationMethod.measurementModels,
          validations: calibrationMethod.validations,
          uncertaintyParams: calibrationMethod.uncertaintyParams,
          certificateContent: calibrationMethod.certificateContent,
          accreditedScope: calibrationMethod.accreditedScope,
          compiledMethod: calibrationMethod.compiledMethod,
          methodFingerprint: calibrationMethod.methodFingerprint,
          methodEngine: calibrationMethod.methodEngine,
          methodCompiledAt: calibrationMethod.methodCompiledAt,
          publicationEvidence: calibrationMethod.publicationEvidence,
          parentId: calibrationMethod.parentId,
          createdAt: calibrationMethod.createdAt,
          createdByName: user.name,
          technicalReviewedBy: calibrationMethod.technicalReviewedBy,
          technicalReviewedByName: technicalReviewerUser.name,
          publishedAt: calibrationMethod.publishedAt,
          approvedBy: calibrationMethod.approvedBy,
          approvedByName: approverUser.name,
          archivedAt: calibrationMethod.archivedAt,
        })
        .from(calibrationMethod)
        .leftJoin(assetType, eq(calibrationMethod.assetTypeId, assetType.id))
        .leftJoin(user, eq(calibrationMethod.createdBy, user.id))
        .leftJoin(
          technicalReviewerUser,
          eq(calibrationMethod.technicalReviewedBy, technicalReviewerUser.id),
        )
        .leftJoin(
          approverUser,
          eq(calibrationMethod.approvedBy, approverUser.id),
        )
        .where(
          and(
            eq(calibrationMethod.id, id),
            eq(calibrationMethod.organizationId, member.organizationId),
          ),
        )
        .limit(1);

      if (!method) {
        throw notFound("method_not_found", "Método nao encontrado");
      }

      return normalizeMethodRecord(method);
    });
  },
);

mount(
  methodsRouter,
  PREFIX,
  methodEndpoints.create,
  withLabPermission({ template: ["create"] }),
  async (c, { body: input }) => {
    const member = c.get("member");
    const session = c.get("session");
    const result = await withOrg(
      member.organizationId,
      requestActor(c),
      async (ctx) => {
        const [existing] = await ctx.o
          .select()
          .from(calibrationMethod)
          .where(
            and(
              eq(calibrationMethod.organizationId, member.organizationId),
              eq(calibrationMethod.name, input.name),
              eq(calibrationMethod.version, 1),
            ),
          )
          .limit(1);

        if (existing) {
          throw invalid(
            "method_name_taken",
            "Ja existe um método com este nome",
          );
        }

        // Dimensional gate: reject an incoherent field/formula set before
        // it is ever persisted (no method row escapes the check when written).
        assertDimensionallyCoherent(input);

        const [newMethod] = await ctx.o
          .insert(calibrationMethod)
          .values({
            organizationId: member.organizationId,
            assetTypeId: input.assetTypeId || null,
            name: input.name,
            description: input.description || null,
            version: 1,
            status: "DRAFT",
            dataFields: input.dataFields,
            variableBindings: input.variableBindings,
            formulas: input.formulas,
            measurementModels: input.measurementModels,
            validations: input.validations,
            uncertaintyParams: input.uncertaintyParams,
            certificateContent: input.certificateContent ?? null,
            accreditedScope: input.accreditedScope ?? false,
            createdBy: session.user.id,
          })
          .returning();

        if (!newMethod) {
          throw new Error("Erro ao criar método");
        }

        await ctx.audit("method", newMethod.id, {
          action: "create",

          changes: { initial: input },
        });

        return newMethod;
      },
    );
    return result;
  },
);

mount(
  methodsRouter,
  PREFIX,
  methodEndpoints.fromTemplate,
  withLabPermission({ template: ["create"] }),
  async (c, { body: input }) => {
    const member = c.get("member");
    const session = c.get("session");
    const template = listTemplates().find(
      (candidate) => candidate.key === input.templateKey,
    );
    if (!template) {
      throw notFound("template_not_found", "Template não encontrado");
    }

    // Informed-adoption gate (ISO/IEC 17025 §7.2.1.5): every action-severity
    // [VERIFICAR] item that carries a ref must be explicitly acknowledged.
    // (The three consent booleans are already enforced by FromTemplateSchema.)
    const governance = template.governance;
    const acknowledgements = input.acknowledgements;
    const requiredActionRefs = (governance?.verificarItems ?? [])
      .filter((item) => item.severity === "action")
      .map((item) => item.ref)
      .filter((ref): ref is string => typeof ref === "string");
    const missingRefs = requiredActionRefs.filter(
      (ref) => !acknowledgements.acceptedVerificarRefs.includes(ref),
    );
    if (missingRefs.length > 0) {
      throw invalid(
        "template_acknowledgements_missing",
        "Reconhecimentos pendentes para itens [VERIFICAR] de ação do modelo",
        { legacyBody: { missing: missingRefs } },
      );
    }

    const def = template.productDefinition;
    const name = input.name ?? def.name;

    // Resolve the asset type: explicit override wins, else the template's
    // slug -> asset_type.id, else null.
    let assetTypeId: number | null = input.assetTypeId ?? null;
    const result = await withOrg(
      member.organizationId,
      requestActor(c),
      async (ctx) => {
        if (assetTypeId === null && def.assetTypeSlug) {
          const [matchedAssetType] = await ctx.o
            .select({ id: assetType.id })
            .from(assetType)
            .where(eq(assetType.slug, def.assetTypeSlug))
            .limit(1);
          assetTypeId = matchedAssetType?.id ?? null;
        }

        // Same uniqueness guard as POST /.
        const [existing] = await ctx.o
          .select()
          .from(calibrationMethod)
          .where(
            and(
              eq(calibrationMethod.organizationId, member.organizationId),
              eq(calibrationMethod.name, name),
              eq(calibrationMethod.version, 1),
            ),
          )
          .limit(1);

        if (existing) {
          throw invalid(
            "method_name_taken",
            "Ja existe um método com este nome",
          );
        }

        // Dimensional gate on template instantiation: a curated template
        // must be dimensionally coherent before it becomes a DRAFT method.
        assertDimensionallyCoherent(def);

        const [newMethod] = await ctx.o
          .insert(calibrationMethod)
          .values({
            organizationId: member.organizationId,
            assetTypeId,
            name,
            description: def.description ?? null,
            version: 1,
            status: "DRAFT",
            dataFields: def.dataFields,
            variableBindings: def.variableBindings,
            formulas: def.formulas,
            measurementModels: def.measurementModels,
            validations: def.validations,
            uncertaintyParams: def.uncertaintyParams,
            certificateContent: def.certificateContent,
            accreditedScope: def.accreditedScope,
            templateKey: template.key,
            templateVersion: template.templateVersion,
            createdBy: session.user.id,
          })
          .returning();

        if (!newMethod) {
          throw new Error("Erro ao criar método");
        }

        await ctx.audit("method", newMethod.id, {
          action: "create",
          // Freeze the adoption evidence (ISO/IEC 17025 §7.2.1.5): the
          // acknowledgements + an immutable snapshot of the cited sources (with
          // editions) and the verbatim [VERIFICAR]/omitted items at adoption
          // time — demonstrable to an auditor and immune to later template edits.
          changes: {
            fromTemplate: template.key,
            templateVersion: template.templateVersion,
            acknowledgements,
            governanceSnapshot: governance
              ? {
                  sources: governance.sources,
                  verificarItems: governance.verificarItems,
                  omittedComponents: governance.omittedComponents,
                }
              : null,
          },
        });

        return newMethod;
      },
    );
    return result;
  },
);

mount(
  methodsRouter,
  PREFIX,
  methodEndpoints.update,
  withLabPermission({ template: ["update"] }),
  async (c, { params, body: input }) => {
    const member = c.get("member");
    const result = await withOrg(
      member.organizationId,
      requestActor(c),
      async (ctx) => {
        const existing = await requireLabMethod(
          params.id,
          member.organizationId,
          ctx.o,
        );
        const id = existing.id;

        if (!METHOD_MACHINE.canTransition(existing.status, "edit")) {
          throw invalid(
            "method_not_editable",
            "Apenas métodos em rascunho podem ser editados",
          );
        }

        // Check for name conflict if name is being changed
        // Check against all versions to prevent naming conflicts
        if (input.name && input.name !== existing.name) {
          const [duplicate] = await ctx.o
            .select()
            .from(calibrationMethod)
            .where(
              and(
                eq(calibrationMethod.organizationId, member.organizationId),
                eq(calibrationMethod.name, input.name),
                ne(calibrationMethod.id, id),
              ),
            )
            .limit(1);

          if (duplicate) {
            throw invalid(
              "method_name_taken",
              "Ja existe um método com este nome",
            );
          }
        }

        const updateData: Record<string, unknown> = {};
        const changes: Record<string, { old: unknown; new: unknown }> = {};

        if (input.name !== undefined && input.name !== existing.name) {
          updateData.name = input.name;
          changes.name = { old: existing.name, new: input.name };
        }
        if (input.description !== undefined) {
          updateData.description = input.description || null;
          changes.description = {
            old: existing.description,
            new: input.description,
          };
        }
        if (input.assetTypeId !== undefined) {
          updateData.assetTypeId = input.assetTypeId || null;
          changes.assetTypeId = {
            old: existing.assetTypeId,
            new: input.assetTypeId,
          };
        }
        if (input.dataFields !== undefined) {
          updateData.dataFields = input.dataFields;
          changes.dataFields = {
            old: existing.dataFields,
            new: input.dataFields,
          };
        }
        if (input.variableBindings !== undefined) {
          updateData.variableBindings = input.variableBindings;
          changes.variableBindings = {
            old: existing.variableBindings,
            new: input.variableBindings,
          };
        }
        if (input.formulas !== undefined) {
          updateData.formulas = input.formulas;
          changes.formulas = { old: existing.formulas, new: input.formulas };
        }
        if (input.measurementModels !== undefined) {
          updateData.measurementModels = input.measurementModels;
          changes.measurementModels = {
            old: existing.measurementModels,
            new: input.measurementModels,
          };
        }
        if (input.validations !== undefined) {
          updateData.validations = input.validations;
          changes.validations = {
            old: existing.validations,
            new: input.validations,
          };
        }
        if (input.uncertaintyParams !== undefined) {
          updateData.uncertaintyParams = input.uncertaintyParams;
          changes.uncertaintyParams = {
            old: existing.uncertaintyParams,
            new: input.uncertaintyParams,
          };
        }
        if (input.certificateContent !== undefined) {
          updateData.certificateContent = input.certificateContent;
          changes.certificateContent = {
            old: existing.certificateContent,
            new: input.certificateContent,
          };
        }
        if (
          input.accreditedScope !== undefined &&
          input.accreditedScope !== existing.accreditedScope
        ) {
          updateData.accreditedScope = input.accreditedScope;
          changes.accreditedScope = {
            old: existing.accreditedScope,
            new: input.accreditedScope,
          };
        }

        if (Object.keys(updateData).length === 0) {
          return existing;
        }

        // Dimensional gate on the EFFECTIVE post-update field/formula set
        // (incoming edits overlaid on the stored draft). Reject before persisting
        // so the row stays unchanged on a dimensional incoherence.
        assertDimensionallyCoherent({
          dataFields: input.dataFields ?? existing.dataFields,
          variableBindings: input.variableBindings ?? existing.variableBindings,
          formulas: input.formulas ?? existing.formulas,
          measurementModels:
            input.measurementModels ?? existing.measurementModels,
        });

        updateData.compiledMethod = null;
        updateData.methodFingerprint = null;
        updateData.methodEngine = null;
        updateData.methodCompiledAt = null;
        updateData.publicationEvidence = null;

        const [updated] = await ctx.o
          .update(calibrationMethod)
          .set(updateData)
          .where(
            and(
              eq(calibrationMethod.id, id),
              eq(calibrationMethod.status, existing.status),
            ),
          )
          .returning();
        if (!updated) {
          // The compare-and-set on the status matched no row: the method
          // moved under the caller (METHOD_MACHINE).
          throw conflict(
            "status_transition_conflict",
            "O método mudou de status durante a operação. Recarregue e tente novamente.",
          );
        }

        await ctx.audit("method", id, { action: "update", changes });

        return updated;
      },
    );
    return result;
  },
);

mount(
  methodsRouter,
  PREFIX,
  methodEndpoints.requestApproval,
  withLabPermission({ template: ["update"] }),
  async (c, { params }) => {
    const member = c.get("member");
    const session = c.get("session");
    const result = await withOrg(
      member.organizationId,
      requestActor(c),
      async (ctx) => {
        const existing = await requireLabMethod(
          params.id,
          member.organizationId,
          ctx.o,
        );
        const id = existing.id;

        if (
          !METHOD_MACHINE.canTransition(existing.status, "request_approval")
        ) {
          throw invalid(
            "method_not_submittable",
            "Apenas rascunhos podem ser enviados para aprovacao",
          );
        }

        if (!existing.dataFields || existing.dataFields.length === 0) {
          throw invalid(
            "method_has_no_inputs",
            "Método deve ter pelo menos um campo de entrada",
          );
        }

        const body = toRecord(await c.req.json().catch(() => ({})));
        const previewScenarios = buildAdhocPreviewScenarios(
          isRecord(body.sampleData) ? body.sampleData : undefined,
        );
        const compileResult = compileDraftWithEngine(
          methodRecordToDraft(existing),
          {
            requirePublishable: true,
            previewScenarios,
            includePreviewScenariosInFingerprint: false,
          },
        );
        if (!compileResult.ok) {
          throw methodCompileFailure(compileResult.diagnostics);
        }
        const uncertaintyDiagnostics = unmodeledUncertaintyDiagnostics({
          uncertaintyParams: existing.uncertaintyParams,
          compiledMethod: compileResult.method,
        });
        if (uncertaintyDiagnostics.length > 0) {
          throw methodCompileFailure(uncertaintyDiagnostics);
        }
        // Dimensional gate on the publish-transition recompile (the engine
        // is dimension-blind by design, so this is the check that catches an
        // incoherent unit set on submit-for-approval).
        assertDimensionallyCoherent(existing);

        const [updated] = await ctx.o
          .update(calibrationMethod)
          .set({
            status: METHOD_MACHINE.requireTargetOf(
              existing.status,
              "request_approval",
            ),
            technicalReviewedBy: null,
            approvedBy: null,
            publishedAt: null,
            publishedBy: null,
            compiledMethod: compileResult.method,
            methodFingerprint: compileResult.method.methodFingerprint,
            methodEngine: compileResult.method.engine,
            methodCompiledAt: new Date(),
            publicationEvidence: buildReviewPreviewEvidence({
              compiledMethod: compileResult.method,
              previewScenarios,
              previewResults: compileResult.previewResults,
              diagnostics: compileResult.diagnostics,
              compiledBy: session.user.id,
            }),
          })
          .where(
            and(
              eq(calibrationMethod.id, id),
              eq(calibrationMethod.status, existing.status),
            ),
          )
          .returning();
        if (!updated) {
          // The compare-and-set on the status matched no row: the method
          // moved under the caller (METHOD_MACHINE).
          throw conflict(
            "status_transition_conflict",
            "O método mudou de status durante a operação. Recarregue e tente novamente.",
          );
        }

        await ctx.audit("method", id, {
          action: "request_approval",

          changes: {
            status: { old: "DRAFT", new: "PENDING_APPROVAL" },
            methodFingerprint: {
              old: existing.methodFingerprint,
              new: compileResult.method.methodFingerprint,
            },
          },
        });

        return updated;
      },
    );
    return result;
  },
);

mount(
  methodsRouter,
  PREFIX,
  methodEndpoints.technicalReview,
  [...withLabPermission({ template: ["publish"] }), requireRole(["admin"])],
  async (c, { params }) => {
    const member = c.get("member");
    const session = c.get("session");
    const result = await withOrg(
      member.organizationId,
      requestActor(c),
      async (ctx) => {
        const existing = await requireLabMethod(
          params.id,
          member.organizationId,
          ctx.o,
        );
        const id = existing.id;

        if (
          !METHOD_MACHINE.canTransition(existing.status, "technical_review")
        ) {
          throw invalid(
            "method_not_reviewable",
            "Apenas métodos pendentes podem ser revisados",
          );
        }

        const [updated] = await ctx.o
          .update(calibrationMethod)
          .set({
            status: METHOD_MACHINE.requireTargetOf(
              existing.status,
              "technical_review",
            ),
            technicalReviewedBy: session.user.id,
          })
          .where(
            and(
              eq(calibrationMethod.id, id),
              eq(calibrationMethod.status, existing.status),
            ),
          )
          .returning();
        if (!updated) {
          // The compare-and-set on the status matched no row: the method
          // moved under the caller (METHOD_MACHINE).
          throw conflict(
            "status_transition_conflict",
            "O método mudou de status durante a operação. Recarregue e tente novamente.",
          );
        }

        await ctx.audit("method", id, {
          action: "technical_review",

          changes: {
            status: { old: "PENDING_APPROVAL", new: "TECHNICAL_REVIEWED" },
            technicalReviewedBy: { old: null, new: session.user.id },
          },
        });

        return updated;
      },
    );
    return result;
  },
);

mount(
  methodsRouter,
  PREFIX,
  methodEndpoints.qualityApprove,
  [...withLabPermission({ template: ["publish"] }), requireRole(["owner"])],
  async (c, { params }) => {
    const member = c.get("member");
    const session = c.get("session");
    const result = await withOrg(
      member.organizationId,
      requestActor(c),
      async (ctx) => {
        const existing = await requireLabMethod(
          params.id,
          member.organizationId,
          ctx.o,
        );
        const id = existing.id;

        if (!METHOD_MACHINE.canTransition(existing.status, "publish")) {
          throw invalid(
            "method_not_publishable",
            "Apenas métodos revisados podem ser aprovados",
          );
        }

        if (!existing.technicalReviewedBy) {
          throw invalid(
            "method_review_required",
            "Revisao tecnica obrigatoria antes da aprovacao",
          );
        }

        if (existing.technicalReviewedBy === session.user.id) {
          throw invalid(
            "self_approval_blocked",
            "Revisao tecnica e aprovacao de qualidade devem ser feitas por usuarios diferentes",
          );
        }

        if (!existing.dataFields || existing.dataFields.length === 0) {
          throw invalid(
            "method_has_no_inputs",
            "Método deve ter pelo menos um campo de entrada",
          );
        }

        const body = toRecord(await c.req.json().catch(() => ({})));
        const publishDraft = methodRecordToDraft({
          ...existing,
          status: "PUBLISHED",
        });
        const previewScenarios = resolvePublicationPreviewScenarios(
          isRecord(body.sampleData) ? body.sampleData : undefined,
          existing.publicationEvidence,
          existing.methodFingerprint,
        );
        const compileResult = compileDraftWithEngine(publishDraft, {
          requirePublishable: true,
          previewScenarios,
          includePreviewScenariosInFingerprint: false,
        });
        if (!compileResult.ok) {
          throw methodCompileFailure(compileResult.diagnostics);
        }
        const uncertaintyDiagnostics = unmodeledUncertaintyDiagnostics({
          uncertaintyParams: existing.uncertaintyParams,
          compiledMethod: compileResult.method,
        });
        if (uncertaintyDiagnostics.length > 0) {
          throw methodCompileFailure(uncertaintyDiagnostics);
        }
        // Dimensional gate on the publish recompile — no method row
        // reaches PUBLISHED with a dimensional incoherence.
        assertDimensionallyCoherent(existing);
        const publicationEvidence = buildPublicationEvidence({
          methodId: existing.id,
          version: existing.version,
          compiledMethod: compileResult.method,
          previewScenarios,
          previewResults: compileResult.previewResults,
          diagnostics: compileResult.diagnostics,
          reviewedBy: existing.technicalReviewedBy,
          publishedBy: session.user.id,
          reasonForChange:
            typeof body.reasonForChange === "string"
              ? body.reasonForChange
              : null,
          certificateContent: existing.certificateContent,
          uncertaintyParams: existing.uncertaintyParams,
          measurementModels: existing.measurementModels,
        });

        // Archive any previously published version with same name
        await ctx.o
          .update(calibrationMethod)
          .set({
            status: METHOD_MACHINE.requireTargetOf("PUBLISHED", "supersede"),
            archivedAt: new Date(),
          })
          .where(
            and(
              eq(calibrationMethod.organizationId, member.organizationId),
              eq(calibrationMethod.name, existing.name),
              inArray(
                calibrationMethod.status,
                METHOD_MACHINE.allowedFrom("supersede"),
              ),
              ne(calibrationMethod.id, id),
            ),
          );

        const [published] = await ctx.o
          .update(calibrationMethod)
          .set({
            status: METHOD_MACHINE.requireTargetOf(existing.status, "publish"),
            publishedAt: new Date(),
            publishedBy: session.user.id,
            approvedBy: session.user.id,
            compiledMethod: compileResult.method,
            methodFingerprint: compileResult.method.methodFingerprint,
            methodEngine: compileResult.method.engine,
            methodCompiledAt: new Date(),
            publicationEvidence,
          })
          .where(
            and(
              eq(calibrationMethod.id, id),
              eq(calibrationMethod.status, existing.status),
            ),
          )
          .returning();
        if (!published) {
          // The compare-and-set on the status matched no row: the method
          // moved under the caller (METHOD_MACHINE).
          throw conflict(
            "status_transition_conflict",
            "O método mudou de status durante a operação. Recarregue e tente novamente.",
          );
        }

        await ctx.audit("method", id, {
          action: "quality_approve",

          changes: {
            status: { old: "TECHNICAL_REVIEWED", new: "PUBLISHED" },
            methodFingerprint: {
              old: existing.methodFingerprint,
              new: compileResult.method.methodFingerprint,
            },
          },
        });

        return published;
      },
    );
    return result;
  },
);

mount(
  methodsRouter,
  PREFIX,
  methodEndpoints.returnToDraft,
  [
    ...withLabPermission({ template: ["update"] }),
    requireRole(["admin", "owner"]),
  ],
  async (c, { params, body: { reason } }) => {
    const member = c.get("member");
    const result = await withOrg(
      member.organizationId,
      requestActor(c),
      async (ctx) => {
        const existing = await requireLabMethod(
          params.id,
          member.organizationId,
          ctx.o,
        );
        const id = existing.id;

        if (!METHOD_MACHINE.canTransition(existing.status, "return_to_draft")) {
          throw invalid(
            "method_not_returnable",
            "Apenas métodos em aprovacao podem retornar ao rascunho",
          );
        }

        const [updated] = await ctx.o
          .update(calibrationMethod)
          .set({
            status: METHOD_MACHINE.requireTargetOf(
              existing.status,
              "return_to_draft",
            ),
            technicalReviewedBy: null,
            approvedBy: null,
            publishedAt: null,
            publishedBy: null,
            compiledMethod: null,
            methodFingerprint: null,
            methodEngine: null,
            methodCompiledAt: null,
            publicationEvidence: null,
          })
          .where(
            and(
              eq(calibrationMethod.id, id),
              eq(calibrationMethod.status, existing.status),
            ),
          )
          .returning();
        if (!updated) {
          // The compare-and-set on the status matched no row: the method
          // moved under the caller (METHOD_MACHINE).
          throw conflict(
            "status_transition_conflict",
            "O método mudou de status durante a operação. Recarregue e tente novamente.",
          );
        }

        await ctx.audit("method", id, {
          action: "return_to_draft",

          changes: { status: { old: existing.status, new: "DRAFT" } },
          reason,
        });

        return updated;
      },
    );
    return result;
  },
);

mount(
  methodsRouter,
  PREFIX,
  methodEndpoints.publishDraft,
  [...withLabPermission({ template: ["publish"] }), requireRole(["owner"])],
  async (c, { params }) => {
    const member = c.get("member");
    const session = c.get("session");
    const result = await withOrg(
      member.organizationId,
      requestActor(c),
      async (ctx) => {
        const existing = await requireLabMethod(
          params.id,
          member.organizationId,
          ctx.o,
        );
        const id = existing.id;

        if (!METHOD_MACHINE.canTransition(existing.status, "publish")) {
          throw invalid(
            "method_not_publishable",
            "Apenas métodos revisados podem ser publicados",
          );
        }

        if (!existing.technicalReviewedBy) {
          throw invalid(
            "method_review_required",
            "Revisao tecnica obrigatoria antes da publicacao",
          );
        }

        if (existing.technicalReviewedBy === session.user.id) {
          throw invalid(
            "self_approval_blocked",
            "Revisao tecnica e publicacao devem ser feitas por usuarios diferentes",
          );
        }

        if (!existing.dataFields || existing.dataFields.length === 0) {
          throw invalid(
            "method_has_no_inputs",
            "Método deve ter pelo menos um campo de entrada",
          );
        }

        const body = toRecord(await c.req.json().catch(() => ({})));
        const publishDraft = methodRecordToDraft({
          ...existing,
          status: "PUBLISHED",
        });
        const previewScenarios = resolvePublicationPreviewScenarios(
          isRecord(body.sampleData) ? body.sampleData : undefined,
          existing.publicationEvidence,
          existing.methodFingerprint,
        );
        const compileResult = compileDraftWithEngine(publishDraft, {
          requirePublishable: true,
          previewScenarios,
          includePreviewScenariosInFingerprint: false,
        });
        if (!compileResult.ok) {
          throw methodCompileFailure(compileResult.diagnostics);
        }
        const uncertaintyDiagnostics = unmodeledUncertaintyDiagnostics({
          uncertaintyParams: existing.uncertaintyParams,
          compiledMethod: compileResult.method,
        });
        if (uncertaintyDiagnostics.length > 0) {
          throw methodCompileFailure(uncertaintyDiagnostics);
        }
        // Dimensional gate on the publish recompile — no method row
        // reaches PUBLISHED with a dimensional incoherence.
        assertDimensionallyCoherent(existing);
        const publicationEvidence = buildPublicationEvidence({
          methodId: existing.id,
          version: existing.version,
          compiledMethod: compileResult.method,
          previewScenarios,
          previewResults: compileResult.previewResults,
          diagnostics: compileResult.diagnostics,
          reviewedBy: existing.technicalReviewedBy,
          publishedBy: session.user.id,
          reasonForChange:
            typeof body.reasonForChange === "string"
              ? body.reasonForChange
              : null,
          certificateContent: existing.certificateContent,
          uncertaintyParams: existing.uncertaintyParams,
          measurementModels: existing.measurementModels,
        });

        // Archive any previously published version with same name
        await ctx.o
          .update(calibrationMethod)
          .set({
            status: METHOD_MACHINE.requireTargetOf("PUBLISHED", "supersede"),
            archivedAt: new Date(),
          })
          .where(
            and(
              eq(calibrationMethod.organizationId, member.organizationId),
              eq(calibrationMethod.name, existing.name),
              inArray(
                calibrationMethod.status,
                METHOD_MACHINE.allowedFrom("supersede"),
              ),
              ne(calibrationMethod.id, id),
            ),
          );

        const [published] = await ctx.o
          .update(calibrationMethod)
          .set({
            status: METHOD_MACHINE.requireTargetOf(existing.status, "publish"),
            publishedAt: new Date(),
            publishedBy: session.user.id,
            approvedBy: session.user.id,
            compiledMethod: compileResult.method,
            methodFingerprint: compileResult.method.methodFingerprint,
            methodEngine: compileResult.method.engine,
            methodCompiledAt: new Date(),
            publicationEvidence,
          })
          .where(
            and(
              eq(calibrationMethod.id, id),
              eq(calibrationMethod.status, existing.status),
            ),
          )
          .returning();
        if (!published) {
          // The compare-and-set on the status matched no row: the method
          // moved under the caller (METHOD_MACHINE).
          throw conflict(
            "status_transition_conflict",
            "O método mudou de status durante a operação. Recarregue e tente novamente.",
          );
        }

        await ctx.audit("method", id, {
          action: "publish",

          changes: {
            status: { old: existing.status, new: "PUBLISHED" },
            methodFingerprint: {
              old: existing.methodFingerprint,
              new: compileResult.method.methodFingerprint,
            },
          },
        });

        return published;
      },
    );
    return result;
  },
);

mount(
  methodsRouter,
  PREFIX,
  methodEndpoints.archive,
  withLabPermission({ template: ["update"] }),
  async (c, { params }) => {
    const member = c.get("member");
    const result = await withOrg(
      member.organizationId,
      requestActor(c),
      async (ctx) => {
        const existing = await requireLabMethod(
          params.id,
          member.organizationId,
          ctx.o,
        );
        const id = existing.id;

        if (!METHOD_MACHINE.canTransition(existing.status, "archive")) {
          throw invalid(
            "method_not_archivable",
            "Apenas métodos publicados podem ser arquivados",
          );
        }

        const [archived] = await ctx.o
          .update(calibrationMethod)
          .set({
            status: METHOD_MACHINE.requireTargetOf(existing.status, "archive"),
            archivedAt: new Date(),
          })
          .where(
            and(
              eq(calibrationMethod.id, id),
              eq(calibrationMethod.status, existing.status),
            ),
          )
          .returning();
        if (!archived) {
          // The compare-and-set on the status matched no row: the method
          // moved under the caller (METHOD_MACHINE).
          throw conflict(
            "status_transition_conflict",
            "O método mudou de status durante a operação. Recarregue e tente novamente.",
          );
        }

        await ctx.audit("method", id, {
          action: "archive",

          changes: { status: { old: "PUBLISHED", new: "ARCHIVED" } },
        });

        return archived;
      },
    );
    return result;
  },
);

mount(
  methodsRouter,
  PREFIX,
  methodEndpoints.createNewVersion,
  withLabPermission({ template: ["create"] }),
  async (c, { params }) => {
    const member = c.get("member");
    const session = c.get("session");
    const result = await withOrg(
      member.organizationId,
      requestActor(c),
      async (ctx) => {
        const existing = await requireLabMethod(
          params.id,
          member.organizationId,
          ctx.o,
        );

        if (existing.status !== "PUBLISHED") {
          throw invalid(
            "method_not_versionable",
            "Novas versoes so podem ser criadas a partir de métodos publicados",
          );
        }

        const [existingDraft] = await ctx.o
          .select()
          .from(calibrationMethod)
          .where(
            and(
              eq(calibrationMethod.organizationId, member.organizationId),
              eq(calibrationMethod.name, existing.name),
              eq(calibrationMethod.status, "DRAFT"),
            ),
          )
          .limit(1);

        if (existingDraft) {
          throw invalid(
            "method_draft_exists",
            "Ja existe um rascunho para este método. Edite o rascunho existente ou exclua-o antes de criar uma nova versão.",
            { legacyBody: { existingDraftId: existingDraft.id } },
          );
        }

        const [maxVersion] = await ctx.o
          .select({ maxVersion: calibrationMethod.version })
          .from(calibrationMethod)
          .where(
            and(
              eq(calibrationMethod.organizationId, member.organizationId),
              eq(calibrationMethod.name, existing.name),
            ),
          )
          .orderBy(desc(calibrationMethod.version))
          .limit(1);

        const newVersion = (maxVersion?.maxVersion || existing.version) + 1;

        const [newMethod] = await ctx.o
          .insert(calibrationMethod)
          .values({
            organizationId: member.organizationId,
            assetTypeId: existing.assetTypeId,
            name: existing.name,
            description: existing.description,
            version: newVersion,
            status: "DRAFT",
            dataFields: existing.dataFields,
            variableBindings: existing.variableBindings ?? [],
            formulas: existing.formulas,
            measurementModels: existing.measurementModels ?? [],
            validations: normalizeMethodValidationsInput(existing.validations),
            uncertaintyParams: existing.uncertaintyParams,
            certificateContent: existing.certificateContent,
            accreditedScope: existing.accreditedScope,
            parentId: existing.id,
            createdBy: session.user.id,
          })
          .returning();

        if (!newMethod) {
          throw new Error("Erro ao criar nova versão");
        }

        await ctx.audit("method", newMethod.id, {
          action: "new_version",

          changes: {
            parentId: existing.id,
            parentVersion: existing.version,
            newVersion,
          },
        });

        return normalizeMethodRecord(newMethod);
      },
    );
    return result;
  },
);

// Not client-facing (the SDK has no method delete), so a plain route.
methodsRouter.delete(
  "/:id",
  ...withLabPermission({ template: ["delete"] }),
  async (c) => {
    const member = c.get("member");
    const result = await withOrg(
      member.organizationId,
      requestActor(c),
      async (ctx) => {
        const existing = await requireLabMethod(
          c.req.param("id"),
          member.organizationId,
          ctx.o,
        );
        const id = existing.id;

        if (!isMethodDraft(existing.status)) {
          throw invalid(
            "method_not_deletable",
            "Apenas rascunhos podem ser excluidos. métodos publicados devem ser arquivados.",
          );
        }

        // Record the deletion in the audit trail BEFORE deleting —
        // mirrors customers.ts. The method_id FK no longer cascades (soft
        // reference), so this row outlives the method it documents.
        await ctx.audit("method", id, {
          action: "delete",

          changes: { method: { old: existing, new: null } },
        });

        await ctx.o
          .delete(calibrationMethod)
          .where(eq(calibrationMethod.id, id));

        return { success: true };
      },
    );
    return c.json(result, 200);
  },
);

// Not client-facing (nothing in the frontends calls it), so a plain route.
methodsRouter.get(
  "/:id/versions",
  ...withLabPermission({ template: ["read"] }),
  async (c) => {
    const member = c.get("member");
    return await orgDb(member.organizationId).transaction(async (tx) => {
      const id = await requireMethodRouteId(
        c.req.param("id"),
        member.organizationId,
        tx,
      );

      const [method] = await tx
        .select({ name: calibrationMethod.name })
        .from(calibrationMethod)
        .where(
          and(
            eq(calibrationMethod.id, id),
            eq(calibrationMethod.organizationId, member.organizationId),
          ),
        )
        .limit(1);

      if (!method) {
        throw notFound("method_not_found", "Método nao encontrado");
      }

      const versions = await tx
        .select({
          id: calibrationMethod.id,
          version: calibrationMethod.version,
          status: calibrationMethod.status,
          createdAt: calibrationMethod.createdAt,
          publishedAt: calibrationMethod.publishedAt,
          archivedAt: calibrationMethod.archivedAt,
        })
        .from(calibrationMethod)
        .where(
          and(
            eq(calibrationMethod.organizationId, member.organizationId),
            eq(calibrationMethod.name, method.name),
          ),
        )
        .orderBy(desc(calibrationMethod.version));

      return c.json({ data: versions });
    });
  },
);

mount(
  methodsRouter,
  PREFIX,
  methodEndpoints.audit,
  withLabPermission({ template: ["read"] }),
  async (c, { params }) => {
    const member = c.get("member");
    return await orgDb(member.organizationId).transaction(async (tx) => {
      const id = await requireMethodRouteId(
        params.id,
        member.organizationId,
        tx,
      );

      const [method] = await tx
        .select({ id: calibrationMethod.id })
        .from(calibrationMethod)
        .where(
          and(
            eq(calibrationMethod.id, id),
            eq(calibrationMethod.organizationId, member.organizationId),
          ),
        )
        .limit(1);

      if (!method) {
        throw notFound("method_not_found", "Método nao encontrado");
      }

      const logs = await tx
        .select({
          id: methodAuditLog.id,
          action: methodAuditLog.action,
          changes: methodAuditLog.changes,
          performedAt: methodAuditLog.performedAt,
          performedByName: user.name,
          reason: methodAuditLog.reason,
        })
        .from(methodAuditLog)
        .leftJoin(user, eq(methodAuditLog.performedBy, user.id))
        .where(eq(methodAuditLog.methodId, id))
        .orderBy(desc(methodAuditLog.performedAt));

      return { data: logs };
    });
  },
);
