/**
 * portal-calendar.int.spec.ts: GET /calendar and the `assetId` filter of GET /certificates,
 * against a real Postgres and the real portal middleware (only the portal session is mocked).
 *
 *   REQ-PCAL-1  the window is validated (date format, order, range cap) and the host must be
 *               recognized
 *   REQ-PCAL-2  the calendar lists the customer's calibration dues inside the window and nothing
 *               else: not another customer's assets, not dues outside it, not a customer linked
 *               to a different laboratory than the portal host
 *   REQ-PCAL-3  /certificates?assetId= scopes the list to that asset and rejects a non-number
 */
import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import {
  asset,
  assetType,
  organization,
  organizationCustomDomain,
  service,
} from "@calibra-facil/db/schema";
import { portalRouter } from "./portal";
import { insertJobs } from "../../../../test/integration/job-fixtures";
import { loginAsPortal } from "../../../../test/integration/setup";
import { truncateAll } from "../../../../test/integration/db";
import {
  seedPortalContext,
  seedPortalCustomer,
} from "../../../../test/integration/seed";
import { withStatusRepair } from "../../../../test/integration/state-fixtures";

const LOCAL_ORIGIN = { origin: "http://localhost" };
const WINDOW = "from=2026-06-01&to=2026-06-30";

async function seedFleet() {
  const ctx = await seedPortalContext();
  loginAsPortal({ userId: ctx.portalUserId, organizationId: ctx.clientOrgId });
  const [type] = await db
    .insert(assetType)
    .values({ name: "Paquímetro", slug: "paquimetro-cal", definition: [] })
    .returning({ id: assetType.id });
  const [serviceRow] = await db
    .insert(service)
    .values({
      organizationId: ctx.labOrgId,
      unitId: ctx.labUnitId,
      name: "Calibração",
      isActive: true,
    })
    .returning({ id: service.id });

  async function seedAsset(
    customerId: number,
    tag: string,
    nextCalibrationDate: Date,
  ) {
    const [row] = await withStatusRepair((tx) =>
      tx
        .insert(asset)
        .values({
          unitId: ctx.labUnitId,
          customerId,
          labOrganizationId: sql`(select "lab_organization_id" from "customer" where "id" = ${customerId})`,
          assetTypeId: type?.id ?? 0,
          name: `Instrumento ${tag}`,
          serialNumber: `SN-${tag}`,
          tag,
          status: "ACTIVE",
          nextCalibrationDate,
        })
        .returning({ id: asset.id }),
    );
    return row?.id ?? 0;
  }

  return { ctx, serviceId: serviceRow?.id ?? 0, seedAsset };
}

async function seedApprovedJob(
  fleet: Awaited<ReturnType<typeof seedFleet>>,
  assetId: number,
  jobId: string,
) {
  await insertJobs({
    jobId,
    certificateName: jobId,
    organizationId: fleet.ctx.labOrgId,
    unitId: fleet.ctx.labUnitId,
    customerId: fleet.ctx.customerId,
    assetId,
    serviceId: fleet.serviceId,
    createdBy: fleet.ctx.portalUserId,
    status: "APPROVED",
    approvedAt: new Date("2026-05-10T10:00:00.000Z"),
    performedAt: new Date("2026-05-10T10:00:00.000Z"),
    certificateUrl: `https://storage.example.test/certificates/${jobId}.pdf`,
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
  });
}

