/**
 * dashboard-reports-contract.int.spec.ts: the cloud half of the dashboard,
 * consolidated-reports and certificate-numbering endpoint definitions
 * (`packages/contracts/src/endpoints/{dashboard,reports,certificate-numbering}.ts`).
 * Every client-facing endpoint is called for real (real handlers, real
 * middleware, real Postgres) and its body is parsed with the response schema of
 * its definition. `mount` also checks each body with that schema in the
 * integration tier (`checkEndpointResponses`), so a drift fails the request
 * itself; the explicit parse here names the drifting path and the status.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  certificateNumberingEndpoints,
  dashboardEndpoints,
  reportEndpoints,
} from "@calibra-facil/contracts";
import { db } from "@calibra-facil/db";
import {
  asset,
  assetType,
  referenceStandard,
  service,
} from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";
import { certificateNumberingRouter } from "../../jobs/routes/certificate-numbering";
import { dashboardRouter } from "./dashboard";
import { reportsRouter } from "./reports";
import { insertJobs } from "../../../../test/integration/job-fixtures";
import { loginAs } from "../../../../test/integration/setup";
import { truncateAll } from "../../../../test/integration/db";
import {
  seedCustomer,
  seedOrg,
  seedStandard,
} from "../../../../test/integration/seed";
import { withStatusRepair } from "../../../../test/integration/state-fixtures";

const JSON_HEADERS = { "content-type": "application/json" };

/** Parses with the definition's response schema; the issues name the drifting path on failure. */
async function parsedBody<TSchema extends z.ZodType>(
  response: Response,
  schema: TSchema,
): Promise<z.output<TSchema>> {
  const body: unknown = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(200);
  const result = schema.safeParse(body);
  expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  return schema.parse(body);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** A lab with an approved job and one in review (customer, asset, service) and a standard due within 30 days. */
async function seedLab() {
  const org = await seedOrg({ orgId: "org-dashboard-contract", role: "admin" });
  loginAs({ userId: org.userId, organizationId: org.orgId });
  const customerId = await seedCustomer({
    labOrganizationId: org.orgId,
    authOrganizationId: "client-dashboard-contract",
    name: "Cliente Painel",
  });
  const [type] = await db
    .insert(assetType)
    .values({ name: "Balança", slug: "balanca-dashboard", definition: [] })
    .returning({ id: assetType.id });
  const [assetRow] = await withStatusRepair((tx) =>
    tx
      .insert(asset)
      .values({
        unitId: org.unitId,
        customerId,
        labOrganizationId: org.orgId,
        assetTypeId: type?.id ?? 0,
        name: "Balança A",
        serialNumber: "SN-DASH",
        tag: "EQ-DASH",
        status: "ACTIVE",
      })
      .returning({ id: asset.id }),
  );
  const [serviceRow] = await db
    .insert(service)
    .values({
      organizationId: org.orgId,
      unitId: org.unitId,
      name: "Calibração",
      isActive: true,
    })
    .returning({ id: service.id });
  const decidedAt = new Date(Date.now() - 60 * 60 * 1000);
  const jobBase = {
    organizationId: org.orgId,
    unitId: org.unitId,
    customerId,
    assetId: assetRow?.id ?? 0,
    serviceId: serviceRow?.id ?? 0,
    createdBy: org.userId,
    dueDate: new Date(Date.now() + 3 * DAY_MS),
    methodSnapshot: {
      methodId: 1,
      methodName: "Erro de indicação",
      methodVersion: 1,
      dataFields: [],
      variableBindings: [],
      formulas: [],
      measurementModels: [],
      validations: [],
      uncertaintyParams: [],
    },
    results: {},
  };
  await insertJobs([
    {
      ...jobBase,
      jobId: "CAL-DASH-1",
      certificateName: "CAL-DASH-1",
      status: "APPROVED",
      approvedAt: decidedAt,
      performedAt: decidedAt,
    },
    {
      ...jobBase,
      jobId: "CAL-DASH-2",
      certificateName: "CAL-DASH-2",
      status: "REVIEW",
    },
  ]);
  const standardId = await seedStandard({
    organizationId: org.orgId,
    unitId: org.unitId,
    createdBy: org.userId,
  });
  await db
    .update(referenceStandard)
    .set({ nextCalibrationDate: new Date(Date.now() + 10 * DAY_MS) })
    .where(eq(referenceStandard.id, standardId));
  return org;
}

describe("dashboard endpoint: the real response honors the definition's response schema", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("getStats counts the seeded job and lists the standard due soon", async () => {
    await seedLab();

    const stats = await parsedBody(
      await dashboardRouter.request("/stats"),
      dashboardEndpoints.getStats.response,
    );

    expect(stats.approvedThisMonth).toBe(1);
    expect(stats.recentJobs.map((job) => job.jobId).sort()).toEqual([
      "CAL-DASH-1",
      "CAL-DASH-2",
    ]);
    expect(stats.reviewQueue.map((job) => job.jobId)).toEqual(["CAL-DASH-2"]);
    expect(stats.statusBreakdown).toEqual([{ status: "REVIEW", count: 1 }]);
    expect(stats.standardsWatchlist).toHaveLength(1);
  });
});

