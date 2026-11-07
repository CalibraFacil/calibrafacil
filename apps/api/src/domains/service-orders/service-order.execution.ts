import { serviceOrder, serviceOrderExecution } from "@calibra-facil/db/schema";
import { isServiceOrderFinalStatus } from "@calibra-facil/shared";
import { SERVICE_ORDER_MACHINE } from "@calibra-facil/schemas/machines";
import { and, eq } from "drizzle-orm";
import { conflict, notFound } from "../../lib/domain-errors";
import type { OrgContext } from "../../lib/org-context";
import {
  recordServiceOrderEvent,
  replaceExecutionItems,
} from "./service-order-workflow";
import { buildUnitScopeCondition } from "../../lib/units";
import { serviceOrderInvalidTransition } from "./service-order-errors";
import { requireScopedServiceOrder } from "./service-order.queries";
import type { ServiceOrderScope } from "./service-order-scope";

type ServiceOrderExecutionRow = typeof serviceOrderExecution.$inferSelect;

function executionNotStarted() {
  return notFound(
    "service_order_execution_not_started",
    "Execucao nao iniciada",
  );
}

export async function startServiceOrderExecution(
  ctx: OrgContext,
  scope: ServiceOrderScope,
  serviceOrderId: number,
  values: { notes?: string | null },
) {
  const order = await requireScopedServiceOrder(serviceOrderId, scope, ctx.o);

  // `start_repair` in SERVICE_ORDER_MACHINE: from an approved quote, or a
  // no-op re-start of an order already under repair (idempotent re-invocation).
  // The status moves first, as a compare-and-set, so losing a race writes
  // nothing.
  if (!SERVICE_ORDER_MACHINE.canTransition(order.status, "start_repair")) {
    throw serviceOrderInvalidTransition();
  }

  const [moved] = await ctx.o
    .update(serviceOrder)
    .set({ status: "repair_in_progress", repairStartedAt: new Date() })
    .where(
      and(
        eq(serviceOrder.id, serviceOrderId),
        eq(serviceOrder.organizationId, ctx.org),
        buildUnitScopeCondition(serviceOrder.unitId, scope),
        eq(serviceOrder.status, order.status),
      ),
    )
    .returning({ id: serviceOrder.id });
  if (!moved) throw serviceOrderInvalidTransition();

  const [execution] = await ctx.o
    .insert(serviceOrderExecution)
    .values({
      organizationId: ctx.org,
      serviceOrderId,
      startedByUserId: ctx.actor.userId,
      technicalNotes: values.notes ?? null,
    })
    .onConflictDoNothing({ target: serviceOrderExecution.serviceOrderId })
    .returning();

  await recordServiceOrderEvent(
    {
      organizationId: order.organizationId,
      unitId: order.unitId,
      serviceOrderId,
      actorType: "lab_user",
      actorId: ctx.actor.userId,
      eventType: "service_order.repair_started",
      oldValue: { status: order.status },
      newValue: { status: "repair_in_progress" },
    },
    ctx.o,
  );

  return execution;
}

export async function updateServiceOrderExecution(
  ctx: OrgContext,
  scope: ServiceOrderScope,
  serviceOrderId: number,
  values: {
    items?: Parameters<typeof replaceExecutionItems>[0]["items"];
    servicePerformed?: string | null;
    partsUsedSummary?: string | null;
    technicalNotes?: string | null;
    calibrationRequiredAfterRepair?: boolean;
    result?: ServiceOrderExecutionRow["result"];
  },
) {
  const [execution] = await ctx.o
    .select({
      id: serviceOrderExecution.id,
      orderStatus: serviceOrder.status,
    })
    .from(serviceOrderExecution)
    .innerJoin(
      serviceOrder,
      eq(serviceOrderExecution.serviceOrderId, serviceOrder.id),
    )
    .where(
      and(
        eq(serviceOrder.id, serviceOrderId),
        eq(serviceOrder.organizationId, ctx.org),
        buildUnitScopeCondition(serviceOrder.unitId, scope),
      ),
    )
    .limit(1);

  if (!execution) throw executionNotStarted();
  // The work record of a closed or canceled OS is history, not a draft. Editing
  // it after the fact would silently rewrite what the delivery document already
  // reported to the customer.
  if (isServiceOrderFinalStatus(execution.orderStatus)) {
    throw conflict("status_transition_conflict", "OS encerrada ou cancelada");
  }

  if (values.items) {
    await replaceExecutionItems(
      {
        organizationId: ctx.org,
        executionId: execution.id,
        items: values.items,
      },
      ctx.o,
    );
  }

  const [updated] = await ctx.o
    .update(serviceOrderExecution)
    .set({
      servicePerformed: values.servicePerformed,
      partsUsedSummary: values.partsUsedSummary,
      technicalNotes: values.technicalNotes,
      calibrationRequiredAfterRepair: values.calibrationRequiredAfterRepair,
      result: values.result,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(serviceOrderExecution.id, execution.id),
        eq(serviceOrderExecution.organizationId, ctx.org),
      ),
    )
    .returning();

  if (!updated) throw executionNotStarted();

  return updated;
}

