import type { CalibraApi } from "./types";

export type DataPolicy =
  | "cloud-only"
  | "cloud-first-read-fallback"
  | "local-first-read-through-sync"
  | "local-command-sync"
  | "local-only";

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

export const desktopDataPolicyUnavailableMessages = {
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

export const calibraApiPolicyRegistry = {
  dashboard: {
    getStats: "local-first-read-through-sync",
  },
  units: {
    getDashboardUnits: "cloud-only",
    listAdminUnits: "cloud-only",
    listAdminMembers: "cloud-only",
    listAdminActivity: "cloud-only",
    createAdminUnit: "cloud-only",
    updateAdminUnit: "cloud-only",
    updateMemberAssignments: "cloud-only",
    updateMemberRole: "cloud-only",
  },
  access: {
    getPlanAccess: "cloud-only",
    getFinanceAccess: "cloud-only",
  },
  sessions: {
    revoke: "cloud-only",
  },
  finance: {
    getOverview: "cloud-only",
    listDocuments: "cloud-only",
    getDocument: "cloud-only",
    updateDocument: "cloud-only",
    issueDocument: "cloud-only",
    voidDocument: "cloud-only",
    listEligibleJobs: "cloud-only",
    createDocument: "cloud-only",
    listContracts: "cloud-only",
    getContract: "cloud-only",
    createContract: "cloud-only",
    activateContract: "cloud-only",
    cancelContract: "cloud-only",
    listReceipts: "cloud-only",
    receiveInstallment: "cloud-only",
    listErpExports: "cloud-only",
    exportErpDocument: "cloud-only",
  },
  billing: {
    getSubscription: "cloud-only",
    listPayments: "cloud-only",
  },
  backoffice: {
    getAccess: "cloud-only",
    bootstrap: "cloud-only",
    listOrganizations: "cloud-only",
    getOrganization: "cloud-only",
    getSupportQueue: "cloud-only",
    listUsers: "cloud-only",
    updateUserRole: "cloud-only",
    banUser: "cloud-only",
    unbanUser: "cloud-only",
    impersonateUser: "cloud-only",
    createUser: "cloud-only",
    requestUserPasswordReset: "cloud-only",
    stopImpersonation: "cloud-only",
  },
  sso: {
    start: "cloud-only",
    getProviders: "cloud-only",
    createProvider: "cloud-only",
    requestDomainVerification: "cloud-only",
    verifyDomain: "cloud-only",
    deleteProvider: "cloud-only",
  },
  apiKeys: {
    list: "cloud-only",
    create: "cloud-only",
    rotate: "cloud-only",
    revoke: "cloud-only",
  },
  entityLabels: {
    getNonConformance: "cloud-only",
    getCapa: "cloud-only",
    getCompetence: "cloud-only",
  },
  certificateNumbering: {
    getProfile: "cloud-only",
    updateProfile: "cloud-only",
  },
  portalDomains: {
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
  signatures: {
    getMine: "cloud-only",
    uploadMine: "cloud-only",
    deleteMine: "cloud-only",
  },
  profileMedia: {
    uploadAvatar: "cloud-only",
    deleteAvatar: "cloud-only",
  },
  organizationMedia: {
    uploadLogo: "cloud-only",
    deleteLogo: "cloud-only",
  },
  signingCertificates: {
    list: "cloud-only",
    upload: "cloud-only",
    setDefault: "cloud-only",
    revoke: "cloud-only",
  },
  customers: {
    list: "local-first-read-through-sync",
    create: "local-command-sync",
    get: "local-first-read-through-sync",
    update: "local-command-sync",
    auditLog: "cloud-only",
    updateCompliance: "cloud-only",
    listMembers: "cloud-only",
    listInvitations: "cloud-only",
    createInvitation: "cloud-only",
    resendInvitation: "cloud-only",
    cancelInvitation: "cloud-only",
    removeMember: "cloud-only",
  },
  assets: {
    list: "local-first-read-through-sync",
    create: "local-command-sync",
    get: "local-first-read-through-sync",
    update: "local-command-sync",
    auditLog: "cloud-only",
  },
  assetTypes: {
    list: "local-first-read-through-sync",
  },
  services: {
    list: "local-first-read-through-sync",
    get: "local-first-read-through-sync",
    auditLog: "cloud-only",
    create: "cloud-only",
    update: "cloud-only",
    deactivate: "cloud-only",
  },
  methods: {
    list: "local-first-read-through-sync",
    get: "local-first-read-through-sync",
    audit: "cloud-only",
    create: "cloud-only",
    update: "cloud-only",
    archive: "cloud-only",
    createNewVersion: "cloud-only",
    technicalReview: "cloud-only",
    qualityApprove: "cloud-only",
    returnToDraft: "cloud-only",
    compileDraft: "cloud-only",
    previewDraft: "cloud-only",
    publishDraft: "cloud-only",
    requestApproval: "cloud-only",
  },
  standards: {
    list: "local-first-read-through-sync",
    get: "local-first-read-through-sync",
    auditLog: "cloud-only",
    create: "cloud-only",
    update: "cloud-only",
    delete: "cloud-only",
    renew: "cloud-only",
  },
  jobs: {
    list: "local-first-read-through-sync",
    create: "cloud-only",
    get: "local-first-read-through-sync",
    listTechnicians: "cloud-only",
    approve: "cloud-only",
    reject: "cloud-only",
    cancel: "cloud-only",
    assign: "cloud-only",
    listStandards: "local-first-read-through-sync",
    getEffectiveEnvironmentalLimits: "local-first-read-through-sync",
    saveExecution: "local-command-sync",
    submitExecution: "local-command-sync",
    createCertificateDraft: "local-only",
    getCertificateDownloadUrl: "cloud-only",
    generateLabel: "cloud-only",
    getLabelDownloadUrl: "cloud-only",
    amend: "cloud-only",
  },
  serviceOrders: {
    list: "local-first-read-through-sync",
    get: "local-first-read-through-sync",
    create: "local-command-sync",
    createQuote: "local-command-sync",
    saveEvaluation: "cloud-only",
    sendQuote: "cloud-only",
    saveExecution: "local-command-sync",
    generateIntakeDocument: "cloud-only",
    getIntakeDocumentPdf: "cloud-only",
    generateTag: "cloud-only",
    getTagPdf: "cloud-only",
    updateRepairSeal: "cloud-only",
    deliver: "cloud-only",
    issueDeliveryDocument: "local-command-sync",
    getDeliveryDocumentPdf: "cloud-only",
  },
  sync: {
    getSession: "local-only",
    listConflicts: "local-only",
    resolveConflict: "local-only",
  },
  attachments: {
    list: "local-only",
    upload: "local-command-sync",
  },
  environmentalLimits: {
    list: "local-first-read-through-sync",
    save: "cloud-only",
    delete: "cloud-only",
  },
  reports: {
    getExecutiveOverview: "cloud-only",
    getComparison: "cloud-only",
    getTrend: "cloud-only",
  },
  publicCheckout: {
    getSnapshot: "cloud-only",
    getStatus: "cloud-only",
    start: "cloud-only",
  },
  nonConformances: {
    list: "cloud-only",
    summary: "cloud-only",
    get: "cloud-only",
    auditLog: "cloud-only",
    create: "cloud-only",
    setDisposition: "cloud-only",
    resolve: "cloud-only",
    escalateToCapa: "cloud-only",
  },
  capas: {
    list: "cloud-only",
    summary: "cloud-only",
    get: "cloud-only",
    auditLog: "cloud-only",
    create: "cloud-only",
    update: "cloud-only",
    implement: "cloud-only",
    verify: "cloud-only",
    close: "cloud-only",
  },
  certificateTemplates: {
    list: "cloud-only",
    create: "cloud-only",
    update: "cloud-only",
    duplicate: "cloud-only",
    setDefault: "cloud-only",
    getXlsxVersion: "cloud-only",
    uploadXlsx: "cloud-only",
    validateXlsx: "cloud-only",
    updateXlsxBindings: "cloud-only",
    createXlsxPreview: "cloud-only",
    getXlsxPreview: "cloud-only",
    publishXlsx: "cloud-only",
    createXlsxAssignment: "cloud-only",
  },
  competences: {
    list: "cloud-only",
    matrix: "cloud-only",
    get: "cloud-only",
    auditLog: "cloud-only",
    create: "cloud-only",
    transition: "cloud-only",
    evaluate: "cloud-only",
    renew: "cloud-only",
    cancel: "cloud-only",
    delete: "cloud-only",
    assignTraining: "cloud-only",
  },
  trainingRecords: {
    list: "cloud-only",
    create: "cloud-only",
  },
  customerSuccess: {
    getProfile: "cloud-only",
    listRequests: "cloud-only",
    createRequest: "cloud-only",
  },
  calibrationRequests: {
    list: "cloud-only",
    get: "cloud-only",
    review: "cloud-only",
    approve: "cloud-only",
    reject: "cloud-only",
    convert: "cloud-only",
  },
  integrations: {
    list: "cloud-only",
    create: "cloud-only",
    validate: "cloud-only",
    update: "cloud-only",
    toggle: "cloud-only",
    previewSync: "cloud-only",
    sync: "cloud-only",
    schedule: "cloud-only",
    retryRun: "cloud-only",
  },
} as const satisfies CalibraApiPolicyRegistry;

export function getCalibraApiDataPolicy<TNamespace extends CalibraApiNamespace>(
  namespace: TNamespace,
  method: CalibraApiMethod<TNamespace>,
): DataPolicy {
  const policies = calibraApiPolicyRegistry[namespace] as Record<
    CalibraApiMethod<TNamespace>,
    DataPolicy
  >;

  return policies[method];
}

export function getDesktopDataPolicyUnavailableMessage(
  policy: DataPolicy,
): string {
  return desktopDataPolicyUnavailableMessages[policy];
}

export function listCalibraApiPolicyEntries(): CalibraApiPolicyEntry[] {
  return Object.entries(calibraApiPolicyRegistry).flatMap(
    ([namespace, methods]) =>
      Object.entries(methods).map(([method, policy]) => ({
        namespace: namespace as CalibraApiNamespace,
        method,
        policy,
      })),
  );
}
