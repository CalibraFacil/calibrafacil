import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { loadWorkerConfig, workerSigningEnv } from "@calibra-facil/config";
import { organizationSigningCertificate } from "@calibra-facil/db/schema";
import {
  encryptBinary,
  encryptPassword,
  signPdf,
} from "@calibra-facil/signing";
import type { Env } from "@calibra-facil/jobs-core";
import { db, truncateAll } from "../test/integration/db";
import { makeTestEnv } from "../test/integration/env";
import {
  makeMinimalPdf,
  makeSignerP12,
  startMockTsa,
  unreachableTsaUrl,
  type MockTsa,
} from "../test/integration/mock-tsa";
import { seedOrg, type SeededOrg } from "../test/integration/seed";
import { seedIssuableJob } from "../test/integration/seed-certificate";

/**
 * P2-16 / REQ-TSA-2 and REQ-TSA-3: a configured RFC 3161 time-stamp authority
 * reaches the certificate render through the worker environment, and the
 * signing path behaves as documented on top of it.
 *
 * Real: the Postgres, the issuance path (processBackgroundJob), the unit's
 * encrypted signing certificate, the signer, pdf-rfc3161, the worker
 * environment (built by the shared builder from a validated worker
 * configuration), and an HTTP time-stamp authority that answers with a signed
 * RFC 3161 token. Stubbed: Gotenberg (HTML -> PDF) and R2 (in-memory).
 */

vi.mock("@calibra-facil/notifications", () => ({
  notifyCertificateReady: vi.fn(async () => undefined),
  notifyAuditPackReady: vi.fn(async () => undefined),
}));

import { processBackgroundJob } from "@calibra-facil/jobs-core";

const GOTENBERG_URL = "http://gotenberg.test";
const MASTER_KEY = Buffer.alloc(32, 11).toString("base64");
const P12_PASSWORD = "senha-do-certificado";
const USER_ID = "user-org-1";
const SIGN_REASON = "Certificado de Calibracao - CalibraFacil";
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
  const result = await db.execute(
    sql`SELECT status, certificate_url, signature_metadata, rejection_reason
        FROM calibration_job WHERE id = ${jobId}`,
  );
  const row = toRows(result)[0];
  return {
    status: String(field(row, "status")),
    certificateUrl: field(row, "certificate_url"),
    signatureMetadata: field(row, "signature_metadata"),
    rejectionReason: field(row, "rejection_reason"),
  };
}

async function snapshotCount(jobId: number): Promise<number> {
  const result = await db.execute(
    sql`SELECT id FROM issued_certificate_snapshot WHERE job_id = ${jobId}`,
  );
  return toRows(result).length;
}

async function seedSigningCertificate(org: SeededOrg) {
  const signer = makeSignerP12(P12_PASSWORD);
  const { encryptedPassword, iv } = encryptPassword(P12_PASSWORD, MASTER_KEY);
  await db.insert(organizationSigningCertificate).values({
    organizationId: org.orgId,
    unitId: org.unitId,
    name: "Certificado de Teste",
    serialNumber: signer.serialNumber,
    issuerCn: signer.subjectCn,
    subjectCn: signer.subjectCn,
    validFrom: signer.validFrom,
    validUntil: signer.validUntil,
    encryptedP12: encryptBinary(signer.p12, MASTER_KEY),
    encryptedPassword,
    passwordIv: iv,
    isActive: true,
    isDefault: true,
    createdBy: org.userId,
  });
  return signer;
}

/**
 * The worker environment exactly as a deployment builds it: a validated worker
 * configuration read from an environment source, signing variables through the
 * shared builder. Stored PDFs are recorded as they are put.
 */
