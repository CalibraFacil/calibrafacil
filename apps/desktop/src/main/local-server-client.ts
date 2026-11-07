import {
  localDiagnosticsSchema,
  localEnvironmentBootstrapSchema,
  syncActionResultSchema,
  syncStatusSnapshotSchema,
  type LocalEnvironmentBootstrap,
  type SyncTrigger,
} from "@calibra-facil/contracts";

/** What the client needs of the local-server manager. */
export type LocalServerEndpoint = {
  readonly baseUrl: string;
  readonly bootstrap: LocalEnvironmentBootstrap | null;
};

/**
 * The host's view of the local server's HTTP API: sync status and actions,
 * diagnostics and the environment bootstrap. Stateless: the address and token
 * are read from the manager on every call, because both change when the
 * server restarts on another port.
 */
export class LocalServerClient {
  constructor(private readonly server: LocalServerEndpoint) {}

  async syncStatus() {
    try {
      const response = await fetch(
        `${this.server.baseUrl}/api/local/sync/status`,
        { headers: this.#headers() },
      );
      if (!response.ok) {
        throw new Error(
          `Local sync status failed with HTTP ${response.status}`,
        );
      }

      return syncStatusSnapshotSchema.parse(await response.json());
    } catch {
      return syncStatusSnapshotSchema.parse({
        state: this.server.bootstrap?.syncState ?? "offline",
        pendingOutboxCount: 0,
        conflictCount: 0,
        lastSyncedAt: null,
      });
    }
  }

  async diagnostics() {
    try {
      const response = await fetch(
        `${this.server.baseUrl}/api/local/diagnostics`,
        { headers: this.#headers() },
      );
      if (!response.ok) {
        throw new Error(
          `Local diagnostics failed with HTTP ${response.status}`,
        );
      }

      return localDiagnosticsSchema.parse(await response.json());
    } catch {
      return null;
    }
  }

  async environmentBootstrap() {
    const bootstrap = this.server.bootstrap;
    if (!bootstrap) return null;

    try {
      const response = await fetch(
        `${this.server.baseUrl}/.well-known/calibra/local-environment`,
        { headers: this.#headers() },
      );
      if (!response.ok) {
        throw new Error(
          `Local environment bootstrap failed with HTTP ${response.status}`,
        );
      }

      return localEnvironmentBootstrapSchema.parse({
        ...(await response.json()),
        localApiToken: bootstrap.localApiToken,
      });
    } catch {
      return bootstrap;
    }
  }

  /**
   * Tell the local server that the world outside changed. The scheduler
   * coalesces, so this is fire-and-forget from the host's point of view: two
   * wakes in the same second are one sync, and a wake while a sync is running
   * queues exactly one follow-up.
   */
  async wakeSync(trigger: SyncTrigger) {
    try {
      const response = await fetch(
        `${this.server.baseUrl}/api/local/sync/wake`,
        {
          method: "POST",
          headers: this.#headers({ "Content-Type": "application/json" }),
          body: JSON.stringify({ trigger }),
        },
      );

      if (!response.ok) {
        return syncActionResultSchema.parse({
          ok: false,
          message: `Local sync wake failed with HTTP ${response.status}.`,
        });
      }

      return syncActionResultSchema.parse({ ok: true });
    } catch (error) {
      return syncActionResultSchema.parse({
        ok: false,
        message:
          error instanceof Error ? error.message : "Local sync wake failed.",
      });
    }
  }

  async postSyncAction(pathname: string) {
    try {
      const response = await fetch(`${this.server.baseUrl}${pathname}`, {
        method: "POST",
        headers: this.#headers(),
      });
      const result = syncActionResultSchema.parse(await response.json());

      if (!response.ok && result.ok) {
        return syncActionResultSchema.parse({
          ok: false,
          message: `Local sync action failed with HTTP ${response.status}.`,
        });
      }

      return result;
    } catch (error) {
      return syncActionResultSchema.parse({
        ok: false,
        message:
          error instanceof Error ? error.message : "Local sync action failed.",
      });
    }
  }

  #headers(init?: HeadersInit) {
    const headers = new Headers(init);
    const token = this.server.bootstrap?.localApiToken;

    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    return headers;
  }
}
