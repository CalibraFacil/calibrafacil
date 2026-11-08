import { errorMessage } from "@calibra-facil/shared/telemetry";
import { isDatabaseError } from "../../../lib/db-errors";
import { reportServerError } from "../../../lib/observability";
import { createRouter } from "../../../server/router";
import {
  integrationEndpoints,
  type ContaAzulCatalogKey,
} from "@calibra-facil/contracts";
import { mount } from "../../../lib/endpoint-mount";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, desc, eq, gt, ne, sql } from "drizzle-orm";
import { INTEGRATION_MACHINE } from "@calibra-facil/schemas/machines";
import { enqueueBackgroundJob } from "../../../lib/background-jobs";
import {
  conflict,
  DomainError,
  invalid,
  notFound,
  unprocessable,
} from "../../../lib/domain-errors";
import {
  requireLabContaAzulIntegration,
  requireLabIntegration,
} from "../integrations/integration-access";
import { withOrg } from "../../../lib/org-context";
import { orgDb } from "../../../lib/org-db";
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
} from "../integrations/integration-drift";
import { contaAzulPollEvents } from "../integrations/constants";
import { getContaAzulPollDefinition } from "../integrations/conta-azul-due";

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
  dispatchContaAzulSync,
  encryptIntegrationSecret,
  failIntegrationSyncRun,
  failSyncRunAsBlocked,
  getContaAzulScheduleState,
  getIntegrationRecord,
  getRequestedLimitFromRun,
  hasActiveSyncRun,
  getTargetScheduleConfig,
  markContaAzulReconnectRequired,
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
} from "../integrations";
import {
  buildContaAzulAuthorizationUrl,
  buildContaAzulRefreshFailurePolicy,
  checkContaAzulAppCredentials,
  ContaAzulOAuthError,
  exchangeContaAzulAuthorizationCode,
  getContaAzulStateSecret,
  getServerContaAzulCredentials,
  parseContaAzulTokenBundle,
  refreshContaAzulAccessToken,
  resolveContaAzulRedirectUri,
  serializeContaAzulTokenBundle,
  verifyContaAzulOAuthState,
} from "../integrations/conta-azul-oauth";
import {
  ContaAzulAppMissingError,
  deleteContaAzulAppCredentials,
  getContaAzulAppSummary,
  requireContaAzulOAuthConfig,
  resolveContaAzulOAuthConfig,
  saveContaAzulAppCredentials,
} from "../integrations/conta-azul-app";
import {
  assertActiveContaAzulIntegration,
  assertProviderSupportsSyncTarget,
  buildContaAzulOAuthErrorUrl,
  buildContaAzulOAuthReturnUrl,
  type IntegrationsBindings,
} from "../integrations/conta-azul-route";
import {
  type AuthVariables,
  requireLabProtected,
  requireOrgType,
  requireRole,
} from "../../../middleware/permission";
import { requestActor } from "../../../middleware/request-actor";

const OAuthCallbackQuerySchema = z.object({
  code: z.string().trim().min(1),
  state: z.string().trim().min(1),
});

/** The Client ID OAuth uses for a laboratory: its own, else the server's. */
function effectiveContaAzulClientId(
  app: Awaited<ReturnType<typeof getContaAzulAppSummary>>,
  env: IntegrationsBindings,
) {
  return app.source === "organization"
    ? app.clientId
    : (getServerContaAzulCredentials(env)?.clientId ?? null);
}

/**
 * Tokens belong to the application that issued them, so a connection made with
 * another Client ID cannot be refreshed: say so now rather than when the next
 * sync fails. A new secret for the same Client ID keeps the connection.
 */
async function requireContaAzulReconnectAfterAppChange(params: {
  organizationId: string;
  clientIdBefore: string | null;
  clientIdAfter: string | null;
}) {
  if (params.clientIdBefore === params.clientIdAfter) return;

  const connected = await orgDb(params.organizationId).transaction((o) =>
    o
      .select({ id: organizationIntegration.id })
      .from(organizationIntegration)
      .where(
        and(
          eq(organizationIntegration.organizationId, params.organizationId),
          eq(organizationIntegration.provider, "conta_azul"),
          ne(organizationIntegration.status, "DISABLED"),
        ),
      ),
  );

  await Promise.all(
    connected.map((integration) =>
      orgDb(params.organizationId).transaction((o) =>
        markContaAzulReconnectRequired(
          {
            integrationId: integration.id,
            organizationId: params.organizationId,
            message:
              "O aplicativo Conta Azul mudou. Reconecte a conta para continuar sincronizando.",
            details: { reason: "app_changed" },
          },
          o,
        ),
      ),
    ),
  );
}

