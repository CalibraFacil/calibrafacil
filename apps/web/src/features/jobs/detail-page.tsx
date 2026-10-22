import { useNavigate } from '@tanstack/react-router'
import { canTransition } from '@calibra-facil/schemas/job-transitions'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useCallback, useMemo } from 'react'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowLeft01Icon, UserAdd01Icon } from '@hugeicons/core-free-icons'
import { calibraApi } from '@/utils/api'
import { Button } from '@calibra-facil/ui/button'
import { Skeleton } from '@calibra-facil/ui/skeleton'
import { Card, CardContent } from '@calibra-facil/ui/card'
import { ApprovedJobRecord } from '@/features/jobs/components/approved-job-record'
import { apiRouteParam } from '@/lib/route-identifiers'
import {
  useJobDetailData,
  useJobTechniciansData,
} from '@/features/jobs/queries'
import { ActionAvailabilityGate } from '@/components/availability/action-availability-gate'
import { useOperationAvailability } from '@/runtime/use-operation-availability'
import {
  describeReconcileLag,
  reconcileAfterCloudCommand,
} from '@/runtime/reconcile-cloud-command'
import {
  buildJobReviewModel,
  jobCloudCommandTarget,
} from '@/features/jobs/detail-model'
import {
  buildJobApprovalInput,
  isScopeViolationError,
} from '@/features/jobs/approval-model'
import { ACTION_BUTTON_CLASS } from '@calibra-facil/ui/instrument-panel'
import { JobAmendmentBanner } from './components/job-amendment-banner'
import { JobVerdictBand } from './components/job-verdict-band'
import { ReviewEvidenceMain } from './components/review-evidence-main'
import { ReviewEvidenceAside } from './components/review-evidence-aside'
import { ExecutionPreparationView } from './components/execution-preparation-view'
import {
  ApproveJobDialog,
  RejectJobDialog,
  CancelJobDialog,
  AssignTechnicianDialog,
} from './components/job-action-dialogs'
import {
  isApprovedJobRecordData,
  toFinancialStatus,
  toJobStatus,
} from './job-detail-guards'

type JobDetailPageProps = {
  id: string
}

