import { HugeiconsIcon } from '@hugeicons/react'
import {
  FileDownloadIcon,
  PrinterIcon,
  Mail01Icon,
  Edit02Icon,
  CheckmarkCircle02Icon,
  Alert02Icon,
} from '@hugeicons/core-free-icons'
import { Button } from '@calibra-facil/ui/button'
import { Separator } from '@calibra-facil/ui/separator'
import { Label } from '@calibra-facil/ui/label'
import {
  AuditTimeline,
  buildJobTimelineEvents,
} from '@/components/audit-timeline'
import { Spinner } from '@calibra-facil/ui/spinner'
import {
  REVIEW_ACTION_BUTTON_CLASS,
  type ApprovedJobRecordData,
} from '@/features/jobs/detail-model'
import { Panel, PanelHeader } from '@calibra-facil/ui/instrument-panel'
import { PrintLabelButton } from '@/features/printing/print-label-button'
import { ActionAvailabilityGate } from '@/components/availability/action-availability-gate'
import { useOperationAvailability } from '@/runtime/use-operation-availability'

type Availability = ReturnType<typeof useOperationAvailability>

export function ApprovedRecordAside({
  job,
  certificatePreviewUrl,
  isDownloading,
  isGeneratingLabel,
  isDownloadingLabel,
  labelPending,
  amendAvailability,
  flagOutOfToleranceAvailability,
  canFlagOutOfTolerance,
  handleDownloadCertificate,
  handleDownloadLabel,
  handleGenerateLabel,
  setIsAmendDialogOpen,
  setIsOotDialogOpen,
}: {
  job: ApprovedJobRecordData
  certificatePreviewUrl: string | null | undefined
  isDownloading: boolean
  isGeneratingLabel: boolean
  isDownloadingLabel: boolean
  labelPending: boolean
  amendAvailability: Availability
  flagOutOfToleranceAvailability: Availability
  canFlagOutOfTolerance: boolean
  handleDownloadCertificate: () => void
  handleDownloadLabel: () => void
  handleGenerateLabel: () => void
  setIsAmendDialogOpen: (open: boolean) => void
  setIsOotDialogOpen: (open: boolean) => void
}) {
  return (
    <aside className="min-w-0 space-y-6 xl:sticky xl:top-6">
      <Panel className="overflow-hidden">
        <div className="border-b border-foreground/10 p-4">
          <PanelHeader title="Distribuir certificado" />
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
                {/* No `sandbox` on purpose: Chromium refuses to instantiate its
                        PDF viewer inside any sandboxed frame (plugins are disabled
                        regardless of the token list), which would blank the preview.
                        The src is our own signed certificate URL. */}
                {/* oxlint-disable-next-line react/iframe-missing-sandbox */}
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
              onClick={job.labelUrl ? handleDownloadLabel : handleGenerateLabel}
              disabled={isGeneratingLabel || isDownloadingLabel || labelPending}
            >
              {isGeneratingLabel || isDownloadingLabel || labelPending ? (
                <Spinner className="mr-2 h-4 w-4" />
              ) : (
                <HugeiconsIcon icon={PrinterIcon} className="mr-2 h-4 w-4" />
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
              <ActionAvailabilityGate
                availability={amendAvailability}
                className="w-full"
              >
                {({ disabled }) => (
                  <Button
                    variant="ghost"
                    disabled={disabled}
                    className={`${REVIEW_ACTION_BUTTON_CLASS} w-full justify-start text-muted-foreground`}
                    onClick={() => setIsAmendDialogOpen(true)}
                  >
                    <HugeiconsIcon icon={Edit02Icon} className="mr-2 h-4 w-4" />
                    Retificar Certificado
                  </Button>
                )}
              </ActionAvailabilityGate>
            )}
            {canFlagOutOfTolerance && (
              <ActionAvailabilityGate
                availability={flagOutOfToleranceAvailability}
                className="w-full"
              >
                {({ disabled }) => (
                  <Button
                    variant="outline"
                    disabled={disabled}
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
              </ActionAvailabilityGate>
            )}
          </div>
        </div>
      </Panel>

      <Panel className="p-4 sm:p-5">
        <PanelHeader title="Responsáveis" />
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
              <HugeiconsIcon icon={CheckmarkCircle02Icon} className="h-4 w-4" />
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
        <PanelHeader title="Histórico" />
        <div className="mt-4">
          <AuditTimeline
            events={buildJobTimelineEvents(job)}
            showCard={false}
          />
        </div>
      </Panel>
    </aside>
  )
}
