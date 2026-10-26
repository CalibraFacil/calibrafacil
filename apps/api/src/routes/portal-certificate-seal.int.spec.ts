import { beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import {
  asset,
  assetType,
  certificateInput,
  organization,
} from "@calibra-facil/db/schema";
import { insertJobs } from "../../test/integration/job-fixtures";
import { loginAsPortal } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedPortalContext, seedService } from "../../test/integration/seed";
import { portalRouter } from "./portal";

// Q42: the accreditation seal (and the number printed with it) the portal shows for an
// ISSUED certificate is the decision FROZEN at approval (certificate_input), never
// re-decided from the lab's live accreditation fields. Same property as the public
// verification page (verify.int.spec.ts), on the customer-facing portal route. Real DB,
// real portal scoping; only the portal better-auth session is mocked.

const LOCAL_ORIGIN = { origin: "http://localhost" };
const APPROVED_AT = new Date("2026-03-01T12:00:00.000Z");

async function seedCertificate(options: {
  /** Whether the lab's LIVE fields would seal the certificate. */
  liveEligible: boolean;
  liveNumber?: string;
}) {
  const ctx = await seedPortalContext();
  const [type] = await db
    .insert(assetType)
    .values({ name: "Balança", slug: "balanca", definition: [] })
    .returning({ id: assetType.id });
  if (!type) throw new Error("asset type seed failed");
  const [ast] = await db
    .insert(asset)
    .values({
      labOrganizationId: sql`(select "lab_organization_id" from "customer" where "id" = ${ctx.customerId})`,
      unitId: ctx.labUnitId,
      customerId: ctx.customerId,
      assetTypeId: type.id,
      name: "Balança EQ-1",
      serialNumber: "SN-EQ-1",
      tag: "EQ-1",
      status: "ACTIVE",
    })
    .returning({ id: asset.id });
  if (!ast) throw new Error("asset seed failed");
  const serviceId = await seedService({
    organizationId: ctx.labOrgId,
    unitId: ctx.labUnitId,
    name: "Calibração",
  });
  await db
    .update(organization)
    .set({
      accreditationActive: options.liveEligible,
      accreditationNumber: options.liveNumber ?? "9999",
    })
    .where(eq(organization.id, ctx.labOrgId));
  const [job] = await insertJobs({
    jobId: "CAL-SEAL-1",
    organizationId: ctx.labOrgId,
    unitId: ctx.labUnitId,
    customerId: ctx.customerId,
    assetId: ast.id,
    serviceId,
    // The method is in scope: the live fields alone would seal this certificate.
    methodSnapshot: { accreditedScope: true },
    status: "APPROVED",
    createdBy: ctx.portalUserId,
    performedAt: APPROVED_AT,
    approvedAt: APPROVED_AT,
  });
  if (!job) throw new Error("job seed failed");
  return { ctx, jobRowId: job.id };
}

async function freeze(
  ctx: { labOrgId: string },
  jobRowId: number,
  input: {
    seal: { accredited: boolean; withheldReason?: string | null };
    accreditationNumber?: string;
  },
) {
  await db.insert(certificateInput).values({
    organizationId: ctx.labOrgId,
    jobId: jobRowId,
    schemaVersion: 1,
    input: {
      seal: { evaluatedAt: APPROVED_AT.toISOString(), ...input.seal },
      job: { lab: { accreditationNumber: input.accreditationNumber ?? null } },
    },
    sha256: "b".repeat(64),
    layoutKey: "calibration-certificate-fixed",
    layoutVersion: "1.0.0",
  });
}

async function accreditationSeenByPortal(
  ctx: { portalUserId: string; clientOrgId: string },
  jobRowId: number,
) {
  loginAsPortal({ userId: ctx.portalUserId, organizationId: ctx.clientOrgId });
  const res = await portalRouter.request(`/certificates/${jobRowId}`, {
    headers: LOCAL_ORIGIN,
  });
  expect(res.status).toBe(200);
  const body: unknown = await res.json();
  if (
    typeof body !== "object" ||
    body === null ||
    !("accreditation" in body) ||
    typeof body.accreditation !== "object" ||
    body.accreditation === null
  ) {
    throw new Error("unexpected portal certificate body");
  }
  return body.accreditation;
}

describe("portalRouter GET /certificates/:id — the seal is the frozen decision (Q42)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("REQ-SEAL-P01 [HIGH RISK]: a frozen 'no seal' (scope verdict) stays unsealed in the portal although the lab's live fields would seal it", async () => {
    const { ctx, jobRowId } = await seedCertificate({ liveEligible: true });
    await freeze(ctx, jobRowId, {
      seal: { accredited: false, withheldReason: "scope_out_of_scope" },
      accreditationNumber: "0123",
    });

    const accreditation = await accreditationSeenByPortal(ctx, jobRowId);

    expect(accreditation).toEqual({ accredited: false, number: null });
  });

  it("REQ-SEAL-P02 [HIGH RISK]: a frozen 'sealed' decision stays sealed after the lab switched its accreditation off", async () => {
    const { ctx, jobRowId } = await seedCertificate({ liveEligible: false });
    await freeze(ctx, jobRowId, {
      seal: { accredited: true },
      accreditationNumber: "0123",
    });

    const accreditation = await accreditationSeenByPortal(ctx, jobRowId);

    expect(accreditation).toMatchObject({ accredited: true });
  });

  it("REQ-SEAL-P03 [HIGH RISK]: the number shown is the one frozen with the certificate, not the lab's current one", async () => {
    const { ctx, jobRowId } = await seedCertificate({
      liveEligible: true,
      liveNumber: "9999",
    });
    await freeze(ctx, jobRowId, {
      seal: { accredited: true },
      accreditationNumber: "0123",
    });

    const accreditation = await accreditationSeenByPortal(ctx, jobRowId);

    expect(accreditation).toEqual({ accredited: true, number: "0123" });
  });

  it("REQ-SEAL-P04: a certificate approved before the input was frozen keeps the rule it was issued under, with the lab's number", async () => {
    const { ctx, jobRowId } = await seedCertificate({
      liveEligible: true,
      liveNumber: "9999",
    });

    const accreditation = await accreditationSeenByPortal(ctx, jobRowId);

    expect(accreditation).toEqual({ accredited: true, number: "9999" });
  });
});
