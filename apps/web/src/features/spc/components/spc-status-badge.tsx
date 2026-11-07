import { SPC_STATUS } from '@calibra-facil/schemas/machines'
import { StatusBadge } from '@calibra-facil/ui/status-badge'
import type { SpcStatus } from '@/features/spc/types'

export function SpcStatusBadge({ status }: { status: SpcStatus }) {
  return (
    <StatusBadge tone={SPC_STATUS.tone(status)}>
      {SPC_STATUS.label(status)}
    </StatusBadge>
  )
}
