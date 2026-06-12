import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

import {
  formatReviewValue,
  PHASE_DISPLAY_LABELS,
  type ReviewMethodColumn,
} from '../detail-model'

type RepeatabilityReading = {
  label: string
  before: unknown
  after: unknown
}

export type RepeatabilityGroup = {
  /** Label of the column that names the condition, e.g. "Condição". */
  conditionLabel: string | null
  /** Formatted value of the condition for this row, e.g. "1000 kg". */
  condition: string | null
  readings: RepeatabilityReading[]
}

const AFTER_PREFIX = /^ap[óo]s\s+/i
const READING_TOKEN = /leitura\s*\d+/i

/**
 * Phase classification prefers the column's `phase` metadata; the key/label
 * sniffing is a fallback for older frozen snapshots that predate it.
 */
function isAfterColumn(column: ReviewMethodColumn): boolean {
  if (column.phase === 'after') return true
  if (column.phase === 'before') return false
  return (
    column.key.toLowerCase().startsWith('apos') ||
    AFTER_PREFIX.test(column.label)
  )
}

/**
 * Extracts the replicate label ("Leitura 1") from a method column label,
 * tolerating older labels that prefixed the phase ("Antes leitura 1").
 */
function readingLabel(rawLabel: string, index: number): string {
  const match = rawLabel.match(READING_TOKEN)
  if (!match) return `Leitura ${index + 1}`
  const token = match[0].toLowerCase().replace(/\s+/g, ' ')
  return token.charAt(0).toUpperCase() + token.slice(1)
}

function toRows(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return []
  return value.filter(
    (row): row is Record<string, unknown> =>
      row !== null && typeof row === 'object' && !Array.isArray(row),
  )
}

/**
 * Transposes a wide before/after repeatability table (one row per condition with
 * many `Antes …` / `Após …` reading columns) into per-condition groups where each
 * reading is a row with side-by-side Antes/Após values. Pure so it can be unit tested.
 */
export function buildRepeatabilityGroups(
  columns: ReviewMethodColumn[],
  value: unknown,
): RepeatabilityGroup[] {
  const conditionColumns = columns.filter((column) => column.type !== 'number')
  const readingColumns = columns.filter((column) => column.type === 'number')
  const beforeColumns = readingColumns.filter(
    (column) => !isAfterColumn(column),
  )
  const afterColumns = readingColumns.filter((column) => isAfterColumn(column))

  const pairCount = Math.max(beforeColumns.length, afterColumns.length)
  const conditionLabel = conditionColumns[0]?.label ?? null

  return toRows(value).map((row) => {
    const readings: RepeatabilityReading[] = []
    for (let index = 0; index < pairCount; index += 1) {
      const beforeColumn = beforeColumns[index]
      const afterColumn = afterColumns[index]
      readings.push({
        label: readingLabel(
          beforeColumn?.label ?? afterColumn?.label ?? '',
          index,
        ),
        before: beforeColumn ? row[beforeColumn.key] : undefined,
        after: afterColumn ? row[afterColumn.key] : undefined,
      })
    }

    const conditionParts = conditionColumns
      .map((column) => formatReviewValue(row[column.key]))
      .filter((part) => part !== '-')

    return {
      conditionLabel,
      condition: conditionParts.length > 0 ? conditionParts.join(' · ') : null,
      readings,
    }
  })
}

export type RepeatabilityTableProps = {
  columns: ReviewMethodColumn[]
  value: unknown
  displayUnit: (unit?: string | null) => string | undefined
}

/**
 * Vertical before/after layout for the Repetibilidade measurement table, making the
 * Antes vs Após readings easy to compare instead of a single very wide row.
 */
export function RepeatabilityTable({
  columns,
  value,
  displayUnit,
}: RepeatabilityTableProps) {
  const groups = buildRepeatabilityGroups(columns, value)
  if (groups.length === 0) return null

  const beforeColumn = columns.find(
    (column) => column.type === 'number' && !isAfterColumn(column),
  )
  const afterColumn = columns.find(
    (column) => column.type === 'number' && isAfterColumn(column),
  )
  const beforeHeader = PHASE_DISPLAY_LABELS.before
  const afterHeader = PHASE_DISPLAY_LABELS.after
  const hasAfter = afterColumn !== undefined
  const unit = displayUnit(beforeColumn?.unit ?? afterColumn?.unit)

  return (
    <div className="flex flex-col gap-4">
      {groups.map((group, groupIndex) => (
        <div
          key={groupIndex}
          className="overflow-hidden rounded-lg bg-background shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]"
        >
          {group.condition && (
            <div className="flex items-baseline gap-2 border-b bg-muted/50 px-3 py-2">
              {group.conditionLabel && (
                <span className="text-xs text-muted-foreground">
                  {group.conditionLabel}
                </span>
              )}
              <span className="font-mono text-sm font-medium tabular-nums">
                {group.condition}
              </span>
            </div>
          )}
          <Table className="text-[13px]">
            <TableHeader className="bg-muted/30">
              <TableRow>
                <TableHead className="h-10 px-3 text-xs">Leitura</TableHead>
                <TableHead className="h-10 px-3 text-xs">
                  {beforeHeader}
                  {unit && (
                    <span className="ml-1 text-xs text-muted-foreground">
                      ({unit})
                    </span>
                  )}
                </TableHead>
                {hasAfter && (
                  <TableHead className="h-10 px-3 text-xs">
                    {afterHeader}
                    {unit && (
                      <span className="ml-1 text-xs text-muted-foreground">
                        ({unit})
                      </span>
                    )}
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {group.readings.map((reading, readingIndex) => (
                <TableRow key={readingIndex} className="hover:bg-muted/30">
                  <TableCell className="px-3 text-muted-foreground">
                    {reading.label}
                  </TableCell>
                  <TableCell className="px-3 font-mono tabular-nums">
                    {formatReviewValue(reading.before)}
                  </TableCell>
                  {hasAfter && (
                    <TableCell className="px-3 font-mono tabular-nums">
                      {formatReviewValue(reading.after)}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ))}
    </div>
  )
}
