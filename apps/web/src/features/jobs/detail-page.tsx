import { Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useCallback, useMemo } from 'react'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowLeft01Icon,
  Calendar03Icon,
  Edit02Icon,
  CheckmarkBadge02Icon,
  Cancel01Icon,
  MultiplicationSignIcon,
  UserAdd01Icon,
  Alert02Icon,
  Target02Icon,
  TaskDone01Icon,
  ThermometerIcon,
  RulerIcon,
  Clock01Icon,
  FunctionIcon,
} from '@hugeicons/core-free-icons'

import { calibraApi } from '@/utils/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { Spinner } from '@/components/ui/spinner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import { Field, FieldLabel } from '@/components/ui/field'
import {
  formatCalibrationValue,
  getFinancialStatusLabel,
  type FinancialStatus,
} from '@calibra-facil/shared'
import { ApprovedJobRecord } from '@/features/jobs/components/approved-job-record'
import { CertificateProgressButton } from '@/features/jobs/components/certificate-progress-button'
import { RepeatabilityTable } from '@/features/jobs/components/repeatability-table'
import { apiRouteParam } from '@/lib/route-identifiers'
import { isMassCompositionValue } from '@/components/method-runtime/mass-composition-utils'
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
  formatDate,
  formatDateTime,
  formatReviewValue,
  reviewColumnDisplayLabel,
  getFinancialVariant,
  JOB_STATUS_LABELS,
  JOB_STATUS_VARIANTS,
  REVIEW_SURFACE_CLASS,
  type ApprovedJobRecordData,
  type JobDetailData,
  type JobStatus,
  type JobVerdict,
  type JobVerdictLevel,
  type ReviewFormula,
  type ReviewMethodField,
} from '@/features/jobs/detail-model'
import {
  buildJobApprovalInput,
  isJobApprovalBlockedByEnvironment,
  isScopeViolationError,
} from '@/features/jobs/approval-model'
import {
  ACTION_BUTTON_CLASS,
  BlueprintOverlay,
  InfoHint,
  Panel,
  SignalTile,
  StaggerGroup,
  StaggerItem,
  type SignalTone,
} from '@/components/instrument-panel'
import { cn } from '@/lib/utils'

type HugeIcon = Parameters<typeof HugeiconsIcon>[0]['icon']

const VERDICT_PRESENTATION: Record<
  JobVerdictLevel,
  {
    label: string
    description: string
    tone: SignalTone
    icon: HugeIcon
  }
> = {
  conforme: {
    label: 'Conforme',
    description: 'Todos os critérios e pontos dentro da tolerância.',
    tone: 'ok',
    icon: CheckmarkBadge02Icon,
  },
  nao_conforme: {
    label: 'Não conforme',
    description: 'Há critérios reprovados ou pontos fora da tolerância.',
    tone: 'critical',
    icon: Alert02Icon,
  },
  atencao: {
    label: 'Conforme com ressalvas',
    description: 'Avisos ou condições ambientais exigem justificativa.',
    tone: 'warning',
    icon: Alert02Icon,
  },
  incompleto: {
    label: 'Evidência incompleta',
    description: 'Faltam leituras ou resultados calculados.',
    tone: 'neutral',
    icon: Clock01Icon,
  },
}

const VERDICT_EMBLEM_CLASS: Record<SignalTone, string> = {
  ok: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400',
  critical: 'bg-destructive/12 text-destructive',
  warning: 'bg-amber-500/12 text-amber-700 dark:text-amber-400',
  info: 'bg-primary/12 text-primary',
  neutral: 'bg-muted text-muted-foreground',
}

const VERDICT_TEXT_CLASS: Record<SignalTone, string> = {
  ok: 'text-emerald-700 dark:text-emerald-400',
  critical: 'text-destructive',
  warning: 'text-amber-700 dark:text-amber-400',
  info: 'text-primary',
  neutral: 'text-foreground',
}

function buildVerdictTiles(verdict: JobVerdict): Array<{
  key: string
  icon: HugeIcon
  label: string
  value: string
  hint?: string
  tone: SignalTone
}> {
  const tiles: Array<{
    key: string
    icon: HugeIcon
    label: string
    value: string
    hint?: string
    tone: SignalTone
  }> = [
    {
      key: 'points',
      icon: Target02Icon,
      label: 'Pontos na tolerância',
      value:
        verdict.pointsTotal > 0
          ? `${verdict.pointsWithin}/${verdict.pointsTotal}`
          : '-',
      hint: verdict.pointsTotal > 0 ? 'pontos' : 'sem pontos',
      tone:
        verdict.pointsTotal === 0
          ? 'neutral'
          : verdict.pointsOutOfTolerance > 0
            ? 'critical'
            : 'ok',
    },
    {
      key: 'criteria',
      icon: TaskDone01Icon,
      label: 'Critérios atendidos',
      value:
        verdict.criteriaTotal > 0
          ? `${verdict.criteriaPassed}/${verdict.criteriaTotal}`
          : '-',
      hint: verdict.criteriaTotal > 0 ? 'critérios' : 'nenhum',
      tone:
        verdict.criteriaTotal === 0
          ? 'neutral'
          : verdict.criteriaFailed > 0
            ? 'critical'
            : verdict.criteriaWarning > 0
              ? 'warning'
              : 'ok',
    },
    {
      key: 'environment',
      icon: ThermometerIcon,
      label: 'Ambiente',
      value:
        verdict.environment === 'within'
          ? 'Dentro'
          : verdict.environment === 'out'
            ? 'Fora'
            : '-',
      hint: 'condições',
      tone:
        verdict.environment === 'within'
          ? 'ok'
          : verdict.environment === 'out'
            ? 'warning'
            : 'neutral',
    },
    {
      key: 'traceability',
      icon: RulerIcon,
      label: 'Rastreabilidade',
      value: String(verdict.standardsCount),
      hint: 'padrões',
      tone: verdict.standardsCount > 0 ? 'info' : 'critical',
    },
  ]

  if (verdict.expandedUncertainty) {
    tiles.push({
      key: 'uncertainty',
      icon: FunctionIcon,
      label: 'Incerteza U (máx.)',
      value: verdict.expandedUncertainty,
      hint: 'expandida',
      tone: 'neutral',
    })
  }

  return tiles
}

