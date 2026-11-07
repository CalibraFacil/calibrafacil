import {
  ENDPOINT_GROUPS,
  endpointPolicies,
  type DataPolicy,
} from "@calibra-facil/contracts";
import type { CalibraApi } from "./types";

export type { DataPolicy };

type MethodKeys<TNamespace> = {
  [TKey in keyof TNamespace]: TNamespace[TKey] extends (
    ...args: never[]
  ) => unknown
    ? TKey
    : never;
}[keyof TNamespace] &
  string;

export type CalibraApiPolicyRegistry = {
  readonly [TNamespace in keyof CalibraApi]: {
    readonly [TMethod in MethodKeys<CalibraApi[TNamespace]>]: DataPolicy;
  };
};

export type CalibraApiNamespace = keyof CalibraApi;

export type CalibraApiMethod<TNamespace extends CalibraApiNamespace> =
  keyof (typeof calibraApiPolicyRegistry)[TNamespace] & string;

export type CalibraApiPolicyEntry = {
  namespace: CalibraApiNamespace;
  method: string;
  policy: DataPolicy;
};

/**
 * Method names of a namespace whose registry policy matches `TPolicy`.
 * Resolved from the literal policy strings in `calibraApiPolicyRegistry`, so a
 * policy reclassification changes this type — and everything derived from it —
 * in the same edit.
 */
export type CalibraApiMethodsWithPolicy<
  TNamespace extends CalibraApiNamespace,
  TPolicy extends DataPolicy,
> = {
  [TMethod in CalibraApiMethod<TNamespace>]: (typeof calibraApiPolicyRegistry)[TNamespace][TMethod] extends TPolicy
    ? TMethod
    : never;
}[CalibraApiMethod<TNamespace>];

const desktopDataPolicyUnavailableMessages = {
  "cloud-only":
    "Esta tela depende da API da nuvem e não está disponível offline. Verifique a conexão e tente novamente.",
  "cloud-first-read-fallback":
    "Dados offline ainda não estão prontos para fallback local. Esta leitura usa a nuvem primeiro e só usa o cache local depois de uma sincronização inicial.",
  "local-first-read-through-sync":
    "O cache local ainda não está pronto para esta tela. Conecte-se à internet e sincronize antes de depender do modo offline.",
  "local-command-sync":
    "Esta ação precisa ser salva no outbox local antes de sincronizar com a nuvem. Tente novamente ou verifique o status de sincronização.",
  "local-only":
    "Este recurso depende do runtime local do desktop. Reinicie o app se o serviço local não estiver disponível.",
} as const satisfies Record<DataPolicy, string>;

/**
 * Where every client method runs on desktop. Offline scope is deliberately
 * narrow (audit decision Q13) and this registry is its single source of truth:
 *
 * - field capture: an assigned job's execution from a read-only pack of method
 *   and standards (`jobs.*` reads, `saveExecution`, `submitExecution`,
 *   attachments), saved as a draft; the cloud checks the submit on sync;
 * - intake: `serviceOrders.create` and a minimal `assets.create` stub;
 * - reference reads: customers, assets, asset types, standards, methods,
 *   environmental limits and the service orders already on the device.
 *
 * Everything else (approval, certificates, signing, finance, settings, method
 * authoring, customer edits and compliance, NC/CAPA, quality, reports, portal
 * management) is `cloud-only`. The web derives which routes work offline from
 * these entries (`apps/web/src/runtime/desktop-offline-routes.ts`).
 */
