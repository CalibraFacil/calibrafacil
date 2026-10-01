/**
 * S3 connection settings for the object store.
 *
 * Production targets Cloudflare R2, whose S3 endpoint is derived from the
 * account id. Any other S3-compatible store (the local dev container from
 * docker-compose.yml, MinIO, AWS S3, …) is selected by setting R2_ENDPOINT;
 * path-style addressing is then used, since most self-hosted stores do not
 * serve virtual-hosted buckets.
 */
export type S3EndpointEnv = {
  R2_ACCOUNT_ID?: string | null;
  R2_ENDPOINT?: string | null;
  R2_REGION?: string | null;
};

export type S3EndpointConfig = {
  endpoint: string;
  region: string;
  forcePathStyle: boolean;
};

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function resolveS3EndpointConfig(env: S3EndpointEnv): S3EndpointConfig {
  const customEndpoint = clean(env.R2_ENDPOINT);
  if (customEndpoint) {
    return {
      endpoint: customEndpoint.replace(/\/+$/, ""),
      region: clean(env.R2_REGION) ?? "us-east-1",
      forcePathStyle: true,
    };
  }

  const accountId = clean(env.R2_ACCOUNT_ID);
  if (!accountId) {
    throw new Error("R2_ACCOUNT_ID or R2_ENDPOINT is required");
  }

  return {
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    region: clean(env.R2_REGION) ?? "auto",
    forcePathStyle: false,
  };
}

/** Same as {@link resolveS3EndpointConfig}, filling gaps from process.env. */
export function resolveS3EndpointConfigFromProcess(
  env: S3EndpointEnv = {},
): S3EndpointConfig {
  const fromProcess = (name: keyof S3EndpointEnv) =>
    typeof process === "undefined" ? undefined : process.env[name];

  return resolveS3EndpointConfig({
    R2_ACCOUNT_ID: clean(env.R2_ACCOUNT_ID) ?? fromProcess("R2_ACCOUNT_ID"),
    R2_ENDPOINT: clean(env.R2_ENDPOINT) ?? fromProcess("R2_ENDPOINT"),
    R2_REGION: clean(env.R2_REGION) ?? fromProcess("R2_REGION"),
  });
}
