import { slugify } from "@calibra-facil/shared/text";
import {
  assetEndpoints,
  customerEndpoints,
  ENDPOINT_GROUPS,
  methodEndpoints,
  standardEndpoints,
  type EndpointDef,
  type EndpointGroups,
} from "@calibra-facil/contracts";
import type {
  JobDetail,
  JobsListResponse,
  SyncStatusSnapshot,
} from "@calibra-facil/contracts";
import type {
  AssetTypesListData,
  CalibraApi,
  CertificateNumberingConfig,
  CertificateNumberingProfileResponse,
  DashboardUnitsResponse,
  EffectiveEnvironmentalLimitsResponse,
  EnvironmentalLimit,
  FinanceAccessResponse,
  LocalAttachment,
  LocalAttachmentsResponse,
  LocalDeadOutboxEvent,
  LocalBlockedOutboxEventsResponse,
  LocalDeadOutboxEventsResponse,
  LocalSessionSnapshotResponse,
  LocalSyncConflict,
  LocalSyncConflictsResponse,
  NotificationPreferencesResponse,
  EmailDomainResponse,
  PortalDomainResponse,
  SsoSettingsResponse,
  StandardsListData,
} from "../types";
import {
  getDesktopDataPolicyUnavailableMessage,
  listCalibraApiNamespaceMethodsWithPolicy,
  listCalibraApiNamespaces,
  type CalibraApiMethodsWithPolicy,
  type CalibraApiNamespace,
  type DataPolicy,
} from "../data-policy";
import {
  createDesktopEndpointTransport,
  endpointClient,
} from "./endpoint-client";
import { createServiceOrdersApi } from "../modules/service-orders";
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

/**
 * The same throw-stubs for a domain converted to endpoint definitions: the
 * `cloud-only` endpoints of its group, labelled by each definition's
 * `desktopLabel`. Local-first methods are not stubbed here: the caller supplies
 * them (typically the group's own client over the desktop transport).
 */
function desktopEndpointStubs<
  TNamespace extends keyof EndpointGroups & CalibraApiNamespace,
>(
  namespace: TNamespace,
): Pick<
  CalibraApi[TNamespace],
  CalibraApiMethodsWithPolicy<TNamespace, "cloud-only"> &
    keyof CalibraApi[TNamespace]
