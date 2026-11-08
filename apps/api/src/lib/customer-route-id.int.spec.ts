/**
 * customer-route-id.int.spec.ts: `resolveCustomerRouteId` against a real
 * Postgres. A customer is addressed by id, tax id or a slug of its name or tax
 * id, and the lookup never leaves the caller's laboratory.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@calibra-facil/db";
import { customer } from "@calibra-facil/db/schema";
import { truncateAll } from "../../test/integration/db";
import { seedCustomer, seedOrg } from "../../test/integration/seed";
import { clientRouteId } from "@calibra-facil/shared/route-identifiers";
import { orgDb } from "./org-db";
import { resolveCustomerRouteId } from "./customer-route-id";

function resolve(orgId: string, identifier: string) {
  return orgDb(orgId).transaction((o) =>
    resolveCustomerRouteId(identifier, orgId, o),
  );
}

describe("resolveCustomerRouteId", () => {
  beforeEach(async () => {
    await truncateAll();
    await seedOrg({ orgId: "lab-a" });
    await seedOrg({ orgId: "lab-b" });
  });

  it("resolves a numeric id and a tax id", async () => {
    const id = await seedCustomer({
      labOrganizationId: "lab-a",
      name: "Cliente Matriz",
      taxId: "12345678000190",
    });

    expect(await resolve("lab-a", String(id))).toBe(id);
    expect(await resolve("lab-a", "12345678000190")).toBe(id);
  });

  it("resolves the slug of the name or of the tax id", async () => {
    const id = await seedCustomer({
      labOrganizationId: "lab-a",
      name: "Cliente Matriz",
      taxId: "12.345.678/0001-90",
    });

    expect(await resolve("lab-a", "cliente-matriz")).toBe(id);
    expect(
      await resolve(
        "lab-a",
        clientRouteId({ name: "x", taxId: "12.345.678/0001-90" }),
      ),
    ).toBe(id);
  });

  it("resolves a slug that starts with digits", async () => {
    const id = await seedCustomer({
      labOrganizationId: "lab-a",
      name: "3M do Brasil",
    });

    expect(await resolve("lab-a", "3m-do-brasil")).toBe(id);
  });

  it("returns null for an identifier nobody has", async () => {
    await seedCustomer({ labOrganizationId: "lab-a", name: "Cliente Matriz" });

    expect(await resolve("lab-a", "ninguem")).toBeNull();
    expect(await resolve("lab-a", "999999")).toBeNull();
  });

  it("never resolves another laboratory's customer, by id, tax id or slug", async () => {
    const foreign = await seedCustomer({
      labOrganizationId: "lab-b",
      name: "Cliente Matriz",
      taxId: "98765432000110",
    });

    expect(await resolve("lab-a", String(foreign))).toBeNull();
    expect(await resolve("lab-a", "98765432000110")).toBeNull();
    expect(await resolve("lab-a", "cliente-matriz")).toBeNull();
  });

  it("prefers the caller's own customer when both laboratories share a name", async () => {
    await seedCustomer({ labOrganizationId: "lab-b", name: "Cliente Matriz" });
    const own = await seedCustomer({
      labOrganizationId: "lab-a",
      name: "Cliente Matriz",
    });

    expect(await resolve("lab-a", "cliente-matriz")).toBe(own);
  });

  it("scans only the first 500 customers of the laboratory for a slug", async () => {
    const first = await seedCustomer({
      labOrganizationId: "lab-a",
      name: "Cliente 0001",
    });
    const [any] = await db
      .select({ authOrganizationId: customer.authOrganizationId })
      .from(customer);
    if (!any) throw new Error("seed failed");
    await db.insert(customer).values(
      Array.from({ length: 500 }, (_, index) => ({
        name: `Cliente ${String(index + 2).padStart(4, "0")}`,
        authOrganizationId: any.authOrganizationId,
        labOrganizationId: "lab-a",
      })),
    );

    expect(await resolve("lab-a", "cliente-0001")).toBe(first);
    expect(await resolve("lab-a", "cliente-0500")).not.toBeNull();
    // The 501st customer is past the scan window.
    expect(await resolve("lab-a", "cliente-0501")).toBeNull();
  });
});
