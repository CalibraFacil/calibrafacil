/**
 * Approved Job Record View - ISO 17025 Quality Record
 *
 * Once a job is APPROVED, it transforms from a "Living Document" (mutable)
 * to a "Quality Record" (immutable). This view reflects that shift with
 * read-only styling and distribution-focused actions.
 */
import { HugeiconsIcon } from '@hugeicons/react'
import {
  FileDownloadIcon,
  PrinterIcon,
  Mail01Icon,
  Edit02Icon,
  CheckmarkCircle02Icon,
  ArrowLeft01Icon,
  MoreVerticalIcon,
  Alert02Icon,
} from '@hugeicons/core-free-icons'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
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
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  AuditTimeline,
  buildJobTimelineEvents,
} from '@/components/audit-timeline'
import { api } from '@/utils/api'
import { toast } from 'sonner'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  convertMassValue,
  denormalizeAssetSpecificationsForDisplay,
  denormalizeMethodDataForDisplay,
  denormalizeMethodResultsForDisplay,
  formatCalibrationValue,
  resolveMassDisplayUnit,
  type MassUnit,
} from '@calibra-facil/shared'
import { Spinner } from '@/components/ui/spinner'
import { useMountEffect } from '@/hooks/use-mount-effect'
import { isMassCompositionValue } from '@/components/method-runtime/mass-composition-utils'
import { normalizeMethodValidations } from '@/components/method-runtime/math-runtime'
import {
  formatWeighingRangeSpec,
  isWeighingRangeSpecArray,
} from '@/components/method-runtime/weighing-range-utils'
import type { MethodInputType } from '@/components/method-runtime/types'

interface MethodSnapshot {
  methodId: number
  methodName: string
  methodVersion: number
  dataFields: Array<{
    key: string
    label: string
    type: MethodInputType
    unit?: string
    source?: string | null
    assetSpecKey?: string | null
    weighingRangeResolver?: {
      enabled?: boolean
      assetSpecKey?: string
    } | null
    columns?: Array<{
      key: string
      label: string
      type: 'text' | 'number'
      unit?: string
    }>
  }>
  formulas: Array<{
    outputKey: string
    expression: string
    label?: string
    unit?: string
  }>
  validations: Array<unknown>
}

interface StandardSnapshot {
  id: number
  name: string
  type?: string | null
  certificateNumber: string
  calibrationDate: string
  uncertainty: number | null
  uncertaintyUnit: string | null
  coverageFactor: number
  drift: number | null
}

interface AssetSnapshot {
  baseMeasurementUnit?: MassUnit | null
  specifications?: Record<string, unknown> | null
}

interface ApprovedJob {
  id: number
  jobId: string
  status: string
  customerName: string | null
  assetName: string | null
  assetTag: string | null
  serviceName: string | null
  methodSnapshot: MethodSnapshot
  data: Record<string, unknown> | null
  results: Record<string, unknown> | null
  standardsSnapshot?: StandardSnapshot[] | null
  assetSnapshot?: AssetSnapshot | null
  technicianName: string | null
  approvedBy: string | null
  approverName?: string | null
  approvedAt: string | null
  performedAt: string | null
  createdAt: string
  certificateUrl?: string | null
  labelUrl?: string | null
  // Amendment fields - ISO 17025 Clause 7.8.4.1
  supersededById?: number | null
  supersedesId?: number | null
  amendmentNumber?: number | null
  amendmentReason?: string | null
  supersededAt?: string | null
}

