/**
 * REQ-ASSIGN-RULE: "may this member be assigned work in this unit" is ONE rule
 * (`assignableMemberCondition`, lib/tenant-refs.ts), whichever way it is asked:
 * the technician picker (GET /technicians/list), the assignment guards
 * (`isAssignableTechnician`, used by assign / edit / createCalibrationJob / visits
 * / service orders). The organization role must hold `calibration.execute`
 * (packages/auth access.ts); an org admin/owner reaches every unit, anyone else
 * needs a technician / unit_admin assignment in the unit.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { organizationUnit } from "@calibra-facil/db/schema";
import { jobsRouter } from "./routes/jobs";
import { orgDb } from "../../lib/org-db";
import { isAssignableTechnician } from "../../lib/tenant-refs";
import { loginAs } from "../../../test/integration/setup";
import { truncateAll } from "../../../test/integration/db";
import { seedOrg } from "../../../test/integration/seed";
import { seedExtraMember } from "../../../test/integration/tenant-refs";
import { withStatusRepair } from "../../../test/integration/state-fixtures";

async function seedWorld() {
  const lab = await seedOrg({ orgId: "org-rule", role: "owner" });
  const [otherUnit] = await withStatusRepair((tx) =>
    tx
      .insert(organizationUnit)
      .values({
        organizationId: lab.orgId,
        name: "Filial",
        slug: "filial",
        status: "ACTIVE",
        createdBy: lab.userId,
      })
      .returning({ id: organizationUnit.id }),
  );
  if (!otherUnit) throw new Error("unit not created");
  const members = {
    adminOrg: await seedExtraMember({
      orgId: lab.orgId,
      userId: "admin-org",
      role: "admin",
    }),
    techHere: await seedExtraMember({
      orgId: lab.orgId,
      userId: "tech-here",
      role: "technician",
      unitId: lab.unitId,
      unitRole: "technician",
    }),
    techElsewhere: await seedExtraMember({
      orgId: lab.orgId,
      userId: "tech-elsewhere",
      role: "technician",
      unitId: otherUnit.id,
      unitRole: "technician",
    }),
    techNoAssignment: await seedExtraMember({
      orgId: lab.orgId,
      userId: "tech-none",
      role: "technician",
    }),
    operatorHere: await seedExtraMember({
      orgId: lab.orgId,
      userId: "operator-here",
      role: "operator",
      unitId: lab.unitId,
      unitRole: "technician",
    }),
    // Holds a technician assignment, but the role cannot execute a calibration.
    memberHere: await seedExtraMember({
      orgId: lab.orgId,
      userId: "member-here",
      role: "member",
      unitId: lab.unitId,
      unitRole: "technician",
    }),
  };
  return { lab, members };
}

describe("REQ-ASSIGN-RULE: one assignable-technician rule", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("the picker and the assignment guard answer the same for every kind of member", async () => {
    const { lab } = await seedWorld();
    loginAs({ userId: lab.userId, organizationId: lab.orgId });

    const everyone = [
      lab.userId,
      "admin-org",
      "tech-here",
      "tech-elsewhere",
      "tech-none",
      "operator-here",
      "member-here",
    ];
    const guarded = await orgDb(lab.orgId).transaction(async (o) => {
      const accepted: string[] = [];
      for (const userId of everyone) {
        if (
          await isAssignableTechnician(
            { organizationId: lab.orgId, userId, unitId: lab.unitId },
            o,
          )
        ) {
          accepted.push(userId);
        }
      }
      return accepted;
    });

    const res = await jobsRouter.request("/technicians/list", {
      headers: { "x-active-unit-id": String(lab.unitId) },
    });
    expect(res.status).toBe(200);
    const listed: string[] = (await res.json()).data.map(
      (row: { id: string }) => row.id,
    );

    // The role that executes and the unit assignment decide: org admins and
    // owners anywhere, technician/operator with an assignment here.
    expect(guarded.toSorted()).toEqual(
      [lab.userId, "admin-org", "tech-here", "operator-here"].toSorted(),
    );
    expect(listed.toSorted()).toEqual(guarded.toSorted());
  });

  it("a role that cannot execute is not assignable even when no unit is named", async () => {
    const { lab } = await seedWorld();
    const guarded = await orgDb(lab.orgId).transaction((o) =>
      isAssignableTechnician(
        { organizationId: lab.orgId, userId: "member-here", unitId: null },
        o,
      ),
    );
    // A role that cannot execute is never assignable, in any unit.
    expect(guarded).toBe(false);
  });
});
