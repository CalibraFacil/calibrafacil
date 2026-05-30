export type BackofficeAccessData = {
  allowed: boolean
  bootstrapAvailable?: boolean
}

export type BackofficeOrganizationRow = {
  id: string
  name: string
  slug: string
  onboardingStatus: string | null
  migrationStatus: string | null
  unitsCount: number
  integrationsCount: number
  openRequestsCount: number
}

export type BackofficeOrganizationsData = {
  data: BackofficeOrganizationRow[]
}

export type BackofficeOrganizationOption = {
  id: string
  name: string
  slug: string
}

export type BackofficeOrganizationOptionsData = {
  data: BackofficeOrganizationOption[]
}

export type BackofficeOrganizationDetail = {
  organization: {
    id: string
    name: string
    slug: string
    cnpj: string | null
    status?: string | null
    suspendedAt?: string | null
    suspensionReason?: string | null
    deletionScheduledAt?: string | null
  }
  plan: { planName: string; status: string }
  successProfile: {
    onboardingStatus?: string | null
    migrationStatus?: string | null
    accountOwnerName?: string | null
    supportContactEmail?: string | null
  } | null
  support: { open: number; total: number }
  integrations: Array<{ id: number; name: string; status: string }>
  units: Array<{ id: number; name: string; slug: string; status: string }>
}

export type BackofficeSupportQueueItem = {
  id: number
  subject: string
  category: string
  priority: string
  status: string
  organization: { name: string; slug: string } | null
  requestedByUser: { name: string; email: string } | null
  assignedToUser: { name: string; email: string } | null
  createdAt: string
}

export type BackofficeSupportQueueData = {
  data: BackofficeSupportQueueItem[]
}

export type BackofficeUserMembership = {
  organizationId: string
  organizationName: string
  organizationSlug: string
  memberRole: string
}

export type BackofficeUser = {
  id: string
  name: string
  email: string
  role?: string | null
  banned?: boolean | null
  createdAt?: string | Date | null
  memberships: BackofficeUserMembership[]
}

export type BackofficeUserFilters = {
  search: string
  organizationId: string
  platformRole:
    | 'all'
    | 'user'
    | 'platform_operator'
    | 'platform_admin'
    | 'platform_access'
  membershipScope:
    | 'all'
    | 'lab_members'
    | 'no_lab_membership'
    | 'backoffice_only'
}

export type BackofficeUsersData = {
  users: BackofficeUser[]
  total: number
}

export type AssignablePlatformRole =
  | 'user'
  | 'platform_operator'
  | 'platform_admin'

export type BackofficeCommercialOrganization = {
  id: string
  name: string
  slug: string
  cnpj: string | null
}

export type BackofficeCommercialOrganizationsData = {
  data: BackofficeCommercialOrganization[]
}

export type BackofficeCommercialContext = {
  organization: {
    id: string
    name: string
    cnpj: string | null
    email: string | null
    phone: string | null
  }
  subscription: {
    planId: string
    status: string
    billingCycle: string | null
  } | null
  billingCustomer: {
    id: number
    name: string
    email: string | null
    phone: string | null
  } | null
  billingContacts: Array<{
    id: number
    name: string
    email: string
    isPrimary: boolean
  }>
  recentOffers: Array<{
    id: string
    kind: string
    status: string
    totalAmount: number
    issuedAt?: string | null
    offerExpiresAt?: string | null
    paidAt?: string | null
    customerCheckoutUrl?: string | null
  }>
  deals: Array<{ id: string; title: string; status: string }>
}

export type BackofficeAuditActor = {
  id: string
  name: string
  email: string
}

export type BackofficeAuditLogEntry = {
  id: number
  action: string
  entityType: string
  entityId: string | null
  details: Record<string, unknown> | null
  createdAt: string
  actorUser: BackofficeAuditActor | null
  targetUser: BackofficeAuditActor | null
}

