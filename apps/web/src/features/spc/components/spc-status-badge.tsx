import { Badge } from '@/components/ui/badge'
import type { SignalTone } from '@/components/instrument-panel'
import { SPC_STATUS_LABELS, type SpcStatus } from '@/features/spc/types'

export const SPC_STATUS_TONES: Record<SpcStatus, SignalTone> = {
  in_control: 'ok',
  trending: 'warning',
  out_of_control: 'critical',
  insufficient_data: 'neutral',
}

const SPC_STATUS_BADGE_CLASSES: Record<SpcStatus, string> = {
  in_control:
    'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  trending:
    'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  out_of_control: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  insufficient_data:
    'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
}

export function SpcStatusBadge({ status }: { status: SpcStatus }) {
  return (
    <Badge variant="outline" className={SPC_STATUS_BADGE_CLASSES[status]}>
      {SPC_STATUS_LABELS[status]}
    </Badge>
  )
}
