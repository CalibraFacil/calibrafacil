/**
 * notifications-sweeps-lab-scope.int.spec.ts - P2-18h [HIGH RISK].
 *
 * Notifications, the portal due-digest, the e-mail drains and the Conta Azul
 * scheduled sync run outside a request: nobody names a laboratory. Each of them
 * learns the laboratory from the row it works on and then runs in a transaction
 * that names it (the recipient's organization for a notification row). Proves,
 * against the real database and with the application connection of the work
 * itself as `calibra_app` (bound by the `tenant_isolation` policies; the seeding
 * and the assertions keep the owner connection):
 *
 *   REQ-18H-NOTIF-1  A notification for laboratory A reaches laboratory A's
 *                    people and nobody in laboratory B (job events, compliance
 *                    reminders, a reminder asked with the wrong laboratory).
 *   REQ-18H-NOTIF-2  A portal notification is written under the CLIENT
 *                    organization of the customer, for that customer's users
 *                    only.
 *   REQ-18H-NOTIF-3  The portal due-digest lists the opted-in users of every
 *                    laboratory and sends each one the instruments of THEIR
 *                    customer, never another laboratory's.
 *   REQ-18H-DRAIN-1  The service-order e-mail drain claims, loads and finishes
 *                    the rows of every laboratory in their own laboratory; an
 *                    outbox row that points at another laboratory's service
 *                    order sends nothing.
 *   REQ-18H-CONTA-1  The Conta Azul scheduled sync reaches every laboratory's
 *                    connection and writes each run and event under that
 *                    laboratory.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createRoleDatabase } from "@calibra-facil/db/role-connection";
import {
  asset,
  integrationConnection,
  integrationEventLog,
  integrationSyncRun,
  member,
  notification,
  notificationPreference,
  organizationIntegration,
  serviceOrderEmailLog,
  serviceOrderEmailOutbox,
  user,
} from "@calibra-facil/db/schema";
import { DEFAULT_PREFERENCES } from "./notification-defaults";

const appRole = vi.hoisted(() => {
  const state: { current: { db: object } | null } = { current: null };
  return state;
});

// `db` resolves to a `calibra_app` session while `asApp` runs; the specs' own
// seeding and assertions (outside it) keep the owner connection.
vi.mock("@calibra-facil/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@calibra-facil/db")>();
  const db = new Proxy(actual.db, {
    get(_target, property) {
      return Reflect.get(appRole.current?.db ?? actual.db, property);
    },
  });
  return { ...actual, db };
});

const sendMock = vi.hoisted(() => vi.fn());
// Every e-mail leaves through one of two seams of the sender package (the
// platform transport for the digest, the lab-sender layer for the service-order
// mails): capture what each would send.
vi.mock("@calibra-facil/email-sender", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@calibra-facil/email-sender")>()),
  sendPlatformEmail: sendMock,
  sendEmailWithLabSender: async (params: {
    buildPayload: (sender: undefined) => Promise<unknown>;
  }) => {
    sendMock(await params.buildPayload(undefined));
    return { sent: true, emailId: "email_1" };
  },
}));

import { db } from "@calibra-facil/db";
import {
  getRecipientsByRole,
  notifyJobApproved,
  notifyCertificateReady,
  notifyStandardExpiring,
  sendPortalDueDigests,
} from "@calibra-facil/notifications";
import {
  processScheduledContaAzulIntegrationSyncs,
  processScheduledContaAzulPolls,
  type IntegrationsEnv,
} from "../modules/integrations";
import { drainServiceOrderEmailOutbox } from "./service-order-email-drain";
import { truncateAll } from "../../test/integration/db";
import {
  seedApprovedJob,
  seedBillableOrder,
  seedBillingLab,
  type BillingLab,
} from "../../test/integration/billing-fixtures";
import { assertHarnessWorkerDb } from "../../test/integration/guard";
import { seedStandard } from "../../test/integration/seed";

async function asApp<T>(run: () => Promise<T>): Promise<T> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  assertHarnessWorkerDb(url);
  const app = createRoleDatabase(url, { role: "calibra_app", max: 4 });
  appRole.current = app;
  try {
    return await run();
  } finally {
    appRole.current = null;
    await app.close();
  }
}

async function seedPortalUser(
  lab: BillingLab,
  options: { digest?: boolean } = {},
) {
  const userId = `portal-${lab.orgId}`;
  await db.insert(user).values({
    id: userId,
    name: `Portal ${lab.orgId}`,
    email: `${userId}@cliente.test`,
  });
  await db.insert(member).values({
    id: `member-${userId}`,
    organizationId: lab.clientOrgId,
    userId,
    role: "client_user",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  });
  if (options.digest) {
    await db.insert(notificationPreference).values({
      userId,
      preferences: DEFAULT_PREFERENCES,
      emailEnabled: true,
      digestFrequency: "DAILY",
    });
  }
  return userId;
}

/** What an organization's notification feed holds, as (recipient, type). */
async function notificationsIn(organizationId: string) {
  return db
    .select({
      recipientUserId: notification.recipientUserId,
      type: notification.type,
    })
    .from(notification)
    .where(eq(notification.organizationId, organizationId));
}