async function resolveContaAzulOAuthCallbackContext(state: {
  organizationId: string;
  userId: string;
  sessionId: string;
}) {
  // The signed OAuth state names the laboratory, so the lookup runs in it.
  const [record] = await orgDb(state.organizationId).transaction((o) =>
    o
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
      .limit(1),
  );

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
  return orgDb(organizationId).transaction(async (o) => {
    const integrations = await listOrganizationIntegrations(organizationId, o);

    const data = await Promise.all(
      integrations.map(async (integration) => {
        const recentRuns = await o
          .select()
          .from(integrationSyncRun)
          .where(
            and(
              eq(integrationSyncRun.integrationId, integration.id),
              eq(integrationSyncRun.organizationId, organizationId),
            ),
          )
          .orderBy(desc(integrationSyncRun.createdAt))
          .limit(5);

        const recentEvents = await o
          .select()
          .from(integrationEventLog)
          .where(
            and(
              eq(integrationEventLog.integrationId, integration.id),
              eq(integrationEventLog.organizationId, organizationId),
            ),
          )
          .orderBy(desc(integrationEventLog.createdAt))
          .limit(5);
        const overview = integration.connection
          ? await buildIntegrationOverview(
              {
                integration,
                connection: integration.connection,
              },
              o,
            )
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
  });
}

export async function dispatchSyncRun(params: {
  env: IntegrationsBindings;
  integrationId: string;
  organizationId: string;
  runId: string;
  target: IntegrationSyncTarget;
  limit: number;
  trigger: "manual" | "event" | "scheduled" | "retry";
}) {
  const record = await orgDb(params.organizationId).transaction((o) =>
    getIntegrationRecord(params.organizationId, params.integrationId, o),
  );

  if (record) {
    assertProviderSupportsSyncTarget(
      record.integration.provider,
      params.target,
    );
  }

  if (record?.integration.provider === "conta_azul") {
    try {
      await dispatchContaAzulSync({
        type: "CONTA_AZUL_SYNC",
        integrationId: params.integrationId,
        organizationId: params.organizationId,
        runId: params.runId,
        target: params.target,
        limit: params.limit,
        trigger: params.trigger,
      });
    } catch (error) {
      const message = errorMessage(error);

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
    const message = errorMessage(error);

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

  return withOrg(
    params.organizationId,
    { userId: params.actorUserId, ipAddress: null },
    async ({ o, tx }) => {
      // Serialize concurrent OAuth callbacks for the same org+provider so two
      // first-time connect requests cannot both pass findFirst and insert
      // duplicate organization_integration rows. Lock is transaction-scoped and
      // released on commit/rollback.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`integration:conta_azul:${params.organizationId}`}, 0))`,
      );

      const [existingRow] = await o
        .select({
          integration: organizationIntegration,
          connection: integrationConnection,
        })
        .from(organizationIntegration)
        .leftJoin(
          integrationConnection,
          eq(integrationConnection.integrationId, organizationIntegration.id),
        )
        .where(
          and(
            eq(organizationIntegration.organizationId, params.organizationId),
            eq(organizationIntegration.type, "financial_erp"),
            eq(organizationIntegration.provider, "conta_azul"),
          ),
        )
        .limit(1);
      const existing = existingRow
        ? { ...existingRow.integration, connection: existingRow.connection }
        : undefined;
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
          await o
            .delete(integrationObjectLink)
            .where(eq(integrationObjectLink.integrationId, integrationId));

          await o
            .delete(integrationSyncCursor)
            .where(eq(integrationSyncCursor.integrationId, integrationId));
        }

        await o
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
        await o.insert(organizationIntegration).values({
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
        await o
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
        await o.insert(integrationConnection).values({
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
    },
  );
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

const adminOnly = [
  ...requireLabProtected,
  requireOrgType("LAB"),
  requireRole(["admin", "owner"]),
];

/** What the catalog dropdowns show when Conta Azul fails without saying why. */
const CATALOG_FAILURE_MESSAGE: Record<ContaAzulCatalogKey, string> = {
  accounts: "Falha ao carregar contas financeiras",
  categories: "Falha ao carregar categorias",
  "cost-centers": "Falha ao carregar centros de custo",
  balances: "Falha ao carregar catálogo da Conta Azul",
  "dre-categories": "Falha ao carregar catálogo da Conta Azul",
  "product-categories": "Falha ao carregar catálogo da Conta Azul",
  "product-cest": "Falha ao carregar catálogo da Conta Azul",
  "product-ecommerce-brands": "Falha ao carregar catálogo da Conta Azul",
  "product-ecommerce-categories": "Falha ao carregar catálogo da Conta Azul",
  "product-ncm": "Falha ao carregar catálogo da Conta Azul",
  products: "Falha ao carregar catálogo da Conta Azul",
  "product-units": "Falha ao carregar catálogo da Conta Azul",
  sellers: "Falha ao carregar catálogo da Conta Azul",
  services: "Falha ao carregar catálogo da Conta Azul",
  transfers: "Falha ao carregar catálogo da Conta Azul",
};

export const integrationsRouter = createRouter<{
  Variables: AuthVariables;
  Bindings: IntegrationsBindings;
}>();

/**
 * The 500 for a sync run that could not be queued. The cause (a failed insert
 * into the job queue carries SQL) goes to the redacted reporter; the body
 * carries a fixed pt-BR message.
 */
function dispatchFailed(error: unknown, organizationId: string) {
  reportServerError(error, {
    surface: "api",
    tags: { step: "integration-sync-dispatch", organizationId },
  });
  return new DomainError({
    code: "integration_sync_dispatch_failed",
    status: 500,
    message:
      "Não foi possível iniciar a sincronização. Tente novamente em instantes.",
  });
}

mount(
  integrationsRouter,
  "/api/integrations",
  integrationEndpoints.list,
  adminOnly,
  async (c) => {
    const member = c.get("member");
    return await buildListPayload(member.organizationId);
  },
);

mount(
  integrationsRouter,
  "/api/integrations",
  integrationEndpoints.getContaAzulApp,
  adminOnly,
  async (c) => {
    const member = c.get("member");
    return await getContaAzulAppSummary({
      organizationId: member.organizationId,
      env: c.env,
    });
  },
);

mount(
  integrationsRouter,
  "/api/integrations",
  integrationEndpoints.saveContaAzulApp,
  adminOnly,
  async (c, { body }) => {
    const member = c.get("member");
    const session = c.get("session");
    const credentials = body;

    // Conta Azul answers a made-up code differently for a wrong pair, so a
    // typo is caught here instead of after a round trip through its login.
    const check = await checkContaAzulAppCredentials({
      credentials,
      redirectUri: resolveContaAzulRedirectUri(c.env),
    });
    if (check === "rejected") {
      throw unprocessable(
        "conta_azul_app_rejected",
        "O Conta Azul recusou este Client ID e Client Secret. Copie os dois de novo do seu aplicativo no Portal do Desenvolvedor.",
        { legacyBody: { check } },
      );
    }

    const before = await getContaAzulAppSummary({
      organizationId: member.organizationId,
      env: c.env,
    });
    await orgDb(member.organizationId).transaction((o) =>
      saveContaAzulAppCredentials(
        {
          organizationId: member.organizationId,
          actorUserId: session.user.id,
          credentials,
          env: c.env,
        },
        o,
      ),
    );
    await requireContaAzulReconnectAfterAppChange({
      organizationId: member.organizationId,
      clientIdBefore: effectiveContaAzulClientId(before, c.env),
      clientIdAfter: credentials.clientId,
    });
    await orgDb(member.organizationId).transaction((o) =>
      writeOrganizationIntegrationEvent(
        {
          organizationId: member.organizationId,
          actorUserId: session.user.id,
          actorMemberId: member.id,
          action: "integration.conta_azul.app_saved",
          entityId: "conta_azul",
          details: {
            provider: "conta_azul",
            clientId: credentials.clientId,
            check,
          },
        },
        o,
      ),
    );

    return {
      app: await getContaAzulAppSummary({
        organizationId: member.organizationId,
        env: c.env,
      }),
      check,
    };
  },
);

mount(
  integrationsRouter,
  "/api/integrations",
  integrationEndpoints.removeContaAzulApp,
  adminOnly,
  async (c) => {
    const member = c.get("member");
    const session = c.get("session");
    const before = await getContaAzulAppSummary({
      organizationId: member.organizationId,
      env: c.env,
    });
    const removed = await orgDb(member.organizationId).transaction((o) =>
      deleteContaAzulAppCredentials(
        {
          organizationId: member.organizationId,
        },
        o,
      ),
    );

    if (removed) {
      await requireContaAzulReconnectAfterAppChange({
        organizationId: member.organizationId,
        clientIdBefore: effectiveContaAzulClientId(before, c.env),
        clientIdAfter: getServerContaAzulCredentials(c.env)?.clientId ?? null,
      });
      await orgDb(member.organizationId).transaction((o) =>
        writeOrganizationIntegrationEvent(
          {
            organizationId: member.organizationId,
            actorUserId: session.user.id,
            actorMemberId: member.id,
            action: "integration.conta_azul.app_removed",
            entityId: "conta_azul",
            details: { provider: "conta_azul" },
          },
          o,
        ),
      );
    }

    return await getContaAzulAppSummary({
      organizationId: member.organizationId,
      env: c.env,
    });
  },
);

mount(
  integrationsRouter,
  "/api/integrations",
  integrationEndpoints.startContaAzulOAuth,
  adminOnly,
  async (c, { body }) => {
    const member = c.get("member");
    const session = c.get("session");
    const input = body;
    let config: Awaited<ReturnType<typeof requireContaAzulOAuthConfig>>;
    let authorization: Awaited<
      ReturnType<typeof buildContaAzulAuthorizationUrl>
    >;

    try {
      config = await requireContaAzulOAuthConfig({
        organizationId: member.organizationId,
        env: c.env,
      });
      authorization = await buildContaAzulAuthorizationUrl({
        config,
        organizationId: member.organizationId,
        userId: session.user.id,
        sessionId: session.session.id,
        returnTo: input.returnTo,
      });
    } catch (error) {
      if (error instanceof ContaAzulAppMissingError) {
        throw conflict("conta_azul_app_missing", error.message);
      }
      if (isDatabaseError(error)) throw error;
      throw new DomainError({
        code: "conta_azul_oauth_unavailable",
        status: 503,
        message: errorMessage(error),
      });
    }

    await orgDb(member.organizationId).transaction((o) =>
      writeOrganizationIntegrationEvent(
        {
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
        },
        o,
      ),
    );

    return {
      authorizationUrl: authorization.url,
      expiresInSeconds: 600,
    };
  },
);

mount(
  integrationsRouter,
  "/api/integrations",
  integrationEndpoints.create,
  adminOnly,
  async (c, { body }) => {
    const member = c.get("member");
    const session = c.get("session");
    const input = body;
    const config = buildGenericConnectionConfig(input);
    const mappingIssues = validateIntegrationMappings(config.mappings);

    if (mappingIssues.length > 0) {
      throw invalid(
        "integration_mappings_invalid",
        mappingIssues.map((issue) => issue.message).join(" "),
      );
    }
    const encrypted = encryptIntegrationSecret(input.authToken, c.env);
    const integrationId = crypto.randomUUID();
    const connectionId = crypto.randomUUID();

    // The integration, its connection and the events that record them commit
    // together.
    await withOrg(member.organizationId, requestActor(c), async ({ o }) => {
      await o.insert(organizationIntegration).values({
        id: integrationId,
        organizationId: member.organizationId,
        type: "financial_erp",
        provider: "generic_http",
        name: input.name,
        status: "ACTIVE",
        createdBy: session.user.id,
        updatedBy: session.user.id,
      });

      await o.insert(integrationConnection).values({
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

      await writeIntegrationEvent(
        {
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
        },
        o,
      );

      await writeOrganizationIntegrationEvent(
        {
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
        },
        o,
      );
    });

    return await buildListPayload(member.organizationId);
  },
);

mount(
  integrationsRouter,
  "/api/integrations",
  integrationEndpoints.update,
  adminOnly,
  async (c, { params, body }) => {
    const member = c.get("member");
    const session = c.get("session");
    const id = params.id;
    const input = body;
    const record = await requireLabIntegration(member.organizationId, id);

    if (record.integration.provider !== "generic_http") {
      throw invalid(
        "integration_provider_mismatch",
        "Use as rotas nativas da Conta Azul para esta integração",
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
      throw invalid(
        "integration_mappings_invalid",
        mappingIssues.map((issue) => issue.message).join(" "),
      );
    }

    await withOrg(member.organizationId, requestActor(c), async ({ o }) => {
      await o
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

      await o
        .update(integrationConnection)
        .set(connectionUpdate)
        .where(eq(integrationConnection.integrationId, id));

      await writeIntegrationEvent(
        {
          integrationId: id,
          organizationId: member.organizationId,
          level: "info",
          event: "integration.updated",
          message: "Integração atualizada",
        },
        o,
      );

      await writeOrganizationIntegrationEvent(
        {
          organizationId: member.organizationId,
          actorUserId: session.user.id,
          actorMemberId: member.id,
          action: "integration.updated",
          entityId: id,
        },
        o,
      );
    });

    return await buildListPayload(member.organizationId);
  },
);

mount(
  integrationsRouter,
  "/api/integrations",
  integrationEndpoints.getContaAzulSchedule,
  adminOnly,
  async (c, { params }) => {
    const member = c.get("member");
    const id = params.id;

    await assertActiveContaAzulIntegration({
      organizationId: member.organizationId,
      integrationId: id,
    });

    return await orgDb(member.organizationId).transaction((o) =>
      getContaAzulScheduleState(
        {
          integrationId: id,
          organizationId: member.organizationId,
        },
        o,
      ),
    );
  },
);

mount(
  integrationsRouter,
  "/api/integrations",
  integrationEndpoints.refreshContaAzul,
  adminOnly,
  async (c, { params }) => {
    const member = c.get("member");
    const session = c.get("session");
    const id = params.id;
    const record = await requireLabContaAzulIntegration(
      member.organizationId,
      id,
    );

    try {
      const tokenBundle = decryptContaAzulTokenBundle({
        encryptedSecret: record.connection.encryptedSecret,
        secretIv: record.connection.secretIv,
        env: c.env,
      });
      const refreshed = await refreshContaAzulAccessToken(
        await requireContaAzulOAuthConfig({
          organizationId: member.organizationId,
          env: c.env,
        }),
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

      await withOrg(member.organizationId, requestActor(c), async ({ o }) => {
        await o
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

        await o
          .update(organizationIntegration)
          .set({
            // `recover` (INTEGRATION_MACHINE): an integration that needed
            // the lab is active again; any other status is kept.
            status: INTEGRATION_MACHINE.canTransition(
              record.integration.status,
              "recover",
            )
              ? INTEGRATION_MACHINE.requireTargetOf(
                  record.integration.status,
                  "recover",
                )
              : record.integration.status,
            lastValidationError: null,
            updatedBy: session.user.id,
            updatedAt: new Date(),
          })
          .where(eq(organizationIntegration.id, id));

        await writeIntegrationEvent(
          {
            integrationId: id,
            organizationId: member.organizationId,
            level: "info",
            event: "integration.conta_azul.token_refreshed",
            message: "Token OAuth da Conta Azul renovado",
            details: {
              provider: "conta_azul",
              accessTokenExpiresAt: refreshed.expiresAt,
            },
          },
          o,
        );
      });

      return {
        success: true,
        accessTokenExpiresAt: refreshed.expiresAt,
      };
    } catch (error) {
      const failure = buildContaAzulRefreshFailurePolicy(error);

      await withOrg(member.organizationId, requestActor(c), async ({ o }) => {
        await o
          .update(organizationIntegration)
          .set({
            status: failure.status,
            lastValidationError: failure.message,
            updatedBy: session.user.id,
            updatedAt: new Date(),
          })
          .where(eq(organizationIntegration.id, id));

        await writeIntegrationEvent(
          {
            integrationId: id,
            organizationId: member.organizationId,
            level: "error",
            event: "integration.conta_azul.refresh_failed",
            message: failure.message,
            details: {
              provider: "conta_azul",
              reason: failure.reason,
            },
          },
          o,
        );
      });

      throw invalid("integration_request_failed", failure.message);
    }
  },
);

mount(
  integrationsRouter,
  "/api/integrations",
  integrationEndpoints.disconnectContaAzul,
  adminOnly,
  async (c, { params }) => {
    const member = c.get("member");
    const session = c.get("session");
    const id = params.id;
    await requireLabContaAzulIntegration(member.organizationId, id);

    await withOrg(member.organizationId, requestActor(c), async ({ o }) => {
      // Clear remote-link state so a fresh reconnect cannot reuse stale
      // links that belong to the prior Conta Azul account.
      await o
        .delete(integrationObjectLink)
        .where(eq(integrationObjectLink.integrationId, id));

      await o
        .delete(integrationSyncCursor)
        .where(eq(integrationSyncCursor.integrationId, id));

      await o
        .delete(integrationConnection)
        .where(eq(integrationConnection.integrationId, id));

      await o
        .update(organizationIntegration)
        .set({
          status: "DISABLED",
          disabledAt: new Date(),
          lastValidationError: null,
          updatedBy: session.user.id,
          updatedAt: new Date(),
        })
        .where(eq(organizationIntegration.id, id));

      await writeIntegrationEvent(
        {
          integrationId: id,
          organizationId: member.organizationId,
          level: "info",
          event: "integration.conta_azul.disconnected",
          message: "Conta Azul desconectada",
          details: {
            provider: "conta_azul",
          },
        },
        o,
      );

      await writeOrganizationIntegrationEvent(
        {
          organizationId: member.organizationId,
          actorUserId: session.user.id,
          actorMemberId: member.id,
          action: "integration.conta_azul.disconnected",
          entityId: id,
          details: {
            provider: "conta_azul",
          },
        },
        o,
      );
    });

    return { success: true };
  },
);

mount(
  integrationsRouter,
  "/api/integrations",
  integrationEndpoints.listContaAzulCatalog,
  adminOnly,
  async (c, { params }) => {
    const member = c.get("member");
    const { id, catalog } = params;

    await assertActiveContaAzulIntegration({
      organizationId: member.organizationId,
      integrationId: id,
    });

    try {
      return await listContaAzulCatalog({
        integrationId: id,
        organizationId: member.organizationId,
        env: c.env,
        catalog,
      });
    } catch (error) {
      if (isDatabaseError(error)) throw error;
      throw invalid("integration_request_failed", errorMessage(error));
    }
  },
);

mount(
  integrationsRouter,
  "/api/integrations",
  integrationEndpoints.updateContaAzulConfig,
  adminOnly,
  async (c, { params, body }) => {
    const member = c.get("member");
    const session = c.get("session");
    const id = params.id;
    const input = body;
    const record = await requireLabContaAzulIntegration(
      member.organizationId,
      id,
    );

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

    await withOrg(member.organizationId, requestActor(c), async ({ o }) => {
      await o
        .update(integrationConnection)
        .set({
          config: nextConfig,
          updatedBy: session.user.id,
          updatedAt: new Date(),
        })
        .where(eq(integrationConnection.integrationId, id));

      await writeIntegrationEvent(
        {
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
        },
        o,
      );

      await writeOrganizationIntegrationEvent(
        {
          organizationId: member.organizationId,
          actorUserId: session.user.id,
          actorMemberId: member.id,
          action: "integration.conta_azul.config_updated",
          entityId: id,
        },
        o,
      );
    });

    return await buildListPayload(member.organizationId);
  },
);

/**
 * A manual run of one Conta Azul poll (billing, payables, fiscal, protocols,
 * drift): the integration must exist and be active, the run is an audited
 * action of the member, and a failure writes the poll's `.failed` event of the
 * integration before it answers. Event names come from `contaAzulPollEvents`,
 * the same ones the scheduled runs write.
 */
async function runContaAzulPoll<
  R extends {
    processedCount: number;
    updatedCount: number;
    warnings: unknown[];
  },
>(params: {
  kind: Parameters<typeof contaAzulPollEvents>[0];
  member: { id: string; organizationId: string };
  actorUserId: string;
  integrationId: string;
  poll: () => Promise<R>;
}): Promise<R> {
  const { member, integrationId } = params;
  const events = contaAzulPollEvents(params.kind);

  await assertActiveContaAzulIntegration({
    organizationId: member.organizationId,
    integrationId,
  });

  try {
    const result = await params.poll();

    await orgDb(member.organizationId).transaction((o) =>
      writeOrganizationIntegrationEvent(
        {
          organizationId: member.organizationId,
          actorUserId: params.actorUserId,
          actorMemberId: member.id,
          action: events.audit,
          entityId: integrationId,
          details: {
            processedCount: result.processedCount,
            updatedCount: result.updatedCount,
            warningCount: result.warnings.length,
          },
        },
        o,
      ),
    );

    return result;
  } catch (error) {
    const message = errorMessage(error);

    await orgDb(member.organizationId).transaction((o) =>
      writeIntegrationEvent(
        {
          integrationId,
          organizationId: member.organizationId,
          level: "error",
          event: events.failed,
          message,
          details: { provider: "conta_azul" },
        },
        o,
      ),
    );

    if (error instanceof DomainError || isDatabaseError(error)) throw error;
    throw invalid("integration_request_failed", message);
  }
}

mount(
  integrationsRouter,
  "/api/integrations",
  integrationEndpoints.pollContaAzul,
  adminOnly,
  async (c, { params, body }) => {
    const member = c.get("member");
    return runContaAzulPoll({
      kind: "paymentStatusPolling",
      member,
      actorUserId: c.get("session").user.id,
      integrationId: params.id,
      poll: () =>
        pollContaAzulBillingStatus({
          integrationId: params.id,
          organizationId: member.organizationId,
          env: c.env,
          limit: body.limit,
        }),
    });
  },
);

mount(
  integrationsRouter,
  "/api/integrations",
  integrationEndpoints.pollContaAzulPayables,
  adminOnly,
  async (c, { params, body }) => {
    const member = c.get("member");
    return runContaAzulPoll({
      kind: "payables",
      member,
      actorUserId: c.get("session").user.id,
      integrationId: params.id,
      poll: () =>
        pollContaAzulPayableStatus({
          integrationId: params.id,
          organizationId: member.organizationId,
          env: c.env,
          limit: body.limit,
        }),
    });
  },
);

mount(
  integrationsRouter,
  "/api/integrations",
  integrationEndpoints.pollContaAzulFiscal,
  adminOnly,
  async (c, { params, body }) => {
    const member = c.get("member");
    return runContaAzulPoll({
      kind: "fiscalDocuments",
      member,
      actorUserId: c.get("session").user.id,
      integrationId: params.id,
      poll: () =>
        pollContaAzulFiscalDocuments({
          integrationId: params.id,
          organizationId: member.organizationId,
          env: c.env,
          limit: body.limit,
        }),
    });
  },
);

mount(
  integrationsRouter,
  "/api/integrations",
  integrationEndpoints.linkContaAzulInvoicesToMdfe,
  adminOnly,
  async (c, { params, body }) => {
    const member = c.get("member");
    const session = c.get("session");
    const id = params.id;
    const input = body;

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

      await orgDb(member.organizationId).transaction((o) =>
        writeOrganizationIntegrationEvent(
          {
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
          },
          o,
        ),
      );

      return result;
    } catch (error) {
      const message = errorMessage(error);

      await orgDb(member.organizationId).transaction((o) =>
        writeIntegrationEvent(
          {
            integrationId: id,
            organizationId: member.organizationId,
            level: "error",
            event: "integration.conta_azul.mdfe_link.failed",
            message,
            details: {
              provider: "conta_azul",
            },
          },
          o,
        ),
      );

      if (isDatabaseError(error)) throw error;
      throw invalid("integration_request_failed", message);
    }
  },
);

mount(
  integrationsRouter,
  "/api/integrations",
  integrationEndpoints.pollContaAzulProtocols,
  adminOnly,
  async (c, { params, body }) => {
    const member = c.get("member");
    return runContaAzulPoll({
      kind: "protocols",
      member,
      actorUserId: c.get("session").user.id,
      integrationId: params.id,
      poll: () =>
        pollContaAzulProtocols({
          integrationId: params.id,
          organizationId: member.organizationId,
          env: c.env,
          limit: body.limit,
        }),
    });
  },
);

mount(
  integrationsRouter,
  "/api/integrations",
  integrationEndpoints.pollContaAzulDrift,
  adminOnly,
  async (c, { params, body }) => {
    const member = c.get("member");
    return runContaAzulPoll({
      kind: "driftChecks",
      member,
      actorUserId: c.get("session").user.id,
      integrationId: params.id,
      poll: () =>
        pollContaAzulRemoteDrift({
          integrationId: params.id,
          organizationId: member.organizationId,
          env: c.env,
          limit: body.limit,
        }),
    });
  },
);

mount(
  integrationsRouter,
  "/api/integrations",
  integrationEndpoints.validate,
  adminOnly,
  async (c, { params }) => {
    const member = c.get("member");
    const session = c.get("session");
    const id = params.id;
    const record = await requireLabIntegration(member.organizationId, id);

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

      await withOrg(member.organizationId, requestActor(c), async ({ o }) => {
        await o
          .update(organizationIntegration)
          .set({
            // `recover` (INTEGRATION_MACHINE): an integration that needed
            // the lab is active again; any other status is kept.
            status: INTEGRATION_MACHINE.canTransition(
              record.integration.status,
              "recover",
            )
              ? INTEGRATION_MACHINE.requireTargetOf(
                  record.integration.status,
                  "recover",
                )
              : record.integration.status,
            lastValidatedAt: new Date(),
            lastValidationError: null,
            updatedBy: session.user.id,
            updatedAt: new Date(),
          })
          .where(eq(organizationIntegration.id, id));

        await writeIntegrationEvent(
          {
            integrationId: id,
            organizationId: member.organizationId,
            level: "info",
            event: "integration.validation_succeeded",
            message: "Conexão validada com sucesso",
            details: {
              provider: record.integration.provider,
            },
          },
          o,
        );

        await writeOrganizationIntegrationEvent(
          {
            organizationId: member.organizationId,
            actorUserId: session.user.id,
            actorMemberId: member.id,
            action: "integration.validated",
            entityId: id,
          },
          o,
        );
      });

      return { success: true };
    } catch (error) {
      const message = errorMessage(error);

      await withOrg(member.organizationId, requestActor(c), async ({ o }) => {
        await o
          .update(organizationIntegration)
          .set({
            lastValidationError: message,
            updatedBy: session.user.id,
            updatedAt: new Date(),
          })
          .where(eq(organizationIntegration.id, id));

        await writeIntegrationEvent(
          {
            integrationId: id,
            organizationId: member.organizationId,
            level: "error",
            event: "integration.validation_failed",
            message,
          },
          o,
        );
      });

      if (isDatabaseError(error)) throw error;
      throw invalid("integration_request_failed", message);
    }
  },
);

mount(
  integrationsRouter,
  "/api/integrations",
  integrationEndpoints.previewSync,
  adminOnly,
  async (c, { params, body }) => {
    const member = c.get("member");
    const id = params.id;
    const input = body;
    const record = await requireLabIntegration(member.organizationId, id);

    assertProviderSupportsSyncTarget(record.integration.provider, input.target);

    const preview = await orgDb(record.integration.organizationId).transaction(
      (o) =>
        previewIntegrationSync(
          {
            record,
            target: input.target,
            limit: input.limit,
            mappings: input.mappings,
          },
          o,
        ),
    );

    return preview;
  },
);

mount(
  integrationsRouter,
  "/api/integrations",
  integrationEndpoints.sync,
  adminOnly,
  async (c, { params, body }) => {
    const member = c.get("member");
    const session = c.get("session");
    const id = params.id;
    const input = body;
    const record = await requireLabIntegration(member.organizationId, id);

    assertProviderSupportsSyncTarget(record.integration.provider, input.target);

    if (record.integration.status !== "ACTIVE") {
      throw conflict("integration_inactive", "Integração desativada");
    }

    const preview = await orgDb(record.integration.organizationId).transaction(
      (o) =>
        previewIntegrationSync(
          { record, target: input.target, limit: input.limit },
          o,
        ),
    );

    if (preview.blocked) {
      throw conflict(
        "integration_sync_blocked",
        preview.warnings[0]?.message ??
          "A integração ainda não está pronta para este alvo",
        {
          legacyBody: {
            blocked: true,
            warnings: preview.warnings.map((warning) => ({ ...warning })),
            coverage: { ...preview.coverage },
          },
        },
      );
    }

    const activeRun = await orgDb(member.organizationId).transaction((o) =>
      hasActiveSyncRun(
        {
          integrationId: id,
          organizationId: member.organizationId,
          target: input.target,
        },
        o,
      ),
    );

    if (activeRun) {
      throw conflict(
        "integration_sync_in_progress",
        "Já existe uma sincronização em andamento para este alvo",
        { legacyBody: { runId: activeRun.id } },
      );
    }

    // The run row and the event that requests it commit together; the
    // dispatch below (queue, remote calls) runs after.
    const runId = await withOrg(
      member.organizationId,
      requestActor(c),
      async ({ o }) => {
        const created = await createSyncRun(
          {
            integrationId: id,
            organizationId: member.organizationId,
            trigger: "manual",
            target: input.target,
            initiatedBy: session.user.id,
            requestedLimit: input.limit,
          },
          o,
        );

        await writeIntegrationEvent(
          {
            integrationId: id,
            organizationId: member.organizationId,
            runId: created,
            level: "info",
            event: "sync.requested",
            message: "Sincronização solicitada",
            details: {
              target: input.target,
              limit: input.limit,
            },
          },
          o,
        );
        return created;
      },
    );

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
      });
    } catch (error) {
      throw dispatchFailed(error, member.organizationId);
    }

    return {
      success: true,
      queued: result.queued,
      runId,
      status: result.status,
      warnings: preview.warnings,
    };
  },
);

mount(
  integrationsRouter,
  "/api/integrations",
  integrationEndpoints.schedule,
  adminOnly,
  async (c, { params, body }) => {
    const member = c.get("member");
    const session = c.get("session");
    const id = params.id;
    const input = body;
    const record = await requireLabIntegration(member.organizationId, id);

    assertProviderSupportsSyncTarget(record.integration.provider, input.target);

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

    await withOrg(member.organizationId, requestActor(c), async ({ o }) => {
      await o
        .update(integrationConnection)
        .set({
          config: updatedConfig,
          updatedBy: session.user.id,
          updatedAt: new Date(),
        })
        .where(eq(integrationConnection.integrationId, id));

      await writeIntegrationEvent(
        {
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
        },
        o,
      );

      await writeOrganizationIntegrationEvent(
        {
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
        },
        o,
      );
    });

    return await buildListPayload(member.organizationId);
  },
);

mount(
  integrationsRouter,
  "/api/integrations",
  integrationEndpoints.toggle,
  adminOnly,
  async (c, { params, body }) => {
    const member = c.get("member");
    const session = c.get("session");
    const id = params.id;
    const input = body;
    const record = await requireLabIntegration(member.organizationId, id);

    // `enable` leaves DISABLED only; ACTION_REQUIRED must reconnect first.
    if (
      input.enabled &&
      !INTEGRATION_MACHINE.canTransition(record.integration.status, "enable") &&
      record.integration.status !== "ACTIVE"
    ) {
      throw conflict(
        "integration_action_required",
        "Reconecte a integração antes de ativá-la",
      );
    }

    await withOrg(member.organizationId, requestActor(c), async ({ o }) => {
      await o
        .update(organizationIntegration)
        .set({
          status: input.enabled ? "ACTIVE" : "DISABLED",
          disabledAt: input.enabled ? null : new Date(),
          updatedBy: session.user.id,
          updatedAt: new Date(),
        })
        // Compare-and-set on the status the toggle was checked against: a
        // concurrent refresh failure (ACTION_REQUIRED) is not overwritten.
        .where(
          and(
            eq(organizationIntegration.id, id),
            eq(organizationIntegration.status, record.integration.status),
          ),
        );

      await writeIntegrationEvent(
        {
          integrationId: id,
          organizationId: member.organizationId,
          level: "info",
          event: input.enabled ? "integration.enabled" : "integration.disabled",
          message: input.enabled
            ? "Integração ativada"
            : "Integração desativada",
        },
        o,
      );
    });

    return await buildListPayload(member.organizationId);
  },
);

mount(
  integrationsRouter,
  "/api/integrations",
  integrationEndpoints.listRunItems,
  adminOnly,
  async (c, { params, query }) => {
    const member = c.get("member");
    const id = params.id;
    const runId = params.runId;
    const input = query;
    await requireLabIntegration(member.organizationId, id);

    const found = await orgDb(member.organizationId).transaction(async (o) => {
      const [run] = await o
        .select()
        .from(integrationSyncRun)
        .where(
          and(
            eq(integrationSyncRun.id, runId),
            eq(integrationSyncRun.integrationId, id),
            eq(integrationSyncRun.organizationId, member.organizationId),
          ),
        )
        .limit(1);
      if (!run) return null;

      const items = await o
        .select()
        .from(integrationSyncItem)
        .where(
          and(
            eq(integrationSyncItem.runId, runId),
            eq(integrationSyncItem.integrationId, id),
            eq(integrationSyncItem.organizationId, member.organizationId),
          ),
        )
        .orderBy(desc(integrationSyncItem.updatedAt))
        .limit(input.limit);
      return { run, items };
    });

    if (!found) {
      throw notFound("integration_run_not_found", "Execução não encontrada");
    }
    const { run, items } = found;
    const statusCounts = items.reduce<Record<string, number>>((acc, item) => {
      acc[item.status] = (acc[item.status] ?? 0) + 1;
      return acc;
    }, {});

    return {
      runId,
      target: run.target,
      data: items,
      summary: {
        returnedCount: items.length,
        statusCounts,
      },
    };
  },
);

mount(
  integrationsRouter,
  "/api/integrations",
  integrationEndpoints.retryRun,
  adminOnly,
  async (c, { params }) => {
    const member = c.get("member");
    const session = c.get("session");
    const id = params.id;
    const runId = params.runId;
    const record = await requireLabIntegration(member.organizationId, id);

    const [originalRun] = await orgDb(member.organizationId).transaction((o) =>
      o
        .select()
        .from(integrationSyncRun)
        .where(
          and(
            eq(integrationSyncRun.id, runId),
            eq(integrationSyncRun.integrationId, id),
            eq(integrationSyncRun.organizationId, member.organizationId),
          ),
        )
        .limit(1),
    );

    if (!originalRun) {
      throw notFound("integration_run_not_found", "Execução não encontrada");
    }

    assertProviderSupportsSyncTarget(
      record.integration.provider,
      originalRun.target,
    );

    if (originalRun.status === "PENDING" || originalRun.status === "RUNNING") {
      throw conflict(
        "integration_run_in_progress",
        "Não é possível reprocessar uma execução ainda em andamento",
      );
    }

    const activeRun = await orgDb(member.organizationId).transaction((o) =>
      hasActiveSyncRun(
        {
          integrationId: id,
          organizationId: member.organizationId,
          target: originalRun.target,
        },
        o,
      ),
    );

    if (activeRun) {
      throw conflict(
        "integration_sync_in_progress",
        "Já existe uma sincronização em andamento para este alvo",
        { legacyBody: { runId: activeRun.id } },
      );
    }

    const requestedLimit = getRequestedLimitFromRun(originalRun);
    const preview = await orgDb(record.integration.organizationId).transaction(
      (o) =>
        previewIntegrationSync(
          { record, target: originalRun.target, limit: requestedLimit },
          o,
        ),
    );

    const retryRunId = await orgDb(member.organizationId).transaction((o) =>
      createSyncRun(
        {
          integrationId: id,
          organizationId: member.organizationId,
          trigger: "retry",
          target: originalRun.target,
          initiatedBy: session.user.id,
          requestedLimit,
          retryOfRunId: originalRun.id,
        },
        o,
      ),
    );

    if (preview.blocked) {
      const message =
        preview.warnings[0]?.message ??
        "A integração ainda não está pronta para este alvo";

      await orgDb(member.organizationId).transaction((o) =>
        failSyncRunAsBlocked(
          {
            integrationId: id,
            organizationId: member.organizationId,
            runId: retryRunId,
            target: originalRun.target,
            requestedLimit,
            message,
          },
          o,
        ),
      );

      throw conflict("integration_sync_blocked", message, {
        legacyBody: {
          blocked: true,
          warnings: preview.warnings.map((warning) => ({ ...warning })),
          runId: retryRunId,
        },
      });
    }

    await orgDb(member.organizationId).transaction((o) =>
      writeIntegrationEvent(
        {
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
        },
        o,
      ),
    );

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
      });
    } catch (error) {
      throw dispatchFailed(error, member.organizationId);
    }

    return {
      success: true,
      queued: result.queued,
      runId: retryRunId,
      status: result.status,
    };
  },
);

mount(
  integrationsRouter,
  "/api/integrations",
  integrationEndpoints.acknowledgeDrift,
  adminOnly,
  async (c, { params, body }) => {
    const member = c.get("member");
    const session = c.get("session");
    const linkId = params.linkId;
    const { reason } = body;
    const result = await withOrg(
      member.organizationId,
      requestActor(c),
      ({ o }) =>
        acknowledgeIntegrationDrift(
          {
            organizationId: member.organizationId,
            linkId,
            actorUserId: session.user.id,
            reason,
          },
          o,
        ),
    );
    if (!result.ok) {
      throw invalid("integration_reason_required", "Motivo é obrigatório");
    }
    return { data: { ok: true } };
  },
);

mount(
  integrationsRouter,
  "/api/integrations",
  integrationEndpoints.listDrift,
  [...requireLabProtected, requireOrgType("LAB")],
  async (c, { query }) => {
    const member = c.get("member");
    const { target } = query;
    const rows = await orgDb(member.organizationId).transaction((o) =>
      buildIntegrationDriftQueue(
        {
          organizationId: member.organizationId,
          target: target && isDriftTarget(target) ? target : undefined,
        },
        o,
      ),
    );
    return { data: rows };
  },
);

// Not an SDK endpoint: the browser lands here from Conta Azul's authorization
// page (the redirect URI) and is answered with a redirect, never JSON.
integrationsRouter.get(
  "/conta-azul/oauth/callback",
  zValidator("query", OAuthCallbackQuerySchema),
  async (c) => {
    const input = c.req.valid("query");
    const stateSecret = getContaAzulStateSecret(c.env);

    let state: Awaited<ReturnType<typeof verifyContaAzulOAuthState>>;
    try {
      state = await verifyContaAzulOAuthState({
        state: input.state,
        stateSecret,
      });
    } catch {
      // Expired/tampered/replayed state is a client error, not a server fault.
      return c.redirect(
        buildContaAzulOAuthErrorUrl(c.env, null, "invalid_state"),
      );
    }

    const callbackContext = await resolveContaAzulOAuthCallbackContext(state);
    // The laboratory's application; removed since the flow started → nothing
    // can redeem the code.
    const config = await resolveContaAzulOAuthConfig({
      organizationId: callbackContext.organizationId,
      env: c.env,
    });
    if (!config) {
      return c.redirect(
        buildContaAzulOAuthErrorUrl(c.env, state.returnTo, "app_missing"),
      );
    }

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
          buildContaAzulOAuthErrorUrl(c.env, state.returnTo, "exchange_failed"),
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

    await orgDb(callbackContext.organizationId).transaction((o) =>
      writeIntegrationEvent(
        {
          integrationId: connection.integrationId,
          organizationId: callbackContext.organizationId,
          level: "info",
          event: "integration.conta_azul.connected",
          message: "Conta Azul conectada via OAuth",
          details: {
            provider: "conta_azul",
            accessTokenExpiresAt: connection.accessTokenExpiresAt,
          },
        },
        o,
      ),
    );

    await orgDb(callbackContext.organizationId).transaction((o) =>
      writeOrganizationIntegrationEvent(
        {
          organizationId: callbackContext.organizationId,
          actorUserId: callbackContext.userId,
          actorMemberId: callbackContext.memberId,
          action: "integration.conta_azul.connected",
          entityId: connection.integrationId,
          details: {
            provider: "conta_azul",
            accessTokenExpiresAt: connection.accessTokenExpiresAt,
          },
        },
        o,
      ),
    );

    return c.redirect(buildContaAzulOAuthReturnUrl(c.env, state.returnTo));
  },
);

// Plain routes below: nothing in the frontends calls them (the list already
// carries each integration's overview, last runs and last events).
integrationsRouter.get(
  "/:id/overview",
  ...requireLabProtected,
  requireOrgType("LAB"),
  requireRole(["admin", "owner"]),
  async (c) => {
    const member = c.get("member");
    const id = c.req.param("id");
    const record = await requireLabIntegration(member.organizationId, id);

    return c.json({
      data: await orgDb(record.integration.organizationId).transaction((o) =>
        buildIntegrationOverview(record, o),
      ),
    });
  },
);

integrationsRouter.get(
  "/:id/runs",
  ...requireLabProtected,
  requireOrgType("LAB"),
  requireRole(["admin", "owner"]),
  async (c) => {
    const member = c.get("member");
    const id = c.req.param("id");
    await requireLabIntegration(member.organizationId, id);

    const runs = await orgDb(member.organizationId).transaction((o) =>
      o
        .select()
        .from(integrationSyncRun)
        .where(
          and(
            eq(integrationSyncRun.integrationId, id),
            eq(integrationSyncRun.organizationId, member.organizationId),
          ),
        )
        .orderBy(desc(integrationSyncRun.createdAt))
        .limit(20),
    );

    return c.json({ data: runs });
  },
);

integrationsRouter.get(
  "/:id/events",
  ...requireLabProtected,
  requireOrgType("LAB"),
  requireRole(["admin", "owner"]),
  async (c) => {
    const member = c.get("member");
    const id = c.req.param("id");
    await requireLabIntegration(member.organizationId, id);

    const events = await orgDb(member.organizationId).transaction((o) =>
      o
        .select()
        .from(integrationEventLog)
        .where(
          and(
            eq(integrationEventLog.integrationId, id),
            eq(integrationEventLog.organizationId, member.organizationId),
          ),
        )
        .orderBy(desc(integrationEventLog.createdAt))
        .limit(30),
    );

    return c.json({ data: events });
  },
);
