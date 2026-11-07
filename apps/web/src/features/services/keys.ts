/** Query keys of the services feature. See `assets/keys.ts`. */
export type ServiceListKeyInput = {
  organizationId: string
  page: number
  search: string
  statusFilter: string
}

export const serviceKeys = {
  all: ['services'] as const,
  list: (input: ServiceListKeyInput) =>
    [
      'services',
      input.organizationId,
      input.page,
      input.search,
      input.statusFilter,
    ] as const,
  listScope: (organizationId: string) => ['services', organizationId] as const,
  /** The edit page holds the numeric id, the route the string one: one key. */
  detail: (id: string | number) => ['services', String(id)] as const,
  auditLog: (id: string | number) => ['services', id, 'audit-log'] as const,
  label: (id: string | number) => ['services', id, 'label'] as const,
  forJob: (assetTypeId: number | null | undefined) =>
    ['services', 'for-job', assetTypeId] as const,
  requestConversion: (organizationId: string) =>
    ['services', organizationId, 'request-conversion'] as const,
}
