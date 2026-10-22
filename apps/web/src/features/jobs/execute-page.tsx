import { useMemo } from 'react'
import { apiRouteParam } from '@/lib/route-identifiers'
import { Spinner } from '@calibra-facil/ui/spinner'
import { createMethodCalculationEngine } from '@/components/method-runtime/math-runtime'
import { type SyncConflictReturnSearch } from '@/runtime/sync-conflict-return'
import {
  useActiveReferenceStandardsData,
  useCompositionProfilesData,
  useEffectiveEnvironmentalLimitsData,
  useJobDetailData,
} from '@/features/jobs/queries'
import { attachCompositionProfiles } from '@/features/jobs/execution'
import { type ExecutionDraftOwner } from '@/features/jobs/execution-draft'
import {
  NoUnsavedChangesGate,
  type UnsavedChangesGate,
} from '@/lib/unsaved-changes-gate'
import { ExecuteJobForm } from './components/execute-job-form'

type ExecuteJobPageProps = {
  id: string
  conflictReturn: SyncConflictReturnSearch
  /** Null/omitted disables the local draft (the navigation guard still works). */
  draftScope?: ExecutionDraftOwner | null
  /**
   * Navigation gate supplied by the route adapter, keeping this feature free of
   * router coupling. Omitted (tests, embedded renders) means "never block".
   */
  UnsavedChangesGate?: UnsavedChangesGate
}

export function ExecuteJobPage({
  id,
  conflictReturn,
  draftScope = null,
  UnsavedChangesGate = NoUnsavedChangesGate,
}: ExecuteJobPageProps) {
  const apiJobId = apiRouteParam(id)
  const engine = useMemo(() => createMethodCalculationEngine(), [])

  const {
    data: job,
    isLoading: jobLoading,
    error: jobError,
  } = useJobDetailData({
    id,
    apiJobId,
  })

  const { data: standardsData } = useActiveReferenceStandardsData()

  // Composition-profile buildup options now come from the normalized catalog and
  // are reconstituted (by class) onto each standard, so buildMassCompositionOptions
  // behaves exactly as before normalization.
  const { data: compositionProfilesData } = useCompositionProfilesData()
  const standardsWithProfiles = useMemo(
    () =>
      attachCompositionProfiles(
        standardsData?.data ?? [],
        compositionProfilesData?.data ?? [],
      ),
    [standardsData, compositionProfilesData],
  )

  const { data: envLimitsData } = useEffectiveEnvironmentalLimitsData({
    assetTypeId: job?.assetTypeId,
    unitId: job?.unitId,
    enabled: !!job?.assetTypeId && !!job?.unitId,
  })

  const envLimits = envLimitsData?.limits ?? null

  if (jobError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-6">
          <p className="text-red-500">
            Erro ao carregar job: {jobError.message}
          </p>
        </div>
      </div>
    )
  }

  if (jobLoading || !job) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Spinner className="size-8" />
      </div>
    )
  }

  return (
    <ExecuteJobForm
      // The draft offer is resolved when the form mounts, so a change of
      // organization/user must remount it rather than reuse another scope's.
      key={`${job.id}:${draftScope?.organizationId ?? ''}:${draftScope?.userId ?? ''}`}
      job={job}
      standardsData={standardsWithProfiles}
      envLimits={envLimits}
      engine={engine}
      jobId={id}
      conflictReturn={conflictReturn}
      draftScope={draftScope}
      UnsavedChangesGate={UnsavedChangesGate}
    />
  )
}
