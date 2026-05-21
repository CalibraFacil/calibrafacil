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

async function runtimeImport<T>(specifier: string): Promise<T> {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- dynamic import is intentionally hidden from bundlers and typed by the caller's module boundary.
  const importer = new Function("specifier", "return import(specifier)") as (
    specifier: string,
  ) => Promise<T>;
  return importer(specifier);
}

export function importWorkerModule() {
  return runtimeImport<WorkerModule>("@calibra-facil/worker");
}

export function importWorkerIntegrationsModule() {
  return runtimeImport<IntegrationsModule>(
    "@calibra-facil/worker/integrations",
  );
}
