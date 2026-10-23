/**
 * portal-scope-isolation.int.spec.ts - P2-18a [HIGH RISK].
 *
 * Two laboratories, each with a portal customer. Proves, against the real
 * database and at the LIBRARY level (it calls no HTTP handler):
 *
 *   1. the SYSTEM-path resolvers (portal customer scope, accessible customers,
 *      the organization switcher, the host-name lookup, `orgSetDb`) that have to
 *      run before a laboratory is named never hand a customer of lab A a row,
 *      id or laboratory of lab B;
 *   2. the org-bound transaction (`orgDb(lab).transaction`) reads lab A's rows as
 *      the application role (`calibra_app`, bound by the `tenant_isolation`
 *      policies) and NOTHING of lab B's, even by lab B's ids;
 *   3. a statement outside a transaction sees nothing as `calibra_app` (fail
 *      closed).
 *
 * The handler-level proof (lab B's identifiers in lab A's session on every
 * portal endpoint, as `calibra_app`) is portal-cross-tenant.int.spec.ts run by
 * `pnpm --filter @calibra-facil/api rls:shadow-report`, together with the other
 * portal specs.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import { forOrg } from "@calibra-facil/db/for-org";
import {
  asset,
  assetType,
  notification,
  organizationCustomDomain,
  portalExportJob,
} from "@calibra-facil/db/schema";
import { truncateAll } from "../../test/integration/db";
import { seedPortalContext } from "../../test/integration/seed";
import { openAppRoleDb } from "../../test/integration/rls";
import { orgSetDb } from "./org-db";
import {
  listPortalClientOrganizations,
  resolvePortalAccessibleCustomers,
  resolvePortalCustomerScope,
  resolvePortalLinkedCustomer,
  resolvePortalNotificationOrgIds,
} from "./portal-customer-scope";
import {
  findPortalHostnameOwnedByOtherOrganization,
  getActivePortalDomainForOrganization,
  getOrganizationCustomDomain,
  resolveLabOrganizationIdByPortalHostname,
} from "./portal-domains";

type Lab = Awaited<ReturnType<typeof seedLab>>;

const HOST_A = "calibracao.lab-a.example.com";
const HOST_B = "calibracao.lab-b.example.com";

async function seedLab(tag: "a" | "b", assetTypeId: number) {
  const ctx = await seedPortalContext({
    labOrgId: `lab-${tag}`,
    clientOrgId: `client-${tag}`,
    portalUserId: `user-${tag}`,
    customerName: `Customer ${tag}`,
  });
  const [assetRow] = await db
    .insert(asset)
    .values({
      unitId: ctx.labUnitId,
      customerId: ctx.customerId,
      labOrganizationId: ctx.labOrgId,
      assetTypeId,
      name: `Ativo ${tag}`,
      serialNumber: `SN-${tag}`,
      tag: `TAG-${tag}`,
      status: "ACTIVE",
    })
    .returning({ id: asset.id });
  if (!assetRow) throw new Error("asset not seeded");

  const [bell] = await db
    .insert(notification)
    .values({
      recipientUserId: ctx.portalUserId,
      organizationId: ctx.clientOrgId,
      type: "CERTIFICATE_READY",
      title: `Aviso ${tag}`,
      message: `Mensagem ${tag}`,
    })
    .returning({ id: notification.id });
  if (!bell) throw new Error("notification not seeded");

  const [pack] = await db
    .insert(portalExportJob)
    .values({
      kind: "AUDIT_PACK",
      labOrganizationId: ctx.labOrgId,
      authOrganizationId: ctx.clientOrgId,
      requestedByUserId: ctx.portalUserId,
      params: {
        dateFrom: "2026-01-01",
        dateTo: "2026-12-31",
        unitId: null,
        include: { certificates: true },
        customerIds: [ctx.customerId],
      },
      status: "COMPLETED",
    })
    .returning({ id: portalExportJob.id });
  if (!pack) throw new Error("pack not seeded");

  await db.insert(organizationCustomDomain).values({
    id: `domain-${tag}`,
    organizationId: ctx.labOrgId,
    hostname: tag === "a" ? HOST_A : HOST_B,
    verificationToken: `token-${tag}`,
    verifiedAt: new Date("2026-01-02T00:00:00.000Z"),
    isActive: true,
    createdBy: ctx.portalUserId,
  });

  return {
    ctx,
    assetId: assetRow.id,
    notificationId: bell.id,
    packId: pack.id,
  };
}

let labA: Lab;
let labB: Lab;

describe("portal scope resolvers and org-bound reads (P2-18a)", () => {
  beforeAll(async () => {
    await truncateAll();
    const [type] = await db
      .insert(assetType)
      .values({ name: "Balanca", slug: "balanca", definition: [] })
      .returning({ id: assetType.id });
    if (!type) throw new Error("asset type not seeded");
    labA = await seedLab("a", type.id);
    labB = await seedLab("b", type.id);
  }, 120_000);

  describe("the system-path resolvers", () => {
    it("the scope of lab A's client organization is lab A's customer, on any host and on lab A's", async () => {
      const anywhere = await resolvePortalCustomerScope({
        activeOrgId: labA.ctx.clientOrgId,
        labScope: null,
      });
      const onOwnHost = await resolvePortalCustomerScope({
        activeOrgId: labA.ctx.clientOrgId,
        labScope: labA.ctx.labOrgId,
      });
      for (const scope of [anywhere, onOwnHost]) {
        expect(scope?.labOrganizationId).toBe(labA.ctx.labOrgId);
        expect(scope?.customerIds).toEqual([labA.ctx.customerId]);
      }
    });

    it("lab B's client organization on lab A's host resolves to nothing (cross-tenant guard)", async () => {
      expect(
        await resolvePortalCustomerScope({
          activeOrgId: labB.ctx.clientOrgId,
          labScope: labA.ctx.labOrgId,
        }),
      ).toBeNull();
      expect(
        await resolvePortalLinkedCustomer({
          authOrganizationId: labB.ctx.clientOrgId,
          labScope: labA.ctx.labOrgId,
        }),
      ).toBeNull();
    });

    it("a user of lab A reaches only lab A's customers, laboratories, organizations and notification orgs", async () => {
      const accessible = await resolvePortalAccessibleCustomers({
        userId: labA.ctx.portalUserId,
        labScope: null,
      });
      expect(accessible).toEqual({
        customerIds: [labA.ctx.customerId],
        labOrganizationIds: [labA.ctx.labOrgId],
      });

      const switcher = await listPortalClientOrganizations({
        userId: labA.ctx.portalUserId,
        labScope: null,
      });
      expect(switcher.map((row) => row.id)).toEqual([labA.ctx.clientOrgId]);

      expect(
        await resolvePortalNotificationOrgIds({
          userId: labA.ctx.portalUserId,
          labScope: null,
        }),
      ).toEqual([labA.ctx.clientOrgId]);

      // Another laboratory's host narrows the same user to nothing.
      expect(
        await resolvePortalAccessibleCustomers({
          userId: labA.ctx.portalUserId,
          labScope: labB.ctx.labOrgId,
        }),
      ).toEqual({ customerIds: [], labOrganizationIds: [] });
    });

    it("the host name finds its own laboratory, and a laboratory never reads another's domain", async () => {
      expect(await resolveLabOrganizationIdByPortalHostname(HOST_A)).toBe(
        labA.ctx.labOrgId,
      );
      expect(await resolveLabOrganizationIdByPortalHostname(HOST_B)).toBe(
        labB.ctx.labOrgId,
      );
      expect((await getOrganizationCustomDomain(labA.ctx.labOrgId))?.id).toBe(
        "domain-a",
      );
      expect(
        (await getActivePortalDomainForOrganization(labA.ctx.labOrgId))
          ?.hostname,
      ).toBe(HOST_A);
      // The collision check is cross-laboratory on purpose: lab A sees that lab B holds HOST_B.
      expect(
        (
          await findPortalHostnameOwnedByOtherOrganization(
            HOST_B,
            labA.ctx.labOrgId,
          )
        )?.organizationId,
      ).toBe(labB.ctx.labOrgId);
      expect(
        await findPortalHostnameOwnedByOtherOrganization(
          HOST_A,
          labA.ctx.labOrgId,
        ),
      ).toBeUndefined();
    });

    it("orgSetDb reads only the laboratories of its set, by their ids or by lab B's", async () => {
      const ids = [labA.assetId, labB.assetId];
      const onlyA = await orgSetDb([labA.ctx.labOrgId])
        .select({ id: asset.id })
        .from(asset);
      expect(onlyA.map((row) => row.id)).toEqual([labA.assetId]);

      const askedForBoth = await orgSetDb([labA.ctx.labOrgId])
        .select({ id: asset.id })
        .from(asset)
        .where(and(eq(asset.id, labB.assetId)));
      expect(askedForBoth).toEqual([]);

      const both = await orgSetDb([labA.ctx.labOrgId, labB.ctx.labOrgId])
        .select({ id: asset.id })
        .from(asset);
      expect(both.map((row) => row.id).toSorted()).toEqual(ids.toSorted());

      expect(await orgSetDb([]).select({ id: asset.id }).from(asset)).toEqual(
        [],
      );
    });
  });

  describe("as calibra_app (row-level security binds the session)", () => {
    it("an org-bound transaction reads lab A's rows and none of lab B's, even by lab B's ids", async () => {
      const app = openAppRoleDb();
      const a = forOrg(app.db, labA.ctx.labOrgId);

      const own = await a.transaction((o) =>
        o
          .select({ id: asset.id })
          .from(asset)
          .where(eq(asset.id, labA.assetId)),
      );
      expect(own.map((row) => row.id)).toEqual([labA.assetId]);

      const foreign = await a.transaction((o) =>
        o
          .select({ id: asset.id })
          .from(asset)
          .where(eq(asset.id, labB.assetId)),
      );
      expect(foreign).toEqual([]);

      const foreignPack = await a.transaction((o) =>
        o
          .select({ id: portalExportJob.id })
          .from(portalExportJob)
          .where(eq(portalExportJob.id, labB.packId)),
      );
      expect(foreignPack).toEqual([]);

      const foreignDomain = await a.transaction((o) =>
        o
          .select({ id: organizationCustomDomain.id })
          .from(organizationCustomDomain)
          .where(eq(organizationCustomDomain.id, "domain-b")),
      );
      expect(foreignDomain).toEqual([]);
    });

    it("the CLIENT organization of the session names its own notification rows only", async () => {
      const app = openAppRoleDb();
      const client = forOrg(app.db, labA.ctx.clientOrgId);

      const rows = await client.transaction((o) =>
        o.select({ id: notification.id }).from(notification),
      );
      expect(rows.map((row) => row.id)).toEqual([labA.notificationId]);

      const foreign = await client.transaction((o) =>
        o
          .select({ id: notification.id })
          .from(notification)
          .where(eq(notification.id, labB.notificationId)),
      );
      expect(foreign).toEqual([]);
    });

    it("a statement outside a transaction sees nothing (fail closed), the same statement inside one sees the row", async () => {
      const app = openAppRoleDb();
      const a = forOrg(app.db, labA.ctx.labOrgId);

      const outside = await a
        .select({ id: asset.id })
        .from(asset)
        .where(eq(asset.id, labA.assetId));
      expect(outside).toEqual([]);

      const inside = await a.transaction((o) =>
        o
          .select({ id: asset.id })
          .from(asset)
          .where(eq(asset.id, labA.assetId)),
      );
      expect(inside).toHaveLength(1);
    });

    it("a write through lab A's handle never reaches lab B's row", async () => {
      const app = openAppRoleDb();
      const a = forOrg(app.db, labA.ctx.labOrgId);

      const updated = await a.transaction((o) =>
        o
          .update(portalExportJob)
          .set({ status: "FAILED" })
          .where(eq(portalExportJob.id, labB.packId))
          .returning({ id: portalExportJob.id }),
      );
      expect(updated).toEqual([]);

      const [untouched] = await db
        .select({ status: portalExportJob.status })
        .from(portalExportJob)
        .where(eq(portalExportJob.id, labB.packId));
      expect(untouched?.status).toBe("COMPLETED");
    });
  });
});
