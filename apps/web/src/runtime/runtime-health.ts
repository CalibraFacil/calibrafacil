import type { SyncState, SyncStatusSnapshot } from '@calibra-facil/contracts'
import type {
  CloudReachability,
  LocalRuntimeHealth,
  RuntimeHealthSnapshot,
} from '@calibra-facil/client-runtime'

/**
 * Stitches the renderer's independent signals into the health snapshot the
 * shared availability evaluator consumes.
 *
 * The signals are deliberately kept apart until this point. "The last sync
 * failed" is not "the cloud is down", "the browser says offline" is not "the
 * local process died", and a 403 from the cloud is not a connectivity problem
 * at all. Collapsing them early is exactly what produced a desktop client that
 * disabled working buttons.
 */

export type RuntimeHealthInputs = {
  isDesktop: boolean
  /** `navigator.onLine`, only meaningful on desktop. */
  browserOnline: boolean
  sync: Pick<SyncStatusSnapshot, 'state' | 'lastSyncedAt'> &
    Partial<
      Pick<
        SyncStatusSnapshot,
        'lastError' | 'scheduler' | 'pendingOutboxCount' | 'conflictCount'
      >
    >
  /** The Electron preload bridge is present. */
  hasBridge: boolean
  /** The renderer failed to read local sync status at all. */
  localStatusUnreadable?: boolean
}

/**
 * Errors that mean "we could not reach the cloud", as opposed to "the cloud
 * answered and said no". A 401/403/409/422 is an authorization or domain
 * answer: the connection worked, so cloud actions must stay enabled and fail
 * with the server's own message.
 */
const TRANSPORT_FAILURE =
  /fetch|network|timeout|dns|socket|econn|enotfound|tls|certificate|HTTP 5\d\d/i

export function isTransportFailureMessage(message: string | null | undefined) {
  if (!message) return false

  return TRANSPORT_FAILURE.test(message)
}

export function classifyCloudReachability(
  inputs: RuntimeHealthInputs,
): CloudReachability {
  // The browser talks to the cloud directly; it has no local fallback and no
  // sync signal, so there is nothing to observe and nothing to gate.
  if (!inputs.isDesktop) return 'unknown'

  if (!inputs.browserOnline) return 'unreachable'

  // Deliberately *not* treated as a cloud outage: `state: 'offline'` is the
  // local sync runtime's own status. It is also what you get with
  // `CALIBRA_SYNC_ENABLED=false`, and what the host reports before the local
  // server can be read at all — while the cloud-auth proxy may be perfectly
  // reachable. Equating the two would disable every cloud action in those
  // configurations for requests that would have succeeded.

  const scheduler = inputs.sync.scheduler
  if (
    scheduler &&
    scheduler.consecutiveFailures > 0 &&
    isTransportFailureMessage(inputs.sync.lastError)
  ) {
    return 'unreachable'
  }

  if (
    inputs.sync.state === 'error' &&
    isTransportFailureMessage(inputs.sync.lastError)
  ) {
    return 'unreachable'
  }

  if (inputs.sync.state === 'syncing' || inputs.sync.lastSyncedAt !== null) {
    return 'reachable'
  }

  // Online, bridge present, nothing synced yet: no evidence either way. The
  // evaluator treats this as available, which is the right default — a real
  // request produces a better error than a pre-emptive denial.
  return 'unknown'
}

export function classifyLocalRuntimeHealth(
  inputs: RuntimeHealthInputs,
): LocalRuntimeHealth {
  // Accurate rather than flattering: the browser has no local runtime at all.
  if (!inputs.isDesktop) return 'unavailable'
  if (!inputs.hasBridge) return 'unavailable'
  if (inputs.localStatusUnreadable) return 'unavailable'

  return 'healthy'
}

export function buildRuntimeHealthSnapshot(
  inputs: RuntimeHealthInputs,
): RuntimeHealthSnapshot {
  const status = inputs.sync

  return {
    isDesktop: inputs.isDesktop,
    cloud: classifyCloudReachability(inputs),
    localRuntime: classifyLocalRuntimeHealth(inputs),
    // A sync cursor is what makes local-first reads answerable, and
    // `lastSyncedAt` is the renderer-visible proxy for it.
    localCacheBootstrapped: inputs.isDesktop && status.lastSyncedAt !== null,
    pendingOutboxCount: status.pendingOutboxCount ?? 0,
    conflictCount: status.conflictCount ?? 0,
  }
}

/**
 * Human-facing summary of *why* the desktop is degraded, for the sync surface.
 * Kept separate from the per-operation reasons so a page-level banner and a
 * button tooltip never disagree.
 */
export function describeRuntimeHealth(
  health: RuntimeHealthSnapshot,
): { tone: SyncState; summary: string } | null {
  if (!health.isDesktop) return null

  if (health.localRuntime === 'unavailable') {
    return {
      tone: 'error',
      summary:
        'O serviço local do desktop não respondeu. Reinicie o aplicativo para voltar a trabalhar offline.',
    }
  }

  if (health.conflictCount > 0) {
    return {
      tone: 'conflict',
      summary:
        health.conflictCount === 1
          ? '1 registro com conflito aguardando revisão.'
          : `${health.conflictCount} registros com conflito aguardando revisão.`,
    }
  }

  if (health.cloud === 'unreachable') {
    return {
      tone: 'offline',
      summary: health.localCacheBootstrapped
        ? 'Sem conexão com a nuvem. Você continua trabalhando com os dados sincronizados neste computador.'
        : 'Sem conexão com a nuvem e sem cache local. Conecte-se para baixar seus dados.',
    }
  }

  if (health.pendingOutboxCount > 0) {
    return {
      tone: 'idle',
      summary:
        health.pendingOutboxCount === 1
          ? '1 alteração local aguardando envio.'
          : `${health.pendingOutboxCount} alterações locais aguardando envio.`,
    }
  }

  return null
}
