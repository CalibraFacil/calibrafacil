/**
 * integrations-lab-scope.int.spec.ts - P2-18h [HIGH RISK].
 *
 * The ERP integration routes (settings, schedule, validation, runs, events, the
 * Conta Azul disconnect, the drift queue) run every statement in
 * `orgDb(lab).transaction(...)`, so a change and the events that record it commit
 * together. integrations.int.spec.ts covers list / create / the cross-laboratory
 * read of events; this one covers the success paths it does not reach, each with
 * a cross-laboratory negative:
 *
 *   REQ-18H-INTG-1  Editing, disabling and scheduling an integration commits the
 *                   change with its integration event and its audit event, under
 *                   the laboratory; the other laboratory's admin cannot do any of
 *                   it by id (404) and the row stays as it was.
 *   REQ-18H-INTG-2  Runs, run items and events are listed from the laboratory's
 *                   own integration only.
 *   REQ-18H-INTG-3  Disconnecting Conta Azul removes the connection, links and
 *                   cursor of THAT integration in one transaction with its
 *                   events; another laboratory's admin cannot.
 *   REQ-18H-INTG-4  The drift queue lists, and an acknowledgement updates, the
 *                   laboratory's own links; another laboratory's acknowledgement
 *                   of the same link id changes nothing.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import {
  integrationConnection,
  integrationEventLog,
  integrationObjectLink,
  integrationSyncCursor,
  integrationSyncItem,
  integrationSyncRun,
  organizationEventLog,
  organizationIntegration,
} from "@calibra-facil/db/schema";
import {
  normalizeContaAzulConnectionConfig,
  normalizeGenericFinancialErpConfig,
} from "@calibra-facil/shared";
import { integrationsRouter } from "./integrations";
import { loginAs } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg, type SeededOrg } from "../../test/integration/seed";

const ENV = { INTEGRATIONS_MASTER_KEY: Buffer.alloc(32).toString("base64") };
const JSON_HEADERS = { "content-type": "application/json" };

function call(path: string, method = "GET", body?: unknown) {
  return integrationsRouter.request(
    path,
    {
      method,
      headers: JSON_HEADERS,
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    ENV,
  );
}

function as(org: SeededOrg) {
  loginAs({ userId: org.userId, organizationId: org.orgId });
}

async function seedIntegration(
  org: SeededOrg,
  provider: "generic_http" | "conta_azul",
) {
  const integrationId = `int-${org.orgId}-${provider}`;
  await db.insert(organizationIntegration).values({
    id: integrationId,
    organizationId: org.orgId,
    type: "financial_erp",
    provider,
    name: `ERP ${org.orgId}`,
    status: "ACTIVE",
    createdBy: org.userId,
    updatedBy: org.userId,
  });
  await db.insert(integrationConnection).values({
    id: `conn-${integrationId}`,
    integrationId,
    organizationId: org.orgId,
    credentialType: provider === "conta_azul" ? "oauth2" : "bearer",
    config:
      provider === "conta_azul"
        ? normalizeContaAzulConnectionConfig({})
        : normalizeGenericFinancialErpConfig({
            baseUrl: "https://erp.example.com",
          }),
    encryptedSecret: "dummy-encrypted",
    secretIv: "dummy-iv",
    createdBy: org.userId,
    updatedBy: org.userId,
  });
  return integrationId;
}

async function integrationRow(integrationId: string) {
  const [row] = await db
    .select({
      name: organizationIntegration.name,
      status: organizationIntegration.status,
      organizationId: organizationIntegration.organizationId,
    })
    .from(organizationIntegration)
    .where(eq(organizationIntegration.id, integrationId));
  if (!row) throw new Error(`integration ${integrationId} vanished`);
  return row;
}

async function eventNames(organizationId: string) {
  const events = await db
    .select({ event: integrationEventLog.event })
    .from(integrationEventLog)
    .where(eq(integrationEventLog.organizationId, organizationId));
  return events.map((row) => row.event).toSorted();
}

async function auditActions(organizationId: string) {
  const events = await db
    .select({ action: organizationEventLog.action })
    .from(organizationEventLog)
    .where(
      and(
        eq(organizationEventLog.organizationId, organizationId),
        eq(organizationEventLog.entityType, "integration"),
      ),
    );
  return events.map((row) => row.action).toSorted();
}

describe("integration routes: laboratory scope (P2-18h)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("REQ-18H-INTG-1: edit, disable and schedule commit with their events under the lab; another lab cannot", async () => {
    const a = await seedOrg({ orgId: "lab-a", role: "admin" });
    const b = await seedOrg({ orgId: "lab-b", role: "admin" });
    const integrationA = await seedIntegration(a, "generic_http");

    // Laboratory B: every write by id answers as missing and changes nothing.
    as(b);
    expect(
      (await call(`/${integrationA}`, "PUT", { name: "Tomada por B" })).status,
    ).toBe(404);
    expect(
      (await call(`/${integrationA}/toggle`, "POST", { enabled: false }))
        .status,
    ).toBe(404);
    expect(
      (
        await call(`/${integrationA}/schedule`, "POST", {
          target: "customer",
          mode: "scheduled",
          frequency: "daily",
        })
      ).status,
    ).toBe(404);
    expect(await integrationRow(integrationA)).toEqual({
      name: `ERP lab-a`,
      status: "ACTIVE",
      organizationId: a.orgId,
    });
    expect(await eventNames(b.orgId)).toEqual([]);
    expect(await eventNames(a.orgId)).toEqual([]);

    // Laboratory A: the same calls commit, each with its events.
    as(a);
    expect(
      (await call(`/${integrationA}`, "PUT", { name: "ERP revisado" })).status,
    ).toBe(200);
    expect(
      (await call(`/${integrationA}/toggle`, "POST", { enabled: false }))
        .status,
    ).toBe(200);
    expect(
      (
        await call(`/${integrationA}/schedule`, "POST", {
          target: "customer",
          mode: "scheduled",
          frequency: "daily",
        })
      ).status,
    ).toBe(200);

    expect(await integrationRow(integrationA)).toEqual({
      name: "ERP revisado",
      status: "DISABLED",
      organizationId: a.orgId,
    });
    expect(await eventNames(a.orgId)).toEqual([
      "integration.disabled",
      "integration.schedule_updated",
      "integration.updated",
    ]);
    expect(await auditActions(a.orgId)).toEqual([
      "integration.schedule.updated",
      "integration.updated",
    ]);
    const [connection] = await db
      .select({ config: integrationConnection.config })
      .from(integrationConnection)
      .where(eq(integrationConnection.integrationId, integrationA));
    expect(
      normalizeGenericFinancialErpConfig(connection?.config).schedules.customer
        .mode,
    ).toBe("scheduled");
  });

  it("REQ-18H-INTG-2: runs, items and events are the laboratory's own", async () => {
    const a = await seedOrg({ orgId: "lab-a", role: "admin" });
    const b = await seedOrg({ orgId: "lab-b", role: "admin" });
    const integrationA = await seedIntegration(a, "generic_http");
    const integrationB = await seedIntegration(b, "generic_http");
    for (const [org, integrationId] of [
      [a, integrationA],
      [b, integrationB],
    ] as const) {
      await db.insert(integrationSyncRun).values({
        id: `run-${org.orgId}`,
        integrationId,
        organizationId: org.orgId,
        trigger: "manual",
        target: "customer",
        status: "COMPLETED",
      });
      await db.insert(integrationSyncItem).values({
        id: `item-${org.orgId}`,
        runId: `run-${org.orgId}`,
        integrationId,
        organizationId: org.orgId,
        target: "customer",
        localEntityId: `customer:${org.orgId}`,
        operation: "upsert",
        status: "SUCCEEDED",
        attemptCount: 1,
      });
      await db.insert(integrationEventLog).values({
        integrationId,
        organizationId: org.orgId,
        level: "info",
        event: "sync.completed",
        message: `Concluída ${org.orgId}`,
      });
    }

    as(a);
    const runs = await (await call(`/${integrationA}/runs`)).json();
    expect(runs.data.map((run: { id: string }) => run.id)).toEqual([
      "run-lab-a",
    ]);
    const items = await (
      await call(`/${integrationA}/runs/run-lab-a/items`)
    ).json();
    expect(items.data.map((item: { id: string }) => item.id)).toEqual([
      "item-lab-a",
    ]);
    const events = await (await call(`/${integrationA}/events`)).json();
    expect(
      events.data.map((event: { message: string }) => event.message),
    ).toEqual(["Concluída lab-a"]);
    // The other laboratory's run id, asked under A's integration, is not found.
    expect((await call(`/${integrationA}/runs/run-lab-b/items`)).status).toBe(
      404,
    );
    // The overview lists only A's integration; B's id answers as missing.
    expect((await call(`/${integrationB}/runs`)).status).toBe(404);
    expect((await call(`/${integrationB}/overview`)).status).toBe(404);
    const overview = await call(`/${integrationA}/overview`);
    expect(overview.status).toBe(200);
  });

  it("REQ-18H-INTG-3: disconnecting Conta Azul removes that integration's connection, links and cursor with its events", async () => {
    const a = await seedOrg({ orgId: "lab-a", role: "admin" });
    const b = await seedOrg({ orgId: "lab-b", role: "admin" });
    const integrationA = await seedIntegration(a, "conta_azul");
    const integrationB = await seedIntegration(b, "conta_azul");
    for (const [org, integrationId] of [
      [a, integrationA],
      [b, integrationB],
    ] as const) {
      await db.insert(integrationObjectLink).values({
        id: `link-${org.orgId}`,
        integrationId,
        organizationId: org.orgId,
        target: "customer",
        localEntityId: `customer:${org.orgId}`,
        remoteEntityId: "remote-1",
      });
      await db.insert(integrationSyncCursor).values({
        integrationId,
        organizationId: org.orgId,
        cursorType: "conta_azul_receivables",
      });
    }

    // Laboratory B cannot disconnect A's integration.
    as(b);
    expect(
      (await call(`/${integrationA}/conta-azul/disconnect`, "POST")).status,
    ).toBe(404);
    expect(await integrationRow(integrationA)).toMatchObject({
      status: "ACTIVE",
    });

    as(a);
    expect(
      (await call(`/${integrationA}/conta-azul/disconnect`, "POST")).status,
    ).toBe(200);

    expect(await integrationRow(integrationA)).toMatchObject({
      status: "DISABLED",
    });
    const remaining = async (organizationId: string) => ({
      connections: (
        await db
          .select({ id: integrationConnection.id })
          .from(integrationConnection)
          .where(eq(integrationConnection.organizationId, organizationId))
      ).length,
      links: (
        await db
          .select({ id: integrationObjectLink.id })
          .from(integrationObjectLink)
          .where(eq(integrationObjectLink.organizationId, organizationId))
      ).length,
      cursors: (
        await db
          .select({ id: integrationSyncCursor.id })
          .from(integrationSyncCursor)
          .where(eq(integrationSyncCursor.organizationId, organizationId))
      ).length,
    });
    expect(await remaining(a.orgId)).toEqual({
      connections: 0,
      links: 0,
      cursors: 0,
    });
    // Laboratory B's connection, link and cursor are untouched.
    expect(await remaining(b.orgId)).toEqual({
      connections: 1,
      links: 1,
      cursors: 1,
    });
    expect(await eventNames(a.orgId)).toEqual([
      "integration.conta_azul.disconnected",
    ]);
    expect(await auditActions(a.orgId)).toEqual([
      "integration.conta_azul.disconnected",
    ]);
    expect(await eventNames(b.orgId)).toEqual([]);
  });

  it("REQ-18H-INTG-4: the drift queue and its acknowledgement are the laboratory's own", async () => {
    const a = await seedOrg({ orgId: "lab-a", role: "admin" });
    const b = await seedOrg({ orgId: "lab-b", role: "admin" });
    const integrationA = await seedIntegration(a, "conta_azul");
    const integrationB = await seedIntegration(b, "conta_azul");
    for (const [org, integrationId] of [
      [a, integrationA],
      [b, integrationB],
    ] as const) {
      await db.insert(integrationObjectLink).values({
        id: `link-${org.orgId}`,
        integrationId,
        organizationId: org.orgId,
        target: "customer",
        localEntityId: `customer:${org.orgId}`,
        remoteEntityId: "remote-1",
        metadata: {
          drift: {
            status: "remote_missing",
            checkedAt: "2026-05-26T00:00:00.000Z",
            reason: "not_found",
          },
        },
        lastSyncedAt: new Date("2026-05-25T00:00:00.000Z"),
      });
    }

    as(a);
    const queue = await (await call("/drift")).json();
    expect(queue.data.map((row: { linkId: string }) => row.linkId)).toEqual([
      "link-lab-a",
    ]);

    // B acknowledges A's link id: nothing changes.
    as(b);
    expect(
      (await call("/drift/link-lab-a/acknowledge", "POST", { reason: "Ok" }))
        .status,
    ).toBe(200);
    const acknowledged = async (id: string) => {
      const [row] = await db
        .select({ at: integrationObjectLink.driftAcknowledgedAt })
        .from(integrationObjectLink)
        .where(eq(integrationObjectLink.id, id));
      return row?.at ?? null;
    };
    expect(await acknowledged("link-lab-a")).toBeNull();

    as(a);
    expect(
      (await call("/drift/link-lab-a/acknowledge", "POST", { reason: "Ok" }))
        .status,
    ).toBe(200);
    expect(await acknowledged("link-lab-a")).toBeInstanceOf(Date);
    expect(await acknowledged("link-lab-b")).toBeNull();
    const after = await (await call("/drift")).json();
    expect(after.data).toEqual([]);
  });
});
