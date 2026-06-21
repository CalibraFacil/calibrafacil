/**
 * Central mapping from triggering service-order status → outbox email descriptor.
 *
 * This is the SINGLE source of truth shared between:
 *  - `recordServiceOrderEvent` (enqueue side, mini-spec E1)
 *  - The outbox worker (drain side, mini-spec E2)
 *
 * Only statuses listed here produce an email outbox entry. All other transitions
 * are silently ignored by the enqueue logic.
 *
 * eventKey shape: "status_email:<status>"
 */

import type { ServiceOrderStatus } from "@calibra-facil/shared";

export type StatusEmailDescriptor = {
  /** Stable per-transition dedup key stored in serviceOrderEmailOutbox.eventKey */
  readonly eventKey: string;
  /** Human-readable email type consumed by the worker template router */
  readonly emailType: string;
};

/**
 * Map of service-order statuses that trigger a transactional outbox email entry.
 *
 * REQ-SOEMAIL-041: repair_in_progress  → "serviço iniciado"
 * REQ-SOEMAIL-042: awaiting_calibration, calibration_in_progress → progress update
 * REQ-SOEMAIL-043: awaiting_tech_evaluation → "aguardando avaliação técnica"
 * REQ-SOEMAIL-044: under_evaluation → "em avaliação técnica"
 * REQ-SOEMAIL-051: ready_for_pickup → "pronto para retirada"
 * REQ-SOEMAIL-052: delivered → "entregue" receipt
 * REQ-SOEMAIL-053: closed → "OS encerrada"
 * REQ-SOEMAIL-054: awaiting_final_review → "em revisão final"
 * REQ-SOEMAIL-061: canceled → "OS cancelada"
 * REQ-SOEMAIL-062: warranty_return → "retorno em garantia"
 */
export const STATUS_EMAIL_MAP = {
  repair_in_progress: {
    eventKey: "status_email:repair_in_progress",
    emailType: "service_started",
  },
  awaiting_calibration: {
    eventKey: "status_email:awaiting_calibration",
    emailType: "progress_update",
  },
  calibration_in_progress: {
    eventKey: "status_email:calibration_in_progress",
    emailType: "progress_update",
  },
  awaiting_tech_evaluation: {
    eventKey: "status_email:awaiting_tech_evaluation",
    emailType: "awaiting_tech_evaluation",
  },
  under_evaluation: {
    eventKey: "status_email:under_evaluation",
    emailType: "under_evaluation",
  },
  ready_for_pickup: {
    eventKey: "status_email:ready_for_pickup",
    emailType: "ready_for_pickup",
  },
  delivered: {
    eventKey: "status_email:delivered",
    emailType: "delivered",
  },
  closed: {
    eventKey: "status_email:closed",
    emailType: "closed",
  },
  awaiting_final_review: {
    eventKey: "status_email:awaiting_final_review",
    emailType: "final_review",
  },
  canceled: {
    eventKey: "status_email:canceled",
    emailType: "canceled",
  },
  warranty_return: {
    eventKey: "status_email:warranty_return",
    emailType: "warranty_return",
  },
} satisfies Partial<Record<ServiceOrderStatus, StatusEmailDescriptor>>;

export type TriggerStatus = keyof typeof STATUS_EMAIL_MAP;

/** Type guard: narrows a `string` to a `TriggerStatus`. */
function isTriggerStatus(status: string): status is TriggerStatus {
  return status in STATUS_EMAIL_MAP;
}

/**
 * Returns the email descriptor for the given status, or undefined if the status
 * does not trigger an email outbox entry.
 */
export function getStatusEmailDescriptor(
  status: string,
): StatusEmailDescriptor | undefined {
  if (isTriggerStatus(status)) {
    return STATUS_EMAIL_MAP[status];
  }
  return undefined;
}
