import { z } from "zod";
import {
  CreateMethodSchema,
  FromTemplateSchema,
  ListMethodsQuerySchema,
  ReturnMethodToDraftSchema,
  UpdateMethodSchema,
} from "@calibra-facil/schemas";

import { nullableNumber, nullableString, paginationSchema } from "../common";
import { endpoint, type EndpointGroup } from "./define";

/**
 * The laboratory's calibration methods: the catalog, the builder's compile and
 * preview, the review/approval/publication workflow and the curated template
 * catalog. Response schemas are wire schemas written from what the handlers in
 * `apps/api/src/domains/methods/routes/methods.ts` return; the desktop local-server answers
 * `list` and `get` with the same ones (`apps/local-server/src/contract.test.ts`).
 * The method definition parts (fields, formulas, models, the compiled artifact)
 * are opaque here: the web narrows them with the method-definition schemas.
 *
 * Not client-facing, so not defined here: `GET /:id/label`, `GET /:id/versions`
 * and `DELETE /:id`.
 */

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

/** One method as GET /api/methods lists it (the compiled artifact stays out). */
const methodSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: nullableString,
  version: z.number(),
  status: z.string(),
  assetTypeId: nullableNumber,
  assetTypeName: nullableString,
  dataFields: z.array(z.unknown()),
  variableBindings: z.array(z.unknown()),
  formulas: z.array(z.unknown()),
  measurementModels: z.array(z.unknown()),
  validations: z.array(z.unknown()),
  certificateContent: z.unknown().optional(),
  accreditedScope: z.boolean().optional(),
  methodFingerprint: nullableString.optional(),
  /** `{ version, optionsFingerprint }` of the engine that compiled it; the column is untyped. */
  methodEngine: z.unknown(),
  methodCompiledAt: nullableString.optional(),
  createdAt: z.string(),
  publishedAt: nullableString,
  parentId: nullableNumber,
});

/** GET /api/methods */
export const methodsListResponseSchema = z.object({
  data: z.array(methodSchema),
  pagination: paginationSchema,
});
export type MethodsListResponse = z.infer<typeof methodsListResponseSchema>;

/** GET /api/methods/:id: adds the compiled artifact and the review trail. */
export const methodDetailSchema = methodSchema.extend({
  uncertaintyParams: z.array(z.unknown()),
  compiledMethod: z.unknown(),
  publicationEvidence: z.unknown(),
  technicalReviewedBy: nullableString.optional(),
  approvedBy: nullableString.optional(),
  createdByName: nullableString.optional(),
  technicalReviewedByName: nullableString.optional(),
  approvedByName: nullableString.optional(),
  archivedAt: nullableString.optional(),
});
export type MethodDetail = z.infer<typeof methodDetailSchema>;

/**
 * The stored method row a write answers with (no joined names): the workflow
 * steps answer the row they changed.
 */
const storedMethodSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: nullableString,
  version: z.number(),
  status: z.string(),
  assetTypeId: nullableNumber,
  dataFields: z.array(z.unknown()),
  variableBindings: z.array(z.unknown()),
  formulas: z.array(z.unknown()),
  measurementModels: z.array(z.unknown()),
  validations: z.array(z.unknown()),
  uncertaintyParams: z.array(z.unknown()),
  certificateContent: z.unknown().optional(),
  accreditedScope: z.boolean().optional(),
  compiledMethod: z.unknown().optional(),
  methodFingerprint: nullableString.optional(),
  methodEngine: z.unknown().optional(),
  methodCompiledAt: nullableString.optional(),
  publicationEvidence: z.unknown().optional(),
  createdAt: z.string(),
  publishedAt: nullableString,
  parentId: nullableNumber,
  archivedAt: nullableString.optional(),
});
export type StoredMethod = z.infer<typeof storedMethodSchema>;

