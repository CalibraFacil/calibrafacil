import type { JobExecutionWarning } from '@calibra-facil/contracts'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { toast } from 'sonner'
import { calibraApi } from '@/utils/api'
import { apiRouteParam } from '@/lib/route-identifiers'
import {
  shouldReturnToSyncConflicts,
  type SyncConflictReturnSearch,
} from '@/runtime/sync-conflict-return'
import {
  buildCalibrationLocationPayload,
  buildCalibrationPhasesPayload,
  buildEnvironmentPayload,
  buildExecutionMutationPayload,
  findMissingNotPerformedPhaseReasons,
  type CalibrationLocationSnapshot,
  type CalibrationPhaseSnapshot,
} from '@/features/jobs/execution'
import { parseExecutionPerformedAt } from '@/features/jobs/forms'
import {
  clearExecutionDraft,
  type ExecutionDraftOwner,
  type ExecutionFormValues,
} from '@/features/jobs/execution-draft'
import type { useExecutionCalculation } from './use-execution-calculation'
import type { useExecutionFieldModel } from './use-execution-field-model'

/**
 * The save-draft and submit-for-review mutations, plus the payload pieces they
 * share. A save becomes the new clean baseline; a submit also lets the page
 * navigate away without the unsaved-readings guard.
 */
export function useExecutionSubmission({
  jobId,
  conflictReturn,
  scope,
  allowLeave,
  selectedStandardIds,
  parsedFormData,
  formulaResults,
  environment,
  calibrationLocation,
  calibrationPhases,
  phaseBlocks,
  methodDeviations,
  performedAtState,
  setSavedValues,
  setStandardWarnings,
}: {
  jobId: string
  conflictReturn: SyncConflictReturnSearch
  scope: (ExecutionDraftOwner & { jobId: string }) | null
  allowLeave: () => void
  selectedStandardIds: number[]
  parsedFormData: ReturnType<typeof useExecutionCalculation>['parsedFormData']
  formulaResults: ReturnType<typeof useExecutionCalculation>['formulaResults']
  environment: ExecutionFormValues['environment']
  calibrationLocation: CalibrationLocationSnapshot
  calibrationPhases: CalibrationPhaseSnapshot
  phaseBlocks: ReturnType<typeof useExecutionFieldModel>['phaseBlocks']
  methodDeviations: string
  performedAtState: ReturnType<typeof parseExecutionPerformedAt>
  setSavedValues: (values: ExecutionFormValues) => void
  setStandardWarnings: (warnings: JobExecutionWarning[]) => void
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // Build environment payload (only send if any value is set)
  const environmentPayload = useMemo(
    () => buildEnvironmentPayload(environment),
    [environment],
  )
  const calibrationLocationPayload = useMemo(
    () => buildCalibrationLocationPayload(calibrationLocation),
    [calibrationLocation],
  )
  const calibrationPhasesPayload = useMemo(
    () =>
      buildCalibrationPhasesPayload({
        phaseBlocks,
        calibrationPhases,
      }),
    [calibrationPhases, phaseBlocks],
  )
  const missingNotPerformedPhaseReasons = useMemo(
    () =>
      findMissingNotPerformedPhaseReasons({
        phaseBlocks,
        calibrationPhases,
      }),
    [calibrationPhases, phaseBlocks],
  )

  // Save draft mutation
  const saveMutation = useMutation({
    // The variable is the snapshot being saved: on success it becomes the new
    // clean baseline, so edits typed while the request was in flight stay dirty.
    mutationFn: async (_saved: ExecutionFormValues) => {
      return calibraApi.jobs.saveExecution(
        apiRouteParam(jobId),
        buildExecutionMutationPayload({
          selectedStandardIds,
          normalizedData: parsedFormData,
          formulaResults,
          environment: environmentPayload,
          calibrationLocation: calibrationLocationPayload,
          calibrationPhases: calibrationPhasesPayload,
          methodDeviations,
          // Persist the execution date with the draft so it survives a reload.
          performedAt: performedAtState.instant ?? undefined,
        }),
      )
    },
    onSuccess: (data, saved) => {
      setSavedValues(saved)
      setStandardWarnings(data.warnings ?? [])
      queryClient.invalidateQueries({ queryKey: ['jobs', jobId] })
      toast.success('Dados salvos com sucesso!')
      if (shouldReturnToSyncConflicts(conflictReturn)) {
        allowLeave()
        navigate({ to: '/dashboard/sync/conflicts' })
      }
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  // Submit for review mutation
  const submitMutation = useMutation({
    mutationFn: async (_submitted: ExecutionFormValues) => {
      if (missingNotPerformedPhaseReasons.length > 0) {
        throw new Error(
          'Informe o motivo dos blocos marcados como não executados.',
        )
      }
      if (!performedAtState.payload) {
        throw new Error(performedAtState.message ?? 'Data de execução inválida')
      }
      return calibraApi.jobs.submitExecution(
        apiRouteParam(jobId),
        buildExecutionMutationPayload({
          selectedStandardIds,
          normalizedData: parsedFormData,
          formulaResults,
          environment: environmentPayload,
          calibrationLocation: calibrationLocationPayload,
          calibrationPhases: calibrationPhasesPayload,
          methodDeviations,
          ...performedAtState.payload,
        }),
      )
    },
    onSuccess: (_data, submitted) => {
      setSavedValues(submitted)
      allowLeave()
      if (scope) clearExecutionDraft(scope)
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
      toast.success('Job enviado para revisão!')
      if (shouldReturnToSyncConflicts(conflictReturn)) {
        navigate({ to: '/dashboard/sync/conflicts' })
        return
      }
      navigate({ to: '/dashboard/jobs' })
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  return {
    missingNotPerformedPhaseReasons,
    saveMutation,
    submitMutation,
  }
}
