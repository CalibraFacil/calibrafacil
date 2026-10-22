import { formatCalendarDate } from '@calibra-facil/shared/format'
import { Badge } from '@calibra-facil/ui/badge'
import { formatCalibrationValue } from '@calibra-facil/shared'
import {
  formatDateTime,
  REVIEW_SURFACE_CLASS,
} from '@/features/jobs/detail-model'
import { formatStandardDate } from '@/features/standards/dates'
import type { JobReviewModel } from './review-render-helpers'
import type { JobDetailData } from '../job-detail-types'

/** The open-job layout shown before the evidence exists to review. */
export function ExecutionPreparationView({
  job,
  review,
}: {
  job: JobDetailData
  review: JobReviewModel
}) {
  const {
    reviewContextItems,
    reviewDataFields,
    reviewFormulas,
    reviewValidations,
    reviewStandards,
  } = review

  return (
    <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <main className="min-w-0 space-y-6">
        <section className={`${REVIEW_SURFACE_CLASS} p-4`}>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Preparação da execução
              </p>
              <h2 className="text-balance text-lg font-semibold">
                Confirme o job antes de iniciar a calibração
              </h2>
              <p className="mt-1 text-pretty text-sm text-muted-foreground">
                Cliente, ativo, técnico, prazo e especificações ficam juntos
                para comparar com a ficha física antes da primeira leitura.
              </p>
            </div>
            <Badge variant={job.technicianName ? 'outline' : 'secondary'}>
              {job.technicianName ? 'Atribuído' : 'Sem técnico'}
            </Badge>
          </div>

          <div className="grid gap-px overflow-hidden rounded-lg bg-black/5 md:grid-cols-4">
            <div className="bg-background p-3">
              <label className="text-xs font-medium text-muted-foreground">
                Cliente
              </label>
              <p className="mt-1 text-sm font-medium">
                {job.customerName || '-'}
              </p>
            </div>
            <div className="bg-background p-3 md:col-span-2">
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
                Prazo
              </label>
              <p className="mt-1 font-mono text-sm tabular-nums">
                {formatCalendarDate(job.dueDate, 'date', { empty: '-' })}
                {job.daysUntilDue != null && job.daysUntilDue > 0 && (
                  <Badge variant="outline" className="ml-2 text-xs">
                    {job.daysUntilDue} dias
                  </Badge>
                )}
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

        <section className={`${REVIEW_SURFACE_CLASS} p-4`}>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Método congelado
              </p>
              <h2 className="text-balance text-base font-semibold">
                {job.methodSnapshot.methodName || 'Método de calibração'}
              </h2>
              <p className="text-pretty text-sm text-muted-foreground">
                Snapshot usado para executar o job, emitir o certificado e
                auditar os cálculos depois.
              </p>
            </div>
            {job.methodSnapshot.methodVersion && (
              <Badge variant="outline">
                v{job.methodSnapshot.methodVersion}
              </Badge>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg bg-background p-3 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]">
              <p className="text-xs font-medium text-muted-foreground">
                Campos de entrada
              </p>
              <p className="mt-1 font-mono text-2xl font-semibold tabular-nums">
                {reviewDataFields.length}
              </p>
            </div>
            <div className="rounded-lg bg-background p-3 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]">
              <p className="text-xs font-medium text-muted-foreground">
                Fórmulas
              </p>
              <p className="mt-1 font-mono text-2xl font-semibold tabular-nums">
                {reviewFormulas.length}
              </p>
            </div>
            <div className="rounded-lg bg-background p-3 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]">
              <p className="text-xs font-medium text-muted-foreground">
                Critérios de aceitação
              </p>
              <p className="mt-1 font-mono text-2xl font-semibold tabular-nums">
                {reviewValidations.length}
              </p>
            </div>
          </div>

          {reviewValidations.length > 0 && (
            <div className="mt-4 space-y-2">
              <h3 className="text-sm font-medium">Critérios principais</h3>
              {reviewValidations.map((validation, index) => (
                <div
                  key={`${validation.leftExpression}-${validation.operator}-${validation.rightExpression}-${index}`}
                  className="rounded-lg bg-muted/20 px-3 py-2 text-sm text-pretty"
                >
                  {validation.message}
                </div>
              ))}
            </div>
          )}
        </section>

        {reviewStandards.length > 0 && (
          <section className={`${REVIEW_SURFACE_CLASS} p-4`}>
            <div className="mb-4">
              <h2 className="text-balance text-base font-semibold">
                Padrões vinculados
              </h2>
              <p className="text-pretty text-sm text-muted-foreground">
                Rastreabilidade prevista antes da execução.
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
                      <p className="break-all text-sm text-muted-foreground">
                        Certificado: {standard.certificateNumber}
                      </p>
                    </div>
                    <div className="shrink-0 text-left text-sm sm:text-right">
                      <p className="font-mono tabular-nums">
                        {formatStandardDate(standard.calibrationDate)}
                      </p>
                      {standard.uncertainty != null && (
                        <p className="font-mono tabular-nums text-muted-foreground">
                          U = {formatCalibrationValue(standard.uncertainty)}{' '}
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

        {job.status === 'REJECTED' && job.rejectionReason && (
          <section
            className={`${REVIEW_SURFACE_CLASS} border border-destructive/30 p-4`}
          >
            <h2 className="text-base font-semibold text-destructive">
              Motivo da rejeição
            </h2>
            <p className="mt-2 text-pretty text-sm">{job.rejectionReason}</p>
            {job.rejectedAt && (
              <p className="mt-2 text-xs text-muted-foreground">
                Rejeitado em {formatDateTime(job.rejectedAt)}
              </p>
            )}
          </section>
        )}
      </main>

      <aside className="min-w-0 space-y-6 xl:sticky xl:top-6">
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
                Criado em
              </label>
              <p className="font-mono text-sm tabular-nums">
                {formatDateTime(job.createdAt)}
              </p>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Atualizado em
              </label>
              <p className="font-mono text-sm tabular-nums">
                {formatDateTime(job.updatedAt)}
              </p>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Cobrança
              </label>
              <p className="text-sm">
                {job.invoiceEligibility
                  ? 'Elegível para cobrança'
                  : 'Não elegível para cobrança'}
              </p>
              <p className="text-sm text-muted-foreground">
                {job.invoiceDocumentNumber || 'Ainda não faturada'}
              </p>
            </div>
          </div>
        </section>
      </aside>
    </div>
  )
}
