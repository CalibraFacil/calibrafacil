import {
  SERVICE_ORDER_QUOTE_STATUS,
  SERVICE_ORDER_STATUS,
  type ServiceOrderQuoteStatus,
  type ServiceOrderStatus,
} from '@calibra-facil/shared'
import { StatusBadge } from '@calibra-facil/ui/status-badge'

/** A service order's status pill. */
export function ServiceOrderStatusBadge({
  status,
  className,
}: {
  status: ServiceOrderStatus
  className?: string
}) {
  return (
    <StatusBadge tone={SERVICE_ORDER_STATUS.tone(status)} className={className}>
      {SERVICE_ORDER_STATUS.label(status)}
    </StatusBadge>
  )
}

/** A quote's status pill. */
export function ServiceOrderQuoteStatusBadge({
  status,
  className,
}: {
  status: ServiceOrderQuoteStatus
  className?: string
}) {
  return (
    <StatusBadge
      tone={SERVICE_ORDER_QUOTE_STATUS.tone(status)}
      className={className}
    >
      {SERVICE_ORDER_QUOTE_STATUS.label(status)}
    </StatusBadge>
  )
}
