/** Query keys of the calibration-requests feature. See `assets/keys.ts`. */
export type RequestListKeyInput = {
  organizationId: string
  page: number
  search: string
  statusFilter: string
}

export const requestKeys = {
  all: ['calibration-requests'] as const,
  list: (input: RequestListKeyInput) =>
    [
      'calibration-requests',
      input.organizationId,
      input.page,
      input.search,
      input.statusFilter,
    ] as const,
  listScope: (organizationId: string) =>
    ['calibration-requests', organizationId] as const,
  detail: (organizationId: string, id: string | number) =>
    ['calibration-request', organizationId, String(id)] as const,
}
