import type {
  AssetAuditLogData,
  AssetDetailData,
  AssetTypesListData,
  AssetsListData,
  BillingSubscriptionResponse,
  CalibraApi,
  CertificateNumberingConfig,
  CertificateNumberingProfileResponse,
  CreateJobResult,
  CreateNonConformanceInput,
  CreateNonConformanceResult,
  CreateServiceOrderResult,
  CustomerAuditLogData,
  CustomerDetailData,
  CustomersListData,
  DashboardStats,
  DashboardUnitsResponse,
  EffectiveEnvironmentalLimitsResponse,
  EnvironmentalLimit,
  FinanceAccessResponse,
  JobsListData,
  LocalAttachment,
  LocalAttachmentsResponse,
  LocalCertificateDraft,
  LocalSessionSnapshotResponse,
  LocalSyncConflict,
  LocalSyncConflictsResponse,
  MethodAuditLogData,
  MethodDetailData,
  MethodWriteInput,
  MethodsListData,
  NonConformanceListInput,
  NotificationPreferencesResponse,
  PlanAccessResponse,
  EmailDomainResponse,
  PortalDomainResponse,
  ReferenceStandardsResponse,
  ServiceAuditLogData,
  ServiceDetailData,
  ServiceOrderDetail,
  ServiceOrdersListData,
  ServicesListData,
  SsoSettingsResponse,
  StandardAuditLogData,
  MassCompositionProfileDto,
  MassCompositionProfilesData,
  MassCompositionProfileWriteInput,
  StandardData,
  StandardsListData,
  TechnicianListData,
  UpdateAssetInput,
  UpdateCustomerComplianceInput,
  UpdateCustomerInput,
} from "../types";
import {
  getDesktopDataPolicyUnavailableMessage,
  listCalibraApiNamespaceMethodsWithPolicy,
  listCalibraApiNamespaces,
  type CalibraApiMethodsWithPolicy,
  type CalibraApiNamespace,
  type DataPolicy,
} from "../data-policy";
import { readApiError } from "./response";
import { apiRouteParam } from "./url";
import {
  createDesktopHeaders,
  type CreateDesktopApiClientOptions,
} from "./desktop";

function assumeDesktopPayload<TResponse>(payload: unknown): TResponse {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- desktop transport mirrors typed API methods; domain schemas live at higher boundaries and this helper centralizes the unavoidable generic JSON trust point.
  return payload as TResponse;
}

async function readDesktopJson<TResponse>(
  response: Response,
): Promise<TResponse> {
  const payload: unknown = await response.json();
  return assumeDesktopPayload<TResponse>(payload);
}

type DesktopUnsupportedMessageFlavor = "web-api" | "cloud-sync";

function desktopUnsupportedError(
  action: string,
  flavor: DesktopUnsupportedMessageFlavor,
) {
  return new Error(
    flavor === "cloud-sync"
      ? `${action} requer sincronização com a nuvem neste momento.`
      : `${action} requer a API web/nuvem neste momento.`,
  );
}

type DesktopCloudOnlyStubLabels<TNamespace extends CalibraApiNamespace> = {
  action: string;
  flavor?: DesktopUnsupportedMessageFlavor;
  actionByMethod?: Partial<
    Record<CalibraApiMethodsWithPolicy<TNamespace, "cloud-only">, string>
  >;
};

/**
 * Throw-stubs for every method the policy registry classifies as
 * `cloud-only` in a namespace. The return type is a `Pick` of exactly those
 * methods, so any method with a local policy (`local-*`) still demands an
 * explicit implementation at the call site — reclassifying a method in
 * `calibraApiPolicyRegistry` surfaces here as a compile error instead of a
 * silently wrong stub. Graceful desktop degradations (empty lists, synthesized
 * responses) stay hand-written and simply override their stub in the spread.
 */
function desktopCloudOnlyStubs<TNamespace extends CalibraApiNamespace>(
  namespace: TNamespace,
  labels: DesktopCloudOnlyStubLabels<TNamespace>,
): Pick<
  CalibraApi[TNamespace],
  CalibraApiMethodsWithPolicy<TNamespace, "cloud-only"> &
    keyof CalibraApi[TNamespace]
> {
  const actionOverrides = new Map<string, string>();
  for (const [method, action] of Object.entries(labels.actionByMethod ?? {})) {
    if (typeof action === "string") {
      actionOverrides.set(method, action);
    }
  }

  const stubs: Record<string, () => Promise<never>> = {};
  for (const method of listCalibraApiNamespaceMethodsWithPolicy(namespace, [
    "cloud-only",
  ])) {
    const action = actionOverrides.get(method) ?? labels.action;
    stubs[method] = async () => {
      throw desktopUnsupportedError(action, labels.flavor ?? "web-api");
    };
  }

  // oxlint-disable-next-line typescript/consistent-type-assertions -- the stub keys are exactly the registry's cloud-only methods for this namespace, and the registry is type-total over CalibraApi; this is the single trust point that ties the runtime object to the Pick above.
  return stubs as Pick<
    CalibraApi[TNamespace],
    CalibraApiMethodsWithPolicy<TNamespace, "cloud-only"> &
      keyof CalibraApi[TNamespace]
  >;
}

