/**
 * certificate-lifecycle-surfaces.int.spec.ts: the certificate lifecycle as the
 * customer portal and the public API v2 report it over HTTP (roadmap 2 B3;
 * ISO/IEC 17025 §7.8.8, §7.10). Real Postgres; only the portal session is mocked.
 *
 *   REQ-B3-S1  portal list and detail: ISSUED (with an amendment in progress),
 *              WITHDRAWN (with its date) and SUPERSEDED
 *   REQ-B3-S2  public API v2 list and detail: the same three states
 *   REQ-B3-S3  withdrawing another laboratory's certificate over HTTP is a 404
 *              and writes nothing
 *   REQ-B3-S4  row-level security hides one laboratory's status events from another
 */

import { and, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@calibra-facil/db";
import { forOrg } from "@calibra-facil/db/for-org";
import {
  asset,
  assetType,
  issuedCertificateSnapshot,
  issuedCertificateStatusEvent,
  organizationApiKey,
} from "@calibra-facil/db/schema";
import { insertJobs } from "../../test/integration/job-fixtures";
import { truncateAll } from "../../test/integration/db";
import { openAppRoleDb } from "../../test/integration/rls";
import {
  seedOrg,
  seedPortalContext,
  seedService,
} from "../../test/integration/seed";
import { loginAs, loginAsPortal } from "../../test/integration/setup";
import { createApiKeySecret } from "../lib/api-keys";
import { jobsRouter } from "./jobs";
import { portalRouter } from "./portal";
import { publicApiV2Router } from "./public-api-v2";

vi.mock("../lib/background-jobs", () => ({
  enqueueBackgroundJob: vi.fn().mockResolvedValue({ messageId: "test-noop" }),
}));

vi.mock("@calibra-facil/notifications", () => ({
  notifyJobSubmittedForReview: vi.fn().mockResolvedValue(undefined),
  notifyJobApproved: vi.fn().mockResolvedValue(undefined),
  notifyJobRejected: vi.fn().mockResolvedValue(undefined),
  notifyJobAssigned: vi.fn().mockResolvedValue(undefined),
  notifyCertificateAmended: vi.fn().mockResolvedValue(undefined),
}));

const LOCAL_ORIGIN = { origin: "http://localhost" };
const APPROVED_AT = new Date("2026-03-01T12:00:00.000Z");
const WITHDRAWN_AT = new Date("2026-04-02T09:30:00.000Z");
const JSON_HEADERS = { "content-type": "application/json" };

type Seeded = Awaited<ReturnType<typeof seedWorld>>;

/**
 * One lab, one portal customer and three issued certificates, one per
 * lifecycle state, each with the events the worker / withdraw command write.
 */
async function seedWorld() {
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

  const base = {
    organizationId: ctx.labOrgId,
    unitId: ctx.labUnitId,
    customerId: ctx.customerId,
    assetId: ast.id,
    serviceId,
    methodSnapshot: { accreditedScope: false },
    createdBy: ctx.portalUserId,
    performedAt: APPROVED_AT,
    approvedAt: APPROVED_AT,
  };
  const issue = async (jobRowId: number, jobNumber: string) => {
    const [snapshot] = await db
      .insert(issuedCertificateSnapshot)
      .values({
        organizationId: ctx.labOrgId,
        jobId: jobRowId,
        certificateNumber: jobNumber,
        pdfR2Key: `org/${ctx.labOrgId}/${jobNumber}.pdf`,
        pdfSha256: "a".repeat(64),
        inputDataSnapshot: {},
        renderPipeline: "FIXED_LAYOUT",
      })
      .returning({ id: issuedCertificateSnapshot.id });
    if (!snapshot) throw new Error("snapshot seed failed");
    await db.insert(issuedCertificateStatusEvent).values({
      organizationId: ctx.labOrgId,
      certificateId: snapshot.id,
      jobId: jobRowId,
      event: "ISSUED",
      source: "worker",
      occurredAt: APPROVED_AT,
    });
    return snapshot.id;
  };

  // ISSUED, with an amendment in progress (a DRAFT clone).
  const [issued] = await insertJobs({
    ...base,
    jobId: "CAL-ISSUED",
    status: "APPROVED",
  });
  if (!issued) throw new Error("job seed failed");
  await issue(issued.id, "CAL-ISSUED");
  await insertJobs({
    ...base,
    jobId: "CAL-ISSUED-R1",
    status: "DRAFT",
    approvedAt: null,
    supersedesId: issued.id,
    amendmentNumber: 1,
    amendmentReason: "Correcao em andamento",
  });

  // WITHDRAWN.
  const [withdrawn] = await insertJobs({
    ...base,
    jobId: "CAL-WITHDRAWN",
    status: "APPROVED",
  });
  if (!withdrawn) throw new Error("job seed failed");
  const withdrawnCertificateId = await issue(withdrawn.id, "CAL-WITHDRAWN");
  await db.insert(issuedCertificateStatusEvent).values({
    organizationId: ctx.labOrgId,
    certificateId: withdrawnCertificateId,
    jobId: withdrawn.id,
    event: "WITHDRAWN",
    reason: "Padrao de referencia recolhido",
    source: "api",
    occurredAt: WITHDRAWN_AT,
  });

  // SUPERSEDED by an issued amendment.
  const [replacement] = await insertJobs({
    ...base,
    jobId: "CAL-SUPERSEDED-R1",
    status: "APPROVED",
  });
  if (!replacement) throw new Error("job seed failed");
  await issue(replacement.id, "CAL-SUPERSEDED-R1");
  const [superseded] = await insertJobs({
    ...base,
    jobId: "CAL-SUPERSEDED",
    status: "SUPERSEDED",
    supersededById: replacement.id,
    supersededAt: new Date("2026-03-20T00:00:00.000Z"),
    amendmentReason: "Erro de digitacao",
  });
  if (!superseded) throw new Error("job seed failed");
  const supersededCertificateId = await issue(superseded.id, "CAL-SUPERSEDED");
  await db.insert(issuedCertificateStatusEvent).values({
    organizationId: ctx.labOrgId,
    certificateId: supersededCertificateId,
    jobId: superseded.id,
    event: "SUPERSEDED",
    supersededByJobId: replacement.id,
    source: "worker",
  });

  return {
    ctx,
    ids: {
      issued: issued.id,
      withdrawn: withdrawn.id,
      superseded: superseded.id,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function rowsOf(body: unknown): Record<string, unknown>[] {
  if (!isRecord(body) || !Array.isArray(body.data)) {
    throw new Error("unexpected list body");
  }
  return body.data.filter(isRecord);
}

/** The lifecycle fields of every row of a list, by certificate number. */
function lifecycleByNumber(rows: Record<string, unknown>[]) {
  return Object.fromEntries(
    rows.map((row) => [
      String(row.jobId),
      { status: row.certificateStatus, withdrawnAt: row.withdrawnAt },
    ]),
  );
}

async function seedApiKey(world: Seeded) {
  const { key, keyPrefix, keyHash } = createApiKeySecret();
  await db.insert(organizationApiKey).values({
    id: "key-b3",
    organizationId: world.ctx.labOrgId,
    name: "B3 key",
    keyPrefix,
    keyHash,
    scopes: ["certificates:read"],
    createdBy: world.ctx.portalUserId,
  });
  return key;
}

describe("certificate lifecycle over HTTP", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("REQ-B3-S1 [HIGH RISK]: the portal list reports ISSUED (amendment in progress), WITHDRAWN with its date, and SUPERSEDED", async () => {
    const { ctx } = await seedWorld();
    loginAsPortal({
      userId: ctx.portalUserId,
      organizationId: ctx.clientOrgId,
    });

    const res = await portalRouter.request("/certificates", {
      headers: LOCAL_ORIGIN,
    });

    expect(res.status).toBe(200);
    const byNumber = lifecycleByNumber(rowsOf(await res.json()));
    expect(byNumber["CAL-ISSUED"]).toEqual({
      status: "ISSUED",
      withdrawnAt: null,
    });
    expect(byNumber["CAL-WITHDRAWN"]).toEqual({
      status: "WITHDRAWN",
      withdrawnAt: WITHDRAWN_AT.toISOString(),
    });
    expect(byNumber["CAL-SUPERSEDED"]).toEqual({
      status: "SUPERSEDED",
      withdrawnAt: null,
    });
  });

  it("REQ-B3-S1 [HIGH RISK]: the portal detail reports the same three states", async () => {
    const { ctx, ids } = await seedWorld();
    loginAsPortal({
      userId: ctx.portalUserId,
      organizationId: ctx.clientOrgId,
    });
    const detail = async (id: number) => {
      const res = await portalRouter.request(`/certificates/${id}`, {
        headers: LOCAL_ORIGIN,
      });
      expect(res.status).toBe(200);
      return res.json();
    };

    expect(await detail(ids.issued)).toMatchObject({
      certificateStatus: "ISSUED",
      withdrawnAt: null,
    });
    expect(await detail(ids.withdrawn)).toMatchObject({
      certificateStatus: "WITHDRAWN",
      withdrawnAt: WITHDRAWN_AT.toISOString(),
    });
    expect(await detail(ids.superseded)).toMatchObject({
      certificateStatus: "SUPERSEDED",
      withdrawnAt: null,
    });
  });

  it("REQ-B3-S2 [HIGH RISK]: the public API v2 list reports ISSUED (amendment in progress), WITHDRAWN with its date, and SUPERSEDED", async () => {
    const world = await seedWorld();
    const key = await seedApiKey(world);

    const res = await publicApiV2Router.request("/certificates", {
      headers: { "x-api-key": key },
    });

    expect(res.status).toBe(200);
    const byNumber = lifecycleByNumber(rowsOf(await res.json()));
    expect(byNumber["CAL-ISSUED"]).toEqual({
      status: "ISSUED",
      withdrawnAt: null,
    });
    expect(byNumber["CAL-WITHDRAWN"]).toEqual({
      status: "WITHDRAWN",
      withdrawnAt: WITHDRAWN_AT.toISOString(),
    });
    expect(byNumber["CAL-SUPERSEDED"]).toEqual({
      status: "SUPERSEDED",
      withdrawnAt: null,
    });
  });

  it("REQ-B3-S2 [HIGH RISK]: the public API v2 detail reports the same three states, and never leaks the internal link", async () => {
    const world = await seedWorld();
    const key = await seedApiKey(world);
    const detail = async (jobNumber: string) => {
      const res = await publicApiV2Router.request(
        `/certificates/${jobNumber}`,
        {
          headers: { "x-api-key": key },
        },
      );
      expect(res.status).toBe(200);
      const body: unknown = await res.json();
      if (!isRecord(body) || !isRecord(body.data)) throw new Error("bad body");
      return body.data;
    };

    expect(await detail("CAL-ISSUED")).toMatchObject({
      certificateStatus: "ISSUED",
      withdrawnAt: null,
    });
    expect(await detail("CAL-WITHDRAWN")).toMatchObject({
      certificateStatus: "WITHDRAWN",
      withdrawnAt: WITHDRAWN_AT.toISOString(),
    });
    const superseded = await detail("CAL-SUPERSEDED");
    expect(superseded).toMatchObject({
      certificateStatus: "SUPERSEDED",
      withdrawnAt: null,
    });
    expect(superseded).not.toHaveProperty("supersededById");
  });

  it("REQ-B3-S3: withdrawing another laboratory's certificate over HTTP is a 404 and writes nothing", async () => {
    const { ids } = await seedWorld();
    await seedOrg({
      orgId: "org-b3-other",
      userId: "user-b3-other",
      role: "admin",
    });
    loginAs({ userId: "user-b3-other", organizationId: "org-b3-other" });
    const before = await db
      .select({ id: issuedCertificateStatusEvent.id })
      .from(issuedCertificateStatusEvent);

    const res = await jobsRouter.request(
      `/${ids.issued}/certificate/withdraw`,
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ reason: "Tentativa de outro laboratorio" }),
      },
    );

    expect(res.status).toBe(404);
    const after = await db
      .select({ id: issuedCertificateStatusEvent.id })
      .from(issuedCertificateStatusEvent);
    expect(after).toHaveLength(before.length);
  });

  it("REQ-B3-S4: row-level security shows a laboratory its own status events and none of another's", async () => {
    const { ctx } = await seedWorld();
    const app = openAppRoleDb();
    const read = (organizationId: string) =>
      forOrg(app.db, organizationId).transaction((o) =>
        o
          .select({ id: issuedCertificateStatusEvent.id })
          .from(issuedCertificateStatusEvent),
      );

    expect((await read(ctx.labOrgId)).length).toBeGreaterThan(0);
    expect(await read("org-b3-other")).toEqual([]);
    // Even by naming the other laboratory's rows explicitly.
    const [foreignRow] = await db
      .select({ id: issuedCertificateStatusEvent.id })
      .from(issuedCertificateStatusEvent)
      .where(and(eq(issuedCertificateStatusEvent.organizationId, ctx.labOrgId)))
      .limit(1);
    if (!foreignRow) throw new Error("no event");
    expect(
      await forOrg(app.db, "org-b3-other").transaction((o) =>
        o
          .select({ id: issuedCertificateStatusEvent.id })
          .from(issuedCertificateStatusEvent)
          .where(eq(issuedCertificateStatusEvent.id, foreignRow.id)),
      ),
    ).toEqual([]);
  });
});
