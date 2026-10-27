import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { loadWorkerConfig, workerSigningEnv } from "@calibra-facil/config";
import { organizationSigningCertificate } from "@calibra-facil/db/schema";
import {
  createSigningKeyring,
  encryptBinary,
  encryptPassword,
  generateMasterKey,
  sealSigningCredential,
} from "@calibra-facil/signing";
import type { Env } from "@calibra-facil/jobs-core";
import { db, truncateAll } from "../test/integration/db";
import { makeTestEnv } from "../test/integration/env";
import { makeMinimalPdf, makeSignerP12 } from "../test/integration/mock-tsa";
import { seedOrg, type SeededOrg } from "../test/integration/seed";
import { seedIssuableJob } from "../test/integration/seed-certificate";

/**
 * Roadmap 2 B4a, REQ-B4A-1 at the point of use: the worker opens the unit's
 * signing credential with the KEK named in its record and the AAD it is bound to
 * (organization + unit + serial), and signs. Legacy rows keep working; a KEK
 * rotation (current + previous keys, through the validated worker configuration)
 * keeps every credential usable; a credential that does not open (an unknown KEK,
 * another unit's AAD) FAILS CLOSED: the job is rejected, never issued unsigned.
 *
 * Real: Postgres, the issuance path (processBackgroundJob), the credential
 * storage, the signer. Stubbed: Gotenberg (HTML -> PDF), R2 (in-memory) and the
 * notification service.
 */

vi.mock("@calibra-facil/notifications", () => ({
  notifyCertificateReady: vi.fn(async () => undefined),
  notifyAuditPackReady: vi.fn(async () => undefined),
  notifySigningCertificateLapsed: vi.fn(async () => undefined),
}));

import { processBackgroundJob } from "@calibra-facil/jobs-core";

const GOTENBERG_URL = "http://gotenberg.test";
const KEY_K1 = generateMasterKey();
const KEY_K2 = generateMasterKey();
const P12_PASSWORD = "senha-do-certificado";
const USER_ID = "user-org-1";
const CERT_PDF = makeMinimalPdf();

function stubGotenberg() {
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : String(input);
    if (!url.startsWith(GOTENBERG_URL)) return realFetch(input, init);
    return new Response(CERT_PDF, { status: 200 });
  });
}

function toRows(result: unknown): unknown[] {
  if (result && typeof result === "object" && "rows" in result) {
    const inner = Reflect.get(result, "rows");
    return Array.isArray(inner) ? inner : [];
  }
  return Array.isArray(result) ? result : [];
}

function field(row: unknown, key: string): unknown {
  return row && typeof row === "object" && key in row
    ? Reflect.get(row, key)
    : undefined;
}

async function jobRow(jobId: number) {
  const row = toRows(
    await db.execute(
      sql`SELECT status, certificate_url, signature_metadata, rejection_reason
          FROM calibration_job WHERE id = ${jobId}`,
    ),
  )[0];
  return {
    status: String(field(row, "status")),
    certificateUrl: field(row, "certificate_url"),
    signatureMetadata: field(row, "signature_metadata"),
    rejectionReason: field(row, "rejection_reason"),
  };
}

type Layout =
  | { kind: "legacy"; key: string }
  | { kind: "envelope"; currentKey: string; currentId: string }
  // Sealed under a ring, but bound to another unit (a copied/misrouted record).
  | { kind: "envelope-other-unit"; currentKey: string; currentId: string };

