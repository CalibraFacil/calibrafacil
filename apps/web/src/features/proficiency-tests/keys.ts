/** Query keys of the proficiency-tests feature. See `assets/keys.ts`. */
export type ProficiencyTestListKeyInput = {
  organizationId: string
  page: number
  search: string
  statusFilter: string
  activityTypeFilter: string
}

export const proficiencyTestKeys = {
  all: ['proficiency-tests'] as const,
  list: (input: ProficiencyTestListKeyInput) =>
    [
      'proficiency-tests',
      input.organizationId,
      input.page,
      input.search,
      input.statusFilter,
      input.activityTypeFilter,
    ] as const,
  listScope: (organizationId: string) =>
    ['proficiency-tests', organizationId] as const,
  summary: (organizationId: string) =>
    ['proficiency-tests-summary', organizationId] as const,
  summaries: ['proficiency-tests-summary'] as const,
  plan: (organizationId: string) =>
    ['proficiency-tests-plan', organizationId] as const,
  plans: ['proficiency-tests-plan'] as const,
  detail: (id: string | number) => ['proficiency-test', id] as const,
  auditLog: (id: string | number) =>
    ['proficiency-test-audit-log', id] as const,
  standardOptions: ['pt-standard-options'] as const,
}
