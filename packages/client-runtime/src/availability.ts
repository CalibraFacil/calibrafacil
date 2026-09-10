import {
  getCalibraApiDataPolicy,
  type CalibraApiMethod,
  type CalibraApiNamespace,
  type DataPolicy,
} from "./data-policy";

/**
 * Operation availability, derived instead of hand-maintained.
 *
 * The desktop host used to answer "can I do this?" with a single `isDesktop`
 * boolean, which conflated three independent questions:
 *
 * 1. **Capability** — does this host implement the mechanism at all?
 * 2. **Availability** — are the cloud, the local process and the local cache
 *    ready, and is the target entity synchronized?
 * 3. **Authorization** — may this identity do this here? The server stays
 *    authoritative for that one; nothing in this module replaces a permission
 *    check.
 *
 * This module answers only (2), and it answers it from
 * `calibraApiPolicyRegistry` plus a runtime health snapshot — so reclassifying
 * a method's data policy moves its availability with it, and no second
 * registry has to be kept in sync.
 */

/** Cloud reachability as *observed*, never as `navigator.onLine` reports it. */
export type CloudReachability = "reachable" | "unreachable" | "unknown";

/** Health of the local desktop server process (`apps/local-server`). */
export type LocalRuntimeHealth = "healthy" | "unavailable" | "unknown";

export type RuntimeHealthSnapshot = {
  isDesktop: boolean;
  cloud: CloudReachability;
  localRuntime: LocalRuntimeHealth;
  /** The local cache finished its first bootstrap (a sync cursor exists). */
  localCacheBootstrapped: boolean;
  pendingOutboxCount: number;
  conflictCount: number;
};

/**
 * What the caller knows about the entity a command targets. Both fields are
 * optional: omitting them means "not applicable / not known", and the
 * evaluator will not invent a blocker from missing information.
 */
export type OperationTargetState = {
  /**
   * `false` when the record was created offline and has no canonical cloud id
   * yet. Sending a cloud command for it would 404 — or, worse, create a
   * duplicate alongside the queued creation.
   */
  synced?: boolean;
  /**
   * `true` when this record has local writes the cloud has not acknowledged.
   * A cloud command would then decide against stale server state, which for a
   * regulated transition (approve, deliver, issue) is not an acceptable race.
   */
  hasPendingLocalChanges?: boolean;
};

export type OperationUnavailableReason =
  | "cloud-unreachable"
  | "local-runtime-unavailable"
  | "initial-sync-required"
  | "entity-not-synced"
  | "entity-has-pending-changes";

/** Where an available operation will actually execute. */
export type OperationSource =
  | "cloud"
  | "local-cache"
  | "local-queue"
  | "local-runtime";

export type OperationAvailability =
  | {
      available: true;
      source: OperationSource;
      policy: DataPolicy;
      /** Set when the operation runs, but against data that may be stale. */
      staleness?: "local-cache-may-lag-cloud";
    }
  | {
      available: false;
      reason: OperationUnavailableReason;
      policy: DataPolicy;
      message: string;
      /** A manual sync can plausibly clear this blocker. */
      resolvableBySync: boolean;
    };

const unavailableMessages = {
  "cloud-unreachable":
    "Esta ação precisa da API da nuvem. Verifique a conexão e tente novamente.",
  "local-runtime-unavailable":
    "O serviço local do desktop não está disponível. Reinicie o aplicativo e tente novamente.",
  "initial-sync-required":
    "O cache local ainda não foi baixado. Conecte-se à internet e faça a primeira sincronização.",
  "entity-not-synced":
    "Este registro ainda não foi enviado para a nuvem. Sincronize antes de executar esta ação.",
  "entity-has-pending-changes":
    "Há alterações locais deste registro aguardando envio. Sincronize antes de executar esta ação.",
} as const satisfies Record<OperationUnavailableReason, string>;

export function getOperationUnavailableMessage(
  reason: OperationUnavailableReason,
): string {
  return unavailableMessages[reason];
}

const RESOLVABLE_BY_SYNC: readonly OperationUnavailableReason[] = [
  "initial-sync-required",
  "entity-not-synced",
  "entity-has-pending-changes",
];

export type EvaluateOperationAvailabilityInput<
  TNamespace extends CalibraApiNamespace,
