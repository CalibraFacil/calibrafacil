import { readOriginsConfig } from "@calibra-facil/config";

/**
 * The origin the lab app's links point at (the account-setup, invitation and claim links). The
 * claim link carries the account-setup secret and some of these endpoints are unauthenticated:
 * anyone can submit a stranger's corporate address. Reading the host from `Origin` or `Referer`
 * would let the caller choose where that secret is sent, and a non-browser client sets those
 * headers freely regardless of CORS. Only configuration decides: `APP_URL`, else `WEB_URL`, else
 * the default of the deployment (`packages/config`, the one reader of both).
 */
export function resolveTrustedAppUrl() {
  return readOriginsConfig().appBaseUrl;
}
