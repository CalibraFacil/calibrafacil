import {
  RECEIVABLE_INSTALLMENT_STATUS,
  type FinancialInstallmentStatus,
  type FinancialInstallmentsSummary,
  type ReceivableInstallmentStatus,
} from '@calibra-facil/shared'
import {
  formatCalendarDate,
  formatMoneyBRL,
} from '@calibra-facil/shared/format'
import { Badge } from '@calibra-facil/ui/badge'
import { StatusBadge } from '@calibra-facil/ui/status-badge'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@calibra-facil/ui/card'
import { cn } from '@calibra-facil/ui/utils'

interface InstallmentsBlockProps {
  installments: FinancialInstallmentStatus[]
  summary: FinancialInstallmentsSummary
  /** Max rows to render inline. Defaults to 12. */
  maxRows?: number
}

function rowToneClasses(status: ReceivableInstallmentStatus): string {
  return status === 'VOID' ? 'opacity-60 line-through' : ''
}

function sortInstallments(rows: FinancialInstallmentStatus[]) {
  return [...rows].sort((a, b) => {
    const numericDelta = (a.installmentNumber ?? 0) - (b.installmentNumber ?? 0)
    if (numericDelta !== 0) return numericDelta
    const dateA = a.dueDate ? new Date(a.dueDate).getTime() : 0
    const dateB = b.dueDate ? new Date(b.dueDate).getTime() : 0
    return dateA - dateB
  })
}

export function InstallmentsBlock({
  installments,
  summary,
  maxRows = 12,
}: InstallmentsBlockProps) {
  if (summary.total === 0) return null

  const sorted = sortInstallments(installments)
  const visible = sorted.slice(0, maxRows)
  const truncated = sorted.length > visible.length

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Parcelas</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">
            {summary.paidCount} de {summary.total - summary.voidCount} pagas
          </Badge>
          <Badge variant="outline">
            {formatMoneyBRL(summary.openCents)} em aberto
          </Badge>
          {summary.overdueCount > 0 && (
            <Badge
              variant="outline"
              className="border-destructive/40 text-destructive"
            >
              {formatMoneyBRL(summary.overdueCents)} em atraso
            </Badge>
          )}
          {summary.voidCount > 0 && (
            <Badge variant="outline" className="text-muted-foreground">
              {summary.voidCount} anuladas
            </Badge>
          )}
        </div>
        <ul className="space-y-1">
          {visible.map((row) => {
            // A due date is a calendar date (a Postgres date): show the day it names.
            const dueDate = formatCalendarDate(row.dueDate, 'date', {
              empty: '',
            })
            return (
              <li
                key={row.id}
                className={cn(
                  'flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm',
                  rowToneClasses(row.status),
                )}
                data-testid="installment-row"
                data-status={row.status}
              >
                <span className="font-medium">
                  Parcela #{row.installmentNumber}
                </span>
                {dueDate && (
                  <span className="text-xs text-muted-foreground">
                    Vencimento {dueDate}
                  </span>
                )}
                <span className="font-mono tabular-nums">
                  {formatMoneyBRL(row.amountCents)}
                </span>
                <StatusBadge
                  tone={RECEIVABLE_INSTALLMENT_STATUS.tone(row.status)}
                  className="shrink-0"
                >
                  {RECEIVABLE_INSTALLMENT_STATUS.label(row.status)}
                </StatusBadge>
              </li>
            )
          })}
        </ul>
        {truncated && (
          <p className="text-xs text-muted-foreground">
            Mostrando {visible.length} de {sorted.length} parcelas
          </p>
        )}
      </CardContent>
    </Card>
  )
}
