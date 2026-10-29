import { Badge } from '@calibra-facil/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@calibra-facil/ui/table'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@calibra-facil/ui/accordion'
import { formatCalibrationValue } from '@calibra-facil/shared'
import {
  formatDateTime,
  formatReviewValue,
  REVIEW_SURFACE_CLASS,
} from '@/features/jobs/detail-model'
import { formatStandardDate } from '@/features/standards/dates'
import { InfoHint } from '@calibra-facil/ui/instrument-panel'
import {
  renderMarginBadge,
  renderReviewFieldValue,
  renderReviewResult,
  type JobReviewModel,
} from './review-render-helpers'
import type { JobDetailData } from '../job-detail-types'

export function ReviewEvidenceMain({
  job,
  review,
  isGeneratingPdf,
}: {
  job: JobDetailData
  review: JobReviewModel
  isGeneratingPdf: boolean
}) {
  const {
    reviewHasData,
    reviewContextItems,
    adjustmentSummaryRows,
    displayUnitForReview,
    criticalReviewFields,
    reviewHasResults,
    orderedReviewFormulas,
    reviewStandards,
  } = review

  return (
    <div className="min-w-0 space-y-6">
      <section className={`${REVIEW_SURFACE_CLASS} p-4`}>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Evidência para aprovação
            </p>
            <h2 className="text-balance text-lg font-semibold">
              Leituras, resultados e rastreabilidade do job
            </h2>
            <p className="mt-1 text-pretty text-sm text-muted-foreground">
              {isGeneratingPdf
                ? 'A aprovação foi registrada. Mantemos a evidência visível enquanto o certificado é gerado.'
                : 'Revise os dados executados antes de aprovar o certificado.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="w-fit">
              {isGeneratingPdf
                ? 'Gerando PDF'
                : reviewHasData
                  ? 'Dados capturados'
                  : 'Sem dados'}
            </Badge>
          </div>
        </div>
        <div className="grid gap-px overflow-hidden rounded-lg bg-black/5 md:grid-cols-3">
          <div className="bg-background p-3">
            <label className="text-xs font-medium text-muted-foreground">
              Cliente
            </label>
            <p className="mt-1 text-sm font-medium">
              {job.customerName || '-'}
            </p>
          </div>
          <div className="bg-background p-3">
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
              Executado em
            </label>
            <p className="mt-1 font-mono text-sm tabular-nums">
              {formatDateTime(job.performedAt)}
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
              Primeiro olhar
            </p>
            <h2 className="text-balance text-base font-semibold">
              Ajuste antes vs. depois por ponto
            </h2>
            <p className="text-pretty text-sm text-muted-foreground">
              Mostra rapidamente o erro e a margem de conformidade antes e após
              o ajuste.
            </p>
          </div>
          <Badge variant="outline" className="w-fit">
            {adjustmentSummaryRows.length} pontos
          </Badge>
        </div>
        {adjustmentSummaryRows.length > 0 ? (
          <div className="max-w-full overflow-x-auto rounded-lg bg-background shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]">
            <Table className="min-w-max text-[13px]">
              <TableHeader className="bg-muted/50">
                <TableRow className="hover:bg-transparent">
                  <TableHead
                    rowSpan={2}
                    className="h-9 whitespace-nowrap border-r border-foreground/10 px-3 align-bottom text-[11px] font-semibold uppercase tracking-wider"
                  >
                    Ponto
                  </TableHead>
                  <TableHead
                    colSpan={3}
                    className="h-9 whitespace-nowrap px-3 text-center text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground"
                  >
                    Antes do ajuste
                  </TableHead>
                  <TableHead
                    colSpan={3}
                    className="h-9 whitespace-nowrap border-l border-foreground/10 px-3 text-center text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground"
                  >
                    Após o ajuste
                  </TableHead>
                </TableRow>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-9 whitespace-nowrap px-3 text-xs">
                    Leituras
                  </TableHead>
                  <TableHead className="h-9 whitespace-nowrap px-3 text-xs">
                    Erro
                  </TableHead>
                  <TableHead className="h-9 whitespace-nowrap px-3 text-xs">
                    Margem
                  </TableHead>
                  <TableHead className="h-9 whitespace-nowrap border-l border-foreground/10 px-3 text-xs">
                    Leituras
                  </TableHead>
                  <TableHead className="h-9 whitespace-nowrap px-3 text-xs">
                    Erro
                  </TableHead>
                  <TableHead className="h-9 whitespace-nowrap px-3 text-xs">
                    Margem
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {adjustmentSummaryRows.map((row) => (
                  <TableRow
                    key={row.key}
                    className="even:bg-muted/20 hover:bg-muted/40"
                  >
                    <TableCell className="whitespace-nowrap border-r border-foreground/10 px-3 font-mono font-medium tabular-nums">
                      {formatReviewValue(row.point, displayUnitForReview('g'))}
                    </TableCell>
                    <TableCell className="min-w-36 px-3 font-mono text-xs tabular-nums text-muted-foreground">
                      {row.beforeReadings
                        .map((reading) =>
                          formatReviewValue(reading, displayUnitForReview('g')),
                        )
                        .join(' / ')}
                    </TableCell>
                    <TableCell className="whitespace-nowrap px-3 font-mono tabular-nums">
                      {formatReviewValue(
                        row.beforeError,
                        displayUnitForReview('g'),
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap px-3">
                      {renderMarginBadge(
                        row.beforeMargin,
                        displayUnitForReview('g'),
                      )}
                    </TableCell>
                    <TableCell className="min-w-36 border-l border-foreground/10 px-3 font-mono text-xs tabular-nums text-muted-foreground">
                      {row.afterReadings
                        .map((reading) =>
                          formatReviewValue(reading, displayUnitForReview('g')),
                        )
                        .join(' / ')}
                    </TableCell>
                    <TableCell className="whitespace-nowrap px-3 font-mono tabular-nums">
                      {formatReviewValue(
                        row.afterError,
                        displayUnitForReview('g'),
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap px-3">
                      {renderMarginBadge(
                        row.afterMargin,
                        displayUnitForReview('g'),
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            Não há pontos de indicação para resumir.
          </div>
        )}
      </section>

      <section className={`${REVIEW_SURFACE_CLASS} p-4`}>
        <div className="mb-4">
          <h2 className="text-balance text-base font-semibold">
            Ensaios principais
          </h2>
          <p className="text-pretty text-sm text-muted-foreground">
            Indicação, excentricidade e repetibilidade aparecem antes dos dados
            de apoio.
          </p>
        </div>
        {criticalReviewFields.length > 0 ? (
          <div className="space-y-5">
            {criticalReviewFields.map((field) => (
              <div key={field.key}>
                <label className="mb-2 block text-sm font-medium text-muted-foreground">
                  {field.label}
                  {displayUnitForReview(field.unit) && (
                    <span className="ml-1 text-xs">
                      ({displayUnitForReview(field.unit)})
                    </span>
                  )}
                </label>
                <div className="rounded-lg bg-muted/20 p-2">
                  {renderReviewFieldValue(field, review)}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            Nenhum ensaio principal foi registrado para este job.
          </div>
        )}
      </section>

      <section className={`${REVIEW_SURFACE_CLASS} p-4`}>
        <Accordion>
          <AccordionItem value="calculated-results">
            <AccordionTrigger className="min-h-10 py-0 hover:no-underline">
              <div className="min-w-0">
                <h2 className="text-balance text-base font-semibold">
                  Resultados Calculados
                </h2>
                <p className="text-pretty text-sm font-normal text-muted-foreground">
                  Fórmulas e valores detalhados para auditoria.
                </p>
              </div>
            </AccordionTrigger>
            <AccordionContent className="pt-4">
              {reviewHasResults ? (
                <div className="space-y-3">
                  {orderedReviewFormulas.map((formula) => (
                    <div key={formula.outputKey}>
                      {renderReviewResult(formula, review)}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                  Nenhum resultado calculado foi armazenado.
                </div>
              )}
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </section>

      {reviewStandards.length > 0 && (
        <section className={`${REVIEW_SURFACE_CLASS} p-4`}>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h2 className="inline-flex items-center gap-1.5 text-balance text-base font-semibold">
                Padrões utilizados
                <InfoHint label="Sobre rastreabilidade metrológica">
                  Cada medição se liga a referências reconhecidas por uma cadeia
                  contínua e documentada de calibrações, e cada elo contribui
                  para a incerteza do resultado.
                </InfoHint>
              </h2>
              <p className="text-pretty text-sm text-muted-foreground">
                Cada padrão tem certificado e incerteza próprios, que alimentam
                o orçamento de incerteza.
              </p>
            </div>
            <Badge variant="outline" className="w-fit">
              <span className="tabular-nums">{reviewStandards.length}</span>
              {reviewStandards.length === 1 ? ' padrão' : ' padrões'}
            </Badge>
          </div>
          <div className="grid gap-2">
            {reviewStandards.map((standard) => (
              <div
                key={standard.id}
                className="rounded-xl bg-background p-3 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)] transition-[background-color,box-shadow] hover:bg-muted/20"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-balance">
                      {standard.name}
                    </p>
                    {standard.type && (
                      <p className="text-xs text-muted-foreground">
                        {standard.type}
                      </p>
                    )}
                    <p className="inline-flex flex-wrap items-center gap-1 break-all text-sm text-muted-foreground">
                      Certificado: {standard.certificateNumber}
                      <InfoHint label="Sobre o certificado do padrão">
                        Número do certificado de calibração do padrão, que
                        comprova documentalmente a rastreabilidade.
                      </InfoHint>
                    </p>
                  </div>
                  <div className="shrink-0 text-left text-sm sm:text-right">
                    <p className="font-mono tabular-nums">
                      {formatStandardDate(standard.calibrationDate)}
                    </p>
                    {standard.uncertainty != null && (
                      <p className="inline-flex flex-wrap items-center gap-1 font-mono tabular-nums text-muted-foreground sm:justify-end">
                        U = {formatCalibrationValue(standard.uncertainty)}{' '}
                        {standard.uncertaintyUnit || ''} (k=
                        {standard.coverageFactor})
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
        </section>
      )}
    </div>
  )
}
