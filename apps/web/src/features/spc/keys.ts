/** Query keys of the SPC feature. See `assets/keys.ts`. */
export type SpcChartListKeyInput = {
  organizationId: string
  page: number
  standardId?: number | null | undefined
  statusFilter: string
}

export const spcKeys = {
  /** Every chart list. */
  all: ['spc-charts'] as const,
  list: (input: SpcChartListKeyInput) =>
    [
      'spc-charts',
      input.organizationId,
      input.page,
      input.standardId ?? null,
      input.statusFilter,
    ] as const,
  listScope: (organizationId: string) =>
    ['spc-charts', organizationId] as const,
  byStandard: (standardId: string | number) =>
    ['spc-charts', 'by-standard', standardId] as const,
  summary: (organizationId: string) =>
    ['spc-charts-summary', organizationId] as const,
  summaries: ['spc-charts-summary'] as const,
  chart: (id: string | number) => ['spc-chart', id] as const,
  standardOptions: ['spc-standard-options'] as const,
}
