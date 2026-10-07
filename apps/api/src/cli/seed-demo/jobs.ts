import { db } from "@calibra-facil/db";
import { calibrationJob, notification } from "@calibra-facil/db/schema";
import { completeQueueJob } from "@calibra-facil/db/queue";
import { processBackgroundJob } from "@calibra-facil/worker";
import { and, eq, inArray, sql } from "drizzle-orm";

import { createWorkerRuntimeEnv } from "../../lib/runtime-env";
import { DEMO_ACTORS, LAB_ID, isRecord, numberField, stringField } from "./api";
import { createRng } from "./prng";
import type { SeededAsset } from "./assets";
import type { SeedContext } from "./context";
import { buildExecutionData } from "./job-data";
import {
  buildJobPlan,
  FULL_PLAN,
  QUICK_PLAN,
  REJECTION_REASONS,
  type PlannedJob,
} from "./job-plan";
import { DEMO_SERVICES } from "./services";
import type { ServiceIds } from "./services";
import type { StandardIds } from "./standards";
import { applyJobTimeline } from "./timeline";
import type { DemoCustomer } from "./customers";
import { DEMO_CUSTOMERS } from "./customers";

/** Standards a method's worksheet relies on; they depend on the instrument, never on the draw. */
function standardKeysFor(
  templateKey: PlannedJob["templateKey"],
  specs: SeededAsset["specifications"],
) {
  return buildExecutionData(templateKey, specs, createRng(0)).standardKeys;
}

/** In-progress worksheets are only partly filled. */
function limitRows(
  data: Record<string, unknown>,
  planned: PlannedJob,
): Record<string, unknown> {
  const key = Object.keys(data)[0];
  const rows = key ? data[key] : undefined;
  if (
    planned.final === "IN_PROGRESS" &&
    planned.filledPoints &&
    key &&
    Array.isArray(rows)
  ) {
    return { [key]: rows.slice(0, planned.filledPoints) };
  }
  return data;
}

/** Error diagnostics the engine attached to a saved worksheet. */
function calculationErrors(body: unknown): unknown[] {
  const data = isRecord(body) ? body.data : undefined;
  const results = isRecord(data) ? data.results : undefined;
  const execution = isRecord(results) ? results.__compiledExecution : undefined;
  const diagnostics = isRecord(execution) ? execution.diagnostics : undefined;
  if (!Array.isArray(diagnostics)) return [];
  return diagnostics.filter(
    (entry) => isRecord(entry) && entry.severity === "error",
  );
}

const LAB_ADDRESS =
  "Laboratório Modelo, Rua das Calibrações, 1250, Centro Cívico, Curitiba/PR";

export type SeedJob = {
  planned: PlannedJob;
  jobId: number;
  assetId: number;
  customerId: number;
};

function serviceNameFor(templateKey: PlannedJob["templateKey"]): string {
  const spec = DEMO_SERVICES.find((entry) => entry.templateKey === templateKey);
  if (!spec) throw new Error(`No service sells method ${templateKey}`);
  return spec.name;
}

function customerAddress(entry: DemoCustomer): string {
  const a = entry.address;
  return `${entry.name}, ${a.street}, ${a.number}, ${a.neighbourhood}, ${a.city}/${a.state}`;
}

async function findJobForAsset(assetId: number) {
  const [row] = await db
    .select({ id: calibrationJob.id, status: calibrationJob.status })
    .from(calibrationJob)
    .where(
      and(
        eq(calibrationJob.organizationId, LAB_ID),
        eq(calibrationJob.assetId, assetId),
      ),
    )
    .limit(1);
  return row;
}

/**
 * The whole calibration history. Every job is created and moved through the real
 * lifecycle by the same routes the web app calls (create, execute, submit,
 * approve/reject); approved jobs then have their certificate rendered by the
 * worker's own code (Gotenberg, and signing when a certificate is configured).
 * Afterwards the timestamps are rewritten to the planned timeline.
 */
