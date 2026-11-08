/**
 * REQ-ASSET-DEL-001: an asset with calibration work still in the laboratory's
 * pipeline (or an unfinished service order) cannot be deleted: 409
 * `asset_has_open_work`, the asset stays. Once the work is finished (or
 * canceled) the delete goes through and writes its audit row.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@calibra-facil/db";
import { asset, assetAuditLog } from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";
import { assetsRouter } from "./assets";
import { loginAs } from "../../../../test/integration/setup";
import { truncateAll } from "../../../../test/integration/db";
import { seedOrg } from "../../../../test/integration/seed";
import { seedJobForOrg } from "../../../../test/integration/tenant-refs";
import { setJobStatus } from "../../../../test/integration/job-fixtures";

async function deletedAtOf(assetId: number) {
  const [row] = await db
    .select({ deletedAt: asset.deletedAt })
    .from(asset)
    .where(eq(asset.id, assetId));
  return row?.deletedAt ?? null;
}

describe("REQ-ASSET-DEL-001: deleting an asset with open work", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it.each(["DRAFT", "IN_PROGRESS", "REVIEW"] as const)(
    "refuses with 409 asset_has_open_work while a job of the asset is %s, and keeps the asset and its audit trail",
    async (status) => {
      const org = await seedOrg({ orgId: "org-del", role: "owner" });
      const { jobId, assetId } = await seedJobForOrg({
        orgId: org.orgId,
        unitId: org.unitId,
        createdBy: org.userId,
      });
      await setJobStatus(jobId, status);
      loginAs({ userId: org.userId, organizationId: org.orgId });

      const res = await assetsRouter.request(`/${assetId}`, {
        method: "DELETE",
      });

      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: "asset_has_open_work" });
      expect(await deletedAtOf(assetId)).toBeNull();
      expect(
        await db
          .select({ id: assetAuditLog.id })
          .from(assetAuditLog)
          .where(eq(assetAuditLog.assetId, assetId)),
      ).toEqual([]);
    },
  );

  it("deletes once the job is canceled, with its audit row", async () => {
    const org = await seedOrg({ orgId: "org-del2", role: "owner" });
    const { jobId, assetId } = await seedJobForOrg({
      orgId: org.orgId,
      unitId: org.unitId,
      createdBy: org.userId,
    });
    await setJobStatus(jobId, "CANCELED");
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const res = await assetsRouter.request(`/${assetId}`, {
      method: "DELETE",
    });

    expect(res.status).toBe(200);
    expect(await deletedAtOf(assetId)).toBeInstanceOf(Date);
    const audit = await db
      .select({ action: assetAuditLog.action })
      .from(assetAuditLog)
      .where(eq(assetAuditLog.assetId, assetId));
    expect(audit.map((row) => row.action)).toEqual(["delete"]);
  });
});
