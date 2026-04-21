import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { Scalar } from "@scalar/hono-api-reference";
import { db } from "@calibra-facil/db";
import {
  asset,
  assetAuditLog,
  assetType,
  calibrationJob,
  calibrationRequest,
  calibrationRequestAuditLog,
  calibrationRequestItem,
  customer,
  customerAuditLog,
  jobAuditLog,
  organization,
  organizationApiKey,
  organizationUnit,
  publicApiResourceRef,
  publicApiWebhookDelivery,
  publicApiWebhookSubscription,
  referenceStandard,
  service,
  user,
} from "@calibra-facil/db/schema";
import {
  ApproveJobSchema,
  CancelJobSchema,
  CreateAssetSchema,
  CreateCalibrationRequestSchema,
  CreateCustomerSchema,
  CreateJobSchema,
  ExecuteJobSchema,
  RejectJobSchema,
  SubmitForReviewSchema,
  UpdateAssetSchema,
  UpdateCustomerSchema,
  UpdateJobSchema,
} from "@calibra-facil/schemas";
import { type CertificateTemplateSnapshot } from "@calibra-facil/shared";
import {
  and,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import {
  buildListMeta,
  buildPublicApiError,
  createWebhookSecret,
  emitPublicApiWebhookEvent,
  findIdempotencyRecord,
  getIdempotencyKey,
  getPublicApiRequestIp,
  getResourceExternalId,
  getResourceExternalIdMap,
  hashIdempotencyPayload,
  replayPublicApiWebhookDelivery,
  resolvePublicApiUnitScope,
  storeIdempotencyRecord,
  upsertResourceExternalId,
} from "../lib/public-api";
import {
  getEffectiveCertificateTemplateSnapshot,
  serializeCertificateTemplateSnapshot,
} from "../lib/certificate-template-snapshots";
import {
  createR2Client,
  extractKeyFromUrl,
  generatePresignedUrl,
  type R2Env,
} from "../lib/storage";
import {
  type ApiKeyAuthVariables,
  requireApiKeyAuth,
  requireApiScope,
} from "../middleware/api-key-auth";
import {
  type AuthVariables,
  requireLabProtected,
  requireOrgType,
  requireRole,
} from "../middleware/permission";
import { requireFeature } from "../middleware/tier-guard";
import { createClientOrganizationAsServiceOwner } from "../lib/portal-service-account";
import { createCalibrationJob, jobCreationClientErrors } from "../lib/jobs";
import {
  denormalizeAssetSpecificationsForResponse,
  normalizeAssetSpecificationsFromInput,
  resolveAssetBaseMeasurementUnit,
} from "../lib/asset-measurement";

const ListQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  query: z.string().trim().optional(),
  unitId: z.coerce.number().optional(),
});

const AssetCreatePublicSchema = CreateAssetSchema.extend({
  externalId: z.string().trim().optional(),
  unitId: z.coerce.number().optional(),
  customerExternalId: z.string().trim().optional(),
}).refine((value) => value.customerId || value.customerExternalId, {
  message: "Informe customerId ou customerExternalId",
  path: ["customerId"],
});

const JobCreatePublicSchema = CreateJobSchema.extend({
  externalId: z.string().trim().optional(),
  unitId: z.coerce.number().optional(),
  assetExternalId: z.string().trim().optional(),
}).refine((value) => value.assetId || value.assetExternalId, {
  message: "Informe assetId ou assetExternalId",
  path: ["assetId"],
});

const PublicCreateRequestSchema = CreateCalibrationRequestSchema.extend({
  externalId: z.string().trim().optional(),
  customerId: z.coerce.number().optional(),
  customerExternalId: z.string().trim().optional(),
  unitId: z.coerce.number().optional(),
  assetExternalIds: z.array(z.string().trim()).optional(),
  assetIds: z.array(z.coerce.number().min(1)).optional(),
})
  .omit({ assetIds: true })
  .extend({
    assetIds: z.array(z.coerce.number().min(1)).optional(),
  })
  .refine((value) => value.customerId || value.customerExternalId, {
    message: "Informe customerId ou customerExternalId",
    path: ["customerId"],
  })
  .refine(
    (value) => {
      const totalAssetIds =
        (value.assetIds?.length ?? 0) + (value.assetExternalIds?.length ?? 0);
      return totalAssetIds > 0;
    },
    {
      message: "Informe ao menos um ativo",
      path: ["assetIds"],
    },
  );

const UpdateRequestPublicSchema = z.object({
  observations: z.string().trim().max(2000).optional(),
  requestedDueDate: z.string().datetime().nullable().optional(),
});

const CancelRequestPublicSchema = z.object({
  reason: z.string().trim().min(3),
});

const WebhookSubscriptionSchema = z.object({
  name: z.string().trim().min(3).max(80),
  targetUrl: z.string().url(),
  events: z
    .array(
      z.enum([
        "customer.created",
        "customer.updated",
        "customer.deleted",
        "asset.created",
        "asset.updated",
        "asset.deleted",
        "request.created",
        "request.updated",
        "request.submitted",
        "request.canceled",
        "job.created",
        "job.updated",
        "job.results_submitted",
        "job.approved",
        "job.canceled",
        "certificate.available",
      ]),
    )
    .min(1)
    .max(32),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
});

const ReportQuerySchema = z.object({
  period: z.enum(["7d", "30d", "90d", "month"]).optional().default("30d"),
  unitIds: z.string().optional(),
});

function slugify(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 50);
}

function generateUniqueSlug(name: string) {
  return `${slugify(name)}-${Math.random().toString(36).slice(2, 8)}`;
}

function resolvePeriodRange(
  period: z.infer<typeof ReportQuerySchema>["period"],
) {
  const now = new Date();
  const startDate = new Date(now);

  if (period === "month") {
    startDate.setDate(1);
    startDate.setHours(0, 0, 0, 0);
  } else {
    const days = period === "7d" ? 7 : period === "30d" ? 30 : 90;
    startDate.setDate(now.getDate() - days);
  }

  return {
    period,
    startDate,
    endDate: now,
  };
}

function parseRequestedUnitIds(raw?: string) {
  if (!raw?.trim()) return null;

  const unitIds = raw
    .split(",")
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isInteger(value) && value > 0);

  return unitIds.length > 0 ? Array.from(new Set(unitIds)) : null;
}

function getPeriodLabel(period: z.infer<typeof ReportQuerySchema>["period"]) {
  switch (period) {
    case "7d":
      return "Últimos 7 dias";
    case "30d":
      return "Últimos 30 dias";
    case "90d":
      return "Últimos 90 dias";
    case "month":
      return "Mês atual";
    default:
      return "Últimos 30 dias";
  }
}

function getHealthStatus(params: {
  overdueNow: number;
  rejectedInPeriod: number;
  expiringStandardsSoon: number;
}) {
  if (params.overdueNow > 0) return "critical";
  if (params.rejectedInPeriod > 0 || params.expiringStandardsSoon > 0) {
    return "attention";
  }
  return "healthy";
}

function getHealthReason(params: {
  overdueNow: number;
  rejectedInPeriod: number;
  expiringStandardsSoon: number;
}) {
  if (params.overdueNow > 0) {
    return `${params.overdueNow} OS atrasada(s) em aberto`;
  }
  if (params.rejectedInPeriod > 0) {
    return `${params.rejectedInPeriod} rejeição(ões) no período`;
  }
  if (params.expiringStandardsSoon > 0) {
    return `${params.expiringStandardsSoon} padrão(ões) expirando em 30 dias`;
  }
  return "Operação sem alertas executivos no período";
}

function buildReportScopeSummary(params: {
  selectedUnits: Array<{ id: number; name: string; slug: string }>;
  availableUnits: Array<{ id: number; name: string; slug: string }>;
}) {
  const unitsIncluded = params.selectedUnits.length;
  const isAllUnits = unitsIncluded === params.availableUnits.length;

  return {
    label: isAllUnits
      ? "Todas as unidades ativas"
      : `${unitsIncluded} unidade(s) selecionada(s)`,
    description: isAllUnits
      ? "Visão executiva consolidada para todas as unidades ativas acessíveis."
      : `Visão executiva filtrada para ${unitsIncluded} unidade(s).`,
    unitsIncluded,
    isAllUnits,
  };
}

async function resolveUnitIdForWrite(params: {
  organizationId: string;
  requestedUnitId?: number;
}) {
  const scope = await resolvePublicApiUnitScope({
    organizationId: params.organizationId,
    requestedUnitId: params.requestedUnitId ?? null,
  });

  if (params.requestedUnitId) {
    return params.requestedUnitId;
  }

  if (scope.selectedUnits.length === 1) {
    return scope.selectedUnits[0]!.id;
  }

  throw new Error("Informe unitId para operações de escrita multiunidade");
}

async function resolveExternalResourceId(params: {
  organizationId: string;
  resourceType: "customer" | "asset" | "request" | "job";
  value: string;
}) {
  const numericId = Number.parseInt(params.value, 10);
  if (!Number.isNaN(numericId) && String(numericId) === params.value) {
    return numericId;
  }

  const ref = await db.query.publicApiResourceRef.findFirst({
    where: and(
      eq(publicApiResourceRef.organizationId, params.organizationId),
      eq(publicApiResourceRef.resourceType, params.resourceType),
      eq(publicApiResourceRef.externalId, params.value),
    ),
  });

  if (!ref?.resourceId) {
    return null;
  }

  return Number.parseInt(ref.resourceId, 10);
}

async function resolveCustomerId(params: {
  organizationId: string;
  customerId?: number;
  customerExternalId?: string;
}) {
  if (params.customerId) {
    return params.customerId;
  }

  if (!params.customerExternalId) {
    return null;
  }

  return resolveExternalResourceId({
    organizationId: params.organizationId,
    resourceType: "customer",
    value: params.customerExternalId,
  });
}

async function resolveAssetId(params: {
  organizationId: string;
  assetId?: number;
  assetExternalId?: string;
}) {
  if (params.assetId) {
    return params.assetId;
  }

  if (!params.assetExternalId) {
    return null;
  }

  return resolveExternalResourceId({
    organizationId: params.organizationId,
    resourceType: "asset",
    value: params.assetExternalId,
  });
}

async function withIdempotentMutation(
  c: any,
  body: unknown,
  handler: () => Promise<{
    status: number;
    body: Record<string, unknown>;
    resourceType?: "customer" | "asset" | "request" | "job";
    resourceId?: string | number | null;
  }>,
) {
  const apiKey = c.get("apiKey");
  const key = getIdempotencyKey(c.req.raw.headers);

  if (!key) {
    return c.json(
      buildPublicApiError({
        code: "missing_idempotency_key",
        message: "Informe o header Idempotency-Key para operações de escrita",
      }),
      400,
    );
  }

  const requestHash = hashIdempotencyPayload(body);
  const requestPath = new URL(c.req.url).pathname;
  const existing = await findIdempotencyRecord({
    organizationId: apiKey.organizationId,
    apiKeyId: apiKey.id,
    requestMethod: c.req.method,
    requestPath,
    idempotencyKey: key,
  });

  if (existing) {
    if (existing.requestHash !== requestHash) {
      return c.json(
        buildPublicApiError({
          code: "idempotency_conflict",
          message:
            "A mesma Idempotency-Key já foi usada com um payload diferente",
        }),
        409,
      );
    }

    return c.json(
      existing.responseBody as Record<string, unknown>,
      existing.responseStatus,
    );
  }

  const result = await handler();

  await storeIdempotencyRecord({
    organizationId: apiKey.organizationId,
    apiKeyId: apiKey.id,
    requestMethod: c.req.method,
    requestPath,
    idempotencyKey: key,
    requestHash,
    responseStatus: result.status,
    responseBody: result.body,
    resourceType: result.resourceType,
    resourceId: result.resourceId,
  });

  return c.json(result.body, result.status);
}

function mapWebhookSubscription(
  record: typeof publicApiWebhookSubscription.$inferSelect,
) {
  return {
    id: record.id,
    name: record.name,
    targetUrl: record.targetUrl,
    events: record.events,
    status: record.status,
    secretPrefix: record.secretPrefix,
    lastSuccessAt: record.lastSuccessAt,
    lastFailureAt: record.lastFailureAt,
    consecutiveFailures: record.consecutiveFailures,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function buildPathParameter(name: string, description: string) {
  return {
    name,
    in: "path",
    required: true,
    description,
    schema: { type: "string" },
  };
}

function buildListOperation(
  summary: string,
  tag: string,
  extraParameters: any[] = [],
) {
  return {
    tags: [tag],
    summary,
    security: [{ ApiKeyAuth: [] }],
    parameters: [
      {
        name: "page",
        in: "query",
        schema: { type: "integer", minimum: 1, default: 1 },
      },
      {
        name: "limit",
        in: "query",
        schema: { type: "integer", minimum: 1, maximum: 100, default: 20 },
      },
      ...extraParameters,
    ],
    responses: {
      200: {
        description: "Lista retornada com sucesso",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                data: {
                  type: "array",
                  items: { type: "object", additionalProperties: true },
                },
                meta: { $ref: "#/components/schemas/ListMeta" },
              },
            },
          },
        },
      },
      401: { $ref: "#/components/responses/Unauthorized" },
      403: { $ref: "#/components/responses/Forbidden" },
    },
  };
}

function buildDetailOperation(
  summary: string,
  tag: string,
  idName = "id",
  idDescription = "Identificador interno ou externalId",
) {
  return {
    tags: [tag],
    summary,
    security: [{ ApiKeyAuth: [] }],
    parameters: [buildPathParameter(idName, idDescription)],
    responses: {
      200: {
        description: "Recurso retornado com sucesso",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                data: { type: "object", additionalProperties: true },
              },
            },
          },
        },
      },
      401: { $ref: "#/components/responses/Unauthorized" },
      403: { $ref: "#/components/responses/Forbidden" },
      404: { $ref: "#/components/responses/NotFound" },
    },
  };
}

function buildMutationOperation(params: {
  summary: string;
  tag: string;
  requestBodyDescription: string;
  responseStatus?: 200 | 201;
  pathParameters?: any[];
  idempotent?: boolean;
}) {
  const responseStatus = params.responseStatus ?? 200;

  return {
    tags: [params.tag],
    summary: params.summary,
    security: [{ ApiKeyAuth: [] }],
    parameters: [
      ...(params.pathParameters ?? []),
      ...(params.idempotent
        ? [
            {
              name: "Idempotency-Key",
              in: "header",
              required: true,
              description:
                "Chave obrigatória para evitar mutações duplicadas em integrações externas.",
              schema: { type: "string" },
            },
          ]
        : []),
    ],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            additionalProperties: true,
          },
          examples: {
            default: {
              summary: params.requestBodyDescription,
              value: {},
            },
          },
        },
      },
    },
    responses: {
      [responseStatus]: {
        description: "Mutação concluída com sucesso",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                data: { type: "object", additionalProperties: true },
              },
            },
          },
        },
      },
      400: { $ref: "#/components/responses/BadRequest" },
      401: { $ref: "#/components/responses/Unauthorized" },
      403: { $ref: "#/components/responses/Forbidden" },
      404: { $ref: "#/components/responses/NotFound" },
      409: { $ref: "#/components/responses/Conflict" },
    },
  };
}

