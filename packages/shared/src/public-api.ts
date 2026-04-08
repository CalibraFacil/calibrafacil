export const PUBLIC_API_RESOURCE_TYPES = [
  "customer",
  "asset",
  "request",
  "job",
] as const;

export type PublicApiResourceType =
  (typeof PUBLIC_API_RESOURCE_TYPES)[number];

export const PUBLIC_API_WEBHOOK_EVENTS = [
  "customer.created",
  "customer.updated",
  "customer.deleted",
  "asset.created",
  "asset.updated",
  "asset.deleted",
  "request.created",
  "request.updated",
  "request.submitted",
  "request.canceled",
  "job.created",
  "job.updated",
  "job.results_submitted",
  "job.approved",
  "job.canceled",
  "certificate.available",
] as const;

export type PublicApiWebhookEvent =
  (typeof PUBLIC_API_WEBHOOK_EVENTS)[number];

export const PUBLIC_API_WEBHOOK_SUBSCRIPTION_STATUSES = [
  "ACTIVE",
  "INACTIVE",
] as const;

export type PublicApiWebhookSubscriptionStatus =
  (typeof PUBLIC_API_WEBHOOK_SUBSCRIPTION_STATUSES)[number];

export const PUBLIC_API_WEBHOOK_DELIVERY_STATUSES = [
  "PENDING",
  "SUCCESS",
  "FAILED",
] as const;

export type PublicApiWebhookDeliveryStatus =
  (typeof PUBLIC_API_WEBHOOK_DELIVERY_STATUSES)[number];
