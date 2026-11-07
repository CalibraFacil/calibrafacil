/** Query keys of the customers feature. See `assets/keys.ts`. */
export type CustomerListKeyInput = {
  organizationId: string
  page: number
  limit: number
  search: string
}

export const customerKeys = {
  /** Every customer list, search and label. */
  all: ['customers'] as const,
  /** Every customer detail and its sub-resources. */
  details: ['customer'] as const,
  prefixes: [['customers'], ['customer']] as const,
  list: (input: CustomerListKeyInput) =>
    [
      'customers',
      input.organizationId,
      input.page,
      input.limit,
      input.search,
    ] as const,
  listScope: (organizationId: string) => ['customers', organizationId] as const,
  search: (organizationId: string, search: string) =>
    ['customers', organizationId, 'search', search] as const,
  /** Customer picker search (job and asset forms). */
  pickerSearch: (search: string) => ['customers', 'search', search] as const,
  serviceOrderOpen: (search: string) =>
    ['customers', 'service-order-open', search] as const,
  label: (id: string | number) => ['customers', id, 'label'] as const,
  detail: (id: string | number) => ['customer', id] as const,
  financialTimeline: (id: string | number) =>
    ['customer', id, 'financial-timeline'] as const,
  auditLog: (id: string | number) => ['customer-audit-log', id] as const,
  members: (id: string | number) => ['customer-members', id] as const,
  invitations: (id: string | number) => ['customer-invitations', id] as const,
  /**
   * One page of a customer's assets (customer assets tab). Rooted at the
   * `assets` key, so everything that invalidates `assetKeys.all` reaches it.
   */
  assetsPage: (input: {
    customerId: number | null | undefined
    page: number
    limit: number
    search: string
  }) =>
    [
      'assets',
      'customer',
      input.customerId,
      input.page,
      input.limit,
      input.search,
    ] as const,
  /** Leading part of `assetsPage`: whose pages they are (placeholder data stays in it). */
  assetsPageScope: (customerId: number | null | undefined) =>
    ['assets', 'customer', customerId] as const,
  /** One page of a customer's calibrations, rooted at the `jobs` key like `assetsPage`. */
  jobsPage: (input: {
    customerId: number | null | undefined
    page: number
    search: string
    statusFilter: string
  }) =>
    [
      'jobs',
      'customer',
      input.customerId,
      input.page,
      input.search,
      input.statusFilter,
    ] as const,
  jobsPageScope: (customerId: number | null | undefined) =>
    ['jobs', 'customer', customerId] as const,
  /** Every customer's out-of-tolerance events. */
  ootEventsAll: ['customer-oot-events'] as const,
  ootEvents: (customerId: string | number) =>
    ['customer-oot-events', customerId] as const,
}