function makeEnv(tsa: Record<string, string>): {
  env: Env;
  stored: Map<string, Uint8Array>;
} {
  const base = makeTestEnv();
  const config = loadWorkerConfig({
    DATABASE_URL: base.DATABASE_URL,
    R2_ENDPOINT: "http://s3.invalid:7070",
    R2_ACCESS_KEY_ID: "id",
    R2_SECRET_ACCESS_KEY: "secret",
    R2_BUCKET_NAME: "docs",
    R2_MEDIA_BUCKET_NAME: "media",
    SIGNING_MASTER_KEY: MASTER_KEY,
    INTEGRATIONS_MASTER_KEY: base.INTEGRATIONS_MASTER_KEY,
    ...tsa,
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
  const signer = await seedSigningCertificate(org);
  const job = await seedIssuableJob({
    organizationId: org.orgId,
    unitId: org.unitId,
    userId: org.userId,
  });
  return { org, job, signer };
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function stringField(value: unknown, key: string): unknown {
  return value && typeof value === "object"
    ? Reflect.get(value, key)
    : undefined;
}

let tsa: MockTsa;

beforeEach(async () => {
  await truncateAll();
  tsa = await startMockTsa();
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  await tsa.close();
});

describe("RFC 3161 time-stamping reaches the certificate render (P2-16)", () => {
  it("REQ-TSA-2 [HIGH RISK] with a TSA configured the render requests a time-stamp and the stored signature metadata records it", async () => {
    stubGotenberg();
    const { env, stored } = makeEnv({
      SIGNING_TSA_URL: tsa.url,
      SIGNING_TSA_AUTH: "Bearer segredo-da-act",
      SIGNING_TSA_ICP_CONFORMANT: "true",
    });
    const { org, job } = await seedJob();

    await processBackgroundJob(env, {
      type: "CERTIFICATE",
      jobId: job.jobId,
      userId: org.userId,
    });

    // The authority was asked exactly once, with the contracted credentials.
    expect(tsa.requests).toHaveLength(1);
    expect(tsa.requests[0]?.headers.authorization).toBe(
      "Bearer segredo-da-act",
    );

    const after = await jobRow(job.jobId);
    expect(after.status).toBe("APPROVED");
    const metadata = after.signatureMetadata;
    expect(stringField(metadata, "timestamped")).toBe(true);
    expect(stringField(metadata, "timestampIcpBrasilConformant")).toBe(true);

    // The recorded hash describes the FINAL stored (time-stamped) artifact.
    const pdfs = [...stored.values()];
    expect(pdfs).toHaveLength(1);
    expect(stringField(metadata, "pdfHash")).toBe(
      sha256Hex(pdfs[0] ?? CERT_PDF),
    );
    // ...and that artifact really carries the RFC 3161 document time-stamp.
    expect(Buffer.from(pdfs[0] ?? CERT_PDF).includes("ETSI.RFC3161")).toBe(
      true,
    );
    expect(await snapshotCount(job.jobId)).toBe(1);
  });

  it("REQ-TSA-2 a TSA not marked ICP-Brasil records the honest icpBrasilConformant=false", async () => {
    stubGotenberg();
    const { env } = makeEnv({ SIGNING_TSA_URL: tsa.url });
    const { org, job } = await seedJob();

    await processBackgroundJob(env, {
      type: "CERTIFICATE",
      jobId: job.jobId,
      userId: org.userId,
    });

    const metadata = (await jobRow(job.jobId)).signatureMetadata;
    expect(stringField(metadata, "timestamped")).toBe(true);
    expect(stringField(metadata, "timestampIcpBrasilConformant")).toBe(false);
  });

  describe("TSA configured but unreachable (fail closed)", () => {
    it("REQ-TSA-2 [HIGH RISK] a non-final delivery keeps the job GENERATING_PDF for retry and publishes nothing", async () => {
      stubGotenberg();
      const { env, stored } = makeEnv({
        SIGNING_TSA_URL: await unreachableTsaUrl(),
      });
      const { org, job } = await seedJob();

      await expect(
        processBackgroundJob(
          env,
          { type: "CERTIFICATE", jobId: job.jobId, userId: org.userId },
          { attempt: 1, maxAttempts: 3 },
        ),
      ).rejects.toThrow(/carimbo do tempo/);

      const after = await jobRow(job.jobId);
      expect(after.status).toBe("GENERATING_PDF");
      expect(after.certificateUrl).toBeNull();
      expect(after.signatureMetadata).toBeNull();
      expect(stored.size).toBe(0);
      expect(await snapshotCount(job.jobId)).toBe(0);
    }, 60_000);

    it("REQ-TSA-2 [HIGH RISK] the final delivery REJECTS the job with the reason recorded and still publishes nothing", async () => {
      stubGotenberg();
      const { env, stored } = makeEnv({
        SIGNING_TSA_URL: await unreachableTsaUrl(),
      });
      const { org, job } = await seedJob();

      await expect(
        processBackgroundJob(
          env,
          { type: "CERTIFICATE", jobId: job.jobId, userId: org.userId },
          { attempt: 3, maxAttempts: 3 },
        ),
      ).rejects.toThrow(/carimbo do tempo/);

      const after = await jobRow(job.jobId);
      expect(after.status).toBe("REJECTED");
      expect(String(after.rejectionReason)).toMatch(/carimbo do tempo/);
      expect(after.certificateUrl).toBeNull();
      expect(stored.size).toBe(0);
      expect(await snapshotCount(job.jobId)).toBe(0);
    }, 60_000);
  });

  it("REQ-TSA-3 [HIGH RISK] with no TSA configured no time-stamp is requested and the output is byte-identical to the plain signature", async () => {
    stubGotenberg();
    // Both sides sign at the same instant, so the only difference that could
    // remain is a time-stamp.
    vi.useFakeTimers({
      toFake: ["Date"],
      now: new Date("2026-03-04T05:06:07Z"),
    });
    const { env, stored } = makeEnv({});
    const { org, job, signer } = await seedJob();

    await processBackgroundJob(env, {
      type: "CERTIFICATE",
      jobId: job.jobId,
      userId: org.userId,
    });

    expect(tsa.requests).toHaveLength(0);
    const after = await jobRow(job.jobId);
    expect(after.status).toBe("APPROVED");
    expect(stringField(after.signatureMetadata, "timestamped")).toBeUndefined();

    const plain = await signPdf(Buffer.from(CERT_PDF), {
      p12Buffer: signer.p12,
      password: P12_PASSWORD,
      reason: SIGN_REASON,
      location: "Brasil",
      enableLtv: false,
    });
    const pdfs = [...stored.values()];
    expect(pdfs).toHaveLength(1);
    expect(Buffer.from(pdfs[0] ?? new Uint8Array())).toEqual(
      Buffer.from(plain.signedPdf),
    );
    expect(Buffer.from(plain.signedPdf).includes("ETSI.RFC3161")).toBe(false);
  });
});
