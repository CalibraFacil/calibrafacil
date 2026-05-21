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
  organization: { id: string; name: string; slug: string; cnpj: string | null }
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