export function createDesktopApiClient(
  options: CreateDesktopApiClientOptions,
): CalibraApi {
  const fetchImpl = options.fetch ?? fetch;
  let localSessionCache: {
    expiresAt: number;
    promise: Promise<LocalSessionSnapshotResponse>;
  } | null = null;

  async function getLocalSessionSnapshot() {
    const now = Date.now();
    if (localSessionCache && localSessionCache.expiresAt > now) {
      return localSessionCache.promise;
    }

    const promise = (async () => {
      const response = await fetchImpl(
        new URL("/api/local/session", options.baseUrl),
        {
          credentials: "include",
          headers: await createDesktopHeaders(options.tokenProvider),
        },
      );

      return response;
    })()
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Falha ao carregar sessão local");
        }

        return readDesktopJson<LocalSessionSnapshotResponse>(response);
      })
      .catch((error) => {
        localSessionCache = null;
        throw error;
      });

    localSessionCache = {
      expiresAt: now + 5_000,
      promise,
    };

    return promise;
  }

  return {
    dashboard: {
      async getStats<TStats = DashboardStats>() {
        const response = await fetchImpl(
          new URL("/api/dashboard/stats", options.baseUrl),
          {
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider),
          },
        );

        if (!response.ok) {
          throw new Error("Falha ao carregar estatísticas");
        }

        return readDesktopJson<TStats>(response);
      },
    },
    units: {
      ...desktopCloudOnlyStubs("units", { action: "Governança de unidades" }),
      async getDashboardUnits() {
        const session = await getLocalSessionSnapshot();
        return buildDesktopUnitsResponse(session.data);
      },
      async listAdminUnits<TResponse = unknown>() {
        return assumeDesktopPayload<TResponse>(emptyGovernanceResponse());
      },
      async listAdminMembers<TResponse = unknown>() {
        return assumeDesktopPayload<TResponse>(emptyGovernanceResponse());
      },
      async listAdminActivity<TResponse = unknown>() {
        return assumeDesktopPayload<TResponse>(emptyGovernanceResponse());
      },
    },
    customerGroups: {
      // Customer groups are a cloud-only lab feature; desktop/offline can't
      // provision CLIENT orgs. Reads degrade to empty, writes are unsupported.
      ...desktopCloudOnlyStubs("customerGroups", {
        action: "Grupos de clientes",
      }),
      async list() {
        return { data: [] };
      },
      async listMembers() {
        return [];
      },
      async listInvitations() {
        return [];
      },
    },
    access: {
      async getPlanAccess() {
        return desktopPlanAccess();
      },
      async getFinanceAccess() {
        return desktopFinanceAccess();
      },
    },
    sessions: desktopCloudOnlyStubs("sessions", {
      action: "Gerenciamento de sessoes",
    }),
    finance: desktopCloudOnlyStubs("finance", { action: "Financeiro" }),
    billing: {
      async getSubscription() {
        return desktopBillingSubscription();
      },
      async listPayments() {
        return { data: [] };
      },
    },
    backoffice: {
      ...desktopCloudOnlyStubs("backoffice", {
        action: "Backoffice",
        actionByMethod: {
          bootstrap: "Bootstrap backoffice",
          listOrganizations: "Organizações backoffice",
          getOrganization: "Organizações backoffice",
          getSupportQueue: "Suporte backoffice",
          listUsers: "Usuários backoffice",
          updateUserRole: "Usuários backoffice",
          banUser: "Usuários backoffice",
          unbanUser: "Usuários backoffice",
          impersonateUser: "Usuários backoffice",
          createUser: "Usuários backoffice",
          provisionLab: "Laboratórios backoffice",
          requestUserPasswordReset: "Usuários backoffice",
          getUser: "Usuários backoffice",
          listUserSessions: "Sessões backoffice",
          revokeUserSession: "Sessões backoffice",
          listUserActivity: "Atividade backoffice",
          getPresence: "Presença backoffice",
          listAuditLog: "Auditoria backoffice",
          getIntegrationHealth: "Integrações backoffice",
          getVitals: "Indicadores backoffice",
          listOperatorAlerts: "Alertas backoffice",
          recomputeOperatorAlerts: "Alertas backoffice",
          acknowledgeOperatorAlert: "Alertas backoffice",
          listAccountTasks: "Tarefas backoffice",
          createAccountTask: "Tarefas backoffice",
          completeAccountTask: "Tarefas backoffice",
          updateOrganizationLifecycle: "Ciclo de vida backoffice",
          listInteractions: "Interações backoffice",
          createInteraction: "Interações backoffice",
          manageSubscription: "Assinatura backoffice",
          listEntitlementOverrides: "Concessões backoffice",
          grantEntitlementOverride: "Concessões backoffice",
          revokeEntitlementOverride: "Concessões backoffice",
          getOrganizationActivity: "Atividade backoffice",
          listImportRuns: "Importações backoffice",
          parseImportFile: "Importações backoffice",
          validateImportRun: "Importações backoffice",
          listApprovals: "Aprovações backoffice",
          createApprovalRequest: "Aprovações backoffice",
          decideApproval: "Aprovações backoffice",
          stopImpersonation: "Impersonação backoffice",
        },
      }),
      async getAccess() {
        return {
          allowed: false,
          roles: [],
          bootstrapAvailable: false,
          isImpersonating: false,
        };
      },
      commercial: {
        async listOrganizations() {
          throw desktopUnsupportedBackofficeAction("Comercial backoffice");
        },
        async getContext() {
          throw desktopUnsupportedBackofficeAction("Comercial backoffice");
        },
        async syncBillingCustomer() {
          throw desktopUnsupportedBackofficeAction("Comercial backoffice");
        },
        async createBillingContact() {
          throw desktopUnsupportedBackofficeAction("Comercial backoffice");
        },
        async previewOffer() {
          throw desktopUnsupportedBackofficeAction("Comercial backoffice");
        },
        async issueOffer() {
          throw desktopUnsupportedBackofficeAction("Comercial backoffice");
        },
        async cancelOffer() {
          throw desktopUnsupportedBackofficeAction("Comercial backoffice");
        },
        async reissueOffer() {
          throw desktopUnsupportedBackofficeAction("Comercial backoffice");
        },
      },
      customerSuccess: {
        async listOrganizations() {
          throw desktopUnsupportedBackofficeAction("Customer Success");
        },
        async getProfile() {
          throw desktopUnsupportedBackofficeAction("Customer Success");
        },
        async getRequests() {
          throw desktopUnsupportedBackofficeAction("Customer Success");
        },
        async updateProfile() {
          throw desktopUnsupportedBackofficeAction("Customer Success");
        },
        async updateRequestStatus() {
          throw desktopUnsupportedBackofficeAction("Customer Success");
        },
        async assignRequest() {
          throw desktopUnsupportedBackofficeAction("Customer Success");
        },
        async respondRequest() {
          throw desktopUnsupportedBackofficeAction("Customer Success");
        },
        async escalateRequest() {
          throw desktopUnsupportedBackofficeAction("Customer Success");
        },
        async updateNextAction() {
          throw desktopUnsupportedBackofficeAction("Customer Success");
        },
        async updateBlocker() {
          throw desktopUnsupportedBackofficeAction("Customer Success");
        },
      },
    },
    sso: {
      ...desktopCloudOnlyStubs("sso", {
        action: "Configuração SSO",
        actionByMethod: { start: "Login SSO" },
      }),
      async getProviders() {
        return desktopSsoSettings();
      },
    },
    apiKeys: {
      ...desktopCloudOnlyStubs("apiKeys", { action: "API keys" }),
      async list() {
        return { data: [] };
      },
    },
    entityLabels: {
      async getNonConformance() {
        return null;
      },
      async getCapa() {
        return null;
      },
      async getCompetence() {
        return null;
      },
    },
    certificateNumbering: {
      ...desktopCloudOnlyStubs("certificateNumbering", {
        action: "Numeração de certificados",
      }),
      async getProfile() {
        return desktopCertificateNumberingProfile();
      },
    },
    portalDomains: {
      ...desktopCloudOnlyStubs("portalDomains", {
        action: "Domínio do portal",
      }),
      async get() {
        return desktopPortalDomain();
      },
    },
    emailDomains: {
      ...desktopCloudOnlyStubs("emailDomains", {
        action: "Domínio de e-mail",
      }),
      async get() {
        return desktopEmailDomain();
      },
    },
    notifications: {
      async getUnreadCount() {
        return { count: 0 };
      },
      async listRecent() {
        return {
          data: [],
          pagination: { page: 1, limit: 5, total: 0, totalPages: 0 },
        };
      },
      async markRead() {
        return { updatedIds: [] };
      },
      async markAllRead() {
        return { count: 0 };
      },
      async getPreferences() {
        return desktopNotificationPreferences();
      },
      async updatePreferences(input) {
        return {
          ...desktopNotificationPreferences(),
          ...input,
          // Mirror the server-side schema defaults (inApp/email default true)
          // that zValidator would apply before echoing the preferences back.
          preferences: Object.fromEntries(
            Object.entries(input.preferences ?? {}).map(([key, value]) => [
              key,
              { inApp: value.inApp ?? true, email: value.email ?? true },
            ]),
          ),
        };
      },
    },
    signatures: {
      ...desktopCloudOnlyStubs("signatures", {
        action: "Assinatura visual",
        flavor: "cloud-sync",
      }),
      async getMine() {
        return { hasSignature: false };
      },
    },
    profileMedia: desktopCloudOnlyStubs("profileMedia", {
      action: "Avatar",
      flavor: "cloud-sync",
    }),
    organizationMedia: desktopCloudOnlyStubs("organizationMedia", {
      action: "Logo da organização",
      flavor: "cloud-sync",
    }),
    signingCertificates: {
      ...desktopCloudOnlyStubs("signingCertificates", {
        action: "Certificado ICP-Brasil",
        flavor: "cloud-sync",
        actionByMethod: { setPolicy: "Política de assinatura" },
      }),
      async list() {
        return { certificates: [] };
      },
    },
    customers: {
      ...desktopCloudOnlyStubs("customers", {
        action: "Clientes",
        actionByMethod: {
          lookupCnpj: "Consulta de CNPJ",
          ootEvents: "Eventos fora de tolerância",
        },
      }),
      async list(input) {
        const url = new URL("/api/customers", options.baseUrl);
        url.searchParams.set("page", String(input.page));
        url.searchParams.set("limit", String(input.limit));

        if (input.query) {
          url.searchParams.set("query", input.query);
        }

        const response = await fetchImpl(url, {
          credentials: "include",
          headers: await createDesktopHeaders(options.tokenProvider),
        });

        if (!response.ok) {
          throw new Error("Falha ao carregar clientes");
        }

        return readDesktopJson<CustomersListData>(response);
      },
      async create(input) {
        const response = await fetchImpl(
          new URL("/api/customers", options.baseUrl),
          {
            method: "POST",
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider, {
              "Content-Type": "application/json",
            }),
            body: JSON.stringify(input),
          },
        );

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Erro ao criar cliente"),
          );
        }

        return readDesktopJson<CustomersListData["data"][number]>(response);
      },
      // Cloud-only enrichment: it reaches the external Receita Federal mirrors,
      // which the offline local server can't proxy. The cadastro still works
      // with manual entry; the autofill is simply unavailable in desktop mode.
      async get<TCustomer = CustomerDetailData>(id: string | number) {
        const response = await fetchImpl(
          new URL(
            `/api/customers/${encodeURIComponent(String(id))}`,
            options.baseUrl,
          ),
          {
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider),
          },
        );

        if (!response.ok) {
          throw new Error("Falha ao carregar cliente");
        }

        return readDesktopJson<TCustomer>(response);
      },
      async update<TCustomer = CustomerDetailData>(
        id: string | number,
        input: UpdateCustomerInput,
      ) {
        const response = await fetchImpl(
          new URL(
            `/api/customers/${encodeURIComponent(String(id))}`,
            options.baseUrl,
          ),
          {
            method: "PUT",
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider, {
              "Content-Type": "application/json",
            }),
            body: JSON.stringify(input),
          },
        );

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Falha ao atualizar cliente"),
          );
        }

        return readDesktopJson<TCustomer>(response);
      },
      async auditLog<TRecord = unknown>(
        id: string | number,
        input: { page?: number; limit?: number } = {},
      ) {
        const url = new URL(
          `/api/customers/${encodeURIComponent(String(id))}/audit-log`,
          options.baseUrl,
        );
        url.searchParams.set("page", String(input.page ?? 1));
        url.searchParams.set("limit", String(input.limit ?? 50));

        const response = await fetchImpl(url, {
          credentials: "include",
          headers: await createDesktopHeaders(options.tokenProvider),
        });

        if (!response.ok) {
          throw new Error("Falha ao carregar historico");
        }

        return readDesktopJson<CustomerAuditLogData<TRecord>>(response);
      },
      async updateCompliance<TCustomer = CustomerDetailData>(
        id: string | number,
        input: UpdateCustomerComplianceInput,
      ) {
        const response = await fetchImpl(
          new URL(
            `/api/customers/${encodeURIComponent(String(id))}/compliance`,
            options.baseUrl,
          ),
          {
            method: "PUT",
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider, {
              "Content-Type": "application/json",
            }),
            body: JSON.stringify(input),
          },
        );

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Falha ao atualizar conformidade"),
          );
        }

        return readDesktopJson<TCustomer>(response);
      },
      async listMembers<TMember = unknown>(id: string | number) {
        const response = await fetchImpl(
          new URL(
            `/api/customers/${encodeURIComponent(String(id))}/members`,
            options.baseUrl,
          ),
          {
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider),
          },
        );

        if (!response.ok) {
          throw new Error("Falha ao carregar usuarios");
        }

        return readDesktopJson<TMember[]>(response);
      },
      async listInvitations<TInvitation = unknown>(id: string | number) {
        const response = await fetchImpl(
          new URL(
            `/api/customers/${encodeURIComponent(String(id))}/invitations`,
            options.baseUrl,
          ),
          {
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider),
          },
        );

        if (!response.ok) {
          throw new Error("Falha ao carregar convites");
        }

        return readDesktopJson<TInvitation[]>(response);
      },
      async createInvitation<TInvitation = unknown>(
        id: string | number,
        input: { email: string; role: string },
      ) {
        const response = await fetchImpl(
          new URL(
            `/api/customers/${encodeURIComponent(String(id))}/invitations`,
            options.baseUrl,
          ),
          {
            method: "POST",
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider, {
              "Content-Type": "application/json",
            }),
            body: JSON.stringify(input),
          },
        );

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Falha ao enviar convite"),
          );
        }

        return readDesktopJson<TInvitation>(response);
      },
      async resendInvitation(id: string | number, invitationId: string) {
        const response = await fetchImpl(
          new URL(
            `/api/customers/${encodeURIComponent(
              String(id),
            )}/invitations/${encodeURIComponent(invitationId)}/resend`,
            options.baseUrl,
          ),
          {
            method: "POST",
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider),
          },
        );

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Falha ao reenviar convite"),
          );
        }

        return response.json();
      },
      async cancelInvitation(id: string | number, invitationId: string) {
        const response = await fetchImpl(
          new URL(
            `/api/customers/${encodeURIComponent(
              String(id),
            )}/invitations/${encodeURIComponent(invitationId)}`,
            options.baseUrl,
          ),
          {
            method: "DELETE",
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider),
          },
        );

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Falha ao cancelar convite"),
          );
        }

        return response.json();
      },
      async removeMember(id: string | number, memberId: string) {
        const response = await fetchImpl(
          new URL(
            `/api/customers/${encodeURIComponent(
              String(id),
            )}/members/${encodeURIComponent(memberId)}`,
            options.baseUrl,
          ),
          {
            method: "DELETE",
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider),
          },
        );

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Falha ao remover usuário"),
          );
        }

        return response.json();
      },
    },
    assets: {
      async list(input) {
        const url = new URL("/api/assets", options.baseUrl);
        url.searchParams.set("page", String(input.page));
        url.searchParams.set("limit", String(input.limit));

        if (input.customerId) {
          url.searchParams.set("customerId", String(input.customerId));
        }

        if (input.status) {
          url.searchParams.set("status", input.status);
        }

        if (input.query) {
          url.searchParams.set("query", input.query);
        }

        const response = await fetchImpl(url, {
          credentials: "include",
          headers: await createDesktopHeaders(options.tokenProvider),
        });

        if (!response.ok) {
          throw new Error("Falha ao carregar ativos");
        }

        return readDesktopJson<AssetsListData>(response);
      },
      async create(input) {
        const response = await fetchImpl(
          new URL("/api/assets", options.baseUrl),
          {
            method: "POST",
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider, {
              "Content-Type": "application/json",
            }),
            body: JSON.stringify(input),
          },
        );

        if (!response.ok) {
          throw new Error(await readApiError(response, "Erro ao criar ativo"));
        }

        return readDesktopJson<AssetsListData["data"][number]>(response);
      },
      async get<TAsset = AssetDetailData>(id: string | number) {
        const response = await fetchImpl(
          new URL(
            `/api/assets/${encodeURIComponent(String(id))}`,
            options.baseUrl,
          ),
          {
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider),
          },
        );

        if (!response.ok) {
          throw new Error("Falha ao carregar ativo");
        }

        return readDesktopJson<TAsset>(response);
      },
      async update<TAsset = AssetDetailData>(
        id: string | number,
        input: UpdateAssetInput,
      ) {
        const response = await fetchImpl(
          new URL(
            `/api/assets/${encodeURIComponent(String(id))}`,
            options.baseUrl,
          ),
          {
            method: "PUT",
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider, {
              "Content-Type": "application/json",
            }),
            body: JSON.stringify(input),
          },
        );

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Erro ao atualizar ativo"),
          );
        }

        return readDesktopJson<TAsset>(response);
      },
      async auditLog<TRecord = unknown>(id: string | number) {
        const response = await fetchImpl(
          new URL(
            `/api/assets/${encodeURIComponent(String(id))}/audit-log`,
            options.baseUrl,
          ),
          {
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider),
          },
        );

        if (!response.ok) {
          throw new Error("Falha ao carregar histórico");
        }

        return readDesktopJson<AssetAuditLogData<TRecord>>(response);
      },
    },
    assetTypes: {
      async list() {
        const response = await fetchImpl(
          new URL("/api/asset-types", options.baseUrl),
          {
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider),
          },
        );

        if (!response.ok) {
          throw new Error("Falha ao carregar tipos de instrumento");
        }

        return readDesktopJson<AssetTypesListData>(response);
      },
    },
    environmentalLimits: {
      ...desktopCloudOnlyStubs("environmentalLimits", {
        action: "Limites ambientais",
      }),
      async list() {
        const session = await getLocalSessionSnapshot();
        const activeUnitId = session.data?.permissions.activeUnitId ?? null;
        return {
          limits: (session.data?.environmentalLimits ?? [])
            .map(environmentalLimitFromUnknown)
            .filter((limit): limit is EnvironmentalLimit => {
              if (!limit) return false;
              return activeUnitId === null || limit.unitId === activeUnitId;
            }),
          unit: {
            unitId: activeUnitId,
            unitName:
              session.data?.activeUnits.find((unit) => unit.id === activeUnitId)
                ?.name ?? null,
          },
        };
      },
    },
    accreditedScope: desktopCloudOnlyStubs("accreditedScope", {
      action: "Escopo acreditado (CMC)",
    }),
    reports: desktopCloudOnlyStubs("reports", {
      action: "Relatórios consolidados",
    }),
    publicCheckout: desktopCloudOnlyStubs("publicCheckout", {
      action: "Checkout comercial",
    }),
    publicInvitations: desktopCloudOnlyStubs("publicInvitations", {
      action: "Convites",
    }),
    publicLeads: desktopCloudOnlyStubs("publicLeads", {
      action: "Contato comercial",
    }),
    labSetup: desktopCloudOnlyStubs("labSetup", {
      action: "Configuração de acesso",
    }),
    nonConformances: {
      ...desktopCloudOnlyStubs("nonConformances", {
        action: "Não conformidades",
      }),
      async list<TResponse = unknown>(input: NonConformanceListInput) {
        const url = new URL("/api/nc", options.baseUrl);
        url.searchParams.set("page", String(input.page));
        url.searchParams.set("limit", String(input.limit));

        if (input.query) {
          url.searchParams.set("query", input.query);
        }

        if (input.status) {
          url.searchParams.set("status", input.status);
        }

        if (input.type) {
          url.searchParams.set("type", input.type);
        }

        const response = await fetchImpl(url, {
          credentials: "include",
          headers: await createDesktopHeaders(options.tokenProvider),
        });

        if (!response.ok) {
          throw new Error("Falha ao carregar não conformidades");
        }

        return readDesktopJson<TResponse>(response);
      },
      async create(input: CreateNonConformanceInput) {
        const response = await fetchImpl(new URL("/api/nc", options.baseUrl), {
          method: "POST",
          credentials: "include",
          headers: await createDesktopHeaders(options.tokenProvider, {
            "Content-Type": "application/json",
          }),
          body: JSON.stringify(input),
        });

        if (!response.ok) {
          throw new Error(await readApiError(response, "Erro ao registrar NC"));
        }

        return readDesktopJson<CreateNonConformanceResult>(response);
      },
    },
    capas: desktopCloudOnlyStubs("capas", { action: "CAPA" }),
    proficiencyTests: desktopCloudOnlyStubs("proficiencyTests", {
      action: "Ensaios de proficiência",
    }),
    spc: desktopCloudOnlyStubs("spc", { action: "Cartas de controle" }),
    competences: desktopCloudOnlyStubs("competences", {
      action: "Competências",
    }),
    trainingRecords: desktopCloudOnlyStubs("trainingRecords", {
      action: "Registros de treinamento",
    }),
    customerSuccess: desktopCloudOnlyStubs("customerSuccess", {
      action: "Customer Success",
    }),
    calibrationRequests: desktopCloudOnlyStubs("calibrationRequests", {
      action: "Solicitações de calibração",
    }),
    visits: desktopCloudOnlyStubs("visits", { action: "Visitas" }),
    integrations: {
      ...desktopCloudOnlyStubs("integrations", { action: "Integrações" }),
      async list<TResponse = unknown>() {
        return assumeDesktopPayload<TResponse>({
          billing: {
            planId: "desktop-local",
            planName: "Desktop local",
            status: "active",
            hasFinancialIntegrations: false,
          },
          data: [],
        });
      },
    },
    materials: {
      // Material catalog is cloud-only in v1; the desktop SO flow keeps the
      // free-form part-item fallback. Reads degrade to empty, writes are
      // unsupported offline.
      ...desktopCloudOnlyStubs("materials", {
        action: "Catálogo de materiais",
      }),
      async list() {
        return { data: [] };
      },
    },
    services: {
      async list(input = {}) {
        const url = new URL("/api/services", options.baseUrl);
        url.searchParams.set("page", String(input.page ?? 1));
        url.searchParams.set("limit", String(input.limit ?? 20));

        if (input.query) {
          url.searchParams.set("query", input.query);
        }

        if (input.assetTypeId) {
          url.searchParams.set("assetTypeId", String(input.assetTypeId));
        }

        if (input.methodId) {
          url.searchParams.set("methodId", String(input.methodId));
        }

        if (input.isActive !== undefined) {
          url.searchParams.set("isActive", String(input.isActive));
        }

        const response = await fetchImpl(url, {
          credentials: "include",
          headers: await createDesktopHeaders(options.tokenProvider),
        });

        if (!response.ok) {
          throw new Error("Falha ao carregar serviços");
        }

        return readDesktopJson<ServicesListData>(response);
      },
      async get(id) {
        const response = await fetchImpl(
          new URL(
            `/api/services/${encodeURIComponent(String(id))}`,
            options.baseUrl,
          ),
          {
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider),
          },
        );

        if (!response.ok) {
          throw new Error("Falha ao carregar serviço");
        }

        return readDesktopJson<ServiceDetailData>(response);
      },
      async auditLog<TRecord = unknown>(id: string | number) {
        const response = await fetchImpl(
          new URL(
            `/api/services/${encodeURIComponent(String(id))}/audit-log`,
            options.baseUrl,
          ),
          {
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider),
          },
        );

        if (!response.ok) {
          throw new Error("Falha ao carregar histórico");
        }

        return readDesktopJson<ServiceAuditLogData<TRecord>>(response);
      },
      async create(input) {
        const response = await fetchImpl(
          new URL("/api/services", options.baseUrl),
          {
            method: "POST",
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider, {
              "Content-Type": "application/json",
            }),
            body: JSON.stringify(input),
          },
        );

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Erro ao criar serviço"),
          );
        }

        return readDesktopJson<{ id: number }>(response);
      },
      async update(id, input) {
        const response = await fetchImpl(
          new URL(
            `/api/services/${encodeURIComponent(String(id))}`,
            options.baseUrl,
          ),
          {
            method: "PUT",
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider, {
              "Content-Type": "application/json",
            }),
            body: JSON.stringify(input),
          },
        );

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Erro ao atualizar serviço"),
          );
        }

        return readDesktopJson<ServiceDetailData>(response);
      },
      async deactivate(id) {
        const response = await fetchImpl(
          new URL(
            `/api/services/${encodeURIComponent(String(id))}`,
            options.baseUrl,
          ),
          {
            method: "DELETE",
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider),
          },
        );

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Erro ao desativar serviço"),
          );
        }

        return readDesktopJson<unknown>(response);
      },
    },
    methods: {
      ...desktopCloudOnlyStubs("methods", {
        action: "Métodos",
        actionByMethod: {
          compileDraft: "Compilação de método",
          previewDraft: "Preview de método",
          publishDraft: "Publicação de método",
          requestApproval: "Solicitação de aprovação",
          listMethodTemplates: "Catálogo de modelos de método",
          fromTemplate: "Adoção de método a partir de modelo",
        },
      }),
      async list(input = {}) {
        const url = new URL("/api/methods", options.baseUrl);
        url.searchParams.set("page", String(input.page ?? 1));
        url.searchParams.set("limit", String(input.limit ?? 20));

        if (input.status) {
          url.searchParams.set("status", input.status);
        }

        if (input.assetTypeId) {
          url.searchParams.set("assetTypeId", String(input.assetTypeId));
        }

        if (input.query) {
          url.searchParams.set("query", input.query);
        }

        const response = await fetchImpl(url, {
          credentials: "include",
          headers: await createDesktopHeaders(options.tokenProvider),
        });

        if (!response.ok) {
          throw new Error("Falha ao carregar métodos");
        }

        return readDesktopJson<MethodsListData>(response);
      },
      async get(id) {
        const response = await fetchImpl(
          new URL(
            `/api/methods/${encodeURIComponent(String(id))}`,
            options.baseUrl,
          ),
          {
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider),
          },
        );

        if (!response.ok) {
          throw new Error("Falha ao carregar método");
        }

        return readDesktopJson<MethodDetailData>(response);
      },
      async audit<TRecord = unknown>(id: string | number) {
        const response = await fetchImpl(
          new URL(
            `/api/methods/${encodeURIComponent(String(id))}/audit`,
            options.baseUrl,
          ),
          {
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider),
          },
        );

        if (!response.ok) {
          throw new Error("Falha ao carregar histórico");
        }

        return readDesktopJson<MethodAuditLogData<TRecord>>(response);
      },
      async create(input) {
        const response = await fetchImpl(
          new URL("/api/methods", options.baseUrl),
          {
            method: "POST",
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider, {
              "Content-Type": "application/json",
            }),
            body: JSON.stringify(input),
          },
        );

        if (!response.ok) {
          throw new Error(await readApiError(response, "Erro ao criar método"));
        }

        return readDesktopJson<MethodDetailData>(response);
      },
      async update(id, input) {
        const response = await fetchImpl(
          new URL(
            `/api/methods/${encodeURIComponent(String(id))}`,
            options.baseUrl,
          ),
          {
            method: "PUT",
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider, {
              "Content-Type": "application/json",
            }),
            body: JSON.stringify(input),
          },
        );

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Erro ao atualizar método"),
          );
        }

        return readDesktopJson<MethodDetailData>(response);
      },
      async archive(id) {
        return postDesktopMethodAction(
          fetchImpl,
          options,
          id,
          "archive",
          undefined,
          "Erro ao arquivar método",
        );
      },
      async createNewVersion(id) {
        return postDesktopMethodAction<MethodDetailData>(
          fetchImpl,
          options,
          id,
          "new-version",
          undefined,
          "Erro ao criar nova versão",
        );
      },
      async technicalReview(id) {
        return postDesktopMethodAction(
          fetchImpl,
          options,
          id,
          "technical-review",
          undefined,
          "Erro ao revisar tecnicamente",
        );
      },
      async qualityApprove(id, input = {}) {
        return postDesktopMethodAction(
          fetchImpl,
          options,
          id,
          "quality-approve",
          input,
          "Erro ao aprovar qualidade",
        );
      },
      async returnToDraft(id, reason) {
        return postDesktopMethodAction(
          fetchImpl,
          options,
          id,
          "return-to-draft",
          { reason },
          "Erro ao retornar para rascunho",
        );
      },
    },
    standards: {
      ...desktopCloudOnlyStubs("standards", {
        action: "Padrões",
        actionByMethod: {
          getImpactedCertificates: "Recall de padrão",
          getRecall: "Recall de padrão",
          sendRecall: "Recall de padrão",
          uploadCertificateDocument: "Certificado de padrão",
          getCertificateDocumentDownloadUrl: "Certificado de padrão",
        },
      }),
      async list(input = {}) {
        const url = new URL("/api/standards", options.baseUrl);
        url.searchParams.set("page", String(input.page ?? 1));
        url.searchParams.set("limit", String(input.limit ?? 20));

        if (input.query) {
          url.searchParams.set("query", input.query);
        }

        if (input.status) {
          url.searchParams.set("status", input.status);
        }

        const response = await fetchImpl(url, {
          credentials: "include",
          headers: await createDesktopHeaders(options.tokenProvider),
        });

        if (!response.ok) {
          throw new Error("Falha ao carregar padrões");
        }

        return readDesktopJson<StandardsListData>(response);
      },
      async get(id) {
        const response = await fetchImpl(
          new URL(
            `/api/standards/${encodeURIComponent(String(id))}`,
            options.baseUrl,
          ),
          {
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider),
          },
        );

        if (!response.ok) {
          throw new Error("Falha ao carregar padrão");
        }

        return readDesktopJson<StandardData>(response);
      },
      async listCompositionProfiles() {
        const response = await fetchImpl(
          new URL("/api/standards/composition-profiles", options.baseUrl),
          {
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider),
          },
        );

        if (!response.ok) {
          throw new Error("Falha ao carregar perfis de composição");
        }

        return readDesktopJson<MassCompositionProfilesData>(response);
      },
      async createCompositionProfile(input: MassCompositionProfileWriteInput) {
        const response = await fetchImpl(
          new URL("/api/standards/composition-profiles", options.baseUrl),
          {
            method: "POST",
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider, {
              "Content-Type": "application/json",
            }),
            body: JSON.stringify(input),
          },
        );

        if (!response.ok) {
          throw new Error("Erro ao criar perfil de composição");
        }

        return readDesktopJson<MassCompositionProfileDto>(response);
      },
      async updateCompositionProfile(
        id: number,
        input: Partial<MassCompositionProfileWriteInput>,
      ) {
        const response = await fetchImpl(
          new URL(
            `/api/standards/composition-profiles/${encodeURIComponent(String(id))}`,
            options.baseUrl,
          ),
          {
            method: "PUT",
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider, {
              "Content-Type": "application/json",
            }),
            body: JSON.stringify(input),
          },
        );

        if (!response.ok) {
          throw new Error("Erro ao atualizar perfil de composição");
        }

        return readDesktopJson<MassCompositionProfileDto>(response);
      },
      async deleteCompositionProfile(id: number) {
        const response = await fetchImpl(
          new URL(
            `/api/standards/composition-profiles/${encodeURIComponent(String(id))}`,
            options.baseUrl,
          ),
          {
            method: "DELETE",
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider),
          },
        );

        if (!response.ok) {
          throw new Error("Erro ao remover perfil de composição");
        }

        return readDesktopJson<{ success: boolean; id: number }>(response);
      },
      async auditLog<TRecord = unknown>(id: string | number) {
        const response = await fetchImpl(
          new URL(
            `/api/standards/${encodeURIComponent(String(id))}/audit-log`,
            options.baseUrl,
          ),
          {
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider),
          },
        );

        if (!response.ok) {
          throw new Error("Falha ao carregar histórico");
        }

        return readDesktopJson<StandardAuditLogData<TRecord>>(response);
      },
      async create(input) {
        const response = await fetchImpl(
          new URL("/api/standards", options.baseUrl),
          {
            method: "POST",
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider, {
              "Content-Type": "application/json",
            }),
            body: JSON.stringify(input),
          },
        );

        if (!response.ok) {
          throw new Error(await readApiError(response, "Erro ao criar padrão"));
        }

        return readDesktopJson<{ id: number }>(response);
      },
      async update(id, input) {
        const response = await fetchImpl(
          new URL(
            `/api/standards/${encodeURIComponent(String(id))}`,
            options.baseUrl,
          ),
          {
            method: "PUT",
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider, {
              "Content-Type": "application/json",
            }),
            body: JSON.stringify(input),
          },
        );

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Erro ao atualizar padrão"),
          );
        }

        return readDesktopJson<StandardData>(response);
      },
      async delete(id) {
        const response = await fetchImpl(
          new URL(
            `/api/standards/${encodeURIComponent(String(id))}`,
            options.baseUrl,
          ),
          {
            method: "DELETE",
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider),
          },
        );

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Erro ao remover padrão"),
          );
        }

        return readDesktopJson<unknown>(response);
      },
      async renew(id, input) {
        const response = await fetchImpl(
          new URL(
            `/api/standards/${encodeURIComponent(String(id))}/renew`,
            options.baseUrl,
          ),
          {
            method: "POST",
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider, {
              "Content-Type": "application/json",
            }),
            body: JSON.stringify(input),
          },
        );

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Erro ao renovar certificado"),
          );
        }

        return readDesktopJson<unknown>(response);
      },
    },
    jobs: {
      ...desktopCloudOnlyStubs("jobs", {
        action: "Jobs de calibração",
        actionByMethod: {
          approve: "Aprovação de job",
          reject: "Rejeição de job",
          cancel: "Cancelamento de job",
          assign: "Atribuição de técnico",
          getCertificateDownloadUrl: "Download de certificado publicado",
          generateLabel: "Geração de etiqueta publicada",
          getLabelDownloadUrl: "Download de etiqueta publicada",
          getLabelCommands: "Geração de comandos da etiqueta",
          amend: "Retificação de certificado",
          flagOutOfTolerance: "Sinalização de fora de tolerância",
        },
      }),
      async list(input) {
        const url = new URL("/api/jobs", options.baseUrl);
        url.searchParams.set("page", String(input.page));
        url.searchParams.set("limit", String(input.limit));

        if (input.customerId) {
          url.searchParams.set("customerId", String(input.customerId));
        }

        if (input.query) {
          url.searchParams.set("query", input.query);
        }

        if (input.status) {
          url.searchParams.set("status", input.status);
        }

        const response = await fetchImpl(url, {
          credentials: "include",
          headers: await createDesktopHeaders(options.tokenProvider),
        });

        if (!response.ok) {
          throw new Error("Falha ao carregar calibrações");
        }

        return readDesktopJson<JobsListData>(response);
      },
      async create(input) {
        const response = await fetchImpl(
          new URL("/api/jobs", options.baseUrl),
          {
            method: "POST",
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider, {
              "Content-Type": "application/json",
            }),
            body: JSON.stringify(input),
          },
        );

        if (!response.ok) {
          throw new Error(await readApiError(response, "Erro ao criar ordem"));
        }

        return readDesktopJson<CreateJobResult>(response);
      },
      async get<TJob = unknown>(jobId: string | number) {
        const response = await fetchImpl(
          new URL(`/api/jobs/${apiRouteParam(jobId)}`, options.baseUrl),
          {
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider),
          },
        );

        if (!response.ok) {
          throw new Error("Falha ao carregar job");
        }

        return readDesktopJson<TJob>(response);
      },
      async listTechnicians() {
        const response = await fetchImpl(
          new URL("/api/jobs/technicians/list", options.baseUrl),
          {
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider),
          },
        );

        if (!response.ok) {
          throw new Error("Falha ao carregar técnicos");
        }

        return readDesktopJson<TechnicianListData>(response);
      },
      async listStandards<TStandard = unknown>() {
        const url = new URL("/api/standards", options.baseUrl);
        url.searchParams.set("status", "ACTIVE");
        url.searchParams.set("limit", "100");

        const response = await fetchImpl(url, {
          credentials: "include",
          headers: await createDesktopHeaders(options.tokenProvider),
        });

        if (!response.ok) {
          throw new Error("Falha ao carregar padrões");
        }

        return readDesktopJson<ReferenceStandardsResponse<TStandard>>(response);
      },
      async getEffectiveEnvironmentalLimits<TLimits = unknown>(
        assetTypeId: string | number,
        input: { unitId?: string | number | null } = {},
      ) {
        const url = new URL(
          `/api/environmental-limits/effective/${encodeURIComponent(
            String(assetTypeId),
          )}`,
          options.baseUrl,
        );

        if (input.unitId) {
          url.searchParams.set("unitId", String(input.unitId));
        }

        const response = await fetchImpl(url, {
          credentials: "include",
          headers: await createDesktopHeaders(options.tokenProvider),
        });

        if (!response.ok) {
          return { limits: null, source: null };
        }

        return readDesktopJson<EffectiveEnvironmentalLimitsResponse<TLimits>>(
          response,
        );
      },
      async saveExecution(jobId, input) {
        const response = await fetchImpl(
          new URL(`/api/jobs/${apiRouteParam(jobId)}/execute`, options.baseUrl),
          {
            method: "POST",
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider, {
              "Content-Type": "application/json",
            }),
            body: JSON.stringify(input),
          },
        );

        if (!response.ok) {
          throw new Error(await readApiError(response, "Erro ao salvar"));
        }

        return response.json();
      },
      async submitExecution(jobId, input) {
        const response = await fetchImpl(
          new URL(`/api/jobs/${apiRouteParam(jobId)}/submit`, options.baseUrl),
          {
            method: "POST",
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider, {
              "Content-Type": "application/json",
            }),
            body: JSON.stringify(input),
          },
        );

        if (!response.ok) {
          throw new Error(await readApiError(response, "Erro ao submeter"));
        }

        return response.json();
      },
      async createCertificateDraft(jobId) {
        const response = await fetchImpl(
          new URL(
            `/api/jobs/${apiRouteParam(jobId)}/certificate-draft`,
            options.baseUrl,
          ),
          {
            method: "POST",
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider),
          },
        );

        if (!response.ok) {
          throw new Error("Falha ao gerar rascunho local do certificado");
        }

        return readDesktopJson<LocalCertificateDraft>(response);
      },
    },
    serviceOrders: {
      ...desktopCloudOnlyStubs("serviceOrders", {
        action: "Ordens de serviço",
        actionByMethod: {
          listCommunications: "Comunicações da OS",
          update: "Atualização da OS",
          saveEvaluation: "Avaliação técnica",
          sendQuote: "Emissão de orçamento",
          generateIntakeDocument: "Geração de comprovante",
          getIntakeDocumentPdf: "Abertura de comprovante",
          generateTag: "Geração de etiqueta",
          getTagPdf: "Abertura de etiqueta",
          updateRepairMark: "Marca de Reparo",
          deliver: "Registro de entrega",
          getDeliveryDocumentPdf: "Abertura do comprovante de entrega",
        },
      }),
      async list(input) {
        const url = new URL("/api/service-orders", options.baseUrl);
        url.searchParams.set("page", String(input.page));
        url.searchParams.set("limit", String(input.limit));

        if (input.query) {
          url.searchParams.set("query", input.query);
        }

        if (input.status) {
          url.searchParams.set("status", input.status);
        }

        const response = await fetchImpl(url, {
          credentials: "include",
          headers: await createDesktopHeaders(options.tokenProvider),
        });

        if (!response.ok) {
          throw new Error("Erro ao carregar ordens de serviço");
        }

        return readDesktopJson<ServiceOrdersListData>(response);
      },
      async get(id) {
        const response = await fetchImpl(
          new URL(
            `/api/service-orders/${encodeURIComponent(String(id))}`,
            options.baseUrl,
          ),
          {
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider),
          },
        );

        if (!response.ok) {
          throw new Error("Erro ao carregar OS");
        }

        const result = await readDesktopJson<{ data: ServiceOrderDetail }>(
          response,
        );
        return result.data;
      },
      /**
       * Desktop resolves the route id against the local store. The local id is
       * already opaque, so an offline-created OS — which has no cloud publicId
       * until it syncs — stays reachable by the same URL shape.
       */
      async getByPublicId(publicId) {
        const response = await fetchImpl(
          new URL(
            `/api/service-orders/${encodeURIComponent(publicId)}`,
            options.baseUrl,
          ),
          {
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider),
          },
        );

        if (!response.ok) {
          throw new Error("Erro ao carregar OS");
        }

        const result = await readDesktopJson<{ data: ServiceOrderDetail }>(
          response,
        );
        return result.data;
      },
      async create(input) {
        const response = await fetchImpl(
          new URL("/api/service-orders", options.baseUrl),
          {
            method: "POST",
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider, {
              "Content-Type": "application/json",
            }),
            body: JSON.stringify(input),
          },
        );

        if (!response.ok) {
          throw new Error(await readApiError(response, "Erro ao criar OS"));
        }

        return readDesktopJson<CreateServiceOrderResult>(response);
      },
      async createQuote(id, input) {
        const response = await fetchImpl(
          new URL(
            `/api/service-orders/${encodeURIComponent(String(id))}/quotes`,
            options.baseUrl,
          ),
          {
            method: "POST",
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider, {
              "Content-Type": "application/json",
            }),
            body: JSON.stringify(input),
          },
        );

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Erro ao salvar orçamento"),
          );
        }

        return response.json();
      },
      async saveExecution(id, input) {
        const response = await fetchImpl(
          new URL(
            `/api/service-orders/${encodeURIComponent(String(id))}/execution`,
            options.baseUrl,
          ),
          {
            method: "PATCH",
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider, {
              "Content-Type": "application/json",
            }),
            body: JSON.stringify(input),
          },
        );

        if (!response.ok) {
          throw new Error(
            await readApiError(response, "Erro ao salvar execução"),
          );
        }

        return response.json();
      },
      async issueDeliveryDocument(id, input) {
        const response = await fetchImpl(
          new URL(
            `/api/service-orders/${encodeURIComponent(
              String(id),
            )}/delivery-document`,
            options.baseUrl,
          ),
          {
            method: "POST",
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider, {
              "Content-Type": "application/json",
            }),
            body: JSON.stringify(input),
          },
        );

        if (!response.ok) {
          throw new Error(
            await readApiError(
              response,
              "Erro ao gerar comprovante de entrega",
            ),
          );
        }

        return response.json();
      },
    },
    sync: {
      async getSession() {
        return getLocalSessionSnapshot();
      },
      async listConflicts(input = {}) {
        const url = new URL("/api/local/sync/conflicts", options.baseUrl);

        if (input.status) {
          url.searchParams.set("status", input.status);
        }

        if (input.limit) {
          url.searchParams.set("limit", String(input.limit));
        }

        const response = await fetchImpl(url, {
          credentials: "include",
          headers: await createDesktopHeaders(options.tokenProvider),
        });

        if (!response.ok) {
          throw new Error("Falha ao carregar conflitos de sincronização");
        }

        return readDesktopJson<LocalSyncConflictsResponse>(response);
      },
      async resolveConflict(id, status = "resolved") {
        const response = await fetchImpl(
          new URL(
            `/api/local/sync/conflicts/${encodeURIComponent(id)}/resolve`,
            options.baseUrl,
          ),
          {
            method: "POST",
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider, {
              "Content-Type": "application/json",
            }),
            body: JSON.stringify({ status }),
          },
        );

        if (!response.ok) {
          throw new Error("Falha ao resolver conflito de sincronização");
        }

        return readDesktopJson<{ data: LocalSyncConflict }>(response);
      },
    },
    attachments: {
      async list(input = {}) {
        const url = new URL("/api/attachments", options.baseUrl);

        if (input.entityType) {
          url.searchParams.set("entityType", input.entityType);
        }

        if (input.entityId) {
          url.searchParams.set("entityId", input.entityId);
        }

        if (input.limit) {
          url.searchParams.set("limit", String(input.limit));
        }

        const response = await fetchImpl(url, {
          credentials: "include",
          headers: await createDesktopHeaders(options.tokenProvider),
        });

        if (!response.ok) {
          throw new Error("Falha ao carregar anexos locais");
        }

        return readDesktopJson<LocalAttachmentsResponse>(response);
      },
      async upload(input) {
        const formData = new FormData();
        formData.set("entityType", input.entityType);
        formData.set("entityId", input.entityId);
        formData.set("file", input.file, input.fileName);

        const response = await fetchImpl(
          new URL("/api/attachments", options.baseUrl),
          {
            method: "POST",
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider),
            body: formData,
          },
        );

        if (!response.ok) {
          throw new Error("Falha ao anexar arquivo local");
        }

        return readDesktopJson<LocalAttachment>(response);
      },
    },
  };
}