> {
  const stubs: Record<string, () => Promise<never>> = {};
  for (const [method, entry] of Object.entries(ENDPOINT_GROUPS[namespace])) {
    const def: EndpointDef = entry;
    if (def.policy !== "cloud-only") continue;
    const flavor = def.desktopFlavor ?? "web-api";
    stubs[method] = async () => {
      throw desktopUnsupportedError(def.desktopLabel, flavor);
    };
  }

  // oxlint-disable-next-line typescript/consistent-type-assertions -- the stub keys are exactly the cloud-only entries of the group, which is what the registry (derived from the same group) classifies as cloud-only; the single trust point tying the runtime object to the Pick above.
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
  const desktopTransport = createDesktopEndpointTransport(options);
  const localServiceOrders = createServiceOrdersApi(desktopTransport, options);
  const localAssets = endpointClient(assetEndpoints, desktopTransport, options);
  const localMethods = endpointClient(
    methodEndpoints,
    desktopTransport,
    options,
  );
  const localStandards = endpointClient(
    standardEndpoints,
    desktopTransport,
    options,
  );
  const localCustomers = endpointClient(
    customerEndpoints,
    desktopTransport,
    options,
  );
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
    dashboard: desktopEndpointStubs("dashboard"),
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
      async getFinanceAccess() {
        return desktopFinanceAccess();
      },
    },
    // Self-serve activation is a cloud concern: a desktop install is reached by
    // a laboratory that already has an account.
    onboarding: desktopCloudOnlyStubs("onboarding", {
      action: "Configuração inicial",
    }),
    sessions: desktopCloudOnlyStubs("sessions", {
      action: "Gerenciamento de sessoes",
    }),
    finance: desktopEndpointStubs("finance"),
    sso: {
      ...desktopEndpointStubs("sso"),
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
    organizationLifecycle: desktopCloudOnlyStubs("organizationLifecycle", {
      action: "Exclusão da organização",
    }),
    organizationProfile: desktopCloudOnlyStubs("organizationProfile", {
      action: "Perfil do laboratório",
    }),
    entityLabels: {
      ...desktopEndpointStubs("entityLabels"),
      // No record labels offline: the links render without one.
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
      ...desktopEndpointStubs("certificateNumbering"),
      // The desktop shows the default profile; it never reads or writes the real one.
      async getProfile() {
        return desktopCertificateNumberingProfile();
      },
    },
    portalDomains: {
      ...desktopEndpointStubs("portalDomains"),
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
      ...desktopEndpointStubs("signatures"),
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
      ...desktopEndpointStubs("signingCertificates"),
      async list() {
        return {
          certificates: [],
          unit: { unitId: null, unitName: null },
          requireSignature: false,
          unsignedIssuance: { enabled: false, reason: null },
        };
      },
    },
    customers: {
      ...desktopEndpointStubs("customers"),
      // Read-through from the local mirror: the local server answers the
      // definitions' own response schemas (`apps/local-server/src/contract.test.ts`).
      list: localCustomers.list,
      get: localCustomers.get,
    },
    assets: {
      ...desktopEndpointStubs("assets"),
      // Read-through from the local mirror, and the offline intake stub: the
      // local server answers the definitions' own response schemas
      // (`apps/local-server/src/contract.test.ts`).
      list: localAssets.list,
      create: localAssets.create,
      get: localAssets.get,
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
      ...desktopEndpointStubs("environmentalLimits"),
      // The limits of the active unit come from the session snapshot, not
      // from a local-server route.
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
    accreditedScope: desktopEndpointStubs("accreditedScope"),
    reports: desktopEndpointStubs("reports"),
    publicInvitations: desktopCloudOnlyStubs("publicInvitations", {
      action: "Convites",
    }),
    // Opening an account happens on the cloud, before any desktop shell exists.
    publicSignup: desktopCloudOnlyStubs("publicSignup", {
      action: "Cadastro de laboratório",
    }),
    labSetup: desktopCloudOnlyStubs("labSetup", {
      action: "Configuração de acesso",
    }),
    nonConformances: desktopEndpointStubs("nonConformances"),
    capas: desktopEndpointStubs("capas"),
    proficiencyTests: desktopEndpointStubs("proficiencyTests"),
    spc: desktopEndpointStubs("spc"),
    competences: desktopEndpointStubs("competences"),
    trainingRecords: desktopEndpointStubs("trainingRecords"),
    calibrationRequests: desktopEndpointStubs("calibrationRequests"),
    visits: desktopEndpointStubs("visits"),
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
      ...desktopEndpointStubs("materials"),
      async list() {
        return {
          data: [],
          pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
        };
      },
    },
    services: desktopEndpointStubs("services"),
    methods: {
      ...desktopEndpointStubs("methods"),
      // Read-through from the local mirror: the local server answers the
      // definitions' own response schemas (`apps/local-server/src/contract.test.ts`).
      list: localMethods.list,
      get: localMethods.get,
    },
    standards: {
      ...desktopEndpointStubs("standards"),
      // Read-through from the local mirror: the local server answers the
      // definitions' own response schemas (`apps/local-server/src/contract.test.ts`).
      list: localStandards.list,
      get: localStandards.get,
      listCompositionProfiles: localStandards.listCompositionProfiles,
    },
    jobs: {
      ...desktopCloudOnlyStubs("jobs", {
        action: "Jobs de calibração",
        actionByMethod: {
          approve: "Aprovação de job",
          reject: "Rejeição de job",
          retryRender: "Reemissão de certificado",
          cancel: "Cancelamento de job",
          assign: "Atribuição de técnico",
          getCertificateDownloadUrl: "Download de certificado publicado",
          generateLabel: "Geração de etiqueta publicada",
          getLabelDownloadUrl: "Download de etiqueta publicada",
          getLabelCommands: "Geração de comandos da etiqueta",
          amend: "Retificação de certificado",
          withdrawCertificate: "Retirada de certificado",
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

        return readDesktopJson<JobsListResponse>(response);
      },
      async get(jobId: string | number) {
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

        return readDesktopJson<JobDetail>(response);
      },
      async listStandards() {
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

        return readDesktopJson<StandardsListData>(response);
      },
      async getEffectiveEnvironmentalLimits(
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

        return readDesktopJson<EffectiveEnvironmentalLimitsResponse>(response);
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
    },
    serviceOrders: {
      ...desktopEndpointStubs("serviceOrders"),
      // The offline reads and the intake command go to the local server, which
      // answers the definitions' own response schemas
      // (`apps/local-server/src/contract.test.ts`).
      list: localServiceOrders.list,
      get: localServiceOrders.get,
      /**
       * Desktop resolves the route id against the local store. The local id is
       * already opaque, so an offline-created OS — which has no cloud publicId
       * until it syncs — stays reachable by the same URL shape.
       */
      getByPublicId: ({ params }) =>
        localServiceOrders.get({ params: { id: params.publicId } }),
      create: localServiceOrders.create,
    },
    sync: {
      async getSession() {
        return getLocalSessionSnapshot();
      },
      async reconcile() {
        // Push-then-pull, awaited and unthrottled — the caller is holding a
        // just-succeeded cloud command and needs the local cache to catch up
        // before the next read. Deliberately does not throw: the command
        // already happened, and surfacing a sync failure as an action failure
        // would be a lie.
        try {
          const response = await fetchImpl(
            new URL("/api/local/sync/push", options.baseUrl),
            {
              method: "POST",
              credentials: "include",
              headers: await createDesktopHeaders(options.tokenProvider),
            },
          );

          if (!response.ok) {
            return {
              reconciled: false,
              reason: `local-sync-http-${response.status}`,
            };
          }

          return { reconciled: true };
        } catch (error) {
          return {
            reconciled: false,
            reason:
              error instanceof Error ? error.message : "local-sync-failed",
          };
        }
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
      async resolveConflict(id, status = "resolved", reason) {
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
            body: JSON.stringify({ status, ...(reason ? { reason } : {}) }),
          },
        );

        if (response.status === 422) {
          // The desktop asks for the reason (readings are being discarded): say so.
          const answer: unknown = await response.json().catch(() => null);
          const message =
            answer !== null &&
            typeof answer === "object" &&
            "error" in answer &&
            typeof answer.error === "string"
              ? answer.error
              : null;
          throw new Error(
            message ?? "Informe o motivo para descartar esta alteração.",
          );
        }

        if (!response.ok) {
          throw new Error("Falha ao resolver conflito de sincronização");
        }

        return readDesktopJson<{ data: LocalSyncConflict }>(response);
      },
      async listDeadEvents() {
        const response = await fetchImpl(
          new URL("/api/local/sync/dead-events", options.baseUrl),
          {
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider),
          },
        );

        if (!response.ok) {
          throw new Error("Falha ao carregar eventos recusados");
        }

        return readDesktopJson<LocalDeadOutboxEventsResponse>(response);
      },
      async listBlockedEvents() {
        const response = await fetchImpl(
          new URL("/api/local/sync/blocked-events", options.baseUrl),
          {
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider),
          },
        );

        if (!response.ok) {
          throw new Error("Falha ao carregar alterações aguardando envio");
        }

        return readDesktopJson<LocalBlockedOutboxEventsResponse>(response);
      },
      async discardDeadEvent(eventId, reason) {
        const response = await fetchImpl(
          new URL(
            `/api/local/sync/dead-events/${encodeURIComponent(eventId)}/discard`,
            options.baseUrl,
          ),
          {
            method: "POST",
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider, {
              "Content-Type": "application/json",
            }),
            body: JSON.stringify(reason ? { reason } : {}),
          },
        );

        if (!response.ok) {
          throw new Error("Falha ao descartar o evento recusado");
        }

        return readDesktopJson<{
          data: LocalDeadOutboxEvent;
          syncStatus: SyncStatusSnapshot;
        }>(response);
      },
      async requeueDeadEvent(eventId) {
        const response = await fetchImpl(
          new URL(
            `/api/local/sync/dead-events/${encodeURIComponent(eventId)}/requeue`,
            options.baseUrl,
          ),
          {
            method: "POST",
            credentials: "include",
            headers: await createDesktopHeaders(options.tokenProvider),
          },
        );

        if (!response.ok) {
          throw new Error("Falha ao reenviar o evento recusado");
        }

        return readDesktopJson<{
          data: { eventId: string };
          syncStatus: SyncStatusSnapshot;
        }>(response);
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

function withDesktopLocalFirstReadThroughSync<TNamespace extends object>(
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
  return slugify(name) || `unit-${id}`;
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

function desktopFinanceAccess(): FinanceAccessResponse {
  return {
    canReadFinancial: false,
    canManageFinancial: false,
    canExportFinancial: false,
    role: "desktop",
  };
}

function desktopSsoSettings(): SsoSettingsResponse {
  return {
    provider: null,
    access: {
      role: "desktop",
      canCreate: false,
      canManage: false,
      canDelete: false,
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
