import type {
  AccreditedScopeResponse,
  CertificateNumberingProfileResponse,
  EnvironmentalLimitsResponse,
} from '@calibra-facil/client-runtime'
import type {
  FinancialErpConnectionConfig,
  IntegrationDependencyWarning,
  IntegrationMappedPreviewSample,
  IntegrationReadinessSummary,
  IntegrationRemoteDocumentSummary,
  IntegrationStatus,
  IntegrationSyncItemStatus,
  IntegrationSyncStatus,
  IntegrationTargetCoverageSummary,
  IntegrationTargetSyncSummary,
} from '@calibra-facil/shared'
import type { UnitAssignmentRole } from '@calibra-facil/contracts'


export type SettingsCertificateNumberingData =
  CertificateNumberingProfileResponse


export type SettingsEnvironmentalLimitsData = EnvironmentalLimitsResponse

export type SettingsAccreditedScopeData = AccreditedScopeResponse

export type OrganizationMember = {
  id: string
  userId: string
  role: string
  createdAt: Date
  user: {
    id: string
    name: string
    email: string
    image?: string
  }
}

export type OrganizationInvitation = {
  id: string
  email: string
  role: string
  status: string
  expiresAt: Date
  inviterId: string
}

// The unit governance DTOs are the endpoint definitions' types
// (`@calibra-facil/contracts`, `endpoints/units.ts`).
export type {
  GovernanceActivityEntry,
  GovernanceMember,
  GovernanceViewer,
  OrganizationUnit,
  UnitAssignmentRole,
} from '@calibra-facil/contracts'

export type EditableUnitAssignmentRole = UnitAssignmentRole | 'none'

export type SyncTarget =
  | 'catalog_item'
  | 'contract'
  | 'customer'
  | 'supplier'
  | 'transporter'
  | 'service_order'
  | 'billing_document'
  | 'payable'

export type IntegrationRun = {
  id: string
  target: SyncTarget
  trigger: 'manual' | 'event' | 'scheduled' | 'retry'
  status: IntegrationSyncStatus
  processedCount: number
  successCount: number
  errorCount: number
  errorSummary: string | null
  createdAt: string
  startedAt?: string | null
  finishedAt?: string | null
  summary?: {
    requestedLimit?: number
    blocked?: boolean
    retryOfRunId?: string | null
  } | null
}

type IntegrationSyncItem = {
  id: string
  runId: string
  target: SyncTarget
  localEntityId: string
  remoteEntityId: string | null
  operation:
    | 'create'
    | 'update'
    | 'upsert'
    | 'poll'
    | 'reconcile'
    | 'link'
    | 'validate'
    | 'delete'
  status: IntegrationSyncItemStatus
  attemptCount: number
  lastErrorCode: string | null
  lastErrorMessage: string | null
  createdAt: string
  updatedAt: string
}

export type IntegrationRunItemsResponse = {
  runId: string
  target: SyncTarget
  data: IntegrationSyncItem[]
  summary: {
    returnedCount: number
    statusCounts: Record<string, number>
  }
}

type IntegrationEvent = {
  id: number
  level: 'info' | 'warning' | 'error'
  event: string
  message: string
  createdAt: string
}

type IntegrationOverview = {
  readiness: IntegrationReadinessSummary
  targets: IntegrationTargetSyncSummary[]
  remoteDocuments: IntegrationRemoteDocumentSummary
  syncSummary: {
    lastRunAt: string | null
    lastSuccessfulRunAt: string | null
    lastErrorAt: string | null
    hasRecentFailures: boolean
  }
}

export type IntegrationSummary = {
  id: string
  type: 'financial_erp'
  provider: 'generic_http' | 'conta_azul'
  name: string
  status: IntegrationStatus
  lastValidatedAt: string | null
  lastValidationError: string | null
  createdAt: string
  updatedAt: string
  connection: {
    id: string | null
    credentialType: 'bearer' | 'oauth2'
    config: FinancialErpConnectionConfig | null
  }
  recentRuns: IntegrationRun[]
  recentEvents: IntegrationEvent[]
  overview: IntegrationOverview
}

export type ContaAzulCatalogItem = {
  id: string
  name: string
  code: string | null
  active: boolean | null
  type: string | null
}

export type ContaAzulCatalogResponse = {
  domain?: string
  items: ContaAzulCatalogItem[]
  nextCursor?: string | null
}

export type ContaAzulOAuthStartResponse = {
  authorizationUrl: string
  expiresInSeconds: number
}

/**
 * The Conta Azul application a laboratory connects through: its own (saved in
 * settings), the one its server supplies, or none yet.
 */
export type ContaAzulAppSummary = {
  source: 'organization' | 'server' | null
  clientId: string | null
  clientSecretLast4: string | null
  redirectUri: string
  updatedAt: string | null
}

export type ContaAzulAppSaveResponse = {
  app: ContaAzulAppSummary
  check: 'accepted' | 'unverified'
}

export type ContaAzulScheduleRow = {
  enabled: boolean
  lastSuccessAt: string | null
  lastErrorAt: string | null
  lastErrorMessage: string | null
  nextDueAt: string | null
  intervalMinutes: number
}

export type ContaAzulScheduleResponse = {
  paymentStatusPolling: ContaAzulScheduleRow
  payables: ContaAzulScheduleRow
  fiscalDocuments: ContaAzulScheduleRow
  protocols: ContaAzulScheduleRow
  driftChecks: ContaAzulScheduleRow
}

export type SettingsIntegrationsData = {
  data: IntegrationSummary[]
}

export type SyncPreviewResponse = {
  target: SyncTarget
  requestedLimit: number
  blocked: boolean
  warnings: IntegrationDependencyWarning[]
  coverage: IntegrationTargetCoverageSummary
  previewCount: number
  sampleRecords: IntegrationMappedPreviewSample[]
}
