// Tables of the "public-api" area. Part of the schema entry packages/db/src/schema.ts.
import {
  pgTable,
  text,
  timestamp,
  index,
  uniqueIndex,
  jsonb,
  integer,
} from "drizzle-orm/pg-core";
import type {
  PublicApiResourceType,
  PublicApiWebhookAttempt,
  PublicApiWebhookDeliveryStatus,
  PublicApiWebhookEvent,
  PublicApiWebhookSubscriptionStatus,
} from "@calibra-facil/shared";
import { organization, organizationApiKey, user } from "./identity";

export const publicApiResourceRef = pgTable(
  "public_api_resource_ref",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    resourceType: text("resource_type")
      .$type<PublicApiResourceType>()
      .notNull(),
    resourceId: text("resource_id").notNull(),
    externalId: text("external_id").notNull(),
    createdByApiKeyId: text("created_by_api_key_id").references(
      () => organizationApiKey.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("public_api_resource_ref_org_idx").on(table.organizationId),
    index("public_api_resource_ref_type_idx").on(table.resourceType),
    uniqueIndex("public_api_resource_ref_external_uidx").on(
      table.organizationId,
      table.resourceType,
      table.externalId,
    ),
    uniqueIndex("public_api_resource_ref_resource_uidx").on(
      table.organizationId,
      table.resourceType,
      table.resourceId,
    ),
  ],
);

export const publicApiIdempotencyKey = pgTable(
  "public_api_idempotency_key",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    apiKeyId: text("api_key_id")
      .notNull()
      .references(() => organizationApiKey.id, { onDelete: "cascade" }),
    requestMethod: text("request_method").notNull(),
    requestPath: text("request_path").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    responseStatus: integer("response_status").notNull(),
    responseBody: jsonb("response_body")
      .$type<Record<string, unknown>>()
      .notNull(),
    resourceType: text("resource_type").$type<PublicApiResourceType>(),
    resourceId: text("resource_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at"),
  },
  (table) => [
    index("public_api_idempotency_org_idx").on(table.organizationId),
    index("public_api_idempotency_api_key_idx").on(table.apiKeyId),
    uniqueIndex("public_api_idempotency_request_uidx").on(
      table.organizationId,
      table.apiKeyId,
      table.requestMethod,
      table.requestPath,
      table.idempotencyKey,
    ),
  ],
);

export const publicApiWebhookSubscription = pgTable(
  "public_api_webhook_subscription",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    targetUrl: text("target_url").notNull(),
    events: jsonb("events")
      .$type<PublicApiWebhookEvent[]>()
      .default([])
      .notNull(),
    status: text("status")
      .$type<PublicApiWebhookSubscriptionStatus>()
      .default("ACTIVE")
      .notNull(),
    secretPrefix: text("secret_prefix").notNull(),
    encryptedSecret: text("encrypted_secret").notNull(),
    secretIv: text("secret_iv").notNull(),
    lastSuccessAt: timestamp("last_success_at"),
    lastFailureAt: timestamp("last_failure_at"),
    consecutiveFailures: integer("consecutive_failures").default(0).notNull(),
    // Set when the subscription switched itself off after too many failed
    // deliveries in a row (and why); cleared when it is activated again.
    disabledAt: timestamp("disabled_at"),
    disabledReason: text("disabled_reason"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    updatedBy: text("updated_by").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("public_api_webhook_subscription_org_idx").on(table.organizationId),
    index("public_api_webhook_subscription_status_idx").on(table.status),
  ],
);

export const publicApiWebhookDelivery = pgTable(
  "public_api_webhook_delivery",
  {
    id: text("id").primaryKey(),
    subscriptionId: text("subscription_id")
      .notNull()
      .references(() => publicApiWebhookSubscription.id, {
        onDelete: "cascade",
      }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    eventId: text("event_id").notNull(),
    eventType: text("event_type").$type<PublicApiWebhookEvent>().notNull(),
    requestUrl: text("request_url").notNull(),
    requestBody: jsonb("request_body")
      .$type<Record<string, unknown>>()
      .notNull(),
    responseStatus: integer("response_status"),
    // A snippet (a few hundred bytes) of the subscriber's last answer, never
    // the whole body: the subscriber is outside our control.
    responseBody: text("response_body"),
    attemptCount: integer("attempt_count").default(0).notNull(),
    // One entry per call made (PublicApiWebhookAttempt), oldest first, capped.
    attempts: jsonb("attempts")
      .$type<PublicApiWebhookAttempt[]>()
      .default([])
      .notNull(),
    // When the queue will try again; null once delivered or given up.
    nextAttemptAt: timestamp("next_attempt_at"),
    status: text("status")
      .$type<PublicApiWebhookDeliveryStatus>()
      .default("PENDING")
      .notNull(),
    deliveredAt: timestamp("delivered_at"),
    failedAt: timestamp("failed_at"),
    lastError: text("last_error"),
    replayOfDeliveryId: text("replay_of_delivery_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("public_api_webhook_delivery_subscription_idx").on(
      table.subscriptionId,
    ),
    index("public_api_webhook_delivery_org_idx").on(table.organizationId),
    index("public_api_webhook_delivery_event_idx").on(table.eventId),
    index("public_api_webhook_delivery_status_idx").on(table.status),
  ],
);
