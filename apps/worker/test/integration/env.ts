import type { Env, R2BucketBinding } from "@calibra-facil/jobs-core";

// Test-env factory for the worker integration tier. The worker handlers take
// their entire outside world via an injected `env` object (no CF runtime,
// no ambient globals beyond `fetch`), which is exactly what makes them directly
// invocable from a test. This builds that env pointed at the ephemeral test
// Postgres, with in-memory fakes for the R2 buckets and the external secrets
// OMITTED so the optional integrations (signing PDFs, email) no-op.
//
// NOTE: `processIntegrationSync(env, message)` only reads the narrow surface
// `{ DATABASE_URL, INTEGRATIONS_MASTER_KEY }` (its param type is the local
// `IntegrationWorkerEnv` in integrations.ts). We still produce a full `Env` here
// so this same factory is reusable by the next handler spec (e.g.
// processBackgroundJob, which DOES read CERTIFICATES_BUCKET / GOTENBERG_URL).

// A valid AES-256-GCM master key is exactly 32 bytes, base64-encoded. We DO set
// INTEGRATIONS_MASTER_KEY (processIntegrationSync requires it to decrypt the
// per-connection bearer secret) but we DELIBERATELY OMIT SIGNING_MASTER_KEY and
// RESEND_API_KEY so certificate signing and email dispatch no-op in tests.
export const TEST_INTEGRATIONS_MASTER_KEY = Buffer.alloc(32, 7).toString(
  "base64",
);

/** Minimal in-memory R2 bucket: a Map keyed by object key. */
export function createFakeBucket(): R2BucketBinding {
  const store = new Map<string, { body: Uint8Array; contentType?: string }>();
  return {
    async get(key) {
      const entry = store.get(key);
      if (!entry) return null;
      const buf = entry.body;
      return {
        async arrayBuffer() {
          // Copy into a fresh ArrayBuffer (not a view onto a possibly-Shared
          // backing buffer) so the return type is exactly ArrayBuffer.
          const out = new ArrayBuffer(buf.byteLength);
          new Uint8Array(out).set(buf);
          return out;
        },
        httpMetadata: entry.contentType
          ? { contentType: entry.contentType }
          : undefined,
      };
    },
    async put(key, body, options) {
      const bytes = body instanceof Uint8Array ? body : new Uint8Array(body);
      store.set(key, {
        body: bytes,
        contentType: options?.httpMetadata?.contentType,
      });
    },
  };
}

/** The same database, as a session of the application role (`calibra_app`). */
export function applicationRoleUrl(ownerUrl: string): string {
  const url = new URL(ownerUrl);
  url.searchParams.set("options", "-c role=calibra_app");
  return url.toString();
}

/**
 * Build the `Env` the worker handlers consume, pointed at the test Postgres.
 * `INTEGRATIONS_MASTER_KEY` is set (required by processIntegrationSync to decrypt
 * the connection secret); signing/email secrets are omitted so those no-op.
 *
 * Like a deployment (P2-18k) the handlers connect as `calibra_app`, which the
 * tenant policies bind, with the owner as the system path
 * (`DATABASE_OWNER_URL`) and `DATABASE_RLS_MODE=enforced`: a handler statement
 * that forgets its organization fails its spec. The specs' own seeding and
 * assertions (`process.env.DATABASE_URL`, the `db` of setup.ts) stay on the owner.
 * CALIBRA_WORKER_DB_ROLE=owner runs the handlers as the owner too, to tell an RLS
 * refusal from a bug.
 */
export function makeTestEnv(overrides: Partial<Env> = {}): Env {
  const ownerUrl = process.env.DATABASE_URL;
  if (!ownerUrl) {
    throw new Error(
      "[worker-int] makeTestEnv called before setup.ts set DATABASE_URL",
    );
  }
  const asOwner = process.env.CALIBRA_WORKER_DB_ROLE === "owner";
  return {
    CERTIFICATES_BUCKET: createFakeBucket(),
    MEDIA_BUCKET: createFakeBucket(),
    DATABASE_URL: asOwner ? ownerUrl : applicationRoleUrl(ownerUrl),
    DATABASE_OWNER_URL: ownerUrl,
    DATABASE_RLS_MODE: asOwner ? "shadow" : "enforced",
    INTEGRATIONS_MASTER_KEY: TEST_INTEGRATIONS_MASTER_KEY,
    // SIGNING_MASTER_KEY, RESEND_API_KEY intentionally omitted -> no-op.
    ...overrides,
  };
}
