import { db } from "@calibra-facil/db";
import { serviceOrder, serviceOrderEvaluation } from "@calibra-facil/db/schema";
import { and, eq } from "drizzle-orm";
import type { AuthVariables } from "../../middleware/permission";
import { recordServiceOrderEvent } from "../../lib/service-order-workflow";
import { buildUnitScopeCondition } from "../../lib/units";

type ServiceOrderMember = AuthVariables["member"];
type EvaluationRow = typeof serviceOrderEvaluation.$inferSelect;
type EvaluationInsert = typeof serviceOrderEvaluation.$inferInsert;

export async function createServiceOrderEvaluation(input: {
  serviceOrderId: number;
  member: ServiceOrderMember;
  actorUserId: string;
  values: {
    technicianId?: string | null;
    diagnosis: string;
    detectedIssues?: EvaluationInsert["detectedIssues"];
    recommendedAction: EvaluationInsert["recommendedAction"];
    requiresQuote: boolean;
    requiresClientApproval: boolean;
    calibrationRecommended: boolean;
    photos: EvaluationInsert["photos"];
    internalNotes?: string | null;
    clientVisibleNotes?: string | null;
  };
}) {
  const [order] = await db
    .select()
    .from(serviceOrder)
    .where(
      and(
        eq(serviceOrder.id, input.serviceOrderId),
        eq(serviceOrder.organizationId, input.member.organizationId),
        buildUnitScopeCondition(serviceOrder.unitId, input.member),
      ),
    )
    .limit(1);
  if (!order) return { status: "not_found" as const };

  const [existingEvaluation] = await db
    .select({ id: serviceOrderEvaluation.id })
    .from(serviceOrderEvaluation)
    .where(eq(serviceOrderEvaluation.serviceOrderId, input.serviceOrderId))
    .limit(1);
  if (existingEvaluation) return { status: "already_exists" as const };

  const technicianId = input.values.technicianId ?? input.actorUserId;
  const nextStatus = input.values.requiresQuote
    ? "awaiting_quote_approval"
    : input.values.calibrationRecommended
      ? "awaiting_calibration"
      : "ready_for_pickup";

  const [evaluation] = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(serviceOrderEvaluation)
      .values({
        serviceOrderId: input.serviceOrderId,
        technicianId,
        diagnosis: input.values.diagnosis,
        detectedIssues: input.values.detectedIssues ?? null,
        recommendedAction: input.values.recommendedAction,
        requiresQuote: input.values.requiresQuote,
        requiresClientApproval: input.values.requiresClientApproval,
        calibrationRecommended: input.values.calibrationRecommended,
        photos: input.values.photos,
        internalNotes: input.values.internalNotes ?? null,
        clientVisibleNotes: input.values.clientVisibleNotes ?? null,
      })
      .returning();
    await tx
      .update(serviceOrder)
      .set({
        status: nextStatus,
        evaluatedAt: new Date(),
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
        eventType: "service_order.evaluation_completed",
        metadata: { evaluationId: created?.id },
        oldValue: { status: order.status },
        newValue: { status: nextStatus },
      },
      tx,
    );
    return [created];
  });

  return { status: "ok" as const, data: evaluation };
}

export async function updateServiceOrderEvaluation(input: {
  serviceOrderId: number;
  evaluationId: number;
  member: ServiceOrderMember;
  values: Partial<EvaluationRow>;
}) {
  const [existingEvaluation] = await db
    .select({ id: serviceOrderEvaluation.id })
    .from(serviceOrderEvaluation)
    .innerJoin(
      serviceOrder,
      eq(serviceOrderEvaluation.serviceOrderId, serviceOrder.id),
    )
    .where(
      and(
        eq(serviceOrder.id, input.serviceOrderId),
        eq(serviceOrder.organizationId, input.member.organizationId),
        buildUnitScopeCondition(serviceOrder.unitId, input.member),
        eq(serviceOrderEvaluation.id, input.evaluationId),
      ),
    )
    .limit(1);
  if (!existingEvaluation) return null;

  const [updated] = await db
    .update(serviceOrderEvaluation)
    .set({ ...input.values, updatedAt: new Date() })
    .where(eq(serviceOrderEvaluation.id, input.evaluationId))
    .returning();

  return updated ?? null;
}