export function withDesktopLocalFirstReadThroughSync<TNamespace extends object>(
  cloudNamespace: TNamespace,
  localNamespace: TNamespace,
  localApi: CalibraApi,
  readMethods: Array<keyof TNamespace>,
  requestBackgroundSync: () => void,
): TNamespace {
  const namespace = { ...cloudNamespace };

  for (const method of readMethods) {
    const cloudMethod: unknown = cloudNamespace[method];
    const localMethod: unknown = localNamespace[method];

    if (
      !isAsyncNamespaceMethod(cloudMethod) ||
      !isAsyncNamespaceMethod(localMethod)
    ) {
      continue;
    }

    Object.defineProperty(namespace, method, {
      configurable: true,
      enumerable: true,
      writable: true,
      value: async (...args: unknown[]) => {
        if (await hasBootstrappedLocalCache(localApi)) {
          try {
            const result = await localMethod(...args);
            requestBackgroundSync();
            return result;
          } catch (localError) {
            try {
              return await cloudMethod(...args);
            } catch (cloudError) {
              if (isDesktopOfflineError(cloudError)) {
                throw localError;
              }

              throw cloudError;
            }
          }
        }

        try {
          return await cloudMethod(...args);
        } catch (error) {
          if (!isDesktopOfflineError(error)) {
            throw error;
          }

          if (!(await hasBootstrappedLocalCache(localApi))) {
            throw new Error(
              getDesktopDataPolicyUnavailableMessage(
                "local-first-read-through-sync",
              ),
              { cause: error },
            );
          }

          return localMethod(...args);
        }
      },
    });
  }

  return namespace;
}