export async function seedJobs(
  ctx: SeedContext,
  assets: readonly SeededAsset[],
  serviceIds: ServiceIds,
  standardIds: StandardIds,
  options: {
    quick: boolean;
    concurrency: number;
    certificates: number | "all";
  },
): Promise<SeedJob[]> {
  const size = options.quick ? QUICK_PLAN : FULL_PLAN;
  const plan = buildJobPlan(ctx.now, assets, size, ctx.rng.fork("job-plan"));
  const assetByTag = new Map(assets.map((asset) => [asset.tag, asset]));

  const dataRng = ctx.rng.fork("job-data");
  const workerEnv = createWorkerRuntimeEnv();
  const seeded: SeedJob[] = [];
  let done = 0;
  const startedAt = ctx.now;
  const t0 = Date.now();

  type Slot = {
    planned: PlannedJob;
    asset: SeededAsset;
    serviceId: number;
    jobId: number;
    status: string;
  };

  // 1. Create every job, one at a time: job and certificate numbers follow creation order.
  const slots: Slot[] = [];
  for (const planned of plan) {
    const asset = assetByTag.get(planned.assetTag);
    if (!asset)
      throw new Error(
        `Planned job refers to unknown asset ${planned.assetTag}`,
      );
    const serviceId = serviceIds.get(serviceNameFor(planned.templateKey));
    if (!serviceId)
      throw new Error(`Service for ${planned.templateKey} was not seeded`);
    const row = await findJobForAsset(asset.id);
    if (row) {
      slots.push({
        planned,
        asset,
        serviceId,
        jobId: row.id,
        status: row.status,
      });
      continue;
    }
    const created = await ctx.api.call(
      planned.technician,
      "POST",
      "/api/jobs",
      {
        assetId: asset.id,
        serviceId,
        technicianId: DEMO_ACTORS[planned.technician].userId,
        dueDate: planned.dueDate.toISOString(),
      },
    );
    slots.push({
      planned,
      asset,
      serviceId,
      jobId: numberField(created, "id"),
      status: stringField(created, "status"),
    });
  }
  ctx.log(
    `  jobs: ${slots.length} created in ${Math.round((Date.now() - t0) / 1000)}s`,
  );

  // Only the newest approvals get a rendered PDF unless asked otherwise: each
  // one is a Chromium render, and the history older than a couple of weeks is
  // never opened in a demo. Older approvals are still approved and still have
  // their results; they just carry no certificate file.
  const approvedNewestFirst = slots
    .filter((slot) => slot.planned.final === "APPROVED")
    .sort(
      (a, b) =>
        (b.planned.decidedAt?.getTime() ?? 0) -
        (a.planned.decidedAt?.getTime() ?? 0),
    );
  const renderSlots = new Set(
    (options.certificates === "all"
      ? approvedNewestFirst
      : approvedNewestFirst.slice(0, options.certificates)
    ).map((slot) => slot.planned.slot),
  );

  // 2. Walk each job through its lifecycle, a few at a time.
  const advance = async (slot: Slot): Promise<SeedJob> => {
    const { planned, asset, jobId } = slot;
    let status = slot.status;
    // Each slot draws from its own generator, so what a re-run skips never
    // shifts the data of the slots after it.
    const slotRng = dataRng.fork(`slot-${planned.slot}`);
    const selectedStandardIds = standardKeysFor(
      planned.templateKey,
      asset.specifications,
    ).map((key) => {
      const id = standardIds.get(key);
      if (!id) throw new Error(`Standard ${key} was not seeded`);
      return id;
    });
    const customerEntry = DEMO_CUSTOMERS.find(
      (entry) => entry.code === asset.customerCode,
    );
    if (!customerEntry)
      throw new Error(`Unknown customer ${asset.customerCode}`);
    const environment = {
      temperature: Number(slotRng.normal(22.3, 0.5).toFixed(1)),
      humidity: Number(slotRng.normal(48, 3.5).toFixed(0)),
      pressure: Number(slotRng.normal(1013, 4).toFixed(0)),
    };
    const calibrationLocation =
      planned.location === "customer_site"
        ? { type: "customer_site", addressText: customerAddress(customerEntry) }
        : { type: "lab", addressText: LAB_ADDRESS };

    if (status === "DRAFT" && planned.final !== "DRAFT") {
      // The exact-decimal engine can refuse an unlucky set of readings; the
      // technician "re-measures" until the worksheet calculates.
      let saved = false;
      for (let attempt = 0; attempt < 12 && !saved; attempt += 1) {
        const execution = buildExecutionData(
          planned.templateKey,
          asset.specifications,
          slotRng,
        );
        // eslint-disable-next-line no-await-in-loop
        const result = await ctx.api.request(
          planned.technician,
          "POST",
          `/api/jobs/${jobId}/execute`,
          {
            data: limitRows(execution.data, planned),
            selectedStandardIds,
            environment,
            calibrationLocation,
          },
        );
        if (result.ok && calculationErrors(result.body).length === 0)
          saved = true;
        else if (!result.ok && result.status !== 422) {
          throw new Error(
            `execute job ${jobId} -> ${result.status} ${JSON.stringify(result.body).slice(0, 400)}`,
          );
        }
      }
      if (!saved)
        throw new Error(
          `Job ${jobId} (slot ${planned.slot}): no worksheet calculated cleanly`,
        );
      status = "IN_PROGRESS";
    }
    if (
      status === "IN_PROGRESS" &&
      !["DRAFT", "IN_PROGRESS"].includes(planned.final)
    ) {
      if (!planned.performedAt)
        throw new Error(`Job slot ${planned.slot} has no calibration date`);
      const [saved] = await db
        .select({ data: calibrationJob.data })
        .from(calibrationJob)
        .where(eq(calibrationJob.id, jobId))
        .limit(1);
      await ctx.api.call(
        planned.technician,
        "POST",
        `/api/jobs/${jobId}/submit`,
        {
          data: saved?.data ?? {},
          selectedStandardIds,
          environment,
          calibrationLocation,
          performedAt: planned.performedAt.toISOString(),
          backdateReason:
            "Ensaio concluído em bancada; dados lançados após a conferência da planilha.",
        },
      );
      status = "REVIEW";
    }
    if (
      status === "REVIEW" &&
      planned.reviewer &&
      planned.final === "REJECTED"
    ) {
      await ctx.api.call(
        planned.reviewer,
        "POST",
        `/api/jobs/${jobId}/reject`,
        {
          reason: planned.note ?? REJECTION_REASONS[0],
        },
      );
      status = "REJECTED";
    }
    if (
      status === "REVIEW" &&
      planned.reviewer &&
      planned.final === "APPROVED"
    ) {
      await ctx.api.call(
        planned.reviewer,
        "POST",
        `/api/jobs/${jobId}/approve`,
        {
          reason: planned.note,
        },
      );
      status = "GENERATING_PDF";
    }

    // The planned timeline goes in before the certificate is drawn, so the PDF
    // carries the planned dates; the render itself adds a few "now" stamps that
    // are rewritten afterwards.
    await applyJobTimeline(jobId, asset.id, planned, startedAt);
    if (
      status === "GENERATING_PDF" &&
      planned.final === "APPROVED" &&
      planned.reviewer
    ) {
      if (renderSlots.has(planned.slot)) {
        await renderCertificate(
          workerEnv,
          jobId,
          DEMO_ACTORS[planned.reviewer].userId,
        );
      } else {
        await markIssuedWithoutRender(jobId);
      }
      await applyJobTimeline(jobId, asset.id, planned, startedAt);
    }
    done += 1;
    if (done % 20 === 0)
      ctx.log(`  jobs: ${done}/${slots.length} through the workflow`);
    return {
      planned,
      jobId,
      assetId: asset.id,
      customerId: await customerIdOfAsset(asset.id),
    };
  };

  const pending = [...slots];
  const lanes = Math.max(1, options.concurrency);
  await Promise.all(
    Array.from({ length: lanes }, async () => {
      for (let next = pending.shift(); next; next = pending.shift()) {
        // eslint-disable-next-line no-await-in-loop
        seeded.push(await advance(next));
      }
    }),
  );
  seeded.sort((a, b) => a.planned.slot - b.planned.slot);
  ctx.log(
    `  jobs: workflow and certificates done in ${Math.round((Date.now() - t0) / 1000)}s`,
  );

  return seeded;
}

