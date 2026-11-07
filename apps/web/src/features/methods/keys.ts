/** Query keys of the methods feature. See `assets/keys.ts`. */
export type MethodListKeyInput = {
  organizationId: string
  page: number
  search: string
  statusFilter: string
}

export const methodKeys = {
  all: ['methods'] as const,
  list: (input: MethodListKeyInput) =>
    [
      'methods',
      input.organizationId,
      input.page,
      input.search,
      input.statusFilter,
    ] as const,
  listScope: (organizationId: string) => ['methods', organizationId] as const,
  detail: (id: string | number) => ['methods', id] as const,
  audit: (id: string | number) => ['methods', id, 'audit'] as const,
  label: (id: string | number) => ['methods', id, 'label'] as const,
  templates: ['methods', 'templates'] as const,
  published: ['methods', 'published'] as const,
}