function isAsyncNamespaceMethod(
  value: unknown,
): value is (...args: unknown[]) => Promise<unknown> {
  return typeof value === "function";
}

const HYBRID_LOCAL_METHOD_POLICIES: readonly DataPolicy[] = [
  "local-command-sync",
  "local-only",
];

/**
 * Composes the desktop hybrid client from `calibraApiPolicyRegistry` — the
 * single place a method's offline availability is declared. Per namespace:
 * `local-first-read-through-sync` methods get the read-through wrapper,
 * `local-command-sync` / `local-only` methods route to the local adapter, and
 * everything else keeps the cloud implementation. Reclassifying a method in
 * the registry is all it takes to reroute it here.
 */
export function composeDesktopHybridApi(
  cloud: CalibraApi,
  local: CalibraApi,
  requestBackgroundSync: () => void,
): CalibraApi {
  const hybrid: CalibraApi = { ...cloud };

  for (const namespace of listCalibraApiNamespaces()) {
    assignHybridNamespace(
      hybrid,
      namespace,
      cloud,
      local,
      requestBackgroundSync,
    );
  }

  return hybrid;
}

function assignHybridNamespace<TNamespace extends CalibraApiNamespace>(
  hybrid: CalibraApi,
  namespace: TNamespace,
  cloud: CalibraApi,
  local: CalibraApi,
  requestBackgroundSync: () => void,
): void {
  const readThroughMethods = listCalibraApiNamespaceMethodsWithPolicy(
    namespace,
    ["local-first-read-through-sync"],
  );
  const localMethods = listCalibraApiNamespaceMethodsWithPolicy(
    namespace,
    HYBRID_LOCAL_METHOD_POLICIES,
  );

  if (readThroughMethods.length === 0 && localMethods.length === 0) {
    // Cloud-only namespace: keep the cloud implementation untouched.
    return;
  }

  const composed =
    readThroughMethods.length > 0
      ? withDesktopLocalFirstReadThroughSync(
          cloud[namespace],
          local[namespace],
          local,
          readThroughMethods,
          requestBackgroundSync,
        )
      : { ...cloud[namespace] };

  for (const method of localMethods) {
    composed[method] = local[namespace][method];
  }

  hybrid[namespace] = composed;
}

