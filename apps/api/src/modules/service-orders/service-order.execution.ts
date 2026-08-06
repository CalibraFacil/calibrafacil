import { db } from "@calibra-facil/db";
import { serviceOrder, serviceOrderExecution } from "@calibra-facil/db/schema";
import {
  canTransitionServiceOrderStatus,
  isServiceOrderFinalStatus,
} from "@calibra-facil/shared";
import { and, eq } from "drizzle-orm";
import type { AuthVariables } from "../../middleware/permission";
import {
  recordServiceOrderEvent,
  replaceExecutionItems,
} from "../../lib/service-order-workflow";
import { buildUnitScopeCondition } from "../../lib/units";
import { getScopedServiceOrder } from "./service-order.queries";

type ServiceOrderMember = AuthVariables["member"];
type ServiceOrderExecutionRow = typeof serviceOrderExecution.$inferSelect;

export async function startServiceOrderExecution(input: {
  serviceOrderId: number;
  member: ServiceOrderMember;
  actorUserId: string;
  values: { notes?: string | null };
}) {
  const order = await getScopedServiceOrder(input.serviceOrderId, input.member);
  if (!order) return { status: "not_found" as const };

  // Consult the single source of truth (SERVICE_ORDER_ALLOWED_TRANSITIONS) before
  // writing `status`, instead of forcing "repair_in_progress" unconditionally.
  // Re-starting an order already in that status is a no-op (mirrors the generic
  // updateServiceOrder guard), so idempotent re-invocation stays allowed.
  if (
    order.status !== "repair_in_progress" &&
    !canTransitionServiceOrderStatus(order.status, "repair_in_progress")
  ) {
    return { status: "invalid_transition" as const };
  }

  const [execution] = await db
    .insert(serviceOrderExecution)
    .values({
      serviceOrderId: input.serviceOrderId,
      startedByUserId: input.actorUserId,
      technicalNotes: input.values.notes ?? null,
    })
    .onConflictDoNothing({ target: serviceOrderExecution.serviceOrderId })
    .returning();

  await db
    .update(serviceOrder)
    .set({ status: "repair_in_progress", repairStartedAt: new Date() })
    .where(
      and(
        eq(serviceOrder.id, input.serviceOrderId),
        eq(serviceOrder.organizationId, input.member.organizationId),
        buildUnitScopeCondition(serviceOrder.unitId, input.member),
      ),
    );

  await recordServiceOrderEvent({
    organizationId: order.organizationId,
    unitId: order.unitId,
    serviceOrderId: input.serviceOrderId,
    actorType: "lab_user",
    actorId: input.actorUserId,
    eventType: "service_order.repair_started",
    oldValue: { status: order.status },
    newValue: { status: "repair_in_progress" },
  });

  return { status: "ok" as const, data: execution };
}

export async function updateServiceOrderExecution(input: {
  serviceOrderId: number;
  member: ServiceOrderMember;
  values: {
    items?: Parameters<typeof replaceExecutionItems>[0]["items"];
    servicePerformed?: string | null;
    partsUsedSummary?: string | null;
    technicalNotes?: string | null;
    calibrationRequiredAfterRepair?: boolean;
    result?: ServiceOrderExecutionRow["result"];
  };
}) {
  const [execution] = await db
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
        eq(serviceOrder.id, input.serviceOrderId),
        eq(serviceOrder.organizationId, input.member.organizationId),
        buildUnitScopeCondition(serviceOrder.unitId, input.member),
      ),
    )
    .limit(1);

  if (!execution) return { status: "not_started" as const };
  // The work record of a closed or canceled OS is history, not a draft. Editing
  // it after the fact would silently rewrite what the delivery document already
  // reported to the customer.
  if (isServiceOrderFinalStatus(execution.orderStatus)) {
    return { status: "invalid_transition" as const };
  }

  if (input.values.items) {
    await replaceExecutionItems({
      organizationId: input.member.organizationId,
      executionId: execution.id,
      items: input.values.items,
    });
  }

  const [updated] = await db
    .update(serviceOrderExecution)
    .set({
      servicePerformed: input.values.servicePerformed,
      partsUsedSummary: input.values.partsUsedSummary,
      technicalNotes: input.values.technicalNotes,
      calibrationRequiredAfterRepair:
        input.values.calibrationRequiredAfterRepair,
      result: input.values.result,
      updatedAt: new Date(),
    })
    .where(eq(serviceOrderExecution.id, execution.id))
    .returning();

  if (!updated) return { status: "not_started" as const };

  return { status: "ok" as const, data: updated };
}

export async function finishServiceOrderExecution(input: {
  serviceOrderId: number;
  member: ServiceOrderMember;
  actorUserId: string;
  values: {
    items?: Parameters<typeof replaceExecutionItems>[0]["items"];
    servicePerformed: string;
    partsUsedSummary?: string | null;
    technicalNotes?: string | null;
    calibrationRequiredAfterRepair?: boolean | null;
    result: ServiceOrderExecutionRow["result"];
  };
}) {
  const [execution] = await db
    .select({ id: serviceOrderExecution.id })
    .from(serviceOrderExecution)
    .innerJoin(
      serviceOrder,
      eq(serviceOrderExecution.serviceOrderId, serviceOrder.id),
    )
    .where(
      and(
        eq(serviceOrder.id, input.serviceOrderId),
        eq(serviceOrder.organizationId, input.member.organizationId),
        buildUnitScopeCondition(serviceOrder.unitId, input.member),
      ),
    )
    .limit(1);

  if (!execution) return { status: "not_started" as const };

  const nextStatus = input.values.calibrationRequiredAfterRepair
    ? "awaiting_calibration"
    : "awaiting_final_review";
  const order = await getScopedServiceOrder(input.serviceOrderId, input.member);
  if (!order) return { status: "not_found" as const };

  // Validate the target transition against the graph BEFORE any write (including
  // the item replacement below), so a forbidden finish leaves the order — and its
  // execution items — untouched. Same-status finishes stay a no-op.
  if (
    order.status !== nextStatus &&
    !canTransitionServiceOrderStatus(order.status, nextStatus)
  ) {
    return { status: "invalid_transition" as const };
  }

  if (input.values.items) {
    await replaceExecutionItems({
      organizationId: input.member.organizationId,
      executionId: execution.id,
      items: input.values.items,
    });
  }

  await db.transaction(async (tx) => {
    await tx
      .update(serviceOrderExecution)
      .set({
        servicePerformed: input.values.servicePerformed,
        partsUsedSummary: input.values.partsUsedSummary ?? null,
        technicalNotes: input.values.technicalNotes ?? null,
        calibrationRequiredAfterRepair:
          input.values.calibrationRequiredAfterRepair ?? false,
        result: input.values.result,
        finishedAt: new Date(),
        finishedByUserId: input.actorUserId,
      })
      .where(eq(serviceOrderExecution.id, execution.id));
    await tx
      .update(serviceOrder)
      .set({
        status: nextStatus,
        repairFinishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(serviceOrder.id, input.serviceOrderId));
    await recordServiceOrderEvent(
      {
        organizationId: order.organizationId,
        unitId: order.unitId,
        serviceOrderId: input.serviceOrderId,
        actorType: "lab_user",
        actorId: input.actorUserId,
        eventType: "service_order.repair_finished",
        newValue: {
          status: nextStatus,
          result: input.values.result,
        },
      },
      tx,
    );
  });

  return { status: "ok" as const };
}
