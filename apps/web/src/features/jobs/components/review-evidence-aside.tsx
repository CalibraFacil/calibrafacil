import { formatCalendarDate } from '@calibra-facil/shared/format'
import { HugeiconsIcon } from '@hugeicons/react'
import { Alert02Icon } from '@hugeicons/core-free-icons'
import { Badge } from '@calibra-facil/ui/badge'
import {
  getFinancialStatusLabel,
  type FinancialStatus,
} from '@calibra-facil/shared'
import {
  getFinancialVariant,
  REVIEW_SURFACE_CLASS,
} from '@/features/jobs/detail-model'
import {
  renderAcceptanceBadge,
  type JobReviewModel,
} from './review-render-helpers'
import type { JobDetailData } from '../job-detail-types'

export function ReviewEvidenceAside({
  job,
  review,
  financialStatus,
  normalizedFinancialStatus,
}: {
  job: JobDetailData
  review: JobReviewModel
  financialStatus: string
  normalizedFinancialStatus: FinancialStatus
}) {
  const { quickAlertItems, reviewHasData, reviewHasResults, reviewStandards } =
    review

  return (
    <aside className="min-w-0 space-y-6 xl:sticky xl:top-6">
      <section className={`${REVIEW_SURFACE_CLASS} p-4`}>
        <div className="mb-3 flex items-center gap-2">
          <HugeiconsIcon
            icon={Alert02Icon}
            className="h-4 w-4 text-muted-foreground"
          />
          <h2 className="text-base font-semibold">Critérios e avisos</h2>
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
        <h2 className="mb-3 text-base font-semibold">Checklist rápido</h2>
        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Leituras registradas</span>
            <Badge variant={reviewHasData ? 'outline' : 'destructive'}>
              {reviewHasData ? 'Sim' : 'Não'}
            </Badge>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Resultados calculados</span>
            <Badge variant={reviewHasResults ? 'outline' : 'destructive'}>
              {reviewHasResults ? 'Sim' : 'Não'}
            </Badge>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Padrões vinculados</span>
            <Badge
              variant={reviewStandards.length > 0 ? 'outline' : 'destructive'}
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
        <h2 className="mb-3 text-base font-semibold">Contexto operacional</h2>
        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Técnico responsável
            </label>
            <p className="text-sm">{job.technicianName || 'Não atribuído'}</p>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Prazo
            </label>
            <p className="font-mono text-sm tabular-nums">
              {formatCalendarDate(job.dueDate, 'date', { empty: '-' })}
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
  )
}