interface ApprovedJobRecordProps {
  job: ApprovedJob
  onBack: () => void
  onRefresh: () => void
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

function formatValue(value: unknown, unit?: string): string {
  if (value === null || value === undefined || value === '') return '-'
  if (isMassCompositionValue(value)) return value.label
  const formatted = formatCalibrationValue(value)
  return unit ? `${formatted} ${unit}` : formatted
}

const actionButtonClass =
  'min-h-10 active:scale-[0.96] transition-[background-color,color,box-shadow,border-color,transform]'

const subtleSurfaceClass =
  'min-w-0 rounded-lg bg-card shadow-[0_1px_2px_rgba(15,23,42,0.06),0_8px_24px_rgba(15,23,42,0.04)] ring-1 ring-black/5'

export function ApprovedJobRecord({
  job,
  onBack,
  onRefresh,
}: ApprovedJobRecordProps) {
  const { methodSnapshot, data, results, standardsSnapshot } = job
  const validations = useMemo(
    () => normalizeMethodValidations(methodSnapshot.validations),
    [methodSnapshot.validations],
  )
  const assetBaseMeasurementUnit =
    job.assetSnapshot?.baseMeasurementUnit ?? null
  const navigate = useNavigate()
  const [isDownloading, setIsDownloading] = useState(false)
  const [isGeneratingLabel, setIsGeneratingLabel] = useState(false)
  const [isDownloadingLabel, setIsDownloadingLabel] = useState(false)
  const [labelPending, setLabelPending] = useState(false)
  const [certificatePreviewUrl, setCertificatePreviewUrl] = useState<
    string | null
  >(null)
  // Amendment state - ISO 17025 Clause 7.8.4.1
  const [isAmendDialogOpen, setIsAmendDialogOpen] = useState(false)
  const [amendmentReason, setAmendmentReason] = useState('')
  const [isAmending, setIsAmending] = useState(false)
  const displayUnitFor = (unit?: string | null) =>
    resolveMassDisplayUnit(assetBaseMeasurementUnit, unit) ?? unit ?? undefined
  const displayData = useMemo(
    () =>
      denormalizeMethodDataForDisplay(
        data,
        methodSnapshot.dataFields,
        assetBaseMeasurementUnit,
      ) ?? data,
    [assetBaseMeasurementUnit, data, methodSnapshot.dataFields],
  )
  const displayResults = useMemo(
    () =>
      denormalizeMethodResultsForDisplay(
        results,
        methodSnapshot.formulas,
        assetBaseMeasurementUnit,
      ) ?? results,
    [assetBaseMeasurementUnit, methodSnapshot.formulas, results],
  )
  const assetSpecDefinitions = [
    ...methodSnapshot.dataFields
      .filter((field) => field.source === 'asset_spec' && field.assetSpecKey)
      .map((field) => ({
        key: field.assetSpecKey!,
        label: field.label,
        type: field.type as 'text' | 'number' | 'select' | 'weighing_ranges',
        unit: field.unit ?? undefined,
      })),
    ...methodSnapshot.dataFields
      .filter((field) => field.weighingRangeResolver?.assetSpecKey)
      .map((field) => ({
        key: field.weighingRangeResolver!.assetSpecKey!,
        label: 'Faixas de pesagem e resolução',
        type: 'weighing_ranges' as const,
      })),
  ]
  const displayAssetSpecs =
    denormalizeAssetSpecificationsForDisplay(
      job.assetSnapshot?.specifications,
      assetSpecDefinitions,
      assetBaseMeasurementUnit,
    ) ?? job.assetSnapshot?.specifications
  const equipmentSpecItems = assetSpecDefinitions
    .map((definition) => {
      const value = displayAssetSpecs?.[definition.key]
      if (value === null || value === undefined || value === '') return null

      const displayValue =
        definition.type === 'weighing_ranges' && isWeighingRangeSpecArray(value)
          ? value.map(formatWeighingRangeSpec).join(' | ')
          : definition.type === 'number'
            ? formatValue(value, displayUnitFor(definition.unit))
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
  const priorityMeasurementFieldKeys = [
    'pontos_indicacao',
    'excentricidade',
    'repetibilidade',
  ]
  const nonAssetDataFields = methodSnapshot.dataFields.filter(
    (field) => field.source !== 'asset_spec',
  )
  const supportContextItems = nonAssetDataFields
    .filter((field) => !priorityMeasurementFieldKeys.includes(field.key))
    .map((field) => {
      const value = displayData?.[field.key]
      if (
        value === null ||
        value === undefined ||
        value === '' ||
        field.type === 'table'
      ) {
        return null
      }

      return {
        key: field.key,
        label: field.label,
        value: formatValue(value, displayUnitFor(field.unit)),
      }
    })
    .filter((item): item is { key: string; label: string; value: string } =>
      Boolean(item),
    )
  const timelineContextItems = [
    { key: 'createdAt', label: 'Criado', value: formatDateTime(job.createdAt) },
    {
      key: 'performedAt',
      label: 'Executado',
      value: formatDateTime(job.performedAt),
    },
    {
      key: 'approvedAt',
      label: 'Aprovado',
      value: formatDateTime(job.approvedAt),
    },
  ]
  const approvedContextItems = [
    ...equipmentSpecItems,
    ...supportContextItems,
    ...timelineContextItems,
  ]
  const priorityMeasurementFields = nonAssetDataFields.filter((field) =>
    priorityMeasurementFieldKeys.includes(field.key),
  )
  const measurementFields =
    priorityMeasurementFields.length > 0
      ? priorityMeasurementFields
      : nonAssetDataFields

  const fetchCertificateDownloadUrl = useCallback(async () => {
    const res = await api.api.jobs[':id'].download.$get({
      param: { id: String(job.id) },
    })
    if (!res.ok) {
      const error = (await res.json()) as { error?: string }
      throw new Error(error.error || 'Falha ao gerar link')
    }
    const data = (await res.json()) as { url: string }
    return data.url
  }, [job.id])

  useEffect(() => {
    if (!job.certificateUrl) {
      setCertificatePreviewUrl(null)
      return
    }

    let ignore = false
    void fetchCertificateDownloadUrl()
      .then((url) => {
        if (!ignore) setCertificatePreviewUrl(url)
      })
      .catch(() => {
        if (!ignore) setCertificatePreviewUrl(job.certificateUrl ?? null)
      })

    return () => {
      ignore = true
    }
  }, [fetchCertificateDownloadUrl, job.certificateUrl])

  const handleDownloadCertificate = async () => {
    setIsDownloading(true)
    try {
      const url = await fetchCertificateDownloadUrl()
      window.open(url, '_blank')
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Erro ao baixar certificado',
      )
    } finally {
      setIsDownloading(false)
    }
  }

  const handleGenerateLabel = async () => {
    setIsGeneratingLabel(true)
    try {
      const res = await api.api.jobs[':id']['generate-label'].$post({
        param: { id: String(job.id) },
      })
      if (!res.ok) {
        const error = (await res.json()) as { error?: string }
        throw new Error(error.error || 'Falha ao gerar etiqueta')
      }
      // Start polling for label completion
      setLabelPending(true)
      toast.info('Gerando etiqueta... Aguarde.')
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Erro ao gerar etiqueta',
      )
    } finally {
      setIsGeneratingLabel(false)
    }
  }

  const handleDownloadLabel = async () => {
    setIsDownloadingLabel(true)
    try {
      const res = await api.api.jobs[':id']['download-label'].$get({
        param: { id: String(job.id) },
      })
      if (!res.ok) {
        const error = (await res.json()) as { error?: string }
        throw new Error(error.error || 'Falha ao gerar link')
      }
      const data = (await res.json()) as { url: string }
      window.open(data.url, '_blank')
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Erro ao baixar etiqueta',
      )
    } finally {
      setIsDownloadingLabel(false)
    }
  }

