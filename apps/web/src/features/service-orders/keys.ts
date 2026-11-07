/** Query keys of the service-orders feature. See `assets/keys.ts`. */
export type ServiceOrderListKeyInput = {
  organizationId: string
  page: number
  search: string
  statusFilter: string
}

export const serviceOrderKeys = {
  /** Every service-order list and label. */
  all: ['service-orders'] as const,
  /** Every service-order detail and sub-resource. */
  details: ['service-order'] as const,
  prefixes: [['service-orders'], ['service-order']] as const,
  list: (input: ServiceOrderListKeyInput) =>
    [
      'service-orders',
      input.organizationId,
      input.page,
      input.search,
      input.statusFilter,
    ] as const,
  listScope: (organizationId: string) =>
    ['service-orders', organizationId] as const,
  label: (id: string | number) => ['service-orders', id, 'label'] as const,
  /** Keyed by the opaque publicId the dashboard routes with. */
  detail: (publicId: string) => ['service-order', publicId] as const,
  communications: (id: string | number) =>
    ['service-order', id, 'communications'] as const,
  financialStatus: (id: string | number) =>
    ['service-order', id, 'financial-status'] as const,
}
