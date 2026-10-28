import { Link } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Calendar03Icon,
  Cancel01Icon,
  MultiplicationSignIcon,
  RefreshIcon,
} from '@hugeicons/core-free-icons'
import { Button } from '@calibra-facil/ui/button'
import { Badge } from '@calibra-facil/ui/badge'
import {
  getFinancialStatusLabel,
  type FinancialStatus,
} from '@calibra-facil/shared'
import { CertificateProgressButton } from '@/features/jobs/components/certificate-progress-button'
import { ActionAvailabilityGate } from '@/components/availability/action-availability-gate'
import {
  getFinancialVariant,
  JOB_STATUS_LABELS,
  JOB_STATUS_VARIANTS,
  type JobStatus,
  type JobVerdict,
} from '@/features/jobs/detail-model'
import {
  ACTION_BUTTON_CLASS,
  BlueprintOverlay,
  Panel,
  SignalTile,
  StaggerGroup,
  StaggerItem,
} from '@calibra-facil/ui/instrument-panel'
import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'
import type { useOperationAvailability } from '@/runtime/use-operation-availability'
import type { JobDetailData } from '../job-detail-types'
import {
  VERDICT_EMBLEM_CLASS,
  VERDICT_PRESENTATION,
  VERDICT_TEXT_CLASS,
  buildVerdictTiles,
} from '../verdict-presentation'

type Availability = ReturnType<typeof useOperationAvailability>

/** Verdict band: identity, conformance summary and the decision. */
export function JobVerdictBand({
  job,
  id,
  verdict,
  isGeneratingPdf,
  normalizedJobStatus,
  normalizedFinancialStatus,
  canApprove,
  canReject,
  inReview,
  renderFailure,
  approvalBlocked,
  canExecute,
  canCancel,
  approveAvailability,
  rejectAvailability,
  cancelAvailability,
  assignAction,
  onOpenApprove,
  onOpenReject,
  onOpenCancel,
}: {
  job: JobDetailData
  id: string
  verdict: JobVerdict
  isGeneratingPdf: boolean
  normalizedJobStatus: JobStatus
  normalizedFinancialStatus: FinancialStatus
  canApprove: boolean
  canReject: boolean
  /** The job is in review (the approve/reject area is shown). */
  inReview: boolean
  /** The certificate render failed (RENDER_FAILED): retry it or reject the job. */
  renderFailure: {
    error: string | null
    canRetry: boolean
    retrying: boolean
    availability: Availability
    onRetry: () => void
  } | null
  /** Why this member may not approve (separation of duties, role), if so. */
  approvalBlocked: string | null
  canExecute: boolean
  canCancel: boolean
  approveAvailability: Availability
  rejectAvailability: Availability
  cancelAvailability: Availability
  assignAction: ReactNode
  onOpenApprove: () => void
  onOpenReject: () => void
  onOpenCancel: () => void
}) {
  return (
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
                VERDICT_EMBLEM_CLASS[VERDICT_PRESENTATION[verdict.level].tone],
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
                  VERDICT_TEXT_CLASS[VERDICT_PRESENTATION[verdict.level].tone],
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
            ) : renderFailure ? (
              <>
                <p className="max-w-sm text-pretty text-sm text-destructive">
                  {renderFailure.error ?? 'A emissão do certificado falhou.'}
                </p>
                {renderFailure.canRetry ? (
                  <ActionAvailabilityGate
                    availability={renderFailure.availability}
                  >
                    {({ disabled }) => (
                      <Button
                        disabled={disabled || renderFailure.retrying}
                        className={ACTION_BUTTON_CLASS}
                        onClick={() => renderFailure.onRetry()}
                      >
                        <HugeiconsIcon
                          icon={RefreshIcon}
                          className="mr-2 h-4 w-4"
                        />
                        Reemitir certificado
                      </Button>
                    )}
                  </ActionAvailabilityGate>
                ) : null}
                {canReject ? (
                  <ActionAvailabilityGate availability={rejectAvailability}>
                    {({ disabled }) => (
                      <Button
                        variant="destructive"
                        disabled={disabled}
                        className={ACTION_BUTTON_CLASS}
                        onClick={() => onOpenReject()}
                      >
                        <HugeiconsIcon
                          icon={MultiplicationSignIcon}
                          className="mr-2 h-4 w-4"
                        />
                        Rejeitar
                      </Button>
                    )}
                  </ActionAvailabilityGate>
                ) : null}
              </>
            ) : inReview ? (
              <>
                {canApprove ? (
                  <ActionAvailabilityGate availability={approveAvailability}>
                    {({ disabled }) => (
                      <CertificateProgressButton
                        status="idle"
                        disabled={disabled}
                        onApprove={() => onOpenApprove()}
                      />
                    )}
                  </ActionAvailabilityGate>
                ) : approvalBlocked ? (
                  <p className="max-w-sm text-pretty text-sm text-muted-foreground">
                    {approvalBlocked}
                  </p>
                ) : null}
                {canReject ? (
                  <ActionAvailabilityGate availability={rejectAvailability}>
                    {({ disabled }) => (
                      <Button
                        variant="destructive"
                        disabled={disabled}
                        className={ACTION_BUTTON_CLASS}
                        onClick={() => onOpenReject()}
                      >
                        <HugeiconsIcon
                          icon={MultiplicationSignIcon}
                          className="mr-2 h-4 w-4"
                        />
                        Rejeitar
                      </Button>
                    )}
                  </ActionAvailabilityGate>
                ) : null}
                {assignAction}
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
                {assignAction}
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
                  onClick={() => onOpenCancel()}
                >
                  <HugeiconsIcon icon={Cancel01Icon} className="mr-2 h-4 w-4" />
                  Cancelar calibração
                </Button>
              )}
            </ActionAvailabilityGate>
          </div>
        )}
      </div>
    </Panel>
  )
}
