import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import { enqueueBackgroundJob } from "../lib/background-jobs";
import {
  integrationEventLog,
  integrationObjectLink,
  integrationSyncCursor,
  integrationSyncItem,
  integrationSyncRun,
  organizationIntegration,
  integrationConnection,
  member as memberTable,
  organization as organizationTable,
  session as sessionTable,
  user as userTable,
} from "@calibra-facil/db/schema";
import {
  getProviderCapabilities,
  normalizeFinancialErpConnectionConfig,
  normalizeContaAzulConnectionConfig,
  normalizeIntegrationBaseUrl,
  validateIntegrationMappings,
  type IntegrationObjectLinkTarget,
  type IntegrationSyncTarget,
} from "@calibra-facil/shared";
import {
  acknowledgeIntegrationDrift,
  buildIntegrationDriftQueue,
} from "../lib/integration-drift";

const DRIFT_TARGETS: ReadonlySet<string> = new Set<IntegrationObjectLinkTarget>(
  [
    "customer",
    "catalog_item",
    "service",
    "sale",
    "payable",
    "receivable_installment",
    "fiscal_document",
    "remote_document",
  ],
);

function isDriftTarget(value: string): value is IntegrationObjectLinkTarget {
  return DRIFT_TARGETS.has(value);
}
import {
  buildEmptyRemoteDocumentSummary,
  buildInitialNextScheduledRunAt,
  buildIntegrationOverview,
  buildGenericConnectionConfig,
  createSyncRun,
  decryptIntegrationSecret,
  encryptIntegrationSecret,
  failIntegrationSyncRun,
  failSyncRunAsBlocked,
  getContaAzulScheduleState,
  getIntegrationRecord,
  getRequestedLimitFromRun,
  hasActiveSyncRun,
  getTargetScheduleConfig,
  updateTargetScheduleConfig,
  listOrganizationIntegrations,
  listContaAzulCatalog,
  linkContaAzulFiscalDocumentsToMdfe,
  pollContaAzulBillingStatus,
  pollContaAzulFiscalDocuments,
  pollContaAzulPayableStatus,
  pollContaAzulProtocols,
  pollContaAzulRemoteDrift,
  previewIntegrationSync,
  validateContaAzulConnection,
  validateGenericConnection,
  writeIntegrationEvent,
  writeOrganizationIntegrationEvent,
} from "../lib/integrations";
import {
  buildContaAzulAuthorizationUrl,
  buildContaAzulRefreshFailurePolicy,
  ContaAzulOAuthError,
  exchangeContaAzulAuthorizationCode,
  getContaAzulOAuthConfig,
  parseContaAzulTokenBundle,
  refreshContaAzulAccessToken,
  serializeContaAzulTokenBundle,
  verifyContaAzulOAuthState,
} from "../lib/conta-azul-oauth";
import {
  assertActiveContaAzulIntegration,
  assertProviderSupportsSyncTarget,
  buildContaAzulOAuthErrorUrl,
  buildContaAzulOAuthReturnUrl,
  type IntegrationsBindings,
} from "../modules/integrations/conta-azul-route";
import {
  type AuthVariables,
  requireLabProtected,
  requireOrgType,
  requireRole,
} from "../middleware/permission";

const BaseUrlSchema = z
  .string()
  .trim()
  .url()
  .transform((value, ctx) => {
    try {
      return normalizeIntegrationBaseUrl(value);
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: error instanceof Error ? error.message : "Base URL inválida",
      });
      return z.NEVER;
    }
  });

const MappingRuleSchema = z.object({
  id: z.string().trim().min(1),
  destinationField: z.string().trim().min(1),
  enabled: z.boolean(),
  valueMode: z.enum(["source", "constant"]),
  sourceField: z
    .string()
    .trim()
    .nullable()
    .optional()
    .transform((value) => value ?? null),
  constantValue: z
    .string()
    .nullable()
    .optional()
    .transform((value) => value ?? null),
  formatter: z.enum([
    "none",
    "string",
    "number",
    "boolean",
    "upper_case",
    "lower_case",
    "digits_only",
    "date_only",
    "iso_datetime",
    "currency_major",
  ]),
});

const TargetMappingSchema = z.object({
  fields: z.array(MappingRuleSchema),
});

const IntegrationBodySchema = z.object({
  name: z.string().trim().min(3).max(80),
  baseUrl: BaseUrlSchema,
  authToken: z.string().trim().min(8),
  healthPath: z.string().trim().optional(),
  customerPath: z.string().trim().optional(),
  serviceOrderPath: z.string().trim().optional(),
  billingDocumentPath: z.string().trim().optional(),
  mappings: z
    .object({
      catalog_item: TargetMappingSchema.optional(),
      contract: TargetMappingSchema.optional(),
      customer: TargetMappingSchema.optional(),
      supplier: TargetMappingSchema.optional(),
      transporter: TargetMappingSchema.optional(),
      service_order: TargetMappingSchema.optional(),
      billing_document: TargetMappingSchema.optional(),
      payable: TargetMappingSchema.optional(),
    })
    .optional(),
});

const UpdateIntegrationBodySchema = z.object({
  name: z.string().trim().min(3).max(80).optional(),
  baseUrl: BaseUrlSchema.optional(),
  authToken: z.string().trim().min(8).optional(),
  healthPath: z.string().trim().optional(),
  customerPath: z.string().trim().optional(),
  serviceOrderPath: z.string().trim().optional(),
  billingDocumentPath: z.string().trim().optional(),
  mappings: z
    .object({
      catalog_item: TargetMappingSchema.optional(),
      contract: TargetMappingSchema.optional(),
      customer: TargetMappingSchema.optional(),
      supplier: TargetMappingSchema.optional(),
      transporter: TargetMappingSchema.optional(),
      service_order: TargetMappingSchema.optional(),
      billing_document: TargetMappingSchema.optional(),
      payable: TargetMappingSchema.optional(),
    })
    .optional(),
});

const SyncRequestSchema = z.object({
  target: z.enum([
    "catalog_item",
    "contract",
    "customer",
    "supplier",
    "transporter",
    "service_order",
    "billing_document",
    "payable",
  ]),
  limit: z.coerce.number().min(1).max(250).default(50),
  mappings: z
    .object({
      catalog_item: TargetMappingSchema.optional(),
      contract: TargetMappingSchema.optional(),
      customer: TargetMappingSchema.optional(),
      supplier: TargetMappingSchema.optional(),
      transporter: TargetMappingSchema.optional(),
      service_order: TargetMappingSchema.optional(),
      billing_document: TargetMappingSchema.optional(),
      payable: TargetMappingSchema.optional(),
    })
    .optional(),
});

const ToggleSchema = z.object({
  enabled: z.boolean(),
});

const ScheduleSchema = z.object({
  target: z.enum([
    "catalog_item",
    "contract",
    "customer",
    "supplier",
    "transporter",
    "service_order",
    "billing_document",
    "payable",
  ]),
  mode: z.enum(["disabled", "manual_only", "scheduled"]),
  frequency: z.enum(["daily", "weekly"]).optional(),
});

const OAuthStartBodySchema = z.object({
  returnTo: z
    .string()
    .trim()
    .max(500)
    .refine(
      (value) => value.startsWith("/") && !value.startsWith("//"),
      "returnTo inválido",
    )
    .nullable()
    .optional()
    .transform((value) => value ?? null),
});

const ContaAzulPollBodySchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
});

const SyncItemsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(250).default(100),
});

const ContaAzulMdfeLinkBodySchema = z.object({
  externalId: z.string().trim().min(1).max(160),
  fiscalDocumentAccessKeys: z
    .array(z.string().trim().min(1).max(80))
    .min(1)
    .max(50),
  mdfeIdentifier: z.string().trim().min(1).max(120),
  status: z
    .enum(["AUTORIZADO", "ENCERRADO", "CANCELADO"])
    .nullable()
    .optional(),
});

const ContaAzulExportModeSchema = z.enum([
  "budget_to_sale",
  "contract_generated",
  "receivable_event",
  "sale",
  "sale_and_receivable",
]);

const ContaAzulBudgetModeSchema = z.enum(["sales_search_link"]);

const ContaAzulFiscalModeSchema = z.enum(["consultation_only", "disabled"]);

