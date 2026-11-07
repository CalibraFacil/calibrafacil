/** Query keys of the materials feature. See `assets/keys.ts`. */
export type MaterialListKeyInput = {
  organizationId: string
  page: number
  search: string
  statusFilter: string
}

export const materialKeys = {
  all: ['materials'] as const,
  list: (input: MaterialListKeyInput) =>
    [
      'materials',
      input.organizationId,
      input.page,
      input.search,
      input.statusFilter,
    ] as const,
  listScope: (organizationId: string) => ['materials', organizationId] as const,
  detail: (id: string | number) => ['materials', String(id)] as const,
  serviceOrderPicker: (search: string) =>
    ['materials', 'service-order-picker', search] as const,
}
