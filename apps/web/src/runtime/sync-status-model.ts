import type {
  SyncActionResult,
  SyncState,
  SyncStatusSnapshot,
} from '@calibra-facil/contracts'

export type DesktopSyncAvailabilitySnapshot = {
  isDesktop: boolean
  state: SyncState
  lastSyncedAt: string | null
}

export type DataSourceIndicatorSnapshot = DesktopSyncAvailabilitySnapshot & {
  pendingOutboxCount: number
  conflictCount: number
}

export type DataSourceIndicatorVariant =
  | 'default'
  | 'secondary'
  | 'destructive'
  | 'outline'
  | 'ghost'
  | 'link'

export type DataSourceIndicatorModel = {
  label: string
  title: string
  description: string
  variant: DataSourceIndicatorVariant
  className?: string
  dotClassName: string
}

export type DesktopManualSyncBridge = {
  startSync(): Promise<SyncActionResult>
}

export function isDesktopCloudOnlyUnavailableSnapshot(
  sync: DesktopSyncAvailabilitySnapshot,
  options: { isBrowserOnline?: boolean } = {},
) {
  if (!sync.isDesktop) return false

  if (options.isBrowserOnline === false) return true
  if (options.isBrowserOnline === true) {
    return sync.state === 'offline'
  }

  return (
    sync.state === 'offline' || (sync.state === 'error' && !sync.lastSyncedAt)
  )
}

export function getDataSourceIndicatorModel(
  sync: DataSourceIndicatorSnapshot,
): DataSourceIndicatorModel {
  if (sync.conflictCount > 0 || sync.state === 'conflict') {
    return {
      label: 'Conflitos',
      title: 'Conflitos de sincronização',
      description:
        'Há alterações locais que precisam de revisão antes de sincronizar com segurança.',
      variant: 'destructive',
      dotClassName: 'bg-destructive',
    }
  }

  if (sync.state === 'syncing') {
    return {
      label: 'Sincronizando',
      title: 'Sincronização em andamento',
      description:
        'O desktop está atualizando o cache local com os dados da nuvem.',
      variant: 'secondary',
      className: 'text-blue-700 dark:text-blue-300',
      dotClassName: 'bg-blue-500',
    }
  }

  if (sync.pendingOutboxCount > 0) {
    return {
      label: 'Pendente',
      title: 'Alterações locais pendentes',
      description:
        sync.pendingOutboxCount === 1
          ? '1 alteração aguardando envio para a nuvem.'
          : `${sync.pendingOutboxCount} alterações aguardando envio para a nuvem.`,
      variant: 'outline',
      className: 'text-amber-700 dark:text-amber-300',
      dotClassName: 'bg-amber-500',
    }
  }

  if (sync.state === 'offline') {
    return {
      label: sync.lastSyncedAt ? 'Cache offline' : 'Cache indisponível',
      title: sync.lastSyncedAt
        ? 'Usando cache local'
        : 'Dados offline ainda não estão prontos',
      description: sync.lastSyncedAt
        ? 'A nuvem não está disponível; telas compatíveis usam dados sincronizados localmente.'
        : 'Conecte à internet e sincronize antes de depender do modo offline.',
      variant: sync.lastSyncedAt ? 'outline' : 'destructive',
      className: sync.lastSyncedAt
        ? 'text-amber-700 dark:text-amber-300'
        : undefined,
      dotClassName: sync.lastSyncedAt ? 'bg-amber-500' : 'bg-destructive',
    }
  }

  if (sync.state === 'error') {
    return {
      label: sync.lastSyncedAt ? 'Atenção' : 'Cache não pronto',
      title: 'Sincronização precisa de atenção',
      description: sync.lastSyncedAt
        ? 'Telas operacionais seguem usando o cache local mais recente; telas cloud-only podem exigir conexão.'
        : 'O cache local ainda não tem bootstrap completo para fallback offline.',
      variant: 'destructive',
      dotClassName: 'bg-destructive',
    }
  }

  if (sync.isDesktop && sync.lastSyncedAt) {
    return {
      label: 'Cache local',
      title: 'Fonte de dados: cache local',
      description:
        'Telas operacionais usam dados locais sincronizados e atualizam a nuvem em segundo plano.',
      variant: 'secondary',
      className: 'text-emerald-700 dark:text-emerald-300',
      dotClassName: 'bg-emerald-500',
    }
  }

  return {
    label: 'Nuvem',
    title: 'Fonte de dados: nuvem',
    description:
      'O desktop está usando a API da nuvem para manter paridade com o web app.',
    variant: 'secondary',
    className: 'text-emerald-700 dark:text-emerald-300',
    dotClassName: 'bg-emerald-500',
  }
}

export async function runDesktopManualSync(
  bridge: DesktopManualSyncBridge,
  refresh: () => Promise<unknown>,
) {
  const result = await bridge.startSync()
  await refresh()

  if (!result.ok) {
    throw new Error(result.message ?? 'Falha ao sincronizar cache local.')
  }
}

/**
 * Whether a sync just finished in a way that can change what the UI is
 * allowed to do.
 *
 * Availability for a cloud command depends on the entity's local
 * `syncState`/`remoteId`, which sync rewrites in SQLite. Nothing tells React
 * Query about that, so without this the cached row keeps reporting "pending
 * local changes" and approval, delivery, quote and document actions stay
 * disabled even after "Sincronizar agora" reports success.
 *
 * Both signals matter: `lastSyncedAt` moves on any completed run, and the
 * pending count falling means queued events were accepted — which is exactly
 * when a blocker clears.
 */
export function syncCompletionClearedBlockers(
  previous: Pick<
    SyncStatusSnapshot,
    'lastSyncedAt' | 'pendingOutboxCount'
  > | null,
  next: Pick<SyncStatusSnapshot, 'lastSyncedAt' | 'pendingOutboxCount'>,
): boolean {
  if (!previous) return false

  // Drained: blockers have cleared, refetch.
  if (next.pendingOutboxCount === 0 && previous.pendingOutboxCount > 0) {
    return true
  }

  // Still draining. The scheduler runs every couple of seconds while a backlog
  // clears, and reacting to each intermediate run would refetch every mounted
  // query for the whole drain — minutes of it after a day offline. Waiting
  // costs nothing: more acceptances are coming, and the drained case above
  // will fire.
  if (next.pendingOutboxCount < previous.pendingOutboxCount) return false

  // No progress. Deliberately *not* treated as "still draining": the count
  // includes permanently failed rows, so a single stuck event would otherwise
  // disable every post-sync refetch until the window reloaded. With nothing
  // being accepted there is no storm to avoid, and a completed run here is a
  // pull that may have changed remote ids or statuses underneath the cache.
  return (
    next.lastSyncedAt !== null && next.lastSyncedAt !== previous.lastSyncedAt
  )
}
