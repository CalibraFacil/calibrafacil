import { FINANCIAL_STATUS, type FinancialStatus } from '@calibra-facil/shared'
import { StatusBadge } from '@calibra-facil/ui/status-badge'

/** A job's financial status pill (not billed, then its billing document's status). */
export function FinancialStatusBadge({
  status,
  className,
}: {
  status: FinancialStatus
  className?: string
}) {
  return (
    <StatusBadge tone={FINANCIAL_STATUS.tone(status)} className={className}>
      {FINANCIAL_STATUS.label(status)}
    </StatusBadge>
  )
}
