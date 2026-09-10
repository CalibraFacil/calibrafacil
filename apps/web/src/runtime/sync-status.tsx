import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react'
import { Link } from '@tanstack/react-router'
import { useMountEffect } from '@/hooks/use-mount-effect'
import { useQuery } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { RefreshIcon } from '@hugeicons/core-free-icons'
import type { SyncState, SyncStatusSnapshot } from '@calibra-facil/contracts'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  getDataSourceIndicatorModel,
  isDesktopCloudOnlyUnavailableSnapshot,
  runDesktopManualSync,
  syncCompletionClearedBlockers,
} from '@/runtime/sync-status-model'
import { useQueryClient } from '@tanstack/react-query'

const initialSnapshot: SyncStatusSnapshot = {
  state: 'idle',
  pendingOutboxCount: 0,
  conflictCount: 0,
  lastSyncedAt: null,
}

let latestBridgeSnapshot: SyncStatusSnapshot | null = null

function subscribeToBridgeSyncStatus(onStoreChange: () => void) {
  if (typeof window === 'undefined' || !window.calibraBridge) {
    return () => {}
  }

  return window.calibraBridge.onSyncStatus((snapshot: SyncStatusSnapshot) => {
    latestBridgeSnapshot = snapshot
    onStoreChange()
  })
}

function subscribeToNothing() {
  return () => {}
}

function subscribeToBrowserOnlineStatus(onStoreChange: () => void) {
  if (typeof window === 'undefined') {
    return () => {}
  }

  window.addEventListener('online', onStoreChange)
  window.addEventListener('offline', onStoreChange)

  return () => {
    window.removeEventListener('online', onStoreChange)
    window.removeEventListener('offline', onStoreChange)
  }
}

function getBridgeSnapshot() {
  return latestBridgeSnapshot
}

function getBrowserOnlineSnapshot() {
  if (typeof navigator === 'undefined') return true

  return navigator.onLine
}

function getServerBrowserOnlineSnapshot() {
  return true
}

/**
 * `navigator.onLine` as a subscribed store, and *only* on desktop: in the
 * browser the value would be a claim about the same connection that serves
 * every request, so acting on it adds a false negative without adding a
 * fallback.
 */
export function useBrowserOnlineStatus(isDesktop: boolean) {
  return useSyncExternalStore(
    isDesktop ? subscribeToBrowserOnlineStatus : subscribeToNothing,
    getBrowserOnlineSnapshot,
    getServerBrowserOnlineSnapshot,
  )
}

export type SyncStatusContextValue = SyncStatusSnapshot & {
  isDesktop: boolean
  refresh(): Promise<void>
}

const SyncStatusContext = createContext<SyncStatusContextValue | null>(null)

/**
 * Tell the local server to sync when the world outside it changes.
 *
 * The renderer sees two signals the main process cannot: the OS reporting the
 * network back, and the operator returning to the window. Both are advisory —
 * the scheduler coalesces and debounces, so a flapping connection or a user
 * alt-tabbing produces one sync, not a storm.
 */
function useSyncWakeTriggers(isDesktop: boolean) {
  useMountEffect(() => {
    if (!isDesktop || typeof window === 'undefined') return

    const wake = () => {
      void window.calibraBridge?.wakeSync('reconnect').catch(() => undefined)
    }
    const wakeOnVisible = () => {
      if (document.visibilityState === 'visible') wake()
    }

    window.addEventListener('online', wake)
    document.addEventListener('visibilitychange', wakeOnVisible)

    return () => {
      window.removeEventListener('online', wake)
      document.removeEventListener('visibilitychange', wakeOnVisible)
    }
  })
}

/**
 * Refetch cached entity data once a sync has changed it underneath.
 *
 * A cloud command's availability is derived from the entity's local
 * `syncState`, which sync rewrites in SQLite without React Query hearing about
 * it. Without this, a job whose execution has just been pushed keeps reporting
 * "pending local changes" and stays unapprovable after the sync it was waiting
 * for succeeded.
 *
 * Everything is invalidated except the sync surfaces themselves — narrowing to
 * a list of entity keys would silently miss whichever one is added next, and
 * the cost here is a refetch of what is on screen.
 */
