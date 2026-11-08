/**
 * The service-order statuses that enqueue a status email, and the outbox
 * `eventKey` of each.
 *
 * This is the SINGLE source of truth shared between:
 *  - `recordServiceOrderEvent` (enqueue side)
 *  - The outbox worker (drain side)
 *
 * Which statuses send an email, and the words of each, belong to the email
 * package (`SERVICE_ORDER_EMAIL_STATUSES`, `ServiceOrderStatusEmail`): the keys
 * here derive from it, so a status added to its template table enqueues and a
 * status without a template cannot.
 *
 * eventKey shape: "status_email:<status>"
 */

import {
  SERVICE_ORDER_EMAIL_STATUSES,
  type ServiceOrderEmailStatus,
} from "@calibra-facil/email";

export type StatusEmailDescriptor = {
  /** Stable per-transition dedup key stored in serviceOrderEmailOutbox.eventKey */
  readonly eventKey: string;
  /** The status the email is for: picks its template and subject. */
  readonly status: ServiceOrderEmailStatus;
};

const STATUS_EMAIL_MAP: ReadonlyMap<string, StatusEmailDescriptor> = new Map(
  SERVICE_ORDER_EMAIL_STATUSES.map((status) => [
    status,
    { eventKey: `status_email:${status}`, status },
  ]),
);

/**
 * Returns the email descriptor for the given status, or undefined if the status
 * does not trigger an email outbox entry.
 */
export function getStatusEmailDescriptor(
  status: string,
): StatusEmailDescriptor | undefined {
  return STATUS_EMAIL_MAP.get(status);
}
