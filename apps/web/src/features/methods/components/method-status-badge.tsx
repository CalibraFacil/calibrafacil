import { METHOD_STATUS } from '@calibra-facil/schemas/machines'
import { StatusBadge } from '@calibra-facil/ui/status-badge'

/** A method version's status pill (rows from the wire carry the status as a string). */
export function MethodStatusBadge({
  status,
  className,
}: {
  status: string | null | undefined
  className?: string
}) {
  const known = METHOD_STATUS.parse(status)
  return (
    <StatusBadge
      tone={known ? METHOD_STATUS.tone(known) : 'neutral'}
      className={className}
    >
      {known ? METHOD_STATUS.label(known) : status || 'Sem status'}
    </StatusBadge>
  )
}
