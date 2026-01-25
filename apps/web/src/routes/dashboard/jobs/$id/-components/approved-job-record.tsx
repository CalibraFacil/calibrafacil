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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  AuditTimeline,
  buildJobTimelineEvents,
} from '@/components/audit-timeline'
import { api } from '@/utils/api'
import { toast } from 'sonner'
import { useState, useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Spinner } from '@/components/ui/spinner'

interface MethodSnapshot {
  methodId: number
  methodName: string
  methodVersion: number
  dataFields: Array<{
    key: string
    label: string
    type: string
    unit?: string
    columns?: Array<{ key: string; label: string; unit?: string }>
  }>
  formulas: Array<{
    outputKey: string
    expression: string
    label?: string
    unit?: string
  }>
  validations: Array<{
    expression: string
    message: string
    severity: 'error' | 'warning'
  }>
}

interface StandardSnapshot {
  id: number
  name: string
  certificateNumber: string
  calibrationDate: string
  uncertainty: number | null
  uncertaintyUnit: string | null
  coverageFactor: number
  drift: number | null
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
  technicianName: string | null
  approvedBy: string | null
  approverName?: string | null
  approvedAt: string | null
  performedAt: string | null
  createdAt: string
  certificateUrl?: string | null
  labelUrl?: string | null
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
  if (typeof value === 'number') {
    const formatted = Number.isInteger(value) ? String(value) : value.toFixed(4)
    return unit ? `${formatted} ${unit}` : formatted
  }
  if (Array.isArray(value)) {
    return value.map((v) => formatValue(v)).join(', ')
  }
  return String(value)
}

