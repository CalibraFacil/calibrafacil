import type { LocalDatabasePartition } from "@calibra-facil/contracts";

/**
 * Inlined rather than imported from `local-db`: the comparison is three lines,
 * and pulling that package into the Electron main bundle would drag a native
 * SQLite binding into a module whose whole job is a decision.
 */
function isSamePartition(
  a: LocalDatabasePartition | null,
  b: LocalDatabasePartition | null,
) {
  if (!a || !b) return false;

  return a.userId === b.userId && a.organizationId === b.organizationId;
}

export type LocalPartitionActivation =
  | { action: "reuse"; partition: LocalDatabasePartition }
  | { action: "start"; partition: LocalDatabasePartition; offline: boolean }
  | {
      action: "switch";
      from: LocalDatabasePartition;
      to: LocalDatabasePartition;
    }
  | { action: "refuse"; reason: LocalPartitionRefusal }
  | { action: "idle" };

export type LocalPartitionRefusal =
  | "offline-switch-requires-authentication"
  | "no-authorized-identity";

export type ResolveLocalPartitionInput = {
  /** The identity the renderer is asking for, when it knows one. */
  requested: LocalDatabasePartition | null;
  /**
   * `true` only when the identity was checked against the cloud in this
   * attempt. A session restored from a cookie cache is **not** verified: it
   * says who the browser thinks you are, not whether that is still true.
   */
  identityVerified: boolean;
  /** What the running local server currently serves, if anything. */
  running: LocalDatabasePartition | null;
  /** The last identity this device authorized online. */
  remembered: LocalDatabasePartition | null;
};

/**
 * When the desktop may open a local database, and whose.
 *
 * Separated from the machinery that stops and starts the local server so the
 * rule itself can be read and tested. The rule matters more than the
 * plumbing: it is what decides whether one account's offline calibration
 * records can be served to another.
 *
 * The policy, in the order the cases arise:
 *
 * 1. **Offline start** — no verified identity yet, but this device previously
 *    authorized one: open that partition and only that one. This is what lets
 *    a technician open a laptop with no signal and keep working.
 * 2. **Steady state** — the verified identity already matches what is open:
 *    carry on.
 * 3. **Switch** — a different identity, verified against the cloud just now:
 *    close the current database and open theirs.
 * 4. **Unverified switch** — a different identity that could *not* be checked
 *    against the cloud: refuse. A cached session must never be enough to open
 *    another account's data, because offline there is nothing to check a
 *    revoked membership or a changed role against.
 * 5. **Nothing to open** — no verified identity and no prior authorization.
 *
 * Nothing here deletes anything. The outgoing account's queued work stays in
 * its own database, to be resumed after that account authenticates again.
 */
export function resolveLocalPartitionActivation({
  requested,
  identityVerified,
  running,
  remembered,
}: ResolveLocalPartitionInput): LocalPartitionActivation {
  if (!requested) {
    if (running) return { action: "reuse", partition: running };
    if (remembered) {
      return { action: "start", partition: remembered, offline: true };
    }

    return { action: "idle" };
  }

  if (isSamePartition(requested, running)) {
    return { action: "reuse", partition: requested };
  }

  if (!identityVerified) {
    // Offline, and being asked for something other than what is already open.
    // Opening it would mean trusting a claim nothing can corroborate.
    if (running || remembered) {
      return {
        action: "refuse",
        reason: "offline-switch-requires-authentication",
      };
    }

    return { action: "refuse", reason: "no-authorized-identity" };
  }

  if (running) {
    return { action: "switch", from: running, to: requested };
  }

  return { action: "start", partition: requested, offline: false };
}

const refusalMessages = {
  "offline-switch-requires-authentication":
    "Entre online para usar esta conta neste computador. Os dados locais da conta anterior continuam salvos e intactos.",
  "no-authorized-identity":
    "Este computador ainda não tem dados locais para esta conta. Conecte-se à internet para preparar o modo offline.",
} as const satisfies Record<LocalPartitionRefusal, string>;

export function describeLocalPartitionRefusal(reason: LocalPartitionRefusal) {
  return refusalMessages[reason];
}
