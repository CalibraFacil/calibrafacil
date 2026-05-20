import { hc } from "hono/client";
import type { Hono } from "hono";

export type HonoCloudClient<
  TApp extends Hono<any, any, any> = Hono<any, any, any>,
> = ReturnType<typeof hc<TApp>>;

export type ActiveUnitProvider = () => string | null;

export type CreateCloudApiClientOptions = {
  baseUrl: string;
  activeUnitProvider?: ActiveUnitProvider;
  fetch?: typeof fetch;
};

export function createRawCloudClient<
  TApp extends Hono<any, any, any> = Hono<any, any, any>,
>(options: CreateCloudApiClientOptions): HonoCloudClient<TApp> {
  const fetchImpl = options.fetch ?? fetch;

  return hc<TApp>(options.baseUrl, {
    fetch: (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const activeUnitId = options.activeUnitProvider?.();

      if (activeUnitId) {
        headers.set("x-active-unit-id", activeUnitId);
      }

      return fetchImpl(input, {
        ...init,
        credentials: "include",
        headers,
      });
    },
  });
}

export function createCloudHeaders(
  activeUnitProvider: ActiveUnitProvider | undefined,
) {
  const headers = new Headers();
  const activeUnitId = activeUnitProvider?.();

  if (activeUnitId) {
    headers.set("x-active-unit-id", activeUnitId);
  }

  return headers;
}