async function seedCertificate(org: SeededOrg, layout: Layout) {
  const signer = makeSignerP12(P12_PASSWORD);
  const serialNumber = signer.serialNumber;
  let stored;
  if (layout.kind === "legacy") {
    const { encryptedPassword, iv } = encryptPassword(P12_PASSWORD, layout.key);
    stored = {
      encryptedP12: encryptBinary(signer.p12, layout.key),
      encryptedPassword,
      passwordIv: iv,
      kekId: null,
      custodyFormatVersion: 1,
    };
  } else {
    const sealed = sealSigningCredential(
      { p12: signer.p12, password: P12_PASSWORD },
      {
        organizationId: org.orgId,
        unitId:
          layout.kind === "envelope-other-unit" ? org.unitId + 1 : org.unitId,
        serialNumber,
      },
      createSigningKeyring({
        currentKey: layout.currentKey,
        currentId: layout.currentId,
      }),
    );
    stored = {
      encryptedP12: sealed.encryptedP12,
      encryptedPassword: sealed.encryptedPassword,
      passwordIv: sealed.passwordIv,
      kekId: sealed.kekId,
      custodyFormatVersion: sealed.formatVersion,
    };
  }
  await db.insert(organizationSigningCertificate).values({
    organizationId: org.orgId,
    unitId: org.unitId,
    name: "Certificado de Teste",
    serialNumber,
    issuerCn: signer.subjectCn,
    subjectCn: signer.subjectCn,
    validFrom: signer.validFrom,
    validUntil: signer.validUntil,
    isActive: true,
    isDefault: true,
    createdBy: org.userId,
    ...stored,
  });
  return signer;
}

/**
 * The worker environment as a deployment builds it: the validated worker
 * configuration, signing variables through the shared builder (so the KEK id and
 * the previous keys reach the worker the way they do in production).
 */
function makeEnv(signing: {
  SIGNING_MASTER_KEY: string;
  SIGNING_MASTER_KEY_ID?: string;
  SIGNING_MASTER_KEY_PREVIOUS?: string;
}): { env: Env; stored: Map<string, Uint8Array> } {
  const base = makeTestEnv();
  const config = loadWorkerConfig({
    DATABASE_URL: base.DATABASE_URL,
    R2_ENDPOINT: "http://s3.invalid:7070",
    R2_ACCESS_KEY_ID: "id",
    R2_SECRET_ACCESS_KEY: "secret",
    R2_BUCKET_NAME: "docs",
    R2_MEDIA_BUCKET_NAME: "media",
    INTEGRATIONS_MASTER_KEY: base.INTEGRATIONS_MASTER_KEY,
    ...signing,
  });
  const stored = new Map<string, Uint8Array>();
  const certificates = base.CERTIFICATES_BUCKET;
  const env: Env = {
    ...base,
    GOTENBERG_URL,
    ...workerSigningEnv(config.signing),
    CERTIFICATES_BUCKET: {
      ...certificates,
      put: async (key, value, options) => {
        stored.set(
          key,
          value instanceof Uint8Array ? value : new Uint8Array(value),
        );
        return certificates.put(key, value, options);
      },
    },
  };
  return { env, stored };
}

async function seedJob() {
  const org = await seedOrg({ orgId: "org-1", userId: USER_ID });
  const job = await seedIssuableJob({
    organizationId: org.orgId,
    unitId: org.unitId,
    userId: org.userId,
  });
  return { org, job };
}

async function issue(
  env: Env,
  org: SeededOrg,
  jobId: number,
  delivery?: { attempt: number; maxAttempts: number },
) {
  return processBackgroundJob(
    env,
    { type: "CERTIFICATE", jobId, userId: org.userId },
    delivery,
  );
}

