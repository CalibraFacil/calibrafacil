import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@calibra-facil/db";
import { asset, assetType } from "@calibra-facil/db/schema";
import { addCalendarDays, labToday } from "@calibra-facil/shared";
import { FLEET_DUE_SOON_DAYS } from "@calibra-facil/shared/fleet-due";
import { eq, sql } from "drizzle-orm";
import { truncateAll } from "../../../test/integration/db";
import { seedPortalContext } from "../../../test/integration/seed";
import { withStatusRepair } from "../../../test/integration/state-fixtures";
import { orgDb } from "../../lib/org-db";
import { fleetDueCountsByCustomer, fleetDueStatusCondition } from "./fleet-due";

/**
 * REQ-FLEET-DUE: the one definition of overdue / due soon / scheduled /
 * unscheduled. The counts (portal overview, unit summary, customer-group
 * summary) and the list filter (portal assets) must agree on every boundary day:
 * yesterday is overdue, today and today + FLEET_DUE_SOON_DAYS are due soon, the
 * day after is scheduled, no date is unscheduled.
 */
describe("fleet due status", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  async function seedFleet() {
    const ctx = await seedPortalContext();
    const [type] = await db
      .insert(assetType)
      .values({ name: "Balança", slug: "balanca-fleet", definition: [] })
      .returning({ id: assetType.id });
    const today = labToday();
    const days: Array<[string, Date | null]> = [
      ["yesterday", addCalendarDays(today, -1)],
      ["today", today],
      ["last-due-soon", addCalendarDays(today, FLEET_DUE_SOON_DAYS)],
      ["first-scheduled", addCalendarDays(today, FLEET_DUE_SOON_DAYS + 1)],
      ["no-date", null],
    ];
    for (const [tag, next] of days) {
      await withStatusRepair((tx) =>
        tx.insert(asset).values({
          unitId: ctx.labUnitId,
          customerId: ctx.customerId,
          labOrganizationId: sql`(select "lab_organization_id" from "customer" where "id" = ${ctx.customerId})`,
          assetTypeId: type?.id ?? 0,
          name: tag,
          serialNumber: `SN-${tag}`,
          tag,
          status: "ACTIVE",
          nextCalibrationDate: next,
        }),
      );
    }
    return ctx;
  }

  it("REQ-FLEET-DUE-1: the counts classify the boundary days", async () => {
    const ctx = await seedFleet();
    const counts = await orgDb(ctx.labOrgId).transaction((o) =>
      fleetDueCountsByCustomer(o, [ctx.customerId]),
    );
    expect(counts.get(ctx.customerId)).toEqual({
      total: 5,
      overdue: 1,
      dueSoon: 2,
      scheduled: 1,
      unscheduled: 1,
      inLab: 0,
    });
  });

  it("REQ-FLEET-DUE-2: the list filter selects the same assets the counts count", async () => {
    const ctx = await seedFleet();
    const tagsOf = (status: Parameters<typeof fleetDueStatusCondition>[0]) =>
      orgDb(ctx.labOrgId).transaction(async (o) => {
        const rows = await o
          .select({ tag: asset.tag })
          .from(asset)
          .where(
            fleetDueStatusCondition(status, o) ??
              eq(asset.customerId, ctx.customerId),
          );
        return rows.map((row) => row.tag).toSorted();
      });

    expect(await tagsOf("overdue")).toEqual(["yesterday"]);
    expect(await tagsOf("due_soon")).toEqual(["last-due-soon", "today"]);
    expect(await tagsOf("scheduled")).toEqual(["first-scheduled"]);
    expect(await tagsOf("unscheduled")).toEqual(["no-date"]);
    expect(await tagsOf("in_lab")).toEqual([]);
  });

  it("REQ-FLEET-DUE-3: a customer without instruments has no row, and no id is no query", async () => {
    const ctx = await seedFleet();
    await orgDb(ctx.labOrgId).transaction(async (o) => {
      expect(await fleetDueCountsByCustomer(o, [])).toEqual(new Map());
      expect(
        (await fleetDueCountsByCustomer(o, [ctx.customerId + 999])).size,
      ).toBe(0);
    });
  });
});
