/**
 * The outbox enqueue side (STATUS_EMAIL_MAP) and the email package's
 * per-status template table are two lists of "which statuses send a status
 * email". This pins them together: a status the template table covers must
 * enqueue, and a status that enqueues must have a template.
 */
import { describe, expect, it } from "vitest";
import { SERVICE_ORDER_STATUSES } from "@calibra-facil/shared/service-orders";
import {
  SERVICE_ORDER_EMAIL_STATUSES,
  sendsServiceOrderStatusEmail,
} from "@calibra-facil/email";
import { getStatusEmailDescriptor } from "./status-email-map";

describe("status email map vs the email package's template table", () => {
  it.each(SERVICE_ORDER_STATUSES)(
    "%s enqueues exactly when it has a status email",
    (status) => {
      expect(getStatusEmailDescriptor(status) !== undefined).toBe(
        sendsServiceOrderStatusEmail(status),
      );
    },
  );

  it.each(SERVICE_ORDER_EMAIL_STATUSES)(
    "%s keys its outbox row by status",
    (status) => {
      expect(getStatusEmailDescriptor(status)?.eventKey).toBe(
        `status_email:${status}`,
      );
    },
  );
});
