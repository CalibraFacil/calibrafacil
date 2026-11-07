/** Query keys of the quality (non-conformance and CAPA) feature. See `assets/keys.ts`. */
export type NonConformanceListKeyInput = {
  organizationId: string
  page: number
  search: string
  statusFilter: string
  typeFilter: string
}

export type CapaListKeyInput = {
  organizationId: string
  page: number
  search: string
  statusFilter: string
  severityFilter: string
  categoryFilter: string
}

export const nonConformanceKeys = {
  /** Every non-conformance list. */
  all: ['non-conformances'] as const,
  /** Every non-conformance detail. */
  details: ['non-conformance'] as const,
  list: (input: NonConformanceListKeyInput) =>
    [
      'non-conformances',
      input.organizationId,
      input.page,
      input.search,
      input.statusFilter,
      input.typeFilter,
    ] as const,
  listScope: (organizationId: string) =>
    ['non-conformances', organizationId] as const,
  summary: (organizationId: string) =>
    ['non-conformances-summary', organizationId] as const,
  /** The summary of every organization. */
  summaries: ['non-conformances-summary'] as const,
  detail: (id: string | number) => ['non-conformance', id] as const,
  label: (id: string | number) => ['non-conformance', id, 'label'] as const,
  audit: (id: string | number) => ['non-conformance-audit', id] as const,
  ootNotification: (id: string | number) =>
    ['non-conformance-oot-notification', id] as const,
  impactAssessment: (id: string | number) =>
    ['non-conformance-impact-assessment', id] as const,
}

export const capaKeys = {
  all: ['capas'] as const,
  list: (input: CapaListKeyInput) =>
    [
      'capas',
      input.organizationId,
      input.page,
      input.search,
      input.statusFilter,
      input.severityFilter,
      input.categoryFilter,
    ] as const,
  listScope: (organizationId: string) => ['capas', organizationId] as const,
  summary: (organizationId: string) =>
    ['capas-summary', organizationId] as const,
  /** The summary of every organization. */
  summaries: ['capas-summary'] as const,
  detail: (id: string | number) => ['capa', id] as const,
  label: (id: string | number) => ['capa', id, 'label'] as const,
  auditLog: (id: string | number) => ['capa-audit-log', id] as const,
}