export function createDesktopBackgroundSyncRequester(
  options: CreateDesktopApiClientOptions,
): () => void {
  const fetchImpl = options.fetch ?? fetch;
  let pending: Promise<void> | null = null;
  let lastStartedAt = 0;

  return () => {
    const now = Date.now();
    if (pending || now - lastStartedAt < 60_000) {
      return;
    }

    lastStartedAt = now;
    pending = (async () => {
      const response = await fetchImpl(
        new URL("/api/local/sync/retry", options.baseUrl),
        {
          method: "POST",
          credentials: "include",
          headers: await createDesktopHeaders(options.tokenProvider),
        },
      );

      if (!response.ok) {
        throw new Error(
          "Falha ao atualizar sincronização local em segundo plano",
        );
      }
    })()
      .catch(() => undefined)
      .finally(() => {
        pending = null;
      });
  };
}

async function hasBootstrappedLocalCache(localApi: CalibraApi) {
  try {
    const session = await localApi.sync.getSession();
    return Boolean(session.data?.syncCursor);
  } catch {
    return false;
  }
}

function isDesktopOfflineError(error: unknown) {
  if (!(error instanceof Error)) return false;

  return /fetch|network|failed to fetch|load failed|connection|err_/i.test(
    error.message,
  );
}

function emptyGovernanceResponse() {
  return {
    data: [],
    viewer: {
      isGlobalManager: false,
      canManageOrganizationUnits: false,
      canManageAssignments: false,
      canManageGlobalRoles: false,
      canViewGovernance: false,
      canAccessConsolidatedView: false,
      managedUnitIds: [],
    },
  };
}