function useRefetchOnSyncCompletion(isDesktop: boolean) {
  const queryClient = useQueryClient()

  useMountEffect(() => {
    if (!isDesktop || typeof window === 'undefined') return

    let previous: SyncStatusSnapshot | null = latestBridgeSnapshot

    return window.calibraBridge?.onSyncStatus((snapshot) => {
      const cleared = syncCompletionClearedBlockers(previous, snapshot)
      previous = snapshot
      if (!cleared) return

      void queryClient.invalidateQueries({
        predicate: (query) => {
          const root = query.queryKey[0]
          return root !== 'desktop-sync-status' && root !== 'local-partition'
        },
      })
    })
  })
}

export function SyncStatusProvider({
  children,
  isDesktop,
}: {
  children: ReactNode
  isDesktop: boolean
}) {
  useSyncWakeTriggers(isDesktop)
  useRefetchOnSyncCompletion(isDesktop)

  const bridgeSnapshot = useSyncExternalStore(
    isDesktop ? subscribeToBridgeSyncStatus : subscribeToNothing,
    getBridgeSnapshot,
    getBridgeSnapshot,
  )
  const { data, refetch } = useQuery({
    queryKey: ['desktop-sync-status'],
    enabled: isDesktop,
    refetchInterval: 15_000,
    queryFn: async (): Promise<SyncStatusSnapshot> => {
      if (!isDesktop || !window.calibraBridge) {
        return initialSnapshot
      }

      return window.calibraBridge.getSyncStatus()
    },
  })

  const snapshot = bridgeSnapshot ?? data ?? initialSnapshot
  const refresh = useCallback(async () => {
    await refetch()
  }, [refetch])

  const value = useMemo<SyncStatusContextValue>(
    () => ({
      ...snapshot,
      isDesktop,
      refresh,
    }),
    [isDesktop, refresh, snapshot],
  )

  return (
    <SyncStatusContext.Provider value={value}>
      {children}
    </SyncStatusContext.Provider>
  )
}

export function useSyncStatus() {
  const context = useContext(SyncStatusContext)
  if (!context) {
    throw new Error('useSyncStatus must be used within SyncStatusProvider')
  }

  return context
}

/**
 * The sync snapshot when there is one, `null` otherwise.
 *
 * Availability gating is used far outside the dashboard shell — public routes,
 * isolated component tests, anything rendered before the provider mounts — and
 * in those trees "no provider" is a fact, not a bug. Throwing there would turn
 * a missing wrapper into a blank screen on a page that has no sync surface to
 * report in the first place.
 */
export function useOptionalSyncStatus() {
  return useContext(SyncStatusContext)
}

export function useDesktopCloudOnlyUnavailable() {
  const sync = useSyncStatus()
  const isBrowserOnline = useBrowserOnlineStatus(sync.isDesktop)

  return isDesktopCloudOnlyUnavailableSnapshot(sync, { isBrowserOnline })
}

export function CloudOnlyOfflineState({
  title,
  description = 'Esta tela depende da API da nuvem para manter paridade com o web app. Conecte-se à internet e sincronize antes de acessá-la no desktop.',
}: {
  title: string
  description?: string
}) {
  const sync = useSyncStatus()
  const syncAction = useDesktopManualSyncAction(sync)

  return (
    <div className="rounded-lg border bg-card p-8">
      <div className="mx-auto flex max-w-xl flex-col items-center gap-3 text-center">
        <Badge variant="outline">
          {sync.lastSyncedAt ? 'Tela cloud-only' : 'Cache não pronto'}
        </Badge>
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        {sync.lastSyncedAt ? (
          <p className="text-xs text-muted-foreground">
            Última sincronização local: {formatSyncTimestamp(sync.lastSyncedAt)}
          </p>
        ) : null}
        {syncAction.canSync ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={syncAction.disabled}
            onClick={syncAction.run}
          >
            <HugeiconsIcon
              icon={RefreshIcon}
              className={cn('size-4', syncAction.disabled && 'animate-spin')}
            />
            Tentar sincronizar
          </Button>
        ) : null}
      </div>
    </div>
  )
}