describe("portal GET /calendar", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("REQ-PCAL-1: refuses an unrecognized host and a malformed, inverted or oversized window", async () => {
    const { ctx } = await seedFleet();
    expect(ctx.customerId).toBeGreaterThan(0);

    const get = (query: string, headers?: Record<string, string>) =>
      portalRouter.request(`/calendar?${query}`, { headers });

    expect((await get(WINDOW)).status).toBe(403);
    expect(
      (await get("from=01-06-2026&to=2026-06-30", LOCAL_ORIGIN)).status,
    ).toBe(400);
    expect(
      (await get("from=2026-06-30&to=2026-06-01", LOCAL_ORIGIN)).status,
    ).toBe(400);
    expect(
      (await get("from=2026-01-01&to=2026-12-31", LOCAL_ORIGIN)).status,
    ).toBe(400);
  });

  it("REQ-PCAL-2: lists the customer's dues inside the window only", async () => {
    const fleet = await seedFleet();
    await fleet.seedAsset(
      fleet.ctx.customerId,
      "EQ-IN",
      new Date("2026-06-12T00:00:00.000Z"),
    );
    await fleet.seedAsset(
      fleet.ctx.customerId,
      "EQ-OUT",
      new Date("2026-08-01T00:00:00.000Z"),
    );
    // Another customer of the same laboratory, due inside the window: not ours.
    const otherCustomer = await seedPortalCustomer({
      labOrgId: fleet.ctx.labOrgId,
      clientOrgId: "portal-client-b",
      portalUserId: "portal-user-b",
      customerName: "Customer B",
    });
    await fleet.seedAsset(
      otherCustomer,
      "EQ-OTHER",
      new Date("2026-06-15T00:00:00.000Z"),
    );

    const res = await portalRouter.request(`/calendar?${WINDOW}`, {
      headers: LOCAL_ORIGIN,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.map((due: { tag: string }) => due.tag)).toEqual(["EQ-IN"]);
  });

  it("REQ-PCAL-2: answers an empty list for a customer linked to a different laboratory than the portal host", async () => {
    const fleet = await seedFleet();
    await fleet.seedAsset(
      fleet.ctx.customerId,
      "EQ-IN",
      new Date("2026-06-12T00:00:00.000Z"),
    );
    // The host belongs to another laboratory (verified, active custom domain).
    await withStatusRepair((tx) =>
      tx.insert(organization).values({
        id: "lab-other",
        name: "Outro laboratório",
        slug: "lab-other",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        type: "LAB",
        status: "ACTIVE",
      }),
    );
    await db.insert(organizationCustomDomain).values({
      id: "domain-other",
      organizationId: "lab-other",
      hostname: "portal.outro.example",
      verificationToken: "token",
      verifiedAt: new Date("2026-01-02T00:00:00.000Z"),
      isActive: true,
      createdBy: fleet.ctx.portalUserId,
    });

    const res = await portalRouter.request(`/calendar?${WINDOW}`, {
      headers: { origin: "https://portal.outro.example" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: [] });
  });
});

describe("portal GET /certificates assetId filter", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("REQ-PCAL-3: rejects a non-numeric assetId and scopes the list to the asked asset", async () => {
    const fleet = await seedFleet();
    const wanted = await fleet.seedAsset(
      fleet.ctx.customerId,
      "EQ-3",
      new Date("2026-09-01T00:00:00.000Z"),
    );
    const other = await fleet.seedAsset(
      fleet.ctx.customerId,
      "EQ-4",
      new Date("2026-09-01T00:00:00.000Z"),
    );
    await seedApprovedJob(fleet, wanted, "CAL-7");
    await seedApprovedJob(fleet, other, "CAL-8");

    const bad = await portalRouter.request("/certificates?assetId=abc", {
      headers: LOCAL_ORIGIN,
    });
    expect(bad.status).toBe(400);

    const all = await portalRouter.request("/certificates", {
      headers: LOCAL_ORIGIN,
    });
    expect(
      (await all.json()).data.map((row: { jobId: string }) => row.jobId).sort(),
    ).toEqual(["CAL-7", "CAL-8"]);

    const scoped = await portalRouter.request(
      `/certificates?assetId=${wanted}`,
      { headers: LOCAL_ORIGIN },
    );
    expect(scoped.status).toBe(200);
    const body = await scoped.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ assetId: wanted, jobId: "CAL-7" });
    expect(body.pagination.total).toBe(1);
  });
});