function buildDesktopUnitsResponse(
  session: LocalSessionSnapshotResponse["data"],
): DashboardUnitsResponse | null {
  if (!session) return null;

  const activeUnitId = session.permissions.activeUnitId;
  const activeUnit =
    session.activeUnits.find((unit) => unit.id === activeUnitId) ??
    session.activeUnits[0] ??
    null;
  const canAccessAllUnits = session.permissions.canAccessAllUnits;
  const selectedUnitScope =
    canAccessAllUnits && !activeUnitId ? ("all" as const) : ("unit" as const);
  const effectiveRole =
    session.permissions.unitRole ?? session.permissions.role ?? "member";
  const unitSummaries = session.activeUnits.map((unit) => ({
    id: unit.id,
    name: unit.name,
    slug: slugifyUnitName(unit.name, unit.id),
    role: unit.role ?? effectiveRole,
  }));

  return {
    activeUnitId: activeUnit?.id ?? null,
    activeUnitName: activeUnit?.name ?? null,
    selectedUnitScope,
    canAccessAllUnits,
    data: unitSummaries,
    viewer: {
      isGlobalManager: canAccessAllUnits,
      canManageOrganizationUnits: false,
      canManageAssignments: false,
      canManageGlobalRoles: false,
      canViewGovernance: false,
      canAccessConsolidatedView: canAccessAllUnits,
      managedUnitIds: [],
    },
    scopeSummary: {
      isConsolidated: selectedUnitScope === "all",
      activeUnitId: activeUnit?.id ?? null,
      activeUnitName: activeUnit?.name ?? null,
      accessibleUnitsCount: unitSummaries.length,
      managedUnitsCount: 0,
      effectiveRole,
      effectiveRoleLabel: roleLabel(effectiveRole),
      label:
        selectedUnitScope === "all"
          ? "Todas as unidades"
          : (activeUnit?.name ?? "Unidade local"),
      description:
        selectedUnitScope === "all"
          ? "Dados locais sincronizados de todas as unidades acessiveis neste dispositivo."
          : "Dados locais sincronizados para a unidade ativa neste dispositivo.",
    },
  };
}

