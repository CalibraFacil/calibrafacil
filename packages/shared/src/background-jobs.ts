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

export type CertificateXlsxPreviewBackgroundJobMessage = {
  type: "CERTIFICATE_XLSX_PREVIEW";
  previewId: number;
  templateVersionId: number;
  userId: string;
};

export type BackgroundJobMessage =
  | DocumentBackgroundJobMessage
  | IntegrationSyncBackgroundJobMessage
  | ScheduledNotificationsBackgroundJobMessage
  | PortalDigestBackgroundJobMessage
  | CertificateXlsxPreviewBackgroundJobMessage;

export function isBackgroundJobMessage(
  value: unknown,
): value is BackgroundJobMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;

  const message = Object.fromEntries(Object.entries(value));
  const type = message.type;

  if (type === "SCHEDULED_NOTIFICATIONS" || type === "PORTAL_DIGEST") {
    return true;
  }

  if (type === "CERTIFICATE_XLSX_PREVIEW") {
    return (
      typeof message.previewId === "number" &&
      typeof message.templateVersionId === "number" &&
      typeof message.userId === "string"
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