export const calibraApiPolicyRegistry = {
  // Derived from the endpoint definitions (`policy`), not listed here.
  dashboard: endpointPolicies(ENDPOINT_GROUPS.dashboard),
  units: endpointPolicies(ENDPOINT_GROUPS.units),
  access: {
    getFinanceAccess: "cloud-only",
  },
  onboarding: {
    // Derived from cloud domain state; desktop has no self-serve activation.
    getChecklist: "cloud-only",
  },
  sessions: {
    revoke: "cloud-only",
  },
  finance: endpointPolicies(ENDPOINT_GROUPS.finance),
  sso: endpointPolicies(ENDPOINT_GROUPS.sso),
  apiKeys: {
    list: "cloud-only",
    create: "cloud-only",
    rotate: "cloud-only",
    revoke: "cloud-only",
  },
  organizationLifecycle: {
    softDelete: "cloud-only",
  },
  organizationProfile: {
    update: "cloud-only",
  },
  entityLabels: endpointPolicies(ENDPOINT_GROUPS.entityLabels),
  certificateNumbering: endpointPolicies(ENDPOINT_GROUPS.certificateNumbering),
  portalDomains: endpointPolicies(ENDPOINT_GROUPS.portalDomains),
  emailDomains: {
    get: "cloud-only",
    create: "cloud-only",
    verify: "cloud-only",
    activate: "cloud-only",
    delete: "cloud-only",
  },
  notifications: {
    getUnreadCount: "cloud-only",
    listRecent: "cloud-only",
    markRead: "cloud-only",
    markAllRead: "cloud-only",
    getPreferences: "cloud-only",
    updatePreferences: "cloud-only",
  },
  signatures: endpointPolicies(ENDPOINT_GROUPS.signatures),
  profileMedia: {
    uploadAvatar: "cloud-only",
    deleteAvatar: "cloud-only",
  },
  organizationMedia: {
    uploadLogo: "cloud-only",
    deleteLogo: "cloud-only",
  },
  signingCertificates: endpointPolicies(ENDPOINT_GROUPS.signingCertificates),
  // Derived from the endpoint definitions (`policy`), not listed here.
  customers: endpointPolicies(ENDPOINT_GROUPS.customers),
  customerGroups: endpointPolicies(ENDPOINT_GROUPS.customerGroups),
  assets: endpointPolicies(ENDPOINT_GROUPS.assets),
  assetTypes: endpointPolicies(ENDPOINT_GROUPS.assetTypes),
  services: endpointPolicies(ENDPOINT_GROUPS.services),
  // Material catalog is cloud-only in v1 (see the endpoint definitions).
  materials: endpointPolicies(ENDPOINT_GROUPS.materials),
  methods: endpointPolicies(ENDPOINT_GROUPS.methods),
  standards: endpointPolicies(ENDPOINT_GROUPS.standards),
  jobs: {
    // The endpoint definitions' policies; the three methods below are not
    // endpoints of the jobs group (see `modules/jobs.ts`).
    ...endpointPolicies(ENDPOINT_GROUPS.jobs),
    listStandards: "local-first-read-through-sync",
    getEffectiveEnvironmentalLimits: "local-first-read-through-sync",
    getLabelCommands: "cloud-only",
  },
  serviceOrders: endpointPolicies(ENDPOINT_GROUPS.serviceOrders),
  sync: {
    getSession: "local-only",
    reconcile: "local-only",
    listConflicts: "local-only",
    resolveConflict: "local-only",
    listDeadEvents: "local-only",
    listBlockedEvents: "local-only",
    discardDeadEvent: "local-only",
    requeueDeadEvent: "local-only",
  },
  attachments: {
    list: "local-only",
    upload: "local-command-sync",
  },
  environmentalLimits: endpointPolicies(ENDPOINT_GROUPS.environmentalLimits),
  // #427 Phase 0: the whole namespace stays cloud-only (see the endpoint
  // definitions).
  accreditedScope: endpointPolicies(ENDPOINT_GROUPS.accreditedScope),
  reports: endpointPolicies(ENDPOINT_GROUPS.reports),
  publicSignup: endpointPolicies(ENDPOINT_GROUPS.publicSignup),
  publicInvitations: endpointPolicies(ENDPOINT_GROUPS.publicInvitations),
  labSetup: {
    get: "cloud-only",
    requestMagicLink: "cloud-only",
    requestOtp: "cloud-only",
    complete: "cloud-only",
  },
  nonConformances: endpointPolicies(ENDPOINT_GROUPS.nonConformances),
  capas: endpointPolicies(ENDPOINT_GROUPS.capas),
  proficiencyTests: endpointPolicies(ENDPOINT_GROUPS.proficiencyTests),
  spc: endpointPolicies(ENDPOINT_GROUPS.spc),
  competences: endpointPolicies(ENDPOINT_GROUPS.competences),
  trainingRecords: endpointPolicies(ENDPOINT_GROUPS.trainingRecords),
  calibrationRequests: endpointPolicies(ENDPOINT_GROUPS.calibrationRequests),
  visits: endpointPolicies(ENDPOINT_GROUPS.visits),
  integrations: {
    list: "cloud-only",
    create: "cloud-only",
    startContaAzulOAuth: "cloud-only",
    getContaAzulApp: "cloud-only",
    saveContaAzulApp: "cloud-only",
    removeContaAzulApp: "cloud-only",
    validate: "cloud-only",
    update: "cloud-only",
    updateContaAzulConfig: "cloud-only",
    listContaAzulCatalog: "cloud-only",
    pollContaAzul: "cloud-only",
    pollContaAzulFiscal: "cloud-only",
    linkContaAzulInvoicesToMdfe: "cloud-only",
    pollContaAzulPayables: "cloud-only",
    pollContaAzulProtocols: "cloud-only",
    pollContaAzulDrift: "cloud-only",
    getContaAzulSchedule: "cloud-only",
    refreshContaAzul: "cloud-only",
    disconnectContaAzul: "cloud-only",
    toggle: "cloud-only",
    previewSync: "cloud-only",
    sync: "cloud-only",
    schedule: "cloud-only",
    listRunItems: "cloud-only",
    retryRun: "cloud-only",
    listDrift: "cloud-only",
    acknowledgeDrift: "cloud-only",
  },
} as const satisfies CalibraApiPolicyRegistry;