const methodAuditEntrySchema = z.object({
  id: z.number(),
  action: z.string(),
  changes: z.unknown(),
  performedAt: z.string(),
  performedByName: nullableString,
  reason: nullableString,
});
export type MethodAuditLogEntry = z.infer<typeof methodAuditEntrySchema>;

/**
 * POST /compile and /preview: the builder's diagnostics. A draft that does not
 * compile answers 422 with the same body (`ok: false`); the SDK hands that body
 * to the caller instead of raising, so the builder can show the diagnostics.
 */
const builderResponseSchema = z.object({
  ok: z.boolean(),
  diagnostics: z.array(z.unknown()),
  fingerprint: nullableString,
  normalizedFormulas: z.array(z.unknown()).optional(),
  previewResults: z.array(z.unknown()).optional(),
  results: z.record(z.string(), z.unknown()).optional(),
  compiledMethod: z.unknown().optional(),
});
export type MethodBuilderResponse = z.infer<typeof builderResponseSchema>;

/** The informed-adoption surface of a catalog template (served verbatim). */
const methodGovernanceSchema = z.object({
  summary: z.string(),
  measurand: z.string(),
  model: z.enum(["formulas", "gum_measurement_model"]),
  sources: z.array(
    z.object({
      title: z.string(),
      edition: z.string(),
      section: z.string().optional(),
      url: z.string().optional(),
    }),
  ),
  conformanceNotes: z.array(z.object({ ref: z.string(), note: z.string() })),
  verificarItems: z.array(
    z.object({
      ref: z.string().optional(),
      item: z.string(),
      severity: z.enum(["info", "action", "platform"]),
      fieldKeys: z.array(z.string()).optional(),
    }),
  ),
  omittedComponents: z.array(
    z.object({
      ref: z.string(),
      component: z.string(),
      appliesWhen: z.string().optional(),
    }),
  ),
  workedExample: z
    .object({
      scenarioKey: z.string(),
      provenance: z.enum(["cited_guide_table", "engine_characterization"]),
      source: z.string(),
      expected: z.record(z.string(), z.number()),
    })
    .optional(),
  reviewStatus: z.literal("draft_pending_revalidation"),
});
export type MethodGovernance = z.infer<typeof methodGovernanceSchema>;

/** One entry of the curated method-template catalog. */
const methodTemplateEntrySchema = z.object({
  templateKey: z.string(),
  templateVersion: z.number(),
  discipline: z.string(),
  defaultName: z.string(),
  defaultAccreditedScope: z.boolean(),
  assetTypeSlug: z.string().optional(),
  description: z.string(),
  model: z.enum(["formulas", "gum_measurement_model"]),
  counts: z.object({
    dataFields: z.number(),
    formulas: z.number(),
    validations: z.number(),
    uncertaintyParams: z.number(),
    verificar: z.number(),
    omitted: z.number(),
  }),
  governance: methodGovernanceSchema,
  spec: z.object({
    dataFields: z.array(z.unknown()),
    formulas: z.array(z.unknown()),
    measurementModels: z.array(z.unknown()),
    validations: z.array(z.unknown()),
    uncertaintyParams: z.array(z.unknown()),
    certificateContent: z.unknown(),
  }),
  previewScenarios: z.array(z.unknown()),
});
export type MethodTemplateCatalogEntry = z.infer<
  typeof methodTemplateEntrySchema
>;

/**
 * The bodies the builder routes read. The routes accept the draft under `draft`
 * (or `method`, or as the whole body), and the sample inputs under `sampleData`
 * (or `inputs`): the keys are optional and extra keys pass.
 */
