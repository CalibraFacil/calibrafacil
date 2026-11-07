/**
 * Query keys that belong to the low layers (`lib`, `hooks`), which must not
 * import features. A feature's own keys live in `features/<domain>/keys.ts`;
 * a key built here may be read by any feature.
 */
export const sessionKeys = {
  /** The desktop shell's local session (units and permissions granted offline). */
  desktopLocalSession: ['desktop-local-session'] as const,
  /** Units the dashboard can scope to, per organization and runtime. */
  dashboardUnits: (
    organizationId: string | undefined,
    hasMultiUnit: boolean,
    runtime: 'desktop' | 'cloud',
  ) =>
    [
      'dashboard-units',
      organizationId ?? 'no-org',
      hasMultiUnit,
      runtime,
    ] as const,
  /** Every `dashboardUnits` entry of one organization. */
  dashboardUnitsOf: (organizationId: string) =>
    ['dashboard-units', organizationId] as const,
  /** Finance access of the active organization (under the `finance` root). */
  financeAccess: (organizationId: string | undefined) =>
    ['finance', 'access', organizationId ?? 'no-org'] as const,
}

/** Third-party lookups cached for a day. */
export const lookupKeys = {
  cnpj: (cnpj: string) => ['cnpj-lookup', cnpj] as const,
  viaCep: (cep: string) => ['viacep', cep] as const,
}