type JobDetailPageProps = {
  id: string
  runtime: {
    isDesktop: boolean
  }
}

function toRecordArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return []
    }

    return [Object.fromEntries(Object.entries(item))]
  })
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  return Object.fromEntries(Object.entries(value))
}

function isNullableRecord(value: unknown) {
  return (
    value === null ||
    value === undefined ||
    (typeof value === 'object' && !Array.isArray(value))
  )
}

function isApprovedJobRecordData(
  value: unknown,
): value is ApprovedJobRecordData {
  const job = toRecord(value)
  const methodSnapshot = toRecord(job.methodSnapshot)

  return (
    typeof job.id === 'number' &&
    typeof job.jobId === 'string' &&
    typeof job.status === 'string' &&
    isNullableRecord(job.data) &&
    isNullableRecord(job.results) &&
    typeof methodSnapshot.methodId === 'number' &&
    typeof methodSnapshot.methodName === 'string' &&
    typeof methodSnapshot.methodVersion === 'number' &&
    Array.isArray(methodSnapshot.dataFields) &&
    Array.isArray(methodSnapshot.formulas) &&
    Array.isArray(methodSnapshot.validations) &&
    typeof job.createdAt === 'string'
  )
}

function toJobStatus(value: unknown): JobStatus {
  switch (value) {
    case 'DRAFT':
    case 'IN_PROGRESS':
    case 'REVIEW':
    case 'APPROVED':
    case 'REJECTED':
    case 'CANCELED':
    case 'GENERATING_PDF':
    case 'SUPERSEDED':
      return value
    default:
      return 'DRAFT'
  }
}

function toFinancialStatus(value: unknown): FinancialStatus {
  switch (value) {
    case 'DRAFT':
    case 'ISSUED':
    case 'PAID':
    case 'OVERDUE':
    case 'VOID':
    case 'UNBILLED':
      return value
    default:
      return 'UNBILLED'
  }
}

