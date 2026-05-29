export const SERVICE_ORDER_STATUSES = [
  "opened",
  "awaiting_tech_evaluation",
  "under_evaluation",
  "awaiting_quote_approval",
  "quote_approved",
  "quote_rejected",
  "repair_in_progress",
  "awaiting_calibration",
  "calibration_in_progress",
  "awaiting_final_review",
  "ready_for_pickup",
  "delivered",
  "closed",
  "canceled",
  "warranty_return",
] as const;

export type ServiceOrderStatus = (typeof SERVICE_ORDER_STATUSES)[number];

export const SERVICE_ORDER_STATUS_LABELS: Record<ServiceOrderStatus, string> = {
  opened: "Aberta",
  awaiting_tech_evaluation: "Aguardando avaliação do técnico",
  under_evaluation: "Em avaliação técnica",
  awaiting_quote_approval: "Aguardando aprovação do orçamento",
  quote_approved: "Orçamento aprovado",
  quote_rejected: "Orçamento recusado",
  repair_in_progress: "Reparo sendo realizado",
  awaiting_calibration: "Aguardando calibração",
  calibration_in_progress: "Calibração em andamento",
  awaiting_final_review: "Aguardando revisão final",
  ready_for_pickup: "Aguardando retirada",
  delivered: "Entregue ao cliente",
  closed: "Encerrada",
  canceled: "Cancelada",
  warranty_return: "Retorno em garantia",
};

export const SERVICE_ORDER_PRIORITIES = [
  "normal",
  "urgent",
  "contract",
  "warranty",
] as const;
export type ServiceOrderPriority = (typeof SERVICE_ORDER_PRIORITIES)[number];

export const SERVICE_ORDER_INTAKE_TYPES = [
  "counter",
  "carrier",
  "third_party",
  "internal",
  "warranty_return",
] as const;
export type ServiceOrderIntakeType =
  (typeof SERVICE_ORDER_INTAKE_TYPES)[number];

export const SERVICE_ORDER_DELIVERY_METHODS = [
  "pickup_at_lab",
  "ship_to_client",
  "third_party_pickup",
] as const;
export type ServiceOrderDeliveryMethod =
  (typeof SERVICE_ORDER_DELIVERY_METHODS)[number];

export const SERVICE_ORDER_CLOSING_REASONS = [
  "completed_repaired",
  "completed_calibrated",
  "completed_repaired_and_calibrated",
  "quote_rejected_returned",
  "condemned_returned",
  "no_defect_found",
  "warranty_completed",
  "canceled_before_execution",
] as const;
export type ServiceOrderClosingReason =
  (typeof SERVICE_ORDER_CLOSING_REASONS)[number];

export const SERVICE_ORDER_RECOMMENDED_ACTIONS = [
  "repair",
  "calibration_only",
  "return_without_repair",
  "condemned",
  "warranty_service",
  "external_service_required",
] as const;
export type ServiceOrderRecommendedAction =
  (typeof SERVICE_ORDER_RECOMMENDED_ACTIONS)[number];

export const SERVICE_ORDER_QUOTE_STATUSES = [
  "draft",
  "sent",
  "approved",
  "rejected",
  "expired",
  "canceled",
  "superseded",
] as const;
export type ServiceOrderQuoteStatus =
  (typeof SERVICE_ORDER_QUOTE_STATUSES)[number];

export const SERVICE_ORDER_ITEM_TYPES = [
  "service",
  "part",
  "external_service",
  "freight",
  "discount",
  "evaluation_fee",
  "other",
] as const;
export type ServiceOrderItemType = (typeof SERVICE_ORDER_ITEM_TYPES)[number];

export const SERVICE_ORDER_EXECUTION_RESULTS = [
  "repaired",
  "not_repaired",
  "condemned",
  "returned_without_service",
  "sent_to_third_party",
] as const;
export type ServiceOrderExecutionResult =
  (typeof SERVICE_ORDER_EXECUTION_RESULTS)[number];

export const SERVICE_ORDER_ACTOR_TYPES = [
  "lab_user",
  "portal_user",
  "system",
  "public_token",
] as const;
export type ServiceOrderActorType = (typeof SERVICE_ORDER_ACTOR_TYPES)[number];

