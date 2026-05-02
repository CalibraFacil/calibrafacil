import type { BackgroundJobMessage } from "@calibra-facil/shared";
import type { WorkerRuntimeEnv } from "./runtime-env";

type WorkerModule = {
  processBackgroundJob(
    env: WorkerRuntimeEnv,
    message: BackgroundJobMessage,
  ): Promise<void>;
};

type IntegrationsModule = {
  processScheduledIntegrationSyncs(
    env: WorkerRuntimeEnv,
    options: {
      dispatch: (
        message: Extract<BackgroundJobMessage, { type: "INTEGRATION_SYNC" }>,
      ) => Promise<void>;
    },
  ): Promise<{ scheduledRuns: number }>;
};

const runtimeImport = new Function("specifier", "return import(specifier)") as <
  T,
>(
  specifier: string,
) => Promise<T>;

export function importWorkerModule() {
  return runtimeImport<WorkerModule>("@calibra-facil/worker");
}

export function importWorkerIntegrationsModule() {
  return runtimeImport<IntegrationsModule>(
    "@calibra-facil/worker/integrations",
  );
}