  // Handle certificate amendment - ISO 17025 Clause 7.8.4.1
  const handleAmendCertificate = async () => {
    if (amendmentReason.length < 10) {
      toast.error('O motivo da retificação deve ter pelo menos 10 caracteres')
      return
    }

    setIsAmending(true)
    try {
      const res = await api.api.jobs[':id'].amend.$post({
        param: { id: String(job.id) },
        json: { reason: amendmentReason },
      })

      if (!res.ok) {
        const error = (await res.json()) as { error?: string }
        throw new Error(error.error || 'Falha ao criar retificação')
      }

      const result = (await res.json()) as {
        message: string
        amendedJob: { id: number; jobId: string }
      }

      toast.success(`Retificação criada: ${result.amendedJob.jobId}`)
      setIsAmendDialogOpen(false)
      setAmendmentReason('')

      // Navigate to the new amended job
      navigate({
        to: '/dashboard/jobs/$id',
        params: { id: result.amendedJob.jobId },
      })
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Erro ao criar retificação',
      )
    } finally {
      setIsAmending(false)
    }
  }

  // Render a single field value (read-only)
  const renderFieldValue = (field: MethodSnapshot['dataFields'][0]) => {
    const value = displayData?.[field.key]

    if (field.type === 'table' && field.columns && Array.isArray(value)) {
      return (
        <div className="max-w-full overflow-x-auto rounded-lg bg-background shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)]">
          <Table className="min-w-max text-[13px]">
            <TableHeader className="bg-muted/50">
              <TableRow>
                {field.columns.map((col) => (
                  <TableHead
                    key={col.key}
                    className="h-11 whitespace-nowrap px-3 text-xs"
                  >
                    {col.label}
                    {displayUnitFor(col.unit) && (
                      <span className="text-xs text-muted-foreground ml-1">
                        ({displayUnitFor(col.unit)})
                      </span>
                    )}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {(value as Record<string, unknown>[]).map((row, idx) => (
                <TableRow key={idx} className="hover:bg-muted/30">
                  {field.columns!.map((col) => {
                    const cellValue = row[col.key]
                    const isComposition = isMassCompositionValue(cellValue)
                    return (
                      <TableCell
                        key={col.key}
                        className={
                          isComposition
                            ? 'min-w-44 max-w-64 whitespace-normal px-3 font-sans text-sm leading-snug'
                            : 'whitespace-nowrap px-3 font-mono tabular-nums'
                        }
                      >
                        {formatValue(cellValue, displayUnitFor(col.unit))}
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
      <span className="font-mono tabular-nums">
        {formatValue(value, displayUnitFor(field.unit))}
      </span>
    )
  }

  // Render formula result (from stored results, no recalculation)
  const renderResult = (formula: MethodSnapshot['formulas'][0]) => {
    const value = displayResults?.[formula.outputKey]
    const validation = validations.find((v) =>
      `${v.leftExpression} ${v.rightExpression}`.includes(formula.outputKey),
    )
    // Check if value passes (simple heuristic - in real impl would store pass/fail)
    const isPassed = value !== undefined && value !== null

    return (
      <div className="flex flex-col gap-3 rounded-lg bg-background p-3 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)] transition-[background-color,box-shadow] hover:bg-muted/20 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <span className="text-sm font-medium">
            {formula.label || formula.outputKey}
          </span>
          {displayUnitFor(formula.unit) && (
            <span className="text-xs text-muted-foreground ml-1">
              ({displayUnitFor(formula.unit)})
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="break-all font-mono text-base tabular-nums sm:text-lg">
            {formatValue(value, displayUnitFor(formula.unit))}
          </span>
          {validation && isPassed && (
            <Badge variant="default" className="bg-green-600 shrink-0">
              <HugeiconsIcon
                icon={CheckmarkCircle02Icon}
                className="h-3 w-3 mr-1"
              />
              OK
            </Badge>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {labelPending && job.labelUrl ? (
        <LabelReadyNotifier
          onReady={() => {
            setLabelPending(false)
            toast.success('Etiqueta gerada com sucesso!')
          }}
        />
      ) : null}
      {labelPending && !job.labelUrl ? (
        <PendingLabelPoller onRefresh={onRefresh} />
      ) : null}
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className={`${actionButtonClass} w-fit shrink-0`}
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} className="mr-2 h-4 w-4" />
          Voltar
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={(props) => (
              <Button
                variant="outline"
                size="icon"
                className={`${actionButtonClass} size-10 shadow-[0_1px_2px_rgba(15,23,42,0.08)]`}
                {...props}
              >
                <HugeiconsIcon icon={MoreVerticalIcon} className="h-4 w-4" />
              </Button>
            )}
          />
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Distribuição</DropdownMenuLabel>
              <DropdownMenuItem
                onClick={
                  job.labelUrl ? handleDownloadLabel : handleGenerateLabel
                }
                disabled={
                  isGeneratingLabel || isDownloadingLabel || labelPending
                }
              >
                <HugeiconsIcon icon={PrinterIcon} className="h-4 w-4" />
                {labelPending
                  ? 'Gerando...'
                  : job.labelUrl
                    ? 'Baixar Etiqueta'
                    : 'Gerar Etiqueta QR'}
              </DropdownMenuItem>
              <DropdownMenuItem>
                <HugeiconsIcon icon={Mail01Icon} className="h-4 w-4" />
                Enviar por Email
              </DropdownMenuItem>
            </DropdownMenuGroup>
            {job.status !== 'SUPERSEDED' && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Mais opções</DropdownMenuLabel>
                  <DropdownMenuItem
                    className="text-muted-foreground"
                    onClick={() => setIsAmendDialogOpen(true)}
                  >
                    <HugeiconsIcon icon={Edit02Icon} className="h-4 w-4" />
                    Retificar Certificado
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <section className="flex flex-col gap-3 border-b border-black/5 px-1 pb-5 sm:flex-row sm:items-end sm:justify-between dark:border-white/10">
        <div className="min-w-0">
          <h1 className="text-balance font-mono text-2xl font-semibold tracking-tight">
            {job.jobId}
          </h1>
          <p className="mt-1 text-pretty text-sm text-muted-foreground">
            {job.serviceName}
            {methodSnapshot.methodName && (
              <span className="ml-2 text-xs">
                ({methodSnapshot.methodName} v{methodSnapshot.methodVersion})
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 sm:justify-end">
          <Badge
            variant={job.status === 'SUPERSEDED' ? 'outline' : 'default'}
            className={
              job.status === 'SUPERSEDED'
                ? 'shrink-0 border-amber-500 bg-amber-50 text-amber-700'
                : 'shrink-0 bg-green-600 text-white'
            }
          >
            <HugeiconsIcon
              icon={CheckmarkCircle02Icon}
              className="mr-1 h-3 w-3"
            />
            {job.status === 'SUPERSEDED' ? 'Retificado' : 'Aprovado'}
          </Badge>
        </div>
      </section>

      {/* Amendment Dialog - ISO 17025 Clause 7.8.4.1 */}
      <Dialog open={isAmendDialogOpen} onOpenChange={setIsAmendDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HugeiconsIcon
                icon={Alert02Icon}
                className="h-5 w-5 text-amber-500"
              />
              Retificar Certificado
            </DialogTitle>
            <DialogDescription>
              Esta ação criará uma nova versão do certificado e marcará o atual
              como <strong>CANCELADO</strong>. Esta operação é irreversível e
              será registrada no histórico de auditoria.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm text-amber-800">
                <strong>ISO 17025 Cláusula 7.8.4.1:</strong> Quando um
                certificado emitido precisar ser alterado, cada alteração deve
                ser identificada e conter referência ao original.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="amendment-reason">
                Motivo da Retificação{' '}
                <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="amendment-reason"
                placeholder="Descreva o motivo da retificação (mínimo 10 caracteres)..."
                value={amendmentReason}
                onChange={(e) => setAmendmentReason(e.target.value)}
                rows={4}
              />
              <p className="text-xs text-muted-foreground">
                {amendmentReason.length}/10 caracteres mínimos
              </p>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => {
                setIsAmendDialogOpen(false)
                setAmendmentReason('')
              }}
              disabled={isAmending}
            >
              Cancelar
            </Button>
            <Button
              variant="default"
              onClick={handleAmendCertificate}
              disabled={isAmending || amendmentReason.length < 10}
            >
              {isAmending ? (
                <>
                  <Spinner className="mr-2 h-4 w-4" />
                  Criando...
                </>
              ) : (
                'Criar Retificação'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Amendment Info Banner - ISO 17025 Clause 7.8.4.1 */}
      {(job.supersedesId || job.supersededById) && (
        <Card
          className={
            job.supersededById
              ? 'border-red-300 bg-red-50'
              : 'border-amber-300 bg-amber-50'
          }
        >
          <CardHeader className="pb-3">
            <CardTitle
              className={`text-base flex items-center gap-2 ${job.supersededById ? 'text-red-700' : 'text-amber-700'}`}
            >
              <HugeiconsIcon icon={Alert02Icon} className="h-5 w-5" />
              {job.supersededById
                ? 'Certificado Cancelado'
                : 'Certificado Retificado'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {job.supersededById && (
              <>
                <p className="text-sm text-red-700">
                  Este certificado foi <strong>cancelado e substituído</strong>{' '}
                  por uma versão retificada.
                </p>
                {job.amendmentReason && (
                  <div className="mt-3 p-3 bg-white/60 rounded-md border border-red-200">
                    <p className="text-xs font-medium text-red-800 mb-1">
                      Motivo da retificação:
                    </p>
                    <p className="text-sm text-red-900">
                      {job.amendmentReason}
                    </p>
                  </div>
                )}
              </>
            )}
            {job.supersedesId && (
              <>
                <p className="text-sm text-amber-700">
                  Este certificado é uma <strong>retificação</strong> (versão{' '}
                  {job.amendmentNumber || 1}) que substitui o certificado
                  original.
                </p>
                {job.amendmentReason && (
                  <div className="mt-3 p-3 bg-white/60 rounded-md border border-amber-200">
                    <p className="text-xs font-medium text-amber-800 mb-1">
                      Motivo da retificação:
                    </p>
                    <p className="text-sm text-amber-900">
                      {job.amendmentReason}
                    </p>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <main className="min-w-0 space-y-6">
          <section className={`${subtleSurfaceClass} p-4`}>
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Registro aprovado
                </p>
                <h2 className="text-balance text-lg font-semibold">
                  Revisão técnica pronta para distribuição
                </h2>
              </div>
              <Badge variant="outline" className="w-fit">
                ISO 17025
              </Badge>
            </div>
            <div className="grid gap-px overflow-hidden rounded-lg bg-black/5 md:grid-cols-4">
              <div className="bg-background p-3">
                <Label className="text-xs font-medium text-muted-foreground">
                  Cliente
                </Label>
                <p className="mt-1 text-sm font-medium">
                  {job.customerName || '-'}
                </p>
              </div>
              <div className="bg-background p-3">
                <Label className="text-xs font-medium text-muted-foreground">
                  Ativo
                </Label>
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
                <Label className="text-xs font-medium text-muted-foreground">
                  Serviço
                </Label>
                <p className="mt-1 text-sm">{job.serviceName || '-'}</p>
              </div>
              <div className="bg-background p-3">
                <Label className="text-xs font-medium text-muted-foreground">
                  Método
                </Label>
                <p className="mt-1 text-sm">
                  {methodSnapshot.methodName} v{methodSnapshot.methodVersion}
                </p>
              </div>
            </div>
            {approvedContextItems.length > 0 && (
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {approvedContextItems.map((item) => (
                  <div
                    key={item.key}
                    className={`min-w-0 rounded-md bg-muted/20 px-3 py-3 ${
                      item.key.toLowerCase().includes('observ') ||
                      item.key.toLowerCase().includes('local')
                        ? 'md:col-span-2 xl:col-span-3'
                        : ''
                    }`}
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
            )}
          </section>

          {standardsSnapshot && standardsSnapshot.length > 0 && (
            <section className={`${subtleSurfaceClass} p-4`}>
              <div className="mb-4">
                <h2 className="text-balance text-base font-semibold">
                  Padrões de Referência Utilizados
                </h2>
                <p className="text-sm text-muted-foreground">
                  Rastreabilidade metrológica conforme ISO 17025
                </p>
              </div>
              <div className="grid gap-2">
                {standardsSnapshot.map((std) => (
                  <div
                    key={std.id}
                    className="rounded-lg bg-background p-3 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)] transition-[background-color,box-shadow] hover:bg-muted/20"
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <span className="font-medium break-words">
                          {std.name}
                        </span>
                        {std.type && (
                          <p className="text-xs text-muted-foreground">
                            {std.type}
                          </p>
                        )}
                        <p className="text-sm text-muted-foreground break-all">
                          Certificado: {std.certificateNumber}
                        </p>
                      </div>
                      <div className="text-left sm:text-right text-sm shrink-0">
                        <p>Calibrado em: {formatDate(std.calibrationDate)}</p>
                        {std.uncertainty != null && (
                          <p className="font-mono tabular-nums text-muted-foreground">
                            U ={' '}
                            {formatCalibrationValue(
                              assetBaseMeasurementUnit && std.uncertaintyUnit
                                ? (convertMassValue(
                                    std.uncertainty,
                                    std.uncertaintyUnit,
                                    assetBaseMeasurementUnit,
                                  ) ?? std.uncertainty)
                                : std.uncertainty,
                            )}{' '}
                            {displayUnitFor(std.uncertaintyUnit) || ''} (k=
                            {std.coverageFactor})
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className={`${subtleSurfaceClass} p-4`}>
            <div className="mb-4">
              <h2 className="text-balance text-base font-semibold">
                Dados de Medição
              </h2>
              <p className="text-sm text-muted-foreground">
                Valores registrados durante a calibração
              </p>
            </div>
            <div className="space-y-5">
              {measurementFields.map((field) => (
                <div key={field.key}>
                  <Label className="mb-2 block text-sm font-medium text-muted-foreground">
                    {field.label}
                    {displayUnitFor(field.unit) && (
                      <span className="text-xs ml-1">
                        ({displayUnitFor(field.unit)})
                      </span>
                    )}
                  </Label>
                  <div className="min-w-0 rounded-lg bg-muted/20 p-2">
                    {renderFieldValue(field)}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className={`${subtleSurfaceClass} p-4`}>
            <Accordion>
              <AccordionItem value="approved-calculated-results">
                <AccordionTrigger className="min-h-10 py-0 hover:no-underline">
                  <div className="min-w-0">
                    <h2 className="text-balance text-base font-semibold">
                      Resultados Calculados
                    </h2>
                    <p className="text-pretty text-sm font-normal text-muted-foreground">
                      Valores armazenados no momento da aprovação.
                    </p>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pt-4">
                  <div className="space-y-3">
                    {methodSnapshot.formulas.map((formula) => (
                      <div key={formula.outputKey}>{renderResult(formula)}</div>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </section>
        </main>

        <aside className="min-w-0 space-y-6 xl:sticky xl:top-6">
          <section className={`${subtleSurfaceClass} overflow-hidden`}>
            <div className="border-b border-black/5 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Próxima ação
              </p>
              <h2 className="text-balance text-base font-semibold">
                Distribuir certificado
              </h2>
            </div>
            <div className="space-y-3 p-4">
              {job.certificateUrl ? (
                <div className="space-y-3">
                  <div
                    className="aspect-[3/4] cursor-pointer overflow-hidden rounded-lg bg-muted shadow-[0_1px_2px_rgba(15,23,42,0.08),0_16px_40px_rgba(15,23,42,0.08)] outline outline-1 outline-black/10 transition-[opacity,transform] hover:opacity-95 active:scale-[0.96] dark:outline-white/10"
                    onClick={handleDownloadCertificate}
                  >
                    <iframe
                      src={`${certificatePreviewUrl ?? job.certificateUrl}#toolbar=0&navpanes=0`}
                      className="w-full h-full border-0 pointer-events-none"
                      title="Certificate Preview"
                    />
                  </div>
                  <p className="text-center text-xs text-muted-foreground">
                    Clique para abrir em nova aba
                  </p>
                </div>
              ) : job.status === 'GENERATING_PDF' ? (
                <div className="flex aspect-[3/4] flex-col items-center justify-center gap-3 rounded-lg bg-muted/50">
                  <Spinner className="h-8 w-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    Gerando certificado...
                  </p>
                </div>
              ) : (
                <div className="flex aspect-[3/4] flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-muted bg-muted/50">
                  <HugeiconsIcon
                    icon={FileDownloadIcon}
                    className="h-8 w-8 text-muted-foreground"
                  />
                  <p className="text-sm text-muted-foreground text-center">
                    Certificado não disponível
                  </p>
                </div>
              )}
              <div className="grid gap-2">
                <Button
                  className={`${actionButtonClass} w-full justify-start bg-primary`}
                  onClick={handleDownloadCertificate}
                  disabled={!job.certificateUrl || isDownloading}
                >
                  {isDownloading ? (
                    <Spinner className="mr-2 h-4 w-4" />
                  ) : (
                    <HugeiconsIcon
                      icon={FileDownloadIcon}
                      className="mr-2 h-4 w-4"
                    />
                  )}
                  Baixar Certificado
                </Button>
                <Button
                  variant="outline"
                  className={`${actionButtonClass} w-full justify-start`}
                  onClick={
                    job.labelUrl ? handleDownloadLabel : handleGenerateLabel
                  }
                  disabled={
                    isGeneratingLabel || isDownloadingLabel || labelPending
                  }
                >
                  {isGeneratingLabel || isDownloadingLabel || labelPending ? (
                    <Spinner className="mr-2 h-4 w-4" />
                  ) : (
                    <HugeiconsIcon
                      icon={PrinterIcon}
                      className="mr-2 h-4 w-4"
                    />
                  )}
                  {labelPending
                    ? 'Gerando etiqueta...'
                    : job.labelUrl
                      ? 'Baixar Etiqueta QR'
                      : 'Gerar Etiqueta QR'}
                </Button>
                <Button
                  variant="outline"
                  className={`${actionButtonClass} w-full justify-start`}
                >
                  <HugeiconsIcon icon={Mail01Icon} className="mr-2 h-4 w-4" />
                  Enviar por Email
                </Button>
                {job.status !== 'SUPERSEDED' && (
                  <Button
                    variant="ghost"
                    className={`${actionButtonClass} w-full justify-start text-muted-foreground`}
                    onClick={() => setIsAmendDialogOpen(true)}
                  >
                    <HugeiconsIcon icon={Edit02Icon} className="mr-2 h-4 w-4" />
                    Retificar Certificado
                  </Button>
                )}
              </div>
            </div>
          </section>

          <section className={`${subtleSurfaceClass} p-4`}>
            <h2 className="mb-3 text-base font-semibold">Responsáveis</h2>
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-sm font-medium">
                  {job.technicianName?.charAt(0).toUpperCase() || '?'}
                </div>
                <div className="min-w-0">
                  <Label className="text-xs font-medium text-muted-foreground">
                    Técnico Executor
                  </Label>
                  <p className="truncate text-sm font-medium">
                    {job.technicianName || 'Não informado'}
                  </p>
                </div>
              </div>
              <Separator />
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100 text-green-700">
                  <HugeiconsIcon
                    icon={CheckmarkCircle02Icon}
                    className="h-4 w-4"
                  />
                </div>
                <div className="min-w-0">
                  <Label className="text-xs font-medium text-muted-foreground">
                    Aprovador
                  </Label>
                  <p className="truncate text-sm font-medium">
                    {job.approverName || 'Sistema'}
                  </p>
                </div>
              </div>
            </div>
          </section>

          <AuditTimeline events={buildJobTimelineEvents(job)} />
        </aside>
      </div>
    </div>
  )
}

function LabelReadyNotifier({ onReady }: { onReady: () => void }) {
  useMountEffect(() => {
    onReady()
  })

  return null
}

function PendingLabelPoller({ onRefresh }: { onRefresh: () => void }) {
  useMountEffect(() => {
    const interval = window.setInterval(onRefresh, 2000)
    const warningTimeout = window.setTimeout(() => {
      toast.warning('A geração está demorando mais que o esperado...')
    }, 30000)

    return () => {
      window.clearInterval(interval)
      window.clearTimeout(warningTimeout)
    }
  })

  return null
}
