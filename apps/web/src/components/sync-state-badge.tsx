import { LOCAL_RECORD_SYNC_STATE } from '@calibra-facil/schemas'
import { StatusBadge } from '@calibra-facil/ui/status-badge'

type SyncStateBadgeProps = {
  syncState?: string | null
}

/**
 * What a local record's outbox state says: nothing once it is synced, otherwise the state's own
 * label (a change the cloud refused reads "Recusada pela nuvem", not "Pendente"). A state this
 * build does not know reads as pending.
 */
export function SyncStateBadge({ syncState }: SyncStateBadgeProps) {
  if (!syncState || syncState === 'synced') return null

  const known = LOCAL_RECORD_SYNC_STATE.parse(syncState) ?? 'pending'

  return (
    <StatusBadge
      tone={LOCAL_RECORD_SYNC_STATE.tone(known)}
      className="w-fit"
      title="Alteração local aguardando sincronização"
    >
      {LOCAL_RECORD_SYNC_STATE.label(known)}
    </StatusBadge>
  )
}