beforeEach(async () => {
  await truncateAll();
  stubGotenberg();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("signing with enveloped and legacy credentials (REQ-B4A-1)", () => {
  it("signs with an envelope credential sealed under the current KEK", async () => {
    const { env } = makeEnv({
      SIGNING_MASTER_KEY: KEY_K1,
      SIGNING_MASTER_KEY_ID: "k1",
    });
    const { org, job } = await seedJob();
    const signer = await seedCertificate(org, {
      kind: "envelope",
      currentKey: KEY_K1,
      currentId: "k1",
    });

    await issue(env, org, job.jobId);

    const after = await jobRow(job.jobId);
    expect(after.status).toBe("APPROVED");
    expect(field(after.signatureMetadata, "signerCertificateSerial")).toBe(
      signer.serialNumber,
    );
  });

  it("a LEGACY credential (enc:v1, no kek id) still signs: no lockout", async () => {
    const { env } = makeEnv({ SIGNING_MASTER_KEY: KEY_K1 });
    const { org, job } = await seedJob();
    await seedCertificate(org, { kind: "legacy", key: KEY_K1 });

    await issue(env, org, job.jobId);

    expect((await jobRow(job.jobId)).status).toBe("APPROVED");
  });

  it("KEK rotation: after the key changes (k2 current, k1 previous) legacy and k1-sealed credentials still sign", async () => {
    const rotated = {
      SIGNING_MASTER_KEY: KEY_K2,
      SIGNING_MASTER_KEY_ID: "k2",
      SIGNING_MASTER_KEY_PREVIOUS: `k1:${KEY_K1}`,
    };

    // envelope sealed under k1 before the rotation
    {
      await truncateAll();
      const { env } = makeEnv(rotated);
      const { org, job } = await seedJob();
      await seedCertificate(org, {
        kind: "envelope",
        currentKey: KEY_K1,
        currentId: "k1",
      });
      await issue(env, org, job.jobId);
      expect((await jobRow(job.jobId)).status).toBe("APPROVED");
    }

    // legacy row encrypted with the old master key
    {
      await truncateAll();
      const { env } = makeEnv(rotated);
      const { org, job } = await seedJob();
      await seedCertificate(org, { kind: "legacy", key: KEY_K1 });
      await issue(env, org, job.jobId);
      expect((await jobRow(job.jobId)).status).toBe("APPROVED");
    }

    // sealed under the new current key
    {
      await truncateAll();
      const { env } = makeEnv(rotated);
      const { org, job } = await seedJob();
      await seedCertificate(org, {
        kind: "envelope",
        currentKey: KEY_K2,
        currentId: "k2",
      });
      await issue(env, org, job.jobId);
      expect((await jobRow(job.jobId)).status).toBe("APPROVED");
    }
  }, 120_000);

  it("fails closed when the credential's KEK was dropped from the ring: the job is REJECTED naming the key, nothing issued unsigned", async () => {
    const { env, stored } = makeEnv({
      SIGNING_MASTER_KEY: KEY_K2,
      SIGNING_MASTER_KEY_ID: "k2",
    });
    const { org, job } = await seedJob();
    await seedCertificate(org, {
      kind: "envelope",
      currentKey: KEY_K1,
      currentId: "k1",
    });

    await expect(
      issue(env, org, job.jobId, { attempt: 3, maxAttempts: 3 }),
    ).rejects.toThrow(/assinatura digital/);

    const after = await jobRow(job.jobId);
    expect(after.status).toBe("REJECTED");
    expect(String(after.rejectionReason)).toMatch(
      /Falha na assinatura digital/,
    );
    expect(String(after.rejectionReason)).toContain('"k1"');
    expect(after.certificateUrl).toBeNull();
    expect(stored.size).toBe(0);
  }, 60_000);

  it("fails closed when the record is bound to another unit (AAD mismatch): REJECTED, nothing issued unsigned", async () => {
    const { env, stored } = makeEnv({
      SIGNING_MASTER_KEY: KEY_K1,
      SIGNING_MASTER_KEY_ID: "k1",
    });
    const { org, job } = await seedJob();
    await seedCertificate(org, {
      kind: "envelope-other-unit",
      currentKey: KEY_K1,
      currentId: "k1",
    });

    await expect(
      issue(env, org, job.jobId, { attempt: 3, maxAttempts: 3 }),
    ).rejects.toThrow(/assinatura digital/);

    const after = await jobRow(job.jobId);
    expect(after.status).toBe("REJECTED");
    expect(after.certificateUrl).toBeNull();
    expect(stored.size).toBe(0);
  }, 60_000);
});
