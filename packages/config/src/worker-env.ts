/**
 * The signing part of the environment the worker runs with.
 *
 * Every way of running the worker builds its environment from the validated
 * worker configuration: the Vercel queue consumer, the cron handlers and the
 * inline/dev runner (`createWorkerRuntimeEnv` in the API), and the DB-queue
 * drain, the document-worker container and the always-on Bun worker
 * (`createWorkerEnv` in apps/worker). They all take the signing variables from
 * here, so a variable added to the signing group reaches every one of them
 * (RFC 3161 time-stamping could not switch on in the worker while two copies
 * of this list each missed `SIGNING_TSA_*`).
 *
 * The worker reads these as plain strings (`resolveTsaConfig` in apps/worker).
 * With `SIGNING_TSA_URL` unset no time-stamp is requested.
 */
export type WorkerSigningEnv = {
  SIGNING_MASTER_KEY?: string;
  SIGNING_TSA_URL?: string;
  SIGNING_TSA_AUTH?: string;
  SIGNING_TSA_ICP_CONFORMANT?: string;
  SIGNING_TSA_TIMEOUT_MS?: string;
};

type SigningSettings = {
  readonly masterKey: string | undefined;
  readonly tsaUrl: string | undefined;
  readonly tsaAuth: string | undefined;
  readonly tsaIcpConformant: boolean;
  readonly tsaTimeoutMs: number | undefined;
};

export function workerSigningEnv(signing: SigningSettings): WorkerSigningEnv {
  return {
    SIGNING_MASTER_KEY: signing.masterKey,
    SIGNING_TSA_URL: signing.tsaUrl,
    SIGNING_TSA_AUTH: signing.tsaAuth,
    SIGNING_TSA_ICP_CONFORMANT: signing.tsaIcpConformant ? "true" : "false",
    SIGNING_TSA_TIMEOUT_MS:
      signing.tsaTimeoutMs === undefined
        ? undefined
        : String(signing.tsaTimeoutMs),
  };
}
