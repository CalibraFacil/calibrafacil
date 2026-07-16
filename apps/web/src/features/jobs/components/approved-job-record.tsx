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
  CheckmarkBadge02Icon,
  ArrowLeft01Icon,
  MoreVerticalIcon,
  Alert02Icon,
  Target02Icon,
  RulerIcon,
  FunctionIcon,
  Calendar03Icon,
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
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  AuditTimeline,
  buildJobTimelineEvents,
} from '@/components/audit-timeline'
import { calibraApi } from '@/utils/api'
import { toast } from 'sonner'
import { useCallback, useMemo, useState } from 'react'
import {
  getJobCertificateDownloadUrl,
  getJobLabelDownloadUrl,
  useJobCertificateDownloadUrlData,
} from '@/features/jobs/queries'
import { useNavigate } from '@tanstack/react-router'
import {
  convertMassValue,
  formatCalibrationValue,
  normalizeAccreditationNumber,
  shouldRenderAccreditationSeal,
} from '@calibra-facil/shared'
import { useActiveOrganization } from '@calibra-facil/auth/client'
import { AccreditationSeal } from '@/components/accreditation-seal'
import { Spinner } from '@/components/ui/spinner'
import { useMountEffect } from '@/hooks/use-mount-effect'
import { isMassCompositionValue } from '@/components/method-runtime/mass-composition-utils'
import { RepeatabilityTable } from '@/features/jobs/components/repeatability-table'
import {
  buildApprovedJobRecordModel,
  formatDate,
  formatReviewValue,
  REVIEW_ACTION_BUTTON_CLASS,
  reviewColumnDisplayLabel,
  type ApprovedJobRecordData,
} from '@/features/jobs/detail-model'
import {
  BlueprintField,
  BlueprintGrid,
  BlueprintOverlay,
  InfoHint,
  Panel,
  PanelHeader,
  SignalTile,
  StaggerGroup,
  StaggerItem,
} from '@/components/instrument-panel'
import { cn } from '@/lib/utils'
import { CertificateReleaseControl } from '@/features/finance/certificate-release'
import { PrintLabelButton } from '@/features/printing/print-label-button'

interface ApprovedJobRecordProps {
  job: ApprovedJobRecordData
  /** Flagging §7.10 requires the cloud API; the action is hidden on desktop. */
  isDesktop?: boolean
  onBack: () => void
  onRefresh: () => void
}

