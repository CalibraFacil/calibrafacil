import type { ResponseValidationOptions } from "@calibra-facil/contracts";

export type ActiveUnitProvider = () => string | null;

export type CreateCloudApiClientOptions = {
  baseUrl: string;
  activeUnitProvider?: ActiveUnitProvider;
  fetch?: typeof fetch;
} & ResponseValidationOptions;

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