function slugifyUnitName(name: string, id: number) {
  const slug = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || `unit-${id}`;
}

function roleLabel(role: string) {
  switch (role) {
    case "admin":
    case "owner":
      return "Administrador";
    case "technical_manager":
      return "Responsavel tecnico";
    case "unit_admin":
      return "Admin. da unidade";
    case "technician":
      return "Tecnico";
    default:
      return "Membro";
  }
}

function desktopPlanAccess(): PlanAccessResponse {
  return {
    planId: "desktop-local",
    planName: "Desktop local",
    status: "active",
    limits: {
      certificates: -1,
      users: -1,
      storage: -1,
    },
    entitlements: ["desktop_local"],
    hasFinancial: false,
    hasFinancialModule: false,
    canManageBilling: false,
    hasApi: false,
    hasCustomDomain: false,
    hasCustomTemplates: true,
    hasSso: false,
  };
}

function desktopFinanceAccess(): FinanceAccessResponse {
  return {
    planId: "desktop-local",
    planName: "Desktop local",
    status: "active",
    entitlements: ["desktop_local"],
    hasFinancialModule: false,
    hasFinancialIntegrations: false,
    canReadFinancial: false,
    canManageFinancial: false,
    canExportFinancial: false,
    role: "desktop",
  };
}