function buildPublicApiV2OpenApiDocument(origin: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "CalibraFácil Public API",
      version: "2.0.0",
      description:
        "API pública resource-first para integrações e conectores operacionais do CalibraFácil.",
    },
    servers: [
      {
        url: `${origin}/api/public/v2`,
        description: "Current environment",
      },
    ],
    tags: [
      { name: "Customers" },
      { name: "Assets" },
      { name: "Requests" },
      { name: "Jobs" },
      { name: "Services" },
      { name: "Units" },
      { name: "Reports" },
      { name: "Certificates" },
      { name: "Webhooks" },
    ],
    security: [{ ApiKeyAuth: [] }],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: "apiKey",
          in: "header",
          name: "x-api-key",
          description:
            "Também aceita Authorization: Bearer <api-key> nas mesmas rotas.",
        },
      },
      schemas: {
        PublicError: {
          type: "object",
          required: ["error"],
          properties: {
            error: {
              type: "object",
              required: ["code", "message"],
              properties: {
                code: { type: "string" },
                message: { type: "string" },
                details: { type: "object", additionalProperties: true },
              },
            },
          },
        },
        ListMeta: {
          type: "object",
          properties: {
            page: { type: "integer" },
            limit: { type: "integer" },
            total: { type: "integer" },
            hasNextPage: { type: "boolean" },
            filters: { type: "object", additionalProperties: true },
          },
        },
      },
      responses: {
        BadRequest: {
          description: "Payload ou parâmetros inválidos",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/PublicError" },
            },
          },
        },
        Unauthorized: {
          description: "API key ausente ou inválida",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/PublicError" },
            },
          },
        },
        Forbidden: {
          description: "Scope insuficiente para a operação",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/PublicError" },
            },
          },
        },
        NotFound: {
          description: "Recurso não encontrado",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/PublicError" },
            },
          },
        },
        Conflict: {
          description: "Conflito de domínio, externalId ou estado",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/PublicError" },
            },
          },
        },
      },
    },
    paths: {
      "/customers": {
        get: buildListOperation("Listar clientes", "Customers", [
          { name: "query", in: "query", schema: { type: "string" } },
        ]),
        post: buildMutationOperation({
          summary: "Criar cliente",
          tag: "Customers",
          requestBodyDescription:
            "Cria um cliente. Aceita externalId para mapeamento estável e exige Idempotency-Key.",
          responseStatus: 201,
          idempotent: true,
        }),
      },
      "/customers/{id}": {
        get: buildDetailOperation("Obter cliente", "Customers"),
        put: buildMutationOperation({
          summary: "Atualizar cliente",
          tag: "Customers",
          requestBodyDescription:
            "Atualiza nome, contato e externalId do cliente.",
          pathParameters: [
            buildPathParameter("id", "Identificador interno ou externalId"),
          ],
        }),
        delete: {
          tags: ["Customers"],
          summary: "Excluir cliente",
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            buildPathParameter("id", "Identificador interno ou externalId"),
            {
              name: "Idempotency-Key",
              in: "header",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            200: {
              description: "Cliente excluído",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: { type: "object", additionalProperties: true },
                    },
                  },
                },
              },
            },
            401: { $ref: "#/components/responses/Unauthorized" },
            403: { $ref: "#/components/responses/Forbidden" },
            404: { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/assets": {
        get: buildListOperation("Listar ativos", "Assets", [
          { name: "query", in: "query", schema: { type: "string" } },
          { name: "unitId", in: "query", schema: { type: "integer" } },
          { name: "customerId", in: "query", schema: { type: "integer" } },
          {
            name: "customerExternalId",
            in: "query",
            schema: { type: "string" },
          },
          { name: "status", in: "query", schema: { type: "string" } },
        ]),
        post: buildMutationOperation({
          summary: "Criar ativo",
          tag: "Assets",
          requestBodyDescription:
            "Cria um ativo associado a cliente e unidade, com externalId opcional e Idempotency-Key obrigatória.",
          responseStatus: 201,
          idempotent: true,
        }),
      },
      "/assets/{id}": {
        get: buildDetailOperation("Obter ativo", "Assets"),
        put: buildMutationOperation({
          summary: "Atualizar ativo",
          tag: "Assets",
          requestBodyDescription: "Atualiza dados operacionais do ativo.",
          pathParameters: [
            buildPathParameter("id", "Identificador interno ou externalId"),
          ],
        }),
        delete: {
          tags: ["Assets"],
          summary: "Excluir ativo",
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            buildPathParameter("id", "Identificador interno ou externalId"),
            {
              name: "Idempotency-Key",
              in: "header",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            200: {
              description: "Ativo excluído",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: { type: "object", additionalProperties: true },
                    },
                  },
                },
              },
            },
            401: { $ref: "#/components/responses/Unauthorized" },
            403: { $ref: "#/components/responses/Forbidden" },
            404: { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/services": {
        get: buildListOperation("Listar serviços", "Services", [
          { name: "query", in: "query", schema: { type: "string" } },
          { name: "isActive", in: "query", schema: { type: "string" } },
        ]),
      },
      "/services/{id}": {
        get: buildDetailOperation("Obter serviço", "Services"),
      },
      "/units": {
        get: {
          tags: ["Units"],
          summary: "Listar unidades acessíveis",
          security: [{ ApiKeyAuth: [] }],
          responses: {
            200: {
              description: "Lista de unidades acessíveis",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: {
                        type: "array",
                        items: { type: "object", additionalProperties: true },
                      },
                    },
                  },
                },
              },
            },
            401: { $ref: "#/components/responses/Unauthorized" },
            403: { $ref: "#/components/responses/Forbidden" },
          },
        },
      },
      "/units/{id}": {
        get: buildDetailOperation(
          "Obter unidade",
          "Units",
          "id",
          "Identificador interno da unidade",
        ),
      },
      "/reports/consolidated/executive-overview": {
        get: {
          tags: ["Reports"],
          summary: "Visão executiva consolidada",
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            {
              name: "period",
              in: "query",
              schema: { type: "string", enum: ["7d", "30d", "90d", "month"] },
            },
            { name: "unitIds", in: "query", schema: { type: "string" } },
          ],
          responses: {
            200: {
              description: "Resumo executivo consolidado",
              content: {
                "application/json": {
                  schema: { type: "object", additionalProperties: true },
                },
              },
            },
            401: { $ref: "#/components/responses/Unauthorized" },
            403: { $ref: "#/components/responses/Forbidden" },
          },
        },
      },
      "/reports/consolidated/comparison": {
        get: {
          tags: ["Reports"],
          summary: "Comparativo consolidado por unidade",
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            {
              name: "period",
              in: "query",
              schema: { type: "string", enum: ["7d", "30d", "90d", "month"] },
            },
            { name: "unitIds", in: "query", schema: { type: "string" } },
          ],
          responses: {
            200: {
              description: "Comparativo consolidado",
              content: {
                "application/json": {
                  schema: { type: "object", additionalProperties: true },
                },
              },
            },
            401: { $ref: "#/components/responses/Unauthorized" },
            403: { $ref: "#/components/responses/Forbidden" },
          },
        },
      },
      "/certificates": {
        get: buildListOperation("Listar certificados", "Certificates", [
          { name: "query", in: "query", schema: { type: "string" } },
          { name: "unitId", in: "query", schema: { type: "integer" } },
        ]),
      },
      "/certificates/{jobId}": {
        get: buildDetailOperation(
          "Obter metadados do certificado",
          "Certificates",
          "jobId",
          "Identificador do job",
        ),
      },
      "/certificates/{jobId}/download": {
        get: {
          tags: ["Certificates"],
          summary: "Baixar PDF do certificado",
          security: [{ ApiKeyAuth: [] }],
          parameters: [buildPathParameter("jobId", "Identificador do job")],
          responses: {
            200: {
              description: "Arquivo PDF do certificado",
              content: {
                "application/pdf": {
                  schema: { type: "string", format: "binary" },
                },
              },
            },
            401: { $ref: "#/components/responses/Unauthorized" },
            403: { $ref: "#/components/responses/Forbidden" },
            404: { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/requests": {
        get: buildListOperation("Listar solicitações", "Requests", [
          { name: "query", in: "query", schema: { type: "string" } },
          { name: "status", in: "query", schema: { type: "string" } },
          { name: "customerId", in: "query", schema: { type: "integer" } },
          {
            name: "customerExternalId",
            in: "query",
            schema: { type: "string" },
          },
          { name: "unitId", in: "query", schema: { type: "integer" } },
        ]),
        post: buildMutationOperation({
          summary: "Criar solicitação",
          tag: "Requests",
          requestBodyDescription:
            "Cria uma solicitação de calibração com cliente, ativos e unidade. Exige Idempotency-Key.",
          responseStatus: 201,
          idempotent: true,
        }),
      },
      "/requests/{id}": {
        get: buildDetailOperation("Obter solicitação", "Requests"),
        patch: buildMutationOperation({
          summary: "Atualizar solicitação",
          tag: "Requests",
          requestBodyDescription: "Atualiza observações e data solicitada.",
          pathParameters: [
            buildPathParameter("id", "Identificador interno ou externalId"),
          ],
        }),
      },
      "/requests/{id}/cancel": {
        post: buildMutationOperation({
          summary: "Cancelar solicitação",
          tag: "Requests",
          requestBodyDescription: "Cancela a solicitação com motivo explícito.",
          pathParameters: [
            buildPathParameter("id", "Identificador interno ou externalId"),
          ],
          idempotent: true,
        }),
      },
      "/jobs": {
        get: buildListOperation("Listar ordens de serviço", "Jobs", [
          { name: "query", in: "query", schema: { type: "string" } },
          { name: "status", in: "query", schema: { type: "string" } },
          { name: "customerId", in: "query", schema: { type: "integer" } },
          {
            name: "customerExternalId",
            in: "query",
            schema: { type: "string" },
          },
          { name: "assetId", in: "query", schema: { type: "integer" } },
          { name: "assetExternalId", in: "query", schema: { type: "string" } },
          { name: "serviceId", in: "query", schema: { type: "integer" } },
          { name: "unitId", in: "query", schema: { type: "integer" } },
        ]),
        post: buildMutationOperation({
          summary: "Criar ordem de serviço",
          tag: "Jobs",
          requestBodyDescription:
            "Cria uma OS vinculada a ativo e serviço. Exige Idempotency-Key.",
          responseStatus: 201,
          idempotent: true,
        }),
      },
      "/jobs/{id}": {
        get: buildDetailOperation("Obter ordem de serviço", "Jobs"),
        patch: buildMutationOperation({
          summary: "Atualizar ordem de serviço",
          tag: "Jobs",
          requestBodyDescription: "Atualiza campos mutáveis da OS.",
          pathParameters: [
            buildPathParameter("id", "Identificador interno ou externalId"),
          ],
        }),
        delete: buildMutationOperation({
          summary: "Cancelar ordem de serviço",
          tag: "Jobs",
          requestBodyDescription: "Cancela a OS com motivo explícito.",
          pathParameters: [
            buildPathParameter("id", "Identificador interno ou externalId"),
          ],
        }),
      },
      "/jobs/{id}/results": {
        post: buildMutationOperation({
          summary: "Registrar resultados da OS",
          tag: "Jobs",
          requestBodyDescription: "Envia resultados executados para o job.",
          pathParameters: [
            buildPathParameter("id", "Identificador interno ou externalId"),
          ],
        }),
      },
      "/jobs/{id}/submit": {
        post: buildMutationOperation({
          summary: "Submeter OS para revisão",
          tag: "Jobs",
          requestBodyDescription: "Submete o job para etapa de revisão.",
          pathParameters: [
            buildPathParameter("id", "Identificador interno ou externalId"),
          ],
        }),
      },
      "/jobs/{id}/approve": {
        post: buildMutationOperation({
          summary: "Aprovar OS",
          tag: "Jobs",
          requestBodyDescription:
            "Aprova o job e libera certificado quando aplicável.",
          pathParameters: [
            buildPathParameter("id", "Identificador interno ou externalId"),
          ],
        }),
      },
      "/jobs/{id}/reject": {
        post: buildMutationOperation({
          summary: "Rejeitar OS",
          tag: "Jobs",
          requestBodyDescription: "Rejeita o job com motivo explícito.",
          pathParameters: [
            buildPathParameter("id", "Identificador interno ou externalId"),
          ],
        }),
      },
      "/webhooks": {
        get: {
          tags: ["Webhooks"],
          summary: "Listar subscriptions de webhook",
          security: [{ ApiKeyAuth: [] }],
          responses: {
            200: {
              description: "Lista de subscriptions",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: {
                        type: "array",
                        items: { type: "object", additionalProperties: true },
                      },
                    },
                  },
                },
              },
            },
            401: { $ref: "#/components/responses/Unauthorized" },
            403: { $ref: "#/components/responses/Forbidden" },
          },
        },
        post: buildMutationOperation({
          summary: "Criar subscription de webhook",
          tag: "Webhooks",
          requestBodyDescription:
            "Configura endpoint, eventos e status da subscription.",
          responseStatus: 201,
        }),
      },
      "/webhooks/{id}": {
        patch: buildMutationOperation({
          summary: "Atualizar subscription de webhook",
          tag: "Webhooks",
          requestBodyDescription:
            "Atualiza nome, eventos, status ou URL do destino.",
          pathParameters: [
            buildPathParameter("id", "Identificador da subscription"),
          ],
        }),
        delete: {
          tags: ["Webhooks"],
          summary: "Excluir subscription de webhook",
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            buildPathParameter("id", "Identificador da subscription"),
          ],
          responses: {
            200: {
              description: "Subscription excluída",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: { type: "object", additionalProperties: true },
                    },
                  },
                },
              },
            },
            401: { $ref: "#/components/responses/Unauthorized" },
            403: { $ref: "#/components/responses/Forbidden" },
            404: { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/webhooks/{id}/test": {
        post: {
          tags: ["Webhooks"],
          summary: "Disparar delivery de teste",
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            buildPathParameter("id", "Identificador da subscription"),
          ],
          responses: {
            200: {
              description: "Delivery de teste emitido",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: { type: "object", additionalProperties: true },
                    },
                  },
                },
              },
            },
            401: { $ref: "#/components/responses/Unauthorized" },
            403: { $ref: "#/components/responses/Forbidden" },
            404: { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/webhooks/{id}/deliveries": {
        get: {
          tags: ["Webhooks"],
          summary: "Listar deliveries do webhook",
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            buildPathParameter("id", "Identificador da subscription"),
          ],
          responses: {
            200: {
              description: "Histórico de deliveries",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: {
                        type: "array",
                        items: { type: "object", additionalProperties: true },
                      },
                    },
                  },
                },
              },
            },
            401: { $ref: "#/components/responses/Unauthorized" },
            403: { $ref: "#/components/responses/Forbidden" },
            404: { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/webhooks/{id}/deliveries/{deliveryId}/replay": {
        post: {
          tags: ["Webhooks"],
          summary: "Reprocessar delivery",
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            buildPathParameter("id", "Identificador da subscription"),
            buildPathParameter("deliveryId", "Identificador do delivery"),
          ],
          responses: {
            200: {
              description: "Replay enfileirado com sucesso",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: { type: "object", additionalProperties: true },
                    },
                  },
                },
              },
            },
            401: { $ref: "#/components/responses/Unauthorized" },
            403: { $ref: "#/components/responses/Forbidden" },
            404: { $ref: "#/components/responses/NotFound" },
          },
        },
      },
    },
  };
}

