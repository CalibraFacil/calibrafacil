import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { db, systemDb } from "@calibra-facil/db";
import { customer } from "@calibra-facil/db/schema";
import { truncateAll } from "../../test/integration/db";
import {
  appRoleEnabled,
  outsideApplication,
} from "../../test/integration/app-role-mode";
import { seedTenant } from "../../test/integration/tenancy-fixture";

// The harness itself (P2-18k): the integration tier runs every request of a spec
// as `calibra_app`, under the real `tenant_isolation` policies, so a statement
// that forgets its organization fails the suite instead of a deployment. These
// tests pin that: if the routing silently fell back to the owner, every other
// spec would keep passing and RLS would go unprotected again.
//
// They are skipped with CALIBRA_API_DB_ROLE=owner, the debugging switch that
// deliberately turns the routing off.

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result;
  if (typeof result === "object" && result !== null) {
    const rows: unknown = Reflect.get(result, "rows");
    if (Array.isArray(rows)) return rows;
  }
  return [];
}

async function currentUserOf(executor: {
  execute: (query: ReturnType<typeof sql>) => PromiseLike<unknown>;
}): Promise<unknown> {
  const [row] = rowsOf(
    await executor.execute(sql`select current_user::text as who`),
  );
  return row?.who;
}

describe.skipIf(!appRoleEnabled())(
  "integration harness: requests run as calibra_app",
  () => {
    beforeEach(async () => {
      await truncateAll();
      await seedTenant("lab-a");
      await seedTenant("lab-b");
    });

    it("REQ-RLS-4 [HIGH RISK]: a request's db is calibra_app, the spec's own db and systemDb are the owner", async () => {
      const app = new Hono();
      app.get("/who", async (c) =>
        c.json({
          application: await currentUserOf(db),
          system: await currentUserOf(systemDb),
        }),
      );

      const response = await app.request("/who");
      const body: unknown = await response.json();
      expect(body).toEqual({ application: "calibra_app", system: "postgres" });
      // The spec's seeding and assertions are the harness, not the application.
      expect(await currentUserOf(db)).toBe("postgres");
      // A route may step out of the application context, like the other actor
      // of an interleaving.
      const out = new Hono();
      out.get("/out", async (c) =>
        c.json({ who: await outsideApplication(() => currentUserOf(db)) }),
      );
      expect(await (await out.request("/out")).json()).toEqual({
        who: "postgres",
      });
    });

    it("REQ-RLS-4 [HIGH RISK]: a statement a request issues without naming an organization sees no row, and one that names it sees only its laboratory", async () => {
      const app = new Hono();
      app.get("/unscoped", async (c) =>
        c.json({
          count: (await db.select({ id: customer.id }).from(customer)).length,
        }),
      );
      app.get("/scoped/:org", async (c) =>
        c.json({
          count: (
            await db.transaction(async (tx) => {
              await tx.execute(
                sql`select set_config('calibra.organization_id', ${c.req.param("org")}, true)`,
              );
              return tx.select({ id: customer.id }).from(customer);
            })
          ).length,
        }),
      );

      expect(await db.select({ id: customer.id }).from(customer)).toHaveLength(
        2,
      );
      expect(await (await app.request("/unscoped")).json()).toEqual({
        count: 0,
      });
      expect(await (await app.request("/scoped/lab-a")).json()).toEqual({
        count: 1,
      });
      expect(await (await app.request("/scoped/lab-b")).json()).toEqual({
        count: 1,
      });
    });
  },
);
