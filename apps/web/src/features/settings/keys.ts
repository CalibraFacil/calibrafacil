/** Query keys of the settings feature. See `assets/keys.ts`. */
export const environmentalLimitKeys = {
  /** Every environmental-limit entry: the settings list and a job's effective limits. */
  all: ['environmental-limits'] as const,
  /** Limits of a unit, as the settings page lists them. */
  unit: (unitId: string | number | null | undefined) =>
    ['environmental-limits', unitId ?? 'no-unit'] as const,
  /** Limits in force for an asset type in a unit (a job's environment check). */
  effective: (
    assetTypeId: number | null | undefined,
    unitId: string | number | null | undefined,
  ) => ['environmental-limits', 'effective', assetTypeId, unitId] as const,
}

export const accountKeys = {
  /** The signed-in user's other sessions. */
  sessions: ['settings', 'sessions'] as const,
}

export const settingsKeys = {
  apiKeys: ['api-keys'] as const,
  ssoSettings: (organizationKey: string | null | undefined) =>
    ['sso-settings', organizationKey ?? 'no-org'] as const,
  certificateNumberingProfile: ['certificate-numbering-profile'] as const,
  signingCertificates: (unitId: string | number | null | undefined) =>
    ['signing-certificates', unitId ?? 'no-unit'] as const,
  mySignature: ['my-signature'] as const,
  portalDomain: ['portal-domain'] as const,
  emailDomain: ['email-domain'] as const,
  accreditedScope: (unitId: string | number | null | undefined) =>
    ['accredited-scope', unitId ?? 'no-unit'] as const,
  notificationPreferences: ['notification-preferences'] as const,
}

export const organizationKeys = {
  units: (organizationId: string) =>
    ['organization-units', organizationId] as const,
  members: (organizationId: string) =>
    ['organization-members', organizationId] as const,
  invitations: (organizationId: string) =>
    ['organization-invitations', organizationId] as const,
  governanceMembers: (organizationId: string) =>
    ['organization-governance-members', organizationId] as const,
  governanceActivity: (organizationId: string) =>
    ['organization-governance-activity', organizationId] as const,
}

export const integrationKeys = {
  /** Every integration entry: status, runs, catalogs. */
  all: ['integrations'] as const,
  contaAzulApp: ['integrations', 'conta-azul', 'app'] as const,
  drift: ['integrations', 'drift'] as const,
  runItems: (
    integrationId: string | number | null | undefined,
    runId: string | number | null | undefined,
  ) =>
    [
      'integrations',
      integrationId ?? 'no-integration',
      'runs',
      runId ?? 'no-run',
      'items',
    ] as const,
  schedule: (integrationId: string | number) =>
    ['integrations', integrationId, 'conta-azul', 'schedule'] as const,
  /** Every Conta Azul reference catalog of one integration. */
  catalogsOf: (integrationId: string | number) =>
    ['integrations', integrationId, 'conta-azul', 'catalog'] as const,
  catalog: (integrationId: string | number, catalog: string) =>
    ['integrations', integrationId, 'conta-azul', 'catalog', catalog] as const,
  /** True for a key built by `catalog` / `catalogsOf`. */
  isCatalog: (queryKey: ReadonlyArray<unknown>) =>
    queryKey[0] === 'integrations' &&
    queryKey[2] === 'conta-azul' &&
    queryKey[3] === 'catalog',
}