export const publicApiV2Router = new Hono<{
  Variables: ApiKeyAuthVariables;
  Bindings: R2Env & {
    PUBLIC_API_MASTER_KEY?: string;
    INTEGRATIONS_MASTER_KEY?: string;
  };
}>();

export const publicApiV2DocsRouter = new Hono<{
  Variables: AuthVariables;
  Bindings: R2Env & {
    PUBLIC_API_MASTER_KEY?: string;
    INTEGRATIONS_MASTER_KEY?: string;
  };
}>()
  .use("*", ...requireLabProtected)
  .use("*", requireOrgType("LAB"))
  .use("*", requireRole(["admin", "owner"]))
  .use("*", requireFeature("api"));

publicApiV2DocsRouter.get("/openapi", (c) => {
  const origin = new URL(c.req.url).origin;
  return c.json(buildPublicApiV2OpenApiDocument(origin));
});

publicApiV2DocsRouter.get(
  "/reference",
  Scalar({
    url: "/api/public/v2/openapi",
    pageTitle: "CalibraFácil Public API",
    theme: "bluePlanet",
    defaultHttpClient: {
      targetKey: "js",
      clientKey: "fetch",
    },
  }),
);

publicApiV2Router
  .use("*", requireApiKeyAuth)
  .get(
    "/customers",
    requireApiScope("customers:read"),
    zValidator("query", ListQuerySchema),
    async (c) => {
      const apiKey = c.get("apiKey");
      const { page, limit, query } = c.req.valid("query");
      const offset = (page - 1) * limit;
      const conditions = [
        eq(customer.labOrganizationId, apiKey.organizationId),
      ];
      if (query) {
        conditions.push(
          or(
            ilike(customer.name, `%${query}%`),
            ilike(customer.taxId, `%${query}%`),
            ilike(customer.email, `%${query}%`),
          )!,
        );
      }

      const [countResult, rows] = await Promise.all([
        db
          .select({ total: count() })
          .from(customer)
          .where(and(...conditions)),
        db
          .select({
            id: customer.id,
            name: customer.name,
            taxId: customer.taxId,
            email: customer.email,
            phone: customer.phone,
            address: customer.address,
            createdAt: customer.createdAt,
            updatedAt: customer.updatedAt,
          })
          .from(customer)
          .where(and(...conditions))
          .orderBy(customer.name)
          .limit(limit)
          .offset(offset),
      ]);

      const externalIds = await getResourceExternalIdMap({
        organizationId: apiKey.organizationId,
        resourceType: "customer",
        resourceIds: rows.map((row) => row.id),
      });

      return c.json({
        data: rows.map((row) => ({
          ...row,
          externalId: externalIds.get(String(row.id)) ?? null,
        })),
        meta: buildListMeta({
          page,
          limit,
          total: countResult[0]?.total ?? 0,
          filters: { query: query ?? null },
        }),
      });
    },
  )
  .get("/customers/:id", requireApiScope("customers:read"), async (c) => {
    const apiKey = c.get("apiKey");
    const resolvedId = await resolveExternalResourceId({
      organizationId: apiKey.organizationId,
      resourceType: "customer",
      value: c.req.param("id"),
    });

    if (!resolvedId) {
      return c.json(
        buildPublicApiError({
          code: "customer_not_found",
          message: "Cliente não encontrado",
        }),
        404,
      );
    }

    const [found] = await db
      .select()
      .from(customer)
      .where(
        and(
          eq(customer.id, resolvedId),
          eq(customer.labOrganizationId, apiKey.organizationId),
        ),
      )
      .limit(1);

    if (!found) {
      return c.json(
        buildPublicApiError({
          code: "customer_not_found",
          message: "Cliente não encontrado",
        }),
        404,
      );
    }

    return c.json({
      data: {
        ...found,
        externalId: await getResourceExternalId({
          organizationId: apiKey.organizationId,
          resourceType: "customer",
          resourceId: found.id,
        }),
      },
    });
  })
  .post(
    "/customers",
    requireApiScope("customers:write"),
    zValidator(
      "json",
      CreateCustomerSchema.extend({ externalId: z.string().trim().optional() }),
    ),
    async (c) => {
      const apiKey = c.get("apiKey");
      const input = c.req.valid("json");

      return withIdempotentMutation(c, input, async () => {
        const slug = generateUniqueSlug(input.name);
        const orgResult = await createClientOrganizationAsServiceOwner({
          name: input.name,
          slug,
        });

        if (!orgResult?.id) {
          return {
            status: 500,
            body: buildPublicApiError({
              code: "customer_create_failed",
              message: "Falha ao criar organização do cliente",
            }),
          };
        }

        const [created] = await db
          .insert(customer)
          .values({
            name: input.name,
            taxId: input.taxId || null,
            email: input.email || null,
            phone: input.phone || null,
            address: input.address || null,
            authOrganizationId: orgResult.id,
            labOrganizationId: apiKey.organizationId,
          })
          .returning();

        await db.insert(customerAuditLog).values({
          customerId: created!.id,
          action: "create",
          changes: { customer: { old: null, new: created } },
          performedBy: apiKey.createdBy,
          ipAddress: getPublicApiRequestIp(c.req.raw.headers),
        });

        const externalId = input.externalId?.trim();
        if (externalId) {
          await upsertResourceExternalId({
            organizationId: apiKey.organizationId,
            apiKeyId: apiKey.id,
            resourceType: "customer",
            resourceId: created!.id,
            externalId,
          });
        }

        const body = {
          data: {
            ...created,
            externalId: externalId ?? null,
          },
        };

        await emitPublicApiWebhookEvent({
          organizationId: apiKey.organizationId,
          eventType: "customer.created",
          payload: body.data,
          env: c.env,
        });

        return {
          status: 201,
          body,
          resourceType: "customer" as const,
          resourceId: created!.id,
        };
      });
    },
  )
  .put(
    "/customers/:id",
    requireApiScope("customers:write"),
    zValidator(
      "json",
      UpdateCustomerSchema.extend({ externalId: z.string().trim().optional() }),
    ),
    async (c) => {
      const apiKey = c.get("apiKey");
      const input = c.req.valid("json");
      const resolvedId = await resolveExternalResourceId({
        organizationId: apiKey.organizationId,
        resourceType: "customer",
        value: c.req.param("id"),
      });

      if (!resolvedId) {
        return c.json(
          buildPublicApiError({
            code: "customer_not_found",
            message: "Cliente não encontrado",
          }),
          404,
        );
      }

      const [existing] = await db
        .select()
        .from(customer)
        .where(
          and(
            eq(customer.id, resolvedId),
            eq(customer.labOrganizationId, apiKey.organizationId),
          ),
        )
        .limit(1);

      if (!existing) {
        return c.json(
          buildPublicApiError({
            code: "customer_not_found",
            message: "Cliente não encontrado",
          }),
          404,
        );
      }

      const [updated] = await db
        .update(customer)
        .set({
          name: input.name ?? existing.name,
          taxId: input.taxId ?? existing.taxId,
          email: input.email ?? existing.email,
          phone: input.phone ?? existing.phone,
          address: input.address ?? existing.address,
        })
        .where(eq(customer.id, existing.id))
        .returning();

      await db.insert(customerAuditLog).values({
        customerId: existing.id,
        action: "update",
        changes: { customer: { old: existing, new: updated } },
        performedBy: apiKey.createdBy,
        ipAddress: getPublicApiRequestIp(c.req.raw.headers),
      });

      const externalId = input.externalId?.trim();
      if (externalId) {
        await upsertResourceExternalId({
          organizationId: apiKey.organizationId,
          apiKeyId: apiKey.id,
          resourceType: "customer",
          resourceId: existing.id,
          externalId,
        });
      }

      const body = {
        data: {
          ...updated,
          externalId:
            externalId ??
            (await getResourceExternalId({
              organizationId: apiKey.organizationId,
              resourceType: "customer",
              resourceId: existing.id,
            })),
        },
      };

      await emitPublicApiWebhookEvent({
        organizationId: apiKey.organizationId,
        eventType: "customer.updated",
        payload: body.data,
        env: c.env,
      });

      return c.json(body);
    },
  )
  .delete("/customers/:id", requireApiScope("customers:write"), async (c) => {
    const apiKey = c.get("apiKey");
    const resolvedId = await resolveExternalResourceId({
      organizationId: apiKey.organizationId,
      resourceType: "customer",
      value: c.req.param("id"),
    });

    if (!resolvedId) {
      return c.json(
        buildPublicApiError({
          code: "customer_not_found",
          message: "Cliente não encontrado",
        }),
        404,
      );
    }

    return withIdempotentMutation(c, { customerId: resolvedId }, async () => {
      const [existing] = await db
        .select()
        .from(customer)
        .where(
          and(
            eq(customer.id, resolvedId),
            eq(customer.labOrganizationId, apiKey.organizationId),
          ),
        )
        .limit(1);

      if (!existing) {
        return {
          status: 404,
          body: buildPublicApiError({
            code: "customer_not_found",
            message: "Cliente não encontrado",
          }),
        };
      }

      await db.insert(customerAuditLog).values({
        customerId: existing.id,
        action: "delete",
        changes: { customer: { old: existing, new: null } },
        performedBy: apiKey.createdBy,
        ipAddress: getPublicApiRequestIp(c.req.raw.headers),
      });

      await db.delete(customer).where(eq(customer.id, existing.id));
      await db
        .delete(organization)
        .where(eq(organization.id, existing.authOrganizationId));

      const body = { data: { id: existing.id, deleted: true } };

      await emitPublicApiWebhookEvent({
        organizationId: apiKey.organizationId,
        eventType: "customer.deleted",
        payload: {
          id: existing.id,
          externalId: await getResourceExternalId({
            organizationId: apiKey.organizationId,
            resourceType: "customer",
            resourceId: existing.id,
          }),
        },
        env: c.env,
      });

      return {
        status: 200,
        body,
        resourceType: "customer" as const,
        resourceId: existing.id,
      };
    });
  })
  .get(
    "/assets",
    requireApiScope("assets:read"),
    zValidator(
      "query",
      ListQuerySchema.extend({
        customerId: z.coerce.number().optional(),
        customerExternalId: z.string().trim().optional(),
        status: z.string().trim().optional(),
      }),
    ),
    async (c) => {
      const apiKey = c.get("apiKey");
      const {
        page,
        limit,
        query,
        unitId,
        customerId,
        customerExternalId,
        status,
      } = c.req.valid("query");
      const offset = (page - 1) * limit;
      const resolvedCustomerId = await resolveCustomerId({
        organizationId: apiKey.organizationId,
        customerId,
        customerExternalId,
      });

      const conditions = [
        eq(customer.labOrganizationId, apiKey.organizationId),
        isNull(asset.deletedAt),
        unitId ? eq(asset.unitId, unitId) : undefined,
        resolvedCustomerId
          ? eq(asset.customerId, resolvedCustomerId)
          : undefined,
        status ? eq(asset.status, status as any) : undefined,
        query
          ? or(
              ilike(asset.name, `%${query}%`),
              ilike(asset.tag, `%${query}%`),
              ilike(asset.serialNumber, `%${query}%`),
            )
          : undefined,
      ];

      const [countResult, rows] = await Promise.all([
        db
          .select({ total: count() })
          .from(asset)
          .innerJoin(customer, eq(asset.customerId, customer.id))
          .where(and(...conditions)),
        db
          .select({
            id: asset.id,
            unitId: asset.unitId,
            customerId: asset.customerId,
            customerName: customer.name,
            assetTypeId: asset.assetTypeId,
            assetTypeDefinition: assetType.definition,
            name: asset.name,
            tag: asset.tag,
            serialNumber: asset.serialNumber,
            manufacturer: asset.manufacturer,
            model: asset.model,
            status: asset.status,
            baseMeasurementUnit: asset.baseMeasurementUnit,
            lastCalibrationDate: asset.lastCalibrationDate,
            nextCalibrationDate: asset.nextCalibrationDate,
            specifications: asset.specifications,
            createdAt: asset.createdAt,
            updatedAt: asset.updatedAt,
          })
          .from(asset)
          .innerJoin(customer, eq(asset.customerId, customer.id))
          .innerJoin(assetType, eq(asset.assetTypeId, assetType.id))
          .where(and(...conditions))
          .orderBy(asset.name)
          .limit(limit)
          .offset(offset),
      ]);

      const externalIds = await getResourceExternalIdMap({
        organizationId: apiKey.organizationId,
        resourceType: "asset",
        resourceIds: rows.map((row) => row.id),
      });

      return c.json({
        data: rows.map((row) => ({
          ...row,
          specifications:
            denormalizeAssetSpecificationsForResponse({
              specifications: row.specifications,
              definition: row.assetTypeDefinition,
              baseMeasurementUnit: row.baseMeasurementUnit,
            }) ?? null,
          externalId: externalIds.get(String(row.id)) ?? null,
        })),
        meta: buildListMeta({
          page,
          limit,
          total: countResult[0]?.total ?? 0,
          filters: {
            query: query ?? null,
            unitId: unitId ?? null,
            customerId: resolvedCustomerId ?? null,
            status: status ?? null,
          },
        }),
      });
    },
  )
  .get("/assets/:id", requireApiScope("assets:read"), async (c) => {
    const apiKey = c.get("apiKey");
    const resolvedId = await resolveExternalResourceId({
      organizationId: apiKey.organizationId,
      resourceType: "asset",
      value: c.req.param("id"),
    });

    if (!resolvedId) {
      return c.json(
        buildPublicApiError({
          code: "asset_not_found",
          message: "Ativo não encontrado",
        }),
        404,
      );
    }

    const [found] = await db
      .select({
        id: asset.id,
        unitId: asset.unitId,
        customerId: asset.customerId,
        customerName: customer.name,
        assetTypeId: asset.assetTypeId,
        assetTypeDefinition: assetType.definition,
        name: asset.name,
        tag: asset.tag,
        serialNumber: asset.serialNumber,
        manufacturer: asset.manufacturer,
        model: asset.model,
        status: asset.status,
        baseMeasurementUnit: asset.baseMeasurementUnit,
        lastCalibrationDate: asset.lastCalibrationDate,
        nextCalibrationDate: asset.nextCalibrationDate,
        comments: asset.comments,
        specifications: asset.specifications,
        createdAt: asset.createdAt,
        updatedAt: asset.updatedAt,
      })
      .from(asset)
      .innerJoin(customer, eq(asset.customerId, customer.id))
      .innerJoin(assetType, eq(asset.assetTypeId, assetType.id))
      .where(
        and(
          eq(asset.id, resolvedId),
          eq(customer.labOrganizationId, apiKey.organizationId),
          isNull(asset.deletedAt),
        ),
      )
      .limit(1);

    if (!found) {
      return c.json(
        buildPublicApiError({
          code: "asset_not_found",
          message: "Ativo não encontrado",
        }),
        404,
      );
    }

    return c.json({
      data: {
        ...found,
        specifications:
          denormalizeAssetSpecificationsForResponse({
            specifications: found.specifications,
            definition: found.assetTypeDefinition,
            baseMeasurementUnit: found.baseMeasurementUnit,
          }) ?? null,
        externalId: await getResourceExternalId({
          organizationId: apiKey.organizationId,
          resourceType: "asset",
          resourceId: found.id,
        }),
      },
    });
  })
  .post(
    "/assets",
    requireApiScope("assets:write"),
    zValidator("json", AssetCreatePublicSchema),
    async (c) => {
      const apiKey = c.get("apiKey");
      const input = c.req.valid("json");

      return withIdempotentMutation(c, input, async () => {
        const resolvedCustomerId = await resolveCustomerId({
          organizationId: apiKey.organizationId,
          customerId: input.customerId,
          customerExternalId: input.customerExternalId,
        });

        if (!resolvedCustomerId) {
          return {
            status: 404,
            body: buildPublicApiError({
              code: "customer_not_found",
              message: "Cliente não encontrado",
            }),
          };
        }

        const [foundCustomer, foundType, existingTag] = await Promise.all([
          db.query.customer.findFirst({
            where: and(
              eq(customer.id, resolvedCustomerId),
              eq(customer.labOrganizationId, apiKey.organizationId),
            ),
          }),
          db.query.assetType.findFirst({
            where: eq(assetType.id, input.assetTypeId),
          }),
          db.query.asset.findFirst({
            where: eq(asset.tag, input.tag),
          }),
        ]);

        if (!foundCustomer) {
          return {
            status: 404,
            body: buildPublicApiError({
              code: "customer_not_found",
              message: "Cliente não encontrado",
            }),
          };
        }

        if (!foundType) {
          return {
            status: 404,
            body: buildPublicApiError({
              code: "asset_type_not_found",
              message: "Tipo de instrumento não encontrado",
            }),
          };
        }

        if (existingTag) {
          return {
            status: 409,
            body: buildPublicApiError({
              code: "asset_tag_conflict",
              message: "Tag já está em uso",
            }),
          };
        }

        const unitId = await resolveUnitIdForWrite({
          organizationId: apiKey.organizationId,
          requestedUnitId: input.unitId,
        });
        const baseMeasurementUnitResult = resolveAssetBaseMeasurementUnit(
          foundType,
          input.baseMeasurementUnit,
        );

        if (!baseMeasurementUnitResult.ok) {
          return {
            status: 400,
            body: buildPublicApiError({
              code: "asset_base_measurement_unit_required",
              message: baseMeasurementUnitResult.error,
            }),
          };
        }
        const normalizedSpecifications = normalizeAssetSpecificationsFromInput({
          specifications: input.specifications || null,
          definition: foundType.definition,
          baseMeasurementUnit: baseMeasurementUnitResult.baseMeasurementUnit,
        });

        const [created] = await db
          .insert(asset)
          .values({
            unitId,
            customerId: foundCustomer.id,
            assetTypeId: input.assetTypeId,
            name: input.name,
            manufacturer: input.manufacturer || null,
            model: input.model || null,
            serialNumber: input.serialNumber,
            tag: input.tag,
            status: input.status || "ACTIVE",
            baseMeasurementUnit: baseMeasurementUnitResult.baseMeasurementUnit,
            lastCalibrationDate: input.lastCalibrationDate
              ? new Date(input.lastCalibrationDate)
              : null,
            nextCalibrationDate: input.nextCalibrationDate
              ? new Date(input.nextCalibrationDate)
              : null,
            comments: input.comments || null,
            specifications: normalizedSpecifications.specifications || null,
          })
          .returning();

        await db.insert(assetAuditLog).values({
          assetId: created!.id,
          action: "create",
          changes: {
            asset: { old: null, new: created },
            unitConversions:
              normalizedSpecifications.conversions.length > 0
                ? normalizedSpecifications.conversions
                : undefined,
          },
          performedBy: apiKey.createdBy,
          ipAddress: getPublicApiRequestIp(c.req.raw.headers),
        });

        const externalId = input.externalId?.trim();
        if (externalId) {
          await upsertResourceExternalId({
            organizationId: apiKey.organizationId,
            apiKeyId: apiKey.id,
            resourceType: "asset",
            resourceId: created!.id,
            externalId,
          });
        }

        const body = {
          data: {
            ...created,
            specifications:
              denormalizeAssetSpecificationsForResponse({
                specifications: created!.specifications,
                definition: foundType.definition,
                baseMeasurementUnit: created!.baseMeasurementUnit,
              }) ?? null,
            externalId: externalId ?? null,
          },
        };

        await emitPublicApiWebhookEvent({
          organizationId: apiKey.organizationId,
          eventType: "asset.created",
          payload: body.data,
          env: c.env,
        });

        return {
          status: 201,
          body,
          resourceType: "asset" as const,
          resourceId: created!.id,
        };
      });
    },
  )
  .put(
    "/assets/:id",
    requireApiScope("assets:write"),
    zValidator(
      "json",
      UpdateAssetSchema.extend({ externalId: z.string().trim().optional() }),
    ),
    async (c) => {
      const apiKey = c.get("apiKey");
      const input = c.req.valid("json");
      const resolvedId = await resolveExternalResourceId({
        organizationId: apiKey.organizationId,
        resourceType: "asset",
        value: c.req.param("id"),
      });

      if (!resolvedId) {
        return c.json(
          buildPublicApiError({
            code: "asset_not_found",
            message: "Ativo não encontrado",
          }),
          404,
        );
      }

      const [existing] = await db
        .select({
          id: asset.id,
          deletedAt: asset.deletedAt,
          customerId: asset.customerId,
          assetTypeId: asset.assetTypeId,
          baseMeasurementUnit: asset.baseMeasurementUnit,
          name: asset.name,
          manufacturer: asset.manufacturer,
          model: asset.model,
          serialNumber: asset.serialNumber,
          tag: asset.tag,
          status: asset.status,
          lastCalibrationDate: asset.lastCalibrationDate,
          nextCalibrationDate: asset.nextCalibrationDate,
          comments: asset.comments,
          specifications: asset.specifications,
          assetTypeDefinition: assetType.definition,
        })
        .from(asset)
        .innerJoin(customer, eq(asset.customerId, customer.id))
        .innerJoin(assetType, eq(asset.assetTypeId, assetType.id))
        .where(
          and(
            eq(asset.id, resolvedId),
            eq(customer.labOrganizationId, apiKey.organizationId),
            isNull(asset.deletedAt),
          ),
        )
        .limit(1);

      if (!existing) {
        return c.json(
          buildPublicApiError({
            code: "asset_not_found",
            message: "Ativo não encontrado",
          }),
          404,
        );
      }

      if (input.tag && input.tag !== existing.tag) {
        const tagConflict = await db.query.asset.findFirst({
          where: and(eq(asset.tag, input.tag), isNull(asset.deletedAt)),
        });
        if (tagConflict) {
          return c.json(
            buildPublicApiError({
              code: "asset_tag_conflict",
              message: "Tag já está em uso",
            }),
            409,
          );
        }
      }

      const normalizedSpecifications =
        input.specifications !== undefined
          ? normalizeAssetSpecificationsFromInput({
              specifications: input.specifications ?? null,
              definition: existing.assetTypeDefinition,
              baseMeasurementUnit: existing.baseMeasurementUnit,
            })
          : null;

      const [updated] = await db
        .update(asset)
        .set({
          name: input.name ?? existing.name,
          manufacturer: input.manufacturer ?? existing.manufacturer,
          model: input.model ?? existing.model,
          serialNumber: input.serialNumber ?? existing.serialNumber,
          tag: input.tag ?? existing.tag,
          status: input.status ?? existing.status,
          lastCalibrationDate:
            input.lastCalibrationDate === undefined
              ? existing.lastCalibrationDate
              : input.lastCalibrationDate
                ? new Date(input.lastCalibrationDate)
                : null,
          nextCalibrationDate:
            input.nextCalibrationDate === undefined
              ? existing.nextCalibrationDate
              : input.nextCalibrationDate
                ? new Date(input.nextCalibrationDate)
                : null,
          comments: input.comments ?? existing.comments,
          specifications:
            normalizedSpecifications?.specifications ?? existing.specifications,
        })
        .where(eq(asset.id, existing.id))
        .returning();

      await db.insert(assetAuditLog).values({
        assetId: existing.id,
        action: "update",
        changes: {
          asset: { old: existing, new: updated },
          unitConversions: normalizedSpecifications?.conversions.length
            ? normalizedSpecifications.conversions
            : undefined,
        },
        performedBy: apiKey.createdBy,
        ipAddress: getPublicApiRequestIp(c.req.raw.headers),
      });

      const externalId = input.externalId?.trim();
      if (externalId) {
        await upsertResourceExternalId({
          organizationId: apiKey.organizationId,
          apiKeyId: apiKey.id,
          resourceType: "asset",
          resourceId: existing.id,
          externalId,
        });
      }

      const body = {
        data: {
          ...updated,
          externalId:
            externalId ??
            (await getResourceExternalId({
              organizationId: apiKey.organizationId,
              resourceType: "asset",
              resourceId: existing.id,
            })),
        },
      };

      await emitPublicApiWebhookEvent({
        organizationId: apiKey.organizationId,
        eventType: "asset.updated",
        payload: body.data,
        env: c.env,
      });

      return c.json(body);
    },
  )
  .delete("/assets/:id", requireApiScope("assets:write"), async (c) => {
    const apiKey = c.get("apiKey");
    const resolvedId = await resolveExternalResourceId({
      organizationId: apiKey.organizationId,
      resourceType: "asset",
      value: c.req.param("id"),
    });

    if (!resolvedId) {
      return c.json(
        buildPublicApiError({
          code: "asset_not_found",
          message: "Ativo não encontrado",
        }),
        404,
      );
    }

    return withIdempotentMutation(c, { assetId: resolvedId }, async () => {
      const [existing] = await db
        .select({
          id: asset.id,
          deletedAt: asset.deletedAt,
          name: asset.name,
          tag: asset.tag,
          unitId: asset.unitId,
          customerId: asset.customerId,
          assetTypeId: asset.assetTypeId,
        })
        .from(asset)
        .innerJoin(customer, eq(asset.customerId, customer.id))
        .where(
          and(
            eq(asset.id, resolvedId),
            eq(customer.labOrganizationId, apiKey.organizationId),
            isNull(asset.deletedAt),
          ),
        )
        .limit(1);

      if (!existing) {
        return {
          status: 404,
          body: buildPublicApiError({
            code: "asset_not_found",
            message: "Ativo não encontrado",
          }),
        };
      }

      await db.insert(assetAuditLog).values({
        assetId: existing.id,
        action: "delete",
        changes: { asset: { old: existing, new: null } },
        performedBy: apiKey.createdBy,
        ipAddress: getPublicApiRequestIp(c.req.raw.headers),
      });

      await db
        .update(asset)
        .set({ deletedAt: new Date() })
        .where(eq(asset.id, existing.id));

      const body = { data: { id: existing.id, deleted: true } };

      await emitPublicApiWebhookEvent({
        organizationId: apiKey.organizationId,
        eventType: "asset.deleted",
        payload: {
          id: existing.id,
          externalId: await getResourceExternalId({
            organizationId: apiKey.organizationId,
            resourceType: "asset",
            resourceId: existing.id,
          }),
        },
        env: c.env,
      });

      return {
        status: 200,
        body,
        resourceType: "asset" as const,
        resourceId: existing.id,
      };
    });
  })
  .get(
    "/services",
    requireApiScope("services:read"),
    zValidator(
      "query",
      ListQuerySchema.extend({ isActive: z.string().optional() }),
    ),
    async (c) => {
      const apiKey = c.get("apiKey");
      const { page, limit, query, unitId, isActive } = c.req.valid("query");
      const offset = (page - 1) * limit;
      const conditions = [
        eq(service.organizationId, apiKey.organizationId),
        unitId ? eq(service.unitId, unitId) : undefined,
        isActive === "true" ? eq(service.isActive, true) : undefined,
        isActive === "false" ? eq(service.isActive, false) : undefined,
        query
          ? or(
              ilike(service.name, `%${query}%`),
              ilike(service.description, `%${query}%`),
            )
          : undefined,
      ];

      const [countResult, rows] = await Promise.all([
        db
          .select({ total: count() })
          .from(service)
          .where(and(...conditions)),
        db
          .select()
          .from(service)
          .where(and(...conditions))
          .orderBy(service.name)
          .limit(limit)
          .offset(offset),
      ]);

      return c.json({
        data: rows,
        meta: buildListMeta({
          page,
          limit,
          total: countResult[0]?.total ?? 0,
          filters: {
            query: query ?? null,
            unitId: unitId ?? null,
            isActive: isActive ?? null,
          },
        }),
      });
    },
  )
  .get("/services/:id", requireApiScope("services:read"), async (c) => {
    const apiKey = c.get("apiKey");
    const id = Number.parseInt(c.req.param("id"), 10);
    if (Number.isNaN(id)) {
      return c.json(
        buildPublicApiError({
          code: "service_not_found",
          message: "Serviço não encontrado",
        }),
        404,
      );
    }
    const [found] = await db
      .select()
      .from(service)
      .where(
        and(
          eq(service.id, id),
          eq(service.organizationId, apiKey.organizationId),
        ),
      )
      .limit(1);
    if (!found) {
      return c.json(
        buildPublicApiError({
          code: "service_not_found",
          message: "Serviço não encontrado",
        }),
        404,
      );
    }
    return c.json({ data: found });
  })
  .get("/units", requireApiScope("units:read"), async (c) => {
    const apiKey = c.get("apiKey");
    const units = await db
      .select({
        id: organizationUnit.id,
        name: organizationUnit.name,
        slug: organizationUnit.slug,
        status: organizationUnit.status,
        isDefault: organizationUnit.isDefault,
      })
      .from(organizationUnit)
      .where(
        and(
          eq(organizationUnit.organizationId, apiKey.organizationId),
          eq(organizationUnit.status, "ACTIVE"),
        ),
      )
      .orderBy(organizationUnit.name);
    return c.json({ data: units });
  })
  .get("/units/:id", requireApiScope("units:read"), async (c) => {
    const apiKey = c.get("apiKey");
    const id = Number.parseInt(c.req.param("id"), 10);
    if (Number.isNaN(id)) {
      return c.json(
        buildPublicApiError({
          code: "unit_not_found",
          message: "Unidade não encontrada",
        }),
        404,
      );
    }
    const [found] = await db
      .select()
      .from(organizationUnit)
      .where(
        and(
          eq(organizationUnit.id, id),
          eq(organizationUnit.organizationId, apiKey.organizationId),
        ),
      )
      .limit(1);
    if (!found) {
      return c.json(
        buildPublicApiError({
          code: "unit_not_found",
          message: "Unidade não encontrada",
        }),
        404,
      );
    }
    return c.json({ data: found });
  })
  .get(
    "/reports/consolidated/executive-overview",
    requireApiScope("reports:read"),
    zValidator("query", ReportQuerySchema),
    async (c) => {
      const apiKey = c.get("apiKey");
      const input = c.req.valid("query");
      const range = resolvePeriodRange(input.period);
      const requestedUnitIds = parseRequestedUnitIds(input.unitIds);

      const availableUnits = await db
        .select({
          id: organizationUnit.id,
          name: organizationUnit.name,
          slug: organizationUnit.slug,
        })
        .from(organizationUnit)
        .where(
          and(
            eq(organizationUnit.organizationId, apiKey.organizationId),
            eq(organizationUnit.status, "ACTIVE"),
          ),
        )
        .orderBy(organizationUnit.name);

      const selectedUnits = requestedUnitIds
        ? availableUnits.filter((unit) => requestedUnitIds.includes(unit.id))
        : availableUnits;
      const selectedUnitIds = selectedUnits.map((unit) => unit.id);
      const scopeSummary = buildReportScopeSummary({
        selectedUnits,
        availableUnits,
      });

      if (selectedUnitIds.length === 0) {
        return c.json({
          data: {
            period: range.period,
            label: getPeriodLabel(range.period),
            range: {
              startDate: range.startDate.toISOString(),
              endDate: range.endDate.toISOString(),
            },
            availableUnits,
            selectedUnits,
            scopeSummary,
            metrics: {
              pendingCalibrations: 0,
              approvedInPeriod: 0,
              rejectedInPeriod: 0,
              approvalRate: 0,
              overdueJobs: 0,
              expiringStandards: 0,
              unitsIncluded: 0,
              atRiskUnitsCount: 0,
            },
            highlights: {
              highestVolumeUnit: null,
              bestApprovalUnit: null,
              attentionUnit: null,
            },
          },
        });
      }

      const [
        pendingResult,
        approvedResult,
        rejectedResult,
        overdueResult,
        expiringStandardsResult,
        createdRows,
        approvedRows,
        rejectedRows,
        overdueRows,
        expiringRows,
      ] = await Promise.all([
        db
          .select({ count: count() })
          .from(calibrationJob)
          .where(
            and(
              eq(calibrationJob.organizationId, apiKey.organizationId),
              inArray(calibrationJob.unitId, selectedUnitIds),
              inArray(calibrationJob.status, [
                "DRAFT",
                "IN_PROGRESS",
                "REVIEW",
              ]),
            ),
          ),
        db
          .select({ count: count() })
          .from(calibrationJob)
          .where(
            and(
              eq(calibrationJob.organizationId, apiKey.organizationId),
              inArray(calibrationJob.unitId, selectedUnitIds),
              eq(calibrationJob.status, "APPROVED"),
              sql`${calibrationJob.approvedAt} >= ${range.startDate}`,
            ),
          ),
        db
          .select({ count: count() })
          .from(calibrationJob)
          .where(
            and(
              eq(calibrationJob.organizationId, apiKey.organizationId),
              inArray(calibrationJob.unitId, selectedUnitIds),
              eq(calibrationJob.status, "REJECTED"),
              sql`${calibrationJob.rejectedAt} >= ${range.startDate}`,
            ),
          ),
        db
          .select({ count: count() })
          .from(calibrationJob)
          .where(
            and(
              eq(calibrationJob.organizationId, apiKey.organizationId),
              inArray(calibrationJob.unitId, selectedUnitIds),
              inArray(calibrationJob.status, [
                "DRAFT",
                "IN_PROGRESS",
                "REVIEW",
              ]),
              sql`${calibrationJob.dueDate} < now()`,
            ),
          ),
        db
          .select({ count: count() })
          .from(referenceStandard)
          .where(
            and(
              eq(referenceStandard.organizationId, apiKey.organizationId),
              inArray(referenceStandard.unitId, selectedUnitIds),
              sql`${referenceStandard.nextCalibrationDate} <= ${new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)}`,
            ),
          ),
        db
          .select({
            unitId: calibrationJob.unitId,
            value: sql<number>`count(*)`,
          })
          .from(calibrationJob)
          .where(
            and(
              eq(calibrationJob.organizationId, apiKey.organizationId),
              inArray(calibrationJob.unitId, selectedUnitIds),
              sql`${calibrationJob.createdAt} >= ${range.startDate}`,
            ),
          )
          .groupBy(calibrationJob.unitId),
        db
          .select({
            unitId: calibrationJob.unitId,
            value: sql<number>`count(*)`,
          })
          .from(calibrationJob)
          .where(
            and(
              eq(calibrationJob.organizationId, apiKey.organizationId),
              inArray(calibrationJob.unitId, selectedUnitIds),
              eq(calibrationJob.status, "APPROVED"),
              sql`${calibrationJob.approvedAt} >= ${range.startDate}`,
            ),
          )
          .groupBy(calibrationJob.unitId),
        db
          .select({
            unitId: calibrationJob.unitId,
            value: sql<number>`count(*)`,
          })
          .from(calibrationJob)
          .where(
            and(
              eq(calibrationJob.organizationId, apiKey.organizationId),
              inArray(calibrationJob.unitId, selectedUnitIds),
              eq(calibrationJob.status, "REJECTED"),
              sql`${calibrationJob.rejectedAt} >= ${range.startDate}`,
            ),
          )
          .groupBy(calibrationJob.unitId),
        db
          .select({
            unitId: calibrationJob.unitId,
            value: sql<number>`count(*)`,
          })
          .from(calibrationJob)
          .where(
            and(
              eq(calibrationJob.organizationId, apiKey.organizationId),
              inArray(calibrationJob.unitId, selectedUnitIds),
              inArray(calibrationJob.status, [
                "DRAFT",
                "IN_PROGRESS",
                "REVIEW",
              ]),
              sql`${calibrationJob.dueDate} < now()`,
            ),
          )
          .groupBy(calibrationJob.unitId),
        db
          .select({
            unitId: referenceStandard.unitId,
            value: sql<number>`count(*)`,
          })
          .from(referenceStandard)
          .where(
            and(
              eq(referenceStandard.organizationId, apiKey.organizationId),
              inArray(referenceStandard.unitId, selectedUnitIds),
              sql`${referenceStandard.nextCalibrationDate} <= ${new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)}`,
            ),
          )
          .groupBy(referenceStandard.unitId),
      ]);

      const createdByUnit = new Map(
        createdRows.map((row) => [row.unitId, Number(row.value)]),
      );
      const approvedByUnit = new Map(
        approvedRows.map((row) => [row.unitId, Number(row.value)]),
      );
      const rejectedByUnit = new Map(
        rejectedRows.map((row) => [row.unitId, Number(row.value)]),
      );
      const overdueByUnit = new Map(
        overdueRows.map((row) => [row.unitId, Number(row.value)]),
      );
      const expiringByUnit = new Map(
        expiringRows.map((row) => [row.unitId, Number(row.value)]),
      );

      const comparison = selectedUnits.map((unit) => {
        const created = createdByUnit.get(unit.id) ?? 0;
        const approved = approvedByUnit.get(unit.id) ?? 0;
        const rejected = rejectedByUnit.get(unit.id) ?? 0;
        const overdue = overdueByUnit.get(unit.id) ?? 0;
        const expiring = expiringByUnit.get(unit.id) ?? 0;
        const approvalRate =
          created > 0 ? Math.round((approved / created) * 100) : 0;
        const healthStatus = getHealthStatus({
          overdueNow: overdue,
          rejectedInPeriod: rejected,
          expiringStandardsSoon: expiring,
        });

        return {
          unit,
          createdInPeriod: created,
          approvedInPeriod: approved,
          rejectedInPeriod: rejected,
          overdueNow: overdue,
          expiringStandardsSoon: expiring,
          approvalRate,
          healthStatus,
          healthReason: getHealthReason({
            overdueNow: overdue,
            rejectedInPeriod: rejected,
            expiringStandardsSoon: expiring,
          }),
        };
      });

      const attentionCandidates = comparison.filter(
        (row) => row.healthStatus !== "healthy",
      );
      const highestVolumeUnit =
        [...comparison].sort(
          (a, b) => b.createdInPeriod - a.createdInPeriod,
        )[0] ?? null;
      const bestApprovalUnit =
        [...comparison].sort((a, b) => b.approvalRate - a.approvalRate)[0] ??
        null;
      const attentionUnit =
        [...attentionCandidates].sort((a, b) => {
          const severity = (status: string) =>
            status === "critical" ? 2 : status === "attention" ? 1 : 0;
          return (
            severity(b.healthStatus) - severity(a.healthStatus) ||
            b.rejectedInPeriod - a.rejectedInPeriod ||
            a.approvalRate - b.approvalRate
          );
        })[0] ?? null;

      return c.json({
        data: {
          period: range.period,
          label: getPeriodLabel(range.period),
          range: {
            startDate: range.startDate.toISOString(),
            endDate: range.endDate.toISOString(),
          },
          availableUnits,
          selectedUnits,
          scopeSummary,
          metrics: {
            pendingCalibrations: pendingResult[0]?.count ?? 0,
            approvedInPeriod: approvedResult[0]?.count ?? 0,
            rejectedInPeriod: rejectedResult[0]?.count ?? 0,
            approvalRate:
              (approvedResult[0]?.count ?? 0) +
                (rejectedResult[0]?.count ?? 0) >
              0
                ? Math.round(
                    ((approvedResult[0]?.count ?? 0) /
                      ((approvedResult[0]?.count ?? 0) +
                        (rejectedResult[0]?.count ?? 0))) *
                      100,
                  )
                : 0,
            overdueJobs: overdueResult[0]?.count ?? 0,
            expiringStandards: expiringStandardsResult[0]?.count ?? 0,
            unitsIncluded: selectedUnits.length,
            atRiskUnitsCount: comparison.filter(
              (row) => row.healthStatus !== "healthy",
            ).length,
          },
          highlights: {
            highestVolumeUnit,
            bestApprovalUnit,
            attentionUnit,
          },
        },
      });
    },
  )
  .get(
    "/reports/consolidated/comparison",
    requireApiScope("reports:read"),
    zValidator("query", ReportQuerySchema),
    async (c) => {
      const apiKey = c.get("apiKey");
      const input = c.req.valid("query");
      const range = resolvePeriodRange(input.period);
      const requestedUnitIds = parseRequestedUnitIds(input.unitIds);

      const availableUnits = await db
        .select({
          id: organizationUnit.id,
          name: organizationUnit.name,
          slug: organizationUnit.slug,
        })
        .from(organizationUnit)
        .where(
          and(
            eq(organizationUnit.organizationId, apiKey.organizationId),
            eq(organizationUnit.status, "ACTIVE"),
          ),
        )
        .orderBy(organizationUnit.name);

      const selectedUnits = requestedUnitIds
        ? availableUnits.filter((unit) => requestedUnitIds.includes(unit.id))
        : availableUnits;
      const selectedUnitIds = selectedUnits.map((unit) => unit.id);

      if (selectedUnitIds.length === 0) {
        return c.json({ data: [] });
      }

      const [
        createdRows,
        approvedRows,
        rejectedRows,
        overdueRows,
        expiringRows,
      ] = await Promise.all([
        db
          .select({
            unitId: calibrationJob.unitId,
            value: sql<number>`count(*)`,
          })
          .from(calibrationJob)
          .where(
            and(
              eq(calibrationJob.organizationId, apiKey.organizationId),
              inArray(calibrationJob.unitId, selectedUnitIds),
              sql`${calibrationJob.createdAt} >= ${range.startDate}`,
            ),
          )
          .groupBy(calibrationJob.unitId),
        db
          .select({
            unitId: calibrationJob.unitId,
            value: sql<number>`count(*)`,
          })
          .from(calibrationJob)
          .where(
            and(
              eq(calibrationJob.organizationId, apiKey.organizationId),
              inArray(calibrationJob.unitId, selectedUnitIds),
              eq(calibrationJob.status, "APPROVED"),
              sql`${calibrationJob.approvedAt} >= ${range.startDate}`,
            ),
          )
          .groupBy(calibrationJob.unitId),
        db
          .select({
            unitId: calibrationJob.unitId,
            value: sql<number>`count(*)`,
          })
          .from(calibrationJob)
          .where(
            and(
              eq(calibrationJob.organizationId, apiKey.organizationId),
              inArray(calibrationJob.unitId, selectedUnitIds),
              eq(calibrationJob.status, "REJECTED"),
              sql`${calibrationJob.rejectedAt} >= ${range.startDate}`,
            ),
          )
          .groupBy(calibrationJob.unitId),
        db
          .select({
            unitId: calibrationJob.unitId,
            value: sql<number>`count(*)`,
          })
          .from(calibrationJob)
          .where(
            and(
              eq(calibrationJob.organizationId, apiKey.organizationId),
              inArray(calibrationJob.unitId, selectedUnitIds),
              inArray(calibrationJob.status, [
                "DRAFT",
                "IN_PROGRESS",
                "REVIEW",
              ]),
              sql`${calibrationJob.dueDate} < now()`,
            ),
          )
          .groupBy(calibrationJob.unitId),
        db
          .select({
            unitId: referenceStandard.unitId,
            value: sql<number>`count(*)`,
          })
          .from(referenceStandard)
          .where(
            and(
              eq(referenceStandard.organizationId, apiKey.organizationId),
              inArray(referenceStandard.unitId, selectedUnitIds),
              sql`${referenceStandard.nextCalibrationDate} <= ${new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)}`,
            ),
          )
          .groupBy(referenceStandard.unitId),
      ]);

      const createdByUnit = new Map(
        createdRows.map((row) => [row.unitId, Number(row.value)]),
      );
      const approvedByUnit = new Map(
        approvedRows.map((row) => [row.unitId, Number(row.value)]),
      );
      const rejectedByUnit = new Map(
        rejectedRows.map((row) => [row.unitId, Number(row.value)]),
      );
      const overdueByUnit = new Map(
        overdueRows.map((row) => [row.unitId, Number(row.value)]),
      );
      const expiringByUnit = new Map(
        expiringRows.map((row) => [row.unitId, Number(row.value)]),
      );

      return c.json({
        data: selectedUnits.map((unit) => {
          const created = createdByUnit.get(unit.id) ?? 0;
          const approved = approvedByUnit.get(unit.id) ?? 0;
          const rejected = rejectedByUnit.get(unit.id) ?? 0;
          const overdue = overdueByUnit.get(unit.id) ?? 0;
          const expiring = expiringByUnit.get(unit.id) ?? 0;
          return {
            unit,
            createdInPeriod: created,
            approvedInPeriod: approved,
            rejectedInPeriod: rejected,
            approvalRate:
              created > 0 ? Math.round((approved / created) * 100) : 0,
            overdueNow: overdue,
            expiringStandardsSoon: expiring,
            healthStatus: getHealthStatus({
              overdueNow: overdue,
              rejectedInPeriod: rejected,
              expiringStandardsSoon: expiring,
            }),
            healthReason: getHealthReason({
              overdueNow: overdue,
              rejectedInPeriod: rejected,
              expiringStandardsSoon: expiring,
            }),
          };
        }),
      });
    },
  )
  .get(
    "/certificates",
    requireApiScope("certificates:read"),
    zValidator(
      "query",
      ListQuerySchema.extend({ unitId: z.coerce.number().optional() }),
    ),
    async (c) => {
      const apiKey = c.get("apiKey");
      const { page, limit, query, unitId } = c.req.valid("query");
      const offset = (page - 1) * limit;
      const conditions = [
        eq(calibrationJob.organizationId, apiKey.organizationId),
        inArray(calibrationJob.status, ["APPROVED", "SUPERSEDED"]),
        unitId ? eq(calibrationJob.unitId, unitId) : undefined,
        query ? ilike(calibrationJob.jobId, `%${query}%`) : undefined,
      ];

      const [countResult, rows] = await Promise.all([
        db
          .select({ total: count() })
          .from(calibrationJob)
          .where(and(...conditions)),
        db
          .select({
            id: calibrationJob.id,
            jobId: calibrationJob.jobId,
            certificateName: calibrationJob.certificateName,
            status: calibrationJob.status,
            approvedAt: calibrationJob.approvedAt,
            verificationToken: calibrationJob.verificationToken,
            certificateUrl: calibrationJob.certificateUrl,
            unitId: calibrationJob.unitId,
            assetName: asset.name,
            customerName: customer.name,
          })
          .from(calibrationJob)
          .innerJoin(customer, eq(calibrationJob.customerId, customer.id))
          .innerJoin(asset, eq(calibrationJob.assetId, asset.id))
          .where(and(...conditions))
          .orderBy(desc(calibrationJob.approvedAt))
          .limit(limit)
          .offset(offset),
      ]);

      return c.json({
        data: rows,
        meta: buildListMeta({
          page,
          limit,
          total: countResult[0]?.total ?? 0,
          filters: { query: query ?? null, unitId: unitId ?? null },
        }),
      });
    },
  )
  .get(
    "/certificates/:jobId",
    requireApiScope("certificates:read"),
    async (c) => {
      const apiKey = c.get("apiKey");
      const jobId = c.req.param("jobId");
      const [job] = await db
        .select({
          id: calibrationJob.id,
          jobId: calibrationJob.jobId,
          certificateName: calibrationJob.certificateName,
          status: calibrationJob.status,
          approvedAt: calibrationJob.approvedAt,
          verificationToken: calibrationJob.verificationToken,
          certificateUrl: calibrationJob.certificateUrl,
          unitId: calibrationJob.unitId,
          assetId: calibrationJob.assetId,
          assetName: asset.name,
          customerId: calibrationJob.customerId,
          customerName: customer.name,
        })
        .from(calibrationJob)
        .innerJoin(customer, eq(calibrationJob.customerId, customer.id))
        .innerJoin(asset, eq(calibrationJob.assetId, asset.id))
        .where(
          and(
            eq(calibrationJob.organizationId, apiKey.organizationId),
            eq(calibrationJob.jobId, jobId),
            inArray(calibrationJob.status, ["APPROVED", "SUPERSEDED"]),
          ),
        )
        .limit(1);

      if (!job) {
        return c.json(
          buildPublicApiError({
            code: "certificate_not_found",
            message: "Certificado não encontrado",
          }),
          404,
        );
      }

      return c.json({ data: job });
    },
  )
  .get(
    "/certificates/:jobId/download",
    requireApiScope("certificates:read"),
    async (c) => {
      const apiKey = c.get("apiKey");
      const jobId = c.req.param("jobId");
      const [job] = await db
        .select({
          certificateUrl: calibrationJob.certificateUrl,
        })
        .from(calibrationJob)
        .where(
          and(
            eq(calibrationJob.organizationId, apiKey.organizationId),
            eq(calibrationJob.jobId, jobId),
            inArray(calibrationJob.status, ["APPROVED", "SUPERSEDED"]),
          ),
        )
        .limit(1);

      if (!job?.certificateUrl) {
        return c.json(
          buildPublicApiError({
            code: "certificate_not_found",
            message: "Certificado não encontrado",
          }),
          404,
        );
      }

      const r2 = createR2Client(c.env);
      const key = extractKeyFromUrl(job.certificateUrl);
      if (!key) {
        return c.json(
          buildPublicApiError({
            code: "certificate_not_ready",
            message: "Documento ainda não disponível",
          }),
          400,
        );
      }

      const downloadUrl = await generatePresignedUrl(
        r2,
        c.env.R2_BUCKET_NAME,
        key,
        300,
      );
      return c.redirect(downloadUrl, 302);
    },
  )
  .get(
    "/requests",
    requireApiScope("requests:read"),
    zValidator(
      "query",
      ListQuerySchema.extend({
        status: z.string().optional(),
        customerExternalId: z.string().trim().optional(),
        customerId: z.coerce.number().optional(),
      }),
    ),
    async (c) => {
      const apiKey = c.get("apiKey");
      const {
        page,
        limit,
        query,
        status,
        unitId,
        customerId,
        customerExternalId,
      } = c.req.valid("query");
      const offset = (page - 1) * limit;
      const resolvedCustomerId = await resolveCustomerId({
        organizationId: apiKey.organizationId,
        customerId,
        customerExternalId,
      });
      const conditions = [
        eq(calibrationRequest.organizationId, apiKey.organizationId),
        unitId ? eq(calibrationRequest.unitId, unitId) : undefined,
        status ? eq(calibrationRequest.status, status as any) : undefined,
        resolvedCustomerId
          ? eq(calibrationRequest.customerId, resolvedCustomerId)
          : undefined,
        query
          ? sql`(${calibrationRequest.id}::text ilike ${`%${query}%`} or coalesce(${calibrationRequest.observations}, '') ilike ${`%${query}%`})`
          : undefined,
      ];

      const [countResult, rows] = await Promise.all([
        db
          .select({ total: count() })
          .from(calibrationRequest)
          .where(and(...conditions)),
        db
          .select({
            id: calibrationRequest.id,
            status: calibrationRequest.status,
            observations: calibrationRequest.observations,
            requestedDueDate: calibrationRequest.requestedDueDate,
            submittedAt: calibrationRequest.submittedAt,
            customerId: calibrationRequest.customerId,
            customerName: customer.name,
            unitId: calibrationRequest.unitId,
            unitName: organizationUnit.name,
          })
          .from(calibrationRequest)
          .innerJoin(customer, eq(calibrationRequest.customerId, customer.id))
          .leftJoin(
            organizationUnit,
            eq(calibrationRequest.unitId, organizationUnit.id),
          )
          .where(and(...conditions))
          .orderBy(desc(calibrationRequest.submittedAt))
          .limit(limit)
          .offset(offset),
      ]);

      const externalIds = await getResourceExternalIdMap({
        organizationId: apiKey.organizationId,
        resourceType: "request",
        resourceIds: rows.map((row) => row.id),
      });

      return c.json({
        data: rows.map((row) => ({
          ...row,
          externalId: externalIds.get(String(row.id)) ?? null,
          unit: row.unitId
            ? { id: row.unitId, name: row.unitName ?? "Unidade removida" }
            : null,
        })),
        meta: buildListMeta({
          page,
          limit,
          total: countResult[0]?.total ?? 0,
          filters: {
            query: query ?? null,
            status: status ?? null,
            unitId: unitId ?? null,
            customerId: resolvedCustomerId ?? null,
          },
        }),
      });
    },
  )
  .get("/requests/:id", requireApiScope("requests:read"), async (c) => {
    const apiKey = c.get("apiKey");
    const resolvedId = await resolveExternalResourceId({
      organizationId: apiKey.organizationId,
      resourceType: "request",
      value: c.req.param("id"),
    });

    if (!resolvedId) {
      return c.json(
        buildPublicApiError({
          code: "request_not_found",
          message: "Solicitação não encontrada",
        }),
        404,
      );
    }

    const [found] = await db
      .select({
        id: calibrationRequest.id,
        status: calibrationRequest.status,
        observations: calibrationRequest.observations,
        requestedDueDate: calibrationRequest.requestedDueDate,
        submittedAt: calibrationRequest.submittedAt,
        reviewedAt: calibrationRequest.reviewedAt,
        approvedAt: calibrationRequest.approvedAt,
        rejectedAt: calibrationRequest.rejectedAt,
        rejectionReason: calibrationRequest.rejectionReason,
        convertedAt: calibrationRequest.convertedAt,
        customerId: calibrationRequest.customerId,
        customerName: customer.name,
        unitId: calibrationRequest.unitId,
        unitName: organizationUnit.name,
      })
      .from(calibrationRequest)
      .innerJoin(customer, eq(calibrationRequest.customerId, customer.id))
      .leftJoin(
        organizationUnit,
        eq(calibrationRequest.unitId, organizationUnit.id),
      )
      .where(
        and(
          eq(calibrationRequest.id, resolvedId),
          eq(calibrationRequest.organizationId, apiKey.organizationId),
        ),
      )
      .limit(1);

    if (!found) {
      return c.json(
        buildPublicApiError({
          code: "request_not_found",
          message: "Solicitação não encontrada",
        }),
        404,
      );
    }

    const items = await db
      .select({
        id: calibrationRequestItem.id,
        assetId: calibrationRequestItem.assetId,
        convertedJobId: calibrationRequestItem.convertedJobId,
        assetName: asset.name,
        assetTag: asset.tag,
      })
      .from(calibrationRequestItem)
      .innerJoin(asset, eq(calibrationRequestItem.assetId, asset.id))
      .where(eq(calibrationRequestItem.requestId, found.id));

    return c.json({
      data: {
        ...found,
        externalId: await getResourceExternalId({
          organizationId: apiKey.organizationId,
          resourceType: "request",
          resourceId: found.id,
        }),
        unit: found.unitId
          ? { id: found.unitId, name: found.unitName ?? "Unidade removida" }
          : null,
        items,
      },
    });
  })
  .post(
    "/requests",
    requireApiScope("requests:write"),
    zValidator("json", PublicCreateRequestSchema),
    async (c) => {
      const apiKey = c.get("apiKey");
      const input = c.req.valid("json");

      return withIdempotentMutation(c, input, async () => {
        const resolvedCustomerId = await resolveCustomerId({
          organizationId: apiKey.organizationId,
          customerId: input.customerId,
          customerExternalId: input.customerExternalId,
        });

        if (!resolvedCustomerId) {
          return {
            status: 404,
            body: buildPublicApiError({
              code: "customer_not_found",
              message: "Cliente não encontrado",
            }),
          };
        }

        const assetIds = Array.from(
          new Set([
            ...(input.assetIds ?? []),
            ...(
              await Promise.all(
                (input.assetExternalIds ?? []).map((externalId) =>
                  resolveAssetId({
                    organizationId: apiKey.organizationId,
                    assetExternalId: externalId,
                  }),
                ),
              )
            ).filter((value): value is number => !!value),
          ]),
        );

        if (assetIds.length === 0) {
          return {
            status: 400,
            body: buildPublicApiError({
              code: "invalid_assets",
              message: "Informe ativos válidos",
            }),
          };
        }

        const foundCustomer = await db.query.customer.findFirst({
          where: and(
            eq(customer.id, resolvedCustomerId),
            eq(customer.labOrganizationId, apiKey.organizationId),
          ),
        });

        if (!foundCustomer) {
          return {
            status: 404,
            body: buildPublicApiError({
              code: "customer_not_found",
              message: "Cliente não encontrado",
            }),
          };
        }

        const assetsInScope = await db
          .select({
            id: asset.id,
            unitId: asset.unitId,
          })
          .from(asset)
          .where(
            and(
              inArray(asset.id, assetIds),
              eq(asset.customerId, foundCustomer.id),
              isNull(asset.deletedAt),
              eq(asset.status, "ACTIVE"),
            ),
          );

        if (assetsInScope.length !== assetIds.length) {
          return {
            status: 400,
            body: buildPublicApiError({
              code: "invalid_assets",
              message: "Um ou mais ativos não pertencem ao cliente",
            }),
          };
        }

        const unitIds = [...new Set(assetsInScope.map((item) => item.unitId))];
        if (input.unitId && !unitIds.includes(input.unitId)) {
          return {
            status: 400,
            body: buildPublicApiError({
              code: "unit_asset_mismatch",
              message: "Os ativos não pertencem à unidade informada",
            }),
          };
        }

        if (unitIds.length !== 1) {
          return {
            status: 400,
            body: buildPublicApiError({
              code: "multi_unit_request_not_allowed",
              message:
                "Selecione ativos da mesma unidade para criar a solicitação",
            }),
          };
        }

        const requestedDueDate = input.requestedDueDate
          ? new Date(input.requestedDueDate)
          : null;

        const created = await db.transaction(async (tx) => {
          const [request] = await tx
            .insert(calibrationRequest)
            .values({
              organizationId: apiKey.organizationId,
              unitId: input.unitId ?? unitIds[0]!,
              customerId: foundCustomer.id,
              authOrganizationId: foundCustomer.authOrganizationId,
              observations: input.observations || null,
              requestedDueDate,
              submittedBy: apiKey.createdBy,
            })
            .returning();

          await tx.insert(calibrationRequestItem).values(
            assetIds.map((assetId) => ({
              requestId: request!.id,
              assetId,
            })),
          );

          await tx.insert(calibrationRequestAuditLog).values({
            requestId: request!.id,
            action: "create",
            changes: {
              initial: {
                assetIds,
                observations: input.observations || null,
                requestedDueDate: requestedDueDate?.toISOString() ?? null,
              },
            },
            performedBy: apiKey.createdBy,
            ipAddress: getPublicApiRequestIp(c.req.raw.headers),
          });

          return request!;
        });

        const externalId = input.externalId?.trim();
        if (externalId) {
          await upsertResourceExternalId({
            organizationId: apiKey.organizationId,
            apiKeyId: apiKey.id,
            resourceType: "request",
            resourceId: created.id,
            externalId,
          });
        }

        const body = {
          data: {
            id: created.id,
            status: created.status,
            externalId: externalId ?? null,
          },
        };

        await emitPublicApiWebhookEvent({
          organizationId: apiKey.organizationId,
          eventType: "request.created",
          payload: body.data,
          env: c.env,
        });

        return {
          status: 201,
          body,
          resourceType: "request" as const,
          resourceId: created.id,
        };
      });
    },
  )
  .patch(
    "/requests/:id",
    requireApiScope("requests:write"),
    zValidator("json", UpdateRequestPublicSchema),
    async (c) => {
      const apiKey = c.get("apiKey");
      const input = c.req.valid("json");
      const resolvedId = await resolveExternalResourceId({
        organizationId: apiKey.organizationId,
        resourceType: "request",
        value: c.req.param("id"),
      });

      if (!resolvedId) {
        return c.json(
          buildPublicApiError({
            code: "request_not_found",
            message: "Solicitação não encontrada",
          }),
          404,
        );
      }

      const [existing] = await db
        .select()
        .from(calibrationRequest)
        .where(
          and(
            eq(calibrationRequest.id, resolvedId),
            eq(calibrationRequest.organizationId, apiKey.organizationId),
          ),
        )
        .limit(1);

      if (!existing) {
        return c.json(
          buildPublicApiError({
            code: "request_not_found",
            message: "Solicitação não encontrada",
          }),
          404,
        );
      }

      if (!["PENDING", "UNDER_REVIEW"].includes(existing.status)) {
        return c.json(
          buildPublicApiError({
            code: "request_not_editable",
            message:
              "Somente solicitações pendentes ou em revisão podem ser atualizadas",
          }),
          409,
        );
      }

      const [updated] = await db
        .update(calibrationRequest)
        .set({
          observations: input.observations ?? existing.observations,
          requestedDueDate:
            input.requestedDueDate === undefined
              ? existing.requestedDueDate
              : input.requestedDueDate
                ? new Date(input.requestedDueDate)
                : null,
        })
        .where(eq(calibrationRequest.id, existing.id))
        .returning();

      await db.insert(calibrationRequestAuditLog).values({
        requestId: existing.id,
        action: "update",
        changes: { request: { old: existing, new: updated } },
        performedBy: apiKey.createdBy,
        ipAddress: getPublicApiRequestIp(c.req.raw.headers),
      });

      const body = {
        data: {
          ...updated,
          externalId: await getResourceExternalId({
            organizationId: apiKey.organizationId,
            resourceType: "request",
            resourceId: existing.id,
          }),
        },
      };

      await emitPublicApiWebhookEvent({
        organizationId: apiKey.organizationId,
        eventType: "request.updated",
        payload: body.data,
        env: c.env,
      });

      return c.json(body);
    },
  )
  .post(
    "/requests/:id/cancel",
    requireApiScope("requests:write"),
    zValidator("json", CancelRequestPublicSchema),
    async (c) => {
      const apiKey = c.get("apiKey");
      const input = c.req.valid("json");
      const resolvedId = await resolveExternalResourceId({
        organizationId: apiKey.organizationId,
        resourceType: "request",
        value: c.req.param("id"),
      });

      if (!resolvedId) {
        return c.json(
          buildPublicApiError({
            code: "request_not_found",
            message: "Solicitação não encontrada",
          }),
          404,
        );
      }

      return withIdempotentMutation(c, input, async () => {
        const [existing] = await db
          .select()
          .from(calibrationRequest)
          .where(
            and(
              eq(calibrationRequest.id, resolvedId),
              eq(calibrationRequest.organizationId, apiKey.organizationId),
            ),
          )
          .limit(1);

        if (!existing) {
          return {
            status: 404,
            body: buildPublicApiError({
              code: "request_not_found",
              message: "Solicitação não encontrada",
            }),
          };
        }

        if (
          !["PENDING", "UNDER_REVIEW", "APPROVED"].includes(existing.status)
        ) {
          return {
            status: 409,
            body: buildPublicApiError({
              code: "request_not_cancelable",
              message: "A solicitação não pode ser cancelada neste status",
            }),
          };
        }

        const [updated] = await db
          .update(calibrationRequest)
          .set({
            status: "REJECTED",
            rejectedBy: apiKey.createdBy,
            rejectedAt: new Date(),
            rejectionReason: input.reason,
          })
          .where(eq(calibrationRequest.id, existing.id))
          .returning();

        await db.insert(calibrationRequestAuditLog).values({
          requestId: existing.id,
          action: "reject",
          changes: { status: { old: existing.status, new: "REJECTED" } },
          performedBy: apiKey.createdBy,
          ipAddress: getPublicApiRequestIp(c.req.raw.headers),
          reason: input.reason,
        });

        const body = { data: updated! };

        await emitPublicApiWebhookEvent({
          organizationId: apiKey.organizationId,
          eventType: "request.canceled",
          payload: {
            id: updated!.id,
            status: updated!.status,
            rejectionReason: updated!.rejectionReason,
          },
          env: c.env,
        });

        return {
          status: 200,
          body,
          resourceType: "request" as const,
          resourceId: updated!.id,
        };
      });
    },
  )
  .get(
    "/jobs",
    requireApiScope("jobs:read"),
    zValidator(
      "query",
      ListQuerySchema.extend({
        status: z.string().optional(),
        customerId: z.coerce.number().optional(),
        customerExternalId: z.string().trim().optional(),
        assetExternalId: z.string().trim().optional(),
        assetId: z.coerce.number().optional(),
        serviceId: z.coerce.number().optional(),
      }),
    ),
    async (c) => {
      const apiKey = c.get("apiKey");
      const {
        page,
        limit,
        query,
        status,
        unitId,
        customerId,
        customerExternalId,
        assetId,
        assetExternalId,
        serviceId,
      } = c.req.valid("query");
      const offset = (page - 1) * limit;
      const resolvedCustomerId = await resolveCustomerId({
        organizationId: apiKey.organizationId,
        customerId,
        customerExternalId,
      });
      const resolvedAssetId = await resolveAssetId({
        organizationId: apiKey.organizationId,
        assetId,
        assetExternalId,
      });
      const conditions = [
        eq(calibrationJob.organizationId, apiKey.organizationId),
        unitId ? eq(calibrationJob.unitId, unitId) : undefined,
        status ? eq(calibrationJob.status, status as any) : undefined,
        resolvedCustomerId
          ? eq(calibrationJob.customerId, resolvedCustomerId)
          : undefined,
        resolvedAssetId
          ? eq(calibrationJob.assetId, resolvedAssetId)
          : undefined,
        serviceId ? eq(calibrationJob.serviceId, serviceId) : undefined,
        query ? ilike(calibrationJob.jobId, `%${query}%`) : undefined,
      ];

      const [countResult, rows] = await Promise.all([
        db
          .select({ total: count() })
          .from(calibrationJob)
          .where(and(...conditions)),
        db
          .select({
            id: calibrationJob.id,
            jobId: calibrationJob.jobId,
            status: calibrationJob.status,
            dueDate: calibrationJob.dueDate,
            performedAt: calibrationJob.performedAt,
            approvedAt: calibrationJob.approvedAt,
            customerId: calibrationJob.customerId,
            customerName: customer.name,
            unitId: calibrationJob.unitId,
            unitName: organizationUnit.name,
            assetId: calibrationJob.assetId,
            assetName: asset.name,
            serviceId: calibrationJob.serviceId,
            serviceName: service.name,
            technicianId: calibrationJob.technicianId,
            createdAt: calibrationJob.createdAt,
            updatedAt: calibrationJob.updatedAt,
          })
          .from(calibrationJob)
          .innerJoin(customer, eq(calibrationJob.customerId, customer.id))
          .innerJoin(asset, eq(calibrationJob.assetId, asset.id))
          .innerJoin(service, eq(calibrationJob.serviceId, service.id))
          .leftJoin(
            organizationUnit,
            eq(calibrationJob.unitId, organizationUnit.id),
          )
          .where(and(...conditions))
          .orderBy(desc(calibrationJob.createdAt))
          .limit(limit)
          .offset(offset),
      ]);

      const externalIds = await getResourceExternalIdMap({
        organizationId: apiKey.organizationId,
        resourceType: "job",
        resourceIds: rows.map((row) => row.id),
      });

      return c.json({
        data: rows.map((row) => ({
          ...row,
          externalId: externalIds.get(String(row.id)) ?? null,
          unit: row.unitId
            ? { id: row.unitId, name: row.unitName ?? "Unidade removida" }
            : null,
        })),
        meta: buildListMeta({
          page,
          limit,
          total: countResult[0]?.total ?? 0,
          filters: {
            query: query ?? null,
            status: status ?? null,
            unitId: unitId ?? null,
            customerId: resolvedCustomerId ?? null,
            assetId: resolvedAssetId ?? null,
            serviceId: serviceId ?? null,
          },
        }),
      });
    },
  )
  .get("/jobs/:id", requireApiScope("jobs:read"), async (c) => {
    const apiKey = c.get("apiKey");
    const resolvedId = await resolveExternalResourceId({
      organizationId: apiKey.organizationId,
      resourceType: "job",
      value: c.req.param("id"),
    });

    if (!resolvedId) {
      return c.json(
        buildPublicApiError({
          code: "job_not_found",
          message: "OS não encontrada",
        }),
        404,
      );
    }

    const [job] = await db
      .select({
        id: calibrationJob.id,
        jobId: calibrationJob.jobId,
        organizationId: calibrationJob.organizationId,
        status: calibrationJob.status,
        dueDate: calibrationJob.dueDate,
        performedAt: calibrationJob.performedAt,
        data: calibrationJob.data,
        results: calibrationJob.results,
        standardsSnapshot: calibrationJob.standardsSnapshot,
        environmentalSnapshot: calibrationJob.environmentalSnapshot,
        certificateUrl: calibrationJob.certificateUrl,
        labelUrl: calibrationJob.labelUrl,
        methodSnapshot: calibrationJob.methodSnapshot,
        createdAt: calibrationJob.createdAt,
        updatedAt: calibrationJob.updatedAt,
        approvedAt: calibrationJob.approvedAt,
        rejectedAt: calibrationJob.rejectedAt,
        rejectionReason: calibrationJob.rejectionReason,
        customerId: calibrationJob.customerId,
        customerName: customer.name,
        unitId: calibrationJob.unitId,
        unitName: organizationUnit.name,
        assetId: calibrationJob.assetId,
        assetName: asset.name,
        assetTag: asset.tag,
        serviceId: calibrationJob.serviceId,
        serviceName: service.name,
        technicianId: calibrationJob.technicianId,
        technicianName: user.name,
      })
      .from(calibrationJob)
      .leftJoin(customer, eq(calibrationJob.customerId, customer.id))
      .leftJoin(
        organizationUnit,
        eq(calibrationJob.unitId, organizationUnit.id),
      )
      .leftJoin(asset, eq(calibrationJob.assetId, asset.id))
      .leftJoin(service, eq(calibrationJob.serviceId, service.id))
      .leftJoin(user, eq(calibrationJob.technicianId, user.id))
      .where(
        and(
          eq(calibrationJob.id, resolvedId),
          eq(calibrationJob.organizationId, apiKey.organizationId),
        ),
      )
      .limit(1);

    if (!job) {
      return c.json(
        buildPublicApiError({
          code: "job_not_found",
          message: "OS não encontrada",
        }),
        404,
      );
    }

    return c.json({
      data: {
        ...job,
        externalId: await getResourceExternalId({
          organizationId: apiKey.organizationId,
          resourceType: "job",
          resourceId: job.id,
        }),
        unit: job.unitId
          ? { id: job.unitId, name: job.unitName ?? "Unidade removida" }
          : null,
      },
    });
  })
  .post(
    "/jobs",
    requireApiScope("jobs:write"),
    zValidator("json", JobCreatePublicSchema),
    async (c) => {
      const apiKey = c.get("apiKey");
      const input = c.req.valid("json");

      return withIdempotentMutation(c, input, async () => {
        const assetId = await resolveAssetId({
          organizationId: apiKey.organizationId,
          assetId: input.assetId,
          assetExternalId: input.assetExternalId,
        });

        if (!assetId) {
          return {
            status: 404,
            body: buildPublicApiError({
              code: "asset_not_found",
              message: "Ativo não encontrado",
            }),
          };
        }

        const unitId = await resolveUnitIdForWrite({
          organizationId: apiKey.organizationId,
          requestedUnitId: input.unitId,
        });

        try {
          const created = await createCalibrationJob({
            organizationId: apiKey.organizationId,
            unitId,
            createdBy: apiKey.createdBy,
            assetId,
            serviceId: input.serviceId,
            technicianId: input.technicianId,
            dueDate: input.dueDate,
            ipAddress: getPublicApiRequestIp(c.req.raw.headers),
          });

          const externalId = input.externalId?.trim();
          if (externalId) {
            await upsertResourceExternalId({
              organizationId: apiKey.organizationId,
              apiKeyId: apiKey.id,
              resourceType: "job",
              resourceId: created.id,
              externalId,
            });
          }

          const body = {
            data: {
              id: created.id,
              jobId: created.jobId,
              status: created.status,
              dueDate: created.dueDate,
              externalId: externalId ?? null,
            },
          };

          await emitPublicApiWebhookEvent({
            organizationId: apiKey.organizationId,
            eventType: "job.created",
            payload: body.data,
            env: c.env,
          });

          return {
            status: 201,
            body,
            resourceType: "job" as const,
            resourceId: created.id,
          };
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Falha ao criar OS";
          return {
            status: jobCreationClientErrors.has(message) ? 400 : 500,
            body: buildPublicApiError({
              code: "job_create_failed",
              message,
            }),
          };
        }
      });
    },
  )
  .patch(
    "/jobs/:id",
    requireApiScope("jobs:write"),
    zValidator(
      "json",
      UpdateJobSchema.extend({ externalId: z.string().trim().optional() }),
    ),
    async (c) => {
      const apiKey = c.get("apiKey");
      const input = c.req.valid("json");
      const resolvedId = await resolveExternalResourceId({
        organizationId: apiKey.organizationId,
        resourceType: "job",
        value: c.req.param("id"),
      });

      if (!resolvedId) {
        return c.json(
          buildPublicApiError({
            code: "job_not_found",
            message: "OS não encontrada",
          }),
          404,
        );
      }

      const [existing] = await db
        .select()
        .from(calibrationJob)
        .where(
          and(
            eq(calibrationJob.id, resolvedId),
            eq(calibrationJob.organizationId, apiKey.organizationId),
          ),
        )
        .limit(1);

      if (!existing) {
        return c.json(
          buildPublicApiError({
            code: "job_not_found",
            message: "OS não encontrada",
          }),
          404,
        );
      }

      if (existing.status === "APPROVED" || existing.status === "CANCELED") {
        return c.json(
          buildPublicApiError({
            code: "job_not_editable",
            message: `Não é possível atualizar uma OS com status ${existing.status}`,
          }),
          409,
        );
      }

      const [updated] = await db
        .update(calibrationJob)
        .set({
          technicianId:
            input.technicianId === undefined
              ? existing.technicianId
              : input.technicianId,
          dueDate:
            input.dueDate === undefined
              ? existing.dueDate
              : input.dueDate
                ? new Date(input.dueDate)
                : null,
          status: input.status ?? existing.status,
        })
        .where(eq(calibrationJob.id, existing.id))
        .returning();

      await db.insert(jobAuditLog).values({
        jobId: existing.id,
        action: "update",
        changes: { job: { old: existing, new: updated } },
        performedBy: apiKey.createdBy,
        ipAddress: getPublicApiRequestIp(c.req.raw.headers),
      });

      const externalId = input.externalId?.trim();
      if (externalId) {
        await upsertResourceExternalId({
          organizationId: apiKey.organizationId,
          apiKeyId: apiKey.id,
          resourceType: "job",
          resourceId: existing.id,
          externalId,
        });
      }

      const body = {
        data: {
          ...updated,
          externalId:
            externalId ??
            (await getResourceExternalId({
              organizationId: apiKey.organizationId,
              resourceType: "job",
              resourceId: existing.id,
            })),
        },
      };

      await emitPublicApiWebhookEvent({
        organizationId: apiKey.organizationId,
        eventType: "job.updated",
        payload: body.data,
        env: c.env,
      });

      return c.json(body);
    },
  )
  .post(
    "/jobs/:id/results",
    requireApiScope("jobs:write"),
    zValidator("json", ExecuteJobSchema),
    async (c) => {
      const apiKey = c.get("apiKey");
      const input = c.req.valid("json");
      const resolvedId = await resolveExternalResourceId({
        organizationId: apiKey.organizationId,
        resourceType: "job",
        value: c.req.param("id"),
      });

      if (!resolvedId) {
        return c.json(
          buildPublicApiError({
            code: "job_not_found",
            message: "OS não encontrada",
          }),
          404,
        );
      }

      return withIdempotentMutation(c, input, async () => {
        const [existing] = await db
          .select()
          .from(calibrationJob)
          .where(
            and(
              eq(calibrationJob.id, resolvedId),
              eq(calibrationJob.organizationId, apiKey.organizationId),
            ),
          )
          .limit(1);

        if (!existing) {
          return {
            status: 404,
            body: buildPublicApiError({
              code: "job_not_found",
              message: "OS não encontrada",
            }),
          };
        }

        if (!["DRAFT", "IN_PROGRESS", "REJECTED"].includes(existing.status)) {
          return {
            status: 409,
            body: buildPublicApiError({
              code: "job_not_executable",
              message: "A OS não aceita atualização de resultados neste status",
            }),
          };
        }

        const [updated] = await db
          .update(calibrationJob)
          .set({
            status: "IN_PROGRESS",
            data: input.data,
            results: input.results ?? existing.results,
          })
          .where(eq(calibrationJob.id, existing.id))
          .returning();

        await db.insert(jobAuditLog).values({
          jobId: existing.id,
          action: "execute",
          changes: {
            data: { old: existing.data, new: input.data },
            results: {
              old: existing.results,
              new: input.results ?? existing.results,
            },
          },
          performedBy: apiKey.createdBy,
          ipAddress: getPublicApiRequestIp(c.req.raw.headers),
        });

        const body = { data: updated! };

        await emitPublicApiWebhookEvent({
          organizationId: apiKey.organizationId,
          eventType: "job.results_submitted",
          payload: body.data,
          env: c.env,
        });

        return {
          status: 200,
          body,
          resourceType: "job" as const,
          resourceId: updated!.id,
        };
      });
    },
  )
  .post(
    "/jobs/:id/submit",
    requireApiScope("jobs:write"),
    zValidator("json", SubmitForReviewSchema),
    async (c) => {
      const apiKey = c.get("apiKey");
      const input = c.req.valid("json");
      const resolvedId = await resolveExternalResourceId({
        organizationId: apiKey.organizationId,
        resourceType: "job",
        value: c.req.param("id"),
      });

      if (!resolvedId) {
        return c.json(
          buildPublicApiError({
            code: "job_not_found",
            message: "OS não encontrada",
          }),
          404,
        );
      }

      return withIdempotentMutation(c, input, async () => {
        const [existing] = await db
          .select()
          .from(calibrationJob)
          .where(
            and(
              eq(calibrationJob.id, resolvedId),
              eq(calibrationJob.organizationId, apiKey.organizationId),
            ),
          )
          .limit(1);

        if (!existing) {
          return {
            status: 404,
            body: buildPublicApiError({
              code: "job_not_found",
              message: "OS não encontrada",
            }),
          };
        }

        if (!["DRAFT", "IN_PROGRESS", "REJECTED"].includes(existing.status)) {
          return {
            status: 409,
            body: buildPublicApiError({
              code: "job_not_submittable",
              message: "A OS não pode ser submetida neste status",
            }),
          };
        }

        const [updated] = await db
          .update(calibrationJob)
          .set({
            data: input.data,
            status: "REVIEW",
            performedAt: new Date(),
          })
          .where(eq(calibrationJob.id, existing.id))
          .returning();

        await db.insert(jobAuditLog).values({
          jobId: existing.id,
          action: "submit",
          changes: {
            status: { old: existing.status, new: "REVIEW" },
            data: { old: existing.data, new: input.data },
          },
          performedBy: apiKey.createdBy,
          ipAddress: getPublicApiRequestIp(c.req.raw.headers),
        });

        return {
          status: 200,
          body: { data: updated! },
          resourceType: "job" as const,
          resourceId: updated!.id,
        };
      });
    },
  )
  .post(
    "/jobs/:id/approve",
    requireApiScope("jobs:write"),
    zValidator("json", ApproveJobSchema),
    async (c) => {
      const apiKey = c.get("apiKey");
      const input = c.req.valid("json");
      const resolvedId = await resolveExternalResourceId({
        organizationId: apiKey.organizationId,
        resourceType: "job",
        value: c.req.param("id"),
      });

      if (!resolvedId) {
        return c.json(
          buildPublicApiError({
            code: "job_not_found",
            message: "OS não encontrada",
          }),
          404,
        );
      }

      return withIdempotentMutation(c, input, async () => {
        const [existing] = await db
          .select()
          .from(calibrationJob)
          .where(
            and(
              eq(calibrationJob.id, resolvedId),
              eq(calibrationJob.organizationId, apiKey.organizationId),
            ),
          )
          .limit(1);

        if (!existing) {
          return {
            status: 404,
            body: buildPublicApiError({
              code: "job_not_found",
              message: "OS não encontrada",
            }),
          };
        }

        if (existing.status !== "REVIEW") {
          return {
            status: 409,
            body: buildPublicApiError({
              code: "job_not_approvable",
              message: "A OS precisa estar em revisão para ser aprovada",
            }),
          };
        }

        const effectiveTemplateSnapshot =
          (existing.certificateTemplateSnapshot as
            | CertificateTemplateSnapshot
            | null
            | undefined) ??
          (await getEffectiveCertificateTemplateSnapshot(
            apiKey.organizationId,
          ));

        const [updated] = await db
          .update(calibrationJob)
          .set({
            status: "GENERATING_PDF",
            approvedBy: apiKey.createdBy,
            approvedAt: new Date(),
            certificateTemplateId:
              existing.certificateTemplateId ?? effectiveTemplateSnapshot.id,
            certificateTemplateSnapshot:
              existing.certificateTemplateSnapshot ??
              serializeCertificateTemplateSnapshot(effectiveTemplateSnapshot),
            rejectedBy: null,
            rejectedAt: null,
            rejectionReason: null,
          })
          .where(eq(calibrationJob.id, existing.id))
          .returning();

        await db.insert(jobAuditLog).values({
          jobId: existing.id,
          action: "approve",
          changes: { status: { old: existing.status, new: "GENERATING_PDF" } },
          performedBy: apiKey.createdBy,
          ipAddress: getPublicApiRequestIp(c.req.raw.headers),
          reason: input.reason,
        });

        await emitPublicApiWebhookEvent({
          organizationId: apiKey.organizationId,
          eventType: "job.approved",
          payload: {
            id: updated!.id,
            jobId: updated!.jobId,
            status: updated!.status,
          },
          env: c.env,
        });

        return {
          status: 200,
          body: { data: updated! },
          resourceType: "job" as const,
          resourceId: updated!.id,
        };
      });
    },
  )
  .post(
    "/jobs/:id/reject",
    requireApiScope("jobs:write"),
    zValidator("json", RejectJobSchema),
    async (c) => {
      const apiKey = c.get("apiKey");
      const input = c.req.valid("json");
      const resolvedId = await resolveExternalResourceId({
        organizationId: apiKey.organizationId,
        resourceType: "job",
        value: c.req.param("id"),
      });
      if (!resolvedId) {
        return c.json(
          buildPublicApiError({
            code: "job_not_found",
            message: "OS não encontrada",
          }),
          404,
        );
      }

      return withIdempotentMutation(c, input, async () => {
        const [existing] = await db
          .select()
          .from(calibrationJob)
          .where(
            and(
              eq(calibrationJob.id, resolvedId),
              eq(calibrationJob.organizationId, apiKey.organizationId),
            ),
          )
          .limit(1);

        if (!existing) {
          return {
            status: 404,
            body: buildPublicApiError({
              code: "job_not_found",
              message: "OS não encontrada",
            }),
          };
        }

        if (existing.status !== "REVIEW") {
          return {
            status: 409,
            body: buildPublicApiError({
              code: "job_not_rejectable",
              message: "A OS precisa estar em revisão para ser rejeitada",
            }),
          };
        }

        const [updated] = await db
          .update(calibrationJob)
          .set({
            status: "REJECTED",
            rejectedBy: apiKey.createdBy,
            rejectedAt: new Date(),
            rejectionReason: input.reason,
          })
          .where(eq(calibrationJob.id, existing.id))
          .returning();

        await db.insert(jobAuditLog).values({
          jobId: existing.id,
          action: "reject",
          changes: { status: { old: existing.status, new: "REJECTED" } },
          performedBy: apiKey.createdBy,
          ipAddress: getPublicApiRequestIp(c.req.raw.headers),
          reason: input.reason,
        });

        return {
          status: 200,
          body: { data: updated! },
          resourceType: "job" as const,
          resourceId: updated!.id,
        };
      });
    },
  )
  .delete(
    "/jobs/:id",
    requireApiScope("jobs:write"),
    zValidator("json", CancelJobSchema),
    async (c) => {
      const apiKey = c.get("apiKey");
      const input = c.req.valid("json");
      const resolvedId = await resolveExternalResourceId({
        organizationId: apiKey.organizationId,
        resourceType: "job",
        value: c.req.param("id"),
      });
      if (!resolvedId) {
        return c.json(
          buildPublicApiError({
            code: "job_not_found",
            message: "OS não encontrada",
          }),
          404,
        );
      }

      return withIdempotentMutation(c, input, async () => {
        const [existing] = await db
          .select()
          .from(calibrationJob)
          .where(
            and(
              eq(calibrationJob.id, resolvedId),
              eq(calibrationJob.organizationId, apiKey.organizationId),
            ),
          )
          .limit(1);

        if (!existing) {
          return {
            status: 404,
            body: buildPublicApiError({
              code: "job_not_found",
              message: "OS não encontrada",
            }),
          };
        }

        if (existing.status === "APPROVED") {
          return {
            status: 409,
            body: buildPublicApiError({
              code: "job_not_cancelable",
              message: "Não é possível cancelar uma OS aprovada",
            }),
          };
        }

        const [updated] = await db
          .update(calibrationJob)
          .set({ status: "CANCELED" })
          .where(eq(calibrationJob.id, existing.id))
          .returning();

        await db.insert(jobAuditLog).values({
          jobId: existing.id,
          action: "cancel",
          changes: { status: { old: existing.status, new: "CANCELED" } },
          performedBy: apiKey.createdBy,
          ipAddress: getPublicApiRequestIp(c.req.raw.headers),
          reason: input.reason,
        });

        await emitPublicApiWebhookEvent({
          organizationId: apiKey.organizationId,
          eventType: "job.canceled",
          payload: {
            id: updated!.id,
            jobId: updated!.jobId,
            status: updated!.status,
          },
          env: c.env,
        });

        return {
          status: 200,
          body: { data: updated! },
          resourceType: "job" as const,
          resourceId: updated!.id,
        };
      });
    },
  )
  .get("/webhooks", requireApiScope("webhooks:manage"), async (c) => {
    const apiKey = c.get("apiKey");
    const subscriptions = await db
      .select()
      .from(publicApiWebhookSubscription)
      .where(
        eq(publicApiWebhookSubscription.organizationId, apiKey.organizationId),
      )
      .orderBy(desc(publicApiWebhookSubscription.createdAt));
    return c.json({ data: subscriptions.map(mapWebhookSubscription) });
  })
  .post(
    "/webhooks",
    requireApiScope("webhooks:manage"),
    zValidator("json", WebhookSubscriptionSchema),
    async (c) => {
      const apiKey = c.get("apiKey");
      const input = c.req.valid("json");

      return withIdempotentMutation(c, input, async () => {
        const secret = createWebhookSecret(c.env);
        const [created] = await db
          .insert(publicApiWebhookSubscription)
          .values({
            id: crypto.randomUUID(),
            organizationId: apiKey.organizationId,
            name: input.name,
            targetUrl: input.targetUrl,
            events: input.events,
            status: input.status ?? "ACTIVE",
            secretPrefix: secret.prefix,
            encryptedSecret: secret.encryptedSecret,
            secretIv: secret.secretIv,
            createdBy: apiKey.createdBy,
          })
          .returning();

        return {
          status: 201,
          body: {
            data: mapWebhookSubscription(created!),
            secret: secret.raw,
          },
        };
      });
    },
  )
  .patch(
    "/webhooks/:id",
    requireApiScope("webhooks:manage"),
    zValidator("json", WebhookSubscriptionSchema.partial()),
    async (c) => {
      const apiKey = c.get("apiKey");
      const input = c.req.valid("json");
      const [existing] = await db
        .select()
        .from(publicApiWebhookSubscription)
        .where(
          and(
            eq(publicApiWebhookSubscription.id, c.req.param("id")),
            eq(
              publicApiWebhookSubscription.organizationId,
              apiKey.organizationId,
            ),
          ),
        )
        .limit(1);

      if (!existing) {
        return c.json(
          buildPublicApiError({
            code: "webhook_not_found",
            message: "Webhook não encontrado",
          }),
          404,
        );
      }

      const [updated] = await db
        .update(publicApiWebhookSubscription)
        .set({
          name: input.name ?? existing.name,
          targetUrl: input.targetUrl ?? existing.targetUrl,
          events: input.events ?? existing.events,
          status: input.status ?? existing.status,
          updatedBy: apiKey.createdBy,
        })
        .where(eq(publicApiWebhookSubscription.id, existing.id))
        .returning();

      return c.json({ data: mapWebhookSubscription(updated!) });
    },
  )
  .delete("/webhooks/:id", requireApiScope("webhooks:manage"), async (c) => {
    const apiKey = c.get("apiKey");
    return withIdempotentMutation(c, { id: c.req.param("id") }, async () => {
      const [existing] = await db
        .select()
        .from(publicApiWebhookSubscription)
        .where(
          and(
            eq(publicApiWebhookSubscription.id, c.req.param("id")),
            eq(
              publicApiWebhookSubscription.organizationId,
              apiKey.organizationId,
            ),
          ),
        )
        .limit(1);

      if (!existing) {
        return {
          status: 404,
          body: buildPublicApiError({
            code: "webhook_not_found",
            message: "Webhook não encontrado",
          }),
        };
      }

      await db
        .delete(publicApiWebhookSubscription)
        .where(eq(publicApiWebhookSubscription.id, existing.id));
      return {
        status: 200,
        body: { data: { id: existing.id, deleted: true } },
      };
    });
  })
  .post("/webhooks/:id/test", requireApiScope("webhooks:manage"), async (c) => {
    const apiKey = c.get("apiKey");
    const [existing] = await db
      .select()
      .from(publicApiWebhookSubscription)
      .where(
        and(
          eq(publicApiWebhookSubscription.id, c.req.param("id")),
          eq(
            publicApiWebhookSubscription.organizationId,
            apiKey.organizationId,
          ),
        ),
      )
      .limit(1);

    if (!existing) {
      return c.json(
        buildPublicApiError({
          code: "webhook_not_found",
          message: "Webhook não encontrado",
        }),
        404,
      );
    }

    await emitPublicApiWebhookEvent({
      organizationId: apiKey.organizationId,
      eventType: existing.events[0] ?? "customer.created",
      payload: {
        test: true,
        subscriptionId: existing.id,
      },
      env: c.env,
    });

    return c.json({ data: { id: existing.id, tested: true } });
  })
  .get(
    "/webhooks/:id/deliveries",
    requireApiScope("webhooks:manage"),
    async (c) => {
      const apiKey = c.get("apiKey");
      const deliveries = await db
        .select()
        .from(publicApiWebhookDelivery)
        .where(
          and(
            eq(publicApiWebhookDelivery.subscriptionId, c.req.param("id")),
            eq(publicApiWebhookDelivery.organizationId, apiKey.organizationId),
          ),
        )
        .orderBy(desc(publicApiWebhookDelivery.createdAt))
        .limit(50);
      return c.json({ data: deliveries });
    },
  )
  .post(
    "/webhooks/:id/deliveries/:deliveryId/replay",
    requireApiScope("webhooks:manage"),
    async (c) => {
      const apiKey = c.get("apiKey");
      const replay = await replayPublicApiWebhookDelivery({
        organizationId: apiKey.organizationId,
        subscriptionId: c.req.param("id"),
        deliveryId: c.req.param("deliveryId"),
        env: c.env,
      });

      if (!replay) {
        return c.json(
          buildPublicApiError({
            code: "webhook_delivery_not_found",
            message: "Entrega não encontrada",
          }),
          404,
        );
      }

      return c.json({ data: replay });
    },
  );
