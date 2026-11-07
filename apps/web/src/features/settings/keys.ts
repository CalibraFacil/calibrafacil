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
