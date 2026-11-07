/** Query keys of the standards feature. See `assets/keys.ts`. */
export type StandardListKeyInput = {
  organizationId: string
  page: number
  search: string
  statusFilter: string
}

export const standardKeys = {
  all: ['standards'] as const,
  list: (input: StandardListKeyInput) =>
    [
      'standards',
      input.organizationId,
      input.page,
      input.search,
      input.statusFilter,
    ] as const,
  listScope: (organizationId: string) => ['standards', organizationId] as const,
  detail: (id: string | number) => ['standards', id] as const,
  auditLog: (id: string | number) => ['standards', id, 'audit-log'] as const,
  recall: (id: string | number) => ['standards', id, 'recall'] as const,
  label: (id: string | number) => ['standards', id, 'label'] as const,
  impactedCertificates: (
    id: string | number,
    range: { from?: string | null; to?: string | null },
  ) =>
    [
      'standards',
      id,
      'impacted-certificates',
      range.from ?? '',
      range.to ?? '',
    ] as const,
  /** Every impacted-certificates range of one standard. */
  impactedCertificatesOf: (id: string | number) =>
    ['standards', id, 'impacted-certificates'] as const,
  compositionProfiles: ['standards', 'composition-profiles'] as const,
  active: ['standards', 'active'] as const,
}
