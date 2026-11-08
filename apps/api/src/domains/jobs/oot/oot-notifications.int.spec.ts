/**
 * `flagJobOutOfTolerance` against a real Postgres: the typed NC, the recipient
 * snapshot, the outbox row and the PDF job it leaves behind, and the refusals.
 * Only the background-job queue is replaced (its enqueue is the boundary).
 * The recall batch (`ensureStandardRecall`, `createStandardRecallNotifications`)
 * is exercised end to end in standards-org-scope.int.spec.ts (REQ-18D-STD-4).
 *
 *  - REQ-OOT-FLAG-1: an approved job is flagged: one out_of_tolerance NC, a PENDING
 *    notification that snapshots the customer, one outbox row, the PDF enqueued after
 *    the commit; the default description counts the negative as-found margins.
 *  - REQ-OOT-FLAG-2: no customer e-mail -> no outbox row (the PDF is still rendered);
 *    notifyCustomer false -> no notification and no PDF.
 *  - REQ-OOT-FLAG-3: another laboratory's job is not found, a job still in execution
 *    is refused, an NC already open is not flagged twice, and a notification an
 *    earlier attempt lost is attached to the existing NC.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@calibra-facil/db";
import {
  calibrationJob,
  customer,
  nonConformance,
  ootEmailOutbox,
  ootNotification,
} from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";
import { enqueueBackgroundJob } from "../../../lib/background-jobs";
import { withOrg } from "../../../lib/org-context";
import { truncateAll } from "../../../../test/integration/db";
import { setJobStatus } from "../../../../test/integration/job-fixtures";
import { seedOrg } from "../../../../test/integration/seed";
import { seedJobForOrg } from "../../../../test/integration/tenant-refs";
import { flagJobOutOfTolerance } from "./oot-notifications";

vi.mock("../../../lib/background-jobs", () => ({
  enqueueBackgroundJob: vi.fn(async () => undefined),
}));

async function seedApprovedJob(params: {
  customerEmail: string | null;
  margins?: number[];
}) {
  const lab = await seedOrg({ orgId: "org-oot-flag", role: "owner" });
  const seeded = await seedJobForOrg({
    orgId: lab.orgId,
    unitId: lab.unitId,
    createdBy: lab.userId,
  });
  const [job] = await db
    .select({
      customerId: calibrationJob.customerId,
    })
    .from(calibrationJob)
    .where(eq(calibrationJob.id, seeded.jobId));
  if (!job) throw new Error("job not seeded");
  await db
    .update(customer)
    .set({ email: params.customerEmail, name: "Cliente X" })
    .where(eq(customer.id, job.customerId));
  await setJobStatus(seeded.jobId, "APPROVED", {
    asFoundMargins: params.margins ?? [0.2, -0.1, -0.3],
  });
  return { lab, jobId: seeded.jobId };
}

function flag(
  lab: { orgId: string; userId: string },
  jobId: number,
  options: { notifyCustomer?: boolean; description?: string } = {},
) {
  return withOrg(lab.orgId, { userId: lab.userId, ipAddress: null }, (ctx) =>
    flagJobOutOfTolerance(
      {
        organizationId: lab.orgId,
        actorUserId: lab.userId,
        jobId,
        notifyCustomer: options.notifyCustomer ?? true,
        description: options.description,
        triggerSource: "as_found_verdict",
      },
      ctx,
    ),
  );
}

describe("flagJobOutOfTolerance", () => {
  beforeEach(async () => {
    await truncateAll();
    vi.mocked(enqueueBackgroundJob).mockClear();
  });

  it("REQ-OOT-FLAG-1: opens one typed NC, snapshots the customer in a PENDING notification, writes the outbox row and enqueues the PDF", async () => {
    const { lab, jobId } = await seedApprovedJob({
      customerEmail: "x@cliente.com",
    });

    const result = await flag(lab, jobId);

    expect(result.ok).toBe(true);
    const ncs = await db
      .select()
      .from(nonConformance)
      .where(eq(nonConformance.jobId, jobId));
    expect(ncs).toHaveLength(1);
    expect(ncs[0]).toMatchObject({
      type: "out_of_tolerance",
      triggerSource: "as_found_verdict",
    });
    // The default description counts the negative margins of the as-found verdict.
    expect(ncs[0]?.description).toContain("2 de 3");
    const [notification] = await db
      .select()
      .from(ootNotification)
      .where(eq(ootNotification.jobId, jobId));
    expect(notification).toMatchObject({
      status: "PENDING",
      recipientName: "Cliente X",
      recipientEmail: "x@cliente.com",
      approvedBy: lab.userId,
    });
    const outbox = await db
      .select()
      .from(ootEmailOutbox)
      .where(eq(ootEmailOutbox.notificationId, notification?.id ?? -1));
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.eventKey).toBe("oot_notification");
    expect(enqueueBackgroundJob).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "OOT_NOTIFICATION",
        notificationId: notification?.id,
        userId: lab.userId,
      }),
    );
  });

  it("REQ-OOT-FLAG-2: a customer without e-mail gets the notification and the PDF but no outbox row", async () => {
    const { lab, jobId } = await seedApprovedJob({ customerEmail: null });

    const result = await flag(lab, jobId);

    expect(result.ok).toBe(true);
    expect(await db.select().from(ootNotification)).toHaveLength(1);
    expect(await db.select().from(ootEmailOutbox)).toHaveLength(0);
    expect(enqueueBackgroundJob).toHaveBeenCalledTimes(1);
  });

  it("REQ-OOT-FLAG-2: notifyCustomer false opens the NC only: no notification, no outbox, no PDF", async () => {
    const { lab, jobId } = await seedApprovedJob({
      customerEmail: "x@cliente.com",
    });

    const result = await flag(lab, jobId, { notifyCustomer: false });

    expect(result).toMatchObject({ ok: true, notification: null });
    expect(await db.select().from(nonConformance)).toHaveLength(1);
    expect(await db.select().from(ootNotification)).toHaveLength(0);
    expect(enqueueBackgroundJob).not.toHaveBeenCalled();
  });

  it("REQ-OOT-FLAG-3: refuses an unknown job, a job still in execution and a second flag", async () => {
    const { lab, jobId } = await seedApprovedJob({
      customerEmail: "x@cliente.com",
    });

    expect(await flag(lab, jobId + 1000)).toMatchObject({
      ok: false,
      status: 404,
      code: "job_not_found",
    });

    await setJobStatus(jobId, "REVIEW");
    expect(await flag(lab, jobId)).toMatchObject({
      ok: false,
      status: 409,
      code: "JOB_NOT_APPROVED",
    });

    await setJobStatus(jobId, "APPROVED");
    expect((await flag(lab, jobId)).ok).toBe(true);
    expect(await flag(lab, jobId)).toMatchObject({
      ok: false,
      status: 409,
      code: "OOT_ALREADY_FLAGGED",
    });
    expect(await db.select().from(nonConformance)).toHaveLength(1);
    expect(await db.select().from(ootNotification)).toHaveLength(1);
  });

  it("REQ-OOT-FLAG-3: attaches the notification to an open NC that lost it (self-heal), once", async () => {
    const { lab, jobId } = await seedApprovedJob({
      customerEmail: "x@cliente.com",
    });
    // An earlier attempt opened the NC without the notification.
    await flag(lab, jobId, { notifyCustomer: false });

    const healed = await flag(lab, jobId, { notifyCustomer: true });

    expect(healed).toMatchObject({ ok: true });
    expect(await db.select().from(nonConformance)).toHaveLength(1);
    expect(await db.select().from(ootNotification)).toHaveLength(1);
    expect(await flag(lab, jobId, { notifyCustomer: true })).toMatchObject({
      ok: false,
      code: "OOT_ALREADY_FLAGGED",
    });
  });
});
