import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, useCallback, useMemo } from 'react'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowLeft01Icon,
  Calendar03Icon,
  Edit02Icon,
  CheckmarkCircle02Icon,
  Cancel01Icon,
  MultiplicationSignIcon,
  UserAdd01Icon,
  Alert02Icon,
} from '@hugeicons/core-free-icons'

import { api } from '@/utils/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { Spinner } from '@/components/ui/spinner'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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
  denormalizeAssetSpecificationsForDisplay,
  denormalizeMethodDataForDisplay,
  denormalizeMethodResultsForDisplay,
  formatCalibrationValue,
  getFinancialStatusLabel,
  resolveMassDisplayUnit,
  type MassUnit,
} from '@calibra-facil/shared'
import { ApprovedJobRecord } from './-components/approved-job-record'
import { apiRouteParam } from '@/lib/route-identifiers'
import { isMassCompositionValue } from '@/components/method-builder/mass-composition-utils'
import {
  formatWeighingRangeSpec,
  isWeighingRangeSpecArray,
} from '@/components/method-builder/weighing-range-utils'

export const Route = createFileRoute('/dashboard/jobs/$id/')({
  head: () => ({
    meta: [{ title: 'Detalhes do Job | CalibraFácil' }],
  }),
  component: JobDetailPage,
})

type JobStatus =
  | 'DRAFT'
  | 'IN_PROGRESS'
  | 'REVIEW'
  | 'GENERATING_PDF'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELED'
  | 'SUPERSEDED'

const statusLabels: Record<JobStatus, string> = {
  DRAFT: 'Rascunho',
  IN_PROGRESS: 'Em Execução',
  REVIEW: 'Em Revisão',
  GENERATING_PDF: 'Gerando PDF',
  APPROVED: 'Aprovado',
  REJECTED: 'Rejeitado',
  CANCELED: 'Cancelado',
  SUPERSEDED: 'Retificado',
}

const statusVariants: Record<
  JobStatus,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  DRAFT: 'secondary',
  IN_PROGRESS: 'default',
  REVIEW: 'outline',
  GENERATING_PDF: 'outline',
  APPROVED: 'default',
  REJECTED: 'destructive',
  CANCELED: 'secondary',
  SUPERSEDED: 'outline',
}

function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return '-'
  return new Date(dateString).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function formatDateTime(dateString: string | null | undefined): string {
  if (!dateString) return '-'
  return new Date(dateString).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getFinancialVariant(status: string | null | undefined) {
  switch (status) {
    case 'PAID':
      return 'outline'
    case 'OVERDUE':
      return 'destructive'
    case 'ISSUED':
      return 'default'
    case 'DRAFT':
      return 'secondary'
    case 'UNBILLED':
    default:
      return 'secondary'
  }
}

type ReviewMethodColumn = {
  key: string
  label: string
  type?: string
  unit?: string | null
}

type ReviewMethodField = {
  key: string
  label: string
  type: string
  unit?: string | null
  source?: string | null
  assetSpecKey?: string | null
  weighingRangeResolver?: {
    enabled?: boolean
    assetSpecKey?: string
  } | null
  columns?: ReviewMethodColumn[] | null
}

type ReviewFormula = {
  outputKey: string
  expression?: string
  label?: string | null
  unit?: string | null
}

type ReviewValidation = {
  expression: string
  message: string
  severity: 'error' | 'warning'
}

type ReviewMethodSnapshot = {
  methodName?: string | null
  methodVersion?: number | null
  dataFields?: ReviewMethodField[] | null
  formulas?: ReviewFormula[] | null
  validations?: ReviewValidation[] | null
}

type ReviewStandardSnapshot = {
  id: number
  name: string
  type?: string | null
  certificateNumber: string
  calibrationDate: string
  uncertainty: number | null
  uncertaintyUnit: string | null
  coverageFactor: number
}

type ReviewAssetSnapshot = {
  baseMeasurementUnit?: MassUnit | null
  specifications?: Record<string, unknown> | null
}

function formatReviewValue(value: unknown, unit?: string): string {
  if (value === null || value === undefined || value === '') return '-'
  if (isMassCompositionValue(value)) return value.label
  const formatted = formatCalibrationValue(value)
  return unit ? `${formatted} ${unit}` : formatted
}

function numberFromUnknown(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.replace(',', '.'))
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function arrayValueAt(value: unknown, index: number): unknown {
  return Array.isArray(value) ? value[index] : undefined
}

function numericValues(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => numericValues(item))
  }

  const parsed = numberFromUnknown(value)
  return parsed == null ? [] : [parsed]
}

