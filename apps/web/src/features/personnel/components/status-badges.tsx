import {
  COMPETENCE_STATUS,
  TRAINING_STATUS,
} from '@calibra-facil/schemas/machines'
import { StatusBadge } from '@calibra-facil/ui/status-badge'

/** A competence's status pill. */
export function CompetenceStatusBadge({
  status,
  className,
}: {
  status: string
  className?: string
}) {
  const known = COMPETENCE_STATUS.parse(status)
  return (
    <StatusBadge
      tone={known ? COMPETENCE_STATUS.tone(known) : 'neutral'}
      className={className}
    >
      {known ? COMPETENCE_STATUS.label(known) : status}
    </StatusBadge>
  )
}

/** A training record's status pill; `prefix` leads the label ("Status do treinamento: "). */
export function TrainingStatusBadge({
  status,
  prefix = '',
}: {
  status: string
  prefix?: string
}) {
  const known = TRAINING_STATUS.parse(status)
  return (
    <StatusBadge tone={known ? TRAINING_STATUS.tone(known) : 'neutral'}>
      {prefix}
      {known ? TRAINING_STATUS.label(known) : status}
    </StatusBadge>
  )
}
