/**
 * The §7.10 out-of-tolerance email drain against a real Postgres. Only the
 * mail transport is replaced (`sendOotCustomerEmail`); the outbox, the
 * notification, the suppression list and the row-level-security paths run for
 * real, and each case reads the rows back.
 *
 *  - REQ-OOT-DRAIN-1: a sent notice marks the row processed and the notification SENT,
 *    with the ack link; a recall batch renders the recall variant.
 *  - REQ-OOT-DRAIN-2: no PDF yet defers without spending an attempt; a failed send
 *    releases (attempts + 1) and the exhausting one dead-letters; production without
 *    storage never sends the notice without its PDF.
 *  - REQ-OOT-DRAIN-3: an acknowledged notice, a suppressed address or an address
 *    that is not one end the row without sending, and an ACKNOWLEDGED notice never
 *    regresses.
 *  - REQ-OOT-DRAIN-4: a row leased a moment ago is left alone, a stale lease is taken
 *    over, and one row throwing does not abort the batch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@calibra-facil/db";
import {
  nonConformance,
  ootEmailOutbox,
  ootNotification,
  standardRecall,
} from "@calibra-facil/db/schema";
import { eq, sql } from "drizzle-orm";
import { OotNotificationEmail } from "@calibra-facil/email";
import {
  sendOotCustomerEmail,
  suppressEmail,
} from "@calibra-facil/notifications";
import { truncateAll } from "../../../../test/integration/db";
import { seedOrg, seedStandard } from "../../../../test/integration/seed";
import { seedJobForOrg } from "../../../../test/integration/tenant-refs";
import { withStatusRepair } from "../../../../test/integration/state-fixtures";
import { drainOotEmailOutbox } from "./oot-email-drain";

vi.mock("@calibra-facil/notifications", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@calibra-facil/notifications")>();
  return {
    ...actual,
    sendOotCustomerEmail: vi.fn(async () => ({ sent: true, emailId: "e1" })),
  };
});

// The real template, observed: what the drain hands it is what the e-mail says.
vi.mock("@calibra-facil/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@calibra-facil/email")>();
  return {
    ...actual,
    OotNotificationEmail: vi.fn(actual.OotNotificationEmail),
  };
});

type World = Awaited<ReturnType<typeof seedWorld>>;

async function seedWorld() {
  const lab = await seedOrg({ orgId: "org-oot-drain", role: "owner" });
  const { jobId, assetId } = await seedJobForOrg({
    orgId: lab.orgId,
    unitId: lab.unitId,
    createdBy: lab.userId,
  });
  return { lab, jobId, assetId };
}

let sequence = 0;

/** One owed e-mail: a nonconformity, its notification and the outbox row. */
async function seedOwed(
  world: World,
  overrides: {
    notification?: Partial<typeof ootNotification.$inferInsert>;
    outbox?: Partial<typeof ootEmailOutbox.$inferInsert>;
    recall?: boolean;
  } = {},
) {
  sequence += 1;
  const { lab, jobId } = world;
  const [nc] = await withStatusRepair((tx) =>
    tx
      .insert(nonConformance)
      .values({
        ncNumber: `NC-2026-${String(sequence).padStart(4, "0")}`,
        organizationId: lab.orgId,
        jobId,
        type: "calibration",
        description: "Desvio",
        detectedBy: lab.userId,
        detectedAt: new Date("2026-03-11T12:00:00.000Z"),
        createdBy: lab.userId,
      })
      .returning({ id: nonConformance.id }),
  );
  if (!nc) throw new Error("nc not seeded");

  let recallId: number | null = null;
  if (overrides.recall) {
    const standardId = await seedStandard({
      organizationId: lab.orgId,
      unitId: lab.unitId,
      createdBy: lab.userId,
      name: "Conjunto de Pesos E2",
    });
    const [recall] = await withStatusRepair((tx) =>
      tx
        .insert(standardRecall)
        .values({
          organizationId: lab.orgId,
          standardId,
          ncId: nc.id,
          createdBy: lab.userId,
        })
        .returning({ id: standardRecall.id }),
    );
    recallId = recall?.id ?? null;
  }

  const [notification] = await withStatusRepair((tx) =>
    tx
      .insert(ootNotification)
      .values({
        organizationId: lab.orgId,
        ncId: nc.id,
        jobId,
        recallId,
        certificateNumber: "CAL-2026-0100",
        recipientName: "Cliente Exemplo",
        recipientEmail: "qualidade@cliente.com.br",
        status: "GENERATED",
        pdfR2Key: "org/oot/notificacao.pdf",
        approvedBy: lab.userId,
        ...overrides.notification,
      })
      .returning({
        id: ootNotification.id,
        ackToken: ootNotification.ackToken,
      }),
  );
  if (!notification) throw new Error("notification not seeded");

  const [outbox] = await withStatusRepair((tx) =>
    tx
      .insert(ootEmailOutbox)
      .values({
        organizationId: lab.orgId,
        notificationId: notification.id,
        eventKey: "oot_notification",
        payload: {},
        ...overrides.outbox,
      })
      .returning({ id: ootEmailOutbox.id }),
  );
  if (!outbox) throw new Error("outbox not seeded");
  return {
    outboxId: outbox.id,
    notificationId: notification.id,
    ackToken: notification.ackToken,
  };
}