export function JobDetailPage({ id, runtime }: JobDetailPageProps) {
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
  } = useJobDetailData<JobDetailData>({
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

  const saveLocalCertificatePdfMutation = useMutation({
    mutationFn: async () => {
      if (!window.calibraBridge) {
        throw new Error('Exportação local disponível apenas no desktop')
      }

      // The host names the file from these; without them the operator gets a
      // downloads folder full of files named after numeric job ids.
      return window.calibraBridge.saveCertificatePdf({
        jobId: id,
        // Optional on the wire, so an unloaded job still saves — it just
        // gets a plainer name. The button only renders once loaded anyway.
        certificateNumber: job?.jobId ?? null,
        customerName: job?.customerName ?? null,
      })
    },
    onSuccess: (filePath) => {
      // A cancelled dialog is not a failure and not a success — say nothing.
      if (!filePath) return

      toast.success('PDF local salvo', {
        description: filePath,
        action: {
          label: 'Mostrar na pasta',
          onClick: () => {
            void window.calibraBridge?.revealFile(filePath).then((revealed) => {
              if (!revealed) {
                toast.error('O arquivo não está mais nesse local.')
              }
            })
          },
        },
      })
      queryClient.invalidateQueries({ queryKey: ['jobs', id] })
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  const reviewModel = useMemo(() => buildJobReviewModel(job), [job])
  const {
    reviewDataFields,
    reviewFormulas,
    reviewValidations,
    reviewStandards,
    displayUnitForReview,
    displayReviewData,
    displayReviewResults,
    reviewHasData,
    reviewHasResults,
    criticalReviewFields,
    reviewContextItems,
    orderedReviewFormulas,
    adjustmentSummaryRows,
    quickAlertItems,
    verdict,
  } = reviewModel

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
  const canAssign = ['DRAFT', 'IN_PROGRESS', 'REJECTED'].includes(job.status)
  const financialStatus =
    typeof job.financialStatus === 'string' ? job.financialStatus : 'UNBILLED'
  const normalizedFinancialStatus = toFinancialStatus(financialStatus)
  const normalizedJobStatus = toJobStatus(job.status)
  const renderReviewFieldValue = (field: ReviewMethodField) => {
    const value = displayReviewData?.[field.key]

    if (
      field.type === 'table' &&
      field.key === 'repetibilidade' &&
      field.columns &&
      Array.isArray(value)
    ) {
      return (
        <RepeatabilityTable
          columns={field.columns}
          value={value}
          displayUnit={displayUnitForReview}
        />
      )
    }

    if (field.type === 'table' && field.columns && Array.isArray(value)) {
      const columns = field.columns
      return (
        <div className="max-w-full overflow-x-auto rounded-lg bg-background shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]">
          <Table className="min-w-max text-[13px]">
            <TableHeader className="bg-muted/50">
              <TableRow>
                {field.columns.map((column) => (
                  <TableHead
                    key={column.key}
                    className="h-11 whitespace-nowrap px-3 text-xs"
                  >
                    {reviewColumnDisplayLabel(column)}
                    {displayUnitForReview(column.unit) && (
                      <span className="ml-1 text-xs text-muted-foreground">
                        ({displayUnitForReview(column.unit)})
                      </span>
                    )}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {toRecordArray(value).map((row, index) => (
                <TableRow key={index} className="hover:bg-muted/30">
                  {columns.map((column) => {
                    const cellValue = row[column.key]
                    const isComposition = isMassCompositionValue(cellValue)
                    return (
                      <TableCell
                        key={column.key}
                        className={
                          isComposition
                            ? 'min-w-44 max-w-72 whitespace-normal px-3 font-sans text-sm leading-snug'
                            : 'whitespace-nowrap px-3 font-mono tabular-nums'
                        }
                      >
                        {formatReviewValue(
                          cellValue,
                          displayUnitForReview(column.unit),
                        )}
                      </TableCell>
                    )
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )
    }

    return (
      <div className="rounded-lg bg-background p-3 font-mono text-sm tabular-nums shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]">
        {formatReviewValue(value, displayUnitForReview(field.unit))}
      </div>
    )
  }

  const renderReviewResult = (formula: ReviewFormula) => {
    const value = displayReviewResults?.[formula.outputKey]
    const validation = reviewValidations.find((candidate) =>
      `${candidate.leftExpression} ${candidate.rightExpression}`.includes(
        formula.outputKey,
      ),
    )
    const hasValue = value !== undefined && value !== null

    return (
      <div className="flex flex-col gap-3 rounded-lg bg-background p-3 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)] transition-[background-color,box-shadow] hover:bg-muted/20 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-balance">
            {formula.label || formula.outputKey}
          </p>
          {validation && (
            <p className="mt-1 text-xs text-pretty text-muted-foreground">
              {validation.message}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="break-all font-mono text-base tabular-nums sm:text-lg">
            {formatReviewValue(value, displayUnitForReview(formula.unit))}
          </span>
          {validation && hasValue && (
            <Badge
              variant={
                validation.severity === 'error' ? 'destructive' : 'outline'
              }
              className="shrink-0"
            >
              {validation.severity === 'error' ? 'Critério' : 'Aviso'}
            </Badge>
          )}
        </div>
      </div>
    )
  }

  const renderMarginBadge = (margin: number | null, unit?: string) => {
    if (margin == null) {
      return <span className="text-muted-foreground">-</span>
    }

    const isInside = margin >= 0
    return (
      <span
        className={cn(
          'inline-flex items-center rounded-md px-2 py-0.5 font-mono text-xs font-medium tabular-nums shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]',
          isInside
            ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
            : 'bg-destructive/10 text-destructive',
        )}
      >
        {isInside ? '+' : ''}
        {formatCalibrationValue(margin)}
        {unit ? ` ${unit}` : ''}
      </span>
    )
  }

  const renderAcceptanceBadge = (
    status: 'ok' | 'error' | 'warning' | 'unknown',
  ) => {
    const presentation: Record<typeof status, { label: string; cls: string }> =
      {
        ok: {
          label: 'OK',
          cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
        },
        error: { label: 'Atenção', cls: 'bg-destructive/10 text-destructive' },
        warning: {
          label: 'Aviso',
          cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
        },
        unknown: { label: 'Verificar', cls: 'bg-muted text-muted-foreground' },
      }
    const item = presentation[status]

    return (
      <span
        className={cn(
          'inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-xs font-medium shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]',
          item.cls,
        )}
      >
        {item.label}
      </span>
    )
  }

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
      {job.supersedesId && (
        <Card className="border-amber-300 bg-amber-50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 text-amber-700">
              <HugeiconsIcon icon={Edit02Icon} className="h-5 w-5" />
              Retificação de Certificado
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-amber-700">
              Esta calibração é uma <strong>retificação</strong> (versão{' '}
              {job.amendmentNumber || 1}) que substituirá o certificado original
              após aprovação.
            </p>
            {job.amendmentReason && (
              <div className="mt-3 p-3 bg-white/60 rounded-md border border-amber-200">
                <p className="text-xs font-medium text-amber-800 mb-1">
                  Motivo da retificação:
                </p>
                <p className="text-sm text-amber-900">{job.amendmentReason}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Verdict band — identity, conformance summary and the decision */}
      <Panel className="relative overflow-hidden">
        <BlueprintOverlay />
        <div className="relative flex flex-col gap-5 p-5 sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h1 className="text-balance font-mono text-2xl font-semibold tracking-tight">
                {job.jobId}
              </h1>
              <p className="mt-1 text-pretty text-sm text-muted-foreground">
                {job.serviceName}
                {job.methodSnapshot.methodName && (
                  <span className="ml-2 text-xs">
                    ({job.methodSnapshot.methodName} v
                    {job.methodSnapshot.methodVersion})
                  </span>
                )}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 sm:justify-end">
              {/* The generating state is conveyed by the animated approval
                  button, so the status badge is hidden while the PDF renders
                  instead of repeating an amber "Gerando PDF…" pill. */}
              {!isGeneratingPdf && (
                <Badge variant={JOB_STATUS_VARIANTS[normalizedJobStatus]}>
                  {JOB_STATUS_LABELS[normalizedJobStatus]}
                </Badge>
              )}
              {job.isOverdue && <Badge variant="destructive">Atrasado</Badge>}
              {(job.status === 'APPROVED' || job.status === 'SUPERSEDED') &&
                job.asFoundConformity === 'NON_CONFORMING' && (
                  <Badge variant="destructive">
                    Fora de tolerância (como encontrado)
                  </Badge>
                )}
              <Badge variant={getFinancialVariant(normalizedFinancialStatus)}>
                {getFinancialStatusLabel(normalizedFinancialStatus)}
              </Badge>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
            <div className="flex items-start gap-4">
              <span
                className={cn(
                  'flex size-14 shrink-0 items-center justify-center rounded-2xl',
                  VERDICT_EMBLEM_CLASS[
                    VERDICT_PRESENTATION[verdict.level].tone
                  ],
                )}
              >
                <HugeiconsIcon
                  icon={VERDICT_PRESENTATION[verdict.level].icon}
                  className="size-7"
                />
              </span>
              <div className="min-w-0">
                <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  Veredito de conformidade
                </p>
                <p
                  className={cn(
                    'text-balance text-2xl font-semibold',
                    VERDICT_TEXT_CLASS[
                      VERDICT_PRESENTATION[verdict.level].tone
                    ],
                  )}
                >
                  {VERDICT_PRESENTATION[verdict.level].label}
                </p>
                <p className="mt-0.5 text-pretty text-sm text-muted-foreground">
                  {VERDICT_PRESENTATION[verdict.level].description}
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap lg:justify-end">
              {isGeneratingPdf ? (
                <CertificateProgressButton status="running" />
              ) : canApprove ? (
                <>
                  <ActionAvailabilityGate availability={approveAvailability}>
                    {({ disabled }) => (
                      <CertificateProgressButton
                        status="idle"
                        disabled={disabled}
                        onApprove={() => setApproveDialogOpen(true)}
                      />
                    )}
                  </ActionAvailabilityGate>
                  <ActionAvailabilityGate availability={rejectAvailability}>
                    {({ disabled }) => (
                      <Button
                        variant="destructive"
                        disabled={disabled}
                        className={ACTION_BUTTON_CLASS}
                        onClick={() => setRejectDialogOpen(true)}
                      >
                        <HugeiconsIcon
                          icon={MultiplicationSignIcon}
                          className="mr-2 h-4 w-4"
                        />
                        Rejeitar
                      </Button>
                    )}
                  </ActionAvailabilityGate>
                </>
              ) : canExecute ? (
                <>
                  <Button
                    className={ACTION_BUTTON_CLASS}
                    render={
                      <Link to="/dashboard/jobs/$id/execute" params={{ id }} />
                    }
                  >
                    <HugeiconsIcon
                      icon={Calendar03Icon}
                      className="mr-2 h-4 w-4"
                    />
                    {job.status === 'DRAFT'
                      ? 'Iniciar execução'
                      : 'Continuar execução'}
                  </Button>
                  {canAssign && (
                    <ActionAvailabilityGate availability={assignAvailability}>
                      {({ disabled }) => (
                        <Button
                          variant="outline"
                          disabled={disabled}
                          className={ACTION_BUTTON_CLASS}
                          onClick={() => setAssignDialogOpen(true)}
                        >
                          <HugeiconsIcon
                            icon={UserAdd01Icon}
                            className="mr-2 h-4 w-4"
                          />
                          Atribuir técnico
                        </Button>
                      )}
                    </ActionAvailabilityGate>
                  )}
                </>
              ) : (
                <p className="max-w-xs text-pretty text-sm text-muted-foreground">
                  Nenhuma ação disponível neste estado.
                </p>
              )}
            </div>
          </div>

          <StaggerGroup className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
            {buildVerdictTiles(verdict).map((tile) => (
              <StaggerItem key={tile.key}>
                <SignalTile
                  icon={tile.icon}
                  label={tile.label}
                  value={tile.value}
                  hint={tile.hint}
                  tone={tile.tone}
                />
              </StaggerItem>
            ))}
          </StaggerGroup>

          {canCancel && (
            <div className="border-t border-foreground/10 pt-3">
              <ActionAvailabilityGate availability={cancelAvailability}>
                {({ disabled }) => (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={disabled}
                    className={cn(
                      ACTION_BUTTON_CLASS,
                      'text-destructive hover:bg-destructive/10 hover:text-destructive',
                    )}
                    onClick={() => setCancelDialogOpen(true)}
                  >
                    <HugeiconsIcon
                      icon={Cancel01Icon}
                      className="mr-2 h-4 w-4"
                    />
                    Cancelar calibração
                  </Button>
                )}
              </ActionAvailabilityGate>
            </div>
          )}
        </div>
      </Panel>

      {canShowReviewEvidence ? (
        <>
          <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
            <main className="min-w-0 space-y-6">
              <section className={`${REVIEW_SURFACE_CLASS} p-4`}>
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Evidência para aprovação
                    </p>
                    <h2 className="text-balance text-lg font-semibold">
                      Leituras, resultados e rastreabilidade do job
                    </h2>
                    <p className="mt-1 text-pretty text-sm text-muted-foreground">
                      {isGeneratingPdf
                        ? 'A aprovação foi registrada. Mantemos a evidência visível enquanto o certificado é gerado.'
                        : 'Revise os dados executados antes de aprovar o certificado da Laboratório Exemplo.'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="w-fit">
                      {isGeneratingPdf
                        ? 'Gerando PDF'
                        : reviewHasData
                          ? 'Dados capturados'
                          : 'Sem dados'}
                    </Badge>
                    {runtime.isDesktop && (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className={ACTION_BUTTON_CLASS}
                        onClick={() => saveLocalCertificatePdfMutation.mutate()}
                        disabled={saveLocalCertificatePdfMutation.isPending}
                      >
                        {saveLocalCertificatePdfMutation.isPending && (
                          <Spinner className="mr-2 size-3" />
                        )}
                        Salvar PDF local
                      </Button>
                    )}
                  </div>
                </div>
                <div className="grid gap-px overflow-hidden rounded-lg bg-black/5 md:grid-cols-3">
                  <div className="bg-background p-3">
                    <label className="text-xs font-medium text-muted-foreground">
                      Cliente
                    </label>
                    <p className="mt-1 text-sm font-medium">
                      {job.customerName || '-'}
                    </p>
                  </div>
                  <div className="bg-background p-3">
                    <label className="text-xs font-medium text-muted-foreground">
                      Ativo
                    </label>
                    <p className="mt-1 text-sm">
                      {job.assetName || '-'}
                      {job.assetTag && (
                        <span className="ml-1 font-mono text-muted-foreground">
                          ({job.assetTag})
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="bg-background p-3">
                    <label className="text-xs font-medium text-muted-foreground">
                      Executado em
                    </label>
                    <p className="mt-1 font-mono text-sm tabular-nums">
                      {formatDateTime(job.performedAt)}
                    </p>
                  </div>
                </div>
                {reviewContextItems.length > 0 ? (
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {reviewContextItems.map((item) => (
                      <div
                        key={item.key}
                        className="min-w-0 rounded-md bg-muted/20 px-3 py-3"
                      >
                        <p className="text-xs font-medium text-muted-foreground">
                          {item.label}
                        </p>
                        <p className="mt-1 whitespace-pre-wrap break-words font-mono text-sm leading-snug tabular-nums">
                          {item.value}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">
                    Nenhuma especificação técnica congelada no job.
                  </p>
                )}
              </section>

              <section className={`${REVIEW_SURFACE_CLASS} p-4`}>
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Primeiro olhar
                    </p>
                    <h2 className="text-balance text-base font-semibold">
                      Ajuste antes vs. depois por ponto
                    </h2>
                    <p className="text-pretty text-sm text-muted-foreground">
                      Mostra rapidamente o erro e a margem de conformidade antes
                      e após o ajuste.
                    </p>
                  </div>
                  <Badge variant="outline" className="w-fit">
                    {adjustmentSummaryRows.length} pontos
                  </Badge>
                </div>
                {adjustmentSummaryRows.length > 0 ? (
                  <div className="max-w-full overflow-x-auto rounded-lg bg-background shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]">
                    <Table className="min-w-max text-[13px]">
                      <TableHeader className="bg-muted/50">
                        <TableRow className="hover:bg-transparent">
                          <TableHead
                            rowSpan={2}
                            className="h-9 whitespace-nowrap border-r border-foreground/10 px-3 align-bottom text-[11px] font-semibold uppercase tracking-wider"
                          >
                            Ponto
                          </TableHead>
                          <TableHead
                            colSpan={3}
                            className="h-9 whitespace-nowrap px-3 text-center text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground"
                          >
                            Antes do ajuste
                          </TableHead>
                          <TableHead
                            colSpan={3}
                            className="h-9 whitespace-nowrap border-l border-foreground/10 px-3 text-center text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground"
                          >
                            Após o ajuste
                          </TableHead>
                        </TableRow>
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="h-9 whitespace-nowrap px-3 text-xs">
                            Leituras
                          </TableHead>
                          <TableHead className="h-9 whitespace-nowrap px-3 text-xs">
                            Erro
                          </TableHead>
                          <TableHead className="h-9 whitespace-nowrap px-3 text-xs">
                            Margem
                          </TableHead>
                          <TableHead className="h-9 whitespace-nowrap border-l border-foreground/10 px-3 text-xs">
                            Leituras
                          </TableHead>
                          <TableHead className="h-9 whitespace-nowrap px-3 text-xs">
                            Erro
                          </TableHead>
                          <TableHead className="h-9 whitespace-nowrap px-3 text-xs">
                            Margem
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {adjustmentSummaryRows.map((row) => (
                          <TableRow
                            key={row.key}
                            className="even:bg-muted/20 hover:bg-muted/40"
                          >
                            <TableCell className="whitespace-nowrap border-r border-foreground/10 px-3 font-mono font-medium tabular-nums">
                              {formatReviewValue(
                                row.point,
                                displayUnitForReview('g'),
                              )}
                            </TableCell>
                            <TableCell className="min-w-36 px-3 font-mono text-xs tabular-nums text-muted-foreground">
                              {row.beforeReadings
                                .map((reading) =>
                                  formatReviewValue(
                                    reading,
                                    displayUnitForReview('g'),
                                  ),
                                )
                                .join(' / ')}
                            </TableCell>
                            <TableCell className="whitespace-nowrap px-3 font-mono tabular-nums">
                              {formatReviewValue(
                                row.beforeError,
                                displayUnitForReview('g'),
                              )}
                            </TableCell>
                            <TableCell className="whitespace-nowrap px-3">
                              {renderMarginBadge(
                                row.beforeMargin,
                                displayUnitForReview('g'),
                              )}
                            </TableCell>
                            <TableCell className="min-w-36 border-l border-foreground/10 px-3 font-mono text-xs tabular-nums text-muted-foreground">
                              {row.afterReadings
                                .map((reading) =>
                                  formatReviewValue(
                                    reading,
                                    displayUnitForReview('g'),
                                  ),
                                )
                                .join(' / ')}
                            </TableCell>
                            <TableCell className="whitespace-nowrap px-3 font-mono tabular-nums">
                              {formatReviewValue(
                                row.afterError,
                                displayUnitForReview('g'),
                              )}
                            </TableCell>
                            <TableCell className="whitespace-nowrap px-3">
                              {renderMarginBadge(
                                row.afterMargin,
                                displayUnitForReview('g'),
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                    Não há pontos de indicação para resumir.
                  </div>
                )}
              </section>

              <section className={`${REVIEW_SURFACE_CLASS} p-4`}>
                <div className="mb-4">
                  <h2 className="text-balance text-base font-semibold">
                    Ensaios principais
                  </h2>
                  <p className="text-pretty text-sm text-muted-foreground">
                    Indicação, excentricidade e repetibilidade aparecem antes
                    dos dados de apoio.
                  </p>
                </div>
                {criticalReviewFields.length > 0 ? (
                  <div className="space-y-5">
                    {criticalReviewFields.map((field) => (
                      <div key={field.key}>
                        <label className="mb-2 block text-sm font-medium text-muted-foreground">
                          {field.label}
                          {displayUnitForReview(field.unit) && (
                            <span className="ml-1 text-xs">
                              ({displayUnitForReview(field.unit)})
                            </span>
                          )}
                        </label>
                        <div className="rounded-lg bg-muted/20 p-2">
                          {renderReviewFieldValue(field)}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                    Nenhum ensaio principal foi registrado para este job.
                  </div>
                )}
              </section>

              <section className={`${REVIEW_SURFACE_CLASS} p-4`}>
                <Accordion>
                  <AccordionItem value="calculated-results">
                    <AccordionTrigger className="min-h-10 py-0 hover:no-underline">
                      <div className="min-w-0">
                        <h2 className="text-balance text-base font-semibold">
                          Resultados Calculados
                        </h2>
                        <p className="text-pretty text-sm font-normal text-muted-foreground">
                          Fórmulas e valores detalhados para auditoria.
                        </p>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="pt-4">
                      {reviewHasResults ? (
                        <div className="space-y-3">
                          {orderedReviewFormulas.map((formula) => (
                            <div key={formula.outputKey}>
                              {renderReviewResult(formula)}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                          Nenhum resultado calculado foi armazenado.
                        </div>
                      )}
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </section>

              {reviewStandards.length > 0 && (
                <section className={`${REVIEW_SURFACE_CLASS} p-4`}>
                  <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <h2 className="inline-flex items-center gap-1.5 text-balance text-base font-semibold">
                        Padrões utilizados
                        <InfoHint label="Sobre rastreabilidade metrológica">
                          Cada medição se liga a referências reconhecidas por
                          uma cadeia contínua e documentada de calibrações, e
                          cada elo contribui para a incerteza do resultado.
                        </InfoHint>
                      </h2>
                      <p className="text-pretty text-sm text-muted-foreground">
                        Cada padrão tem certificado e incerteza próprios, que
                        alimentam o orçamento de incerteza.
                      </p>
                    </div>
                    <Badge variant="outline" className="w-fit">
                      <span className="tabular-nums">
                        {reviewStandards.length}
                      </span>
                      {reviewStandards.length === 1 ? ' padrão' : ' padrões'}
                    </Badge>
                  </div>
                  <div className="grid gap-2">
                    {reviewStandards.map((standard) => (
                      <div
                        key={standard.id}
                        className="rounded-xl bg-background p-3 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)] transition-[background-color,box-shadow] hover:bg-muted/20"
                      >
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-balance">
                              {standard.name}
                            </p>
                            {standard.type && (
                              <p className="text-xs text-muted-foreground">
                                {standard.type}
                              </p>
                            )}
                            <p className="inline-flex flex-wrap items-center gap-1 break-all text-sm text-muted-foreground">
                              Certificado: {standard.certificateNumber}
                              <InfoHint label="Sobre o certificado do padrão">
                                Número do certificado de calibração do padrão,
                                que comprova documentalmente a rastreabilidade.
                              </InfoHint>
                            </p>
                          </div>
                          <div className="shrink-0 text-left text-sm sm:text-right">
                            <p className="font-mono tabular-nums">
                              {formatDate(standard.calibrationDate)}
                            </p>
                            {standard.uncertainty != null && (
                              <p className="inline-flex flex-wrap items-center gap-1 font-mono tabular-nums text-muted-foreground sm:justify-end">
                                U ={' '}
                                {formatCalibrationValue(standard.uncertainty)}{' '}
                                {standard.uncertaintyUnit || ''} (k=
                                {standard.coverageFactor})
                                <InfoHint
                                  label="Sobre incerteza e fator de abrangência"
                                  side="left"
                                >
                                  <span className="font-medium">U</span>:
                                  incerteza expandida do padrão.{' '}
                                  <span className="font-medium">k</span>: fator
                                  de abrangência; k = 2 corresponde a cerca de
                                  95% de confiança. Soma-se ao orçamento de
                                  incerteza desta calibração.
                                </InfoHint>
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </main>

            <aside className="min-w-0 space-y-6 xl:sticky xl:top-6">
              <section className={`${REVIEW_SURFACE_CLASS} p-4`}>
                <div className="mb-3 flex items-center gap-2">
                  <HugeiconsIcon
                    icon={Alert02Icon}
                    className="h-4 w-4 text-muted-foreground"
                  />
                  <h2 className="text-base font-semibold">
                    Critérios e avisos
                  </h2>
                </div>
                {quickAlertItems.length > 0 ? (
                  <div className="space-y-2">
                    {quickAlertItems.map((item) => (
                      <div
                        key={item.key}
                        className="rounded-lg bg-background p-3 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]"
                      >
                        <div className="flex min-w-0 items-start justify-between gap-3">
                          <p className="min-w-0 text-pretty text-sm leading-snug">
                            {item.message}
                          </p>
                          {renderAcceptanceBadge(item.status)}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Nenhum critério de aceitação configurado.
                  </p>
                )}
              </section>

              <section className={`${REVIEW_SURFACE_CLASS} p-4`}>
                <h2 className="mb-3 text-base font-semibold">
                  Checklist rápido
                </h2>
                <div className="space-y-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">
                      Leituras registradas
                    </span>
                    <Badge variant={reviewHasData ? 'outline' : 'destructive'}>
                      {reviewHasData ? 'Sim' : 'Não'}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">
                      Resultados calculados
                    </span>
                    <Badge
                      variant={reviewHasResults ? 'outline' : 'destructive'}
                    >
                      {reviewHasResults ? 'Sim' : 'Não'}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">
                      Padrões vinculados
                    </span>
                    <Badge
                      variant={
                        reviewStandards.length > 0 ? 'outline' : 'destructive'
                      }
                    >
                      {reviewStandards.length || 'Não'}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">Financeiro</span>
                    <Badge variant={getFinancialVariant(financialStatus)}>
                      {getFinancialStatusLabel(normalizedFinancialStatus)}
                    </Badge>
                  </div>
                </div>
              </section>

              <section className={`${REVIEW_SURFACE_CLASS} p-4`}>
                <h2 className="mb-3 text-base font-semibold">
                  Contexto operacional
                </h2>
                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">
                      Técnico responsável
                    </label>
                    <p className="text-sm">
                      {job.technicianName || 'Não atribuído'}
                    </p>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">
                      Prazo
                    </label>
                    <p className="font-mono text-sm tabular-nums">
                      {formatDate(job.dueDate)}
                    </p>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">
                      Método
                    </label>
                    <p className="text-sm">
                      {job.methodSnapshot.methodName} v
                      {job.methodSnapshot.methodVersion}
                    </p>
                  </div>
                </div>
              </section>
            </aside>
          </div>
        </>
      ) : (
        <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <main className="min-w-0 space-y-6">
            <section className={`${REVIEW_SURFACE_CLASS} p-4`}>
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Preparação da execução
                  </p>
                  <h2 className="text-balance text-lg font-semibold">
                    Confirme o job antes de iniciar a calibração
                  </h2>
                  <p className="mt-1 text-pretty text-sm text-muted-foreground">
                    Cliente, ativo, técnico, prazo e especificações ficam juntos
                    para comparar com a ficha física antes da primeira leitura.
                  </p>
                </div>
                <Badge variant={job.technicianName ? 'outline' : 'secondary'}>
                  {job.technicianName ? 'Atribuído' : 'Sem técnico'}
                </Badge>
              </div>

              <div className="grid gap-px overflow-hidden rounded-lg bg-black/5 md:grid-cols-4">
                <div className="bg-background p-3">
                  <label className="text-xs font-medium text-muted-foreground">
                    Cliente
                  </label>
                  <p className="mt-1 text-sm font-medium">
                    {job.customerName || '-'}
                  </p>
                </div>
                <div className="bg-background p-3 md:col-span-2">
                  <label className="text-xs font-medium text-muted-foreground">
                    Ativo
                  </label>
                  <p className="mt-1 text-sm">
                    {job.assetName || '-'}
                    {job.assetTag && (
                      <span className="ml-1 font-mono text-muted-foreground">
                        ({job.assetTag})
                      </span>
                    )}
                  </p>
                </div>
                <div className="bg-background p-3">
                  <label className="text-xs font-medium text-muted-foreground">
                    Prazo
                  </label>
                  <p className="mt-1 font-mono text-sm tabular-nums">
                    {formatDate(job.dueDate)}
                    {job.daysUntilDue != null && job.daysUntilDue > 0 && (
                      <Badge variant="outline" className="ml-2 text-xs">
                        {job.daysUntilDue} dias
                      </Badge>
                    )}
                  </p>
                </div>
              </div>

              {reviewContextItems.length > 0 ? (
                <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {reviewContextItems.map((item) => (
                    <div
                      key={item.key}
                      className="min-w-0 rounded-md bg-muted/20 px-3 py-3"
                    >
                      <p className="text-xs font-medium text-muted-foreground">
                        {item.label}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap break-words font-mono text-sm leading-snug tabular-nums">
                        {item.value}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">
                  Nenhuma especificação técnica congelada no job.
                </p>
              )}
            </section>

            <section className={`${REVIEW_SURFACE_CLASS} p-4`}>
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Método congelado
                  </p>
                  <h2 className="text-balance text-base font-semibold">
                    {job.methodSnapshot.methodName || 'Método de calibração'}
                  </h2>
                  <p className="text-pretty text-sm text-muted-foreground">
                    Snapshot usado para executar o job, emitir o certificado e
                    auditar os cálculos depois.
                  </p>
                </div>
                {job.methodSnapshot.methodVersion && (
                  <Badge variant="outline">
                    v{job.methodSnapshot.methodVersion}
                  </Badge>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg bg-background p-3 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]">
                  <p className="text-xs font-medium text-muted-foreground">
                    Campos de entrada
                  </p>
                  <p className="mt-1 font-mono text-2xl font-semibold tabular-nums">
                    {reviewDataFields.length}
                  </p>
                </div>
                <div className="rounded-lg bg-background p-3 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]">
                  <p className="text-xs font-medium text-muted-foreground">
                    Fórmulas
                  </p>
                  <p className="mt-1 font-mono text-2xl font-semibold tabular-nums">
                    {reviewFormulas.length}
                  </p>
                </div>
                <div className="rounded-lg bg-background p-3 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]">
                  <p className="text-xs font-medium text-muted-foreground">
                    Critérios de aceitação
                  </p>
                  <p className="mt-1 font-mono text-2xl font-semibold tabular-nums">
                    {reviewValidations.length}
                  </p>
                </div>
              </div>

              {reviewValidations.length > 0 && (
                <div className="mt-4 space-y-2">
                  <h3 className="text-sm font-medium">Critérios principais</h3>
                  {reviewValidations.map((validation, index) => (
                    <div
                      key={`${validation.leftExpression}-${validation.operator}-${validation.rightExpression}-${index}`}
                      className="rounded-lg bg-muted/20 px-3 py-2 text-sm text-pretty"
                    >
                      {validation.message}
                    </div>
                  ))}
                </div>
              )}
            </section>

            {reviewStandards.length > 0 && (
              <section className={`${REVIEW_SURFACE_CLASS} p-4`}>
                <div className="mb-4">
                  <h2 className="text-balance text-base font-semibold">
                    Padrões vinculados
                  </h2>
                  <p className="text-pretty text-sm text-muted-foreground">
                    Rastreabilidade prevista antes da execução.
                  </p>
                </div>
                <div className="grid gap-2">
                  {reviewStandards.map((standard) => (
                    <div
                      key={standard.id}
                      className="rounded-lg bg-background p-3 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)] transition-[background-color,box-shadow] hover:bg-muted/20"
                    >
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-balance">
                            {standard.name}
                          </p>
                          <p className="break-all text-sm text-muted-foreground">
                            Certificado: {standard.certificateNumber}
                          </p>
                        </div>
                        <div className="shrink-0 text-left text-sm sm:text-right">
                          <p className="font-mono tabular-nums">
                            {formatDate(standard.calibrationDate)}
                          </p>
                          {standard.uncertainty != null && (
                            <p className="font-mono tabular-nums text-muted-foreground">
                              U = {formatCalibrationValue(standard.uncertainty)}{' '}
                              {standard.uncertaintyUnit || ''} (k=
                              {standard.coverageFactor})
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {job.status === 'REJECTED' && job.rejectionReason && (
              <section
                className={`${REVIEW_SURFACE_CLASS} border border-destructive/30 p-4`}
              >
                <h2 className="text-base font-semibold text-destructive">
                  Motivo da rejeição
                </h2>
                <p className="mt-2 text-pretty text-sm">
                  {job.rejectionReason}
                </p>
                {job.rejectedAt && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Rejeitado em {formatDateTime(job.rejectedAt)}
                  </p>
                )}
              </section>
            )}
          </main>

          <aside className="min-w-0 space-y-6 xl:sticky xl:top-6">
            <section className={`${REVIEW_SURFACE_CLASS} p-4`}>
              <h2 className="mb-3 text-base font-semibold">
                Contexto operacional
              </h2>
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">
                    Técnico responsável
                  </label>
                  <p className="text-sm">
                    {job.technicianName || 'Não atribuído'}
                  </p>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">
                    Criado em
                  </label>
                  <p className="font-mono text-sm tabular-nums">
                    {formatDateTime(job.createdAt)}
                  </p>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">
                    Atualizado em
                  </label>
                  <p className="font-mono text-sm tabular-nums">
                    {formatDateTime(job.updatedAt)}
                  </p>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">
                    Cobrança
                  </label>
                  <p className="text-sm">
                    {job.invoiceEligibility
                      ? 'Elegível para cobrança'
                      : 'Não elegível para cobrança'}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {job.invoiceDocumentNumber || 'Ainda não faturada'}
                  </p>
                </div>
              </div>
            </section>
          </aside>
        </div>
      )}

      {/* Approve Dialog */}
      <Dialog
        open={approveDialogOpen}
        onOpenChange={(open) => {
          setApproveDialogOpen(open)
          if (!open) {
            setScopeViolationBlocked(false)
            setScopeOverrideJustification('')
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Aprovar Job</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja aprovar este job? Esta ação não pode ser
              desfeita.
            </DialogDescription>
          </DialogHeader>

          {/* Environmental out-of-limits warning */}
          {job?.environmentalSnapshot &&
            !job.environmentalSnapshot.withinLimits && (
              <div className="space-y-3">
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950">
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                    Condições ambientais fora dos limites
                  </p>
                  <div className="mt-1 text-xs text-amber-700 dark:text-amber-300 space-y-0.5">
                    {job.environmentalSnapshot.temperature != null &&
                      job.environmentalSnapshot.limits?.temperature && (
                        <p>
                          Temperatura: {job.environmentalSnapshot.temperature}{' '}
                          °C (limite:{' '}
                          {job.environmentalSnapshot.limits.temperature.min}–
                          {job.environmentalSnapshot.limits.temperature.max} °C)
                        </p>
                      )}
                    {job.environmentalSnapshot.humidity != null &&
                      job.environmentalSnapshot.limits?.humidity && (
                        <p>
                          Umidade: {job.environmentalSnapshot.humidity} %RH
                          (limite:{' '}
                          {job.environmentalSnapshot.limits.humidity.min}–
                          {job.environmentalSnapshot.limits.humidity.max} %RH)
                        </p>
                      )}
                    {job.environmentalSnapshot.pressure != null &&
                      job.environmentalSnapshot.limits?.pressure && (
                        <p>
                          Pressão: {job.environmentalSnapshot.pressure} hPa
                          (limite:{' '}
                          {job.environmentalSnapshot.limits.pressure.min}–
                          {job.environmentalSnapshot.limits.pressure.max} hPa)
                        </p>
                      )}
                  </div>
                </div>
                <Field>
                  <FieldLabel>Justificativa (obrigatória)</FieldLabel>
                  <Textarea
                    placeholder="Justifique a aprovação com condições fora dos limites..."
                    value={envJustification}
                    onChange={(e) => setEnvJustification(e.target.value)}
                    rows={3}
                  />
                </Field>
              </div>
            )}

          {/* #427 Phase 1: scope-violation override (only after the server
              blocked with SCOPE_VIOLATION). Approving here issues WITHOUT
              the accreditation seal. */}
          {scopeViolationBlocked && (
            <div className="space-y-3">
              <div className="rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950">
                <p className="text-sm font-medium text-red-800 dark:text-red-200">
                  Violação do escopo acreditado (CMC)
                </p>
                <p className="mt-1 text-xs text-red-700 dark:text-red-300">
                  O resultado viola o escopo acreditado do laboratório. Para
                  aprovar mesmo assim, justifique. O certificado será emitido
                  sem o selo de acreditação.
                </p>
              </div>
              <Field>
                <FieldLabel>Justificativa (obrigatória)</FieldLabel>
                <Textarea
                  placeholder="Justifique a emissão sem o selo de acreditação..."
                  value={scopeOverrideJustification}
                  onChange={(e) =>
                    setScopeOverrideJustification(e.target.value)
                  }
                  rows={3}
                />
              </Field>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setApproveDialogOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              className="bg-green-600 hover:bg-green-700"
              onClick={() => approveMutation.mutate()}
              disabled={
                approveMutation.isPending ||
                isJobApprovalBlockedByEnvironment(job, envJustification) ||
                (scopeViolationBlocked &&
                  scopeOverrideJustification.trim().length === 0)
              }
            >
              {approveMutation.isPending && <Spinner className="mr-2" />}
              {approveMutation.isPending
                ? 'Aprovando...'
                : scopeViolationBlocked
                  ? 'Aprovar sem selo'
                  : 'Aprovar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Dialog */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rejeitar Job</DialogTitle>
            <DialogDescription>
              Informe o motivo da rejeição. O técnico poderá corrigir e
              reenviar.
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel>Motivo da Rejeição *</FieldLabel>
            <Textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Descreva o motivo da rejeição..."
              rows={4}
            />
          </Field>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRejectDialogOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => rejectMutation.mutate()}
              disabled={rejectMutation.isPending || !rejectReason.trim()}
            >
              {rejectMutation.isPending ? 'Rejeitando...' : 'Rejeitar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel Dialog */}
      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancelar Calibração</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja cancelar esta calibração? Esta ação não
              pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel>Motivo do Cancelamento *</FieldLabel>
            <Textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Descreva o motivo do cancelamento..."
              rows={4}
            />
          </Field>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCancelDialogOpen(false)}
            >
              Voltar
            </Button>
            <Button
              variant="destructive"
              onClick={() => cancelMutation.mutate()}
              disabled={cancelMutation.isPending || !cancelReason.trim()}
            >
              {cancelMutation.isPending
                ? 'Cancelando...'
                : 'Confirmar Cancelamento'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign Technician Dialog */}
      <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Atribuir Técnico</DialogTitle>
            <DialogDescription>
              Selecione o técnico responsável pela execução deste job.
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel>Técnico</FieldLabel>
            <Select
              value={selectedTechnician}
              onValueChange={(value) => setSelectedTechnician(value ?? '')}
            >
              <SelectTrigger>
                <span>
                  {selectedTechnician
                    ? techniciansData?.data.find(
                        (t) => t.id === selectedTechnician,
                      )?.name
                    : 'Selecione um técnico...'}
                </span>
              </SelectTrigger>
              <SelectContent>
                {techniciansData?.data.map((tech) => (
                  <SelectItem key={tech.id} value={tech.id}>
                    {tech.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAssignDialogOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              onClick={() => assignMutation.mutate()}
              disabled={assignMutation.isPending || !selectedTechnician}
            >
              {assignMutation.isPending ? 'Atribuindo...' : 'Atribuir'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