const reviewActionButtonClass =
  'min-h-10 active:scale-[0.96] transition-[background-color,color,box-shadow,border-color,transform]'

const reviewSurfaceClass =
  'min-w-0 rounded-lg bg-card shadow-[0_1px_2px_rgba(15,23,42,0.06),0_8px_24px_rgba(15,23,42,0.04)] ring-1 ring-black/5'

interface Technician {
  id: string
  name: string
  email: string
  role: string
}

function JobDetailPage() {
  const { id } = Route.useParams()
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

  // Stable callback for refreshing job data (used by ApprovedJobRecord for label polling)
  const refreshJob = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['jobs', id] })
  }, [queryClient, id])

  // Fetch job
  const {
    data: job,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['jobs', id],
    queryFn: async () => {
      const res = await api.api.jobs[':id'].$get({
        param: { id: apiJobId },
      })
      if (!res.ok) {
        throw new Error('Falha ao carregar job')
      }
      return res.json()
    },
    // Auto-refresh every 2s while PDF is being generated
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === 'GENERATING_PDF' ? 2000 : false
    },
  })

  // Fetch technicians for assign dialog
  const { data: techniciansData } = useQuery({
    queryKey: ['technicians'],
    queryFn: async () => {
      const res = await api.api.jobs['technicians'].list.$get()
      if (!res.ok) throw new Error('Falha ao carregar técnicos')
      const data = await res.json()
      return data.data as Technician[]
    },
    enabled: assignDialogOpen,
  })

  // Approve mutation
  const approveMutation = useMutation({
    mutationFn: async () => {
      const res = await api.api.jobs[':id'].approve.$post({
        param: { id: apiJobId },
        json: {
          reason: 'Aprovado',
          environmentalJustification: envJustification || undefined,
        },
      })
      if (!res.ok) {
        const error = await res.json()
        throw new Error(
          (error as { error?: string }).error || 'Erro ao aprovar',
        )
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
      queryClient.invalidateQueries({ queryKey: ['jobs', id] })
      toast.success('Job aprovado com sucesso!')
      setApproveDialogOpen(false)
      setEnvJustification('')
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  // Reject mutation
  const rejectMutation = useMutation({
    mutationFn: async () => {
      const res = await api.api.jobs[':id'].reject.$post({
        param: { id: apiJobId },
        json: { reason: rejectReason },
      })
      if (!res.ok) {
        const error = await res.json()
        throw new Error(
          (error as { error?: string }).error || 'Erro ao rejeitar',
        )
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
      toast.success('Job rejeitado')
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
      const res = await api.api.jobs[':id'].$delete({
        param: { id: apiJobId },
        json: { reason: cancelReason },
      })
      if (!res.ok) {
        const error = await res.json()
        throw new Error(
          (error as { error?: string }).error || 'Erro ao cancelar',
        )
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
      toast.success('Job cancelado')
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
      const res = await api.api.jobs[':id'].assign.$post({
        param: { id: apiJobId },
        json: { technicianId: selectedTechnician },
      })
      if (!res.ok) {
        const error = await res.json()
        throw new Error(
          (error as { error?: string }).error || 'Erro ao atribuir',
        )
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs', id] })
      toast.success('Técnico atribuído com sucesso!')
      setAssignDialogOpen(false)
      setSelectedTechnician('')
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  const methodSnapshotForReview = (job?.methodSnapshot ??
    {}) as ReviewMethodSnapshot
  const reviewDataFields = methodSnapshotForReview.dataFields ?? []
  const reviewFormulas = methodSnapshotForReview.formulas ?? []
  const reviewValidations = methodSnapshotForReview.validations ?? []
  const reviewAssetBaseUnit =
    ((job as { assetSnapshot?: ReviewAssetSnapshot | null } | undefined)
      ?.assetSnapshot?.baseMeasurementUnit as MassUnit | null | undefined) ??
    null
  const reviewAssetSnapshot = (
    job as { assetSnapshot?: ReviewAssetSnapshot | null } | undefined
  )?.assetSnapshot
  const reviewStandards = ((
    job as { standardsSnapshot?: ReviewStandardSnapshot[] | null } | undefined
  )?.standardsSnapshot ?? []) as ReviewStandardSnapshot[]
  const displayUnitForReview = (unit?: string | null) =>
    resolveMassDisplayUnit(reviewAssetBaseUnit, unit) ?? unit ?? undefined
  const assetSpecDefinitions = [
    ...reviewDataFields
      .filter((field) => field.source === 'asset_spec' && field.assetSpecKey)
      .map((field) => ({
        key: field.assetSpecKey!,
        label: field.label,
        type: field.type as 'text' | 'number' | 'select' | 'weighing_ranges',
        unit: field.unit ?? undefined,
      })),
    ...reviewDataFields
      .filter((field) => field.weighingRangeResolver?.assetSpecKey)
      .map((field) => ({
        key: field.weighingRangeResolver!.assetSpecKey!,
        label: 'Faixas de pesagem e resolução',
        type: 'weighing_ranges' as const,
      })),
  ]
  const displayAssetSpecs =
    denormalizeAssetSpecificationsForDisplay(
      reviewAssetSnapshot?.specifications,
      assetSpecDefinitions,
      reviewAssetBaseUnit,
    ) ?? reviewAssetSnapshot?.specifications
  const equipmentSpecItems = assetSpecDefinitions
    .map((definition) => {
      const value = displayAssetSpecs?.[definition.key]
      if (value === null || value === undefined || value === '') return null

      const displayValue =
        definition.type === 'weighing_ranges' && isWeighingRangeSpecArray(value)
          ? value.map(formatWeighingRangeSpec).join(' | ')
          : definition.type === 'number'
            ? formatReviewValue(value, displayUnitForReview(definition.unit))
            : String(value)

      return {
        key: definition.key,
        label: definition.label,
        value: displayValue,
      }
    })
    .filter((item): item is { key: string; label: string; value: string } =>
      Boolean(item),
    )
  const displayReviewData = useMemo(
    () =>
      denormalizeMethodDataForDisplay(
        (job as { data?: Record<string, unknown> | null } | undefined)?.data,
        reviewDataFields,
        reviewAssetBaseUnit,
      ) ?? (job as { data?: Record<string, unknown> | null } | undefined)?.data,
    [job, reviewAssetBaseUnit, reviewDataFields],
  )
  const displayReviewResults = useMemo(
    () =>
      denormalizeMethodResultsForDisplay(
        (job as { results?: Record<string, unknown> | null } | undefined)
          ?.results,
        reviewFormulas,
        reviewAssetBaseUnit,
      ) ??
      (job as { results?: Record<string, unknown> | null } | undefined)
        ?.results,
    [job, reviewAssetBaseUnit, reviewFormulas],
  )

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
  const canApprove = job.status === 'REVIEW'
  const canShowReviewEvidence = canApprove || isGeneratingPdf
  const canCancel = ['DRAFT', 'IN_PROGRESS', 'REVIEW', 'REJECTED'].includes(
    job.status,
  )
  const canAssign = ['DRAFT', 'IN_PROGRESS', 'REJECTED'].includes(job.status)
  const financialStatus =
    typeof job.financialStatus === 'string' ? job.financialStatus : 'UNBILLED'
  const reviewHasData =
    reviewDataFields.length > 0 &&
    !!displayReviewData &&
    Object.keys(displayReviewData).length > 0
  const reviewHasResults =
    reviewFormulas.length > 0 &&
    !!displayReviewResults &&
    Object.keys(displayReviewResults).length > 0
  const priorityReviewFieldKeys = [
    'pontos_indicacao',
    'excentricidade',
    'repetibilidade',
  ]
  const criticalReviewFields = reviewDataFields.filter((field) =>
    priorityReviewFieldKeys.includes(field.key),
  )
  const supportingReviewFields = reviewDataFields.filter(
    (field) =>
      field.source !== 'asset_spec' &&
      !priorityReviewFieldKeys.includes(field.key),
  )
  const supportContextItems = supportingReviewFields
    .map((field) => {
      const value = displayReviewData?.[field.key]
      if (value === null || value === undefined || value === '') return null

      return {
        key: field.key,
        label: field.label,
        value: formatReviewValue(value, displayUnitForReview(field.unit)),
      }
    })
    .filter((item): item is { key: string; label: string; value: string } =>
      Boolean(item),
    )
  const reviewContextItems = [...equipmentSpecItems, ...supportContextItems]
  const priorityReviewFormulaKeys = [
    'erro_indicacao_antes',
    'margem_conformidade_antes',
    'erro_indicacao_apos',
    'margem_conformidade_apos',
    'incerteza_expandida_antes',
    'incerteza_expandida_apos',
    'maior_desvio_excentricidade_antes',
    'maior_desvio_excentricidade_apos',
    'maior_repetibilidade',
    'repetibilidade_desvio_apos',
  ]
  const priorityReviewFormulas = reviewFormulas
    .filter((formula) => priorityReviewFormulaKeys.includes(formula.outputKey))
    .sort(
      (a, b) =>
        priorityReviewFormulaKeys.indexOf(a.outputKey) -
        priorityReviewFormulaKeys.indexOf(b.outputKey),
    )
  const supportingReviewFormulas = reviewFormulas.filter(
    (formula) => !priorityReviewFormulaKeys.includes(formula.outputKey),
  )
  const orderedReviewFormulas = [
    ...priorityReviewFormulas,
    ...supportingReviewFormulas,
  ]
  const indicationRows = Array.isArray(displayReviewData?.pontos_indicacao)
    ? (displayReviewData.pontos_indicacao as Record<string, unknown>[])
    : []
  const adjustmentSummaryRows = indicationRows.map((row, index) => {
    const beforeMargin = numberFromUnknown(
      arrayValueAt(displayReviewResults?.margem_conformidade_antes, index),
    )
    const afterMargin = numberFromUnknown(
      arrayValueAt(displayReviewResults?.margem_conformidade_apos, index),
    )
    return {
      key: `${index}-${String(row.valor_padrao ?? '')}`,
      point: row.valor_padrao,
      beforeReadings: [
        row.antes_leitura_1,
        row.antes_leitura_2,
        row.antes_leitura_3,
      ],
      afterReadings: [
        row.apos_leitura_1,
        row.apos_leitura_2,
        row.apos_leitura_3,
      ],
      beforeError: arrayValueAt(
        displayReviewResults?.erro_indicacao_antes,
        index,
      ),
      afterError: arrayValueAt(
        displayReviewResults?.erro_indicacao_apos,
        index,
      ),
      beforeMargin,
      afterMargin,
    }
  })
  const acceptanceItems = reviewValidations.map((validation, index) => {
    const expression = validation.expression
    let status: 'ok' | 'error' | 'warning' | 'unknown' = 'unknown'

    if (expression.includes('margem_conformidade_antes')) {
      const margins = numericValues(
        displayReviewResults?.margem_conformidade_antes,
      )
      status =
        margins.length === 0
          ? 'unknown'
          : margins.every((margin) => margin >= 0)
            ? 'ok'
            : 'error'
    } else if (expression.includes('margem_conformidade_apos')) {
      const margins = numericValues(
        displayReviewResults?.margem_conformidade_apos,
      )
      status =
        margins.length === 0
          ? 'unknown'
          : margins.every((margin) => margin >= 0)
            ? 'ok'
            : 'error'
    } else if (
      expression.includes('maior_desvio_excentricidade_apos') &&
      expression.includes('tolerancia_maxima')
    ) {
      const deviations = numericValues(
        displayReviewResults?.maior_desvio_excentricidade_apos,
      )
      const tolerance = numberFromUnknown(displayReviewData?.tolerancia_maxima)
      status =
        deviations.length === 0 || tolerance == null
          ? 'unknown'
          : deviations.every((deviation) => deviation <= tolerance)
            ? 'ok'
            : 'error'
    } else if (validation.severity === 'warning') {
      status = 'warning'
    }

    return {
      key: `${validation.expression}-${index}`,
      message: validation.message,
      severity: validation.severity,
      status,
    }
  })
  const environmentalWarning =
    job.environmentalSnapshot && !job.environmentalSnapshot.withinLimits
      ? {
          key: 'environmental-limits',
          message: 'Condições ambientais fora dos limites do método.',
          severity: 'warning' as const,
          status: 'warning' as const,
        }
      : null
  const quickAlertItems = environmentalWarning
    ? [...acceptanceItems, environmentalWarning]
    : acceptanceItems

  const renderReviewFieldValue = (field: ReviewMethodField) => {
    const value = displayReviewData?.[field.key]

    if (field.type === 'table' && field.columns && Array.isArray(value)) {
      return (
        <div className="max-w-full overflow-x-auto rounded-lg bg-background shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)]">
          <Table className="min-w-max text-[13px]">
            <TableHeader className="bg-muted/50">
              <TableRow>
                {field.columns.map((column) => (
                  <TableHead
                    key={column.key}
                    className="h-11 whitespace-nowrap px-3 text-xs"
                  >
                    {column.label}
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
              {(value as Record<string, unknown>[]).map((row, index) => (
                <TableRow key={index} className="hover:bg-muted/30">
                  {field.columns!.map((column) => {
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
      <div className="rounded-lg bg-background p-3 font-mono text-sm tabular-nums shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)]">
        {formatReviewValue(value, displayUnitForReview(field.unit))}
      </div>
    )
  }

  const renderReviewResult = (formula: ReviewFormula) => {
    const value = displayReviewResults?.[formula.outputKey]
    const validation = reviewValidations.find((candidate) =>
      candidate.expression.includes(formula.outputKey),
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
      <Badge
        variant={isInside ? 'outline' : 'destructive'}
        className="font-mono tabular-nums"
      >
        {isInside ? '+' : ''}
        {formatCalibrationValue(margin)} {unit ?? ''}
      </Badge>
    )
  }

  const renderAcceptanceBadge = (
    status: 'ok' | 'error' | 'warning' | 'unknown',
  ) => {
    if (status === 'ok') {
      return (
        <Badge variant="outline" className="shrink-0 text-green-700">
          OK
        </Badge>
      )
    }

    if (status === 'error') {
      return (
        <Badge variant="destructive" className="shrink-0">
          Atenção
        </Badge>
      )
    }

    if (status === 'warning') {
      return (
        <Badge
          variant="outline"
          className="shrink-0 border-amber-300 bg-amber-50 text-amber-700"
        >
          Aviso
        </Badge>
      )
    }

    return (
      <Badge variant="secondary" className="shrink-0">
        Verificar
      </Badge>
    )
  }

  // APPROVED or SUPERSEDED status: Show immutable Quality Record view
  if (job.status === 'APPROVED' || job.status === 'SUPERSEDED') {
    return (
      <ApprovedJobRecord
        job={job as Parameters<typeof ApprovedJobRecord>[0]['job']}
        onBack={() => navigate({ to: '/dashboard/jobs' })}
        onRefresh={refreshJob}
      />
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate({ to: '/dashboard/jobs' })}
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} className="mr-2 h-4 w-4" />
            Voltar
          </Button>
        </div>

        <div className="flex items-center gap-2">
          {/* Execute button */}
          {canExecute && (
            <Button
              render={<Link to="/dashboard/jobs/$id/execute" params={{ id }} />}
            >
              <HugeiconsIcon icon={Calendar03Icon} className="mr-2 h-4 w-4" />
              {job.status === 'DRAFT'
                ? 'Iniciar Execução'
                : 'Continuar Execução'}
            </Button>
          )}

          {/* Assign technician */}
          {canAssign && (
            <Button variant="outline" onClick={() => setAssignDialogOpen(true)}>
              <HugeiconsIcon icon={UserAdd01Icon} className="mr-2 h-4 w-4" />
              Atribuir Técnico
            </Button>
          )}

          {/* Edit button */}
          {job.status === 'DRAFT' && (
            <Button variant="outline">
              <HugeiconsIcon icon={Edit02Icon} className="mr-2 h-4 w-4" />
              Editar
            </Button>
          )}

          {/* Cancel button */}
          {canCancel && !canApprove && (
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => setCancelDialogOpen(true)}
            >
              <HugeiconsIcon icon={Cancel01Icon} className="mr-2 h-4 w-4" />
              Cancelar
            </Button>
          )}
        </div>
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

      {/* Job identity */}
      <section className="flex flex-col gap-3 border-b border-black/5 px-1 pb-5 sm:flex-row sm:items-end sm:justify-between dark:border-white/10">
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
          <Badge
            variant={statusVariants[job.status as JobStatus]}
            className={
              job.status === 'GENERATING_PDF'
                ? 'bg-amber-100 text-amber-700 border-amber-300 animate-pulse dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-700'
                : ''
            }
          >
            {job.status === 'GENERATING_PDF' ? (
              <span className="inline-flex items-center gap-1">
                <Spinner className="size-3" />
                Gerando PDF...
              </span>
            ) : (
              statusLabels[job.status as JobStatus]
            )}
          </Badge>
          {job.isOverdue && <Badge variant="destructive">Atrasado</Badge>}
          <Badge variant={getFinancialVariant(financialStatus)}>
            {getFinancialStatusLabel(
              financialStatus as
                | 'UNBILLED'
                | 'DRAFT'
                | 'ISSUED'
                | 'PAID'
                | 'OVERDUE',
            )}
          </Badge>
        </div>
      </section>

      {canShowReviewEvidence ? (
        <>
          <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
            <main className="min-w-0 space-y-6">
              <section className={`${reviewSurfaceClass} p-4`}>
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
                  <Badge variant="outline" className="w-fit">
                    {isGeneratingPdf
                      ? 'Gerando PDF'
                      : reviewHasData
                        ? 'Dados capturados'
                        : 'Sem dados'}
                  </Badge>
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

              <section className={`${reviewSurfaceClass} p-4`}>
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
                  <div className="max-w-full overflow-x-auto rounded-lg bg-background shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)]">
                    <Table className="min-w-max text-[13px]">
                      <TableHeader className="bg-muted/50">
                        <TableRow>
                          <TableHead className="h-11 whitespace-nowrap px-3 text-xs">
                            Ponto
                          </TableHead>
                          <TableHead className="h-11 whitespace-nowrap px-3 text-xs">
                            Leituras antes
                          </TableHead>
                          <TableHead className="h-11 whitespace-nowrap px-3 text-xs">
                            Erro antes
                          </TableHead>
                          <TableHead className="h-11 whitespace-nowrap px-3 text-xs">
                            Margem antes
                          </TableHead>
                          <TableHead className="h-11 whitespace-nowrap px-3 text-xs">
                            Leituras após
                          </TableHead>
                          <TableHead className="h-11 whitespace-nowrap px-3 text-xs">
                            Erro após
                          </TableHead>
                          <TableHead className="h-11 whitespace-nowrap px-3 text-xs">
                            Margem após
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {adjustmentSummaryRows.map((row) => (
                          <TableRow key={row.key} className="hover:bg-muted/30">
                            <TableCell className="whitespace-nowrap px-3 font-mono tabular-nums">
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
                            <TableCell className="min-w-36 px-3 font-mono text-xs tabular-nums text-muted-foreground">
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

              <section className={`${reviewSurfaceClass} p-4`}>
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

              {reviewStandards.length > 0 && (
                <section className={`${reviewSurfaceClass} p-4`}>
                  <div className="mb-4">
                    <h2 className="text-balance text-base font-semibold">
                      Padrões Utilizados
                    </h2>
                    <p className="text-pretty text-sm text-muted-foreground">
                      Evidência de rastreabilidade usada nesta calibração.
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
                            {standard.type && (
                              <p className="text-xs text-muted-foreground">
                                {standard.type}
                              </p>
                            )}
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
                                U ={' '}
                                {formatCalibrationValue(standard.uncertainty)}{' '}
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

              <section className={`${reviewSurfaceClass} p-4`}>
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
            </main>

            <aside className="min-w-0 space-y-6 xl:sticky xl:top-6">
              <section className={`${reviewSurfaceClass} p-4`}>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Decisão do responsável técnico
                </p>
                <h2 className="mt-1 text-balance text-lg font-semibold">
                  {isGeneratingPdf
                    ? 'Certificado em geração'
                    : 'Aprovar ou devolver para correção'}
                </h2>
                <div className="mt-4 grid gap-2">
                  {isGeneratingPdf ? (
                    <>
                      <Button
                        variant="default"
                        className={`${reviewActionButtonClass} justify-start bg-amber-500 text-white hover:bg-amber-500`}
                        disabled
                      >
                        <Spinner className="mr-2 size-4" />
                        Gerando PDF...
                      </Button>
                      <p className="text-pretty text-sm text-muted-foreground">
                        Assim que o arquivo estiver pronto, esta tela muda para
                        a prévia do certificado e registro aprovado.
                      </p>
                    </>
                  ) : (
                    <>
                      <Button
                        variant="default"
                        className={`${reviewActionButtonClass} justify-start bg-green-600 hover:bg-green-700`}
                        onClick={() => setApproveDialogOpen(true)}
                      >
                        <HugeiconsIcon
                          icon={CheckmarkCircle02Icon}
                          className="mr-2 h-4 w-4"
                        />
                        Aprovar certificado
                      </Button>
                      <Button
                        variant="destructive"
                        className={`${reviewActionButtonClass} justify-start`}
                        onClick={() => setRejectDialogOpen(true)}
                      >
                        <HugeiconsIcon
                          icon={MultiplicationSignIcon}
                          className="mr-2 h-4 w-4"
                        />
                        Rejeitar e devolver
                      </Button>
                      {canCancel && (
                        <Button
                          variant="ghost"
                          className={`${reviewActionButtonClass} justify-start text-destructive hover:bg-destructive/10 hover:text-destructive`}
                          onClick={() => setCancelDialogOpen(true)}
                        >
                          <HugeiconsIcon
                            icon={Cancel01Icon}
                            className="mr-2 h-4 w-4"
                          />
                          Cancelar job
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </section>

              <section className={`${reviewSurfaceClass} p-4`}>
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
                        className="rounded-lg bg-background p-3 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)]"
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

              <section className={`${reviewSurfaceClass} p-4`}>
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
                      {getFinancialStatusLabel(
                        financialStatus as
                          | 'UNBILLED'
                          | 'DRAFT'
                          | 'ISSUED'
                          | 'PAID'
                          | 'OVERDUE',
                      )}
                    </Badge>
                  </div>
                </div>
              </section>

              <section className={`${reviewSurfaceClass} p-4`}>
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
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Contexto Financeiro</CardTitle>
              <CardDescription>
                Visibilidade operacional da cobrança vinculada à calibração.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  Status financeiro
                </label>
                <p className="text-sm">
                  {getFinancialStatusLabel(
                    financialStatus as
                      | 'UNBILLED'
                      | 'DRAFT'
                      | 'ISSUED'
                      | 'PAID'
                      | 'OVERDUE',
                  )}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  Elegível para cobrança
                </label>
                <p className="text-sm">
                  {job.invoiceEligibility ? 'Sim' : 'Não'}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  Documento vinculado
                </label>
                <p className="text-sm">
                  {job.invoiceDocumentNumber || 'Ainda não faturada'}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Customer & Asset */}
          <Card>
            <CardHeader>
              <CardTitle>Cliente e Ativo</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  Cliente
                </label>
                <p className="text-sm">{job.customerName || '-'}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  Ativo
                </label>
                <p className="text-sm">
                  {job.assetName}
                  {job.assetTag && (
                    <span className="font-mono text-muted-foreground ml-2">
                      ({job.assetTag})
                    </span>
                  )}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Dates & Assignment */}
          <Card>
            <CardHeader>
              <CardTitle>Datas e Atribuição</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  Técnico Responsável
                </label>
                <p className="text-sm">
                  {job.technicianName || (
                    <span className="text-muted-foreground italic">
                      Não atribuído
                    </span>
                  )}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  Prazo
                </label>
                <p className="text-sm">
                  {formatDate(job.dueDate)}
                  {job.daysUntilDue !== null && job.daysUntilDue > 0 && (
                    <Badge variant="outline" className="ml-2 text-xs">
                      {job.daysUntilDue} dias
                    </Badge>
                  )}
                </p>
              </div>
              {job.performedAt && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    Executado em
                  </label>
                  <p className="text-sm">{formatDateTime(job.performedAt)}</p>
                </div>
              )}
              {job.approvedAt && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    Aprovado em
                  </label>
                  <p className="text-sm">{formatDateTime(job.approvedAt)}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Method Configuration Preview */}
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle>Configuração do Método</CardTitle>
              <CardDescription>
                Snapshot do método capturado no momento da criação do job
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    Campos de Entrada
                  </label>
                  <p className="text-2xl font-bold">
                    {(job.methodSnapshot as { dataFields?: unknown[] })
                      ?.dataFields?.length || 0}
                  </p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    Fórmulas
                  </label>
                  <p className="text-2xl font-bold">
                    {(job.methodSnapshot as { formulas?: unknown[] })?.formulas
                      ?.length || 0}
                  </p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    Critérios de Aceitação
                  </label>
                  <p className="text-2xl font-bold">
                    {(job.methodSnapshot as { validations?: unknown[] })
                      ?.validations?.length || 0}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Rejection Info */}
          {job.status === 'REJECTED' && job.rejectionReason && (
            <Card className="md:col-span-2 border-destructive">
              <CardHeader>
                <CardTitle className="text-destructive">
                  Motivo da Rejeição
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm">{job.rejectionReason}</p>
                {job.rejectedAt && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Rejeitado em {formatDateTime(job.rejectedAt)}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Metadata */}
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle>Metadados</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-8 text-sm text-muted-foreground">
                <div>
                  <span className="font-medium">Criado em:</span>{' '}
                  {formatDateTime(job.createdAt)}
                </div>
                <div>
                  <span className="font-medium">Atualizado em:</span>{' '}
                  {formatDateTime(job.updatedAt)}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Approve Dialog */}
      <Dialog open={approveDialogOpen} onOpenChange={setApproveDialogOpen}>
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
                (!!job?.environmentalSnapshot &&
                  !job.environmentalSnapshot.withinLimits &&
                  !job.environmentalSnapshot.outOfLimitsJustification &&
                  !envJustification.trim())
              }
            >
              {approveMutation.isPending && <Spinner className="mr-2" />}
              {approveMutation.isPending ? 'Aprovando...' : 'Aprovar'}
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
            <DialogTitle>Cancelar Job</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja cancelar este job? Esta ação não pode ser
              desfeita.
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
                    ? techniciansData?.find((t) => t.id === selectedTechnician)
                        ?.name
                    : 'Selecione um técnico...'}
                </span>
              </SelectTrigger>
              <SelectContent>
                {techniciansData?.map((tech) => (
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
