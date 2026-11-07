import type { LocalPartitionController } from "../local-partition-controller";
import type { LocalPartitionStore } from "../local-partition-store";
import type { HandlersFor } from "./handler-types";

/** Which account's local database is open, and the grant to open it offline. */
export function partitionHandlers(deps: {
  controller: Pick<LocalPartitionController, "activate">;
  store: Pick<LocalPartitionStore, "forget">;
}): HandlersFor<"activateLocalPartition" | "forgetOfflineAccess"> {
  return {
    activateLocalPartition: (request) => deps.controller.activate(request),
    // Sign-out ends the offline grant (the remembered partition), never the data.
    forgetOfflineAccess: async () => {
      await deps.store.forget();
      return true;
    },
  };
}