const ContaAzulProtocolModeSchema = z.enum([
  "api_lookup_verified",
  "metadata_only",
]);

const ContaAzulSaleTriggerSchema = z.enum([
  "billing_document_issued",
  "certificate_approved",
  "manual",
  "quote_approved",
  "service_order_approved",
  "service_order_completed",
]);

const ContaAzulConfigBodySchema = z.object({
  budgetMode: ContaAzulBudgetModeSchema.optional(),
  defaultFinancialAccountId: z.string().trim().min(1).nullable().optional(),
  defaultCategoryId: z.string().trim().min(1).nullable().optional(),
  defaultCostCenterId: z.string().trim().min(1).nullable().optional(),
  defaultDreCategoryId: z.string().trim().min(1).nullable().optional(),
  defaultExpenseCategoryId: z.string().trim().min(1).nullable().optional(),
  defaultPaymentMethodId: z.string().trim().min(1).nullable().optional(),
  defaultProductCategoryId: z.string().trim().min(1).nullable().optional(),
  defaultSellerId: z.string().trim().min(1).nullable().optional(),
  defaultServiceCategoryId: z.string().trim().min(1).nullable().optional(),
  defaultUnitOfMeasureId: z.string().trim().min(1).nullable().optional(),
  defaultFiscalTaxonomy: z
    .record(z.string(), z.unknown())
    .nullable()
    .optional(),
  fiscalMode: ContaAzulFiscalModeSchema.optional(),
  protocolMode: ContaAzulProtocolModeSchema.optional(),
  saleTrigger: ContaAzulSaleTriggerSchema.optional(),
  exportMode: ContaAzulExportModeSchema.optional(),
  enabledTargets: z
    .object({
      baixas: z.boolean().optional(),
      balances: z.boolean().optional(),
      billingDocuments: z.boolean().optional(),
      budgets: z.boolean().optional(),
      categories: z.boolean().optional(),
      contracts: z.boolean().optional(),
      costCenters: z.boolean().optional(),
      customers: z.boolean().optional(),
      dreCategories: z.boolean().optional(),
      driftChecks: z.boolean().optional(),
      expenses: z.boolean().optional(),
      financialAccounts: z.boolean().optional(),
      fiscalDocuments: z.boolean().optional(),
      inventoryTaxonomy: z.boolean().optional(),
      payables: z.boolean().optional(),
      paymentStatusPolling: z.boolean().optional(),
      products: z.boolean().optional(),
      protocols: z.boolean().optional(),
      receivables: z.boolean().optional(),
      remoteDocuments: z.boolean().optional(),
      sales: z.boolean().optional(),
      sellers: z.boolean().optional(),
      services: z.boolean().optional(),
      suppliers: z.boolean().optional(),
      transfers: z.boolean().optional(),
      transporters: z.boolean().optional(),
    })
    .optional(),
});

const ContaAzulCatalogSchema = z.enum([
  "accounts",
  "balances",
  "categories",
  "cost-centers",
  "dre-categories",
  "product-categories",
  "product-cest",
  "product-ecommerce-brands",
  "product-ecommerce-categories",
  "product-ncm",
  "products",
  "product-units",
  "sellers",
  "services",
  "transfers",
]);

const OAuthCallbackQuerySchema = z.object({
  code: z.string().trim().min(1),
  state: z.string().trim().min(1),
});

