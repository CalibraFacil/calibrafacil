import { HugeiconsIcon } from '@hugeicons/react'
import { Edit02Icon } from '@hugeicons/core-free-icons'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@calibra-facil/ui/card'
import type { JobDetailData } from '../job-detail-types'

/** Amendment info banner - ISO 17025 Clause 7.8.4.1 */
export function JobAmendmentBanner({ job }: { job: JobDetailData }) {
  return (
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
  )
}