async function customerIdOfAsset(assetId: number): Promise<number> {
  const [row] = await db
    .select({ customerId: calibrationJob.customerId })
    .from(calibrationJob)
    .where(eq(calibrationJob.assetId, assetId))
    .limit(1);
  if (!row) throw new Error(`No job for asset ${assetId}`);
  return row.customerId;
}

/** Closes the approval of a job whose certificate file is not rendered (see `renderSlots`). */
async function markIssuedWithoutRender(jobId: number): Promise<void> {
  await db
    .update(calibrationJob)
    .set({ status: "APPROVED" })
    .where(
      and(
        eq(calibrationJob.id, jobId),
        eq(calibrationJob.status, "GENERATING_PDF"),
      ),
    );
  await completeQueuedCertificate(jobId);
}

async function completeQueuedCertificate(jobId: number): Promise<void> {
  const queued = await db.execute(sql`
    select id from app_queue_job
    where type = 'CERTIFICATE' and status <> 'COMPLETED' and (payload->>'jobId')::int = ${jobId}
  `);
  const rows = Array.isArray(queued) ? queued : [];
  for (const queuedRow of rows) {
    const id: unknown = Reflect.get(queuedRow, "id");
    if (typeof id === "number") {
      // eslint-disable-next-line no-await-in-loop
      await completeQueueJob(id);
    }
  }
}

