import type { SyncApi } from "../types";

export function createCloudSyncApi(): SyncApi {
  return {
    async getSession() {
      return {
        data: null,
      };
    },
    async reconcile() {
      // The browser reads straight from the cloud, so a cloud command is
      // already canonical by the time it resolves.
      return { reconciled: false, reason: "browser-has-no-local-cache" };
    },
    async listConflicts() {
      return {
        data: [],
        total: 0,
      };
    },
    async resolveConflict() {
      throw new Error("Conflitos locais estão disponíveis apenas no desktop");
    },
    async listDeadEvents() {
      return {
        data: [],
        total: 0,
      };
    },
    async listBlockedEvents() {
      return {
        data: [],
        total: 0,
      };
    },
    async discardDeadEvent() {
      throw new Error("A fila local de envio existe apenas no desktop");
    },
    async requeueDeadEvent() {
      throw new Error("A fila local de envio existe apenas no desktop");
    },
  };
}