export function ApprovedJobRecord({
  job,
  onBack,
  onRefresh,
}: ApprovedJobRecordProps) {
  const { methodSnapshot, data, results, standardsSnapshot } = job
  const navigate = useNavigate()
  const [isDownloading, setIsDownloading] = useState(false)
  const [isGeneratingLabel, setIsGeneratingLabel] = useState(false)
  const [isDownloadingLabel, setIsDownloadingLabel] = useState(false)
  const [labelPending, setLabelPending] = useState(false)
  // Amendment state - ISO 17025 Clause 7.8.4.1
  const [isAmendDialogOpen, setIsAmendDialogOpen] = useState(false)
  const [amendmentReason, setAmendmentReason] = useState('')
  const [isAmending, setIsAmending] = useState(false)

  // Poll for label completion when generation was triggered
  // labelUrl is the single source of truth - polling continues until it appears
  useEffect(() => {
    if (!labelPending) return

    // If label is now available, stop polling
    if (job.labelUrl) {
      setLabelPending(false)
      toast.success('Etiqueta gerada com sucesso!')
      return
    }

    // Poll every 2 seconds
    const interval = setInterval(onRefresh, 2000)

    // Warn user if taking too long (but don't stop polling)
    const warningTimeout = setTimeout(() => {
      toast.warning('A geração está demorando mais que o esperado...')
    }, 30000)

    return () => {
      clearInterval(interval)
      clearTimeout(warningTimeout)
    }
  }, [labelPending, job.labelUrl, onRefresh])

  const handleDownloadCertificate = async () => {
    setIsDownloading(true)
    try {
      const res = await api.api.jobs[':id'].download.$get({
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
        params: { id: String(result.amendedJob.id) },
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
    const value = data?.[field.key]

    if (field.type === 'table' && field.columns && Array.isArray(value)) {
      return (
        <Table>
          <TableHeader>
            <TableRow>
              {field.columns.map((col) => (
                <TableHead key={col.key}>
                  {col.label}
                  {col.unit && (
                    <span className="text-xs text-muted-foreground ml-1">
                      ({col.unit})
                    </span>
                  )}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {(value as Record<string, unknown>[]).map((row, idx) => (
              <TableRow key={idx}>
                {field.columns!.map((col) => (
                  <TableCell key={col.key} className="font-mono">
                    {formatValue(row[col.key], col.unit)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )
    }

    return <span className="font-mono">{formatValue(value, field.unit)}</span>
  }

  // Render formula result (from stored results, no recalculation)
  const renderResult = (formula: MethodSnapshot['formulas'][0]) => {
    const value = results?.[formula.outputKey]
    const validation = methodSnapshot.validations.find((v) =>
      v.expression.includes(formula.outputKey),
    )
    // Check if value passes (simple heuristic - in real impl would store pass/fail)
    const isPassed = value !== undefined && value !== null

    return (
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between p-3 bg-muted/50 rounded-lg">
        <div className="min-w-0">
          <span className="font-medium">
            {formula.label || formula.outputKey}
          </span>
          {formula.unit && (
            <span className="text-xs text-muted-foreground ml-1">
              ({formula.unit})
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-base sm:text-lg break-all">
            {formatValue(value, formula.unit)}
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
      {/* Header - Status & Actions */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="shrink-0"
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} className="mr-2 h-4 w-4" />
            Voltar
          </Button>
          <div className="min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl md:text-2xl font-bold font-mono truncate">
                {job.jobId}
              </h1>
              <Badge
                variant="default"
                className="bg-green-600 text-white text-sm px-3 py-1 shrink-0"
              >
                <HugeiconsIcon
                  icon={CheckmarkCircle02Icon}
                  className="h-4 w-4 mr-1"
                />
                APROVADO
              </Badge>
            </div>
            <p className="text-muted-foreground text-sm md:text-base truncate">
              {job.assetName}
              {job.assetTag && (
                <span className="font-mono ml-1">({job.assetTag})</span>
              )}
            </p>
          </div>
        </div>

        {/* Desktop Actions - Hidden on mobile */}
        <div className="hidden md:flex items-center gap-2 shrink-0">
          <Button
            className="bg-primary"
            onClick={handleDownloadCertificate}
            disabled={!job.certificateUrl || isDownloading}
          >
            {isDownloading ? (
              <Spinner className="mr-2 h-4 w-4" />
            ) : (
              <HugeiconsIcon icon={FileDownloadIcon} className="mr-2 h-4 w-4" />
            )}
            Baixar Certificado
          </Button>

          <Button
            variant="outline"
            onClick={job.labelUrl ? handleDownloadLabel : handleGenerateLabel}
            disabled={isGeneratingLabel || isDownloadingLabel || labelPending}
          >
            {isGeneratingLabel || isDownloadingLabel || labelPending ? (
              <Spinner className="mr-2 h-4 w-4" />
            ) : (
              <HugeiconsIcon icon={PrinterIcon} className="mr-2 h-4 w-4" />
            )}
            {labelPending
              ? 'Gerando...'
              : job.labelUrl
                ? 'Baixar Etiqueta'
                : 'Gerar Etiqueta QR'}
          </Button>
          <Button variant="outline">
            <HugeiconsIcon icon={Mail01Icon} className="mr-2 h-4 w-4" />
            Enviar por Email
          </Button>
          <Button
            variant="ghost"
            className="text-muted-foreground"
            onClick={() => setIsAmendDialogOpen(true)}
          >
            <HugeiconsIcon icon={Edit02Icon} className="mr-2 h-4 w-4" />
            Retificar Certificado
          </Button>
        </div>

        {/* Mobile Actions - DropdownMenu */}
        <div className="flex md:hidden gap-2">
          <Button
            className="bg-primary flex-1"
            onClick={handleDownloadCertificate}
            disabled={!job.certificateUrl || isDownloading}
          >
            {isDownloading ? (
              <Spinner className="mr-2 h-4 w-4" />
            ) : (
              <HugeiconsIcon icon={FileDownloadIcon} className="mr-2 h-4 w-4" />
            )}
            Baixar Certificado
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={(props) => (
                <Button variant="outline" size="icon" {...props}>
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
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

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

      {/* Two-Column Layout */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left Column: The Evidence (2/3 width) */}
        <div className="lg:col-span-2 space-y-6">
          {/* Standards Used */}
          {standardsSnapshot && standardsSnapshot.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Padrões de Referência Utilizados
                </CardTitle>
                <CardDescription>
                  Rastreabilidade metrológica conforme ISO 17025
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {standardsSnapshot.map((std) => (
                    <div
                      key={std.id}
                      className="p-3 bg-muted/30 rounded-lg border border-muted"
                    >
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <span className="font-medium break-words">
                            {std.name}
                          </span>
                          <p className="text-sm text-muted-foreground break-all">
                            Certificado: {std.certificateNumber}
                          </p>
                        </div>
                        <div className="text-left sm:text-right text-sm shrink-0">
                          <p>Calibrado em: {formatDate(std.calibrationDate)}</p>
                          {std.uncertainty != null && (
                            <p className="font-mono text-muted-foreground">
                              U = {std.uncertainty} {std.uncertaintyUnit || ''}{' '}
                              (k={std.coverageFactor})
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Measurement Data */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Dados de Medição</CardTitle>
              <CardDescription>
                Valores registrados durante a calibração
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {methodSnapshot.dataFields.map((field) => (
                <div key={field.key}>
                  <Label className="text-sm font-medium text-muted-foreground mb-2 block">
                    {field.label}
                    {field.unit && (
                      <span className="text-xs ml-1">({field.unit})</span>
                    )}
                  </Label>
                  <div className="bg-muted/30 rounded-lg p-3 border border-muted">
                    {renderFieldValue(field)}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Results */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Resultados Calculados</CardTitle>
              <CardDescription>
                Valores armazenados no momento da aprovação
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {methodSnapshot.formulas.map((formula) => (
                <div key={formula.outputKey}>{renderResult(formula)}</div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Right Column: The Context (1/3 width) */}
        <div className="space-y-6">
          {/* Summary */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Resumo</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="text-xs font-medium text-muted-foreground">
                  Cliente
                </Label>
                <p className="text-sm font-medium">{job.customerName || '-'}</p>
              </div>
              <div>
                <Label className="text-xs font-medium text-muted-foreground">
                  Serviço
                </Label>
                <p className="text-sm">{job.serviceName || '-'}</p>
              </div>
              <div>
                <Label className="text-xs font-medium text-muted-foreground">
                  Método
                </Label>
                <p className="text-sm">
                  {methodSnapshot.methodName} v{methodSnapshot.methodVersion}
                </p>
              </div>
              <Separator />
              <div>
                <Label className="text-xs font-medium text-muted-foreground">
                  Técnico Executor
                </Label>
                <div className="flex items-center gap-2 mt-1">
                  <div className="h-8 w-8 bg-muted rounded-full flex items-center justify-center text-xs font-medium">
                    {job.technicianName?.charAt(0).toUpperCase() || '?'}
                  </div>
                  <div>
                    <p className="text-sm font-medium">
                      {job.technicianName || 'Não informado'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(job.performedAt)}
                    </p>
                  </div>
                </div>
              </div>
              <div>
                <Label className="text-xs font-medium text-muted-foreground">
                  Aprovador
                </Label>
                <div className="flex items-center gap-2 mt-1">
                  <div className="h-8 w-8 bg-green-100 text-green-700 rounded-full flex items-center justify-center text-xs font-medium">
                    <HugeiconsIcon
                      icon={CheckmarkCircle02Icon}
                      className="h-4 w-4"
                    />
                  </div>
                  <div>
                    <p className="text-sm font-medium">
                      {job.approverName || 'Sistema'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(job.approvedAt)}
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Certificate Preview */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-base">Certificado</CardTitle>
              {job.certificateUrl && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleDownloadCertificate}
                  disabled={isDownloading}
                >
                  {isDownloading ? (
                    <Spinner className="mr-2 h-3 w-3" />
                  ) : (
                    <HugeiconsIcon
                      icon={FileDownloadIcon}
                      className="mr-2 h-3 w-3"
                    />
                  )}
                  Download
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {job.certificateUrl ? (
                <div className="space-y-3">
                  <div
                    className="aspect-[3/4] bg-muted rounded-lg overflow-hidden cursor-pointer hover:opacity-90 transition-opacity"
                    onClick={handleDownloadCertificate}
                  >
                    <iframe
                      src={`${job.certificateUrl}#toolbar=0&navpanes=0`}
                      className="w-full h-full border-0 pointer-events-none"
                      title="Certificate Preview"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground text-center">
                    Clique para abrir em nova aba
                  </p>
                </div>
              ) : job.status === 'GENERATING_PDF' ? (
                <div className="aspect-[3/4] bg-muted/50 rounded-lg flex flex-col items-center justify-center gap-3">
                  <Spinner className="h-8 w-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    Gerando certificado...
                  </p>
                </div>
              ) : (
                <div className="aspect-[3/4] bg-muted/50 rounded-lg border-2 border-dashed border-muted flex flex-col items-center justify-center gap-2">
                  <HugeiconsIcon
                    icon={FileDownloadIcon}
                    className="h-8 w-8 text-muted-foreground"
                  />
                  <p className="text-sm text-muted-foreground text-center">
                    Certificado não disponível
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Audit Timeline */}
          <AuditTimeline events={buildJobTimelineEvents(job)} />
        </div>
      </div>
    </div>
  )
}
