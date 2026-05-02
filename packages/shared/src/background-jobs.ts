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
  integrationId: string;
  organizationId: string;
  runId: string;
  target: "customer" | "service_order" | "billing_document";
  limit: number;
  trigger: "manual" | "event" | "scheduled" | "retry";
};

export type ScheduledNotificationsBackgroundJobMessage = {
  type: "SCHEDULED_NOTIFICATIONS";
};

export type BackgroundJobMessage =
  | DocumentBackgroundJobMessage
  | IntegrationSyncBackgroundJobMessage
  | ScheduledNotificationsBackgroundJobMessage;

export function isBackgroundJobMessage(
  value: unknown,
): value is BackgroundJobMessage {
  if (!value || typeof value !== "object") return false;

  const message = value as Record<string, unknown>;
  const type = message.type;

  if (type === "SCHEDULED_NOTIFICATIONS") return true;

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
