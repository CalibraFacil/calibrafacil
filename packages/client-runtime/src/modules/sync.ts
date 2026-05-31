import type { SyncApi } from "../types";

export function createCloudSyncApi(): SyncApi {
  return {
    async getSession() {
      return {
        data: null,
      };
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
  };
}
