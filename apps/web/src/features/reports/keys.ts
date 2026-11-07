/** Query keys of the reports feature. See `assets/keys.ts`. */
export type ReportKeyInput = {
  organizationId: string | null | undefined
  period: string
  unitIds: string | undefined
}

function scopeParts(input: ReportKeyInput) {
  return [
    input.organizationId ?? 'no-org',
    input.period,
    input.unitIds ?? 'all',
  ] as const
}

export const reportKeys = {
  all: ['reports'] as const,
  executiveOverview: (input: ReportKeyInput) =>
    ['reports', 'executive-overview', ...scopeParts(input)] as const,
  comparison: (input: ReportKeyInput) =>
    ['reports', 'comparison', ...scopeParts(input)] as const,
  trend: (input: ReportKeyInput) =>
    ['reports', 'trend', ...scopeParts(input)] as const,
}
