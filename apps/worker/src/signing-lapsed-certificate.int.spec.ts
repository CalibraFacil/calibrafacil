import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { loadWorkerConfig, workerSigningEnv } from "@calibra-facil/config";
import { organizationSigningCertificate } from "@calibra-facil/db/schema";
import { encryptBinary, encryptPassword } from "@calibra-facil/signing";
import type { Env } from "@calibra-facil/jobs-core";
import { db, truncateAll } from "../test/integration/db";
import { makeTestEnv } from "../test/integration/env";
import { makeMinimalPdf, makeSignerP12 } from "../test/integration/mock-tsa";
import { seedOrg, type SeededOrg } from "../test/integration/seed";
import { seedIssuableJob } from "../test/integration/seed-certificate";

/**
 * P0-8 / Q44: an expired signing certificate FAILS CLOSED.
 *
 * Before, the issuance read "a valid default certificate" and an expired A1
 * looked like "no certificate": the unit's certificates were silently issued
 * UNSIGNED. Now a unit that has ever had a signing certificate (any row,
 * expired and revoked included) and has none valid gets a failed render
 * (existing render-failure path: the job is REJECTED with the reason, nothing
 * is stored) and its admins are notified. A unit that never had one keeps
 * issuing unsigned.
 *
 * Real: Postgres, the issuance path (processBackgroundJob), the unit's
 * encrypted certificates, the signer. Stubbed: Gotenberg (HTML -> PDF), R2
 * (in-memory) and the notification service (asserted on).
 */

const mocks = vi.hoisted(() => ({
  lapsed: vi.fn(async (_jobId: number, _reason: string) => undefined),
}));

vi.mock("@calibra-facil/notifications", () => ({
  notifyCertificateReady: vi.fn(async () => undefined),
  notifyAuditPackReady: vi.fn(async () => undefined),
  notifySigningCertificateLapsed: mocks.lapsed,
}));

import { processBackgroundJob } from "@calibra-facil/jobs-core";

const GOTENBERG_URL = "http://gotenberg.test";
const MASTER_KEY = Buffer.alloc(32, 11).toString("base64");
const P12_PASSWORD = "senha-do-certificado";
const USER_ID = "user-org-1";
const CERT_PDF = makeMinimalPdf();
// Noon UTC: the same calendar day in the laboratory's zone.
const LONG_AGO = new Date("2024-01-01T12:00:00.000Z");

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

/** A signing certificate row of the unit, valid or not. */
async function insertCertificate(
  org: SeededOrg,
  options: {
    name: string;
    validUntil?: Date;
    isActive?: boolean;
    isDefault?: boolean;
    revoked?: boolean;
  },
) {
  const signer = makeSignerP12(P12_PASSWORD);
  const { encryptedPassword, iv } = encryptPassword(P12_PASSWORD, MASTER_KEY);
  await db.insert(organizationSigningCertificate).values({
    organizationId: org.orgId,
    unitId: org.unitId,
    name: options.name,
    serialNumber: `${signer.serialNumber}-${options.name}`,
    issuerCn: signer.subjectCn,
    subjectCn: signer.subjectCn,
    validFrom: LONG_AGO,
    validUntil: options.validUntil ?? signer.validUntil,
    encryptedP12: encryptBinary(signer.p12, MASTER_KEY),
    encryptedPassword,
    passwordIv: iv,
    isActive: options.isActive ?? true,
    isDefault: options.isDefault ?? true,
    createdBy: org.userId,
    ...(options.revoked
      ? {
          revokedAt: new Date("2025-06-01T00:00:00.000Z"),
          revokedBy: org.userId,
          revokedReason: "comprometido",
        }
      : {}),
  });
}