export function OfflineBanner() {
  const sync = useSyncStatus()

  if (!sync.isDesktop || sync.state === 'idle' || sync.state === 'syncing') {
    return null
  }

  return (
    <div className="flex items-center justify-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-sm font-medium text-amber-900">
      <span>{getSyncStatusLabel(sync.state)}</span>
      {sync.state === 'conflict' ? (
        <Link
          to="/dashboard/sync/conflicts"
          className="underline underline-offset-4"
        >
          Revisar conflitos
        </Link>
      ) : null}
    </div>
  )
}

export function DesktopDataSourceIndicator() {
  const sync = useSyncStatus()

  if (!sync.isDesktop) return null

  const model = getDataSourceIndicatorModel(sync)

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Badge
            variant={model.variant}
            className={cn('gap-1.5 px-2.5', model.className)}
          >
            <span
              aria-hidden
              className={cn('size-1.5 rounded-full', model.dotClassName)}
            />
            {model.label}
          </Badge>
        }
      />
      <TooltipContent side="bottom" align="end">
        <div className="max-w-72 space-y-1 text-sm">
          <p className="font-medium">{model.title}</p>
          <p className="text-muted-foreground">{model.description}</p>
          {sync.lastSyncedAt ? (
            <p className="text-muted-foreground">
              Última sincronização: {formatSyncTimestamp(sync.lastSyncedAt)}
            </p>
          ) : null}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

export function DesktopSyncButton() {
  const sync = useSyncStatus()
  const syncAction = useDesktopManualSyncAction(sync)

  if (!syncAction.canSync) {
    return null
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="Sincronizar cache local"
            disabled={syncAction.disabled}
            onClick={syncAction.run}
          >
            <HugeiconsIcon
              icon={RefreshIcon}
              className={cn('size-4', syncAction.disabled && 'animate-spin')}
            />
          </Button>
        }
      />
      <TooltipContent side="bottom" align="end">
        Sincronizar cache local
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * The "sincronizar agora" affordance, shared by the status chip and by every
 * action that a sync could unblock — so pressing it from a blocked button does
 * exactly what pressing it in the header does.
 */
export function useDesktopManualSyncAction(sync: SyncStatusContextValue) {
  const [isSyncing, setIsSyncing] = useState(false)
  const canSync =
    sync.isDesktop &&
    typeof window !== 'undefined' &&
    Boolean(window.calibraBridge)
  const disabled = isSyncing || sync.state === 'syncing'

  const run = useCallback(async () => {
    if (!window.calibraBridge) return

    setIsSyncing(true)
    try {
      await runDesktopManualSync(window.calibraBridge, sync.refresh)
      toast.success('Cache local sincronizado.')
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Falha ao sincronizar cache local.',
      )
    } finally {
      setIsSyncing(false)
    }
  }, [sync.refresh])

  return {
    canSync,
    disabled,
    run,
  }
}

function getSyncStatusLabel(state: SyncState) {
  switch (state) {
    case 'offline':
      return 'Modo offline. Alterações locais serão sincronizadas quando a conexão voltar.'
    case 'error':
      return 'A sincronização precisa de atenção.'
    case 'conflict':
      return 'Há conflitos de sincronização pendentes.'
    case 'syncing':
      return 'Sincronizando alterações locais.'
    case 'idle':
      return 'Sincronização em dia.'
  }
}

const SYNC_TIMESTAMP_FORMAT = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
})

function formatSyncTimestamp(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  return SYNC_TIMESTAMP_FORMAT.format(date)
}
