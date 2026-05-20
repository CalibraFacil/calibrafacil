import type { CalibraBridge } from "@calibra-facil/contracts";
import type { CreateCloudApiClientOptions } from "./cloud";

export type CreateDesktopApiClientOptions = {
  baseUrl: string;
  tokenProvider?: () => string | null | Promise<string | null>;
  fetch?: typeof fetch;
};

export type CreateDesktopHybridApiClientOptions = {
  cloud: CreateCloudApiClientOptions;
  local: CreateDesktopApiClientOptions;
};

export async function createDesktopHeaders(
  tokenProvider: CreateDesktopApiClientOptions["tokenProvider"],
  init?: HeadersInit,
) {
  const headers = new Headers(init);
  const token = await tokenProvider?.();

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  return headers;
}

export function isDesktopRuntime(windowLike?: Window): boolean {
  const currentWindow =
    windowLike ?? (typeof window === "undefined" ? undefined : window);
  if (!currentWindow) {
    return false;
  }

  return (
    Boolean(currentWindow.calibraBridge) ||
    currentWindow.navigator.userAgent.includes("Electron")
  );
}

export async function getDesktopApiBaseUrl(
  bridge: CalibraBridge,
): Promise<string | null> {
  const bootstrap = await bridge.getLocalEnvironmentBootstrap();
  return bootstrap?.httpBaseUrl ?? null;
}

declare global {
  interface Window {
    calibraBridge?: CalibraBridge;
  }
}
