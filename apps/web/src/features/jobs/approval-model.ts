type EnvironmentalApprovalSnapshot = {
  withinLimits?: boolean | null
  outOfLimitsJustification?: string | null
} | null

export type JobApprovalState = {
  environmentalSnapshot?: EnvironmentalApprovalSnapshot
} | null

export function buildJobApprovalInput(
  envJustification: string,
  scopeOverrideJustification = '',
) {
  const environmentalJustification = envJustification.trim()
  const scopeOverride = scopeOverrideJustification.trim()

  return {
    reason: 'Aprovado',
    environmentalJustification:
      environmentalJustification.length > 0
        ? environmentalJustification
        : undefined,
    // #427 Phase 1: only sent after the server blocked with SCOPE_VIOLATION;
    // approving with it downgrades the certificate to non-accredited.
    scopeOverrideJustification:
      scopeOverride.length > 0 ? scopeOverride : undefined,
  }
}

export function isJobApprovalBlockedByEnvironment(
  job: JobApprovalState,
  envJustification: string,
) {
  const environmentalSnapshot = job?.environmentalSnapshot

  return Boolean(
    environmentalSnapshot &&
    !environmentalSnapshot.withinLimits &&
    !environmentalSnapshot.outOfLimitsJustification &&
    !envJustification.trim(),
  )
}

/**
 * #427 Phase 1: the approve call came back 422 SCOPE_VIOLATION. Detected from
 * the CalibraApiError payload so the dialog can reveal the override path.
 */
export function isScopeViolationError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const payload = Reflect.get(error, 'payload')
  if (typeof payload !== 'object' || payload === null) return false
  return Reflect.get(payload, 'code') === 'SCOPE_VIOLATION'
}
