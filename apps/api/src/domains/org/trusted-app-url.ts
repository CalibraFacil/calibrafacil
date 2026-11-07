import { appBaseUrl } from "@calibra-facil/shared/public-urls";
import { toRecord } from "@calibra-facil/shared/record";

/** A configured value of the runtime bag (`c.env`) or, failing that, the process environment. */
function configuredValue(c: { env?: unknown }, key: string) {
  const fromRuntime = toRecord(c.env)[key];
  const value =
    typeof fromRuntime === "string" ? fromRuntime : process.env[key];

  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

/**
 * The origin the lab app's links point at (the account-setup, invitation and claim links). The
 * claim link carries the account-setup secret and some of these endpoints are unauthenticated:
 * anyone can submit a stranger's corporate address. Reading the host from `Origin` or `Referer`
 * would let the caller choose where that secret is sent, and a non-browser client sets those
 * headers freely regardless of CORS. Only configuration decides: `APP_URL`, else `WEB_URL`, else
 * the default of the deployment.
 */
export function resolveTrustedAppUrl(c: { env?: unknown }) {
  const configured =
    configuredValue(c, "APP_URL") ?? configuredValue(c, "WEB_URL");
  if (configured) return configured.replace(/\/+$/, "");

  return appBaseUrl();
}
