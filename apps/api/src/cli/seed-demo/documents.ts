import { db } from "@calibra-facil/db";
import { completeQueueJob, isQueueMessage } from "@calibra-facil/db/queue";
import {
  appQueueJob,
  serviceOrder,
  type AppQueueJobType,
} from "@calibra-facil/db/schema";
import { processBackgroundJob } from "@calibra-facil/worker";
import { and, asc, eq, inArray } from "drizzle-orm";

import { createWorkerRuntimeEnv } from "../../lib/runtime-env";
import { LAB_ID } from "./api";
import type { SeedContext } from "./context";

const SERVICE_ORDER_DOCUMENTS: AppQueueJobType[] = [
  "SERVICE_ORDER_INTAKE_DOCUMENT",
  "SERVICE_ORDER_TAG",
  "SERVICE_ORDER_QUOTE",
  "SERVICE_ORDER_DELIVERY_RECEIPT",
];

/**
 * The seed runs the app in queue mode (see seed-demo.ts), so the documents the
 * service-order commands ask for (intake documents, tags, quotes, delivery
 * receipts) wait in `app_queue_job`. A development API runs background jobs
 * in-process and never drains that table, so they would read "generating"
 * forever: render the demo laboratory's ones with the worker's own code, as
 * the certificates are.
 */
export async function renderServiceOrderDocuments(
  ctx: SeedContext,
): Promise<void> {
  const orders = new Set(
    (
      await db
        .select({ id: serviceOrder.id })
        .from(serviceOrder)
        .where(eq(serviceOrder.organizationId, LAB_ID))
    ).map((row) => row.id),
  );
  const queued = await db
    .select({ id: appQueueJob.id, payload: appQueueJob.payload })
    .from(appQueueJob)
    .where(
      and(
        eq(appQueueJob.status, "PENDING"),
        inArray(appQueueJob.type, SERVICE_ORDER_DOCUMENTS),
      ),
    )
    .orderBy(asc(appQueueJob.id));

  const env = createWorkerRuntimeEnv();
  let rendered = 0;
  for (const row of queued) {
    const message = row.payload;
    const orderId = message.serviceOrderId;
    if (
      !isQueueMessage(message) ||
      typeof orderId !== "number" ||
      !orders.has(orderId)
    ) {
      continue;
    }
    await processBackgroundJob(env, message);
    await completeQueueJob(row.id);
    rendered += 1;
  }
  ctx.log(`  service-order documents: ${rendered} rendered`);
}
