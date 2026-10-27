import { HugeiconsIcon } from '@hugeicons/react'
import { Alert02Icon } from '@hugeicons/core-free-icons'
import { Link } from '@tanstack/react-router'
import { STATUS_TONE, type SignalTone } from '@calibra-facil/ui/status-tone'
import { formatInstant } from '@calibra-facil/shared/format'
import { type ApprovedJobRecordData } from '@/features/jobs/detail-model'

/**
 * Certificate lifecycle banner - ISO 17025 Clause 7.8.8 (amendments) and 7.10
 * (nonconforming work). Says which of the four situations the record is in:
 * withdrawn, superseded by an issued amendment, valid with an amendment in
 * progress, or itself an amendment.
 */
export function ApprovedRecordAmendmentBanner({
  job,
}: {
  job: ApprovedJobRecordData
}) {
  const lifecycle = job.certificateLifecycle
  const withdrawn = lifecycle?.status === 'WITHDRAWN'
  const superseded = Boolean(job.supersededById)
  const inProgress = job.amendmentInProgress
  const tone: SignalTone = withdrawn || superseded ? 'critical' : 'warning'
  const title = withdrawn
    ? 'Certificado Retirado'
    : superseded
      ? 'Certificado Substituído'
      : inProgress
        ? 'Retificação em andamento'
        : 'Certificado Retificado'

  return (
    <div
      role="status"
      className={`space-y-2 rounded-xl border p-4 ${STATUS_TONE[tone].alert}`}
    >
      <p className="flex items-center gap-2 text-base font-semibold">
        <HugeiconsIcon icon={Alert02Icon} className="h-5 w-5" />
        {title}
      </p>
      {withdrawn && (
        <>
          <p className="text-sm">
            Este certificado foi <strong>retirado</strong>
            {lifecycle?.changedAt
              ? ` em ${formatInstant(lifecycle.changedAt, 'date')}`
              : ''}{' '}
            e não deve mais ser utilizado.
          </p>
          {lifecycle?.reason && (
            <div className="rounded-md border bg-background/60 p-3">
              <p className="mb-1 text-xs font-medium">Motivo da retirada:</p>
              <p className="text-sm">{lifecycle.reason}</p>
            </div>
          )}
        </>
      )}
      {superseded && (
        <>
          <p className="text-sm">
            Este certificado foi <strong>substituído</strong> por uma versão
            retificada.
          </p>
          {job.amendmentReason && (
            <div className="rounded-md border bg-background/60 p-3">
              <p className="mb-1 text-xs font-medium">Motivo da retificação:</p>
              <p className="text-sm">{job.amendmentReason}</p>
            </div>
          )}
        </>
      )}
      {!superseded && inProgress && (
        <p className="text-sm">
          Há uma retificação em andamento (
          <Link
            to="/dashboard/jobs/$id"
            params={{ id: inProgress.jobId }}
            className="font-medium underline"
          >
            {inProgress.jobId}
          </Link>
          ). Este certificado <strong>permanece válido</strong> até a emissão da
          retificação.
        </p>
      )}
      {job.supersedesId && (
        <>
          <p className="text-sm">
            Este certificado é uma <strong>retificação</strong> (versão{' '}
            {job.amendmentNumber || 1}) que substitui o certificado original.
          </p>
          {job.amendmentReason && !superseded && (
            <div className="rounded-md border bg-background/60 p-3">
              <p className="mb-1 text-xs font-medium">Motivo da retificação:</p>
              <p className="text-sm">{job.amendmentReason}</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
