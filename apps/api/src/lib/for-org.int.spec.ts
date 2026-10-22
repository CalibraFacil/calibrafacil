import { beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import { forOrg, forOrgs } from "@calibra-facil/db/for-org";
import { customer, organization } from "@calibra-facil/db/schema";
import { truncateAll } from "../../test/integration/db";
import { seedCustomer, seedOrg } from "../../test/integration/seed";

// Real-database proof of the org-bound handle (REQ-ORGDB-1): two laboratories
// own customers; a handle bound to lab A never sees, changes or removes lab B's
// rows, on the global `db` and inside a transaction alike.

async function seedTwoLabs() {
  await seedOrg({ orgId: "lab-a" });
  await seedOrg({ orgId: "lab-b" });
  const a1 = await seedCustomer({
    labOrganizationId: "lab-a",
    name: "A1",
    taxId: "11",
  });
  const a2 = await seedCustomer({
    labOrganizationId: "lab-a",
    name: "A2",
    taxId: "12",
  });
  const b1 = await seedCustomer({
    labOrganizationId: "lab-b",
    name: "B1",
    taxId: "21",
  });
  return { a1, a2, b1 };
}

async function namesOf(labOrganizationId: string) {
  const rows = await db
    .select({ name: customer.name })
    .from(customer)
    .where(eq(customer.labOrganizationId, labOrganizationId))
    .orderBy(customer.name);
  return rows.map((row) => row.name);
}

describe("forOrg on a real database", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("REQ-ORGDB-1: select returns only the bound organization's rows, with or without a where", async () => {
    const { a1, b1 } = await seedTwoLabs();
    const o = forOrg(db, "lab-a");

    const all = await o
      .select({ id: customer.id })
      .from(customer)
      .orderBy(customer.id);
    expect(all.map((row) => row.id)).toHaveLength(2);

    // Lab B's primary key presented to lab A's handle: nothing.
    const foreign = await o
      .select({ id: customer.id })
      .from(customer)
      .where(eq(customer.id, b1));
    expect(foreign).toEqual([]);

    const own = await o
      .select({ id: customer.id })
      .from(customer)
      .where(eq(customer.id, a1));
    expect(own).toEqual([{ id: a1 }]);
  });

  it("REQ-ORGDB-1: update and delete cannot touch another organization's row", async () => {
    const { b1 } = await seedTwoLabs();
    const o = forOrg(db, "lab-a");

    const updated = await o
      .update(customer)
      .set({ name: "hijacked" })
      .where(eq(customer.id, b1))
      .returning({ id: customer.id });
    expect(updated).toEqual([]);

    const deleted = await o
      .delete(customer)
      .where(eq(customer.id, b1))
      .returning({ id: customer.id });
    expect(deleted).toEqual([]);
    expect(await namesOf("lab-b")).toEqual(["B1"]);

    // A bare delete is bound too: it empties lab A and leaves lab B alone.
    await o.delete(customer);
    expect(await namesOf("lab-a")).toEqual([]);
    expect(await namesOf("lab-b")).toEqual(["B1"]);
  });

  it("REQ-ORGDB-1: insert stores the bound organization and refuses another one", async () => {
    await seedTwoLabs();
    await db.insert(organization).values({
      id: "client-x",
      name: "Client X",
      slug: "client-x",
      type: "CLIENT",
      status: "ACTIVE",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const o = forOrg(db, "lab-a");

    const [row] = await o
      .insert(customer)
      .values({
        name: "A3",
        authOrganizationId: "client-x",
        labOrganizationId: o.organizationId,
      })
      .returning({ id: customer.id, lab: customer.labOrganizationId });
    expect(row?.lab).toBe("lab-a");

    expect(() =>
      o.insert(customer).values({
        name: "Sneaky",
        authOrganizationId: "client-x",
        labOrganizationId: "lab-b",
      }),
    ).toThrow(/forOrg/);
    expect(await namesOf("lab-b")).toEqual(["B1"]);
  });

  it("REQ-ORGDB-1: works on the tx of db.transaction and rolls back with it", async () => {
    const { a1, b1 } = await seedTwoLabs();

    await expect(
      db.transaction(async (tx) => {
        const o = forOrg(tx, "lab-a");
        await o
          .update(customer)
          .set({ name: "A1 renamed" })
          .where(eq(customer.id, a1));
        await o
          .update(customer)
          .set({ name: "B1 renamed" })
          .where(eq(customer.id, b1));
        const seen = await o
          .select({ name: customer.name })
          .from(customer)
          .where(inArray(customer.id, [a1, b1]));
        expect(seen).toEqual([{ name: "A1 renamed" }]);
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");

    expect(await namesOf("lab-a")).toEqual(["A1", "A2"]);
    expect(await namesOf("lab-b")).toEqual(["B1"]);
  });

  it("REQ-ORGDB-1: o.transaction keeps the handle bound and commits", async () => {
    const { a1, b1 } = await seedTwoLabs();
    const o = forOrg(db, "lab-a");

    await o.transaction(async (tx) => {
      expect(tx.organizationId).toBe("lab-a");
      await tx
        .update(customer)
        .set({ name: "A1 renamed" })
        .where(eq(customer.id, a1));
      await tx
        .update(customer)
        .set({ name: "B1 renamed" })
        .where(eq(customer.id, b1));
    });

    expect(await namesOf("lab-a")).toEqual(["A1 renamed", "A2"]);
    expect(await namesOf("lab-b")).toEqual(["B1"]);
  });

  it("REQ-ORGDB-1: forOrgs reads a bounded set of laboratories and nothing else", async () => {
    await seedTwoLabs();
    await seedOrg({ orgId: "lab-c" });
    await seedCustomer({ labOrganizationId: "lab-c", name: "C1" });

    const both = forOrgs(db, ["lab-a", "lab-b"]);
    const rows = await both
      .select({ name: customer.name })
      .from(customer)
      .orderBy(customer.name);
    expect(rows.map((row) => row.name)).toEqual(["A1", "A2", "B1"]);

    const none = forOrgs(db, []);
    expect(await none.select({ id: customer.id }).from(customer)).toEqual([]);
  });
});
