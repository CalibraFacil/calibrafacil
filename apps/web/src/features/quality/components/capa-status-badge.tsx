import { CORRECTIVE_ACTION_STATUS } from '@calibra-facil/schemas/machines'
import { StatusBadge } from '@calibra-facil/ui/status-badge'

/** A corrective action's status pill (the wire carries the status as a plain string). */
export function CapaStatusBadge({ status }: { status: string }) {
  const known = CORRECTIVE_ACTION_STATUS.parse(status)
  return (
    <StatusBadge
      tone={known ? CORRECTIVE_ACTION_STATUS.tone(known) : 'neutral'}
    >
      {known ? CORRECTIVE_ACTION_STATUS.label(known) : status}
    </StatusBadge>
  )
}
