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
  NotificationPreferencesResponse,
  PlanAccessResponse,
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
import { getDesktopDataPolicyUnavailableMessage } from "../data-policy";
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
      async createAdminUnit() {
        throw desktopUnsupportedAuthAction("Governança de unidades");
      },
      async updateAdminUnit() {
        throw desktopUnsupportedAuthAction("Governança de unidades");
      },
      async updateMemberAssignments() {
        throw desktopUnsupportedAuthAction("Governança de unidades");
      },
      async updateMemberRole() {
        throw desktopUnsupportedAuthAction("Governança de unidades");
      },
    },
    customerGroups: {
      // Customer groups are a cloud-only lab feature; desktop/offline can't
      // provision CLIENT orgs. Reads degrade to empty, writes are unsupported.
      async list() {
        return { data: [] };
      },
      async get() {
        throw desktopUnsupportedAuthAction("Grupos de clientes");
      },
      async create() {
        throw desktopUnsupportedAuthAction("Grupos de clientes");
      },
      async addBranch() {
        throw desktopUnsupportedAuthAction("Grupos de clientes");
      },
      async removeBranch() {
        throw desktopUnsupportedAuthAction("Grupos de clientes");
      },
      async listMembers() {
        return [];
      },
      async listInvitations() {
        return [];
      },
      async createInvitation() {
        throw desktopUnsupportedAuthAction("Grupos de clientes");
      },
      async resendInvitation() {
        throw desktopUnsupportedAuthAction("Grupos de clientes");
      },
      async cancelInvitation() {
        throw desktopUnsupportedAuthAction("Grupos de clientes");
      },
      async removeMember() {
        throw desktopUnsupportedAuthAction("Grupos de clientes");
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
    sessions: {
      async revoke() {
        throw desktopUnsupportedAuthAction("Gerenciamento de sessoes");
      },
    },
    finance: {
      async getOverview() {
        throw desktopUnsupportedAuthAction("Financeiro");
      },
      async listDocuments() {
        throw desktopUnsupportedAuthAction("Financeiro");
      },
      async getDocument() {
        throw desktopUnsupportedAuthAction("Financeiro");
      },
      async updateDocument() {
        throw desktopUnsupportedAuthAction("Financeiro");
      },
      async issueDocument() {
        throw desktopUnsupportedAuthAction("Financeiro");
      },
      async voidDocument() {
        throw desktopUnsupportedAuthAction("Financeiro");
      },
      async listEligibleJobs() {
        throw desktopUnsupportedAuthAction("Financeiro");
      },
      async createDocument() {
        throw desktopUnsupportedAuthAction("Financeiro");
      },
      async listContracts() {
        throw desktopUnsupportedAuthAction("Financeiro");
      },
      async getContract() {
        throw desktopUnsupportedAuthAction("Financeiro");
      },
      async createContract() {
        throw desktopUnsupportedAuthAction("Financeiro");
      },
      async activateContract() {
        throw desktopUnsupportedAuthAction("Financeiro");
      },
      async cancelContract() {
        throw desktopUnsupportedAuthAction("Financeiro");
      },
      async listReceipts() {
        throw desktopUnsupportedAuthAction("Financeiro");
      },
      async receiveInstallment() {
        throw desktopUnsupportedAuthAction("Financeiro");
      },
      async listErpExports() {
        throw desktopUnsupportedAuthAction("Financeiro");
      },
      async exportErpDocument() {
        throw desktopUnsupportedAuthAction("Financeiro");
      },
      async listBillingReadiness() {
        throw desktopUnsupportedAuthAction("Financeiro");
      },
      async sendBillingReadiness() {
        throw desktopUnsupportedAuthAction("Financeiro");
      },
      async getServiceOrderStatus() {
        throw desktopUnsupportedAuthAction("Financeiro");
      },
      async getCustomerTimeline() {
        throw desktopUnsupportedAuthAction("Financeiro");
      },
      async getCertificateRelease() {
        throw desktopUnsupportedAuthAction("Financeiro");
      },
      async releaseCertificateByException() {
        throw desktopUnsupportedAuthAction("Financeiro");
      },
      async listCertificateReleasePolicies() {
        throw desktopUnsupportedAuthAction("Financeiro");
      },
      async createCertificateReleasePolicy() {
        throw desktopUnsupportedAuthAction("Financeiro");
      },
      async updateCertificateReleasePolicy() {
        throw desktopUnsupportedAuthAction("Financeiro");
      },
      async listAutomaticSendRules() {
        throw desktopUnsupportedAuthAction("Financeiro");
      },
      async createAutomaticSendRule() {
        throw desktopUnsupportedAuthAction("Financeiro");
      },
      async updateAutomaticSendRule() {
        throw desktopUnsupportedAuthAction("Financeiro");
      },
      async getOperationsToCash() {
        throw desktopUnsupportedAuthAction("Financeiro");
      },
      async getRevenueLeakage() {
        throw desktopUnsupportedAuthAction("Financeiro");
      },
      async getCashForecast() {
        throw desktopUnsupportedAuthAction("Financeiro");
      },
      async getMarginDashboards() {
        throw desktopUnsupportedAuthAction("Financeiro");
      },
    },
    billing: {
      async getSubscription() {
        return desktopBillingSubscription();
      },
      async listPayments() {
        return { data: [] };
      },
    },
    backoffice: {
      async getAccess() {
        return {
          allowed: false,
          roles: [],
          bootstrapAvailable: false,
          isImpersonating: false,
        };
      },
      async bootstrap() {
        throw desktopUnsupportedBackofficeAction("Bootstrap backoffice");
      },
      async listOrganizations() {
        throw desktopUnsupportedBackofficeAction("Organizações backoffice");
      },
      async getOrganization() {
        throw desktopUnsupportedBackofficeAction("Organizações backoffice");
      },
      async getSupportQueue() {
        throw desktopUnsupportedBackofficeAction("Suporte backoffice");
      },
      async listUsers() {
        throw desktopUnsupportedBackofficeAction("Usuários backoffice");
      },
      async updateUserRole() {
        throw desktopUnsupportedBackofficeAction("Usuários backoffice");
      },
      async banUser() {
        throw desktopUnsupportedBackofficeAction("Usuários backoffice");
      },
      async unbanUser() {
        throw desktopUnsupportedBackofficeAction("Usuários backoffice");
      },
      async impersonateUser() {
        throw desktopUnsupportedBackofficeAction("Usuários backoffice");
      },
      async createUser() {
        throw desktopUnsupportedBackofficeAction("Usuários backoffice");
      },
      async provisionLab() {
        throw desktopUnsupportedBackofficeAction("Laboratórios backoffice");
      },
      async requestUserPasswordReset() {
        throw desktopUnsupportedBackofficeAction("Usuários backoffice");
      },
      async getUser() {
        throw desktopUnsupportedBackofficeAction("Usuários backoffice");
      },
      async listUserSessions() {
        throw desktopUnsupportedBackofficeAction("Sessões backoffice");
      },
      async revokeUserSession() {
        throw desktopUnsupportedBackofficeAction("Sessões backoffice");
      },
      async listUserActivity() {
        throw desktopUnsupportedBackofficeAction("Atividade backoffice");
      },
      async getPresence() {
        throw desktopUnsupportedBackofficeAction("Presença backoffice");
      },
      async listAuditLog() {
        throw desktopUnsupportedBackofficeAction("Auditoria backoffice");
      },
      async getIntegrationHealth() {
        throw desktopUnsupportedBackofficeAction("Integrações backoffice");
      },
      async getVitals() {
        throw desktopUnsupportedBackofficeAction("Indicadores backoffice");
      },
      async listOperatorAlerts() {
        throw desktopUnsupportedBackofficeAction("Alertas backoffice");
      },
      async recomputeOperatorAlerts() {
        throw desktopUnsupportedBackofficeAction("Alertas backoffice");
      },
      async acknowledgeOperatorAlert() {
        throw desktopUnsupportedBackofficeAction("Alertas backoffice");
      },
      async listAccountTasks() {
        throw desktopUnsupportedBackofficeAction("Tarefas backoffice");
      },
      async createAccountTask() {
        throw desktopUnsupportedBackofficeAction("Tarefas backoffice");
      },
      async completeAccountTask() {
        throw desktopUnsupportedBackofficeAction("Tarefas backoffice");
      },
      async updateOrganizationLifecycle() {
        throw desktopUnsupportedBackofficeAction("Ciclo de vida backoffice");
      },
      async listInteractions() {
        throw desktopUnsupportedBackofficeAction("Interações backoffice");
      },
      async createInteraction() {
        throw desktopUnsupportedBackofficeAction("Interações backoffice");
      },
      async manageSubscription() {
        throw desktopUnsupportedBackofficeAction("Assinatura backoffice");
      },
      async listEntitlementOverrides() {
        throw desktopUnsupportedBackofficeAction("Concessões backoffice");
      },
      async grantEntitlementOverride() {
        throw desktopUnsupportedBackofficeAction("Concessões backoffice");
      },
      async revokeEntitlementOverride() {
        throw desktopUnsupportedBackofficeAction("Concessões backoffice");
      },
      async getOrganizationActivity() {
        throw desktopUnsupportedBackofficeAction("Atividade backoffice");
      },
      async listImportRuns() {
        throw desktopUnsupportedBackofficeAction("Importações backoffice");
      },
      async parseImportFile() {
        throw desktopUnsupportedBackofficeAction("Importações backoffice");
      },
      async validateImportRun() {
        throw desktopUnsupportedBackofficeAction("Importações backoffice");
      },
      async listApprovals() {
        throw desktopUnsupportedBackofficeAction("Aprovações backoffice");
      },
      async createApprovalRequest() {
        throw desktopUnsupportedBackofficeAction("Aprovações backoffice");
      },
      async decideApproval() {
        throw desktopUnsupportedBackofficeAction("Aprovações backoffice");
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
      async stopImpersonation() {
        throw desktopUnsupportedBackofficeAction("Impersonação backoffice");
      },
    },
    sso: {
      async start() {
        throw desktopUnsupportedAuthAction("Login SSO");
      },
      async getProviders() {
        return desktopSsoSettings();
      },
      async createProvider() {
        throw desktopUnsupportedAuthAction("Configuração SSO");
      },
      async requestDomainVerification() {
        throw desktopUnsupportedAuthAction("Configuração SSO");
      },
      async verifyDomain() {
        throw desktopUnsupportedAuthAction("Configuração SSO");
      },
      async deleteProvider() {
        throw desktopUnsupportedAuthAction("Configuração SSO");
      },
    },
    apiKeys: {
      async list() {
        return { data: [] };
      },
      async create() {
        throw desktopUnsupportedAuthAction("API keys");
      },
      async rotate() {
        throw desktopUnsupportedAuthAction("API keys");
      },
      async revoke() {
        throw desktopUnsupportedAuthAction("API keys");
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
      async getProfile() {
        return desktopCertificateNumberingProfile();
      },
      async updateProfile() {
        throw desktopUnsupportedAuthAction("Numeração de certificados");
      },
    },
    portalDomains: {
      async get() {
        return desktopPortalDomain();
      },
      async create() {
        throw desktopUnsupportedAuthAction("Domínio do portal");
      },
      async verify() {
        throw desktopUnsupportedAuthAction("Domínio do portal");
      },
      async activate() {
        throw desktopUnsupportedAuthAction("Domínio do portal");
      },
      async delete() {
        throw desktopUnsupportedAuthAction("Domínio do portal");
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
          preferences: input.preferences ?? {},
        };
      },
    },
    signatures: {
      async getMine() {
        return { hasSignature: false };
      },
      async uploadMine() {
        throw desktopUnsupportedSignatureAction("Assinatura visual");
      },
      async deleteMine() {
        throw desktopUnsupportedSignatureAction("Assinatura visual");
      },
    },
    profileMedia: {
      async uploadAvatar() {
        throw desktopUnsupportedProfileMediaAction("Avatar");
      },
      async deleteAvatar() {
        throw desktopUnsupportedProfileMediaAction("Avatar");
      },
    },
    organizationMedia: {
      async uploadLogo() {
        throw desktopUnsupportedProfileMediaAction("Logo da organização");
      },
      async deleteLogo() {
        throw desktopUnsupportedProfileMediaAction("Logo da organização");
      },
    },
    signingCertificates: {
      async list() {
        return { certificates: [] };
      },
      async upload() {
        throw desktopUnsupportedSigningCertificateAction(
          "Certificado ICP-Brasil",
        );
      },
      async setDefault() {
        throw desktopUnsupportedSigningCertificateAction(
          "Certificado ICP-Brasil",
        );
      },
      async revoke() {
        throw desktopUnsupportedSigningCertificateAction(
          "Certificado ICP-Brasil",
        );
      },
    },
    customers: {
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
      async save() {
        throw desktopUnsupportedAuthAction("Limites ambientais");
      },
      async delete() {
        throw desktopUnsupportedAuthAction("Limites ambientais");
      },
    },
    reports: {
      async getExecutiveOverview() {
        throw desktopUnsupportedAuthAction("Relatórios consolidados");
      },
      async getComparison() {
        throw desktopUnsupportedAuthAction("Relatórios consolidados");
      },
      async getTrend() {
        throw desktopUnsupportedAuthAction("Relatórios consolidados");
      },
    },
    publicCheckout: {
      async getSnapshot() {
        throw desktopUnsupportedAuthAction("Checkout comercial");
      },
      async getStatus() {
        throw desktopUnsupportedAuthAction("Checkout comercial");
      },
      async start() {
        throw desktopUnsupportedAuthAction("Checkout comercial");
      },
    },
    publicInvitations: {
      async requestSetupLink() {
        throw desktopUnsupportedAuthAction("Convites");
      },
    },
    labSetup: {
      async get() {
        throw desktopUnsupportedAuthAction("Configuração de acesso");
      },
      async requestMagicLink() {
        throw desktopUnsupportedAuthAction("Configuração de acesso");
      },
      async requestOtp() {
        throw desktopUnsupportedAuthAction("Configuração de acesso");
      },
      async complete() {
        throw desktopUnsupportedAuthAction("Configuração de acesso");
      },
    },
    nonConformances: {
      async list() {
        throw desktopUnsupportedAuthAction("Não conformidades");
      },
      async summary() {
        throw desktopUnsupportedAuthAction("Não conformidades");
      },
      async get() {
        throw desktopUnsupportedAuthAction("Não conformidades");
      },
      async auditLog() {
        throw desktopUnsupportedAuthAction("Não conformidades");
      },
      async create() {
        throw desktopUnsupportedAuthAction("Não conformidades");
      },
      async setDisposition() {
        throw desktopUnsupportedAuthAction("Não conformidades");
      },
      async resolve() {
        throw desktopUnsupportedAuthAction("Não conformidades");
      },
      async escalateToCapa() {
        throw desktopUnsupportedAuthAction("Não conformidades");
      },
    },
    capas: {
      async list() {
        throw desktopUnsupportedAuthAction("CAPA");
      },
      async summary() {
        throw desktopUnsupportedAuthAction("CAPA");
      },
      async get() {
        throw desktopUnsupportedAuthAction("CAPA");
      },
      async auditLog() {
        throw desktopUnsupportedAuthAction("CAPA");
      },
      async create() {
        throw desktopUnsupportedAuthAction("CAPA");
      },
      async update() {
        throw desktopUnsupportedAuthAction("CAPA");
      },
      async implement() {
        throw desktopUnsupportedAuthAction("CAPA");
      },
      async verify() {
        throw desktopUnsupportedAuthAction("CAPA");
      },
      async close() {
        throw desktopUnsupportedAuthAction("CAPA");
      },
    },
    certificateTemplates: {
      async list() {
        throw desktopUnsupportedAuthAction("Templates de certificado");
      },
      async create() {
        throw desktopUnsupportedAuthAction("Templates de certificado");
      },
      async update() {
        throw desktopUnsupportedAuthAction("Templates de certificado");
      },
      async duplicate() {
        throw desktopUnsupportedAuthAction("Templates de certificado");
      },
      async setDefault() {
        throw desktopUnsupportedAuthAction("Templates de certificado");
      },
      async getXlsxVersion() {
        throw desktopUnsupportedAuthAction("Templates de certificado");
      },
      async uploadXlsx() {
        throw desktopUnsupportedAuthAction("Templates de certificado");
      },
      async validateXlsx() {
        throw desktopUnsupportedAuthAction("Templates de certificado");
      },
      async updateXlsxBindings() {
        throw desktopUnsupportedAuthAction("Templates de certificado");
      },
      async createXlsxPreview() {
        throw desktopUnsupportedAuthAction("Templates de certificado");
      },
      async getXlsxPreview() {
        throw desktopUnsupportedAuthAction("Templates de certificado");
      },
      async publishXlsx() {
        throw desktopUnsupportedAuthAction("Templates de certificado");
      },
      async createXlsxAssignment() {
        throw desktopUnsupportedAuthAction("Templates de certificado");
      },
    },
    competences: {
      async list() {
        throw desktopUnsupportedAuthAction("Competências");
      },
      async matrix() {
        throw desktopUnsupportedAuthAction("Competências");
      },
      async get() {
        throw desktopUnsupportedAuthAction("Competências");
      },
      async auditLog() {
        throw desktopUnsupportedAuthAction("Competências");
      },
      async create() {
        throw desktopUnsupportedAuthAction("Competências");
      },
      async transition() {
        throw desktopUnsupportedAuthAction("Competências");
      },
      async evaluate() {
        throw desktopUnsupportedAuthAction("Competências");
      },
      async renew() {
        throw desktopUnsupportedAuthAction("Competências");
      },
      async cancel() {
        throw desktopUnsupportedAuthAction("Competências");
      },
      async delete() {
        throw desktopUnsupportedAuthAction("Competências");
      },
      async assignTraining() {
        throw desktopUnsupportedAuthAction("Competências");
      },
    },
    trainingRecords: {
      async list() {
        throw desktopUnsupportedAuthAction("Registros de treinamento");
      },
      async create() {
        throw desktopUnsupportedAuthAction("Registros de treinamento");
      },
    },
    customerSuccess: {
      async getProfile() {
        throw desktopUnsupportedAuthAction("Customer Success");
      },
      async listRequests() {
        throw desktopUnsupportedAuthAction("Customer Success");
      },
      async createRequest() {
        throw desktopUnsupportedAuthAction("Customer Success");
      },
    },
    calibrationRequests: {
      async list() {
        throw desktopUnsupportedAuthAction("Solicitações de calibração");
      },
      async get() {
        throw desktopUnsupportedAuthAction("Solicitações de calibração");
      },
      async review() {
        throw desktopUnsupportedAuthAction("Solicitações de calibração");
      },
      async approve() {
        throw desktopUnsupportedAuthAction("Solicitações de calibração");
      },
      async reject() {
        throw desktopUnsupportedAuthAction("Solicitações de calibração");
      },
      async convert() {
        throw desktopUnsupportedAuthAction("Solicitações de calibração");
      },
    },
    visits: {
      async list() {
        throw desktopUnsupportedAuthAction("Visitas");
      },
      async get() {
        throw desktopUnsupportedAuthAction("Visitas");
      },
      async assign() {
        throw desktopUnsupportedAuthAction("Visitas");
      },
      async confirm() {
        throw desktopUnsupportedAuthAction("Visitas");
      },
      async reschedule() {
        throw desktopUnsupportedAuthAction("Visitas");
      },
      async cancel() {
        throw desktopUnsupportedAuthAction("Visitas");
      },
    },
    integrations: {
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
      async create() {
        throw desktopUnsupportedAuthAction("Integrações");
      },
      async startContaAzulOAuth() {
        throw desktopUnsupportedAuthAction("Integrações");
      },
      async validate() {
        throw desktopUnsupportedAuthAction("Integrações");
      },
      async update() {
        throw desktopUnsupportedAuthAction("Integrações");
      },
      async updateContaAzulConfig() {
        throw desktopUnsupportedAuthAction("Integrações");
      },
      async listContaAzulCatalog() {
        throw desktopUnsupportedAuthAction("Integrações");
      },
      async pollContaAzul() {
        throw desktopUnsupportedAuthAction("Integrações");
      },
      async pollContaAzulFiscal() {
        throw desktopUnsupportedAuthAction("Integrações");
      },
      async linkContaAzulInvoicesToMdfe() {
        throw desktopUnsupportedAuthAction("Integrações");
      },
      async pollContaAzulPayables() {
        throw desktopUnsupportedAuthAction("Integrações");
      },
      async pollContaAzulProtocols() {
        throw desktopUnsupportedAuthAction("Integrações");
      },
      async pollContaAzulDrift() {
        throw desktopUnsupportedAuthAction("Integrações");
      },
      async getContaAzulSchedule() {
        throw desktopUnsupportedAuthAction("Integrações");
      },
      async refreshContaAzul() {
        throw desktopUnsupportedAuthAction("Integrações");
      },
      async disconnectContaAzul() {
        throw desktopUnsupportedAuthAction("Integrações");
      },
      async toggle() {
        throw desktopUnsupportedAuthAction("Integrações");
      },
      async previewSync() {
        throw desktopUnsupportedAuthAction("Integrações");
      },
      async sync() {
        throw desktopUnsupportedAuthAction("Integrações");
      },
      async schedule() {
        throw desktopUnsupportedAuthAction("Integrações");
      },
      async listRunItems() {
        throw desktopUnsupportedAuthAction("Integrações");
      },
      async retryRun() {
        throw desktopUnsupportedAuthAction("Integrações");
      },
      async listDrift() {
        throw desktopUnsupportedAuthAction("Integrações");
      },
      async acknowledgeDrift() {
        throw desktopUnsupportedAuthAction("Integrações");
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
      async compileDraft() {
        throw desktopUnsupportedAuthAction("Compilação de método");
      },
      async previewDraft() {
        throw desktopUnsupportedAuthAction("Preview de método");
      },
      async publishDraft() {
        throw desktopUnsupportedAuthAction("Publicação de método");
      },
      async requestApproval() {
        throw desktopUnsupportedAuthAction("Solicitação de aprovação");
      },
    },
    standards: {
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
      async uploadCertificateDocument() {
        throw desktopUnsupportedAuthAction("Certificado de padrão");
      },
      async getCertificateDocumentDownloadUrl() {
        throw desktopUnsupportedAuthAction("Certificado de padrão");
      },
    },
    jobs: {
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
      async approve() {
        throw desktopUnsupportedJobAction("Aprovação de job");
      },
      async reject() {
        throw desktopUnsupportedJobAction("Rejeição de job");
      },
      async cancel() {
        throw desktopUnsupportedJobAction("Cancelamento de job");
      },
      async assign() {
        throw desktopUnsupportedJobAction("Atribuição de técnico");
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
      async getCertificateDownloadUrl() {
        throw desktopUnsupportedJobAction("Download de certificado publicado");
      },
      async generateLabel() {
        throw desktopUnsupportedJobAction("Geração de etiqueta publicada");
      },
      async getLabelDownloadUrl() {
        throw desktopUnsupportedJobAction("Download de etiqueta publicada");
      },
      async getLabelCommands() {
        throw desktopUnsupportedJobAction("Geração de comandos da etiqueta");
      },
      async amend() {
        throw desktopUnsupportedJobAction("Retificação de certificado");
      },
    },
    serviceOrders: {
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
      async saveEvaluation() {
        throw desktopUnsupportedServiceOrderAction("Avaliação técnica");
      },
      async sendQuote() {
        throw desktopUnsupportedServiceOrderAction("Emissão de orçamento");
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
      async generateIntakeDocument() {
        throw desktopUnsupportedServiceOrderAction("Geração de comprovante");
      },
      async getIntakeDocumentPdf() {
        throw desktopUnsupportedServiceOrderAction("Abertura de comprovante");
      },
      async generateTag() {
        throw desktopUnsupportedServiceOrderAction("Geração de etiqueta");
      },
      async getTagPdf() {
        throw desktopUnsupportedServiceOrderAction("Abertura de etiqueta");
      },
      async updateRepairSeal() {
        throw desktopUnsupportedServiceOrderAction("Etiqueta de Reparo");
      },
      async deliver() {
        throw desktopUnsupportedServiceOrderAction("Registro de entrega");
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
      async getDeliveryDocumentPdf() {
        throw desktopUnsupportedServiceOrderAction(
          "Abertura do comprovante de entrega",
        );
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

function desktopUnsupportedServiceOrderAction(action: string) {
  return new Error(`${action} requer a API web/nuvem neste momento.`);
}

function desktopUnsupportedJobAction(action: string) {
  return new Error(`${action} requer a API web/nuvem neste momento.`);
}

function desktopUnsupportedSignatureAction(action: string) {
  return new Error(`${action} requer sincronização com a nuvem neste momento.`);
}

function desktopUnsupportedProfileMediaAction(action: string) {
  return new Error(`${action} requer sincronização com a nuvem neste momento.`);
}

function desktopUnsupportedSigningCertificateAction(action: string) {
  return new Error(`${action} requer sincronização com a nuvem neste momento.`);
}

function desktopUnsupportedBackofficeAction(action: string) {
  return new Error(`${action} requer a API web/nuvem neste momento.`);
}

function desktopUnsupportedAuthAction(action: string) {
  return new Error(`${action} requer a API web/nuvem neste momento.`);
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
