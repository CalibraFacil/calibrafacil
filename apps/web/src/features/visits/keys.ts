/** Query keys of the visits feature. See `assets/keys.ts`. */
export type VisitListKeyInput = {
  organizationId: string
  page: number
  status: string
  mine: boolean
  rescheduleRequested?: boolean | undefined
}

export const visitKeys = {
  all: ['visits'] as const,
  details: ['visit'] as const,
  prefixes: [['visits'], ['visit']] as const,
  list: (input: VisitListKeyInput) =>
    [
      'visits',
      input.organizationId,
      input.page,
      input.status,
      input.mine,
      Boolean(input.rescheduleRequested),
    ] as const,
  listScope: (organizationId: string) => ['visits', organizationId] as const,
  detail: (id: string | number) => ['visit', id] as const,
}