async function outboxOf(id: number) {
  const [row] = await db
    .select()
    .from(ootEmailOutbox)
    .where(eq(ootEmailOutbox.id, id));
  if (!row) throw new Error("outbox row vanished");
  return row;
}

async function notificationOf(id: number) {
  const [row] = await db
    .select()
    .from(ootNotification)
    .where(eq(ootNotification.id, id));
  if (!row) throw new Error("notification vanished");
  return row;
}

const send = vi.mocked(sendOotCustomerEmail);

describe("drainOotEmailOutbox", () => {
  let world: World;

  beforeEach(async () => {
    await truncateAll();
    send.mockReset();
    vi.mocked(OotNotificationEmail).mockClear();
    send.mockResolvedValue({ sent: true, emailId: "e1" });
    world = await seedWorld();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("REQ-OOT-DRAIN-1: sends the notice with the ack link, marks the row processed and the notification SENT", async () => {
    const owed = await seedOwed(world);

    const result = await drainOotEmailOutbox();

    expect(result).toMatchObject({ sent: 1, errors: 0, released: 0 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0].recipientEmail).toBe(
      "qualidade@cliente.com.br",
    );
    expect(vi.mocked(OotNotificationEmail).mock.calls[0]?.[0]).toMatchObject({
      kind: "as_found",
      ackUrl: expect.stringContaining(`/api/public/oot-ack/${owed.ackToken}`),
    });
    expect((await outboxOf(owed.outboxId)).processedAt).toBeInstanceOf(Date);
    const notification = await notificationOf(owed.notificationId);
    expect(notification.status).toBe("SENT");
    expect(notification.sentAt).toBeInstanceOf(Date);
  });

  it("REQ-OOT-DRAIN-1: a recall-batch notification renders the standard-recall variant", async () => {
    await seedOwed(world, { recall: true });

    const result = await drainOotEmailOutbox();

    expect(result.sent).toBe(1);
    expect(vi.mocked(OotNotificationEmail).mock.calls[0]?.[0]).toMatchObject({
      kind: "standard_recall",
      standardName: "Conjunto de Pesos E2",
    });
  });

  it("REQ-OOT-DRAIN-2: defers without spending an attempt while the PDF is not rendered", async () => {
    const owed = await seedOwed(world, { notification: { pdfR2Key: null } });

    const result = await drainOotEmailOutbox();

    expect(result).toMatchObject({ deferred: 1, sent: 0 });
    expect(send).not.toHaveBeenCalled();
    const row = await outboxOf(owed.outboxId);
    expect(row.attempts).toBe(0);
    expect(row.claimedAt).toBeNull();
    expect(row.processedAt).toBeNull();
    expect(row.lastError).toContain("PDF");
  });

  it("REQ-OOT-DRAIN-2: a failed send releases the row with one more attempt, and the attempt that exhausts the budget dead-letters it", async () => {
    send.mockResolvedValue({ sent: false, error: "boom" });
    const first = await seedOwed(world);
    const last = await seedOwed(world, { outbox: { attempts: 2 } });

    const result = await drainOotEmailOutbox({ maxAttempts: 3 });

    expect(result.released).toBe(2);
    const released = await outboxOf(first.outboxId);
    expect(released).toMatchObject({
      attempts: 1,
      lastError: "boom",
      claimedAt: null,
      processedAt: null,
      deadLetterAt: null,
    });
    const exhausted = await outboxOf(last.outboxId);
    expect(exhausted.attempts).toBe(3);
    expect(exhausted.deadLetterAt).toBeInstanceOf(Date);
    expect((await notificationOf(first.notificationId)).status).toBe(
      "GENERATED",
    );
  });

  it("REQ-OOT-DRAIN-2: production without storage never sends the notice without its PDF; the row is released for retry", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("R2_ENDPOINT", "");
    const owed = await seedOwed(world);

    const result = await drainOotEmailOutbox();

    expect(result).toMatchObject({ errors: 1, released: 1, sent: 0 });
    expect(send).not.toHaveBeenCalled();
    const row = await outboxOf(owed.outboxId);
    expect(row.attempts).toBe(1);
    expect(row.processedAt).toBeNull();
  });

  it("REQ-OOT-DRAIN-3: an acknowledged notice ends the row without sending and stays ACKNOWLEDGED", async () => {
    const owed = await seedOwed(world, {
      notification: {
        status: "ACKNOWLEDGED",
        acknowledgedAt: new Date("2026-03-12T12:00:00.000Z"),
        acknowledgedVia: "manual",
      },
    });

    const result = await drainOotEmailOutbox();

    expect(result.skipped).toBe(1);
    expect(send).not.toHaveBeenCalled();
    expect((await outboxOf(owed.outboxId)).processedAt).toBeInstanceOf(Date);
    expect((await notificationOf(owed.notificationId)).status).toBe(
      "ACKNOWLEDGED",
    );
  });

  it("REQ-OOT-DRAIN-3: a suppressed address and an address that is not one end the row without sending", async () => {
    await suppressEmail({
      email: "Bloqueado@cliente.com.br",
      scope: "all",
      reason: "hard_bounce",
      source: "resend_webhook",
    });
    const suppressed = await seedOwed(world, {
      notification: { recipientEmail: "bloqueado@cliente.com.br" },
    });
    const malformed = await seedOwed(world, {
      notification: { recipientEmail: "sem-arroba" },
    });

    const result = await drainOotEmailOutbox();

    expect(result.skipped).toBe(2);
    expect(send).not.toHaveBeenCalled();
    expect((await outboxOf(suppressed.outboxId)).processedAt).not.toBeNull();
    expect((await outboxOf(malformed.outboxId)).processedAt).not.toBeNull();
  });

  it("REQ-OOT-DRAIN-4: leaves a row leased a moment ago alone and takes over a stale lease", async () => {
    const fresh = await seedOwed(world, { outbox: { claimedAt: new Date() } });
    const stale = await seedOwed(world);
    await db.execute(
      sql`UPDATE oot_email_outbox SET claimed_at = now() - interval '10 minutes' WHERE id = ${stale.outboxId}`,
    );

    const result = await drainOotEmailOutbox();

    expect(result.sent).toBe(1);
    expect((await outboxOf(fresh.outboxId)).processedAt).toBeNull();
    expect((await outboxOf(stale.outboxId)).processedAt).toBeInstanceOf(Date);
  });

  it("REQ-OOT-DRAIN-4: one row throwing does not abort the batch", async () => {
    const first = await seedOwed(world);
    const second = await seedOwed(world);
    send.mockRejectedValueOnce(new Error("transport exploded"));

    const result = await drainOotEmailOutbox();

    expect(result).toMatchObject({ errors: 1, released: 1, sent: 1 });
    expect(await outboxOf(first.outboxId)).toMatchObject({
      attempts: 1,
      lastError: "transport exploded",
      processedAt: null,
    });
    expect((await outboxOf(second.outboxId)).processedAt).toBeInstanceOf(Date);
  });
});
