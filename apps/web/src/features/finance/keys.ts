/** Query keys of the finance feature. See `assets/keys.ts`. */
export const financeKeys = {
  /** Every finance query. */
  all: ['finance'] as const,
  overview: ['finance', 'overview'] as const,
  documents: ['finance', 'documents'] as const,
  documentSearch: (search: string) => ['finance', 'documents', search] as const,
  documentDetail: (id: string | number) =>
    ['finance', 'documents', String(id)] as const,
  eligibleJobs: (mode: string, search: string) =>
    ['finance', 'documents', 'eligible-jobs', mode, search] as const,
  contracts: ['finance', 'contracts'] as const,
  contractSearch: (search: string) => ['finance', 'contracts', search] as const,
  contractDetail: (id: string | number) =>
    ['finance', 'contracts', String(id)] as const,
  contractFormCustomers: ['finance', 'contract-form', 'customers'] as const,
  contractFormServices: ['finance', 'contract-form', 'services'] as const,
  receipts: ['finance', 'receipts'] as const,
  erp: ['finance', 'erp'] as const,
  /** Every billing-readiness status filter. */
  billingReadiness: ['finance', 'billing-readiness'] as const,
  billingReadinessFor: (status: string | null | undefined) =>
    ['finance', 'billing-readiness', status ?? 'all'] as const,
  cashForecast: ['finance', 'cash-forecast'] as const,
  marginDashboards: ['finance', 'margin-dashboards'] as const,
  operationsToCash: ['finance', 'operations-to-cash'] as const,
  revenueLeakage: ['finance', 'revenue-leakage'] as const,
  certificateRelease: (calibrationJobId: string | number) =>
    ['finance', 'certificate-release', calibrationJobId] as const,
}