export const SERVICE_ORDER_EVENT_TYPES = [
  "service_order.created",
  "service_order.intake_document_issued",
  "service_order.tag_printed",
  "service_order.status_changed",
  "service_order.technician_assigned",
  "service_order.evaluation_started",
  "service_order.evaluation_completed",
  "service_order.quote_created",
  "service_order.quote_sent",
  "service_order.quote_approved_by_client",
  "service_order.quote_approved_manually",
  "service_order.quote_rejected_by_client",
  "service_order.quote_rejected_manually",
  "service_order.repair_started",
  "service_order.repair_finished",
  "service_order.delivery_document_issued",
  "service_order.repair_seal_updated",
  "service_order.ready_for_pickup",
  "service_order.delivered",
  "service_order.closed",
  "service_order.reopened",
  "service_order.canceled",
  "service_order.certificate_linked",
  "service_order.certificate_unlinked",
  "service_order.sent_to_finance",
  "service_order.email_sent",
  "service_order.portal_viewed",
  "service_order.public_link_viewed",
] as const;
export type ServiceOrderEventType = (typeof SERVICE_ORDER_EVENT_TYPES)[number];

export const SERVICE_ORDER_MANUAL_APPROVAL_EVIDENCE_TYPES = [
  "phone",
  "whatsapp",
  "email",
  "in_person",
  "other",
] as const;
export type ServiceOrderManualApprovalEvidenceType =
  (typeof SERVICE_ORDER_MANUAL_APPROVAL_EVIDENCE_TYPES)[number];

export const SERVICE_ORDER_FINAL_STATUSES = [
  "closed",
  "canceled",
] satisfies ServiceOrderStatus[];

/**
 * Statuses where the technical work is complete enough that the order can be
 * considered for billing (the "billable milestone" in the finance strategy).
 */
export const SERVICE_ORDER_BILLABLE_STATUSES = [
  "ready_for_pickup",
  "delivered",
  "closed",
] satisfies ServiceOrderStatus[];

/**
 * Closing reasons that mean no revenue was produced, so the order must never
 * enter the billing readiness queue even if it reached a billable status.
 */
export const SERVICE_ORDER_NON_BILLABLE_CLOSING_REASONS = [
  "quote_rejected_returned",
  "condemned_returned",
  "canceled_before_execution",
] satisfies ServiceOrderClosingReason[];

/**
 * Whether a service order represents completed, billable work. Provider-neutral
 * and used by the billing readiness queue.
 */
export function isServiceOrderBillable(
  status: ServiceOrderStatus,
  closingReason: ServiceOrderClosingReason | null | undefined,
) {
  const billable: readonly ServiceOrderStatus[] =
    SERVICE_ORDER_BILLABLE_STATUSES;
  if (!billable.includes(status)) {
    return false;
  }
  if (!closingReason) {
    return true;
  }
  const nonBillable: readonly ServiceOrderClosingReason[] =
    SERVICE_ORDER_NON_BILLABLE_CLOSING_REASONS;
  return !nonBillable.includes(closingReason);
}

export const SERVICE_ORDER_ALLOWED_TRANSITIONS: Record<
  ServiceOrderStatus,
  ServiceOrderStatus[]
> = {
  opened: ["awaiting_tech_evaluation", "canceled"],
  awaiting_tech_evaluation: ["under_evaluation", "canceled"],
  under_evaluation: [
    "awaiting_quote_approval",
    "awaiting_calibration",
    "awaiting_final_review",
    "ready_for_pickup",
    "canceled",
  ],
  awaiting_quote_approval: ["quote_approved", "quote_rejected", "canceled"],
  quote_approved: ["repair_in_progress", "awaiting_calibration"],
  quote_rejected: ["ready_for_pickup", "canceled"],
  repair_in_progress: ["awaiting_calibration", "awaiting_final_review"],
  awaiting_calibration: ["calibration_in_progress", "awaiting_final_review"],
  calibration_in_progress: ["awaiting_final_review"],
  awaiting_final_review: ["ready_for_pickup"],
  ready_for_pickup: ["delivered"],
  delivered: ["closed"],
  closed: [],
  canceled: [],
  warranty_return: ["awaiting_tech_evaluation", "under_evaluation", "canceled"],
};

export function isServiceOrderFinalStatus(status: ServiceOrderStatus) {
  const finalStatuses: readonly ServiceOrderStatus[] =
    SERVICE_ORDER_FINAL_STATUSES;
  return finalStatuses.includes(status);
}

export function canTransitionServiceOrderStatus(
  from: ServiceOrderStatus,
  to: ServiceOrderStatus,
) {
  return SERVICE_ORDER_ALLOWED_TRANSITIONS[from].includes(to);
}

export function canEditServiceOrderQuote(status: ServiceOrderQuoteStatus) {
  return status === "draft";
}

export function canApproveServiceOrderQuote(status: ServiceOrderQuoteStatus) {
  return status === "sent";
}
