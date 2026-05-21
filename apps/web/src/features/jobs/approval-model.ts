type EnvironmentalApprovalSnapshot = {
  withinLimits?: boolean | null
  outOfLimitsJustification?: string | null
} | null

export type JobApprovalState = {
  environmentalSnapshot?: EnvironmentalApprovalSnapshot
} | null

export function buildJobApprovalInput(envJustification: string) {
  const environmentalJustification = envJustification.trim()

  return {
    reason: 'Aprovado',
    environmentalJustification:
      environmentalJustification.length > 0
        ? environmentalJustification
        : undefined,
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
