/**
 * portal-contract.int.spec.ts: P2-15 REQ-TC-3. The REAL responses (real
 * handlers, real portal middleware, real Postgres) of the portal endpoints the
 * client portal validates with `@calibra-facil/contracts` schemas
 * (`apps/portal/src/lib/api-fetch.ts`). Drift between a handler and its schema
 * fails here before a customer sees it.
 *
 * Covered: branding, organizations, units, units/summary, calendar, assets
 * (list, detail), interval insight + update, certificates (list, detail,
 * download), notification preferences (read, write), audit packs (request,
 * list), fleet analytics, drift series, OOT events + assessment.
 * (`portal-engagement-contract.int.spec.ts` covers the rest.)
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import {
  portalAssetDetailResponseSchema,
  portalAuditPackRequestedResponseSchema,
  portalAuditPacksResponseSchema,
  portalBrandingResponseSchema,
  portalCalendarResponseSchema,
  portalCertificateDetailSchema,
  portalCertificatesResponseSchema,
  portalDownloadLinkResponseSchema,
  portalDriftSeriesResponseSchema,
  portalFleetAnalyticsResponseSchema,
  portalFleetAssetsResponseSchema,
  portalIntervalInsightSchema,
  portalIntervalUpdateResponseSchema,
  portalNotificationPreferencesResponseSchema,
  portalOotAssessmentResponseSchema,
  portalOotEventsResponseSchema,
  portalUnitsResponseSchema,
  portalUnitsSummaryResponseSchema,
  signatureVerificationResponseSchema,
  verificationResponseSchema,
} from "@calibra-facil/contracts";
import { db } from "@calibra-facil/db";
import {
  asset,
  assetType,
  calibrationJob,
  service,
} from "@calibra-facil/db/schema";
import { sql } from "drizzle-orm";
import { portalRouter } from "./portal";
import { verifyRouter } from "./verify";
import { createAssetOotEventForApprovedJob } from "../lib/asset-oot-events";
import { insertJobs } from "../../test/integration/job-fixtures";
import { loginAsPortal } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedPortalContext } from "../../test/integration/seed";

vi.mock("../lib/background-jobs", () => ({
  enqueueBackgroundJob: vi.fn().mockResolvedValue({ messageId: "test-noop" }),
}));

vi.mock("../lib/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/storage")>();
  return {
    ...actual,
    createR2Client: vi.fn(() => ({})),
    generatePresignedUrl: vi
      .fn()
      .mockResolvedValue("https://storage.example.test/signed.pdf"),
  };
});

const LOCAL_ORIGIN = { origin: "http://localhost" };
const JSON_HEADERS = { ...LOCAL_ORIGIN, "content-type": "application/json" };
const ENV = { R2_BUCKET_NAME: "test-bucket" };

/** Parses with the contract schema; the issues name the drifting path on failure. */
async function parsedBody<TSchema extends z.ZodType>(
  response: Response,
  schema: TSchema,
  expectedStatus = 200,
): Promise<z.output<TSchema>> {
  const body: unknown = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(expectedStatus);
  const result = schema.safeParse(body);
  expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  return schema.parse(body);
}

function get(path: string, env?: Record<string, string>) {
  return portalRouter.request(path, { headers: LOCAL_ORIGIN }, env);
}