export function getCalibraApiDataPolicy<TNamespace extends CalibraApiNamespace>(
  namespace: TNamespace,
  method: CalibraApiMethod<TNamespace>,
): DataPolicy {
  for (const [candidate, policy] of Object.entries(
    calibraApiPolicyRegistry[namespace],
  )) {
    if (candidate === method) {
      return policy;
    }
  }

  throw new Error(`Unknown Calibra API data policy: ${namespace}.${method}`);
}

export function getDesktopDataPolicyUnavailableMessage(
  policy: DataPolicy,
): string {
  return desktopDataPolicyUnavailableMessages[policy];
}

export function listCalibraApiPolicyEntries(): CalibraApiPolicyEntry[] {
  return listCalibraApiNamespaces().flatMap((namespace) => {
    const methods = calibraApiPolicyRegistry[namespace];
    return Object.entries(methods).map(([method, policy]) => ({
      namespace,
      method,
      policy,
    }));
  });
}

export function listCalibraApiNamespaces(): CalibraApiNamespace[] {
  return Object.keys(calibraApiPolicyRegistry).filter(isCalibraApiNamespace);
}

/**
 * Runtime companion of `CalibraApiMethodsWithPolicy`: the method names of a
 * namespace whose registry policy is one of `policies`, typed as keys of the
 * product API namespace so composers can index `CalibraApi` with them. The
 * registry is type-total over every `CalibraApi` method, which is what makes
 * the narrowing in the filter predicate sound.
 */
export function listCalibraApiNamespaceMethodsWithPolicy<
  TNamespace extends CalibraApiNamespace,
>(
  namespace: TNamespace,
  policies: readonly DataPolicy[],
): Array<keyof CalibraApi[TNamespace] & string> {
  const registryNamespace: Record<string, DataPolicy> =
    calibraApiPolicyRegistry[namespace];

  return Object.keys(registryNamespace).filter(
    (method): method is keyof CalibraApi[TNamespace] & string => {
      const policy = registryNamespace[method];
      return policy !== undefined && policies.includes(policy);
    },
  );
}

function isCalibraApiNamespace(value: string): value is CalibraApiNamespace {
  return value in calibraApiPolicyRegistry;
}
