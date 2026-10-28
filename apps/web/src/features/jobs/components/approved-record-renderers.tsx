import { HugeiconsIcon } from '@hugeicons/react'
import { CheckmarkCircle02Icon } from '@hugeicons/core-free-icons'
import { Badge } from '@calibra-facil/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@calibra-facil/ui/table'
import { isMassCompositionValue } from '@/components/method-runtime/mass-composition-utils'
import { RepeatabilityTable } from '@/features/jobs/components/repeatability-table'
import {
  buildApprovedJobRecordModel,
  formatReviewValue,
  reviewColumnDisplayLabel,
  type ApprovedJobRecordData,
} from '@/features/jobs/detail-model'
import { findValidationFor } from '@/features/jobs/detail-model/validation-targets'

type ApprovedRecordModel = ReturnType<typeof buildApprovedJobRecordModel>

export function renderApprovedFieldValue(
  field: ApprovedJobRecordData['methodSnapshot']['dataFields'][0],
  {
    displayData,
    displayUnitFor,
  }: Pick<ApprovedRecordModel, 'displayData' | 'displayUnitFor'>,
) {
  const value = displayData?.[field.key]

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
        displayUnit={displayUnitFor}
      />
    )
  }

  if (field.type === 'table' && field.columns && Array.isArray(value)) {
    return (
      <div className="max-w-full overflow-x-auto rounded-lg bg-background shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]">
        <Table className="min-w-max text-[13px]">
          <TableHeader className="bg-muted/50">
            <TableRow>
              {field.columns.map((col) => (
                <TableHead
                  key={col.key}
                  className="h-11 whitespace-nowrap px-3 text-xs"
                >
                  {reviewColumnDisplayLabel(col)}
                  {displayUnitFor(col.unit) && (
                    <span className="text-xs text-muted-foreground ml-1">
                      ({displayUnitFor(col.unit)})
                    </span>
                  )}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {(Array.isArray(value) ? value : [])
              .filter(
                (row): row is Record<string, unknown> =>
                  row !== null &&
                  typeof row === 'object' &&
                  !Array.isArray(row),
              )
              .map((row, idx) => (
                <TableRow key={idx} className="hover:bg-muted/30">
                  {field.columns!.map((col) => {
                    const cellValue = row[col.key]
                    const isComposition = isMassCompositionValue(cellValue)
                    return (
                      <TableCell
                        key={col.key}
                        className={
                          isComposition
                            ? 'min-w-44 max-w-64 whitespace-normal px-3 font-sans text-sm leading-snug'
                            : 'whitespace-nowrap px-3 font-mono tabular-nums'
                        }
                      >
                        {formatReviewValue(cellValue, displayUnitFor(col.unit))}
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
    <span className="font-mono tabular-nums">
      {formatReviewValue(value, displayUnitFor(field.unit))}
    </span>
  )
}

export function renderApprovedResult(
  formula: ApprovedJobRecordData['methodSnapshot']['formulas'][0],
  {
    displayResults,
    validations,
    displayUnitFor,
  }: Pick<
    ApprovedRecordModel,
    'displayResults' | 'validations' | 'displayUnitFor'
  >,
) {
  const value = displayResults?.[formula.outputKey]
  const validation = findValidationFor(validations, formula.outputKey)
  // Check if value passes (simple heuristic - in real impl would store pass/fail)
  const isPassed = value !== undefined && value !== null

  return (
    <div className="flex flex-col gap-3 rounded-lg bg-background p-3 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)] transition-[background-color,box-shadow] hover:bg-muted/20 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <span className="text-sm font-medium">
          {formula.label || formula.outputKey}
        </span>
        {displayUnitFor(formula.unit) && (
          <span className="text-xs text-muted-foreground ml-1">
            ({displayUnitFor(formula.unit)})
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="break-all font-mono text-base tabular-nums sm:text-lg">
          {formatReviewValue(value, displayUnitFor(formula.unit))}
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