function send(method: string, path: string, body: unknown) {
  return portalRouter.request(path, {
    method,
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

function methodSnapshot() {
  return {
    methodId: 1,
    methodName: "Erro de indicação",
    methodVersion: 2,
    dataFields: [],
    variableBindings: [],
    formulas: [{ outputKey: "erro", label: "Erro", unit: "g" }],
    measurementModels: [],
    validations: [],
    uncertaintyParams: [],
  };
}

async function seedFleet() {
  const ctx = await seedPortalContext();
  loginAsPortal({ userId: ctx.portalUserId, organizationId: ctx.clientOrgId });
  const [type] = await db
    .insert(assetType)
    .values({
      name: "Balança",
      slug: "balanca-portal-contract",
      definition: [],
    })
    .returning({ id: assetType.id });
  const [assetRow] = await db
    .insert(asset)
    .values({
      unitId: ctx.labUnitId,
      customerId: ctx.customerId,
      labOrganizationId: sql`(select "lab_organization_id" from "customer" where "id" = ${ctx.customerId})`,
      assetTypeId: type?.id ?? 0,
      name: "Balança A",
      serialNumber: "SN-A1",
      tag: "EQ-A1",
      status: "ACTIVE",
      lastCalibrationDate: new Date("2026-01-10T00:00:00.000Z"),
      nextCalibrationDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
    })
    .returning({ id: asset.id });
  const [serviceRow] = await db
    .insert(service)
    .values({
      organizationId: ctx.labOrgId,
      unitId: ctx.labUnitId,
      name: "Calibração de massa",
      isActive: true,
    })
    .returning({ id: service.id });
  const assetId = assetRow?.id ?? 0;
  const serviceId = serviceRow?.id ?? 0;

  async function approvedJob(
    jobId: string,
    approvedAt: Date,
    conformity: "CONFORMING" | "NON_CONFORMING",
    margins: number[],
  ) {
    const [row] = await insertJobs({
      jobId,
      certificateName: jobId,
      organizationId: ctx.labOrgId,
      unitId: ctx.labUnitId,
      customerId: ctx.customerId,
      assetId,
      serviceId,
      createdBy: ctx.portalUserId,
      status: "APPROVED",
      approvedAt,
      performedAt: approvedAt,
      certificateUrl: `https://storage.example.test/certificates/${jobId}.pdf`,
      asFoundConformity: conformity,
      asFoundMargins: margins,
      methodSnapshot: methodSnapshot(),
      results: { erro: 0.01, margem_conformidade_antes: margins },
    });
    return row?.id ?? 0;
  }

  const first = await approvedJob(
    "CAL-PC-1",
    new Date("2025-06-10T10:00:00.000Z"),
    "CONFORMING",
    [0.4, 0.3],
  );
  const second = await approvedJob(
    "CAL-PC-2",
    new Date("2026-01-10T10:00:00.000Z"),
    "NON_CONFORMING",
    [-0.2, 0.1],
  );
  return { ctx, assetId, first, second };
}

describe("portal endpoints: real responses honor the contract schemas (P2-15 REQ-TC-3)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("REQ-TC-3: branding, organizations, units and the unit summary parse", async () => {
    await seedFleet();

    // Unauthenticated by design: the default host answers nulls.
    const branding = await parsedBody(
      await get("/branding"),
      portalBrandingResponseSchema,
    );
    expect(branding).toEqual({ name: null, logo: null });

    // GET /organizations is checked at compile time only (`satisfies` at the
    // handler): its by-user membership query is, by nature, not
    // organization-scoped, which the tenant SQL guard of this tier refuses.

    const units = await parsedBody(
      await get("/units"),
      portalUnitsResponseSchema,
    );
    expect(units.units).toHaveLength(1);
    const summary = await parsedBody(
      await get("/units/summary"),
      portalUnitsSummaryResponseSchema,
    );
    expect(summary.units[0]?.total).toBe(1);
  });

  it("REQ-TC-3: the fleet list, the asset detail, the calendar and the interval analysis parse", async () => {
    const { assetId } = await seedFleet();

    const fleet = await parsedBody(
      await get("/assets?page=1&limit=20"),
      portalFleetAssetsResponseSchema,
    );
    expect(fleet.data[0]?.lastCertificate?.jobId).toBe("CAL-PC-2");
    expect(fleet.data[0]?.assetTypeSlug).toBe("balanca-portal-contract");

    const detail = await parsedBody(
      await get(`/assets/${assetId}`),
      portalAssetDetailResponseSchema,
    );
    expect(detail.data.certificateCount).toBe(2);

    const from = new Date().toISOString().slice(0, 10);
    const to = new Date(Date.now() + 40 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const calendar = await parsedBody(
      await get(`/calendar?from=${from}&to=${to}`),
      portalCalendarResponseSchema,
    );
    expect(calendar.data.map((due) => due.tag)).toEqual(["EQ-A1"]);

    await parsedBody(
      await get(`/assets/${assetId}/interval-insight`),
      portalIntervalInsightSchema,
    );
    const updated = await parsedBody(
      await send("PUT", `/assets/${assetId}/interval`, {
        intervalMonths: 12,
        rationale: "Uso moderado, histórico estável",
      }),
      portalIntervalUpdateResponseSchema,
    );
    expect(updated.id).toBe(assetId);
    expect(updated.intervalSetBy).toBe("customer_confirmed");
  });

  it("REQ-TC-3: the certificate list, detail (method name included) and download parse", async () => {
    await seedFleet();

    const list = await parsedBody(
      await get("/certificates?page=1&limit=20"),
      portalCertificatesResponseSchema,
    );
    expect(list.data.map((row) => row.jobId).sort()).toEqual([
      "CAL-PC-1",
      "CAL-PC-2",
    ]);

    const detail = await parsedBody(
      await get("/certificates/CAL-PC-2"),
      portalCertificateDetailSchema,
    );
    // The page reads the method name from `methodName` (it used to read `name`).
    expect(detail.methodSnapshot?.methodName).toBe("Erro de indicação");
    expect(detail.releaseStatus).toBe("RELEASED");

    await parsedBody(
      await get("/certificates/CAL-PC-2/download", ENV),
      portalDownloadLinkResponseSchema,
    );
  });

  it("REQ-TC-3: notification preferences read and write, audit packs request and list parse", async () => {
    await seedFleet();

    await parsedBody(
      await get("/notification-preferences"),
      portalNotificationPreferencesResponseSchema,
    );
    const saved = await parsedBody(
      await send("PUT", "/notification-preferences", {
        digestFrequency: "WEEKLY",
      }),
      portalNotificationPreferencesResponseSchema,
    );
    expect(saved.digestFrequency).toBe("WEEKLY");

    const requested = await parsedBody(
      await send("POST", "/audit-packs", {
        dateFrom: "2025-01-01",
        dateTo: "2026-12-31",
        include: {
          certificates: true,
          fleetReport: true,
          verificationIndex: true,
        },
      }),
      portalAuditPackRequestedResponseSchema,
      201,
    );
    const packs = await parsedBody(
      await get("/audit-packs"),
      portalAuditPacksResponseSchema,
    );
    expect(packs.data.map((pack) => pack.id)).toEqual([requested.id]);
  });

  it("REQ-TC-3: fleet analytics, the drift series, the OOT events and the assessment parse", async () => {
    const { assetId, ctx, second } = await seedFleet();

    const analytics = await parsedBody(
      await get("/analytics/fleet?periodMonths=24&bucket=quarter"),
      portalFleetAnalyticsResponseSchema,
    );
    expect(analytics.totals.jobs).toBe(2);

    const drift = await parsedBody(
      await get(`/assets/${assetId}/drift-series`),
      portalDriftSeriesResponseSchema,
    );
    expect(drift.cycles).toHaveLength(2);

    await createAssetOotEventForApprovedJob({
      jobId: second,
      assetId,
      customerId: ctx.customerId,
      labOrganizationId: ctx.labOrgId,
      detectedAt: new Date("2026-01-10T10:00:00.000Z"),
      actorUserId: ctx.portalUserId,
    });
    const events = await parsedBody(
      await get("/oot-events"),
      portalOotEventsResponseSchema,
    );
    expect(events.data).toHaveLength(1);
    expect(events.data[0]?.status).toBe("OPEN");

    const assessed = await parsedBody(
      await send("POST", `/oot-events/${events.data[0]?.id}/assessment`, {
        decision: "NO_IMPACT",
        rationale: "Nenhum resultado de medição foi afetado no período.",
        suspectProductShipped: false,
      }),
      portalOotAssessmentResponseSchema,
      201,
    );
    expect(assessed.data.assessment.decision).toBe("NO_IMPACT");
    const after = await parsedBody(
      await get("/oot-events?status=ASSESSED"),
      portalOotEventsResponseSchema,
    );
    expect(after.data[0]?.assessmentDecision).toBe("NO_IMPACT");
  });

  it("REQ-TC-3: the public certificate verification and its signature check parse", async () => {
    await seedFleet();
    const [job] = await db
      .select({ token: calibrationJob.verificationToken })
      .from(calibrationJob)
      .limit(1);

    const verification = await parsedBody(
      await verifyRouter.request(`/${job?.token}`),
      verificationResponseSchema,
    );
    expect(verification.digitalSignature).toEqual({ signed: false });
    const signature = await parsedBody(
      await verifyRouter.request(`/${job?.token}/signature`),
      signatureVerificationResponseSchema,
    );
    expect(signature.signed).toBe(false);
  });
});