describe("reports endpoints: the real responses honor the definitions' response schemas", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("getExecutiveOverview, getComparison and getTrend", async () => {
    const org = await seedLab();

    const overview = await parsedBody(
      await reportsRouter.request(
        "/consolidated/executive-overview?period=90d",
      ),
      reportEndpoints.getExecutiveOverview.response,
    );
    expect(overview.metrics.approvedInPeriod).toBe(1);
    expect(overview.selectedUnits.map((unit) => unit.id)).toEqual([org.unitId]);

    const comparison = await parsedBody(
      await reportsRouter.request("/consolidated/comparison"),
      reportEndpoints.getComparison.response,
    );
    expect(comparison.rows.map((row) => row.unitId)).toEqual([org.unitId]);

    const trend = await parsedBody(
      await reportsRouter.request(
        `/consolidated/trend?period=30d&unitIds=${org.unitId}`,
      ),
      reportEndpoints.getTrend.response,
    );
    expect(trend.data.reduce((sum, day) => sum + day.approved, 0)).toBe(1);
  });

  it("answers the empty scope when the laboratory has no active unit selected", async () => {
    const org = await seedOrg({ orgId: "org-reports-empty", role: "admin" });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const trend = await parsedBody(
      await reportsRouter.request("/consolidated/trend"),
      reportEndpoints.getTrend.response,
    );
    expect(trend.data).toEqual([]);
  });
});

describe("certificate-numbering endpoints: the real responses honor the definitions' response schemas", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("getProfile answers the default profile, updateProfile the saved row, getProfile the saved one", async () => {
    const org = await seedOrg({
      orgId: "org-numbering-contract",
      role: "admin",
    });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const initial = await parsedBody(
      await certificateNumberingRouter.request("/"),
      certificateNumberingEndpoints.getProfile.response,
    );
    expect(initial.profile.id).toBeNull();

    const saved = await parsedBody(
      await certificateNumberingRouter.request("/", {
        method: "PUT",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          name: "Padrao",
          config: {
            labCode: "LAB",
            projectCode: null,
            numberTemplate: "{labCode}-{yyyy}-{seq}",
            certificateNameTemplate: "Certificado {number}",
            sequence: {
              resetScope: "year",
              startAt: 1,
              increment: 1,
              padding: 4,
            },
          },
        }),
      }),
      certificateNumberingEndpoints.updateProfile.response,
    );
    expect(saved.profile.config.labCode).toBe("LAB");

    const reloaded = await parsedBody(
      await certificateNumberingRouter.request("/"),
      certificateNumberingEndpoints.getProfile.response,
    );
    expect(reloaded.profile.id).toBe(saved.profile.id);
    expect(reloaded.example.number).toMatch(/^LAB-/);
  });
});
