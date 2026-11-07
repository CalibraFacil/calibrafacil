/**
 * A bucket of the S3-compatible object store, reduced to the two calls the
 * handlers make. (`httpMetadata.contentType` keeps the name of the put option
 * the call sites already use; the builders map it to S3's `ContentType`.)
 */
export interface ObjectBucket {
  get(key: string): Promise<{
    arrayBuffer(): Promise<ArrayBuffer>;
    httpMetadata?: { contentType?: string };
  } | null>;
  put(
    key: string,
    body: Buffer | Uint8Array | ArrayBuffer,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<void>;
}

export interface Env {
  CERTIFICATES_BUCKET: ObjectBucket;
  MEDIA_BUCKET: ObjectBucket;
  DATABASE_URL: string;
  /**
   * Connection string of the table OWNER: the system path, used only by the
   * lookups that learn which laboratory a queue message belongs to (the message
   * names a job, an order or an export, not its laboratory) and by the sweeps
   * that list the laboratories before working on each. Required while
   * DATABASE_RLS_MODE=enforced (the default; start-up refuses to run without it);
   * unset (shadow mode only), the system path shares DATABASE_URL, which is then
   * the owner.
   */
  DATABASE_OWNER_URL?: string;
  /**
   * `enforced` (the default): the application connects as `calibra_app`
   * (DATABASE_RLS_MODE). With it set and no `DATABASE_OWNER_URL`, a job that cannot be found on the
   * system path is a misconfiguration to retry, not a job that does not exist.
   */
  DATABASE_RLS_MODE?: "shadow" | "enforced";
  // HTML -> PDF conversion runs on the Gotenberg service; no in-process Chromium.
  GOTENBERG_URL?: string;
  GOTENBERG_TOKEN?: string;
  SIGNING_MASTER_KEY?: string; // Optional - if not set, PDFs won't be signed
  SIGNING_MASTER_KEY_ID?: string; // Id of the current KEK (unset: k1)
  SIGNING_MASTER_KEY_PREVIOUS?: string; // Previous KEKs, `id:base64key,...`
  // RFC 3161 TSA (#646 / CMP-03, PAdES-T). Unset => plain AD-RB signing.
  SIGNING_TSA_URL?: string;
  SIGNING_TSA_AUTH?: string; // Full Authorization header value for a contracted ACT (secret)
  SIGNING_TSA_ICP_CONFORMANT?: string; // "true" ONLY for a credentialed ICP-Brasil ACT
  SIGNING_TSA_TIMEOUT_MS?: string; // TSA request timeout; unset => 30000
  INTEGRATIONS_MASTER_KEY?: string;
  /** Encrypts webhook secrets; falls back to INTEGRATIONS_MASTER_KEY, as the API does. */
  PUBLIC_API_MASTER_KEY?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  EMAIL_FROM?: string;
  EMAIL_LOGO_URL?: string;
  WEB_URL?: string;
  APP_URL?: string;
}

/**
 * Which delivery of a queue message this is. Runtimes that redeliver a failed
 * message (the DB queue) supply it; runtimes that never redeliver
 * (the in-process `local` runner) leave it out, which means "this is the only
 * attempt", so a failure is final.
 */
export interface DeliveryAttempt {
  /** 1-based delivery count of this message. */
  attempt: number;
  /** Deliveries the runtime will make before giving up on the message. */
  maxAttempts: number;
}

/** Whether a failure on this delivery is the last one the queue will make. */
export function isFinalDelivery(delivery?: DeliveryAttempt): boolean {
  return !delivery || delivery.attempt >= delivery.maxAttempts;
}
