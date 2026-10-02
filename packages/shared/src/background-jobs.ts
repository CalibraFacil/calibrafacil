import type {
  IntegrationProvider,
  IntegrationSyncTarget,
  IntegrationSyncTrigger,
} from "./integrations";

export type DocumentBackgroundJobMessage =
  | {
      type?: "CERTIFICATE" | "LABEL";
      jobId: number;
      userId: string;
    }
  | {
      type:
        | "SERVICE_ORDER_INTAKE_DOCUMENT"
        | "SERVICE_ORDER_TAG"
        | "SERVICE_ORDER_QUOTE"
        | "SERVICE_ORDER_DELIVERY_RECEIPT";
      serviceOrderId: number;
      documentId?: number;
      tagId?: number;
      quoteId?: number;
      userId: string;
    }
  | {
      /**
       * §7.10 out-of-tolerance customer notification PDF (#426 Phase 0).
       * All context lives on the `oot_notification` row; the message points at it.
       */
      type: "OOT_NOTIFICATION";
      notificationId: number;
      userId: string;
    };

export type IntegrationSyncBackgroundJobMessage = {
  type: "INTEGRATION_SYNC";
  provider?: IntegrationProvider;
  integrationId: string;
  organizationId: string;
  runId: string;
  target: IntegrationSyncTarget;
  limit: number;
  trigger: IntegrationSyncTrigger;
};

export type ScheduledNotificationsBackgroundJobMessage = {
  type: "SCHEDULED_NOTIFICATIONS";
};

/**
 * Daily timer that fans out the client-portal due-calibration digest emails.
 * Like SCHEDULED_NOTIFICATIONS it carries no payload — the worker derives
 * which digest frequencies fire from the current date.
 */
export type PortalDigestBackgroundJobMessage = {
  type: "PORTAL_DIGEST";
};

/**
 * Nightly timer that re-evaluates every SPC control chart against its stored
 * check-standard readings (ISO/IEC 17025 §7.7.1, issue #60). No payload — the
 * worker sweeps all charts.
 */
export type SpcRecomputeBackgroundJobMessage = {
  type: "SPC_RECOMPUTE";
};

/**
 * Daily timer that re-polls Resend for every lab-owned email sending domain
 * (issue #584): DKIM can rotate and keys get revoked silently, so the sweep
 * refreshes domain status and key health instead of waiting for a send to
 * fail. No payload — the worker sweeps all organization_email_domain rows.
 */
export type EmailDomainHealthBackgroundJobMessage = {
  type: "EMAIL_DOMAIN_HEALTH";
};

/**
 * Portal audit pack (issue #738): bulk export of released certificates +
 * fleet-status report requested by a portal user. All request parameters live
 * on the `portal_export_job` row; the message only points at it.
 */
export type AuditPackBackgroundJobMessage = {
  type: "AUDIT_PACK";
  exportId: number;
  userId: string;
};

export type BackgroundJobMessage =
  | DocumentBackgroundJobMessage
  | IntegrationSyncBackgroundJobMessage
  | ScheduledNotificationsBackgroundJobMessage
  | PortalDigestBackgroundJobMessage
  | SpcRecomputeBackgroundJobMessage
  | EmailDomainHealthBackgroundJobMessage
  | AuditPackBackgroundJobMessage;

export function isBackgroundJobMessage(
  value: unknown,
): value is BackgroundJobMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;

  const message = Object.fromEntries(Object.entries(value));
  const type = message.type;

  if (
    type === "SCHEDULED_NOTIFICATIONS" ||
    type === "PORTAL_DIGEST" ||
    type === "SPC_RECOMPUTE" ||
    type === "EMAIL_DOMAIN_HEALTH"
  ) {
    return true;
  }

  if (type === "AUDIT_PACK") {
    return (
      typeof message.exportId === "number" && typeof message.userId === "string"
    );
  }

  if (type === "INTEGRATION_SYNC") {
    return (
      typeof message.integrationId === "string" &&
      typeof message.organizationId === "string" &&
      typeof message.runId === "string" &&
      typeof message.target === "string" &&
      typeof message.limit === "number" &&
      typeof message.trigger === "string"
    );
  }

  if (type === "OOT_NOTIFICATION") {
    return (
      typeof message.notificationId === "number" &&
      typeof message.userId === "string"
    );
  }

  if (
    type === "SERVICE_ORDER_INTAKE_DOCUMENT" ||
    type === "SERVICE_ORDER_TAG" ||
    type === "SERVICE_ORDER_QUOTE" ||
    type === "SERVICE_ORDER_DELIVERY_RECEIPT"
  ) {
    return (
      typeof message.serviceOrderId === "number" &&
      typeof message.userId === "string"
    );
  }

  return (
    (type === undefined || type === "CERTIFICATE" || type === "LABEL") &&
    typeof message.jobId === "number" &&
    typeof message.userId === "string"
  );
}
