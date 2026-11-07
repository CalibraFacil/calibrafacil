import {
  SYNC_PROTOCOL_VERSION,
  isSyncOperationCarriedBy,
} from "@calibra-facil/contracts";

/**
 * How long a downgrade is remembered. The memo exists so that a cloud older than
 * this build is not asked twice per push; it must not outlive an upgrade of the
 * cloud, or every attachment would stay out of the push (and never reach the new
 * cloud) for as long as the sync runtime lives. After this the desktop asks with
 * its own protocol again.
 */
const PUSH_PROTOCOL_MEMO_TTL_MS = 10 * 60_000;

/**
 * The push protocol each cloud told this desktop it speaks, when it is older than
 * the one this build speaks. State of one sync runtime (created with it), not of
 * the process.
 */
export class PushProtocolMemo {
  readonly #remembered = new Map<string, { version: number; at: number }>();
  readonly #now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.#now = now;
  }

  /** The protocol to push to `cloudApiUrl` with: the remembered downgrade, else this build's own. */
  protocolFor(cloudApiUrl: string): number {
    const remembered = this.#remembered.get(cloudApiUrl);
    if (!remembered) return SYNC_PROTOCOL_VERSION;
    if (this.#now() - remembered.at > PUSH_PROTOCOL_MEMO_TTL_MS) {
      this.#remembered.delete(cloudApiUrl);
      return SYNC_PROTOCOL_VERSION;
    }
    return remembered.version;
  }

  /** The cloud answered that it speaks at most `version`. */
  remember(cloudApiUrl: string, version: number): void {
    this.#remembered.set(cloudApiUrl, { version, at: this.#now() });
  }
}

/**
 * The events a push of `protocolVersion` may carry (`minProtocolVersion` of
 * `SYNC_OPERATIONS`). The rest stay pending until the cloud speaks the protocol
 * they need: against an older cloud an attachment event would be acknowledged with
 * no file behind it, which is what lost field evidence before.
 */
export function eventsCarriedBy<T extends { operation: string }>(
  events: readonly T[],
  protocolVersion: number,
): T[] {
  return events.filter((event) =>
    isSyncOperationCarriedBy(event.operation, protocolVersion),
  );
}