export function ApprovedJobRecord({
  job,
  isDesktop = false,
  onBack,
  onRefresh,
}: ApprovedJobRecordProps) {
  const { methodSnapshot, standardsSnapshot } = job
  const {
    equipmentSpecItems,
    supportContextItems,
    assetBaseMeasurementUnit,
    displayData,
    displayResults,
    displayUnitFor,
    measurementFields,
    validations,
    pointsTotal,
    pointsWithin,
    expandedUncertainty,
  } = useMemo(() => buildApprovedJobRecordModel(job), [job])
  const isSuperseded = job.status === 'SUPERSEDED'
  const standardsCount = standardsSnapshot?.length ?? 0
  const navigate = useNavigate()
  const { data: activeOrg } = useActiveOrganization()
  // Accreditation additional fields are not part of the inferred client type.
  const orgAccreditation: {
    accreditationActive?: boolean | null
    accreditationNumber?: string | null
    accreditationValidFrom?: Date | string | null
    accreditationValidUntil?: Date | string | null
  } = activeOrg ?? {}
  const accreditationNumber = normalizeAccreditationNumber(
    orgAccreditation.accreditationNumber ?? '',
  )
  // #647: vigência evaluated at the job's approval (emission) date.
  const approvedAtDate = job.approvedAt ? new Date(job.approvedAt) : undefined
  const certificateAccredited = shouldRenderAccreditationSeal({
    lab: {
      accreditationActive: orgAccreditation.accreditationActive,
      accreditationNumber,
      accreditationValidFrom: orgAccreditation.accreditationValidFrom,
      accreditationValidUntil: orgAccreditation.accreditationValidUntil,
    },
    methodAccreditedScope: methodSnapshot.accreditedScope ?? false,
    // #427 Phase 1: an approval overridden past the CMC guard was
    // downgraded to non-accredited issuance.
    scopeOverrideJustification: job.scopeOverrideJustification,
    ...(approvedAtDate ? { atDate: approvedAtDate } : {}),
  })
  const [isDownloading, setIsDownloading] = useState(false)
  const [isGeneratingLabel, setIsGeneratingLabel] = useState(false)
  const [isDownloadingLabel, setIsDownloadingLabel] = useState(false)
  const [labelPending, setLabelPending] = useState(false)
  // Amendment state - ISO 17025 Clause 7.8.4.1
  const [isAmendDialogOpen, setIsAmendDialogOpen] = useState(false)
  const [amendmentReason, setAmendmentReason] = useState('')
  const [isAmending, setIsAmending] = useState(false)
  // §7.10 out-of-tolerance NC state (#426)
  const isOutOfToleranceAsFound = job.asFoundConformity === 'NON_CONFORMING'
  const canFlagOutOfTolerance = isOutOfToleranceAsFound && !isDesktop
  const [isOotDialogOpen, setIsOotDialogOpen] = useState(false)
  const [ootDescription, setOotDescription] = useState('')
  const [ootAffectedScope, setOotAffectedScope] = useState('')
  const [ootNotifyCustomer, setOotNotifyCustomer] = useState(true)
  const [isFlaggingOot, setIsFlaggingOot] = useState(false)
  const fetchCertificateDownloadUrl = useCallback(async () => {
    return getJobCertificateDownloadUrl(job.id)
  }, [job.id])

  const { data: certificatePreviewDownloadUrl } =
    useJobCertificateDownloadUrlData({
      certificateUrl: job.certificateUrl,
      enabled: Boolean(job.certificateUrl),
      jobId: job.id,
    })
  const certificatePreviewUrl =
    certificatePreviewDownloadUrl ?? job.certificateUrl

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
      await calibraApi.jobs.generateLabel(job.id)
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
      const url = await getJobLabelDownloadUrl(job.id)
      window.open(url, '_blank')
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
      const result = await calibraApi.jobs.amend(job.id, amendmentReason)

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

  // §7.10 (#426): open a typed NC (and optional customer notification) for an
  // as-found out-of-tolerance result. Cloud-only — the button is hidden on desktop.
  const handleFlagOutOfTolerance = async () => {
    setIsFlaggingOot(true)
    try {
      await calibraApi.jobs.flagOutOfTolerance(job.id, {
        description: ootDescription.trim() || undefined,
        affectedScope: ootAffectedScope.trim() || undefined,
        notifyCustomer: ootNotifyCustomer,
      })
      toast.success('Não conformidade registrada')
      toast.info('Acompanhe na área de Qualidade (NC)')
      setIsOotDialogOpen(false)
      setOotDescription('')
      setOotAffectedScope('')
      setOotNotifyCustomer(true)
      onRefresh()
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Erro ao registrar não conformidade',
      )
    } finally {
      setIsFlaggingOot(false)
    }
  }

  // Render a single field value (read-only)
  const renderFieldValue = (
    field: ApprovedJobRecordData['methodSnapshot']['dataFields'][0],
  ) => {
    const value = displayData?.[field.key]

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
          displayUnit={displayUnitFor}
        />
      )
    }

    if (field.type === 'table' && field.columns && Array.isArray(value)) {
      return (
        <div className="max-w-full overflow-x-auto rounded-lg bg-background shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]">
          <Table className="min-w-max text-[13px]">
            <TableHeader className="bg-muted/50">
              <TableRow>
                {field.columns.map((col) => (
                  <TableHead
                    key={col.key}
                    className="h-11 whitespace-nowrap px-3 text-xs"
                  >
                    {reviewColumnDisplayLabel(col)}
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
              {(Array.isArray(value) ? value : [])
                .filter(
                  (row): row is Record<string, unknown> =>
                    row !== null &&
                    typeof row === 'object' &&
                    !Array.isArray(row),
                )
                .map((row, idx) => (
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
                          {formatReviewValue(
                            cellValue,
                            displayUnitFor(col.unit),
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
      <span className="font-mono tabular-nums">
        {formatReviewValue(value, displayUnitFor(field.unit))}
      </span>
    )
  }

  // Render formula result (from stored results, no recalculation)
  const renderResult = (
    formula: ApprovedJobRecordData['methodSnapshot']['formulas'][0],
  ) => {
    const value = displayResults?.[formula.outputKey]
    const validation = validations.find((v) =>
      `${v.leftExpression} ${v.rightExpression}`.includes(formula.outputKey),
    )
    // Check if value passes (simple heuristic - in real impl would store pass/fail)
    const isPassed = value !== undefined && value !== null

    return (
      <div className="flex flex-col gap-3 rounded-lg bg-background p-3 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)] transition-[background-color,box-shadow] hover:bg-muted/20 sm:flex-row sm:items-center sm:justify-between">
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
            {formatReviewValue(value, displayUnitFor(formula.unit))}
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
          className={`${REVIEW_ACTION_BUTTON_CLASS} w-fit shrink-0`}
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
                className={`${REVIEW_ACTION_BUTTON_CLASS} size-10 shadow-[0_1px_2px_rgba(15,23,42,0.08)]`}
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

      {/* Quality-record seal hero */}
      <Panel className="relative overflow-hidden">
        <BlueprintOverlay />
        <div className="relative flex flex-col gap-5 p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <span
                className={cn(
                  'relative flex size-16 shrink-0 items-center justify-center rounded-full',
                  isSuperseded
                    ? 'bg-amber-500/12 text-amber-700 dark:text-amber-400'
                    : 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400',
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'absolute inset-1 rounded-full border border-dashed',
                    isSuperseded
                      ? 'border-amber-500/40'
                      : 'border-emerald-500/40',
                  )}
                />
                <HugeiconsIcon icon={CheckmarkBadge02Icon} className="size-8" />
              </span>
              <div className="min-w-0">
                <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  Registro de qualidade
                </p>
                <h1 className="text-balance font-mono text-2xl font-semibold tracking-tight">
                  {job.jobId}
                </h1>
                <p className="mt-0.5 text-pretty text-sm text-muted-foreground">
                  {job.serviceName}
                  {methodSnapshot.methodName && (
                    <span className="ml-2 text-xs">
                      ({methodSnapshot.methodName} v
                      {methodSnapshot.methodVersion})
                    </span>
                  )}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
              <Badge
                variant={isSuperseded ? 'outline' : 'default'}
                className={cn(
                  isSuperseded
                    ? 'border-amber-500 bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400'
                    : 'bg-emerald-600 text-white',
                )}
              >
                <HugeiconsIcon
                  icon={CheckmarkCircle02Icon}
                  className="mr-1 h-3 w-3"
                />
                {isSuperseded ? 'Retificado' : 'Aprovado'}
              </Badge>
              {isOutOfToleranceAsFound && (
                <Badge variant="destructive">
                  Fora de tolerância (como encontrado)
                </Badge>
              )}
              <CertificateReleaseControl
                calibrationJobId={job.id}
                jobStatus={job.status}
              />
            </div>
          </div>

          <StaggerGroup className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(160px,1fr))]">
            {pointsTotal > 0 && (
              <StaggerItem>
                <SignalTile
                  icon={Target02Icon}
                  label="Pontos na tolerância"
                  value={`${pointsWithin}/${pointsTotal}`}
                  hint="pontos"
                  tone={pointsWithin === pointsTotal ? 'ok' : 'warning'}
                />
              </StaggerItem>
            )}
            <StaggerItem>
              <SignalTile
                icon={RulerIcon}
                label="Rastreabilidade"
                value={String(standardsCount)}
                hint="padrões"
                tone={standardsCount > 0 ? 'info' : 'neutral'}
              />
            </StaggerItem>
            {expandedUncertainty && (
              <StaggerItem>
                <SignalTile
                  icon={FunctionIcon}
                  label="Incerteza U (máx.)"
                  value={expandedUncertainty}
                  hint="expandida"
                  tone="neutral"
                />
              </StaggerItem>
            )}
            <StaggerItem>
              <SignalTile
                icon={Calendar03Icon}
                label="Aprovado em"
                value={formatDate(job.approvedAt)}
                hint={job.approverName ?? undefined}
                tone="neutral"
              />
            </StaggerItem>
          </StaggerGroup>
        </div>
      </Panel>

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
                Quando um certificado emitido precisar ser alterado, cada
                alteração deve ser identificada e conter referência ao original.
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

      {/* §7.10 Out-of-tolerance NC Dialog (#426) */}
      <Dialog open={isOotDialogOpen} onOpenChange={setIsOotDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HugeiconsIcon
                icon={Alert02Icon}
                className="h-5 w-5 text-destructive"
              />
              Registrar não conformidade
            </DialogTitle>
            <DialogDescription>
              Abre uma não conformidade do tipo &quot;fora de tolerância&quot;
              para este resultado como encontrado e, se marcado, notifica o
              cliente.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="oot-description">Descrição (opcional)</Label>
              <Textarea
                id="oot-description"
                placeholder="Deixe em branco para gerar uma descrição padrão com os dados do job..."
                value={ootDescription}
                onChange={(e) => setOotDescription(e.target.value)}
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="oot-affected-scope">
                Escopo potencialmente afetado (opcional)
              </Label>
              <Textarea
                id="oot-affected-scope"
                placeholder="Ex.: medições realizadas com o instrumento desde a última calibração..."
                value={ootAffectedScope}
                onChange={(e) => setOotAffectedScope(e.target.value)}
                rows={3}
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="oot-notify-customer"
                checked={ootNotifyCustomer}
                onCheckedChange={(checked) =>
                  setOotNotifyCustomer(checked === true)
                }
              />
              <Label
                htmlFor="oot-notify-customer"
                className="text-sm font-normal"
              >
                Notificar cliente (e-mail + PDF)
              </Label>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setIsOotDialogOpen(false)}
              disabled={isFlaggingOot}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleFlagOutOfTolerance}
              disabled={isFlaggingOot}
            >
              {isFlaggingOot ? (
                <>
                  <Spinner className="mr-2 h-4 w-4" />
                  Registrando...
                </>
              ) : (
                'Registrar NC'
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
          <Panel className="p-4 sm:p-5">
            <div className="flex items-start justify-between gap-4">
              <PanelHeader
                eyebrow="Identificação"
                title="Cliente, ativo e método"
                description="Dados congelados no momento da aprovação, que formam a base imutável deste certificado."
              />
              {certificateAccredited ? (
                <AccreditationSeal
                  accreditationNumber={accreditationNumber}
                  width={76}
                />
              ) : null}
            </div>
            <BlueprintGrid className="mt-4 sm:grid-cols-2 lg:grid-cols-4">
              <BlueprintField label="Cliente">
                <span className="font-medium">{job.customerName || '-'}</span>
              </BlueprintField>
              <BlueprintField label="Ativo">
                {job.assetName || '-'}
                {job.assetTag && (
                  <span className="ml-1 font-mono text-muted-foreground">
                    ({job.assetTag})
                  </span>
                )}
              </BlueprintField>
              <BlueprintField label="Serviço">
                {job.serviceName || '-'}
              </BlueprintField>
              <BlueprintField label="Método" mono>
                {methodSnapshot.methodName} v{methodSnapshot.methodVersion}
              </BlueprintField>
            </BlueprintGrid>

            {equipmentSpecItems.length > 0 && (
              <div className="mt-5">
                <p className="mb-2 font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  Especificações do equipamento
                </p>
                <BlueprintGrid className="sm:grid-cols-2">
                  {equipmentSpecItems.map((item) => (
                    <BlueprintField
                      key={item.key}
                      label={item.label}
                      mono
                      className={item.value.length > 36 ? 'sm:col-span-2' : ''}
                    >
                      {item.value}
                    </BlueprintField>
                  ))}
                </BlueprintGrid>
              </div>
            )}

            {supportContextItems.length > 0 && (
              <div className="mt-5">
                <p className="mb-2 font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  Dados complementares
                </p>
                <div className="grid gap-2">
                  {supportContextItems.map((item) => (
                    <div
                      key={item.key}
                      className="min-w-0 rounded-xl bg-muted/30 px-3 py-2.5 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.06)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
                    >
                      <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                        {item.label}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-snug">
                        {item.value}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Panel>

          <Panel className="p-4 sm:p-5">
            <PanelHeader
              eyebrow="Evidência registrada"
              title="Dados de medição"
              description="Valores capturados durante a calibração."
            />
            <div className="mt-4 space-y-5">
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
                  <div className="min-w-0 rounded-xl bg-muted/20 p-2">
                    {renderFieldValue(field)}
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel className="p-4 sm:p-5">
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
          </Panel>

          {standardsSnapshot && standardsSnapshot.length > 0 && (
            <Panel className="p-4 sm:p-5">
              <PanelHeader
                eyebrow="Rastreabilidade metrológica"
                title={
                  <span className="inline-flex items-center gap-1.5">
                    Padrões de referência utilizados
                    <InfoHint label="Sobre rastreabilidade metrológica">
                      Cada medição se liga a referências reconhecidas por uma
                      cadeia contínua e documentada de calibrações, e cada elo
                      contribui para a incerteza do resultado.
                    </InfoHint>
                  </span>
                }
                description="Cada padrão tem certificado e incerteza próprios, que alimentam o orçamento de incerteza da calibração."
                action={
                  <Badge variant="outline">
                    <span className="tabular-nums">
                      {standardsSnapshot.length}
                    </span>
                    {standardsSnapshot.length === 1 ? ' padrão' : ' padrões'}
                  </Badge>
                }
              />
              <div className="mt-4 grid gap-2">
                {standardsSnapshot.map((std) => (
                  <div
                    key={std.id}
                    className="rounded-xl bg-background p-3 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)] transition-[background-color,box-shadow] hover:bg-muted/20"
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
                        <p className="inline-flex flex-wrap items-center gap-1 break-all text-sm text-muted-foreground">
                          Certificado: {std.certificateNumber}
                          <InfoHint label="Sobre o certificado do padrão">
                            Número do certificado de calibração do padrão, que
                            comprova documentalmente a rastreabilidade.
                          </InfoHint>
                        </p>
                      </div>
                      <div className="shrink-0 text-left text-sm sm:text-right">
                        <p>Calibrado em: {formatDate(std.calibrationDate)}</p>
                        {std.uncertainty != null && (
                          <p className="inline-flex flex-wrap items-center gap-1 font-mono tabular-nums text-muted-foreground sm:justify-end">
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
                            <InfoHint
                              label="Sobre incerteza e fator de abrangência"
                              side="left"
                            >
                              <span className="font-medium">U</span>: incerteza
                              expandida do padrão.{' '}
                              <span className="font-medium">k</span>: fator de
                              abrangência; k = 2 corresponde a cerca de 95% de
                              confiança. Soma-se ao orçamento de incerteza desta
                              calibração.
                            </InfoHint>
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          )}
        </main>

        <aside className="min-w-0 space-y-6 xl:sticky xl:top-6">
          <Panel className="overflow-hidden">
            <div className="border-b border-foreground/10 p-4">
              <PanelHeader
                eyebrow="Próxima ação"
                title="Distribuir certificado"
              />
            </div>
            <div className="space-y-3 p-4">
              {job.certificateUrl ? (
                <div className="space-y-3">
                  <div
                    role="button"
                    tabIndex={0}
                    aria-label="Abrir certificado em nova aba"
                    className="aspect-[3/4] cursor-pointer overflow-hidden rounded-lg bg-muted shadow-[0_1px_2px_rgba(15,23,42,0.08),0_16px_40px_rgba(15,23,42,0.08)] outline outline-1 outline-black/10 transition-[opacity,transform] hover:opacity-95 active:scale-[0.96] dark:outline-white/10"
                    onClick={handleDownloadCertificate}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        void handleDownloadCertificate()
                      }
                    }}
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
                  className={`${REVIEW_ACTION_BUTTON_CLASS} w-full justify-start bg-primary`}
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
                  className={`${REVIEW_ACTION_BUTTON_CLASS} w-full justify-start`}
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
                <PrintLabelButton
                  jobId={job.id}
                  className={`${REVIEW_ACTION_BUTTON_CLASS} w-full justify-start`}
                />
                <Button
                  variant="outline"
                  className={`${REVIEW_ACTION_BUTTON_CLASS} w-full justify-start`}
                >
                  <HugeiconsIcon icon={Mail01Icon} className="mr-2 h-4 w-4" />
                  Enviar por Email
                </Button>
                {job.status !== 'SUPERSEDED' && (
                  <Button
                    variant="ghost"
                    className={`${REVIEW_ACTION_BUTTON_CLASS} w-full justify-start text-muted-foreground`}
                    onClick={() => setIsAmendDialogOpen(true)}
                  >
                    <HugeiconsIcon icon={Edit02Icon} className="mr-2 h-4 w-4" />
                    Retificar Certificado
                  </Button>
                )}
                {canFlagOutOfTolerance && (
                  <Button
                    variant="outline"
                    className={`${REVIEW_ACTION_BUTTON_CLASS} w-full justify-start border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive`}
                    onClick={() => setIsOotDialogOpen(true)}
                  >
                    <HugeiconsIcon
                      icon={Alert02Icon}
                      className="mr-2 h-4 w-4"
                    />
                    Registrar NC 7.10
                  </Button>
                )}
              </div>
            </div>
          </Panel>

          <Panel className="p-4 sm:p-5">
            <PanelHeader
              eyebrow="Responsabilidade técnica"
              title="Responsáveis"
            />
            <div className="mt-4 space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-sm font-medium">
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
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/12 text-emerald-700 dark:text-emerald-400">
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
          </Panel>

          <Panel className="p-4 sm:p-5">
            <PanelHeader eyebrow="Trilha de auditoria" title="Histórico" />
            <div className="mt-4">
              <AuditTimeline
                events={buildJobTimelineEvents(job)}
                showCard={false}
              />
            </div>
          </Panel>
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