const ENV: IntegrationsEnv = {
  INTEGRATIONS_MASTER_KEY: Buffer.alloc(32).toString("base64"),
};

describe("notifications, digests, drains and sweeps as calibra_app (P2-18h)", () => {
  beforeEach(async () => {
    await truncateAll();
    sendMock.mockReset();
    sendMock.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("REQ-18H-NOTIF-1: a lab's notification reaches its own people and nobody in another lab", async () => {
    const a = await seedBillingLab("lab-a");
    const b = await seedBillingLab("lab-b");
    const jobA = await seedApprovedJob(a, "CAL-A-0001");
    const standardA = await seedStandard({
      organizationId: a.orgId,
      unitId: a.unitId,
      createdBy: a.userId,
    });

    // The approver is somebody else, so the job's creator (lab A) is notified.
    await asApp(() => notifyJobApproved(jobA, "approver-elsewhere"));
    expect(await notificationsIn(a.orgId)).toEqual([
      { recipientUserId: a.userId, type: "JOB_APPROVED" },
    ]);
    expect(await notificationsIn(b.orgId)).toEqual([]);

    // A compliance reminder for A's standard, asked in A: A's admin.
    await asApp(() => notifyStandardExpiring(standardA, a.orgId));
    expect(
      (await notificationsIn(a.orgId)).map((row) => row.type).toSorted(),
    ).toEqual(["JOB_APPROVED", "STANDARD_EXPIRING"]);

    // The same standard asked with lab B's organization resolves nothing there.
    await asApp(() => notifyStandardExpiring(standardA, b.orgId));
    expect(await notificationsIn(b.orgId)).toEqual([]);
    expect(await notificationsIn(a.orgId)).toHaveLength(2);

    // Sanity: the same session with no organization named sees no notification,
    // so the passes above are not an artefact of a bypassing connection.
    const unscoped = await asApp(() =>
      db.select({ id: notification.id }).from(notification),
    );
    expect(unscoped).toEqual([]);

    // The recipients of a role are the laboratory's own members.
    expect(await asApp(() => getRecipientsByRole(a.orgId, ["admin"]))).toEqual([
      a.userId,
    ]);
    expect(await asApp(() => getRecipientsByRole(b.orgId, ["admin"]))).toEqual([
      b.userId,
    ]);
  });

  it("REQ-18H-NOTIF-2: a portal notification is written under the customer's CLIENT organization, for its users only", async () => {
    const a = await seedBillingLab("lab-a");
    const b = await seedBillingLab("lab-b");
    const jobA = await seedApprovedJob(a, "CAL-A-0001");
    const portalA = await seedPortalUser(a);
    const portalB = await seedPortalUser(b);

    await asApp(() => notifyCertificateReady(jobA));

    expect(await notificationsIn(a.clientOrgId)).toEqual([
      { recipientUserId: portalA, type: "CERTIFICATE_READY" },
    ]);
    expect(await notificationsIn(b.clientOrgId)).toEqual([]);
    expect(await notificationsIn(a.orgId)).toEqual([]);
    expect(await notificationsIn(b.orgId)).toEqual([]);
    expect(portalB).toBe("portal-lab-b");
  });

  it("REQ-18H-NOTIF-3: the portal digest sends each opted-in user only their own customer's instruments", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("RESEND_FROM_EMAIL", "noreply@calibrafacil.com");
    const a = await seedBillingLab("lab-a");
    const b = await seedBillingLab("lab-b");
    await seedPortalUser(a, { digest: true });
    await seedPortalUser(b, { digest: true });
    // Both customers have an instrument that is due within the digest window.
    await db
      .update(asset)
      .set({ nextCalibrationDate: new Date("2026-06-28T00:00:00.000Z") })
      .where(eq(asset.id, a.assetId));
    await db
      .update(asset)
      .set({ nextCalibrationDate: new Date("2026-06-29T00:00:00.000Z") })
      .where(eq(asset.id, b.assetId));

    const result = await asApp(() =>
      sendPortalDueDigests(new Date("2026-06-25T12:00:00.000Z")),
    );

    expect(result).toMatchObject({ recipients: 2, sent: 2, errors: 0 });
    const sent = sendMock.mock.calls.map((call) => Object(call[0]));
    const toA = sent.find((mail) => mail.to === "portal-lab-a@cliente.test");
    const toB = sent.find((mail) => mail.to === "portal-lab-b@cliente.test");
    expect(String(toA?.html)).toContain("TAG-lab-a");
    expect(String(toA?.html)).not.toContain("TAG-lab-b");
    expect(String(toB?.html)).toContain("TAG-lab-b");
    expect(String(toB?.html)).not.toContain("TAG-lab-a");
  });

  it("REQ-18H-DRAIN-1: the service-order e-mail drain mails each lab's own order and loads nothing across labs", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("RESEND_FROM_EMAIL", "noreply@calibrafacil.com");
    const a = await seedBillingLab("lab-a");
    const b = await seedBillingLab("lab-b");
    const orderA = await seedBillableOrder(a, { number: "OS-A-1" });
    const orderB = await seedBillableOrder(b, { number: "OS-B-1" });

    const row = (lab: BillingLab, serviceOrderId: number, status: string) => ({
      organizationId: lab.orgId,
      unitId: lab.unitId,
      serviceOrderId,
      eventKey: `status_email:${status}`,
      targetStatus: status,
      payload: {},
    });
    // A's own order, B's own order, and a row of lab A that points at lab B's
    // service order (a corrupt or forged reference): lab A's load must not see it.
    await db
      .insert(serviceOrderEmailOutbox)
      .values([
        row(a, orderA, "closed"),
        row(b, orderB, "closed"),
        row(a, orderB, "delivered"),
      ]);

    const result = await asApp(() => drainServiceOrderEmailOutbox());

    expect(result.errors).toBe(0);
    expect(result.processed).toBe(3);
    // One mail per own-lab row; the cross row sends nothing.
    expect(sendMock).toHaveBeenCalledTimes(2);
    const mails = sendMock.mock.calls.map((call) => Object(call[0]));
    const toA = mails.filter((mail) => mail.to === "financeiro@lab-a.test");
    const toB = mails.filter((mail) => mail.to === "financeiro@lab-b.test");
    expect(toA).toHaveLength(1);
    expect(toB).toHaveLength(1);
    const text = (mail: { subject?: unknown; html?: unknown }) =>
      `${String(mail.subject)} ${String(mail.html)}`;
    // Non-vacuous: the own order's number and customer are in the mail ...
    expect(text(toA[0])).toContain("OS-A-1");
    expect(text(toA[0])).toContain("Customer lab-a");
    expect(text(toB[0])).toContain("OS-B-1");
    // ... and nothing of the other laboratory is.
    for (const mail of toA) {
      expect(text(mail)).not.toContain("OS-B-1");
      expect(text(mail)).not.toContain("Customer lab-b");
    }
    for (const mail of toB) {
      expect(text(mail)).not.toContain("OS-A-1");
      expect(text(mail)).not.toContain("Customer lab-a");
    }
    // The ledger holds only the two sends, each under its own laboratory.
    const ledger = await db
      .select({
        organizationId: serviceOrderEmailLog.organizationId,
        serviceOrderId: serviceOrderEmailLog.serviceOrderId,
      })
      .from(serviceOrderEmailLog);
    expect(
      ledger
        .map((entry) => `${entry.organizationId}:${entry.serviceOrderId}`)
        .toSorted(),
    ).toEqual([`${a.orgId}:${orderA}`, `${b.orgId}:${orderB}`].toSorted());
    const rows = await db
      .select({
        processedAt: serviceOrderEmailOutbox.processedAt,
        deadLetterAt: serviceOrderEmailOutbox.deadLetterAt,
      })
      .from(serviceOrderEmailOutbox);
    expect(rows).toHaveLength(3);
    for (const outbox of rows) {
      expect(outbox.processedAt).toBeInstanceOf(Date);
      expect(outbox.deadLetterAt).toBeNull();
    }
  });

  it("REQ-18H-CONTA-1: the Conta Azul scheduled sync reaches every lab's connection and writes under that lab", async () => {
    const a = await seedBillingLab("lab-a");
    const b = await seedBillingLab("lab-b");
    for (const lab of [a, b]) {
      await db.insert(organizationIntegration).values({
        id: `int-${lab.orgId}`,
        organizationId: lab.orgId,
        type: "financial_erp",
        provider: "conta_azul",
        name: "Conta Azul",
        status: "ACTIVE",
        createdBy: lab.userId,
        updatedBy: lab.userId,
      });
      await db.insert(integrationConnection).values({
        id: `conn-${lab.orgId}`,
        integrationId: `int-${lab.orgId}`,
        organizationId: lab.orgId,
        credentialType: "oauth2",
        config: {
          enabledTargets: { customers: true },
          schedules: {
            customer: {
              frequency: "daily",
              lastScheduledRunAt: null,
              mode: "scheduled",
              nextScheduledRunAt: "2026-05-24T11:59:00.000Z",
            },
          },
        },
        encryptedSecret: "dummy-encrypted",
        secretIv: "dummy-iv",
        createdBy: lab.userId,
        updatedBy: lab.userId,
      });
    }
    const dispatched: Array<{ organizationId: string; integrationId: string }> =
      [];

    const result = await asApp(() =>
      processScheduledContaAzulIntegrationSyncs({
        env: ENV,
        now: new Date("2026-05-24T12:00:00.000Z"),
        dispatch: async (message) => {
          dispatched.push({
            organizationId: message.organizationId,
            integrationId: message.integrationId,
          });
        },
      }),
    );

    expect(result).toMatchObject({
      scannedIntegrations: 2,
      dueRuns: 2,
      queuedRuns: 2,
      failedRuns: 0,
    });
    expect(
      dispatched.toSorted((x, y) =>
        x.integrationId.localeCompare(y.integrationId),
      ),
    ).toEqual([
      { organizationId: a.orgId, integrationId: `int-${a.orgId}` },
      { organizationId: b.orgId, integrationId: `int-${b.orgId}` },
    ]);
    const runs = await db
      .select({
        organizationId: integrationSyncRun.organizationId,
        integrationId: integrationSyncRun.integrationId,
        status: integrationSyncRun.status,
      })
      .from(integrationSyncRun);
    expect(
      runs
        .map(
          (run) => `${run.organizationId}:${run.integrationId}:${run.status}`,
        )
        .toSorted(),
    ).toEqual([
      `${a.orgId}:int-${a.orgId}:PENDING`,
      `${b.orgId}:int-${b.orgId}:PENDING`,
    ]);
    const events = await db
      .select({
        organizationId: integrationEventLog.organizationId,
        integrationId: integrationEventLog.integrationId,
        event: integrationEventLog.event,
      })
      .from(integrationEventLog);
    expect(
      events.every(
        (event) => event.integrationId === `int-${event.organizationId}`,
      ),
    ).toBe(true);
    expect(events.map((event) => event.event)).toEqual([
      "sync.scheduled_requested",
      "sync.scheduled_requested",
    ]);
  });

  it("REQ-18H-CONTA-2: the Conta Azul poll sweep records each lab's runs and events under that lab, a failing lab included", async () => {
    const a = await seedBillingLab("lab-a");
    const b = await seedBillingLab("lab-b");
    // Lab A has payment polling on (its stored token cannot be decrypted, so the
    // poll fails before any remote call); lab B has every poll off.
    for (const [lab, paymentPolling] of [
      [a, true],
      [b, false],
    ] as const) {
      await db.insert(organizationIntegration).values({
        id: `int-${lab.orgId}`,
        organizationId: lab.orgId,
        type: "financial_erp",
        provider: "conta_azul",
        name: "Conta Azul",
        status: "ACTIVE",
        createdBy: lab.userId,
        updatedBy: lab.userId,
      });
      await db.insert(integrationConnection).values({
        id: `conn-${lab.orgId}`,
        integrationId: `int-${lab.orgId}`,
        organizationId: lab.orgId,
        credentialType: "oauth2",
        config: {
          enabledTargets: { paymentStatusPolling: paymentPolling },
          polling: {},
        },
        encryptedSecret: "dummy-encrypted",
        secretIv: "dummy-iv",
        createdBy: lab.userId,
        updatedBy: lab.userId,
      });
    }

    const result = await asApp(() =>
      processScheduledContaAzulPolls({
        env: ENV,
        now: new Date("2026-05-24T12:00:00.000Z"),
      }),
    );

    expect(result.scannedIntegrations).toBe(2);
    expect(result.failedPolls).toBe(1);
    const runs = await db
      .select({
        organizationId: integrationSyncRun.organizationId,
        status: integrationSyncRun.status,
      })
      .from(integrationSyncRun);
    expect(runs).toEqual([{ organizationId: a.orgId, status: "FAILED" }]);
    const events = await db
      .select({
        organizationId: integrationEventLog.organizationId,
        integrationId: integrationEventLog.integrationId,
        event: integrationEventLog.event,
      })
      .from(integrationEventLog);
    // Every event names the integration of its own laboratory.
    expect(
      events.every(
        (event) => event.integrationId === `int-${event.organizationId}`,
      ),
    ).toBe(true);
    const eventsOf = (organizationId: string) =>
      events
        .filter((event) => event.organizationId === organizationId)
        .map((event) => event.event);
    expect(eventsOf(a.orgId)).toContain("sync.failed");
    expect(eventsOf(b.orgId)).not.toContain("sync.failed");
    expect(eventsOf(b.orgId).length).toBeGreaterThan(0);
  });
});
