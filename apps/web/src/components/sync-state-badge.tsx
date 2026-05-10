import { Badge } from '@/components/ui/badge'

type SyncStateBadgeProps = {
  syncState?: string | null
}

const syncStateLabels: Record<string, string> = {
  local: 'Pendente',
  pending: 'Pendente',
  failed: 'Falha sync',
  conflict: 'Conflito',
}

export function SyncStateBadge({ syncState }: SyncStateBadgeProps) {
  if (!syncState || syncState === 'synced') return null

  const isDestructive = syncState === 'failed' || syncState === 'conflict'

  return (
    <Badge
      variant={isDestructive ? 'destructive' : 'outline'}
      className={
        isDestructive
          ? 'w-fit whitespace-nowrap'
          : 'w-fit whitespace-nowrap border-amber-500 text-amber-700 dark:text-amber-300'
      }
      title="Alteração local aguardando sincronização"
    >
      {syncStateLabels[syncState] ?? 'Pendente'}
    </Badge>
  )
}
