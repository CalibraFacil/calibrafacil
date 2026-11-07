import { appInfoSchema } from "@calibra-facil/contracts";
import type { LocalEnvironmentBootstrap } from "@calibra-facil/contracts";
import type { DesktopSecretsStore } from "../secrets-store";
import type { DesktopSettingsStore } from "../settings-store";
import type { HandlersFor } from "./handler-types";

type AppHandlerDeps = {
  app: { getName(): string; getVersion(): string; isPackaged: boolean };
  platform: string;
  arch: string;
  settings: Pick<DesktopSettingsStore, "get" | "update">;
  secrets: Pick<DesktopSecretsStore, "getStatuses" | "delete">;
  localEnvironmentBootstrap(): Promise<LocalEnvironmentBootstrap | null>;
};

/** What the app is and what the operator has configured on this machine. */
export function appHandlers(
  deps: AppHandlerDeps,
): HandlersFor<
  | "getAppInfo"
  | "getLocalEnvironmentBootstrap"
  | "getSettings"
  | "setSettings"
  | "getSecretStatuses"
  | "deleteSecret"
> {
  return {
    getAppInfo: () =>
      appInfoSchema.parse({
        name: deps.app.getName(),
        version: deps.app.getVersion(),
        platform: deps.platform,
        arch: deps.arch,
        isPackaged: deps.app.isPackaged,
      }),
    getLocalEnvironmentBootstrap: () => deps.localEnvironmentBootstrap(),
    getSettings: () => deps.settings.get(),
    setSettings: (patch) => deps.settings.update(patch),
    getSecretStatuses: () => deps.secrets.getStatuses(),
    deleteSecret: (name) => deps.secrets.delete(name),
  };
}