const BuilderRequestSchema = z.looseObject({
  draft: z.unknown().optional(),
  sampleData: z.record(z.string(), z.unknown()).optional(),
});
const WorkflowRequestSchema = z.looseObject({
  sampleData: z.record(z.string(), z.unknown()).optional(),
  reasonForChange: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

const DESKTOP_LABEL = "Métodos";

export const methodEndpoints = {
  list: endpoint({
    method: "get",
    path: "/api/methods",
    query: ListMethodsQuerySchema,
    response: methodsListResponseSchema,
    failure: "Falha ao carregar métodos",
    policy: "local-first-read-through-sync",
  }),
  get: endpoint({
    method: "get",
    path: "/api/methods/:id",
    response: methodDetailSchema,
    failure: "Falha ao carregar método",
    policy: "local-first-read-through-sync",
  }),
  audit: endpoint({
    method: "get",
    path: "/api/methods/:id/audit",
    response: z.object({ data: z.array(methodAuditEntrySchema) }),
    failure: "Falha ao carregar histórico",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  create: endpoint({
    method: "post",
    path: "/api/methods",
    body: CreateMethodSchema,
    response: storedMethodSchema,
    status: 201,
    failure: "Erro ao criar método",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  update: endpoint({
    method: "put",
    path: "/api/methods/:id",
    body: UpdateMethodSchema,
    response: storedMethodSchema,
    failure: "Erro ao atualizar método",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  archive: endpoint({
    method: "post",
    path: "/api/methods/:id/archive",
    response: storedMethodSchema,
    failure: "Erro ao arquivar método",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  createNewVersion: endpoint({
    method: "post",
    path: "/api/methods/:id/new-version",
    response: storedMethodSchema,
    status: 201,
    failure: "Erro ao criar nova versão",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  technicalReview: endpoint({
    method: "post",
    path: "/api/methods/:id/technical-review",
    response: storedMethodSchema,
    failure: "Erro ao revisar tecnicamente",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  qualityApprove: endpoint({
    method: "post",
    path: "/api/methods/:id/quality-approve",
    body: WorkflowRequestSchema,
    response: storedMethodSchema,
    failure: "Erro ao aprovar qualidade",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  returnToDraft: endpoint({
    method: "post",
    path: "/api/methods/:id/return-to-draft",
    body: ReturnMethodToDraftSchema,
    response: storedMethodSchema,
    failure: "Erro ao retornar para rascunho",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  compileDraft: endpoint({
    method: "post",
    path: "/api/methods/compile",
    body: BuilderRequestSchema,
    response: builderResponseSchema,
    failure: "Erro ao compilar rascunho do método",
    policy: "cloud-only",
    desktopLabel: "Compilação de método",
  }),
  previewDraft: endpoint({
    method: "post",
    path: "/api/methods/preview",
    body: BuilderRequestSchema,
    response: builderResponseSchema,
    failure: "Erro ao executar preview do método",
    policy: "cloud-only",
    desktopLabel: "Preview de método",
  }),
  publishDraft: endpoint({
    method: "post",
    path: "/api/methods/:id/publish",
    body: WorkflowRequestSchema,
    response: storedMethodSchema,
    failure: "Erro ao publicar método",
    policy: "cloud-only",
    desktopLabel: "Publicação de método",
  }),
  requestApproval: endpoint({
    method: "post",
    path: "/api/methods/:id/request-approval",
    body: WorkflowRequestSchema,
    response: storedMethodSchema,
    failure: "Erro ao solicitar aprovação",
    policy: "cloud-only",
    desktopLabel: "Solicitação de aprovação",
  }),
  // The curated catalog (only templates whose governance is complete).
  listMethodTemplates: endpoint({
    method: "get",
    path: "/api/methods/templates",
    response: z.array(methodTemplateEntrySchema),
    failure: "Falha ao carregar o catálogo de modelos",
    policy: "cloud-only",
    desktopLabel: "Catálogo de modelos de método",
  }),
  fromTemplate: endpoint({
    method: "post",
    path: "/api/methods/from-template",
    body: FromTemplateSchema,
    response: storedMethodSchema,
    status: 201,
    failure: "Erro ao criar método a partir do modelo",
    policy: "cloud-only",
    desktopLabel: "Adoção de método a partir de modelo",
  }),
} as const satisfies EndpointGroup;