function desktopBillingSubscription(): BillingSubscriptionResponse {
  const access = desktopPlanAccess();

  return {
    subscription: null,
    plan: {
      id: access.planId,
      name: access.planName,
      description: "Plano local do aplicativo desktop",
    },
    usage: {
      jobsCreated: 0,
      users: 1,
      storage: 0,
    },
    limits: access.limits,
  };
}

function desktopSsoSettings(): SsoSettingsResponse {
  const access = desktopPlanAccess();

  return {
    provider: null,
    access: {
      role: "desktop",
      canCreate: false,
      canManage: false,
      canDelete: false,
    },
    billing: {
      planId: access.planId,
      planName: access.planName,
      status: access.status,
      hasSso: false,
    },
  };
}

function desktopCertificateNumberingProfile(): CertificateNumberingProfileResponse {
  const config: CertificateNumberingConfig = {
    labCode: "CAL",
    projectCode: null,
    numberTemplate: "{labCode}-{yyyy}-{seq}",
    certificateNameTemplate: "Certificado {number}",
    sequence: {
      resetScope: "year",
      startAt: 1,
      increment: 1,
      padding: 4,
    },
  };

  return {
    profile: {
      id: null,
      name: "Padrao",
      config,
      createdAt: null,
      updatedAt: null,
    },
    example: {
      number: "CAL-2026-0123",
      name: "Certificado CAL-2026-0123",
      sequenceKey: "year:2026",
    },
    supportedTokens: [
      "{labCode}",
      "{labName}",
      "{labSlug}",
      "{projectCode}",
      "{yyyy}",
      "{yy}",
      "{mm}",
      "{mon}",
      "{dd}",
      "{seq}",
      "{number}",
    ],
  };
}

function desktopEmailDomain(): EmailDomainResponse {
  return {
    domain: null,
    statusSummary: {
      status: "not_configured",
      canActivate: false,
      message: "Domínio de e-mail próprio requer a API web/nuvem.",
      keyHealth: { status: "ok", lastError: null },
    },
  };
}

function desktopPortalDomain(): PortalDomainResponse {
  return {
    portalBaseUrl: "",
    domain: null,
    statusSummary: {
      status: "not_configured",
      readiness: "not_ready",
      canActivate: false,
      message: "Domínio customizado do portal requer a API web/nuvem.",
      diagnostics: {
        host: null,
        expectedValue: null,
        observedValues: [],
      },
    },
  };
}

function environmentalLimitFromUnknown(
  value: unknown,
): EnvironmentalLimit | null {
  if (!value || typeof value !== "object") return null;
  const id = numberFromUnknown(Reflect.get(value, "id"));
  const unitId = numberFromUnknown(Reflect.get(value, "unitId"));

  if (id === null || unitId === null) return null;

  return {
    id,
    unitId,
    assetTypeId: numberFromUnknown(Reflect.get(value, "assetTypeId")),
    assetTypeName:
      typeof Reflect.get(value, "assetTypeName") === "string"
        ? Reflect.get(value, "assetTypeName")
        : null,
    temperatureMin: numberFromUnknown(Reflect.get(value, "temperatureMin")),
    temperatureMax: numberFromUnknown(Reflect.get(value, "temperatureMax")),
    humidityMin: numberFromUnknown(Reflect.get(value, "humidityMin")),
    humidityMax: numberFromUnknown(Reflect.get(value, "humidityMax")),
    pressureMin: numberFromUnknown(Reflect.get(value, "pressureMin")),
    pressureMax: numberFromUnknown(Reflect.get(value, "pressureMax")),
    createdAt:
      typeof Reflect.get(value, "createdAt") === "string"
        ? Reflect.get(value, "createdAt")
        : null,
    updatedAt:
      typeof Reflect.get(value, "updatedAt") === "string"
        ? Reflect.get(value, "updatedAt")
        : null,
  };
}

function numberFromUnknown(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function desktopNotificationPreferences(): NotificationPreferencesResponse {
  return {
    preferences: {},
    emailEnabled: false,
    notifySelfActions: false,
    digestFrequency: "NONE",
  };
}

// The backoffice namespace nests sub-objects (`commercial`, `customerSuccess`)
// that the policy registry cannot describe (it registers function-valued
// methods only), so their stubs stay hand-written on top of this helper.
function desktopUnsupportedBackofficeAction(action: string) {
  return desktopUnsupportedError(action, "web-api");
}

async function postDesktopMethodAction<TResponse = unknown>(
  fetchImpl: typeof fetch,
  options: CreateDesktopApiClientOptions,
  id: string | number,
  action: string,
  input: MethodWriteInput | undefined,
  fallback: string,
): Promise<TResponse> {
  const response = await fetchImpl(
    new URL(
      `/api/methods/${encodeURIComponent(String(id))}/${action}`,
      options.baseUrl,
    ),
    {
      method: "POST",
      credentials: "include",
      headers: await createDesktopHeaders(
        options.tokenProvider,
        input === undefined
          ? undefined
          : { "Content-Type": "application/json" },
      ),
      body: input === undefined ? undefined : JSON.stringify(input),
    },
  );

  if (!response.ok) {
    throw new Error(await readApiError(response, fallback));
  }

  return readDesktopJson<TResponse>(response);
}