export async function finishServiceOrderExecution(
  ctx: OrgContext,
  scope: ServiceOrderScope,
  serviceOrderId: number,
  values: {
    items?: Parameters<typeof replaceExecutionItems>[0]["items"];
    servicePerformed: string;
    partsUsedSummary?: string | null;
    technicalNotes?: string | null;
    calibrationRequiredAfterRepair?: boolean | null;
    result: ServiceOrderExecutionRow["result"];
  },
) {
  const [execution] = await ctx.o
    .select({ id: serviceOrderExecution.id })
    .from(serviceOrderExecution)
    .innerJoin(
      serviceOrder,
      eq(serviceOrderExecution.serviceOrderId, serviceOrder.id),
    )
    .where(
      and(
        eq(serviceOrder.id, serviceOrderId),
        eq(serviceOrder.organizationId, ctx.org),
        buildUnitScopeCondition(serviceOrder.unitId, scope),
      ),
    )
    .limit(1);

  if (!execution) throw executionNotStarted();

  const nextStatus = values.calibrationRequiredAfterRepair
    ? "awaiting_calibration"
    : "awaiting_final_review";
  const order = await requireScopedServiceOrder(serviceOrderId, scope, ctx.o);

  // Validate the target transition against the graph BEFORE any write (including
  // the item replacement below), so a forbidden finish leaves the order — and its
  // execution items — untouched. Same-status finishes stay a no-op.
  if (
    !SERVICE_ORDER_MACHINE.canTransition(
      order.status,
      "finish_repair",
      nextStatus,
    )
  ) {
    throw serviceOrderInvalidTransition();
  }

  // The status moves first, as a compare-and-set on the status checked above,
  // so a lost race leaves the execution and its items untouched.
  const [moved] = await ctx.o
    .update(serviceOrder)
    .set({
      status: nextStatus,
      repairFinishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(serviceOrder.id, serviceOrderId),
        eq(serviceOrder.organizationId, ctx.org),
        eq(serviceOrder.status, order.status),
      ),
    )
    .returning({ id: serviceOrder.id });
  if (!moved) throw serviceOrderInvalidTransition();

  if (values.items) {
    await replaceExecutionItems(
      {
        organizationId: ctx.org,
        executionId: execution.id,
        items: values.items,
      },
      ctx.o,
    );
  }

  await ctx.o
    .update(serviceOrderExecution)
    .set({
      servicePerformed: values.servicePerformed,
      partsUsedSummary: values.partsUsedSummary ?? null,
      technicalNotes: values.technicalNotes ?? null,
      calibrationRequiredAfterRepair:
        values.calibrationRequiredAfterRepair ?? false,
      result: values.result,
      finishedAt: new Date(),
      finishedByUserId: ctx.actor.userId,
    })
    .where(
      and(
        eq(serviceOrderExecution.id, execution.id),
        eq(serviceOrderExecution.organizationId, ctx.org),
      ),
    );
  await recordServiceOrderEvent(
    {
      organizationId: order.organizationId,
      unitId: order.unitId,
      serviceOrderId,
      actorType: "lab_user",
      actorId: ctx.actor.userId,
      eventType: "service_order.repair_finished",
      newValue: {
        status: nextStatus,
        result: values.result,
      },
    },
    ctx.o,
  );
}