async function renderCertificate(
  env: ReturnType<typeof createWorkerRuntimeEnv>,
  jobId: number,
  userId: string,
): Promise<void> {
  const [job] = await db
    .select({ status: calibrationJob.status })
    .from(calibrationJob)
    .where(eq(calibrationJob.id, jobId))
    .limit(1);
  if (job?.status !== "GENERATING_PDF") return;
  await processBackgroundJob(env, { jobId, userId });
  // The row the approval queued is now served: close it so a worker run later
  // does not render the same certificate again.
  await completeQueuedCertificate(jobId);
  const [after] = await db
    .select({ status: calibrationJob.status })
    .from(calibrationJob)
    .where(eq(calibrationJob.id, jobId))
    .limit(1);
  if (after?.status !== "APPROVED") {
    throw new Error(
      `Certificate for job ${jobId} did not issue (status ${after?.status})`,
    );
  }
}

/**
 * The seed raises one notification per step for the demo users, all stamped
 * "now". Keep the ones that belong to work still open (so the bell is not
 * empty) and drop the rest: the history they would describe is weeks old.
 */
export async function tidyNotifications(
  seeded: readonly SeedJob[],
): Promise<void> {
  const openJobIds = new Set(
    seeded
      .filter((job) =>
        ["REVIEW", "IN_PROGRESS", "DRAFT"].includes(job.planned.final),
      )
      .map((job) => job.jobId),
  );
  const all = await db
    .select({ id: notification.id, related: notification.relatedEntity })
    .from(notification)
    .where(eq(notification.organizationId, LAB_ID));
  const keep = new Set<number>();
  for (const row of all) {
    const related = row.related;
    const entityId =
      related && typeof related === "object"
        ? Reflect.get(related, "id")
        : undefined;
    if (typeof entityId === "number" && openJobIds.has(entityId))
      keep.add(row.id);
  }
  const drop = all.filter((row) => !keep.has(row.id)).map((row) => row.id);
  if (drop.length > 0) {
    await db.delete(notification).where(inArray(notification.id, drop));
  }
}
