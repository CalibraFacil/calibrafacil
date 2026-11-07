import { INVITATION_STATUS } from '@calibra-facil/schemas/machines'
import { StatusBadge } from '@calibra-facil/ui/status-badge'

/**
 * An invitation's status pill. A pending invitation past `expiresAt` reads as
 * expired even before the sweep marks the row (the API also checks expiry at use).
 */
export function InvitationStatusBadge({
  status,
  expiresAt,
}: {
  status: string
  expiresAt?: string | Date
}) {
  const known = INVITATION_STATUS.parse(status)
  const pastExpiry = expiresAt !== undefined && new Date(expiresAt) < new Date()
  const shown = known === 'pending' && pastExpiry ? 'expired' : known
  if (!shown) return <StatusBadge tone="neutral">{status}</StatusBadge>
  return (
    <StatusBadge tone={INVITATION_STATUS.tone(shown)}>
      {INVITATION_STATUS.label(shown)}
    </StatusBadge>
  )
}