> = {
  namespace: TNamespace;
  method: CalibraApiMethod<TNamespace>;
  health: RuntimeHealthSnapshot;
  target?: OperationTargetState;
};

/**
 * Decide whether a product API method can run right now, and say why not in
 * terms the UI can act on. Never returns "unavailable" from an *unknown*
 * signal: an unobserved cloud or an unknown local runtime is treated as
 * optimistically available, because failing a real request produces a better
 * error than pre-emptively hiding a working action.
 */
export function evaluateOperationAvailability<
  TNamespace extends CalibraApiNamespace,
>({
  namespace,
  method,
  health,
  target,
}: EvaluateOperationAvailabilityInput<TNamespace>): OperationAvailability {
  const policy = getCalibraApiDataPolicy(namespace, method);

  if (!health.isDesktop) {
    return evaluateBrowserAvailability(policy, health);
  }

  switch (policy) {
    case "cloud-only":
      return evaluateCloudCommand(policy, health, target);
    case "cloud-first-read-fallback":
      return evaluateCloudFirstRead(policy, health);
    case "local-first-read-through-sync":
      return evaluateLocalFirstRead(policy, health);
    case "local-command-sync":
      return evaluateLocalRuntime(policy, health, "local-queue");
    case "local-only":
      return evaluateLocalRuntime(policy, health, "local-runtime");
  }
}

function evaluateBrowserAvailability(
  policy: DataPolicy,
  health: RuntimeHealthSnapshot,
): OperationAvailability {
  // The browser has no local runtime; everything is a cloud call. Only an
  // *observed* unreachable cloud blocks, and the browser does not observe one
  // today, so this is effectively always available.
  if (health.cloud === "unreachable") {
    return unavailable(policy, "cloud-unreachable");
  }

  return { available: true, source: "cloud", policy };
}

function evaluateCloudCommand(
  policy: DataPolicy,
  health: RuntimeHealthSnapshot,
  target: OperationTargetState | undefined,
): OperationAvailability {
  if (health.cloud === "unreachable") {
    return unavailable(policy, "cloud-unreachable");
  }

  // Entity-level blockers only matter when the command can actually run;
  // reporting them while offline would bury the real reason.
  if (target?.synced === false) {
    return unavailable(policy, "entity-not-synced");
  }

  if (target?.hasPendingLocalChanges === true) {
    return unavailable(policy, "entity-has-pending-changes");
  }

  return { available: true, source: "cloud", policy };
}

function evaluateCloudFirstRead(
  policy: DataPolicy,
  health: RuntimeHealthSnapshot,
): OperationAvailability {
  if (health.cloud !== "unreachable") {
    return { available: true, source: "cloud", policy };
  }

  if (!health.localCacheBootstrapped) {
    return unavailable(policy, "initial-sync-required");
  }

  if (health.localRuntime === "unavailable") {
    return unavailable(policy, "local-runtime-unavailable");
  }

  return {
    available: true,
    source: "local-cache",
    policy,
    staleness: "local-cache-may-lag-cloud",
  };
}

function evaluateLocalFirstRead(
  policy: DataPolicy,
  health: RuntimeHealthSnapshot,
): OperationAvailability {
  if (health.localCacheBootstrapped && health.localRuntime !== "unavailable") {
    return {
      available: true,
      source: "local-cache",
      policy,
      staleness: "local-cache-may-lag-cloud",
    };
  }

  // No usable cache yet: the read falls through to the cloud, so it lives or
  // dies with cloud reachability.
  if (health.cloud === "unreachable") {
    return unavailable(
      policy,
      health.localRuntime === "unavailable"
        ? "local-runtime-unavailable"
        : "initial-sync-required",
    );
  }

  return { available: true, source: "cloud", policy };
}

function evaluateLocalRuntime(
  policy: DataPolicy,
  health: RuntimeHealthSnapshot,
  source: Extract<OperationSource, "local-queue" | "local-runtime">,
): OperationAvailability {
  if (health.localRuntime === "unavailable") {
    return unavailable(policy, "local-runtime-unavailable");
  }

  return { available: true, source, policy };
}

function unavailable(
  policy: DataPolicy,
  reason: OperationUnavailableReason,
): OperationAvailability {
  return {
    available: false,
    reason,
    policy,
    message: unavailableMessages[reason],
    resolvableBySync: RESOLVABLE_BY_SYNC.includes(reason),
  };
}
