import { db } from "@calibra-facil/db";
import { serviceOrder, serviceOrderExecution } from "@calibra-facil/db/schema";
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

  if (!execution) return null;

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

  return updated ?? null;
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

  if (input.values.items) {
    await replaceExecutionItems({
      organizationId: input.member.organizationId,
      executionId: execution.id,
      items: input.values.items,
    });
  }

  const nextStatus = input.values.calibrationRequiredAfterRepair
    ? "awaiting_calibration"
    : "awaiting_final_review";
  const order = await getScopedServiceOrder(input.serviceOrderId, input.member);
  if (!order) return { status: "not_found" as const };

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