async function resolveContaAzulOAuthCallbackContext(state: {
  organizationId: string;
  userId: string;
  sessionId: string;
}) {
  const [record] = await db
    .select({
      memberId: memberTable.id,
      memberRole: memberTable.role,
      organizationId: organizationTable.id,
      organizationType: organizationTable.type,
      userId: userTable.id,
      sessionId: sessionTable.id,
    })
    .from(sessionTable)
    .innerJoin(userTable, eq(userTable.id, sessionTable.userId))
    .innerJoin(
      memberTable,
      and(
        eq(memberTable.organizationId, state.organizationId),
        eq(memberTable.userId, state.userId),
      ),
    )
    .innerJoin(
      organizationTable,
      eq(organizationTable.id, memberTable.organizationId),
    )
    .where(
      and(
        eq(sessionTable.id, state.sessionId),
        eq(sessionTable.userId, state.userId),
        eq(sessionTable.activeOrganizationId, state.organizationId),
        gt(sessionTable.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!record) {
    throw new HTTPException(401, { message: "Sessão OAuth inválida" });
  }

  if (record.organizationType !== "LAB") {
    throw new HTTPException(403, {
      message: "Conta Azul só pode ser conectada por organizações LAB",
    });
  }

  if (record.memberRole !== "admin" && record.memberRole !== "owner") {
    throw new HTTPException(403, {
      message: "Apenas admin ou owner pode conectar a Conta Azul",
    });
  }

  return record;
}

async function buildListPayload(organizationId: string) {
  const integrations = await listOrganizationIntegrations(organizationId);

  const data = await Promise.all(
    integrations.map(async (integration) => {
      const recentRuns = await db.query.integrationSyncRun.findMany({
        where: and(
          eq(integrationSyncRun.integrationId, integration.id),
          eq(integrationSyncRun.organizationId, organizationId),
        ),
        orderBy: [desc(integrationSyncRun.createdAt)],
        limit: 5,
      });

      const recentEvents = await db.query.integrationEventLog.findMany({
        where: and(
          eq(integrationEventLog.integrationId, integration.id),
          eq(integrationEventLog.organizationId, organizationId),
        ),
        orderBy: [desc(integrationEventLog.createdAt)],
        limit: 5,
      });
      const overview = integration.connection
        ? await buildIntegrationOverview({
            integration,
            connection: integration.connection,
          })
        : {
            readiness: {
              setupStatus: "NOT_CONFIGURED" as const,
              readinessStatus: "NOT_READY" as const,
              capabilities: getProviderCapabilities(integration.provider),
              validationRequired: true,
              canSync: false,
              lastValidatedAt: null,
              lastValidationError: integration.lastValidationError,
              dependencyWarnings: [],
            },
            targets: [],
            remoteDocuments: buildEmptyRemoteDocumentSummary(),
            syncSummary: {
              lastRunAt: null,
              lastSuccessfulRunAt: null,
              lastErrorAt: null,
              hasRecentFailures: false,
            },
          };

      return {
        id: integration.id,
        type: integration.type,
        provider: integration.provider,
        name: integration.name,
        status: integration.status,
        lastValidatedAt: integration.lastValidatedAt,
        lastValidationError: integration.lastValidationError,
        createdAt: integration.createdAt,
        updatedAt: integration.updatedAt,
        connection: {
          id: integration.connection?.id ?? null,
          credentialType: integration.connection?.credentialType ?? "bearer",
          config: integration.connection?.config
            ? normalizeFinancialErpConnectionConfig(
                integration.provider,
                integration.connection.config,
              )
            : null,
        },
        recentRuns,
        recentEvents,
        overview,
      };
    }),
  );

  return { data };
}

export async function dispatchSyncRun(params: {
  env: IntegrationsBindings;
  integrationId: string;
  organizationId: string;
  runId: string;
  target: IntegrationSyncTarget;
  limit: number;
  trigger: "manual" | "event" | "scheduled" | "retry";
  waitUntil?: (promise: Promise<void>) => void;
}) {
  const record = await getIntegrationRecord(
    params.organizationId,
    params.integrationId,
  );

  if (record) {
    assertProviderSupportsSyncTarget(
      record.integration.provider,
      params.target,
    );
  }

  if (record?.integration.provider === "conta_azul") {
    try {
      await enqueueBackgroundJob(
        {
          type: "INTEGRATION_SYNC",
          provider: "conta_azul",
          integrationId: params.integrationId,
          organizationId: params.organizationId,
          runId: params.runId,
          target: params.target,
          limit: params.limit,
          trigger: params.trigger,
        },
        {
          idempotencyKey: `conta-azul-sync-${params.runId}`,
        },
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Falha ao enfileirar sincronização Conta Azul";

      await failIntegrationSyncRun({
        integrationId: params.integrationId,
        organizationId: params.organizationId,
        runId: params.runId,
        target: params.target,
        message,
        details: {
          phase: "queue_send",
          trigger: params.trigger,
        },
      });

      throw new Error(message, { cause: error });
    }

    return { queued: true as const, status: "PENDING" as const };
  }

  try {
    await enqueueBackgroundJob({
      type: "INTEGRATION_SYNC",
      integrationId: params.integrationId,
      organizationId: params.organizationId,
      runId: params.runId,
      target: params.target,
      limit: params.limit,
      trigger: params.trigger,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Falha ao enfileirar sincronização";

    await failIntegrationSyncRun({
      integrationId: params.integrationId,
      organizationId: params.organizationId,
      runId: params.runId,
      target: params.target,
      message,
      details: {
        phase: "queue_send",
        trigger: params.trigger,
      },
    });

    throw new Error(message, { cause: error });
  }

  return { queued: true as const, status: "PENDING" as const };
}

async function upsertContaAzulConnection(params: {
  organizationId: string;
  actorUserId: string;
  tokenBundle: ReturnType<typeof parseContaAzulTokenBundle>;
  env: IntegrationsBindings;
}) {
  const encrypted = encryptIntegrationSecret(
    serializeContaAzulTokenBundle(params.tokenBundle),
    params.env,
  );

  return db.transaction(async (tx) => {
    // Serialize concurrent OAuth callbacks for the same org+provider so two
    // first-time connect requests cannot both pass findFirst and insert
    // duplicate organization_integration rows. Lock is transaction-scoped and
    // released on commit/rollback.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`integration:conta_azul:${params.organizationId}`}, 0))`,
    );

    const existing = await tx.query.organizationIntegration.findFirst({
      where: and(
        eq(organizationIntegration.organizationId, params.organizationId),
        eq(organizationIntegration.type, "financial_erp"),
        eq(organizationIntegration.provider, "conta_azul"),
      ),
      with: {
        connection: true,
      },
    });
    const integrationId = existing?.id ?? crypto.randomUUID();
    const connectionId = existing?.connection?.id ?? crypto.randomUUID();
    const previousConfig = existing?.connection
      ? normalizeContaAzulConnectionConfig(existing.connection.config)
      : null;
    const config = normalizeContaAzulConnectionConfig({
      ...previousConfig,
      accessTokenExpiresAt: params.tokenBundle.expiresAt,
      scopes: params.tokenBundle.scopes,
    });

    if (existing) {
      // Re-authorization may target a different Conta Azul account. Prior
      // integration_object_link rows and sync cursors are tied to the old
      // remote-account identity, so wipe them — callers must re-sync after a
      // reconnect.
      if (existing.connection) {
        await tx
          .delete(integrationObjectLink)
          .where(eq(integrationObjectLink.integrationId, integrationId));

        await tx
          .delete(integrationSyncCursor)
          .where(eq(integrationSyncCursor.integrationId, integrationId));
      }

      await tx
        .update(organizationIntegration)
        .set({
          name: existing.name || "Conta Azul",
          status: "ACTIVE",
          lastValidationError: null,
          disabledAt: null,
          updatedBy: params.actorUserId,
          updatedAt: new Date(),
        })
        .where(eq(organizationIntegration.id, integrationId));
    } else {
      await tx.insert(organizationIntegration).values({
        id: integrationId,
        organizationId: params.organizationId,
        type: "financial_erp",
        provider: "conta_azul",
        name: "Conta Azul",
        status: "ACTIVE",
        createdBy: params.actorUserId,
        updatedBy: params.actorUserId,
      });
    }

    if (existing?.connection) {
      await tx
        .update(integrationConnection)
        .set({
          credentialType: "oauth2",
          config,
          encryptedSecret: encrypted.encryptedSecret,
          secretIv: encrypted.secretIv,
          updatedBy: params.actorUserId,
          updatedAt: new Date(),
        })
        .where(eq(integrationConnection.id, connectionId));
    } else {
      await tx.insert(integrationConnection).values({
        id: connectionId,
        integrationId,
        organizationId: params.organizationId,
        credentialType: "oauth2",
        config,
        encryptedSecret: encrypted.encryptedSecret,
        secretIv: encrypted.secretIv,
        createdBy: params.actorUserId,
        updatedBy: params.actorUserId,
      });
    }

    return {
      integrationId,
      accessTokenExpiresAt: params.tokenBundle.expiresAt,
    };
  });
}

function decryptContaAzulTokenBundle(params: {
  encryptedSecret: string;
  secretIv: string;
  env: IntegrationsBindings;
}) {
  return parseContaAzulTokenBundle(
    decryptIntegrationSecret(
      params.encryptedSecret,
      params.secretIv,
      params.env,
    ),
  );
}

export const integrationsRouter = new Hono<{
  Variables: AuthVariables;
  Bindings: IntegrationsBindings;
}>()
  .get(
    "/",
    ...requireLabProtected,
    requireOrgType("LAB"),
    requireRole(["admin", "owner"]),
    async (c) => {
      const member = c.get("member");
      return c.json(await buildListPayload(member.organizationId));
    },
  )
  .post(
    "/conta-azul/oauth/start",
    ...requireLabProtected,
    requireOrgType("LAB"),
    requireRole(["admin", "owner"]),
    zValidator("json", OAuthStartBodySchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const input = c.req.valid("json");
      let config: ReturnType<typeof getContaAzulOAuthConfig>;
      let authorization: Awaited<
        ReturnType<typeof buildContaAzulAuthorizationUrl>
      >;

      try {
        config = getContaAzulOAuthConfig(c.env);
        authorization = await buildContaAzulAuthorizationUrl({
          config,
          organizationId: member.organizationId,
          userId: session.user.id,
          sessionId: session.session.id,
          returnTo: input.returnTo,
        });
      } catch (error) {
        return c.json(
          {
            error:
              error instanceof Error
                ? error.message
                : "Configuração OAuth da Conta Azul inválida",
          },
          503,
        );
      }

      await writeOrganizationIntegrationEvent({
        organizationId: member.organizationId,
        actorUserId: session.user.id,
        actorMemberId: member.id,
        action: "integration.conta_azul.oauth_started",
        entityId: "conta_azul",
        details: {
          provider: "conta_azul",
          redirectUri: config.redirectUri,
          returnTo: input.returnTo,
        },
      });

      return c.json({
        authorizationUrl: authorization.url,
        expiresInSeconds: 600,
      });
    },
  )
  .get(
    "/conta-azul/oauth/callback",
    zValidator("query", OAuthCallbackQuerySchema),
    async (c) => {
      const input = c.req.valid("query");
      const config = getContaAzulOAuthConfig(c.env);

      let state: Awaited<ReturnType<typeof verifyContaAzulOAuthState>>;
      try {
        state = await verifyContaAzulOAuthState({
          state: input.state,
          stateSecret: config.stateSecret,
        });
      } catch {
        // Expired/tampered/replayed state is a client error, not a server fault.
        return c.redirect(
          buildContaAzulOAuthErrorUrl(c.env, null, "invalid_state"),
        );
      }

      const callbackContext = await resolveContaAzulOAuthCallbackContext(state);

      let tokenBundle: Awaited<
        ReturnType<typeof exchangeContaAzulAuthorizationCode>
      >;
      try {
        tokenBundle = await exchangeContaAzulAuthorizationCode(config, {
          code: input.code,
        });
      } catch (error) {
        // Provider-rejected code (invalid/expired) → recoverable client error.
        if (error instanceof ContaAzulOAuthError) {
          return c.redirect(
            buildContaAzulOAuthErrorUrl(
              c.env,
              state.returnTo,
              "exchange_failed",
            ),
          );
        }
        throw error;
      }
      const connection = await upsertContaAzulConnection({
        organizationId: callbackContext.organizationId,
        actorUserId: callbackContext.userId,
        tokenBundle,
        env: c.env,
      });

      await writeIntegrationEvent({
        integrationId: connection.integrationId,
        organizationId: callbackContext.organizationId,
        level: "info",
        event: "integration.conta_azul.connected",
        message: "Conta Azul conectada via OAuth",
        details: {
          provider: "conta_azul",
          accessTokenExpiresAt: connection.accessTokenExpiresAt,
        },
      });

      await writeOrganizationIntegrationEvent({
        organizationId: callbackContext.organizationId,
        actorUserId: callbackContext.userId,
        actorMemberId: callbackContext.memberId,
        action: "integration.conta_azul.connected",
        entityId: connection.integrationId,
        details: {
          provider: "conta_azul",
          accessTokenExpiresAt: connection.accessTokenExpiresAt,
        },
      });

      return c.redirect(buildContaAzulOAuthReturnUrl(c.env, state.returnTo));
    },
  )
  .post(
    "/",
    ...requireLabProtected,
    requireOrgType("LAB"),
    requireRole(["admin", "owner"]),
    zValidator("json", IntegrationBodySchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const input = c.req.valid("json");
      const config = buildGenericConnectionConfig(input);
      const mappingIssues = validateIntegrationMappings(config.mappings);

      if (mappingIssues.length > 0) {
        return c.json(
          { error: mappingIssues.map((issue) => issue.message).join(" ") },
          400,
        );
      }
      const encrypted = encryptIntegrationSecret(input.authToken, c.env);
      const integrationId = crypto.randomUUID();
      const connectionId = crypto.randomUUID();

      await db.transaction(async (tx) => {
        await tx.insert(organizationIntegration).values({
          id: integrationId,
          organizationId: member.organizationId,
          type: "financial_erp",
          provider: "generic_http",
          name: input.name,
          status: "ACTIVE",
          createdBy: session.user.id,
          updatedBy: session.user.id,
        });

        await tx.insert(integrationConnection).values({
          id: connectionId,
          integrationId,
          organizationId: member.organizationId,
          credentialType: "bearer",
          config,
          encryptedSecret: encrypted.encryptedSecret,
          secretIv: encrypted.secretIv,
          createdBy: session.user.id,
          updatedBy: session.user.id,
        });
      });

      await writeIntegrationEvent({
        integrationId,
        organizationId: member.organizationId,
        level: "info",
        event: "integration.created",
        message: "Integração criada",
        details: {
          provider: "generic_http",
          type: "financial_erp",
          name: input.name,
        },
      });

      await writeOrganizationIntegrationEvent({
        organizationId: member.organizationId,
        actorUserId: session.user.id,
        actorMemberId: member.id,
        action: "integration.created",
        entityId: integrationId,
        details: {
          provider: "generic_http",
          type: "financial_erp",
          name: input.name,
        },
      });

      return c.json(await buildListPayload(member.organizationId), 201);
    },
  )
  .put(
    "/:id",
    ...requireLabProtected,
    requireOrgType("LAB"),
    requireRole(["admin", "owner"]),
    zValidator("json", UpdateIntegrationBodySchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = c.req.param("id");
      const input = c.req.valid("json");
      const record = await getIntegrationRecord(member.organizationId, id);

      if (!record) {
        return c.json({ error: "Integração não encontrada" }, 404);
      }

      if (record.integration.provider !== "generic_http") {
        return c.json(
          { error: "Use as rotas nativas da Conta Azul para esta integração" },
          400,
        );
      }

      const currentConfig = buildGenericConnectionConfig(
        record.connection.config,
      );
      const mergedConfig = buildGenericConnectionConfig({
        baseUrl: input.baseUrl ?? currentConfig.baseUrl,
        healthPath: input.healthPath ?? currentConfig.healthPath,
        customerPath: input.customerPath ?? currentConfig.customerPath,
        serviceOrderPath:
          input.serviceOrderPath ?? currentConfig.serviceOrderPath,
        billingDocumentPath:
          input.billingDocumentPath ?? currentConfig.billingDocumentPath,
        schedules: currentConfig.schedules,
        mappings: input.mappings
          ? {
              ...currentConfig.mappings,
              ...input.mappings,
            }
          : currentConfig.mappings,
      });
      const mappingIssues = validateIntegrationMappings(mergedConfig.mappings);

      if (mappingIssues.length > 0) {
        return c.json(
          { error: mappingIssues.map((issue) => issue.message).join(" ") },
          400,
        );
      }

      await db.transaction(async (tx) => {
        await tx
          .update(organizationIntegration)
          .set({
            name: input.name ?? record.integration.name,
            updatedBy: session.user.id,
            updatedAt: new Date(),
          })
          .where(eq(organizationIntegration.id, id));

        const connectionUpdate: Partial<
          typeof integrationConnection.$inferInsert
        > = {
          config: mergedConfig,
          updatedBy: session.user.id,
          updatedAt: new Date(),
        };

        if (input.authToken) {
          const encrypted = encryptIntegrationSecret(input.authToken, c.env);
          connectionUpdate.encryptedSecret = encrypted.encryptedSecret;
          connectionUpdate.secretIv = encrypted.secretIv;
        }

        await tx
          .update(integrationConnection)
          .set(connectionUpdate)
          .where(eq(integrationConnection.integrationId, id));
      });

      await writeIntegrationEvent({
        integrationId: id,
        organizationId: member.organizationId,
        level: "info",
        event: "integration.updated",
        message: "Integração atualizada",
      });

      await writeOrganizationIntegrationEvent({
        organizationId: member.organizationId,
        actorUserId: session.user.id,
        actorMemberId: member.id,
        action: "integration.updated",
        entityId: id,
      });

      return c.json(await buildListPayload(member.organizationId));
    },
  )
  .get(
    "/:id/conta-azul/schedule",
    ...requireLabProtected,
    requireOrgType("LAB"),
    requireRole(["admin", "owner"]),
    async (c) => {
      const member = c.get("member");
      const id = c.req.param("id");

      await assertActiveContaAzulIntegration({
        organizationId: member.organizationId,
        integrationId: id,
      });

      return c.json(
        await getContaAzulScheduleState({
          integrationId: id,
          organizationId: member.organizationId,
        }),
      );
    },
  )
  .post(
    "/:id/conta-azul/refresh",
    ...requireLabProtected,
    requireOrgType("LAB"),
    requireRole(["admin", "owner"]),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = c.req.param("id");
      const record = await getIntegrationRecord(member.organizationId, id);

      if (!record || record.integration.provider !== "conta_azul") {
        return c.json({ error: "Integração Conta Azul não encontrada" }, 404);
      }

      try {
        const tokenBundle = decryptContaAzulTokenBundle({
          encryptedSecret: record.connection.encryptedSecret,
          secretIv: record.connection.secretIv,
          env: c.env,
        });
        const refreshed = await refreshContaAzulAccessToken(
          getContaAzulOAuthConfig(c.env),
          {
            refreshToken: tokenBundle.refreshToken,
          },
        );
        const encrypted = encryptIntegrationSecret(
          serializeContaAzulTokenBundle(refreshed),
          c.env,
        );
        const config = normalizeContaAzulConnectionConfig({
          ...record.connection.config,
          accessTokenExpiresAt: refreshed.expiresAt,
          scopes: refreshed.scopes,
        });

        await db.transaction(async (tx) => {
          await tx
            .update(integrationConnection)
            .set({
              credentialType: "oauth2",
              config,
              encryptedSecret: encrypted.encryptedSecret,
              secretIv: encrypted.secretIv,
              updatedBy: session.user.id,
              updatedAt: new Date(),
            })
            .where(eq(integrationConnection.integrationId, id));

          await tx
            .update(organizationIntegration)
            .set({
              status:
                record.integration.status === "ACTION_REQUIRED"
                  ? "ACTIVE"
                  : record.integration.status,
              lastValidationError: null,
              updatedBy: session.user.id,
              updatedAt: new Date(),
            })
            .where(eq(organizationIntegration.id, id));
        });

        await writeIntegrationEvent({
          integrationId: id,
          organizationId: member.organizationId,
          level: "info",
          event: "integration.conta_azul.token_refreshed",
          message: "Token OAuth da Conta Azul renovado",
          details: {
            provider: "conta_azul",
            accessTokenExpiresAt: refreshed.expiresAt,
          },
        });

        return c.json({
          success: true,
          accessTokenExpiresAt: refreshed.expiresAt,
        });
      } catch (error) {
        const failure = buildContaAzulRefreshFailurePolicy(error);

        await db
          .update(organizationIntegration)
          .set({
            status: failure.status,
            lastValidationError: failure.message,
            updatedBy: session.user.id,
            updatedAt: new Date(),
          })
          .where(eq(organizationIntegration.id, id));

        await writeIntegrationEvent({
          integrationId: id,
          organizationId: member.organizationId,
          level: "error",
          event: "integration.conta_azul.refresh_failed",
          message: failure.message,
          details: {
            provider: "conta_azul",
            reason: failure.reason,
          },
        });

        return c.json({ error: failure.message }, 400);
      }
    },
  )
  .post(
    "/:id/conta-azul/disconnect",
    ...requireLabProtected,
    requireOrgType("LAB"),
    requireRole(["admin", "owner"]),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = c.req.param("id");
      const record = await getIntegrationRecord(member.organizationId, id);

      if (!record || record.integration.provider !== "conta_azul") {
        return c.json({ error: "Integração Conta Azul não encontrada" }, 404);
      }

      await db.transaction(async (tx) => {
        // Clear remote-link state so a fresh reconnect cannot reuse stale
        // links that belong to the prior Conta Azul account.
        await tx
          .delete(integrationObjectLink)
          .where(eq(integrationObjectLink.integrationId, id));

        await tx
          .delete(integrationSyncCursor)
          .where(eq(integrationSyncCursor.integrationId, id));

        await tx
          .delete(integrationConnection)
          .where(eq(integrationConnection.integrationId, id));

        await tx
          .update(organizationIntegration)
          .set({
            status: "DISABLED",
            disabledAt: new Date(),
            lastValidationError: null,
            updatedBy: session.user.id,
            updatedAt: new Date(),
          })
          .where(eq(organizationIntegration.id, id));
      });

      await writeIntegrationEvent({
        integrationId: id,
        organizationId: member.organizationId,
        level: "info",
        event: "integration.conta_azul.disconnected",
        message: "Conta Azul desconectada",
        details: {
          provider: "conta_azul",
        },
      });

      await writeOrganizationIntegrationEvent({
        organizationId: member.organizationId,
        actorUserId: session.user.id,
        actorMemberId: member.id,
        action: "integration.conta_azul.disconnected",
        entityId: id,
        details: {
          provider: "conta_azul",
        },
      });

      return c.json({ success: true });
    },
  )
  .get(
    "/:id/conta-azul/catalog/accounts",
    ...requireLabProtected,
    requireOrgType("LAB"),
    requireRole(["admin", "owner"]),
    async (c) => {
      const member = c.get("member");
      const id = c.req.param("id");

      await assertActiveContaAzulIntegration({
        organizationId: member.organizationId,
        integrationId: id,
      });

      try {
        return c.json(
          await listContaAzulCatalog({
            integrationId: id,
            organizationId: member.organizationId,
            env: c.env,
            catalog: "accounts",
          }),
        );
      } catch (error) {
        return c.json(
          {
            error:
              error instanceof Error
                ? error.message
                : "Falha ao carregar contas financeiras",
          },
          400,
        );
      }
    },
  )
  .get(
    "/:id/conta-azul/catalog/categories",
    ...requireLabProtected,
    requireOrgType("LAB"),
    requireRole(["admin", "owner"]),
    async (c) => {
      const member = c.get("member");
      const id = c.req.param("id");

      await assertActiveContaAzulIntegration({
        organizationId: member.organizationId,
        integrationId: id,
      });

      try {
        return c.json(
          await listContaAzulCatalog({
            integrationId: id,
            organizationId: member.organizationId,
            env: c.env,
            catalog: "categories",
          }),
        );
      } catch (error) {
        return c.json(
          {
            error:
              error instanceof Error
                ? error.message
                : "Falha ao carregar categorias",
          },
          400,
        );
      }
    },
  )
  .get(
    "/:id/conta-azul/catalog/cost-centers",
    ...requireLabProtected,
    requireOrgType("LAB"),
    requireRole(["admin", "owner"]),
    async (c) => {
      const member = c.get("member");
      const id = c.req.param("id");

      await assertActiveContaAzulIntegration({
        organizationId: member.organizationId,
        integrationId: id,
      });

      try {
        return c.json(
          await listContaAzulCatalog({
            integrationId: id,
            organizationId: member.organizationId,
            env: c.env,
            catalog: "cost-centers",
          }),
        );
      } catch (error) {
        return c.json(
          {
            error:
              error instanceof Error
                ? error.message
                : "Falha ao carregar centros de custo",
          },
          400,
        );
      }
    },
  )
  .get(
    "/:id/conta-azul/catalog/:catalog",
    ...requireLabProtected,
    requireOrgType("LAB"),
    requireRole(["admin", "owner"]),
    async (c) => {
      const member = c.get("member");
      const id = c.req.param("id");
      const parsedCatalog = ContaAzulCatalogSchema.safeParse(
        c.req.param("catalog"),
      );

      if (!parsedCatalog.success) {
        return c.json({ error: "Catálogo Conta Azul inválido" }, 400);
      }

      await assertActiveContaAzulIntegration({
        organizationId: member.organizationId,
        integrationId: id,
      });

      try {
        return c.json(
          await listContaAzulCatalog({
            integrationId: id,
            organizationId: member.organizationId,
            env: c.env,
            catalog: parsedCatalog.data,
          }),
        );
      } catch (error) {
        return c.json(
          {
            error:
              error instanceof Error
                ? error.message
                : "Falha ao carregar catálogo da Conta Azul",
          },
          400,
        );
      }
    },
  )
  .put(
    "/:id/conta-azul/config",
    ...requireLabProtected,
    requireOrgType("LAB"),
    requireRole(["admin", "owner"]),
    zValidator("json", ContaAzulConfigBodySchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = c.req.param("id");
      const input = c.req.valid("json");
      const record = await getIntegrationRecord(member.organizationId, id);

      if (!record || record.integration.provider !== "conta_azul") {
        return c.json({ error: "Integração Conta Azul não encontrada" }, 404);
      }

      const currentConfig = normalizeContaAzulConnectionConfig(
        record.connection.config,
      );
      const nextConfig = normalizeContaAzulConnectionConfig({
        ...currentConfig,
        defaultFinancialAccountId:
          input.defaultFinancialAccountId === undefined
            ? currentConfig.defaultFinancialAccountId
            : input.defaultFinancialAccountId,
        defaultCategoryId:
          input.defaultCategoryId === undefined
            ? currentConfig.defaultCategoryId
            : input.defaultCategoryId,
        defaultCostCenterId:
          input.defaultCostCenterId === undefined
            ? currentConfig.defaultCostCenterId
            : input.defaultCostCenterId,
        defaultDreCategoryId:
          input.defaultDreCategoryId === undefined
            ? currentConfig.defaultDreCategoryId
            : input.defaultDreCategoryId,
        defaultExpenseCategoryId:
          input.defaultExpenseCategoryId === undefined
            ? currentConfig.defaultExpenseCategoryId
            : input.defaultExpenseCategoryId,
        defaultPaymentMethodId:
          input.defaultPaymentMethodId === undefined
            ? currentConfig.defaultPaymentMethodId
            : input.defaultPaymentMethodId,
        defaultProductCategoryId:
          input.defaultProductCategoryId === undefined
            ? currentConfig.defaultProductCategoryId
            : input.defaultProductCategoryId,
        defaultSellerId:
          input.defaultSellerId === undefined
            ? currentConfig.defaultSellerId
            : input.defaultSellerId,
        defaultServiceCategoryId:
          input.defaultServiceCategoryId === undefined
            ? currentConfig.defaultServiceCategoryId
            : input.defaultServiceCategoryId,
        defaultUnitOfMeasureId:
          input.defaultUnitOfMeasureId === undefined
            ? currentConfig.defaultUnitOfMeasureId
            : input.defaultUnitOfMeasureId,
        budgetMode: input.budgetMode ?? currentConfig.budgetMode,
        defaultFiscalTaxonomy:
          input.defaultFiscalTaxonomy === undefined
            ? currentConfig.defaultFiscalTaxonomy
            : input.defaultFiscalTaxonomy,
        fiscalMode: input.fiscalMode ?? currentConfig.fiscalMode,
        protocolMode: input.protocolMode ?? currentConfig.protocolMode,
        saleTrigger: input.saleTrigger ?? currentConfig.saleTrigger,
        exportMode: input.exportMode ?? currentConfig.exportMode,
        enabledTargets: input.enabledTargets
          ? {
              ...currentConfig.enabledTargets,
              ...input.enabledTargets,
            }
          : currentConfig.enabledTargets,
      });

      await db
        .update(integrationConnection)
        .set({
          config: nextConfig,
          updatedBy: session.user.id,
          updatedAt: new Date(),
        })
        .where(eq(integrationConnection.integrationId, id));

      await writeIntegrationEvent({
        integrationId: id,
        organizationId: member.organizationId,
        level: "info",
        event: "integration.conta_azul.config_updated",
        message: "Configuração da Conta Azul atualizada",
        details: {
          provider: "conta_azul",
          exportMode: nextConfig.exportMode,
          enabledTargets: nextConfig.enabledTargets,
        },
      });

      await writeOrganizationIntegrationEvent({
        organizationId: member.organizationId,
        actorUserId: session.user.id,
        actorMemberId: member.id,
        action: "integration.conta_azul.config_updated",
        entityId: id,
      });

      return c.json(await buildListPayload(member.organizationId));
    },
  )
  .post(
    "/:id/conta-azul/poll",
    ...requireLabProtected,
    requireOrgType("LAB"),
    requireRole(["admin", "owner"]),
    zValidator("json", ContaAzulPollBodySchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = c.req.param("id");
      const input = c.req.valid("json");

      await assertActiveContaAzulIntegration({
        organizationId: member.organizationId,
        integrationId: id,
      });

      try {
        const result = await pollContaAzulBillingStatus({
          integrationId: id,
          organizationId: member.organizationId,
          env: c.env,
          limit: input.limit,
        });

        await writeOrganizationIntegrationEvent({
          organizationId: member.organizationId,
          actorUserId: session.user.id,
          actorMemberId: member.id,
          action: "integration.conta_azul.payment_poll",
          entityId: id,
          details: {
            processedCount: result.processedCount,
            updatedCount: result.updatedCount,
            warningCount: result.warnings.length,
          },
        });

        return c.json(result);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Falha ao consultar pagamentos da Conta Azul";

        await writeIntegrationEvent({
          integrationId: id,
          organizationId: member.organizationId,
          level: "error",
          event: "integration.conta_azul.payment_poll.failed",
          message,
          details: {
            provider: "conta_azul",
          },
        });

        return c.json({ error: message }, 400);
      }
    },
  )
  .post(
    "/:id/conta-azul/poll-payables",
    ...requireLabProtected,
    requireOrgType("LAB"),
    requireRole(["admin", "owner"]),
    zValidator("json", ContaAzulPollBodySchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = c.req.param("id");
      const input = c.req.valid("json");

      await assertActiveContaAzulIntegration({
        organizationId: member.organizationId,
        integrationId: id,
      });

      try {
        const result = await pollContaAzulPayableStatus({
          integrationId: id,
          organizationId: member.organizationId,
          env: c.env,
          limit: input.limit,
        });

        await writeOrganizationIntegrationEvent({
          organizationId: member.organizationId,
          actorUserId: session.user.id,
          actorMemberId: member.id,
          action: "integration.conta_azul.payable_poll",
          entityId: id,
          details: {
            processedCount: result.processedCount,
            updatedCount: result.updatedCount,
            warningCount: result.warnings.length,
          },
        });

        return c.json(result);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Falha ao consultar contas a pagar da Conta Azul";

        await writeIntegrationEvent({
          integrationId: id,
          organizationId: member.organizationId,
          level: "error",
          event: "integration.conta_azul.payable_poll.failed",
          message,
          details: {
            provider: "conta_azul",
          },
        });

        return c.json({ error: message }, 400);
      }
    },
  )
  .post(
    "/:id/conta-azul/poll-fiscal",
    ...requireLabProtected,
    requireOrgType("LAB"),
    requireRole(["admin", "owner"]),
    zValidator("json", ContaAzulPollBodySchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = c.req.param("id");
      const input = c.req.valid("json");

      await assertActiveContaAzulIntegration({
        organizationId: member.organizationId,
        integrationId: id,
      });

      try {
        const result = await pollContaAzulFiscalDocuments({
          integrationId: id,
          organizationId: member.organizationId,
          env: c.env,
          limit: input.limit,
        });

        await writeOrganizationIntegrationEvent({
          organizationId: member.organizationId,
          actorUserId: session.user.id,
          actorMemberId: member.id,
          action: "integration.conta_azul.fiscal_poll",
          entityId: id,
          details: {
            processedCount: result.processedCount,
            updatedCount: result.updatedCount,
            warningCount: result.warnings.length,
          },
        });

        return c.json(result);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Falha ao consultar documentos fiscais da Conta Azul";

        await writeIntegrationEvent({
          integrationId: id,
          organizationId: member.organizationId,
          level: "error",
          event: "integration.conta_azul.fiscal_poll.failed",
          message,
          details: {
            provider: "conta_azul",
          },
        });

        return c.json({ error: message }, 400);
      }
    },
  )
  .post(
    "/:id/conta-azul/link-mdfe",
    ...requireLabProtected,
    requireOrgType("LAB"),
    requireRole(["admin", "owner"]),
    zValidator("json", ContaAzulMdfeLinkBodySchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = c.req.param("id");
      const input = c.req.valid("json");

      await assertActiveContaAzulIntegration({
        organizationId: member.organizationId,
        integrationId: id,
      });

      try {
        const result = await linkContaAzulFiscalDocumentsToMdfe({
          integrationId: id,
          organizationId: member.organizationId,
          env: c.env,
          payload: {
            externalId: input.externalId,
            organizationId: member.organizationId,
            fiscalDocumentAccessKeys: input.fiscalDocumentAccessKeys,
            mdfeIdentifier: input.mdfeIdentifier,
            status: input.status ?? null,
          },
        });

        await writeOrganizationIntegrationEvent({
          organizationId: member.organizationId,
          actorUserId: session.user.id,
          actorMemberId: member.id,
          action: "integration.conta_azul.mdfe_link",
          entityId: id,
          details: {
            remoteEntityId: result.remoteEntityId,
            accessKeyCount: input.fiscalDocumentAccessKeys.length,
            status: input.status ?? null,
          },
        });

        return c.json(result);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Falha ao vincular MDF-e na Conta Azul";

        await writeIntegrationEvent({
          integrationId: id,
          organizationId: member.organizationId,
          level: "error",
          event: "integration.conta_azul.mdfe_link.failed",
          message,
          details: {
            provider: "conta_azul",
          },
        });

        return c.json({ error: message }, 400);
      }
    },
  )
  .post(
    "/:id/conta-azul/poll-protocols",
    ...requireLabProtected,
    requireOrgType("LAB"),
    requireRole(["admin", "owner"]),
    zValidator("json", ContaAzulPollBodySchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = c.req.param("id");
      const input = c.req.valid("json");

      await assertActiveContaAzulIntegration({
        organizationId: member.organizationId,
        integrationId: id,
      });

      try {
        const result = await pollContaAzulProtocols({
          integrationId: id,
          organizationId: member.organizationId,
          env: c.env,
          limit: input.limit,
        });

        await writeOrganizationIntegrationEvent({
          organizationId: member.organizationId,
          actorUserId: session.user.id,
          actorMemberId: member.id,
          action: "integration.conta_azul.protocol_poll",
          entityId: id,
          details: {
            processedCount: result.processedCount,
            updatedCount: result.updatedCount,
            warningCount: result.warnings.length,
          },
        });

        return c.json(result);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Falha ao consultar protocolos da Conta Azul";

        await writeIntegrationEvent({
          integrationId: id,
          organizationId: member.organizationId,
          level: "error",
          event: "integration.conta_azul.protocol_poll.failed",
          message,
          details: {
            provider: "conta_azul",
          },
        });

        return c.json({ error: message }, 400);
      }
    },
  )
  .post(
    "/:id/conta-azul/poll-drift",
    ...requireLabProtected,
    requireOrgType("LAB"),
    requireRole(["admin", "owner"]),
    zValidator("json", ContaAzulPollBodySchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = c.req.param("id");
      const input = c.req.valid("json");

      await assertActiveContaAzulIntegration({
        organizationId: member.organizationId,
        integrationId: id,
      });

      try {
        const result = await pollContaAzulRemoteDrift({
          integrationId: id,
          organizationId: member.organizationId,
          env: c.env,
          limit: input.limit,
        });

        await writeOrganizationIntegrationEvent({
          organizationId: member.organizationId,
          actorUserId: session.user.id,
          actorMemberId: member.id,
          action: "integration.conta_azul.drift_poll",
          entityId: id,
          details: {
            processedCount: result.processedCount,
            updatedCount: result.updatedCount,
            warningCount: result.warnings.length,
          },
        });

        return c.json(result);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Falha ao verificar drift da Conta Azul";

        await writeIntegrationEvent({
          integrationId: id,
          organizationId: member.organizationId,
          level: "error",
          event: "integration.conta_azul.drift_poll.failed",
          message,
          details: {
            provider: "conta_azul",
          },
        });

        return c.json({ error: message }, 400);
      }
    },
  )
  .post(
    "/:id/validate",
    ...requireLabProtected,
    requireOrgType("LAB"),
    requireRole(["admin", "owner"]),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = c.req.param("id");
      const record = await getIntegrationRecord(member.organizationId, id);

      if (!record) {
        return c.json({ error: "Integração não encontrada" }, 404);
      }

      try {
        if (record.integration.provider === "generic_http") {
          const secret = decryptIntegrationSecret(
            record.connection.encryptedSecret,
            record.connection.secretIv,
            c.env,
          );

          await validateGenericConnection(
            buildGenericConnectionConfig(record.connection.config),
            secret,
          );
        } else {
          await validateContaAzulConnection({
            record,
            env: c.env,
          });
        }

        await db
          .update(organizationIntegration)
          .set({
            status:
              record.integration.status === "ACTION_REQUIRED"
                ? "ACTIVE"
                : record.integration.status,
            lastValidatedAt: new Date(),
            lastValidationError: null,
            updatedBy: session.user.id,
            updatedAt: new Date(),
          })
          .where(eq(organizationIntegration.id, id));

        await writeIntegrationEvent({
          integrationId: id,
          organizationId: member.organizationId,
          level: "info",
          event: "integration.validation_succeeded",
          message: "Conexão validada com sucesso",
          details: {
            provider: record.integration.provider,
          },
        });

        await writeOrganizationIntegrationEvent({
          organizationId: member.organizationId,
          actorUserId: session.user.id,
          actorMemberId: member.id,
          action: "integration.validated",
          entityId: id,
        });

        return c.json({ success: true });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Falha ao validar conexão";

        await db
          .update(organizationIntegration)
          .set({
            lastValidationError: message,
            updatedBy: session.user.id,
            updatedAt: new Date(),
          })
          .where(eq(organizationIntegration.id, id));

        await writeIntegrationEvent({
          integrationId: id,
          organizationId: member.organizationId,
          level: "error",
          event: "integration.validation_failed",
          message,
        });

        return c.json({ error: message }, 400);
      }
    },
  )
  .post(
    "/:id/sync/preview",
    ...requireLabProtected,
    requireOrgType("LAB"),
    requireRole(["admin", "owner"]),
    zValidator("json", SyncRequestSchema),
    async (c) => {
      const member = c.get("member");
      const id = c.req.param("id");
      const input = c.req.valid("json");
      const record = await getIntegrationRecord(member.organizationId, id);

      if (!record) {
        return c.json({ error: "Integração não encontrada" }, 404);
      }

      assertProviderSupportsSyncTarget(
        record.integration.provider,
        input.target,
      );

      const preview = await previewIntegrationSync({
        record,
        target: input.target,
        limit: input.limit,
        mappings: input.mappings,
      });

      return c.json(preview);
    },
  )
  .post(
    "/:id/sync",
    ...requireLabProtected,
    requireOrgType("LAB"),
    requireRole(["admin", "owner"]),
    zValidator("json", SyncRequestSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = c.req.param("id");
      const input = c.req.valid("json");
      const record = await getIntegrationRecord(member.organizationId, id);

      if (!record) {
        return c.json({ error: "Integração não encontrada" }, 404);
      }

      assertProviderSupportsSyncTarget(
        record.integration.provider,
        input.target,
      );

      if (record.integration.status !== "ACTIVE") {
        return c.json({ error: "Integração desativada" }, 409);
      }

      const preview = await previewIntegrationSync({
        record,
        target: input.target,
        limit: input.limit,
      });

      if (preview.blocked) {
        return c.json(
          {
            error:
              preview.warnings[0]?.message ??
              "A integração ainda não está pronta para este alvo",
            blocked: true,
            warnings: preview.warnings,
            coverage: preview.coverage,
          },
          409,
        );
      }

      const activeRun = await hasActiveSyncRun({
        integrationId: id,
        organizationId: member.organizationId,
        target: input.target,
      });

      if (activeRun) {
        return c.json(
          {
            error: "Já existe uma sincronização em andamento para este alvo",
            runId: activeRun.id,
          },
          409,
        );
      }

      const runId = await createSyncRun({
        integrationId: id,
        organizationId: member.organizationId,
        trigger: "manual",
        target: input.target,
        initiatedBy: session.user.id,
        requestedLimit: input.limit,
      });

      await writeIntegrationEvent({
        integrationId: id,
        organizationId: member.organizationId,
        runId,
        level: "info",
        event: "sync.requested",
        message: "Sincronização solicitada",
        details: {
          target: input.target,
          limit: input.limit,
        },
      });

      let result;
      try {
        result = await dispatchSyncRun({
          env: c.env,
          integrationId: id,
          organizationId: member.organizationId,
          runId,
          target: input.target,
          limit: input.limit,
          trigger: "manual",
          waitUntil: (promise) => c.executionCtx.waitUntil(promise),
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Falha ao processar sincronização";
        return c.json({ error: message }, 500);
      }

      return c.json({
        success: true,
        queued: result.queued,
        runId,
        status: result.status,
        warnings: preview.warnings,
      });
    },
  )
  .post(
    "/:id/schedule",
    ...requireLabProtected,
    requireOrgType("LAB"),
    requireRole(["admin", "owner"]),
    zValidator("json", ScheduleSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = c.req.param("id");
      const input = c.req.valid("json");
      const record = await getIntegrationRecord(member.organizationId, id);

      if (!record) {
        return c.json({ error: "Integração não encontrada" }, 404);
      }

      assertProviderSupportsSyncTarget(
        record.integration.provider,
        input.target,
      );

      const nextScheduledRunAt =
        input.mode === "scheduled"
          ? buildInitialNextScheduledRunAt(input.frequency)
          : null;
      const currentSchedule = getTargetScheduleConfig(
        record.connection.config,
        input.target,
      );
      const updatedConfig = updateTargetScheduleConfig({
        config: record.connection.config,
        target: input.target,
        mode: input.mode,
        frequency:
          input.mode === "scheduled"
            ? (input.frequency ?? currentSchedule.frequency)
            : undefined,
        nextScheduledRunAt,
        lastScheduledRunAt: currentSchedule.lastScheduledRunAt,
      });

      await db
        .update(integrationConnection)
        .set({
          config: updatedConfig,
          updatedBy: session.user.id,
          updatedAt: new Date(),
        })
        .where(eq(integrationConnection.integrationId, id));

      await writeIntegrationEvent({
        integrationId: id,
        organizationId: member.organizationId,
        level: "info",
        event: "integration.schedule_updated",
        message: "Agendamento do alvo atualizado",
        details: {
          target: input.target,
          mode: input.mode,
          frequency:
            input.mode === "scheduled"
              ? updatedConfig.schedules[input.target].frequency
              : null,
          nextScheduledRunAt,
        },
      });

      await writeOrganizationIntegrationEvent({
        organizationId: member.organizationId,
        actorUserId: session.user.id,
        actorMemberId: member.id,
        action: "integration.schedule.updated",
        entityId: id,
        details: {
          target: input.target,
          mode: input.mode,
          frequency:
            input.mode === "scheduled"
              ? updatedConfig.schedules[input.target].frequency
              : null,
        },
      });

      return c.json(await buildListPayload(member.organizationId));
    },
  )
  .post(
    "/:id/toggle",
    ...requireLabProtected,
    requireOrgType("LAB"),
    requireRole(["admin", "owner"]),
    zValidator("json", ToggleSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = c.req.param("id");
      const input = c.req.valid("json");
      const record = await getIntegrationRecord(member.organizationId, id);

      if (!record) {
        return c.json({ error: "Integração não encontrada" }, 404);
      }

      if (input.enabled && record.integration.status === "ACTION_REQUIRED") {
        return c.json(
          { error: "Reconecte a integração antes de ativá-la" },
          409,
        );
      }

      await db
        .update(organizationIntegration)
        .set({
          status: input.enabled ? "ACTIVE" : "DISABLED",
          disabledAt: input.enabled ? null : new Date(),
          updatedBy: session.user.id,
          updatedAt: new Date(),
        })
        .where(eq(organizationIntegration.id, id));

      await writeIntegrationEvent({
        integrationId: id,
        organizationId: member.organizationId,
        level: "info",
        event: input.enabled ? "integration.enabled" : "integration.disabled",
        message: input.enabled ? "Integração ativada" : "Integração desativada",
      });

      return c.json(await buildListPayload(member.organizationId));
    },
  )
  .get(
    "/:id/overview",
    ...requireLabProtected,
    requireOrgType("LAB"),
    requireRole(["admin", "owner"]),
    async (c) => {
      const member = c.get("member");
      const id = c.req.param("id");
      const record = await getIntegrationRecord(member.organizationId, id);

      if (!record) {
        return c.json({ error: "Integração não encontrada" }, 404);
      }

      return c.json({
        data: await buildIntegrationOverview(record),
      });
    },
  )
  .get(
    "/:id/runs",
    ...requireLabProtected,
    requireOrgType("LAB"),
    requireRole(["admin", "owner"]),
    async (c) => {
      const member = c.get("member");
      const id = c.req.param("id");
      const record = await getIntegrationRecord(member.organizationId, id);

      if (!record) {
        return c.json({ error: "Integração não encontrada" }, 404);
      }

      const runs = await db.query.integrationSyncRun.findMany({
        where: and(
          eq(integrationSyncRun.integrationId, id),
          eq(integrationSyncRun.organizationId, member.organizationId),
        ),
        orderBy: [desc(integrationSyncRun.createdAt)],
        limit: 20,
      });

      return c.json({ data: runs });
    },
  )
  .get(
    "/:id/runs/:runId/items",
    ...requireLabProtected,
    requireOrgType("LAB"),
    requireRole(["admin", "owner"]),
    zValidator("query", SyncItemsQuerySchema),
    async (c) => {
      const member = c.get("member");
      const id = c.req.param("id");
      const runId = c.req.param("runId");
      const input = c.req.valid("query");
      const record = await getIntegrationRecord(member.organizationId, id);

      if (!record) {
        return c.json({ error: "Integração não encontrada" }, 404);
      }

      const run = await db.query.integrationSyncRun.findFirst({
        where: and(
          eq(integrationSyncRun.id, runId),
          eq(integrationSyncRun.integrationId, id),
          eq(integrationSyncRun.organizationId, member.organizationId),
        ),
      });

      if (!run) {
        return c.json({ error: "Execução não encontrada" }, 404);
      }

      const items = await db.query.integrationSyncItem.findMany({
        where: and(
          eq(integrationSyncItem.runId, runId),
          eq(integrationSyncItem.integrationId, id),
          eq(integrationSyncItem.organizationId, member.organizationId),
        ),
        orderBy: [desc(integrationSyncItem.updatedAt)],
        limit: input.limit,
      });
      const statusCounts = items.reduce<Record<string, number>>((acc, item) => {
        acc[item.status] = (acc[item.status] ?? 0) + 1;
        return acc;
      }, {});

      return c.json({
        runId,
        target: run.target,
        data: items,
        summary: {
          returnedCount: items.length,
          statusCounts,
        },
      });
    },
  )
  .post(
    "/:id/runs/:runId/retry",
    ...requireLabProtected,
    requireOrgType("LAB"),
    requireRole(["admin", "owner"]),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const id = c.req.param("id");
      const runId = c.req.param("runId");
      const record = await getIntegrationRecord(member.organizationId, id);

      if (!record) {
        return c.json({ error: "Integração não encontrada" }, 404);
      }

      const originalRun = await db.query.integrationSyncRun.findFirst({
        where: and(
          eq(integrationSyncRun.id, runId),
          eq(integrationSyncRun.integrationId, id),
          eq(integrationSyncRun.organizationId, member.organizationId),
        ),
      });

      if (!originalRun) {
        return c.json({ error: "Execução não encontrada" }, 404);
      }

      assertProviderSupportsSyncTarget(
        record.integration.provider,
        originalRun.target,
      );

      if (
        originalRun.status === "PENDING" ||
        originalRun.status === "RUNNING"
      ) {
        return c.json(
          {
            error: "Não é possível reprocessar uma execução ainda em andamento",
          },
          409,
        );
      }

      const activeRun = await hasActiveSyncRun({
        integrationId: id,
        organizationId: member.organizationId,
        target: originalRun.target,
      });

      if (activeRun) {
        return c.json(
          {
            error: "Já existe uma sincronização em andamento para este alvo",
            runId: activeRun.id,
          },
          409,
        );
      }

      const requestedLimit = getRequestedLimitFromRun(originalRun);
      const preview = await previewIntegrationSync({
        record,
        target: originalRun.target,
        limit: requestedLimit,
      });

      const retryRunId = await createSyncRun({
        integrationId: id,
        organizationId: member.organizationId,
        trigger: "retry",
        target: originalRun.target,
        initiatedBy: session.user.id,
        requestedLimit,
        retryOfRunId: originalRun.id,
      });

      if (preview.blocked) {
        const message =
          preview.warnings[0]?.message ??
          "A integração ainda não está pronta para este alvo";

        await failSyncRunAsBlocked({
          integrationId: id,
          organizationId: member.organizationId,
          runId: retryRunId,
          target: originalRun.target,
          requestedLimit,
          message,
        });

        return c.json(
          {
            error: message,
            blocked: true,
            warnings: preview.warnings,
            runId: retryRunId,
          },
          409,
        );
      }

      await writeIntegrationEvent({
        integrationId: id,
        organizationId: member.organizationId,
        runId: retryRunId,
        level: "info",
        event: "sync.retry_requested",
        message: "Reprocessamento solicitado",
        details: {
          target: originalRun.target,
          requestedLimit,
          retryOfRunId: originalRun.id,
        },
      });

      let result;
      try {
        result = await dispatchSyncRun({
          env: c.env,
          integrationId: id,
          organizationId: member.organizationId,
          runId: retryRunId,
          target: originalRun.target,
          limit: requestedLimit,
          trigger: "retry",
          waitUntil: (promise) => c.executionCtx.waitUntil(promise),
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Falha ao processar sincronização";
        return c.json({ error: message }, 500);
      }

      return c.json({
        success: true,
        queued: result.queued,
        runId: retryRunId,
        status: result.status,
      });
    },
  )
  .get(
    "/:id/events",
    ...requireLabProtected,
    requireOrgType("LAB"),
    requireRole(["admin", "owner"]),
    async (c) => {
      const member = c.get("member");
      const id = c.req.param("id");
      const record = await getIntegrationRecord(member.organizationId, id);

      if (!record) {
        return c.json({ error: "Integração não encontrada" }, 404);
      }

      const events = await db.query.integrationEventLog.findMany({
        where: and(
          eq(integrationEventLog.integrationId, id),
          eq(integrationEventLog.organizationId, member.organizationId),
        ),
        orderBy: [desc(integrationEventLog.createdAt)],
        limit: 30,
      });

      return c.json({ data: events });
    },
  )
  // Phase 2 slice 3: remote drift detection queue.
  .get("/drift", ...requireLabProtected, requireOrgType("LAB"), async (c) => {
    const member = c.get("member");
    const target = c.req.query("target");
    const rows = await buildIntegrationDriftQueue({
      organizationId: member.organizationId,
      target: target && isDriftTarget(target) ? target : undefined,
    });
    return c.json({ data: rows });
  })
  .post(
    "/drift/:linkId/acknowledge",
    ...requireLabProtected,
    requireOrgType("LAB"),
    requireRole(["admin", "owner"]),
    zValidator(
      "json",
      z.object({
        reason: z
          .string()
          .min(1)
          .max(500)
          .transform((value) => value.trim())
          .refine((value) => value.length > 0, "Motivo é obrigatório"),
      }),
    ),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const linkId = c.req.param("linkId");
      const { reason } = c.req.valid("json");
      const result = await acknowledgeIntegrationDrift({
        organizationId: member.organizationId,
        linkId,
        actorUserId: session.user.id,
        reason,
      });
      if (!result.ok) {
        return c.json({ error: "Motivo é obrigatório" }, 400);
      }
      return c.json({ data: { ok: true } });
    },
  );
