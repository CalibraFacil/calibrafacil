import { HugeiconsIcon } from '@hugeicons/react'
import { Alert02Icon } from '@hugeicons/core-free-icons'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@calibra-facil/ui/card'
import { type ApprovedJobRecordData } from '@/features/jobs/detail-model'

/** Amendment info banner - ISO 17025 Clause 7.8.4.1 */
export function ApprovedRecordAmendmentBanner({
  job,
}: {
  job: ApprovedJobRecordData
}) {
  return (
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
              Este certificado foi <strong>cancelado e substituído</strong> por
              uma versão retificada.
            </p>
            {job.amendmentReason && (
              <div className="mt-3 p-3 bg-white/60 rounded-md border border-red-200">
                <p className="text-xs font-medium text-red-800 mb-1">
                  Motivo da retificação:
                </p>
                <p className="text-sm text-red-900">{job.amendmentReason}</p>
              </div>
            )}
          </>
        )}
        {job.supersedesId && (
          <>
            <p className="text-sm text-amber-700">
              Este certificado é uma <strong>retificação</strong> (versão{' '}
              {job.amendmentNumber || 1}) que substitui o certificado original.
            </p>
            {job.amendmentReason && (
              <div className="mt-3 p-3 bg-white/60 rounded-md border border-amber-200">
                <p className="text-xs font-medium text-amber-800 mb-1">
                  Motivo da retificação:
                </p>
                <p className="text-sm text-amber-900">{job.amendmentReason}</p>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
