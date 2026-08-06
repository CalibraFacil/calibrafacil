import { db } from "@calibra-facil/db";
import {
  serviceOrder,
  serviceOrderEvaluation,
  serviceOrderQuote,
} from "@calibra-facil/db/schema";
import { and, eq, ne } from "drizzle-orm";
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

/**
 * True once any quote for this OS has left the lab (anything past `draft`).
 * That is the moment the diagnosis stops being a working note: the customer has
 * been shown a price derived from it. Mirrors the client-side rule in
 * apps/web detail-model `buildServiceOrderStageAffordances`.
 */
async function hasQuoteLeftTheLab(serviceOrderId: number) {
  const [sentQuote] = await db
    .select({ id: serviceOrderQuote.id })
    .from(serviceOrderQuote)
    .where(
      and(
        eq(serviceOrderQuote.serviceOrderId, serviceOrderId),
        ne(serviceOrderQuote.status, "draft"),
      ),
    )
    .limit(1);

  return Boolean(sentQuote);
}

/**
 * Edits an existing evaluation in place (evaluations do not version — one row
 * per OS). Free while the evaluation is still a working note; once a quote has
 * been sent, the diagnosis is the recorded basis for that price and a change
 * requires an explicit reason, which is written to the event log alongside the
 * old and new values.
 *
 * The RBAC action stays `evaluate` — who may revise a locked evaluation (same
 * roles, or a stricter one) is an open decision for the lab, and inventing a
 * new permission here would pre-empt it.
 */
export async function updateServiceOrderEvaluation(input: {
  serviceOrderId: number;
  evaluationId: number;
  member: ServiceOrderMember;
  actorUserId: string;
  values: Partial<EvaluationRow>;
  revisionReason?: string | null;
}) {
  const [existingEvaluation] = await db
    .select({
      id: serviceOrderEvaluation.id,
      diagnosis: serviceOrderEvaluation.diagnosis,
      recommendedAction: serviceOrderEvaluation.recommendedAction,
      organizationId: serviceOrder.organizationId,
      unitId: serviceOrder.unitId,
      orderStatus: serviceOrder.status,
    })
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
  if (!existingEvaluation) return { status: "not_found" as const };

  const reason = input.revisionReason?.trim();
  const locked = await hasQuoteLeftTheLab(input.serviceOrderId);
  if (locked && !reason) {
    return { status: "reason_required" as const };
  }

  // The row change and its audit event commit together, like the creation path.
  // Split, a failed event write would leave a communicated diagnosis silently
  // altered with no reason and no recoverable prior value.
  const [updated] = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(serviceOrderEvaluation)
      .set({ ...input.values, updatedAt: new Date() })
      .where(eq(serviceOrderEvaluation.id, input.evaluationId))
      .returning();

    if (!row) return [row];

    await recordServiceOrderEvent(
      {
        organizationId: existingEvaluation.organizationId,
        unitId: existingEvaluation.unitId,
        serviceOrderId: input.serviceOrderId,
        actorType: "lab_user",
        actorId: input.actorUserId,
        eventType: "service_order.evaluation_updated",
        oldValue: {
          diagnosis: existingEvaluation.diagnosis,
          recommendedAction: existingEvaluation.recommendedAction,
        },
        newValue: {
          diagnosis: row.diagnosis,
          recommendedAction: row.recommendedAction,
        },
        // `locked` records whether this was a revision of a communicated
        // diagnosis or an ordinary edit — the two read very differently in an
        // audit.
        metadata: {
          orderStatus: existingEvaluation.orderStatus,
          locked,
          ...(reason ? { revisionReason: reason } : {}),
        },
      },
      tx,
    );

    return [row];
  });

  if (!updated) return { status: "not_found" as const };

  return { status: "ok" as const, data: updated };
}
