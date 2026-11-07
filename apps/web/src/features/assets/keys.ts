/**
 * Query keys of the assets feature. Every `useQuery`, `setQueryData` and
 * `invalidateQueries` that touches an asset (here or from another feature)
 * builds its key from this factory, so a reshaped key moves the query and its
 * invalidations together. `docs/architecture/web-frontend-architecture.md`.
 */
export type AssetListKeyInput = {
  organizationId: string
  page: number
  limit: number
  search: string
  statusFilter: string
  customerId?: number | null | undefined
}

export const assetKeys = {
  /** Every asset list and sub-list. */
  all: ['assets'] as const,
  /** Every asset detail, audit log included. */
  details: ['asset'] as const,
  /** Both roots: what a change to an asset can make stale. */
  prefixes: [['assets'], ['asset']] as const,
  list: (input: AssetListKeyInput) =>
    [
      'assets',
      input.organizationId,
      input.page,
      input.limit,
      input.search,
      input.statusFilter,
      input.customerId,
    ] as const,
  /** Leading part of `list`: whose list it is (placeholder data stays in it). */
  listScope: (organizationId: string) => ['assets', organizationId] as const,
  detail: (id: string | number) => ['asset', id] as const,
  auditLog: (id: string | number) => ['asset', id, 'audit-log'] as const,
  label: (id: string | number) => ['assets', id, 'label'] as const,
  types: ['asset-types'] as const,
  legalMetrologyRegulations: ['legal-metrology-regulations'] as const,
  /** The customer's assets, unpaged (the new-job form). */
  forCustomer: (customerId: number | null | undefined) =>
    ['assets', 'customer', customerId] as const,
  customerList: (input: {
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
  customerListScope: (customerId: number | null | undefined) =>
    ['assets', 'customer', customerId] as const,
  serviceOrderOpen: (customerId: number | null | undefined, search: string) =>
    ['assets', 'service-order-open', customerId, search] as const,
}