function makeEnv(options: { masterKey: boolean }): {
  env: Env;
  stored: Map<string, Uint8Array>;
} {
  const base = makeTestEnv();
  const stored = new Map<string, Uint8Array>();
  const certificates = base.CERTIFICATES_BUCKET;
  // The validated worker configuration requires the platform key, so a
  // deployment without one is the test environment as it is (no signing key).
  const signing = options.masterKey
    ? workerSigningEnv(
        loadWorkerConfig({
          DATABASE_URL: base.DATABASE_URL,
          R2_ENDPOINT: "http://s3.invalid:7070",
          R2_ACCESS_KEY_ID: "id",
          R2_SECRET_ACCESS_KEY: "secret",
          R2_BUCKET_NAME: "docs",
          R2_MEDIA_BUCKET_NAME: "media",
          SIGNING_MASTER_KEY: MASTER_KEY,
          INTEGRATIONS_MASTER_KEY: base.INTEGRATIONS_MASTER_KEY,
        }).signing,
      )
    : {};
  const env: Env = {
    ...base,
    GOTENBERG_URL,
    ...signing,
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

async function issue(env: Env, org: SeededOrg, jobId: number) {
  return processBackgroundJob(env, {
    type: "CERTIFICATE",
    jobId,
    userId: org.userId,
  });
}

beforeEach(async () => {
  await truncateAll();
  mocks.lapsed.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("an expired signing certificate fails closed (P0-8)", () => {
  it("REQ-P08-001 [HIGH RISK] a unit whose only certificate EXPIRED gets a rejected render: no unsigned PDF, no snapshot, the reason on the job", async () => {
    stubGotenberg();
    const { env, stored } = makeEnv({ masterKey: true });
    const { org, job } = await seedJob();
    await insertCertificate(org, { name: "A1 vencido", validUntil: LONG_AGO });

    await expect(issue(env, org, job.jobId)).rejects.toThrow(
      /expirado\/ausente/,
    );

    const after = await jobRow(job.jobId);
    expect(after.status).toBe("REJECTED");
    expect(String(after.rejectionReason)).toMatch(/expirado\/ausente/);
    expect(String(after.rejectionReason)).toMatch(/expirou em 01\/01\/2024/);
    expect(after.certificateUrl).toBeNull();
    expect(after.signatureMetadata).toBeNull();
    expect(stored.size).toBe(0);
    expect(await snapshotCount(job.jobId)).toBe(0);
  });

  it("REQ-P08-002: the lab's admins are told, once, with the reason the issuance was refused", async () => {
    stubGotenberg();
    const { env } = makeEnv({ masterKey: true });
    const { org, job } = await seedJob();
    await insertCertificate(org, { name: "A1 vencido", validUntil: LONG_AGO });

    await expect(issue(env, org, job.jobId)).rejects.toThrow();

    expect(mocks.lapsed).toHaveBeenCalledTimes(1);
    expect(mocks.lapsed.mock.calls[0]?.[0]).toBe(job.jobId);
    expect(mocks.lapsed.mock.calls[0]?.[1]).toMatch(
      /sem assinatura foi bloqueada/,
    );
  });

  it("REQ-P08-003 [HIGH RISK] a REVOKED certificate is the same: the unit signed before, so it never falls back to unsigned", async () => {
    stubGotenberg();
    const { env, stored } = makeEnv({ masterKey: true });
    const { org, job } = await seedJob();
    await insertCertificate(org, {
      name: "A1 revogado",
      isActive: false,
      isDefault: false,
      revoked: true,
    });

    await expect(issue(env, org, job.jobId)).rejects.toThrow(/revogado/);

    expect((await jobRow(job.jobId)).status).toBe("REJECTED");
    expect(stored.size).toBe(0);
    expect(await snapshotCount(job.jobId)).toBe(0);
  });

  it("REQ-P08-004: a unit that signed before is refused even when the lab does NOT require signatures", async () => {
    stubGotenberg();
    const { env } = makeEnv({ masterKey: true });
    const { org, job } = await seedJob();
    await db.execute(
      sql`UPDATE organization_unit SET require_signature = false WHERE id = ${org.unitId}`,
    );
    await insertCertificate(org, { name: "A1 vencido", validUntil: LONG_AGO });

    await expect(issue(env, org, job.jobId)).rejects.toThrow(
      /expirado\/ausente/,
    );
    expect((await jobRow(job.jobId)).status).toBe("REJECTED");
  });

  it("REQ-P08-005: a missing platform key is refused too once the unit has had a certificate", async () => {
    stubGotenberg();
    const { env, stored } = makeEnv({ masterKey: false });
    const { org, job } = await seedJob();
    await insertCertificate(org, { name: "A1 vencido", validUntil: LONG_AGO });

    await expect(issue(env, org, job.jobId)).rejects.toThrow(
      /chave de assinatura da plataforma/,
    );

    expect((await jobRow(job.jobId)).status).toBe("REJECTED");
    expect(stored.size).toBe(0);
    expect(mocks.lapsed).toHaveBeenCalledTimes(1);
  });

  it("REQ-P08-006 [HIGH RISK] a unit that NEVER had a certificate keeps issuing unsigned (unless it requires signatures), and nobody is alerted", async () => {
    stubGotenberg();
    const { env, stored } = makeEnv({ masterKey: true });
    const { org, job } = await seedJob();

    await issue(env, org, job.jobId);

    const after = await jobRow(job.jobId);
    expect(after.status).toBe("APPROVED");
    expect(after.signatureMetadata).toBeNull();
    expect(stored.size).toBe(1);
    expect(await snapshotCount(job.jobId)).toBe(1);
    expect(mocks.lapsed).not.toHaveBeenCalled();
  });

  it("REQ-P08-007: a unit that never had one and requires signatures still fails, without the lapsed alert", async () => {
    stubGotenberg();
    const { env } = makeEnv({ masterKey: true });
    const { org, job } = await seedJob();
    await db.execute(
      sql`UPDATE organization_unit SET require_signature = true WHERE id = ${org.unitId}`,
    );

    await expect(issue(env, org, job.jobId)).rejects.toThrow(
      /Assinatura obrigatória/,
    );

    expect((await jobRow(job.jobId)).status).toBe("REJECTED");
    expect(mocks.lapsed).not.toHaveBeenCalled();
  });

  it("REQ-P08-008: an expired certificate next to a valid default one signs normally (the history only matters when nothing is valid)", async () => {
    stubGotenberg();
    const { env } = makeEnv({ masterKey: true });
    const { org, job } = await seedJob();
    await insertCertificate(org, {
      name: "A1 antigo",
      validUntil: LONG_AGO,
      isDefault: false,
    });
    await insertCertificate(org, { name: "A1 novo" });

    await issue(env, org, job.jobId);

    const after = await jobRow(job.jobId);
    expect(after.status).toBe("APPROVED");
    expect(field(after.signatureMetadata, "signerName")).toBeTruthy();
    expect(mocks.lapsed).not.toHaveBeenCalled();
  });

  it("REQ-P08-009: another unit's expired certificate does not affect this unit (tenant and unit scope)", async () => {
    stubGotenberg();
    const { env } = makeEnv({ masterKey: true });
    const { org, job } = await seedJob();
    const other = await seedOrg({ orgId: "org-2", userId: "user-org-2" });
    await insertCertificate(other, {
      name: "A1 vencido de outro",
      validUntil: LONG_AGO,
    });

    await issue(env, org, job.jobId);

    expect((await jobRow(job.jobId)).status).toBe("APPROVED");
    expect(mocks.lapsed).not.toHaveBeenCalled();
  });
});
