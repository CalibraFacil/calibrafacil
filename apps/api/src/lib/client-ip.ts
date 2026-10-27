import { rawEnv, readRuntimeConfig } from "@calibra-facil/config";

/**
 * The client's address, for the audit trail, rate limits and throttles
 * (roadmap 2 D1, review 3.3).
 *
 * The connection's peer (`REMOTE_ADDRESS`, set by the Bun entry from the socket)
 * is the client unless reverse proxies stand in front of the API. Each trusted
 * proxy appends the address it received the request from to X-Forwarded-For, so
 * with `TRUSTED_PROXY_HOPS` = n the client is the n-th entry from the right.
 * Anything further left was written by the client itself and is never believed;
 * nor are `X-Real-IP` and `CF-Connecting-IP`. With 0 hops (the default) the
 * forwarded headers are ignored altogether.
 */
export function clientIp(c: ClientIpContext): string | null {
  const peer = remoteAddressOf(c.env);
  const hops = trustedProxyHops(c.env);
  if (hops === 0) return peer;

  const forwarded = (c.req.header("x-forwarded-for") ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return forwarded[forwarded.length - hops] ?? peer;
}

export type ClientIpContext = {
  req: { header(name: string): string | undefined };
  env?: unknown;
};

function remoteAddressOf(env: unknown): string | null {
  if (env === null || typeof env !== "object") return null;
  const address = Reflect.get(env, "REMOTE_ADDRESS");
  return typeof address === "string" && address.length > 0 ? address : null;
}

function trustedProxyHops(env: unknown): number {
  const fromBinding =
    env !== null && typeof env === "object"
      ? Reflect.get(env, "TRUSTED_PROXY_HOPS")
      : undefined;
  const source = {
    TRUSTED_PROXY_HOPS:
      typeof fromBinding === "string"
        ? fromBinding
        : rawEnv().TRUSTED_PROXY_HOPS,
  };
  try {
    return readRuntimeConfig(source).trustedProxyHops;
  } catch {
    return 0;
  }
}