export function JobDetailPage({ id }: JobDetailPageProps) {
  const apiJobId = apiRouteParam(id)
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // Dialog states
  const [approveDialogOpen, setApproveDialogOpen] = useState(false)
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false)
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false)
  const [assignDialogOpen, setAssignDialogOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [cancelReason, setCancelReason] = useState('')
  const [selectedTechnician, setSelectedTechnician] = useState<string>('')
  const [envJustification, setEnvJustification] = useState('')
  // #427 Phase 1: server blocked the approval with SCOPE_VIOLATION; the
  // dialog then offers the documented-override path (issues without seal).
  const [scopeViolationBlocked, setScopeViolationBlocked] = useState(false)
  const [scopeOverrideJustification, setScopeOverrideJustification] =
    useState('')

  // Stable callback for refreshing job data (used by ApprovedJobRecord for label polling)
  const refreshJob = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['jobs', id] })
  }, [queryClient, id])

  const {
    data: job,
    isLoading,
    error,
  } = useJobDetailData({
    id,
    apiJobId,
    refetchWhileGeneratingPdf: true,
  })

  // Availability is derived, not assumed from the host: a connected desktop
  // may run every one of these cloud commands, and a *disconnected* browser
  // may not. What actually blocks is connectivity, the local process, and —
  // for this job specifically — readings still sitting in the outbox.
  const jobTarget = jobCloudCommandTarget(job)
  const approveAvailability = useOperationAvailability(
    'jobs',
    'approve',
    jobTarget,
  )
  const rejectAvailability = useOperationAvailability(
    'jobs',
    'reject',
    jobTarget,
  )
  const cancelAvailability = useOperationAvailability(
    'jobs',
    'cancel',
    jobTarget,
  )
  const assignAvailability = useOperationAvailability(
    'jobs',
    'assign',
    jobTarget,
  )
  const techniciansAvailability = useOperationAvailability(
    'jobs',
    'listTechnicians',
  )

  const { data: techniciansData } = useJobTechniciansData({
    enabled: assignDialogOpen && techniciansAvailability.available,
  })

  /**
   * Jobs are read local-first on desktop, so invalidating after a cloud
   * command would re-read the pre-command row from SQLite and the screen would
   * appear not to have changed. Reconcile first, then invalidate.
   */
  const settleAfterCloudCommand = useCallback(
    async (message: string, queryKeys: readonly unknown[][]) => {
      const result = await reconcileAfterCloudCommand(queryClient, queryKeys)
      const lag = describeReconcileLag(result)

      toast.success(message, lag ? { description: lag } : undefined)
    },
    [queryClient],
  )

  // Approve mutation
  const approveMutation = useMutation({
    mutationFn: async () => {
      return calibraApi.jobs.approve(
        apiJobId,
        buildJobApprovalInput(
          envJustification,
          scopeViolationBlocked ? scopeOverrideJustification : '',
        ),
      )
    },
    onSuccess: async () => {
      await settleAfterCloudCommand('Job aprovado com sucesso!', [
        ['jobs'],
        ['jobs', id],
      ])
      setApproveDialogOpen(false)
      setEnvJustification('')
      setScopeViolationBlocked(false)
      setScopeOverrideJustification('')
    },
    onError: (error) => {
      if (isScopeViolationError(error)) {
        setScopeViolationBlocked(true)
      }
      toast.error(error.message)
    },
  })

  // Reject mutation
  const rejectMutation = useMutation({
    mutationFn: async () => {
      return calibraApi.jobs.reject(apiJobId, rejectReason)
    },
    onSuccess: async () => {
      await settleAfterCloudCommand('Job rejeitado', [['jobs'], ['jobs', id]])
      setRejectDialogOpen(false)
      setRejectReason('')
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  // Cancel mutation
  const cancelMutation = useMutation({
    mutationFn: async () => {
      return calibraApi.jobs.cancel(apiJobId, cancelReason)
    },
    onSuccess: async () => {
      await settleAfterCloudCommand('Job cancelado', [['jobs'], ['jobs', id]])
      setCancelDialogOpen(false)
      setCancelReason('')
      navigate({ to: '/dashboard/jobs' })
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  // Assign mutation
  const assignMutation = useMutation({
    mutationFn: async () => {
      return calibraApi.jobs.assign(apiJobId, selectedTechnician)
    },
    onSuccess: async () => {
      await settleAfterCloudCommand('Técnico atribuído com sucesso!', [
        ['jobs'],
        ['jobs', id],
      ])
      setAssignDialogOpen(false)
      setSelectedTechnician('')
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  const reviewModel = useMemo(() => buildJobReviewModel(job), [job])
  const { verdict } = reviewModel

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Card>
          <CardContent className="pt-6 space-y-4">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-6 w-1/2" />
          </CardContent>
        </Card>
      </div>
    )
  }

  if (error || !job) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-red-500">
            Erro ao carregar job: {error?.message || 'Job não encontrado'}
          </p>
        </CardContent>
      </Card>
    )
  }

  const isGeneratingPdf = job.status === 'GENERATING_PDF'
  const canExecute = ['DRAFT', 'IN_PROGRESS', 'REJECTED'].includes(job.status)
  // Status decides whether the action exists at this point in the lifecycle;
  // availability decides whether it can run right now. Keeping them apart is
  // what lets the desktop show the review evidence — and the reason — instead
  // of an empty panel.
  const canApprove = job.status === 'REVIEW'
  const canShowReviewEvidence = canApprove || isGeneratingPdf
  const canCancel = ['DRAFT', 'IN_PROGRESS', 'REVIEW', 'REJECTED'].includes(
    job.status,
  )
  // The transition table decides, not a list kept here: a technician can be
  // assigned while the job is open (DRAFT, IN_PROGRESS, REVIEW, REJECTED).
  const canAssign = canTransition(job.status, 'assign')
  const assignAction = canAssign ? (
    <ActionAvailabilityGate availability={assignAvailability}>
      {({ disabled }) => (
        <Button
          variant="outline"
          disabled={disabled}
          className={ACTION_BUTTON_CLASS}
          onClick={() => setAssignDialogOpen(true)}
        >
          <HugeiconsIcon icon={UserAdd01Icon} className="mr-2 h-4 w-4" />
          Atribuir técnico
        </Button>
      )}
    </ActionAvailabilityGate>
  ) : null
  const financialStatus =
    typeof job.financialStatus === 'string' ? job.financialStatus : 'UNBILLED'
  const normalizedFinancialStatus = toFinancialStatus(financialStatus)
  const normalizedJobStatus = toJobStatus(job.status)

  // APPROVED or SUPERSEDED status: Show immutable Quality Record view
  if (
    (job.status === 'APPROVED' || job.status === 'SUPERSEDED') &&
    isApprovedJobRecordData(job)
  ) {
    return (
      <ApprovedJobRecord
        job={job}
        onBack={() => navigate({ to: '/dashboard/jobs' })}
        onRefresh={refreshJob}
      />
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate({ to: '/dashboard/jobs' })}
          className="min-h-10 active:scale-[0.96] transition-[background-color,color,transform]"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} className="mr-2 h-4 w-4" />
          Voltar
        </Button>
      </div>

      {/* Amendment Info Banner - ISO 17025 Clause 7.8.4.1 */}
      {job.supersedesId && <JobAmendmentBanner job={job} />}

      {/* Verdict band — identity, conformance summary and the decision */}
      <JobVerdictBand
        job={job}
        id={id}
        verdict={verdict}
        isGeneratingPdf={isGeneratingPdf}
        normalizedJobStatus={normalizedJobStatus}
        normalizedFinancialStatus={normalizedFinancialStatus}
        canApprove={canApprove}
        canExecute={canExecute}
        canCancel={canCancel}
        approveAvailability={approveAvailability}
        rejectAvailability={rejectAvailability}
        cancelAvailability={cancelAvailability}
        assignAction={assignAction}
        onOpenApprove={() => setApproveDialogOpen(true)}
        onOpenReject={() => setRejectDialogOpen(true)}
        onOpenCancel={() => setCancelDialogOpen(true)}
      />

      {canShowReviewEvidence ? (
        <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <ReviewEvidenceMain
            job={job}
            review={reviewModel}
            isGeneratingPdf={isGeneratingPdf}
          />
          <ReviewEvidenceAside
            job={job}
            review={reviewModel}
            financialStatus={financialStatus}
            normalizedFinancialStatus={normalizedFinancialStatus}
          />
        </div>
      ) : (
        <ExecutionPreparationView job={job} review={reviewModel} />
      )}

      {/* Approve Dialog */}
      <ApproveJobDialog
        job={job}
        approveDialogOpen={approveDialogOpen}
        setApproveDialogOpen={setApproveDialogOpen}
        envJustification={envJustification}
        setEnvJustification={setEnvJustification}
        scopeViolationBlocked={scopeViolationBlocked}
        setScopeViolationBlocked={setScopeViolationBlocked}
        scopeOverrideJustification={scopeOverrideJustification}
        setScopeOverrideJustification={setScopeOverrideJustification}
        approveMutation={approveMutation}
      />

      {/* Reject Dialog */}
      <RejectJobDialog
        rejectDialogOpen={rejectDialogOpen}
        setRejectDialogOpen={setRejectDialogOpen}
        rejectReason={rejectReason}
        setRejectReason={setRejectReason}
        rejectMutation={rejectMutation}
      />

      {/* Cancel Dialog */}
      <CancelJobDialog
        cancelDialogOpen={cancelDialogOpen}
        setCancelDialogOpen={setCancelDialogOpen}
        cancelReason={cancelReason}
        setCancelReason={setCancelReason}
        cancelMutation={cancelMutation}
      />

      {/* Assign Technician Dialog */}
      <AssignTechnicianDialog
        assignDialogOpen={assignDialogOpen}
        setAssignDialogOpen={setAssignDialogOpen}
        selectedTechnician={selectedTechnician}
        setSelectedTechnician={setSelectedTechnician}
        techniciansData={techniciansData}
        assignMutation={assignMutation}
      />
    </div>
  )
}
