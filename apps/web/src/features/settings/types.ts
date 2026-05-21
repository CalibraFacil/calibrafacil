import type {
  ApiKeysListResponse,
  BillingPaymentsResponse,
  BillingSubscriptionResponse,
  CertificateNumberingProfileResponse,
  EnvironmentalLimitsResponse,
  MySignatureResponse,
  NotificationPreferencesResponse,
  PortalDomainResponse,
  SigningCertificatesListResponse,
  SsoSettingsResponse,
} from '@calibra-facil/client-runtime'
import type {
  IntegrationDependencyWarning,
  IntegrationMappedPreviewSample,
  IntegrationMappingsConfig,
  IntegrationReadinessSummary,
  IntegrationTargetCoverageSummary,
  IntegrationTargetSyncSummary,
} from '@calibra-facil/shared'

export type ApiKeysData = ApiKeysListResponse

export type SettingsSsoData = SsoSettingsResponse

export type SettingsCertificateNumberingData =
  CertificateNumberingProfileResponse

export type SettingsSigningCertificatesData = SigningCertificatesListResponse

export type SettingsSignatureData = MySignatureResponse

export type SettingsPortalDomainData = PortalDomainResponse

export type SettingsEnvironmentalLimitsData = EnvironmentalLimitsResponse

export type SettingsBillingSubscriptionData = BillingSubscriptionResponse

export type SettingsBillingPaymentsData = BillingPaymentsResponse

export type SettingsNotificationPreferencesData =
  NotificationPreferencesResponse

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

export type OrganizationUnit = {
  id: number
  name: string
  slug: string
  status: 'ACTIVE' | 'ARCHIVED'
  isDefault: boolean
  createdAt: string
  archivedAt: string | null
}

export type UnitAssignmentRole = 'member' | 'technician' | 'unit_admin'

export type EditableUnitAssignmentRole = UnitAssignmentRole | 'none'

export type GovernanceViewer = {
  isGlobalManager: boolean
  canManageOrganizationUnits: boolean
  canManageAssignments: boolean
  canManageGlobalRoles: boolean
  canViewGovernance: boolean
  canAccessConsolidatedView: boolean
  managedUnitIds: number[]
}

export type GovernanceAssignment = {
  unitId: number
  unitName: string
  role: UnitAssignmentRole
}

export type GovernanceMember = {
  id: string
  userId: string
  role: string
  name: string
  email: string
  createdAt: string
  assignments: GovernanceAssignment[]
}

export type UnitContextResponse = {
  activeUnitId: number | null
  activeUnitName: string | null
  selectedUnitScope: 'all' | 'unit'
  canAccessAllUnits: boolean
  viewer: GovernanceViewer
  scopeSummary: {
    isConsolidated: boolean
    activeUnitId: number | null
    activeUnitName: string | null
    accessibleUnitsCount: number
    managedUnitsCount: number
    effectiveRole: string
    effectiveRoleLabel: string
    label: string
    description: string
  }
  data: Array<{
    id: number
    name: string
    slug: string
    role: string
  }>
}

export type GovernanceActivityEntry = {
  id: number
  action: string
  entityType: string
  entityId: string | null
  createdAt: string
  details?: Record<string, unknown> | null
  unit: {
    id: number
    name: string
  } | null
  actorUser: {
    id: string
    name: string
    email: string | null
  } | null
}

export type OrganizationUnitsData = {
  data: OrganizationUnit[]
  viewer: GovernanceViewer
}

export type OrganizationGovernanceMembersData = {
  data: GovernanceMember[]
  viewer: GovernanceViewer
}

export type OrganizationGovernanceActivityData = {
  data: GovernanceActivityEntry[]
  viewer: GovernanceViewer
}

export type SyncTarget = 'customer' | 'service_order' | 'billing_document'

export type IntegrationConfig = {
  baseUrl: string
  healthPath: string
  customerPath: string
  serviceOrderPath: string
  billingDocumentPath: string
  authType: 'bearer'
  mappings: IntegrationMappingsConfig
}

export type IntegrationRun = {
  id: string
  target: SyncTarget
  trigger: 'manual' | 'event' | 'scheduled' | 'retry'
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'PARTIAL'
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

export type IntegrationEvent = {
  id: number
  level: 'info' | 'warning' | 'error'
  event: string
  message: string
  createdAt: string
}

export type IntegrationOverview = {
  readiness: IntegrationReadinessSummary
  targets: IntegrationTargetSyncSummary[]
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
  provider: 'generic_http'
  name: string
  status: 'ACTIVE' | 'DISABLED'
  lastValidatedAt: string | null
  lastValidationError: string | null
  createdAt: string
  updatedAt: string
  connection: {
    id: string | null
    credentialType: 'bearer'
    config: IntegrationConfig | null
  }
  recentRuns: IntegrationRun[]
  recentEvents: IntegrationEvent[]
  overview: IntegrationOverview
}

export type SettingsIntegrationsData = {
  billing: {
    planId: string
    planName: string
    status: string
    hasCustomIntegrations: boolean
  }
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
