import type { OrgDb } from "@calibra-facil/db/for-org";
import {
  serviceOrder,
  serviceOrderEvaluation,
  serviceOrderQuote,
} from "@calibra-facil/db/schema";
import { SERVICE_ORDER_MACHINE } from "@calibra-facil/schemas/machines";
import { and, eq, ne } from "drizzle-orm";
import { conflict, notFound } from "../../lib/domain-errors";
import type { OrgContext } from "../../lib/org-context";
import { recordServiceOrderEvent } from "../../lib/service-order-workflow";
import { buildUnitScopeCondition } from "../../lib/units";
import { userIsOrganizationMember } from "../../lib/tenant-refs";
import {
  serviceOrderNotFound,
  serviceOrderTechnicianRefused,
} from "./service-order-errors";
import type { ServiceOrderScope } from "./service-order-scope";

type EvaluationRow = typeof serviceOrderEvaluation.$inferSelect;
type EvaluationInsert = typeof serviceOrderEvaluation.$inferInsert;

export async function createServiceOrderEvaluation(
  ctx: OrgContext,
  scope: ServiceOrderScope,
  serviceOrderId: number,
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
  },
) {
  const [order] = await ctx.o
    .select()
    .from(serviceOrder)
    .where(
      and(
        eq(serviceOrder.id, serviceOrderId),
        eq(serviceOrder.organizationId, ctx.org),
        buildUnitScopeCondition(serviceOrder.unitId, scope),
      ),
    )
    .limit(1);
  if (!order) throw serviceOrderNotFound();

  const [existingEvaluation] = await ctx.o
    .select({ id: serviceOrderEvaluation.id })
    .from(serviceOrderEvaluation)
    .where(eq(serviceOrderEvaluation.serviceOrderId, serviceOrderId))
    .limit(1);
  if (existingEvaluation) {
    throw conflict(
      "service_order_evaluation_exists",
      "Avaliacao ja registrada. Edite a avaliacao existente.",
    );
  }
  // `evaluate` in SERVICE_ORDER_MACHINE: an evaluation is recorded while the
  // order is still at intake (opened, awaiting or under evaluation, warranty
  // return). Recording one later used to rewind a delivered or closed order.
  if (!SERVICE_ORDER_MACHINE.canTransition(order.status, "evaluate")) {
    throw conflict(
      "status_transition_conflict",
      "A OS nao esta em uma etapa que aceite avaliacao",
    );
  }

  // The evaluating technician may be named in the body: it must be a member of
  // this organization (the caller themself is, by construction).
  if (
    values.technicianId &&
    values.technicianId !== ctx.actor.userId &&
    !(await userIsOrganizationMember(ctx.org, values.technicianId, ctx.o))
  ) {
    throw serviceOrderTechnicianRefused();
  }

  const technicianId = values.technicianId ?? ctx.actor.userId;
  const nextStatus = values.requiresQuote
    ? "awaiting_quote_approval"
    : values.calibrationRecommended
      ? "awaiting_calibration"
      : "ready_for_pickup";

  // The status moves first, as a compare-and-set, so a lost race records no
  // evaluation.
  const [moved] = await ctx.o
    .update(serviceOrder)
    .set({
      status: SERVICE_ORDER_MACHINE.requireTransition(
        order.status,
        "evaluate",
        nextStatus,
      ),
      evaluatedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(serviceOrder.id, serviceOrderId),
        eq(serviceOrder.status, order.status),
      ),
    )
    .returning({ id: serviceOrder.id });
  if (!moved) {
    throw conflict(
      "status_transition_conflict",
      "A OS nao esta em uma etapa que aceite avaliacao",
    );
  }

  const [created] = await ctx.o
    .insert(serviceOrderEvaluation)
    .values({
      organizationId: ctx.org,
      serviceOrderId,
      technicianId,
      diagnosis: values.diagnosis,
      detectedIssues: values.detectedIssues ?? null,
      recommendedAction: values.recommendedAction,
      requiresQuote: values.requiresQuote,
      requiresClientApproval: values.requiresClientApproval,
      calibrationRecommended: values.calibrationRecommended,
      photos: values.photos,
      internalNotes: values.internalNotes ?? null,
      clientVisibleNotes: values.clientVisibleNotes ?? null,
    })
    .returning();
  await recordServiceOrderEvent(
    {
      organizationId: order.organizationId,
      unitId: order.unitId,
      serviceOrderId,
      actorType: "lab_user",
      actorId: ctx.actor.userId,
      eventType: "service_order.evaluation_completed",
      metadata: { evaluationId: created?.id },
      oldValue: { status: order.status },
      newValue: { status: nextStatus },
    },
    ctx.o,
  );

  return created;
}

/**
 * True once any quote for this OS has left the lab (anything past `draft`).
 * That is the moment the diagnosis stops being a working note: the customer has
 * been shown a price derived from it. Mirrors the client-side rule in
 * apps/web detail-model `buildServiceOrderStageAffordances`.
 */
async function hasQuoteLeftTheLab(o: OrgDb, serviceOrderId: number) {
  const [sentQuote] = await o
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
export async function updateServiceOrderEvaluation(
  ctx: OrgContext,
  scope: ServiceOrderScope,
  serviceOrderId: number,
  evaluationId: number,
  values: Partial<EvaluationRow>,
  revisionReason?: string | null,
) {
  const evaluationNotFound = () =>
    notFound("service_order_evaluation_not_found", "Avaliacao nao encontrada");

  const [existingEvaluation] = await ctx.o
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
        eq(serviceOrder.id, serviceOrderId),
        eq(serviceOrder.organizationId, ctx.org),
        buildUnitScopeCondition(serviceOrder.unitId, scope),
        eq(serviceOrderEvaluation.id, evaluationId),
      ),
    )
    .limit(1);
  if (!existingEvaluation) throw evaluationNotFound();

  if (
    values.technicianId &&
    values.technicianId !== ctx.actor.userId &&
    !(await userIsOrganizationMember(ctx.org, values.technicianId, ctx.o))
  ) {
    throw serviceOrderTechnicianRefused();
  }

  const reason = revisionReason?.trim();
  const locked = await hasQuoteLeftTheLab(ctx.o, serviceOrderId);
  if (locked && !reason) {
    throw conflict(
      "service_order_evaluation_reason_required",
      "Informe o motivo da revisao: o orcamento enviado ao cliente se baseia nesta avaliacao",
    );
  }

  // The row change and its audit event commit together, like the creation path.
  // Split, a failed event write would leave a communicated diagnosis silently
  // altered with no reason and no recoverable prior value.
  const [row] = await ctx.o
    .update(serviceOrderEvaluation)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(serviceOrderEvaluation.id, evaluationId))
    .returning();

  if (!row) throw evaluationNotFound();

  await recordServiceOrderEvent(
    {
      organizationId: existingEvaluation.organizationId,
      unitId: existingEvaluation.unitId,
      serviceOrderId,
      actorType: "lab_user",
      actorId: ctx.actor.userId,
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
    ctx.o,
  );

  return row;
}
