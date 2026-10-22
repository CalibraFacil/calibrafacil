import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { Env } from "@calibra-facil/worker";
import { db, truncateAll } from "../test/integration/db";
import { makeTestEnv } from "../test/integration/env";
import { seedOrg } from "../test/integration/seed";
import { seedIssuableJob } from "../test/integration/seed-certificate";
import { seedServiceOrder } from "../test/integration/seed-service-order";
import {
  daysFromNow,
  seedCompetence,
  seedScheduledOrg,
  seedUser,
} from "../test/integration/seed-scheduled";

/**
 * REQ-ORG-5 (worker): every tenant child / audit row the worker writes carries the
 * laboratory of the row it documents, written explicitly (VALUES with the
 * organization the worker already holds), so an audit row is never silently skipped.
 * Migration 0118, docs/architecture/tenancy.md.
 */

vi.mock("@calibra-facil/notifications", () => ({
  notifyCertificateReady: vi.fn(async () => undefined),
  notifyAuditPackReady: vi.fn(async () => undefined),
}));

import { processBackgroundJob } from "./index";
import { processScheduledNotifications } from "./scheduled";

const GOTENBERG_URL = "http://gotenberg.test";
const FAKE_PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);

function stubGotenberg() {
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : String(input);
    if (!url.startsWith(GOTENBERG_URL)) return realFetch(input, init);
    return new Response(FAKE_PDF_BYTES, { status: 200 });
  });
}

function rowsOf(result: unknown): unknown[] {
  if (result && typeof result === "object" && "rows" in result) {
    const inner = Reflect.get(result, "rows");
    return Array.isArray(inner) ? inner : [];
  }
  return Array.isArray(result) ? result : [];
}

function organizationsOf(result: unknown): Array<string | null> {
  return rowsOf(result).map((row) => {
    const value =
      row && typeof row === "object"
        ? Reflect.get(row, "organization_id")
        : null;
    return typeof value === "string" ? value : null;
  });
}

beforeEach(async () => {
  await truncateAll();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("REQ-ORG-5: the worker's tenant child and audit rows carry the lab organization", () => {
  it("REQ-ORG-5: issuing a certificate writes its job_audit_log row with the job's organization", async () => {
    const env: Env = { ...makeTestEnv(), GOTENBERG_URL };
    stubGotenberg();
    const org = await seedOrg({ orgId: "org-1", userId: "user-org-1" });
    const other = await seedOrg({ orgId: "org-2", userId: "user-org-2" });
    const job = await seedIssuableJob({
      organizationId: org.orgId,
      unitId: org.unitId,
      userId: org.userId,
    });

    await processBackgroundJob(env, {
      type: "CERTIFICATE",
      jobId: job.jobId,
      userId: org.userId,
    });

    const audit = organizationsOf(
      await db.execute(
        sql`SELECT organization_id FROM job_audit_log WHERE job_id = ${job.jobId} AND action = 'certificate_generated'`,
      ),
    );
    // Written, not skipped, and attributed to the job's laboratory.
    expect(audit).toEqual([org.orgId]);
    expect(audit).not.toContain(other.orgId);
  });

  it("REQ-ORG-5: a rejected issuance writes its certificate_error audit row with the job's organization", async () => {
    const env: Env = { ...makeTestEnv(), GOTENBERG_URL };
    stubGotenberg();
    const org = await seedOrg({ orgId: "org-1", userId: "user-org-1" });
    const job = await seedIssuableJob({
      organizationId: org.orgId,
      unitId: org.unitId,
      userId: org.userId,
      withoutReportedUncertainty: true,
    });

    await expect(
      processBackgroundJob(env, {
        type: "CERTIFICATE",
        jobId: job.jobId,
        userId: org.userId,
      }),
    ).rejects.toThrow();

    const audit = organizationsOf(
      await db.execute(
        sql`SELECT organization_id FROM job_audit_log WHERE job_id = ${job.jobId} AND action = 'certificate_error'`,
      ),
    );
    expect(audit).toEqual([org.orgId]);
  });

  it("REQ-ORG-5: the intake document and tag the worker creates (no pre-created row) carry the service order's organization", async () => {
    const env: Env = {
      ...makeTestEnv({ GOTENBERG_URL }),
    };
    stubGotenberg();
    const org = await seedOrg({ orgId: "org-1", userId: "user-org-1" });
    const so = await seedServiceOrder({
      organizationId: org.orgId,
      unitId: org.unitId,
      userId: org.userId,
      serviceOrderNumber: "OS-2026-0100",
      customerName: "Cliente",
      assetName: "Balanca",
    });

    await processBackgroundJob(env, {
      type: "SERVICE_ORDER_INTAKE_DOCUMENT",
      serviceOrderId: so.serviceOrderId,
      userId: org.userId,
    });
    await processBackgroundJob(env, {
      type: "SERVICE_ORDER_TAG",
      serviceOrderId: so.serviceOrderId,
      userId: org.userId,
    });

    expect(
      organizationsOf(
        await db.execute(
          sql`SELECT organization_id FROM service_order_intake_document WHERE service_order_id = ${so.serviceOrderId}`,
        ),
      ),
    ).toEqual([org.orgId]);
    expect(
      organizationsOf(
        await db.execute(
          sql`SELECT organization_id FROM service_order_tag WHERE service_order_id = ${so.serviceOrderId}`,
        ),
      ),
    ).toEqual([org.orgId]);
  });

  it("REQ-ORG-5: the competence auto-expire sweep writes its audit row with the competence's organization", async () => {
    const org = await seedScheduledOrg({ orgId: "org-1", userId: "owner-1" });
    await seedUser({ userId: "tech-1", name: "Tecnico Um" });
    const competenceId = await seedCompetence({
      organizationId: org.orgId,
      userId: "tech-1",
      status: "ACTIVE",
      expiresAt: daysFromNow(-3),
    });
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("DATABASE_URL is not set");

    await processScheduledNotifications({ DATABASE_URL: databaseUrl });

    expect(
      organizationsOf(
        await db.execute(
          sql`SELECT organization_id FROM personnel_competence_audit_log WHERE competence_id = ${competenceId} AND action = 'expire'`,
        ),
      ),
    ).toEqual([org.orgId]);
  });
});
