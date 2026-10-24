import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { unzipSync } from "fflate";
import type { Env } from "@calibra-facil/jobs-core";
import { db, truncateAll } from "../test/integration/db";
import {
  asString,
  envAsApplicationRole,
  field,
  toRows,
} from "../test/integration/application-role";
import { seedOrg } from "../test/integration/seed";
import {
  seedApprovedCertificate,
  seedAuditPackExport,
  seedPortalCustomer,
} from "../test/integration/seed-audit-pack";

/**
 * The audit-pack worker as `calibra_app` (P2-18j). The message names an export,
 * not its laboratory: the laboratory is learnt with one lookup on the owner
 * connection (`DATABASE_OWNER_URL`), then every statement runs in a transaction
 * that names it, and none spans the R2 downloads, Gotenberg or the zip.
 *
 *   REQ-WRLS-AP-1  the pack of laboratory A holds ONLY laboratory A's certificates, as calibra_app
 *   REQ-WRLS-AP-2  laboratory B's export and certificate are untouched
 *   REQ-WRLS-AP-3  a failing pack is recorded FAILED in its own laboratory (the failure path names it too)
 *   REQ-WRLS-AP-4  without the owner connection under enforced RLS the lookup fails loudly: the export
 *                  stays PENDING (never FAILED on a lie), and an export that does not exist rethrows as before
 */

vi.mock("@calibra-facil/notifications", () => ({
  notifyCertificateReady: vi.fn(async () => undefined),
  notifyAuditPackReady: vi.fn(async () => undefined),
}));

import { processBackgroundJob } from "@calibra-facil/jobs-core";

const FAKE_PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);

async function exportRow(exportId: number) {
  const row = toRows(
    await db.execute(
      sql`SELECT status, certificate_count, failure_reason, r2_key
          FROM portal_export_job WHERE id = ${exportId}`,
    ),
  )[0];
  return {
    status: asString(field(row, "status")),
    certificateCount: field(row, "certificate_count"),
    failureReason: field(row, "failure_reason"),
    r2Key: field(row, "r2_key"),
  };
}

function recordingEnv(base: Env): { env: Env; puts: Map<string, Uint8Array> } {
  const puts = new Map<string, Uint8Array>();
  const certificates = base.CERTIFICATES_BUCKET;
  return {
    puts,
    env: {
      ...base,
      CERTIFICATES_BUCKET: {
        get: (key) => certificates.get(key),
        put: (key, body, options) => {
          puts.set(
            key,
            body instanceof Uint8Array ? body : new Uint8Array(body),
          );
          return certificates.put(key, body, options);
        },
      },
    },
  };
}

async function seedTwoLabs(
  include = { certificates: true, fleetReport: false, verificationIndex: true },
) {
  const orgA = await seedOrg({ orgId: "org-A", userId: "user-A" });
  const orgB = await seedOrg({ orgId: "org-B", userId: "user-B" });
  const customerA = await seedPortalCustomer({ organizationId: orgA.orgId });
  const customerB = await seedPortalCustomer({ organizationId: orgB.orgId });
  const certA = await seedApprovedCertificate({
    organizationId: orgA.orgId,
    unitId: orgA.unitId,
    userId: orgA.userId,
    customerId: customerA.customerId,
    jobNumber: "CAL-A-0001",
  });
  const certB = await seedApprovedCertificate({
    organizationId: orgB.orgId,
    unitId: orgB.unitId,
    userId: orgB.userId,
    customerId: customerB.customerId,
    jobNumber: "CAL-B-0001",
  });
  const exportA = await seedAuditPackExport({
    organizationId: orgA.orgId,
    userId: orgA.userId,
    customerIds: [customerA.customerId],
    include,
  });
  const exportB = await seedAuditPackExport({
    organizationId: orgB.orgId,
    userId: orgB.userId,
    customerIds: [customerB.customerId],
    include,
  });
  return { orgA, orgB, certA, certB, exportA, exportB };
}

beforeEach(async () => {
  await truncateAll();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("audit pack worker as calibra_app (P2-18j)", () => {
  it("REQ-WRLS-AP-1 REQ-WRLS-AP-2 [HIGH RISK] the pack holds only its own laboratory's certificates; the other laboratory is untouched", async () => {
    const lab = await seedTwoLabs();
    const { env, puts } = recordingEnv(envAsApplicationRole());
    for (const cert of [lab.certA, lab.certB]) {
      await env.CERTIFICATES_BUCKET.put(cert.certificateR2Key, FAKE_PDF_BYTES, {
        httpMetadata: { contentType: "application/pdf" },
      });
    }
    puts.clear();

    await processBackgroundJob(env, {
      type: "AUDIT_PACK",
      exportId: lab.exportA.exportId,
      userId: lab.orgA.userId,
    });

    const after = await exportRow(lab.exportA.exportId);
    expect(after.status).toBe("COMPLETED");
    expect(after.certificateCount).toBe(1);
    const zipEntry = [...puts].find(([key]) => key.endsWith(".zip"));
    if (!zipEntry) throw new Error("no ZIP was written");
    expect(zipEntry[0]).toContain(`${lab.orgA.orgId}/portal-exports/`);
    const names = Object.keys(unzipSync(zipEntry[1])).join("\n");
    expect(names).toContain("CAL-A-0001");
    expect(names).not.toContain("CAL-B-0001");

    // Laboratory B: still pending, nothing written.
    const untouched = await exportRow(lab.exportB.exportId);
    expect(untouched.status).toBe("PENDING");
    expect(untouched.r2Key).toBeNull();
    expect(untouched.certificateCount).toBeNull();
  });

  it("REQ-WRLS-AP-3 a failing pack is recorded FAILED in its own laboratory", async () => {
    // The fleet report renders through Gotenberg, which this env does not have.
    const lab = await seedTwoLabs({
      certificates: false,
      fleetReport: true,
      verificationIndex: false,
    });

    await expect(
      processBackgroundJob(envAsApplicationRole(), {
        type: "AUDIT_PACK",
        exportId: lab.exportA.exportId,
        userId: lab.orgA.userId,
      }),
    ).rejects.toThrow(/GOTENBERG_URL/);

    const failed = await exportRow(lab.exportA.exportId);
    expect(failed.status).toBe("FAILED");
    expect(asString(failed.failureReason)).toContain("GOTENBERG_URL");
    expect((await exportRow(lab.exportB.exportId)).status).toBe("PENDING");
  });

  it("REQ-WRLS-AP-4 [HIGH RISK] without the owner connection under enforced RLS the lookup fails loudly and the export stays PENDING; an unknown export rethrows", async () => {
    const lab = await seedTwoLabs();

    await expect(
      processBackgroundJob(envAsApplicationRole({ withOwnerUrl: false }), {
        type: "AUDIT_PACK",
        exportId: lab.exportA.exportId,
        userId: lab.orgA.userId,
      }),
    ).rejects.toThrow(/DATABASE_OWNER_URL/);
    expect((await exportRow(lab.exportA.exportId)).status).toBe("PENDING");

    await expect(
      processBackgroundJob(envAsApplicationRole(), {
        type: "AUDIT_PACK",
        exportId: 999_999,
        userId: lab.orgA.userId,
      }),
    ).rejects.toThrow("Audit pack export not found");
  });
});