export type BackofficeAuditLogData = {
  data: BackofficeAuditLogEntry[]
  nextCursor: number | null
}

export type BackofficeAuditLogFilters = {
  search?: string
  entityType?: string
  action?: string
  actorUserId?: string
  limit?: number
}

export type BackofficeIntegrationProviderHealth = {
  provider: string
  total: number
  active: number
  actionRequired: number
  disabled: number
}

export type BackofficeIntegrationAffected = {
  organizationId: string
  organizationName: string
  provider: string
  name: string
  status: string
  lastValidatedAt: string | null
  lastValidationError: string | null
}

export type BackofficeIntegrationHealthData = {
  providers: BackofficeIntegrationProviderHealth[]
  affected: BackofficeIntegrationAffected[]
}

export type BackofficeVitalsData = {
  subscriptions: {
    total: number
    active: number
    trialing: number
    pastDue: number
    canceled: number
    renewalsDue30d: number
    byStatus: Record<string, number>
    byPlan: Record<string, number>
  }
  queue: {
    pending: number
    processing: number
    failed: number
    completed: number
    stuck: number
  }
}

export type BackofficeAccountTask = {
  id: number
  organizationId: string
  organizationName: string
  title: string
  type: string
  status: string
  ownerUserId: string | null
  ownerName: string | null
  dueAt: string | null
  notes: string | null
  completedAt: string | null
  createdAt: string
}

export type BackofficeAccountTasksData = {
  data: BackofficeAccountTask[]
}

export type BackofficeAccountTaskFilters = {
  organizationId?: string
  scope?: 'mine' | 'all'
  status?: 'open' | 'done' | 'all'
}

export type BackofficeEntitlementOverride = {
  id: number
  feature: string
  reason: string | null
  expiresAt: string | null
  createdAt: string
  createdByName: string | null
}

export type BackofficeEntitlementOverridesData = {
  data: BackofficeEntitlementOverride[]
}

export type BackofficeActivitySection = {
  lastAt: string | null
  total: number
  last30d: number
}

export type BackofficeOrganizationActivity = {
  lastActiveAt: string | null
  jobs: BackofficeActivitySection
  certificates: BackofficeActivitySection
  requests: BackofficeActivitySection
}

export type BackofficeOperatorAlert = {
  id: number
  organizationId: string | null
  organizationName: string | null
  kind: string
  severity: string
  title: string
  detail: string | null
  status: string
  acknowledgedByName: string | null
  acknowledgedAt: string | null
  firstSeenAt: string
  lastSeenAt: string
}

export type BackofficeOperatorAlertsData = {
  data: BackofficeOperatorAlert[]
}

export type BackofficeInteraction = {
  id: number
  channel: string
  direction: string
  summary: string
  occurredAt: string
  createdByUserId: string | null
  createdByName: string | null
  createdAt: string
}

export type BackofficeInteractionsData = {
  data: BackofficeInteraction[]
}

export type BackofficeImportRun = {
  id: number
  entity: string
  fileName: string | null
  status: string
  totalRows: number
  validRows: number
  errorRows: number
  createdAt: string
  createdByName: string | null
}

export type BackofficeImportRunsData = {
  data: BackofficeImportRun[]
}

export type BackofficeApprovalKind = 'refund' | 'credit' | 'adjustment' | 'other'
export type BackofficeApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED'

export type BackofficeApprovalRequest = {
  id: number
  organizationId: string
  organizationName: string
  kind: BackofficeApprovalKind
  summary: string
  amountCents: number | null
  status: BackofficeApprovalStatus
  requestedByUserId: string | null
  requestedByName: string | null
  decidedByUserId: string | null
  decidedByName: string | null
  decisionReason: string | null
  createdAt: string
  decidedAt: string | null
}

export type BackofficeApprovalsData = {
  data: BackofficeApprovalRequest[]
}

export type BackofficeApprovalFilters = {
  status?: 'pending' | 'approved' | 'rejected' | 'all'
  organizationId?: string
}
