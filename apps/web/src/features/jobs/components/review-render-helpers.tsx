import { Badge } from '@calibra-facil/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@calibra-facil/ui/table'
import { formatCalibrationValue } from '@calibra-facil/shared'
import { RepeatabilityTable } from '@/features/jobs/components/repeatability-table'
import { isMassCompositionValue } from '@/components/method-runtime/mass-composition-utils'
import {
  buildJobReviewModel,
  formatReviewValue,
  reviewColumnDisplayLabel,
  type ReviewFormula,
  type ReviewMethodField,
} from '@/features/jobs/detail-model'
import { cn } from '@/lib/utils'
import { toRecordArray } from '../record-guards'
import { findValidationFor } from '@/features/jobs/detail-model/validation-targets'

export type JobReviewModel = ReturnType<typeof buildJobReviewModel>

/** The pieces of the review model a field or result row is rendered from. */
type ReviewValueContext = Pick<
  JobReviewModel,
  'displayReviewData' | 'displayUnitForReview'
>
type ReviewResultContext = Pick<
  JobReviewModel,
  'displayReviewResults' | 'reviewValidations' | 'displayUnitForReview'
>

export function renderReviewFieldValue(
  field: ReviewMethodField,
  { displayReviewData, displayUnitForReview }: ReviewValueContext,
) {
  const value = displayReviewData?.[field.key]

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
        displayUnit={displayUnitForReview}
      />
    )
  }

  if (field.type === 'table' && field.columns && Array.isArray(value)) {
    const columns = field.columns
    return (
      <div className="max-w-full overflow-x-auto rounded-lg bg-background shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]">
        <Table className="min-w-max text-[13px]">
          <TableHeader className="bg-muted/50">
            <TableRow>
              {field.columns.map((column) => (
                <TableHead
                  key={column.key}
                  className="h-11 whitespace-nowrap px-3 text-xs"
                >
                  {reviewColumnDisplayLabel(column)}
                  {displayUnitForReview(column.unit) && (
                    <span className="ml-1 text-xs text-muted-foreground">
                      ({displayUnitForReview(column.unit)})
                    </span>
                  )}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {toRecordArray(value).map((row, index) => (
              <TableRow key={index} className="hover:bg-muted/30">
                {columns.map((column) => {
                  const cellValue = row[column.key]
                  const isComposition = isMassCompositionValue(cellValue)
                  return (
                    <TableCell
                      key={column.key}
                      className={
                        isComposition
                          ? 'min-w-44 max-w-72 whitespace-normal px-3 font-sans text-sm leading-snug'
                          : 'whitespace-nowrap px-3 font-mono tabular-nums'
                      }
                    >
                      {formatReviewValue(
                        cellValue,
                        displayUnitForReview(column.unit),
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
    <div className="rounded-lg bg-background p-3 font-mono text-sm tabular-nums shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]">
      {formatReviewValue(value, displayUnitForReview(field.unit))}
    </div>
  )
}

export function renderReviewResult(
  formula: ReviewFormula,
  {
    displayReviewResults,
    reviewValidations,
    displayUnitForReview,
  }: ReviewResultContext,
) {
  const value = displayReviewResults?.[formula.outputKey]
  const validation = findValidationFor(reviewValidations, formula.outputKey)
  const hasValue = value !== undefined && value !== null

  return (
    <div className="flex flex-col gap-3 rounded-lg bg-background p-3 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)] transition-[background-color,box-shadow] hover:bg-muted/20 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-medium text-balance">
          {formula.label || formula.outputKey}
        </p>
        {validation && (
          <p className="mt-1 text-xs text-pretty text-muted-foreground">
            {validation.message}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span className="break-all font-mono text-base tabular-nums sm:text-lg">
          {formatReviewValue(value, displayUnitForReview(formula.unit))}
        </span>
        {validation && hasValue && (
          <Badge
            variant={
              validation.severity === 'error' ? 'destructive' : 'outline'
            }
            className="shrink-0"
          >
            {validation.severity === 'error' ? 'Critério' : 'Aviso'}
          </Badge>
        )}
      </div>
    </div>
  )
}

export function renderMarginBadge(margin: number | null, unit?: string) {
  if (margin == null) {
    return <span className="text-muted-foreground">-</span>
  }

  const isInside = margin >= 0
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 font-mono text-xs font-medium tabular-nums shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]',
        isInside
          ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
          : 'bg-destructive/10 text-destructive',
      )}
    >
      {isInside ? '+' : ''}
      {formatCalibrationValue(margin)}
      {unit ? ` ${unit}` : ''}
    </span>
  )
}

export function renderAcceptanceBadge(
  status: 'ok' | 'error' | 'warning' | 'unknown',
) {
  const presentation: Record<typeof status, { label: string; cls: string }> = {
    ok: {
      label: 'OK',
      cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    },
    error: { label: 'Atenção', cls: 'bg-destructive/10 text-destructive' },
    warning: {
      label: 'Aviso',
      cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
    },
    unknown: { label: 'Verificar', cls: 'bg-muted text-muted-foreground' },
  }
  const item = presentation[status]

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-xs font-medium shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]',
        item.cls,
      )}
    >
      {item.label}
    </span>
  )
}
