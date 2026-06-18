import { relations, sql } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  boolean,
  foreignKey,
  index,
  unique,
  uniqueIndex,
  serial,
  jsonb,
  integer,
  real,
  doublePrecision,
} from "drizzle-orm/pg-core";
import type {
  BillingCustomerStatus,
  BillingDocumentExportStatus,
  BillingDocumentStatus,
  CommercialActivationBehavior,
  CommercialAgreementStatus,
  CommercialDealStatus,
  CommercialHistorySource,
  CommercialOfferItemType,
  CommercialOfferKind,
  CommercialOfferStatus,
  CommercialOfferAccessEventType,
  CommercialPaymentMethod,
  CommercialPublicCheckoutState,
  CommercialProvider,
  CommercialProviderMode,
  CommercialRenewalMode,
  CustomerSuccessBlocker,
  CustomerSuccessHealthStatus,
  CustomerSuccessSlaTier,
  FinancialPaymentMethod,
  FinancialErpConnectionConfig,
  GoLiveStatus,
  IntegrationCredentialType,
  IntegrationEventLevel,
  IntegrationObjectLinkTarget,
  IntegrationProvider,
  IntegrationStatus,
  IntegrationSyncItemOperation,
  IntegrationSyncItemStatus,
  IntegrationSyncStatus,
  IntegrationSyncTarget,
  IntegrationSyncTrigger,
  IntegrationType,
  JobCommercialSnapshotSource,
  MigrationStatus,
  OnboardingStatus,
  PublicApiResourceType,
  PublicApiWebhookDeliveryStatus,
  PublicApiWebhookEvent,
  PublicApiWebhookSubscriptionStatus,
  SupportEventKind,
  SupportRequestCategory,
  SupportRequestPriority,
  SupportRequestStatus,
  ReceivableInstallmentStatus,
  CertificateReleaseStatus,
  CertificateReleasePolicyMode,
  CertificateReleaseAuditSource,
  CertificateReleasePaymentStateSnapshot,
  AutomaticSendMilestone,
  AutomaticSendOutcome,
  SupplierKind,
  BillingGroupStatus,
  MeasurementUnit,
  ServiceOrderActorType,
  ServiceOrderClosingReason,
  ServiceOrderDeliveryMethod,
  ServiceOrderEventType,
  ServiceOrderExecutionResult,
  ServiceOrderIntakeType,
  ServiceOrderItemType,
  ServiceOrderManualApprovalEvidenceType,
  ServiceOrderPriority,
  ServiceOrderQuoteStatus,
  ServiceOrderRecommendedAction,
  ServiceOrderStatus,
} from "@calibra-facil/shared";

// =============================================================================
// ASSET TYPE - Dynamic Instrument Classification (ISO 17025)
// =============================================================================

/**
 * Field definition for dynamic asset specifications.
 * This defines the "blueprint" for what fields an instrument type requires.
 */
export type AssetTypeFieldDefinition = {
  key: string; // e.g., "resolution"
  label: string; // e.g., "Resolution (d)"
  type: "text" | "number" | "select" | "weighing_ranges";
  options?: string[]; // For select type
  unit?: string; // e.g., "g", "°C", "mm"
  required?: boolean;
};

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  role: text("role").default("user").notNull(),
  banned: boolean("banned").default(false).notNull(),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires"),
  // Better Auth two-factor plugin (mounted on the backoffice surface only).
  twoFactorEnabled: boolean("two_factor_enabled").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    activeOrganizationId: text("active_organization_id"),
    impersonatedBy: text("impersonated_by").references(() => user.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    index("session_userId_idx").on(table.userId),
    // Expired-session cleanup (auth-maintenance cron) sweeps by expiry.
    index("session_expires_at_idx").on(table.expiresAt),
  ],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("account_userId_idx").on(table.userId),
    uniqueIndex("account_provider_account_uidx").on(
      table.providerId,
      table.accountId,
    ),
  ],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("verification_identifier_idx").on(table.identifier),
    // Expired-verification cleanup (auth-maintenance cron) sweeps by expiry.
    index("verification_expires_at_idx").on(table.expiresAt),
  ],
);

export const passkey = pgTable(
  "passkey",
  {
    id: text("id").primaryKey(),
    name: text("name"),
    publicKey: text("public_key").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    credentialID: text("credential_id").notNull(),
    counter: integer("counter").notNull(),
    deviceType: text("device_type").notNull(),
    backedUp: boolean("backed_up").notNull(),
    transports: text("transports"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    aaguid: text("aaguid"),
  },
  (table) => [
    index("passkey_user_id_idx").on(table.userId),
    uniqueIndex("passkey_credential_id_uidx").on(table.credentialID),
  ],
);

/**
 * Better Auth two-factor plugin store (TOTP secret + backup codes).
 * Field/column names must match the plugin schema so the Drizzle adapter can
 * resolve them. Only the backoffice auth instance mounts the twoFactor plugin,
 * but the table is shared like the other auth tables.
 */
export const twoFactor = pgTable(
  "twoFactor",
  {
    id: text("id").primaryKey(),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    verified: boolean("verified").default(true).notNull(),
  },
  (table) => [index("two_factor_user_id_idx").on(table.userId)],
);

/** Backoffice-managed tenant lifecycle state. */
export type OrganizationStatus = "ACTIVE" | "SUSPENDED" | "OFFBOARDING";

export const organization = pgTable(
  "organization",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    logo: text("logo"),
    createdAt: timestamp("created_at").notNull(),
    metadata: text("metadata"),
    type: text("type").default("LAB"),
    // Backoffice-managed tenant lifecycle (suspend / offboard).
    status: text("status")
      .$type<OrganizationStatus>()
      .default("ACTIVE")
      .notNull(),
    suspendedAt: timestamp("suspended_at"),
    suspensionReason: text("suspension_reason"),
    deletionScheduledAt: timestamp("deletion_scheduled_at"),
    // ISO 17025 / RBC compliance fields
    cnpj: text("cnpj"),
    accreditationNumber: text("accreditation_number"),
    accreditationBody: text("accreditation_body"),
    // Explicit toggle: the lab declares its CGCRE/RBC accreditation active.
    // The accreditation seal only renders when this is on AND a number is set.
    accreditationActive: boolean("accreditation_active")
      .default(false)
      .notNull(),
    street: text("street"),
    number: text("number"),
    complement: text("complement"),
    neighbourhood: text("neighbourhood"),
    city: text("city"),
    state: text("state"),
    cep: text("cep"),
    phone: text("phone"),
    email: text("email"),
    website: text("website"),
    technicalManagerName: text("technical_manager_name"),
    technicalManagerTitle: text("technical_manager_title"),
    // Billing / Asaas integration
    asaasCustomerId: text("asaas_customer_id"),
  },
  (table) => [uniqueIndex("organization_slug_uidx").on(table.slug)],
);

export type CertificateSequenceResetScope =
  | "never"
  | "year"
  | "month"
  | "project";

export type CertificateNumberingConfig = {
  labCode: string;
  projectCode?: string | null;
  numberTemplate: string;
  certificateNameTemplate: string;
  sequence: {
    resetScope: CertificateSequenceResetScope;
    startAt: number;
    increment: number;
    padding: number;
  };
};

export type CertificateNumberingSnapshot = {
  profileId: number | null;
  profileName: string;
  config: CertificateNumberingConfig;
  sequenceKey: string;
  sequenceValue: number;
  generatedAt: string;
};

export const certificateNumberingProfile = pgTable(
  "certificate_numbering_profile",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").default("Padrao").notNull(),
    config: jsonb("config").$type<CertificateNumberingConfig>().notNull(),
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
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
    uniqueIndex("certificate_numbering_profile_org_uidx").on(
      table.organizationId,
    ),
  ],
);

export const certificateNumberingSequence = pgTable(
  "certificate_numbering_sequence",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    profileId: integer("profile_id")
      .notNull()
      .references(() => certificateNumberingProfile.id, {
        onDelete: "cascade",
      }),
    sequenceKey: text("sequence_key").notNull(),
    currentValue: integer("current_value").default(0).notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("certificate_numbering_sequence_uidx").on(
      table.organizationId,
      table.profileId,
      table.sequenceKey,
    ),
  ],
);

export const certificateNumberingAuditLog = pgTable(
  "certificate_numbering_audit_log",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    profileId: integer("profile_id").references(
      () => certificateNumberingProfile.id,
      { onDelete: "set null" },
    ),
    action: text("action").notNull(),
    changes: jsonb("changes").$type<Record<string, unknown>>(),
    performedBy: text("performed_by").references(() => user.id, {
      onDelete: "set null",
    }),
    ipAddress: text("ip_address"),
    performedAt: timestamp("performed_at").defaultNow().notNull(),
  },
  (table) => [
    index("certificate_numbering_audit_org_idx").on(table.organizationId),
    index("certificate_numbering_audit_profile_idx").on(table.profileId),
  ],
);

export const member = pgTable(
  "member",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").default("member").notNull(),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    index("member_organizationId_idx").on(table.organizationId),
    index("member_userId_idx").on(table.userId),
    uniqueIndex("member_organization_user_uidx").on(
      table.organizationId,
      table.userId,
    ),
  ],
);

export type OrganizationUnitStatus = "ACTIVE" | "ARCHIVED";
export type MemberUnitRole = "member" | "technician" | "unit_admin";

export const organizationUnit = pgTable(
  "organization_unit",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    status: text("status")
      .$type<OrganizationUnitStatus>()
      .default("ACTIVE")
      .notNull(),
    isDefault: boolean("is_default").default(false).notNull(),
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
    archivedAt: timestamp("archived_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("organization_unit_org_id_idx").on(table.organizationId),
    index("organization_unit_status_idx").on(table.status),
    uniqueIndex("organization_unit_org_slug_uidx").on(
      table.organizationId,
      table.slug,
    ),
  ],
);

export const memberUnitAssignment = pgTable(
  "member_unit_assignment",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    memberId: text("member_id")
      .notNull()
      .references(() => member.id, { onDelete: "cascade" }),
    unitId: integer("unit_id")
      .notNull()
      .references(() => organizationUnit.id, { onDelete: "cascade" }),
    role: text("role").$type<MemberUnitRole>().default("member").notNull(),
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("member_unit_assignment_org_id_idx").on(table.organizationId),
    index("member_unit_assignment_member_id_idx").on(table.memberId),
    index("member_unit_assignment_unit_id_idx").on(table.unitId),
    unique("member_unit_assignment_member_unit_unique").on(
      table.memberId,
      table.unitId,
    ),
  ],
);

export const organizationEventLog = pgTable(
  "organization_event_log",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    unitId: integer("unit_id").references(() => organizationUnit.id, {
      onDelete: "set null",
    }),
    actorUserId: text("actor_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    actorMemberId: text("actor_member_id").references(() => member.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    details: jsonb("details").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("organization_event_log_org_id_idx").on(table.organizationId),
    index("organization_event_log_unit_id_idx").on(table.unitId),
    index("organization_event_log_action_idx").on(table.action),
    index("organization_event_log_created_at_idx").on(table.createdAt),
  ],
);

export const platformEventLog = pgTable(
  "platform_event_log",
  {
    id: serial("id").primaryKey(),
    actorUserId: text("actor_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    targetUserId: text("target_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    details: jsonb("details").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("platform_event_log_action_idx").on(table.action),
    index("platform_event_log_actor_user_idx").on(table.actorUserId),
    index("platform_event_log_target_user_idx").on(table.targetUserId),
    index("platform_event_log_created_at_idx").on(table.createdAt),
  ],
);

export const organizationSuccessProfile = pgTable(
  "organization_success_profile",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    accountOwnerUserId: text("account_owner_user_id").references(
      () => user.id,
      {
        onDelete: "set null",
      },
    ),
    accountOwnerName: text("account_owner_name"),
    accountOwnerEmail: text("account_owner_email"),
    supportContactEmail: text("support_contact_email"),
    internalOwnerUserId: text("internal_owner_user_id").references(
      () => user.id,
      {
        onDelete: "set null",
      },
    ),
    prioritySupport: boolean("priority_support").default(false).notNull(),
    slaTier: text("sla_tier")
      .$type<CustomerSuccessSlaTier>()
      .default("PLAN_DEFAULT")
      .notNull(),
    onboardingStatus: text("onboarding_status")
      .$type<OnboardingStatus>()
      .default("NOT_STARTED")
      .notNull(),
    migrationStatus: text("migration_status")
      .$type<MigrationStatus>()
      .default("NOT_REQUIRED")
      .notNull(),
    goLiveStatus: text("go_live_status")
      .$type<GoLiveStatus>()
      .default("NOT_SCHEDULED")
      .notNull(),
    healthStatus: text("health_status")
      .$type<CustomerSuccessHealthStatus>()
      .default("HEALTHY")
      .notNull(),
    blockers: jsonb("blockers").$type<CustomerSuccessBlocker[]>(),
    nextAction: text("next_action"),
    nextActionDueAt: timestamp("next_action_due_at"),
    nextActionCompletedAt: timestamp("next_action_completed_at"),
    goLiveTargetDate: timestamp("go_live_target_date"),
    goLiveActualDate: timestamp("go_live_actual_date"),
    publicStatusNote: text("public_status_note"),
    internalNotes: text("internal_notes"),
    lastTouchedAt: timestamp("last_touched_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("organization_success_profile_org_uidx").on(
      table.organizationId,
    ),
    index("organization_success_profile_onboarding_idx").on(
      table.onboardingStatus,
    ),
    index("organization_success_profile_migration_idx").on(
      table.migrationStatus,
    ),
    index("organization_success_profile_go_live_idx").on(table.goLiveStatus),
    index("organization_success_profile_health_idx").on(table.healthStatus),
    index("organization_success_profile_priority_support_idx").on(
      table.prioritySupport,
    ),
    index("organization_success_profile_next_action_due_idx").on(
      table.nextActionDueAt,
    ),
  ],
);

export const organizationSupportRequest = pgTable(
  "organization_support_request",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    requestedByUserId: text("requested_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    assignedToUserId: text("assigned_to_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    category: text("category").$type<SupportRequestCategory>().notNull(),
    priority: text("priority")
      .$type<SupportRequestPriority>()
      .default("NORMAL")
      .notNull(),
    status: text("status")
      .$type<SupportRequestStatus>()
      .default("OPEN")
      .notNull(),
    subject: text("subject").notNull(),
    description: text("description").notNull(),
    publicResponse: text("public_response"),
    slaTargetAt: timestamp("sla_target_at"),
    firstResponseAt: timestamp("first_response_at"),
    escalatedAt: timestamp("escalated_at"),
    escalatedByUserId: text("escalated_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    escalationReason: text("escalation_reason"),
    resolvedAt: timestamp("resolved_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("organization_support_request_org_idx").on(table.organizationId),
    index("organization_support_request_status_idx").on(table.status),
    index("organization_support_request_priority_idx").on(table.priority),
    index("organization_support_request_escalated_at_idx").on(
      table.escalatedAt,
    ),
    index("organization_support_request_created_at_idx").on(table.createdAt),
  ],
);

export const organizationSupportRequestEvent = pgTable(
  "organization_support_request_event",
  {
    id: serial("id").primaryKey(),
    supportRequestId: integer("support_request_id")
      .notNull()
      .references(() => organizationSupportRequest.id, {
        onDelete: "cascade",
      }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    kind: text("kind").$type<SupportEventKind>().notNull(),
    message: text("message").notNull(),
    publicVisible: boolean("public_visible").default(false).notNull(),
    details: jsonb("details").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("organization_support_request_event_request_idx").on(
      table.supportRequestId,
    ),
    index("organization_support_request_event_org_idx").on(
      table.organizationId,
    ),
    index("organization_support_request_event_kind_idx").on(table.kind),
    index("organization_support_request_event_created_at_idx").on(
      table.createdAt,
    ),
  ],
);

/**
 * Backoffice account tasks — first-class, assignable, due-dated operator tasks
 * per account, superseding the single free-text `nextAction` field. The
 * substrate for onboarding / migration / dunning / go-live playbook motions and
 * an operator "my day" worklist.
 */
export type AccountTaskStatus = "OPEN" | "DONE" | "CANCELED";
export type AccountTaskType =
  | "ONBOARDING"
  | "MIGRATION"
  | "GO_LIVE"
  | "DUNNING"
  | "CHECK_IN"
  | "GENERAL";

export type ApprovalRequestStatus = "PENDING" | "APPROVED" | "REJECTED";
export type ApprovalRequestKind = "refund" | "credit" | "adjustment" | "other";

// VALIDATED = dry-run preview persisted as an audit record (current scope).
// COMMITTED is reserved for the gated follow-up that writes real domain rows.
export type ImportRunStatus = "VALIDATED" | "COMMITTED";

export type AccountInteractionChannel =
  | "whatsapp"
  | "email"
  | "phone"
  | "meeting"
  | "note"
  | "other";
export type AccountInteractionDirection = "outbound" | "inbound" | "internal";

export type OperatorAlertSeverity = "info" | "warning" | "critical";
export type OperatorAlertStatus = "OPEN" | "ACKNOWLEDGED";

export const accountTask = pgTable(
  "account_task",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    type: text("type").$type<AccountTaskType>().default("GENERAL").notNull(),
    status: text("status").$type<AccountTaskStatus>().default("OPEN").notNull(),
    ownerUserId: text("owner_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    dueAt: timestamp("due_at"),
    notes: text("notes"),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    completedAt: timestamp("completed_at"),
    completedByUserId: text("completed_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("account_task_org_id_idx").on(table.organizationId),
    index("account_task_status_idx").on(table.status),
    index("account_task_owner_idx").on(table.ownerUserId),
    index("account_task_due_idx").on(table.dueAt),
  ],
);

/**
 * Backoffice entitlement overrides — per-org GRANTS layered on top of the plan
 * (comps, upsell trials, one-off feature access). Grant-only and optionally
 * time-boxed; merged into `getOrganizationPlanAccess` so the override never
 * removes a plan entitlement, only adds. `feature` is a `FeatureFlag` string.
 */
export const entitlementOverride = pgTable(
  "entitlement_override",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    feature: text("feature").notNull(),
    reason: text("reason"),
    expiresAt: timestamp("expires_at"),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("entitlement_override_org_idx").on(table.organizationId)],
);

/**
 * Backoffice approval requests — maker-checker / dual-control over sensitive,
 * money-touching actions (refunds, credits, adjustments). One operator opens a
 * request; a *different* platform admin approves or rejects it. The decision
 * record is the governance artifact; downstream execution (e.g. an Asaas refund)
 * happens separately and references this request.
 */
export const approvalRequest = pgTable(
  "approval_request",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    kind: text("kind").$type<ApprovalRequestKind>().default("other").notNull(),
    summary: text("summary").notNull(),
    amountCents: integer("amount_cents"),
    status: text("status")
      .$type<ApprovalRequestStatus>()
      .default("PENDING")
      .notNull(),
    requestedByUserId: text("requested_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    decidedByUserId: text("decided_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    decisionReason: text("decision_reason"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    decidedAt: timestamp("decided_at"),
  },
  (table) => [
    index("approval_request_org_idx").on(table.organizationId),
    index("approval_request_status_idx").on(table.status),
  ],
);

/**
 * Backoffice migration-importer audit (operations-console gap #12, preview-only).
 * Each dry-run validation of an uploaded spreadsheet persists one row — what was
 * imported, by whom, against which entity, and how many rows passed/failed. The
 * actual domain-write commit is a gated follow-up (status would advance to
 * COMMITTED); this scope never writes domain records.
 */
export const importRun = pgTable(
  "import_run",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    entity: text("entity").notNull(),
    fileName: text("file_name"),
    status: text("status")
      .$type<ImportRunStatus>()
      .default("VALIDATED")
      .notNull(),
    totalRows: integer("total_rows").default(0).notNull(),
    validRows: integer("valid_rows").default(0).notNull(),
    errorRows: integer("error_rows").default(0).notNull(),
    mapping: jsonb("mapping").$type<Record<string, string>>(),
    errorsSample: jsonb("errors_sample").$type<unknown>(),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("import_run_org_idx").on(table.organizationId),
    index("import_run_created_idx").on(table.createdAt),
  ],
);

/**
 * Account interaction log (operations-console gap #14, omnichannel core). A
 * unified, manually-recorded timeline of operator↔tenant touchpoints (WhatsApp,
 * email, call, meeting, internal note) so context lives in one place. Auto-capture
 * from the actual channels (WhatsApp/email providers) is the external follow-up;
 * this is the in-repo log + surface.
 */
export const accountInteraction = pgTable(
  "account_interaction",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    channel: text("channel")
      .$type<AccountInteractionChannel>()
      .default("note")
      .notNull(),
    direction: text("direction")
      .$type<AccountInteractionDirection>()
      .default("outbound")
      .notNull(),
    summary: text("summary").notNull(),
    occurredAt: timestamp("occurred_at").defaultNow().notNull(),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("account_interaction_org_idx").on(table.organizationId),
    index("account_interaction_occurred_idx").on(table.occurredAt),
  ],
);

/**
 * Operator-addressed alerts (operations-console gap #5). A scheduler-driven engine
 * (the `operator-alerts` cron) recomputes proactive risk signals and upserts them
 * here so the *team* is notified — until now only labs were. `dedupeKey` makes
 * recompute idempotent; alerts whose condition clears are swept on the next run;
 * acknowledgement persists while the condition holds.
 */
export const operatorAlert = pgTable(
  "operator_alert",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id").references(() => organization.id, {
      onDelete: "cascade",
    }),
    dedupeKey: text("dedupe_key").notNull().unique(),
    kind: text("kind").notNull(),
    severity: text("severity")
      .$type<OperatorAlertSeverity>()
      .default("warning")
      .notNull(),
    title: text("title").notNull(),
    detail: text("detail"),
    status: text("status")
      .$type<OperatorAlertStatus>()
      .default("OPEN")
      .notNull(),
    acknowledgedByUserId: text("acknowledged_by_user_id").references(
      () => user.id,
      { onDelete: "set null" },
    ),
    acknowledgedAt: timestamp("acknowledged_at"),
    firstSeenAt: timestamp("first_seen_at").defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("operator_alert_status_idx").on(table.status),
    index("operator_alert_org_idx").on(table.organizationId),
  ],
);

export const invitation = pgTable(
  "invitation",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role"),
    status: text("status").default("pending").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    inviterId: text("inviter_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("invitation_organizationId_idx").on(table.organizationId),
    index("invitation_email_idx").on(table.email),
  ],
);

export type LabAccountSetupTokenPurpose = "owner_claim" | "member_invite_claim";

export const labAccountSetupToken = pgTable(
  "lab_account_setup_token",
  {
    id: text("id").primaryKey(),
    secretHash: text("secret_hash").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    invitationId: text("invitation_id").references(() => invitation.id, {
      onDelete: "cascade",
    }),
    email: text("email").notNull(),
    purpose: text("purpose").$type<LabAccountSetupTokenPurpose>().notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    consumedAt: timestamp("consumed_at"),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    source: text("source").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("lab_account_setup_token_user_idx").on(table.userId),
    index("lab_account_setup_token_org_idx").on(table.organizationId),
    index("lab_account_setup_token_invitation_idx").on(table.invitationId),
    index("lab_account_setup_token_expires_idx").on(table.expiresAt),
    index("lab_account_setup_token_consumed_idx").on(table.consumedAt),
  ],
);

export const ssoProvider = pgTable(
  "sso_provider",
  {
    id: text("id").primaryKey(),
    issuer: text("issuer").notNull(),
    oidcConfig: text("oidc_config"),
    samlConfig: text("saml_config"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    providerId: text("provider_id").notNull().unique(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, {
        onDelete: "cascade",
      }),
    domain: text("domain").notNull(),
    domainVerified: boolean("domain_verified").default(false),
  },
  (table) => [
    index("sso_provider_user_id_idx").on(table.userId),
    index("sso_provider_org_id_idx").on(table.organizationId),
    uniqueIndex("sso_provider_org_id_uidx").on(table.organizationId),
  ],
);

export const organizationCustomDomain = pgTable(
  "organization_custom_domain",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    hostname: text("hostname").notNull().unique(),
    verificationToken: text("verification_token").notNull(),
    verifiedAt: timestamp("verified_at"),
    activatedAt: timestamp("activated_at"),
    lastVerifiedAt: timestamp("last_verified_at"),
    isActive: boolean("is_active").default(false).notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("org_custom_domain_org_uidx").on(table.organizationId),
    uniqueIndex("org_custom_domain_hostname_uidx").on(table.hostname),
    index("org_custom_domain_active_idx").on(table.isActive),
  ],
);

export const certificateTemplate = pgTable(
  "certificate_template",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    version: integer("version").default(1).notNull(),
    status: text("status").default("ACTIVE").notNull(),
    isDefault: boolean("is_default").default(false).notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    archivedAt: timestamp("archived_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("certificate_template_org_id_idx").on(table.organizationId),
    index("certificate_template_status_idx").on(table.status),
    uniqueIndex("certificate_template_org_slug_uidx").on(
      table.organizationId,
      table.slug,
    ),
  ],
);

export type CertificateXlsxTemplateVersionStatus =
  | "DRAFT"
  | "VALIDATED"
  | "PUBLISHED"
  | "ARCHIVED";

export type CertificateXlsxTemplateAssignmentStatus = "ACTIVE" | "ARCHIVED";
export type CertificateXlsxTemplatePreviewStatus =
  | "PENDING"
  | "RENDERED"
  | "FAILED"
  | "EXPIRED";

export type IssuedCertificateSnapshotStatus =
  | "ISSUED"
  | "SUPERSEDED"
  | "VOIDED";

export type CertificateXlsxRenderPolicy = {
  formulas: "preserve" | "rejectVolatile";
  macros: "reject";
  externalLinks: "reject";
  converter: "gotenberg-libreoffice";
};

export const certificateTemplateVersion = pgTable(
  "certificate_template_version",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    templateId: integer("template_id")
      .notNull()
      .references(() => certificateTemplate.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    status: text("status")
      .$type<CertificateXlsxTemplateVersionStatus>()
      .default("DRAFT")
      .notNull(),
    xlsxR2Key: text("xlsx_r2_key").notNull(),
    xlsxSha256: text("xlsx_sha256").notNull(),
    bindingManifest: jsonb("binding_manifest")
      .$type<Record<string, unknown>>()
      .notNull(),
    bindingManifestSha256: text("binding_manifest_sha256").notNull(),
    renderPolicy: jsonb("render_policy")
      .$type<CertificateXlsxRenderPolicy>()
      .notNull(),
    analysis: jsonb("analysis").$type<Record<string, unknown>>(),
    validationResult:
      jsonb("validation_result").$type<Record<string, unknown>>(),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    publishedAt: timestamp("published_at"),
    publishedBy: text("published_by").references(() => user.id, {
      onDelete: "set null",
    }),
    archivedAt: timestamp("archived_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("certificate_template_version_org_idx").on(table.organizationId),
    index("certificate_template_version_template_idx").on(table.templateId),
    index("certificate_template_version_status_idx").on(table.status),
    uniqueIndex("certificate_template_version_template_version_uidx").on(
      table.templateId,
      table.version,
    ),
  ],
);

export const certificateTemplateAssignment = pgTable(
  "certificate_template_assignment",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    templateId: integer("template_id")
      .notNull()
      .references(() => certificateTemplate.id, { onDelete: "cascade" }),
    templateVersionId: integer("template_version_id")
      .notNull()
      .references(() => certificateTemplateVersion.id, {
        onDelete: "restrict",
      }),
    unitId: integer("unit_id").references(() => organizationUnit.id, {
      onDelete: "cascade",
    }),
    serviceId: integer("service_id").references(() => service.id, {
      onDelete: "cascade",
    }),
    methodId: integer("method_id").references(() => calibrationMethod.id, {
      onDelete: "cascade",
    }),
    certificateType: text("certificate_type").default("calibration").notNull(),
    status: text("status")
      .$type<CertificateXlsxTemplateAssignmentStatus>()
      .default("ACTIVE")
      .notNull(),
    priority: integer("priority").default(0).notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    archivedAt: timestamp("archived_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("certificate_template_assignment_org_idx").on(table.organizationId),
    index("certificate_template_assignment_template_idx").on(table.templateId),
    index("certificate_template_assignment_version_idx").on(
      table.templateVersionId,
    ),
    index("certificate_template_assignment_unit_idx").on(table.unitId),
    index("certificate_template_assignment_service_idx").on(table.serviceId),
    index("certificate_template_assignment_method_idx").on(table.methodId),
    index("certificate_template_assignment_status_idx").on(table.status),
  ],
);

export const certificateTemplatePreview = pgTable(
  "certificate_template_preview",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    templateVersionId: integer("template_version_id")
      .notNull()
      .references(() => certificateTemplateVersion.id, {
        onDelete: "cascade",
      }),
    sampleData: jsonb("sample_data").$type<Record<string, unknown>>(),
    filledXlsxR2Key: text("filled_xlsx_r2_key"),
    pdfR2Key: text("pdf_r2_key"),
    pdfSha256: text("pdf_sha256"),
    renderMetadata: jsonb("render_metadata").$type<Record<string, unknown>>(),
    status: text("status")
      .$type<CertificateXlsxTemplatePreviewStatus>()
      .default("PENDING")
      .notNull(),
    error: text("error"),
    requestedBy: text("requested_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("certificate_template_preview_org_idx").on(table.organizationId),
    index("certificate_template_preview_version_idx").on(
      table.templateVersionId,
    ),
    index("certificate_template_preview_status_idx").on(table.status),
    index("certificate_template_preview_expires_at_idx").on(table.expiresAt),
  ],
);

export const issuedCertificateSnapshot = pgTable(
  "issued_certificate_snapshot",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    jobId: integer("job_id")
      .notNull()
      .references(() => calibrationJob.id, { onDelete: "restrict" }),
    templateId: integer("template_id")
      .notNull()
      .references(() => certificateTemplate.id, { onDelete: "restrict" }),
    templateVersionId: integer("template_version_id")
      .notNull()
      .references(() => certificateTemplateVersion.id, {
        onDelete: "restrict",
      }),
    certificateNumber: text("certificate_number"),
    filledXlsxR2Key: text("filled_xlsx_r2_key").notNull(),
    filledXlsxSha256: text("filled_xlsx_sha256").notNull(),
    pdfR2Key: text("pdf_r2_key").notNull(),
    pdfSha256: text("pdf_sha256").notNull(),
    bindingManifestSha256: text("binding_manifest_sha256").notNull(),
    renderPolicy: jsonb("render_policy")
      .$type<CertificateXlsxRenderPolicy>()
      .notNull(),
    renderMetadata: jsonb("render_metadata").$type<Record<string, unknown>>(),
    inputDataSnapshot: jsonb("input_data_snapshot")
      .$type<Record<string, unknown>>()
      .notNull(),
    status: text("status")
      .$type<IssuedCertificateSnapshotStatus>()
      .default("ISSUED")
      .notNull(),
    issuedBy: text("issued_by").references(() => user.id, {
      onDelete: "set null",
    }),
    issuedAt: timestamp("issued_at").defaultNow().notNull(),
    supersededById: integer("superseded_by_id"),
    voidedAt: timestamp("voided_at"),
    voidedBy: text("voided_by").references(() => user.id, {
      onDelete: "set null",
    }),
    voidReason: text("void_reason"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("issued_certificate_snapshot_org_idx").on(table.organizationId),
    uniqueIndex("issued_certificate_snapshot_job_uidx").on(table.jobId),
    index("issued_certificate_snapshot_template_idx").on(table.templateId),
    index("issued_certificate_snapshot_version_idx").on(
      table.templateVersionId,
    ),
    index("issued_certificate_snapshot_status_idx").on(table.status),
  ],
);

export const organizationApiKey = pgTable(
  "organization_api_key",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    keyPrefix: text("key_prefix").notNull(),
    keyHash: text("key_hash").notNull().unique(),
    scopes: jsonb("scopes").$type<string[]>().default([]).notNull(),
    lastUsedAt: timestamp("last_used_at"),
    lastUsedIp: text("last_used_ip"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    revokedAt: timestamp("revoked_at"),
    revokedBy: text("revoked_by").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("organization_api_key_org_id_idx").on(table.organizationId),
    uniqueIndex("organization_api_key_hash_uidx").on(table.keyHash),
  ],
);

export const organizationApiKeyAuditLog = pgTable(
  "organization_api_key_audit_log",
  {
    id: serial("id").primaryKey(),
    apiKeyId: text("api_key_id")
      .notNull()
      .references(() => organizationApiKey.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    performedBy: text("performed_by").references(() => user.id, {
      onDelete: "set null",
    }),
    ipAddress: text("ip_address"),
    details: jsonb("details").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("organization_api_key_audit_log_key_idx").on(table.apiKeyId),
    index("organization_api_key_audit_log_org_idx").on(table.organizationId),
  ],
);

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
    responseBody: text("response_body"),
    attemptCount: integer("attempt_count").default(0).notNull(),
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

export const organizationIntegration = pgTable(
  "organization_integration",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    type: text("type").$type<IntegrationType>().notNull(),
    provider: text("provider").$type<IntegrationProvider>().notNull(),
    name: text("name").notNull(),
    status: text("status")
      .$type<IntegrationStatus>()
      .default("ACTIVE")
      .notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    updatedBy: text("updated_by").references(() => user.id, {
      onDelete: "set null",
    }),
    lastValidatedAt: timestamp("last_validated_at"),
    lastValidationError: text("last_validation_error"),
    disabledAt: timestamp("disabled_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("organization_integration_org_id_idx").on(table.organizationId),
    index("organization_integration_status_idx").on(table.status),
    uniqueIndex("organization_integration_id_org_uidx").on(
      table.id,
      table.organizationId,
    ),
  ],
);

export const integrationConnection = pgTable(
  "integration_connection",
  {
    id: text("id").primaryKey(),
    integrationId: text("integration_id")
      .notNull()
      .references(() => organizationIntegration.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    credentialType: text("credential_type")
      .$type<IntegrationCredentialType>()
      .default("bearer")
      .notNull(),
    config: jsonb("config").$type<FinancialErpConnectionConfig>().notNull(),
    encryptedSecret: text("encrypted_secret").notNull(),
    secretIv: text("secret_iv").notNull(),
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
    uniqueIndex("integration_connection_integration_uidx").on(
      table.integrationId,
    ),
    index("integration_connection_org_id_idx").on(table.organizationId),
    foreignKey({
      columns: [table.integrationId, table.organizationId],
      foreignColumns: [
        organizationIntegration.id,
        organizationIntegration.organizationId,
      ],
      name: "integration_connection_integration_org_fk",
    }).onDelete("cascade"),
  ],
);

export const integrationObjectLink = pgTable(
  "integration_object_link",
  {
    id: text("id").primaryKey(),
    integrationId: text("integration_id")
      .notNull()
      .references(() => organizationIntegration.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    target: text("target").$type<IntegrationObjectLinkTarget>().notNull(),
    localEntityId: text("local_entity_id").notNull(),
    remoteEntityId: text("remote_entity_id"),
    remoteDisplayId: text("remote_display_id"),
    remoteEntityType: text("remote_entity_type"),
    remoteLegacyId: text("remote_legacy_id"),
    remoteVersion: integer("remote_version"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    lastSyncedAt: timestamp("last_synced_at"),
    // Phase 2 slice 3: operator-acknowledged drift. When a drift state is
    // surfaced via the drift queue and the operator decides the local state
    // is correct (or that the remote will be reconciled separately), they
    // can acknowledge the link to remove it from the queue without
    // resolving the underlying drift.
    driftAcknowledgedAt: timestamp("drift_acknowledged_at"),
    driftAcknowledgedByUserId: text("drift_acknowledged_by_user_id"),
    driftAcknowledgedReason: text("drift_acknowledged_reason"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("integration_object_link_local_uidx").on(
      table.integrationId,
      table.target,
      table.localEntityId,
    ),
    index("integration_object_link_remote_idx").on(
      table.integrationId,
      table.target,
      table.remoteEntityId,
    ),
    index("integration_object_link_drift_ack_idx").on(
      table.organizationId,
      table.driftAcknowledgedAt,
    ),
    foreignKey({
      columns: [table.integrationId, table.organizationId],
      foreignColumns: [
        organizationIntegration.id,
        organizationIntegration.organizationId,
      ],
      name: "integration_object_link_integration_org_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.driftAcknowledgedByUserId],
      foreignColumns: [user.id],
      name: "integration_object_link_drift_ack_user_fk",
    }).onDelete("set null"),
  ],
);

export const integrationSyncRun = pgTable(
  "integration_sync_run",
  {
    id: text("id").primaryKey(),
    integrationId: text("integration_id")
      .notNull()
      .references(() => organizationIntegration.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    trigger: text("trigger").$type<IntegrationSyncTrigger>().notNull(),
    target: text("target").$type<IntegrationSyncTarget>().notNull(),
    status: text("status")
      .$type<IntegrationSyncStatus>()
      .default("PENDING")
      .notNull(),
    initiatedBy: text("initiated_by").references(() => user.id, {
      onDelete: "set null",
    }),
    processedCount: integer("processed_count").default(0).notNull(),
    successCount: integer("success_count").default(0).notNull(),
    errorCount: integer("error_count").default(0).notNull(),
    summary: jsonb("summary").$type<Record<string, unknown>>(),
    errorSummary: text("error_summary"),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("integration_sync_run_integration_idx").on(table.integrationId),
    index("integration_sync_run_org_idx").on(table.organizationId),
    index("integration_sync_run_status_idx").on(table.status),
    index("integration_sync_run_created_at_idx").on(table.createdAt),
    foreignKey({
      columns: [table.integrationId, table.organizationId],
      foreignColumns: [
        organizationIntegration.id,
        organizationIntegration.organizationId,
      ],
      name: "integration_sync_run_integration_org_fk",
    }).onDelete("cascade"),
  ],
);

export const integrationSyncItem = pgTable(
  "integration_sync_item",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => integrationSyncRun.id, { onDelete: "cascade" }),
    integrationId: text("integration_id")
      .notNull()
      .references(() => organizationIntegration.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    target: text("target").$type<IntegrationObjectLinkTarget>().notNull(),
    localEntityId: text("local_entity_id").notNull(),
    remoteEntityId: text("remote_entity_id"),
    operation: text("operation")
      .$type<IntegrationSyncItemOperation>()
      .notNull(),
    status: text("status")
      .$type<IntegrationSyncItemStatus>()
      .default("PENDING")
      .notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    lastErrorCode: text("last_error_code"),
    lastErrorMessage: text("last_error_message"),
    requestFingerprint: text("request_fingerprint"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("integration_sync_item_run_idx").on(table.runId),
    index("integration_sync_item_integration_target_status_idx").on(
      table.integrationId,
      table.target,
      table.status,
    ),
    index("integration_sync_item_local_entity_idx").on(
      table.integrationId,
      table.localEntityId,
    ),
    index("integration_sync_item_request_fingerprint_idx").on(
      table.integrationId,
      table.target,
      table.requestFingerprint,
    ),
    index("integration_sync_item_dead_letter_idx").on(
      table.integrationId,
      table.status,
      table.updatedAt,
    ),
    foreignKey({
      columns: [table.integrationId, table.organizationId],
      foreignColumns: [
        organizationIntegration.id,
        organizationIntegration.organizationId,
      ],
      name: "integration_sync_item_integration_org_fk",
    }).onDelete("cascade"),
  ],
);

export const integrationSyncCursor = pgTable(
  "integration_sync_cursor",
  {
    id: serial("id").primaryKey(),
    integrationId: text("integration_id")
      .notNull()
      .references(() => organizationIntegration.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    cursorType: text("cursor_type").notNull(),
    lastRemoteUpdatedAt: timestamp("last_remote_updated_at"),
    lastSuccessfulPollAt: timestamp("last_successful_poll_at"),
    nextPage: integer("next_page"),
    state: jsonb("state").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("integration_sync_cursor_integration_type_uidx").on(
      table.integrationId,
      table.cursorType,
    ),
    index("integration_sync_cursor_org_type_idx").on(
      table.organizationId,
      table.cursorType,
    ),
    index("integration_sync_cursor_last_poll_idx").on(
      table.lastSuccessfulPollAt,
    ),
    foreignKey({
      columns: [table.integrationId, table.organizationId],
      foreignColumns: [
        organizationIntegration.id,
        organizationIntegration.organizationId,
      ],
      name: "integration_sync_cursor_integration_org_fk",
    }).onDelete("cascade"),
  ],
);

export const integrationEventLog = pgTable(
  "integration_event_log",
  {
    id: serial("id").primaryKey(),
    integrationId: text("integration_id")
      .notNull()
      .references(() => organizationIntegration.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    runId: text("run_id").references(() => integrationSyncRun.id, {
      onDelete: "cascade",
    }),
    level: text("level")
      .$type<IntegrationEventLevel>()
      .default("info")
      .notNull(),
    event: text("event").notNull(),
    message: text("message").notNull(),
    details: jsonb("details").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("integration_event_log_integration_idx").on(table.integrationId),
    index("integration_event_log_org_idx").on(table.organizationId),
    index("integration_event_log_run_idx").on(table.runId),
    index("integration_event_log_created_at_idx").on(table.createdAt),
    foreignKey({
      columns: [table.integrationId, table.organizationId],
      foreignColumns: [
        organizationIntegration.id,
        organizationIntegration.organizationId,
      ],
      name: "integration_event_log_integration_org_fk",
    }).onDelete("cascade"),
  ],
);

// =============================================================================
// ASSET TYPE - Instrument Classification Blueprint
// =============================================================================

/**
 * Asset Type table - Defines instrument categories and their specification fields.
 * Each type has a "definition" that describes what dynamic fields assets of this type need.
 * Examples: Digital Balance, Thermohygrometer, Caliper, Micrometer, etc.
 */
export const assetType = pgTable(
  "asset_type",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(), // e.g., "Balança Digital"
    slug: text("slug").notNull().unique(), // e.g., "balanca-digital"
    description: text("description"), // Optional description
    // The Blueprint: Defines what specification fields this type requires
    // Example: [{ key: "resolution", label: "Resolução", type: "number", unit: "g", required: true }]
    definition: jsonb("definition")
      .$type<AssetTypeFieldDefinition[]>()
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [uniqueIndex("asset_type_slug_uidx").on(table.slug)],
);

// =============================================================================
// CUSTOMER - Client companies that send equipment for calibration
// =============================================================================

/**
 * Address type for customer addresses
 */
export type CustomerAddress = {
  cep?: string;
  number?: string;
  street?: string;
  complement?: string;
  neighbourhood?: string;
  city?: string;
  state?: string;
};

/**
 * Compliance tracking for ISO 17025:2017 clause 7.1
 * Tracks customer qualification status, contracts, and quality requirements
 */
export type CustomerCompliance = {
  qualificationStatus: "pending" | "qualified" | "suspended" | "expired";
  qualificationDate?: string;
  qualificationExpiresAt?: string;
  contractAgreementId?: number;
  contractNumber?: string;
  contractSignedAt?: string;
  contractExpiresAt?: string;
  qualityRequirementsAcknowledged: boolean;
  qualityRequirementsAcknowledgedAt?: string;
  notes?: string;
};

/**
 * Customer table - Business data for client organizations.
 * Links to Better Auth organization via authOrganizationId (the CLIENT org for portal access).
 * Links to LAB organization via labOrganizationId (the LAB that manages this customer).
 */
export const customer = pgTable(
  "customer",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(), // Razao Social / Nome Fantasia
    taxId: text("tax_id"), // CNPJ/VAT
    email: text("email"), // Contact email
    phone: text("phone"), // Optional
    address: jsonb("address").$type<CustomerAddress>(), // CEP, number, street, etc.
    // The CLIENT organization for portal access (created when customer is created)
    authOrganizationId: text("auth_organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // The LAB organization that manages this customer
    labOrganizationId: text("lab_organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // Optional parent group (network/rede). A branch belongs to at most one
    // group; deleting the group detaches branches rather than removing them.
    groupId: integer("group_id").references(() => customerGroup.id, {
      onDelete: "set null",
    }),
    // ISO 17025:2017 compliance tracking
    compliance: jsonb("compliance").$type<CustomerCompliance>(),
    internalNotes: text("internal_notes"), // Internal notes for lab staff
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("customer_auth_org_id_idx").on(table.authOrganizationId),
    index("customer_lab_org_id_idx").on(table.labOrganizationId),
    index("customer_group_id_idx").on(table.groupId),
  ],
);

// =============================================================================
// CUSTOMER GROUP - Multi-unit client (network/rede) grouping branch customers
// =============================================================================
// A customer group is itself a CLIENT organization (its own authOrganizationId)
// so it rides the existing portal switcher/active-org machinery: a unified
// quality manager is invited once to the group org and the portal fans the
// group's active session out to every branch customer (customer.groupId) at
// read time. The group has no customer row of its own.
export const customerGroup = pgTable(
  "customer_group",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    // The CLIENT organization that represents the group for portal access.
    authOrganizationId: text("auth_organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // The LAB organization that owns this group. Branches must share it.
    labOrganizationId: text("lab_organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("customer_group_auth_org_id_idx").on(table.authOrganizationId),
    index("customer_group_lab_org_id_idx").on(table.labOrganizationId),
  ],
);

// =============================================================================
// CUSTOMER AUDIT LOG - ISO 17025:2017 Clause 8.4 (Control of records)
// =============================================================================

/**
 * Audit log for customer changes.
 * Tracks all modifications for compliance and traceability.
 */
export const customerAuditLog = pgTable(
  "customer_audit_log",
  {
    id: serial("id").primaryKey(),
    customerId: serial("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "cascade" }),
    action: text("action").notNull(), // 'create', 'update', 'compliance_change', 'user_invited', 'user_removed', etc.
    changes: jsonb("changes"), // { field: { old: x, new: y } }
    performedBy: text("performed_by")
      .notNull()
      .references(() => user.id),
    performedAt: timestamp("performed_at").defaultNow().notNull(),
    ipAddress: text("ip_address"),
    reason: text("reason"), // Required for compliance changes per ISO 17025
  },
  (table) => [
    index("customer_audit_log_customer_id_idx").on(table.customerId),
    index("customer_audit_log_performed_at_idx").on(table.performedAt),
  ],
);

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  passkeys: many(passkey),
  members: many(member),
  invitations: many(invitation),
  labAccountSetupTokens: many(labAccountSetupToken),
  ssoProviders: many(ssoProvider),
  customDomains: many(organizationCustomDomain),
  certificateTemplates: many(certificateTemplate),
  certificateTemplateVersions: many(certificateTemplateVersion),
  certificateTemplateAssignments: many(certificateTemplateAssignment),
  certificateTemplatePreviews: many(certificateTemplatePreview),
  issuedCertificateSnapshots: many(issuedCertificateSnapshot),
  apiKeyAuditLogs: many(organizationApiKeyAuditLog),
  successProfiles: many(organizationSuccessProfile),
  supportRequestsCreated: many(organizationSupportRequest, {
    relationName: "supportRequestRequestedBy",
  }),
  supportRequestsAssigned: many(organizationSupportRequest, {
    relationName: "supportRequestAssignedTo",
  }),
  supportRequestEvents: many(organizationSupportRequestEvent),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));

export const passkeyRelations = relations(passkey, ({ one }) => ({
  user: one(user, {
    fields: [passkey.userId],
    references: [user.id],
  }),
}));

export const organizationRelations = relations(
  organization,
  ({ one, many }) => ({
    members: many(member),
    units: many(organizationUnit),
    unitAssignments: many(memberUnitAssignment),
    invitations: many(invitation),
    labAccountSetupTokens: many(labAccountSetupToken),
    eventLogs: many(organizationEventLog),
    subscription: one(subscription),
    ssoProviders: many(ssoProvider),
    customDomain: one(organizationCustomDomain),
    certificateTemplates: many(certificateTemplate),
    certificateTemplateVersions: many(certificateTemplateVersion),
    certificateTemplateAssignments: many(certificateTemplateAssignment),
    certificateTemplatePreviews: many(certificateTemplatePreview),
    issuedCertificateSnapshots: many(issuedCertificateSnapshot),
    apiKeys: many(organizationApiKey),
    integrations: many(organizationIntegration),
    integrationConnections: many(integrationConnection),
    integrationSyncRuns: many(integrationSyncRun),
    integrationSyncCursors: many(integrationSyncCursor),
    integrationEventLogs: many(integrationEventLog),
    integrationObjectLinks: many(integrationObjectLink),
    successProfile: one(organizationSuccessProfile),
    supportRequests: many(organizationSupportRequest),
    supportRequestEvents: many(organizationSupportRequestEvent),
  }),
);

export const memberRelations = relations(member, ({ one, many }) => ({
  organization: one(organization, {
    fields: [member.organizationId],
    references: [organization.id],
  }),
  user: one(user, {
    fields: [member.userId],
    references: [user.id],
  }),
  unitAssignments: many(memberUnitAssignment),
}));

export const memberUnitAssignmentRelations = relations(
  memberUnitAssignment,
  ({ one }) => ({
    organization: one(organization, {
      fields: [memberUnitAssignment.organizationId],
      references: [organization.id],
    }),
    member: one(member, {
      fields: [memberUnitAssignment.memberId],
      references: [member.id],
    }),
    unit: one(organizationUnit, {
      fields: [memberUnitAssignment.unitId],
      references: [organizationUnit.id],
    }),
    createdByUser: one(user, {
      fields: [memberUnitAssignment.createdBy],
      references: [user.id],
    }),
  }),
);

export const organizationEventLogRelations = relations(
  organizationEventLog,
  ({ one }) => ({
    organization: one(organization, {
      fields: [organizationEventLog.organizationId],
      references: [organization.id],
    }),
    unit: one(organizationUnit, {
      fields: [organizationEventLog.unitId],
      references: [organizationUnit.id],
    }),
    actorUser: one(user, {
      fields: [organizationEventLog.actorUserId],
      references: [user.id],
    }),
    actorMember: one(member, {
      fields: [organizationEventLog.actorMemberId],
      references: [member.id],
    }),
  }),
);

export const organizationSuccessProfileRelations = relations(
  organizationSuccessProfile,
  ({ one }) => ({
    organization: one(organization, {
      fields: [organizationSuccessProfile.organizationId],
      references: [organization.id],
    }),
    accountOwnerUser: one(user, {
      fields: [organizationSuccessProfile.accountOwnerUserId],
      references: [user.id],
    }),
    internalOwnerUser: one(user, {
      fields: [organizationSuccessProfile.internalOwnerUserId],
      references: [user.id],
    }),
  }),
);

export const organizationSupportRequestRelations = relations(
  organizationSupportRequest,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [organizationSupportRequest.organizationId],
      references: [organization.id],
    }),
    requestedByUser: one(user, {
      fields: [organizationSupportRequest.requestedByUserId],
      references: [user.id],
      relationName: "supportRequestRequestedBy",
    }),
    assignedToUser: one(user, {
      fields: [organizationSupportRequest.assignedToUserId],
      references: [user.id],
      relationName: "supportRequestAssignedTo",
    }),
    events: many(organizationSupportRequestEvent),
  }),
);

export const organizationSupportRequestEventRelations = relations(
  organizationSupportRequestEvent,
  ({ one }) => ({
    supportRequest: one(organizationSupportRequest, {
      fields: [organizationSupportRequestEvent.supportRequestId],
      references: [organizationSupportRequest.id],
    }),
    organization: one(organization, {
      fields: [organizationSupportRequestEvent.organizationId],
      references: [organization.id],
    }),
    actorUser: one(user, {
      fields: [organizationSupportRequestEvent.actorUserId],
      references: [user.id],
    }),
  }),
);

export const invitationRelations = relations(invitation, ({ one, many }) => ({
  organization: one(organization, {
    fields: [invitation.organizationId],
    references: [organization.id],
  }),
  user: one(user, {
    fields: [invitation.inviterId],
    references: [user.id],
  }),
  labAccountSetupTokens: many(labAccountSetupToken),
}));

export const labAccountSetupTokenRelations = relations(
  labAccountSetupToken,
  ({ one }) => ({
    user: one(user, {
      fields: [labAccountSetupToken.userId],
      references: [user.id],
    }),
    organization: one(organization, {
      fields: [labAccountSetupToken.organizationId],
      references: [organization.id],
    }),
    invitation: one(invitation, {
      fields: [labAccountSetupToken.invitationId],
      references: [invitation.id],
    }),
    createdByUser: one(user, {
      fields: [labAccountSetupToken.createdByUserId],
      references: [user.id],
    }),
  }),
);

export const ssoProviderRelations = relations(ssoProvider, ({ one }) => ({
  organization: one(organization, {
    fields: [ssoProvider.organizationId],
    references: [organization.id],
  }),
  user: one(user, {
    fields: [ssoProvider.userId],
    references: [user.id],
  }),
}));

export const organizationCustomDomainRelations = relations(
  organizationCustomDomain,
  ({ one }) => ({
    organization: one(organization, {
      fields: [organizationCustomDomain.organizationId],
      references: [organization.id],
    }),
    createdByUser: one(user, {
      fields: [organizationCustomDomain.createdBy],
      references: [user.id],
    }),
  }),
);

export const certificateTemplateRelations = relations(
  certificateTemplate,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [certificateTemplate.organizationId],
      references: [organization.id],
    }),
    createdByUser: one(user, {
      fields: [certificateTemplate.createdBy],
      references: [user.id],
    }),
    versions: many(certificateTemplateVersion),
    assignments: many(certificateTemplateAssignment),
    issuedSnapshots: many(issuedCertificateSnapshot),
    jobs: many(calibrationJob),
  }),
);

export const certificateTemplateVersionRelations = relations(
  certificateTemplateVersion,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [certificateTemplateVersion.organizationId],
      references: [organization.id],
    }),
    template: one(certificateTemplate, {
      fields: [certificateTemplateVersion.templateId],
      references: [certificateTemplate.id],
    }),
    createdByUser: one(user, {
      fields: [certificateTemplateVersion.createdBy],
      references: [user.id],
      relationName: "certificateTemplateVersionCreator",
    }),
    publishedByUser: one(user, {
      fields: [certificateTemplateVersion.publishedBy],
      references: [user.id],
      relationName: "certificateTemplateVersionPublisher",
    }),
    assignments: many(certificateTemplateAssignment),
    previews: many(certificateTemplatePreview),
    issuedSnapshots: many(issuedCertificateSnapshot),
  }),
);

export const certificateTemplateAssignmentRelations = relations(
  certificateTemplateAssignment,
  ({ one }) => ({
    organization: one(organization, {
      fields: [certificateTemplateAssignment.organizationId],
      references: [organization.id],
    }),
    template: one(certificateTemplate, {
      fields: [certificateTemplateAssignment.templateId],
      references: [certificateTemplate.id],
    }),
    templateVersion: one(certificateTemplateVersion, {
      fields: [certificateTemplateAssignment.templateVersionId],
      references: [certificateTemplateVersion.id],
    }),
    unit: one(organizationUnit, {
      fields: [certificateTemplateAssignment.unitId],
      references: [organizationUnit.id],
    }),
    service: one(service, {
      fields: [certificateTemplateAssignment.serviceId],
      references: [service.id],
    }),
    method: one(calibrationMethod, {
      fields: [certificateTemplateAssignment.methodId],
      references: [calibrationMethod.id],
    }),
    createdByUser: one(user, {
      fields: [certificateTemplateAssignment.createdBy],
      references: [user.id],
    }),
  }),
);

export const certificateTemplatePreviewRelations = relations(
  certificateTemplatePreview,
  ({ one }) => ({
    organization: one(organization, {
      fields: [certificateTemplatePreview.organizationId],
      references: [organization.id],
    }),
    templateVersion: one(certificateTemplateVersion, {
      fields: [certificateTemplatePreview.templateVersionId],
      references: [certificateTemplateVersion.id],
    }),
    requestedByUser: one(user, {
      fields: [certificateTemplatePreview.requestedBy],
      references: [user.id],
    }),
  }),
);

export const issuedCertificateSnapshotRelations = relations(
  issuedCertificateSnapshot,
  ({ one }) => ({
    organization: one(organization, {
      fields: [issuedCertificateSnapshot.organizationId],
      references: [organization.id],
    }),
    job: one(calibrationJob, {
      fields: [issuedCertificateSnapshot.jobId],
      references: [calibrationJob.id],
    }),
    template: one(certificateTemplate, {
      fields: [issuedCertificateSnapshot.templateId],
      references: [certificateTemplate.id],
    }),
    templateVersion: one(certificateTemplateVersion, {
      fields: [issuedCertificateSnapshot.templateVersionId],
      references: [certificateTemplateVersion.id],
    }),
    issuedByUser: one(user, {
      fields: [issuedCertificateSnapshot.issuedBy],
      references: [user.id],
      relationName: "issuedCertificateIssuer",
    }),
    supersededBy: one(issuedCertificateSnapshot, {
      fields: [issuedCertificateSnapshot.supersededById],
      references: [issuedCertificateSnapshot.id],
      relationName: "issuedCertificateSupersession",
    }),
    voidedByUser: one(user, {
      fields: [issuedCertificateSnapshot.voidedBy],
      references: [user.id],
      relationName: "issuedCertificateVoider",
    }),
  }),
);

export const organizationApiKeyRelations = relations(
  organizationApiKey,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [organizationApiKey.organizationId],
      references: [organization.id],
    }),
    createdByUser: one(user, {
      fields: [organizationApiKey.createdBy],
      references: [user.id],
    }),
    revokedByUser: one(user, {
      fields: [organizationApiKey.revokedBy],
      references: [user.id],
    }),
    auditLogs: many(organizationApiKeyAuditLog),
  }),
);

export const organizationApiKeyAuditLogRelations = relations(
  organizationApiKeyAuditLog,
  ({ one }) => ({
    apiKey: one(organizationApiKey, {
      fields: [organizationApiKeyAuditLog.apiKeyId],
      references: [organizationApiKey.id],
    }),
    organization: one(organization, {
      fields: [organizationApiKeyAuditLog.organizationId],
      references: [organization.id],
    }),
    performedByUser: one(user, {
      fields: [organizationApiKeyAuditLog.performedBy],
      references: [user.id],
    }),
  }),
);

export const organizationIntegrationRelations = relations(
  organizationIntegration,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [organizationIntegration.organizationId],
      references: [organization.id],
    }),
    createdByUser: one(user, {
      fields: [organizationIntegration.createdBy],
      references: [user.id],
      relationName: "organizationIntegrationCreator",
    }),
    updatedByUser: one(user, {
      fields: [organizationIntegration.updatedBy],
      references: [user.id],
      relationName: "organizationIntegrationUpdater",
    }),
    connection: one(integrationConnection, {
      fields: [organizationIntegration.id],
      references: [integrationConnection.integrationId],
    }),
    runs: many(integrationSyncRun),
    syncItems: many(integrationSyncItem),
    cursors: many(integrationSyncCursor),
    events: many(integrationEventLog),
    objectLinks: many(integrationObjectLink),
  }),
);

export const integrationConnectionRelations = relations(
  integrationConnection,
  ({ one }) => ({
    integration: one(organizationIntegration, {
      fields: [integrationConnection.integrationId],
      references: [organizationIntegration.id],
    }),
    organization: one(organization, {
      fields: [integrationConnection.organizationId],
      references: [organization.id],
    }),
    createdByUser: one(user, {
      fields: [integrationConnection.createdBy],
      references: [user.id],
      relationName: "integrationConnectionCreator",
    }),
    updatedByUser: one(user, {
      fields: [integrationConnection.updatedBy],
      references: [user.id],
      relationName: "integrationConnectionUpdater",
    }),
  }),
);

export const integrationObjectLinkRelations = relations(
  integrationObjectLink,
  ({ one }) => ({
    integration: one(organizationIntegration, {
      fields: [integrationObjectLink.integrationId],
      references: [organizationIntegration.id],
    }),
    organization: one(organization, {
      fields: [integrationObjectLink.organizationId],
      references: [organization.id],
    }),
  }),
);

export const integrationSyncRunRelations = relations(
  integrationSyncRun,
  ({ one, many }) => ({
    integration: one(organizationIntegration, {
      fields: [integrationSyncRun.integrationId],
      references: [organizationIntegration.id],
    }),
    organization: one(organization, {
      fields: [integrationSyncRun.organizationId],
      references: [organization.id],
    }),
    initiatedByUser: one(user, {
      fields: [integrationSyncRun.initiatedBy],
      references: [user.id],
      relationName: "integrationRunInitiator",
    }),
    events: many(integrationEventLog),
    syncItems: many(integrationSyncItem),
  }),
);

export const integrationSyncItemRelations = relations(
  integrationSyncItem,
  ({ one }) => ({
    run: one(integrationSyncRun, {
      fields: [integrationSyncItem.runId],
      references: [integrationSyncRun.id],
    }),
    integration: one(organizationIntegration, {
      fields: [integrationSyncItem.integrationId],
      references: [organizationIntegration.id],
    }),
    organization: one(organization, {
      fields: [integrationSyncItem.organizationId],
      references: [organization.id],
    }),
  }),
);

export const integrationSyncCursorRelations = relations(
  integrationSyncCursor,
  ({ one }) => ({
    integration: one(organizationIntegration, {
      fields: [integrationSyncCursor.integrationId],
      references: [organizationIntegration.id],
    }),
    organization: one(organization, {
      fields: [integrationSyncCursor.organizationId],
      references: [organization.id],
    }),
  }),
);

export const integrationEventLogRelations = relations(
  integrationEventLog,
  ({ one }) => ({
    integration: one(organizationIntegration, {
      fields: [integrationEventLog.integrationId],
      references: [organizationIntegration.id],
    }),
    organization: one(organization, {
      fields: [integrationEventLog.organizationId],
      references: [organization.id],
    }),
    run: one(integrationSyncRun, {
      fields: [integrationEventLog.runId],
      references: [integrationSyncRun.id],
    }),
  }),
);

export const customerRelations = relations(customer, ({ one, many }) => ({
  organization: one(organization, {
    fields: [customer.authOrganizationId],
    references: [organization.id],
  }),
  group: one(customerGroup, {
    fields: [customer.groupId],
    references: [customerGroup.id],
  }),
  auditLogs: many(customerAuditLog),
  assets: many(asset),
}));

export const customerGroupRelations = relations(
  customerGroup,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [customerGroup.authOrganizationId],
      references: [organization.id],
    }),
    branches: many(customer),
  }),
);

export const customerAuditLogRelations = relations(
  customerAuditLog,
  ({ one }) => ({
    customer: one(customer, {
      fields: [customerAuditLog.customerId],
      references: [customer.id],
    }),
    performedByUser: one(user, {
      fields: [customerAuditLog.performedBy],
      references: [user.id],
    }),
  }),
);

// =============================================================================
// ASSET - Equipment/Instruments under test (EUT) from clients
// =============================================================================

/**
 * Asset status values for equipment lifecycle tracking
 */
export type AssetStatus = "ACTIVE" | "INACTIVE" | "MAINTENANCE" | "SCRAPPED";

/**
 * Asset table - Equipment/Instruments linked to customers.
 * Each asset belongs to a customer and can have calibration history.
 */
export const asset = pgTable(
  "asset",
  {
    id: serial("id").primaryKey(),
    unitId: integer("unit_id")
      .notNull()
      .references(() => organizationUnit.id, { onDelete: "restrict" }),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "cascade" }),
    // Dynamic Instrument Classification
    assetTypeId: integer("asset_type_id")
      .notNull()
      .references(() => assetType.id),
    // Dynamic specifications stored as JSONB (e.g., { "resolution": 0.001, "capacity": 220 })
    specifications: jsonb("specifications").$type<Record<string, unknown>>(),
    name: text("name").notNull(), // e.g., "Analytical Balance", "Pressure Gauge"
    manufacturer: text("manufacturer"), // e.g., "Mettler Toledo", "Fluke"
    model: text("model"), // e.g., "XPE205", "700G"
    serialNumber: text("serial_number").notNull(), // Manufacturer's serial number
    tag: text("tag").notNull().unique(), // Internal Lab ID / Asset ID (unique across lab)
    status: text("status").$type<AssetStatus>().default("ACTIVE").notNull(),
    baseMeasurementUnit: text("base_measurement_unit").$type<MeasurementUnit>(),
    lastCalibrationDate: timestamp("last_calibration_date"),
    nextCalibrationDate: timestamp("next_calibration_date"),
    comments: text("comments"), // Additional notes about the equipment
    // Whether this instrument is subject to legal metrology (Inmetro): governs
    // whether the repair seal (Etiqueta de Reparo) + security lacre fields are
    // shown on its service orders. See docs token `asset.inmetroRegistration`.
    subjectToLegalMetrology: boolean("subject_to_legal_metrology")
      .default(false)
      .notNull(),
    deletedAt: timestamp("deleted_at"), // Soft delete for ISO 17025 compliance
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("asset_unit_id_idx").on(table.unitId),
    index("asset_customer_id_idx").on(table.customerId),
    index("asset_type_id_idx").on(table.assetTypeId),
    index("asset_status_idx").on(table.status),
    uniqueIndex("asset_tag_uidx").on(table.tag),
  ],
);

// =============================================================================
// ASSET AUDIT LOG - ISO 17025:2017 Clause 8.4 (Control of records)
// =============================================================================

/**
 * Audit log for asset changes.
 * Tracks all modifications for compliance and traceability.
 */
export const assetAuditLog = pgTable(
  "asset_audit_log",
  {
    id: serial("id").primaryKey(),
    assetId: integer("asset_id")
      .notNull()
      .references(() => asset.id, { onDelete: "cascade" }),
    action: text("action").notNull(), // 'create', 'update', 'delete', 'status_change', etc.
    changes: jsonb("changes"), // { field: { old: x, new: y } }
    performedBy: text("performed_by")
      .notNull()
      .references(() => user.id),
    performedAt: timestamp("performed_at").defaultNow().notNull(),
    ipAddress: text("ip_address"),
    reason: text("reason"), // Required for status changes per ISO 17025
  },
  (table) => [
    index("asset_audit_log_asset_id_idx").on(table.assetId),
    index("asset_audit_log_performed_at_idx").on(table.performedAt),
  ],
);

// =============================================================================
// ASSET RELATIONS
// =============================================================================

export const assetTypeRelations = relations(assetType, ({ many }) => ({
  assets: many(asset),
}));

export const assetRelations = relations(asset, ({ one, many }) => ({
  unit: one(organizationUnit, {
    fields: [asset.unitId],
    references: [organizationUnit.id],
  }),
  customer: one(customer, {
    fields: [asset.customerId],
    references: [customer.id],
  }),
  assetType: one(assetType, {
    fields: [asset.assetTypeId],
    references: [assetType.id],
  }),
  auditLogs: many(assetAuditLog),
}));

export const assetAuditLogRelations = relations(assetAuditLog, ({ one }) => ({
  asset: one(asset, {
    fields: [assetAuditLog.assetId],
    references: [asset.id],
  }),
  performedByUser: one(user, {
    fields: [assetAuditLog.performedBy],
    references: [user.id],
  }),
}));

// =============================================================================
// CALIBRATION METHOD - ISO 17025 Validated Calibration Templates
// =============================================================================

/**
 * Method status values for versioning workflow
 * - DRAFT: Work in progress, can be edited
 * - PENDING_APPROVAL: Submitted for review, locked for edits
 * - TECHNICAL_REVIEWED: Approved by technical reviewer, pending quality approval
 * - PUBLISHED: Active and immutable, used for calibrations
 * - ARCHIVED: No longer active, kept for historical reference
 */
export type MethodStatus =
  | "DRAFT"
  | "PENDING_APPROVAL"
  | "TECHNICAL_REVIEWED"
  | "PUBLISHED"
  | "ARCHIVED";

export type MethodInputSource = "manual" | "asset_spec";
export type EccentricityIndicatorVariant = "circular_platform" | "road_scale";

export type EccentricityIndicatorConfig = {
  enabled?: boolean;
  variant?: EccentricityIndicatorVariant;
};

export type WeighingRangeResolverConfig = {
  enabled?: boolean;
  assetSpecKey?: string;
  pointColumn?: string;
  pointUnit?: MeasurementUnit;
  targetColumns?: {
    rangeLabel?: string;
    rangeMin?: string;
    rangeMax?: string;
    rangeUnit?: string;
    resolution?: string;
    resolutionUnit?: string;
  };
};

export type MethodTableColumnRole =
  | "standard_value"
  | "mass_standard_composition";

export type MassCompositionConfig = {
  targetUnit?: "mg" | "g" | "kg";
  optionSource?: "certified_values" | "composition_profiles";
  targetColumns?: {
    certifiedValue?: string;
    compositionLabel?: string;
    expandedUncertainty?: string;
    maxError?: string;
    drift?: string;
    buoyancy?: string;
  };
  uncertaintyMode?: "expanded_rss" | "expanded_arithmetic";
  quantityMode?: "linear_per_item_then_rss" | "profile_linear";
};

/**
 * Input field definition for method data collection.
 * Defines what the technician types during calibration.
 */
export type MethodInputField = {
  key: string; // Variable name, e.g., "reading_1"
  label: string; // Display label, e.g., "Reading 1"
  type: "text" | "number" | "select" | "table";
  unit?: string; // e.g., "mm", "°C"
  // Semantic role; delta-valued roles (correction/uncertainty/resolution/…)
  // convert factor-only for affine kinds. See DELTA_QUANTITY_KINDS in shared.
  quantityKind?: string;
  required?: boolean;
  options?: string[]; // For select type
  defaultValue?: string | number;
  source?: MethodInputSource;
  assetSpecKey?: string;
  allowOverride?: boolean;
  eccentricityIndicator?: EccentricityIndicatorConfig;
  weighingRangeResolver?: WeighingRangeResolverConfig;
  phaseBlockKey?: string;
  phaseBlockLabel?: string;
  // For table type only:
  columns?: Array<{
    key: string;
    label: string;
    type: "text" | "number";
    unit?: string;
    role?: MethodTableColumnRole;
    quantityKind?: string;
    phase?: "before" | "after" | "always";
    massComposition?: MassCompositionConfig;
  }>;
};

export type MethodFormulaReporting = {
  includeInCertificate?: boolean;
  role?:
    | "primary_result"
    | "expanded_uncertainty"
    | "coverage_factor"
    | "conformity_margin"
    | "uncertainty_component"
    | "auxiliary";
  group?: "calibration_result" | "uncertainty_budget" | "raw_calculation";
};

/**
 * Formula definition for computed values.
 * Defines how results are calculated from inputs.
 */
export type MethodFormula = {
  outputKey: string; // Variable name for result, e.g., "error"
  expression: string; // Math expression, e.g., "reading_1 - nominal"
  scope?: { kind: "scalar" } | { kind: "table_row"; tableKey: string };
  label?: string; // Display label, e.g., "Measurement Error"
  unit?: string;
  reporting?: MethodFormulaReporting;
  metadata?: Record<string, unknown>;
};

export type MethodMeasurementModel = {
  key: string;
  label: string;
  scope?: { kind: "scalar" } | { kind: "table_row"; tableKey: string };
  measurand: string;
  expression: string;
  quantities: unknown[];
  correlations?: unknown[];
  covariances?: unknown[];
  coverageProbability?: number;
  coverageFactor?: string | number;
  outputUnit?: string;
  options?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

/**
 * Validation rule for pass/fail criteria.
 * Defines acceptance criteria per ISO 17025.
 */
export type MethodValidationOperator = "<" | "<=" | ">" | ">=" | "==" | "!=";

export type MethodValidation = {
  leftExpression: string;
  operator: MethodValidationOperator;
  rightExpression: string;
  message: string; // Message shown on failure
  severity: "error" | "warning";
  metadata?: Record<string, unknown>;
};

export type MethodVariableBinding =
  | {
      key: string;
      label?: string;
      source: "data_field";
      fieldKey: string;
    }
  | {
      key: string;
      label?: string;
      source: "table_statistic";
      fieldKey: string;
      columnKey: string;
      statistic: "mean" | "sample_stddev" | "count" | "min" | "max";
    }
  | {
      key: string;
      label?: string;
      source: "table_column";
      fieldKey: string;
      columnKey: string;
    }
  | {
      key: string;
      label?: string;
      source: "environment";
      field: "temperature" | "humidity" | "pressure";
    }
  | {
      key: string;
      label?: string;
      source: "standard";
      standardId?: number;
      valueKey: string;
    }
  | {
      key: string;
      label?: string;
      source: "standard_channel";
      standardId?: number;
      channelKey: string;
      property:
        | "value"
        | "correction"
        | "uncertainty"
        | "coverageFactor"
        | "drift";
    };

/**
 * Default Type B uncertainty component for the method.
 * Pre-configured systematic uncertainty sources.
 */
export type MethodTypeBComponent = {
  name: string;
  value: number;
  distribution: "normal" | "rectangular" | "triangular" | "u-shaped";
  coverageFactor?: number;
  divisor?: number;
  degreesOfFreedom?: number;
};

export type MethodCertificateContentSection =
  | {
      kind: "paragraphs";
      title: string;
      paragraphs: string[];
    }
  | {
      kind: "definition_list";
      title: string;
      items: Array<{ term: string; definition: string }>;
    }
  | {
      kind: "bullets";
      title?: string;
      items: string[];
    };

export type MethodCertificateContent = {
  procedureCode?: string;
  referenceStandards?: string[];
  certifiedValuesDisplay?: "full" | "hidden";
  massCompositionDisplay?: "full" | "hidden";
  uncertaintyBudgetDisplay?: "full" | "hidden";
  sections?: MethodCertificateContentSection[];
};

/**
 * Calibration Method table - Versioned calibration templates
 * ISO 17025:2017 Clause 7.2 - Method Validation
 *
 * Key concepts:
 * - Methods are organization-scoped (each lab owns their methods)
 * - Published methods are immutable for ISO compliance
 * - Editing a published method creates a new version (clone)
 * - Version chain tracked via parentId
 */
export const calibrationMethod = pgTable(
  "calibration_method",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    assetTypeId: integer("asset_type_id").references(() => assetType.id),
    name: text("name").notNull(),
    description: text("description"),
    version: integer("version").default(1).notNull(),
    status: text("status").$type<MethodStatus>().default("DRAFT").notNull(),
    // ISO 17025 accredited scope: certificates issued from this method may
    // carry the accreditation seal (traceable-only methods keep this off).
    accreditedScope: boolean("accredited_scope").default(false).notNull(),
    // JSONB fields for method definition
    dataFields: jsonb("data_fields").$type<MethodInputField[]>().notNull(),
    variableBindings: jsonb("variable_bindings")
      .$type<MethodVariableBinding[]>()
      .default([])
      .notNull(),
    formulas: jsonb("formulas").$type<MethodFormula[]>().default([]).notNull(),
    measurementModels: jsonb("measurement_models")
      .$type<MethodMeasurementModel[]>()
      .default([])
      .notNull(),
    validations: jsonb("validations")
      .$type<MethodValidation[]>()
      .default([])
      .notNull(),
    uncertaintyParams: jsonb("uncertainty_params")
      .$type<MethodTypeBComponent[]>()
      .default([])
      .notNull(),
    certificateContent: jsonb(
      "certificate_content",
    ).$type<MethodCertificateContent>(),
    compiledMethod: jsonb("compiled_method").$type<unknown>(),
    methodFingerprint: text("method_fingerprint"),
    methodEngine: jsonb("method_engine").$type<unknown>(),
    methodCompiledAt: timestamp("method_compiled_at"),
    publicationEvidence: jsonb("publication_evidence").$type<unknown>(),
    // Version chain - links to the parent version
    parentId: integer("parent_id"),
    // Provenance when created from a curated template (packages/method-templates).
    // Informational only — never part of methodFingerprint (so adopting or
    // upgrading a template never changes a method's reproducible fingerprint).
    templateKey: text("template_key"),
    templateVersion: integer("template_version"),
    // Timestamps and actors
    createdAt: timestamp("created_at").defaultNow().notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    technicalReviewedBy: text("technical_reviewed_by").references(
      () => user.id,
      {
        onDelete: "set null",
      },
    ),
    publishedAt: timestamp("published_at"),
    publishedBy: text("published_by").references(() => user.id, {
      onDelete: "set null",
    }),
    approvedBy: text("approved_by").references(() => user.id, {
      onDelete: "set null",
    }),
    archivedAt: timestamp("archived_at"),
  },
  (table) => [
    index("method_organization_id_idx").on(table.organizationId),
    index("method_asset_type_id_idx").on(table.assetTypeId),
    index("method_status_idx").on(table.status),
    index("method_parent_id_idx").on(table.parentId),
    uniqueIndex("method_org_name_version_uidx").on(
      table.organizationId,
      table.name,
      table.version,
    ),
  ],
);

// =============================================================================
// METHOD AUDIT LOG - ISO 17025:2017 Clause 8.4 (Control of records)
// =============================================================================

/**
 * Audit log for method changes.
 * Tracks all modifications for compliance and traceability.
 * Critical for ISO 17025 Clause 7.2 (Method Validation) audits.
 */
export const methodAuditLog = pgTable(
  "method_audit_log",
  {
    id: serial("id").primaryKey(),
    methodId: integer("method_id")
      .notNull()
      .references(() => calibrationMethod.id, { onDelete: "cascade" }),
    action: text("action").notNull(), // 'create', 'update', 'request_approval', 'technical_review', 'quality_approve', 'return_to_draft', 'publish', 'archive', 'new_version'
    changes: jsonb("changes"), // { field: { old: x, new: y } }
    performedBy: text("performed_by")
      .notNull()
      .references(() => user.id),
    performedAt: timestamp("performed_at").defaultNow().notNull(),
    ipAddress: text("ip_address"),
    reason: text("reason"), // Optional reason for change
  },
  (table) => [
    index("method_audit_log_method_id_idx").on(table.methodId),
    index("method_audit_log_performed_at_idx").on(table.performedAt),
  ],
);

// =============================================================================
// CALIBRATION METHOD RELATIONS
// =============================================================================

export const calibrationMethodRelations = relations(
  calibrationMethod,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [calibrationMethod.organizationId],
      references: [organization.id],
    }),
    assetType: one(assetType, {
      fields: [calibrationMethod.assetTypeId],
      references: [assetType.id],
    }),
    parent: one(calibrationMethod, {
      fields: [calibrationMethod.parentId],
      references: [calibrationMethod.id],
      relationName: "versionChain",
    }),
    versions: many(calibrationMethod, { relationName: "versionChain" }),
    createdByUser: one(user, {
      fields: [calibrationMethod.createdBy],
      references: [user.id],
      relationName: "methodCreator",
    }),
    technicalReviewedByUser: one(user, {
      fields: [calibrationMethod.technicalReviewedBy],
      references: [user.id],
      relationName: "methodTechnicalReviewer",
    }),
    publishedByUser: one(user, {
      fields: [calibrationMethod.publishedBy],
      references: [user.id],
      relationName: "methodPublisher",
    }),
    approvedByUser: one(user, {
      fields: [calibrationMethod.approvedBy],
      references: [user.id],
      relationName: "methodQualityApprover",
    }),
    auditLogs: many(methodAuditLog),
    certificateTemplateAssignments: many(certificateTemplateAssignment),
  }),
);

export const methodAuditLogRelations = relations(methodAuditLog, ({ one }) => ({
  method: one(calibrationMethod, {
    fields: [methodAuditLog.methodId],
    references: [calibrationMethod.id],
  }),
  performedByUser: one(user, {
    fields: [methodAuditLog.performedBy],
    references: [user.id],
  }),
}));

// =============================================================================
// SERVICE - Commercial Service Catalog (Product Registry)
// =============================================================================

/**
 * Service table - Links commercial offerings to calibration methods.
 * This is the "Commercial Wrapper" around technical Methods.
 *
 * Key concepts:
 * - Services are what the lab sells (e.g., "Calibração de Balança Digital 0-220g")
 * - Links to a validated Method for technical execution
 * - Contains pricing and turnaround time for quotes
 * - Soft-delete only (isActive) for financial audit trail
 *
 * ISO 17025 Clause 7.1 - Service Agreements
 */
export const service = pgTable(
  "service",
  {
    id: serial("id").primaryKey(),
    unitId: integer("unit_id")
      .notNull()
      .references(() => organizationUnit.id, { onDelete: "restrict" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(), // E.g., "Calibração de Paquímetro 0-150mm"
    description: text("description"),
    // Link to calibration method (nullable - repair services don't need methods)
    methodId: integer("method_id").references(() => calibrationMethod.id, {
      onDelete: "set null",
    }),
    // Link to asset type for filtering during job creation
    // When methodId has an assetTypeId, this MUST match (enforced at app level)
    assetTypeId: integer("asset_type_id").references(() => assetType.id, {
      onDelete: "set null",
    }),
    // Pricing in cents (e.g., 15000 = R$ 150,00)
    // Nullable for "Call for Quote" / "Sob Consulta" services
    price: integer("price"),
    currency: text("currency").default("BRL").notNull(),
    // Turnaround time in business days
    tat: integer("tat"),
    // Soft delete - never hard delete commercial data
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("service_unit_id_idx").on(table.unitId),
    index("service_organization_id_idx").on(table.organizationId),
    index("service_method_id_idx").on(table.methodId),
    index("service_asset_type_id_idx").on(table.assetTypeId),
    index("service_is_active_idx").on(table.isActive),
  ],
);

// =============================================================================
// SERVICE AUDIT LOG - ISO 17025:2017 Clause 8.4 (Control of records)
// =============================================================================

/**
 * Audit log for service changes.
 * Tracks all modifications for compliance and financial traceability.
 */
export const serviceAuditLog = pgTable(
  "service_audit_log",
  {
    id: serial("id").primaryKey(),
    serviceId: integer("service_id")
      .notNull()
      .references(() => service.id, { onDelete: "cascade" }),
    action: text("action").notNull(), // 'create', 'update', 'deactivate', 'reactivate'
    changes: jsonb("changes"), // { field: { old: x, new: y } }
    performedBy: text("performed_by")
      .notNull()
      .references(() => user.id),
    performedAt: timestamp("performed_at").defaultNow().notNull(),
    ipAddress: text("ip_address"),
    reason: text("reason"), // Optional reason for change
  },
  (table) => [
    index("service_audit_log_service_id_idx").on(table.serviceId),
    index("service_audit_log_performed_at_idx").on(table.performedAt),
  ],
);

// =============================================================================
// SERVICE RELATIONS
// =============================================================================

export const serviceRelations = relations(service, ({ one, many }) => ({
  organization: one(organization, {
    fields: [service.organizationId],
    references: [organization.id],
  }),
  unit: one(organizationUnit, {
    fields: [service.unitId],
    references: [organizationUnit.id],
  }),
  method: one(calibrationMethod, {
    fields: [service.methodId],
    references: [calibrationMethod.id],
  }),
  assetType: one(assetType, {
    fields: [service.assetTypeId],
    references: [assetType.id],
  }),
  auditLogs: many(serviceAuditLog),
  certificateTemplateAssignments: many(certificateTemplateAssignment),
}));

export const serviceAuditLogRelations = relations(
  serviceAuditLog,
  ({ one }) => ({
    service: one(service, {
      fields: [serviceAuditLog.serviceId],
      references: [service.id],
    }),
    performedByUser: one(user, {
      fields: [serviceAuditLog.performedBy],
      references: [user.id],
    }),
  }),
);

// =============================================================================
// REFERENCE STANDARD - Lab's Own Calibration Equipment (ISO 17025 Clause 6.4)
// =============================================================================

/**
 * Certified value for multi-value standards (e.g., weight sets).
 * Stores individual values from a calibration certificate.
 */
export type CertifiedValue = {
  nominal: string; // Display label, e.g., "100g"
  authentication?: string | null; // Certificate row/code, e.g., "JP03-2.1"
  value: number; // Actual certified value, e.g., 100.005
  uncertainty: number; // Uncertainty for this specific value
  unit: string; // Unit, e.g., "g", "mg"
  maxError?: number | null;
  drift?: number | null;
  buoyancy?: number | null;
  coverageFactor?: number | null;
  compositionProfile?: boolean;
  profileKey?: string | null;
  profileClass?: string | null;
  profileQuantityAvailable?: number | null;
};

/**
 * Reference Standard status for lifecycle tracking
 */
export type ReferenceStandardStatus =
  | "ACTIVE"
  | "INACTIVE"
  | "OUT_OF_TOLERANCE"
  | "SENT_FOR_CALIBRATION";

/**
 * Uncertainty distribution types
 */
export type UncertaintyDistribution = "normal" | "rectangular";

export type ReferenceStandardKind =
  | "mass_single"
  | "mass_set"
  | "thermohygrometer"
  | "thermometer"
  | "hygrometer"
  | "barometer"
  | "manometer"
  | "dimensional"
  | "electrical"
  | "time_frequency"
  | "volume"
  | "force_torque"
  | "rpm"
  | "generic_scalar"
  | "generic_multi_channel";

export type ReferenceStandardMetrologyPoint = {
  reference?: number | null;
  indication?: number | null;
  meanReading?: number | null;
  correction?: number | null;
  uncertainty?: number | null;
  unit: string;
  coverageFactor?: number | null;
  degreesOfFreedom?: number | null;
  degreesOfFreedomOperator?: "exact" | "greater_than" | "infinity";
  repeatability?: number | null;
  metadata?: Record<string, unknown>;
};

export type ReferenceStandardMetrologyChannel = {
  key: string;
  label: string;
  quantity: string;
  value?: number | null;
  correction?: number | null;
  uncertainty?: number | null;
  unit: string;
  coverageFactor?: number | null;
  drift?: number | null;
  notes?: string | null;
  points?: ReferenceStandardMetrologyPoint[];
};

export type ReferenceStandardMassValue = {
  nominal: string;
  authentication?: string | null;
  value: number;
  uncertainty: number;
  unit: string;
  maxError?: number | null;
  drift?: number | null;
  buoyancy?: number | null;
  coverageFactor?: number | null;
};

export type ReferenceStandardCompositionProfile = {
  profileKey: string;
  profileClass?: string | null;
  nominal: string;
  value: number;
  uncertainty: number;
  unit: string;
  maxError?: number | null;
  drift?: number | null;
  buoyancy?: number | null;
  coverageFactor?: number | null;
  quantityAvailable?: number | null;
};

export type ReferenceStandardMetrologyData = {
  version: 1;
  channels: ReferenceStandardMetrologyChannel[];
  massValues: ReferenceStandardMassValue[];
  compositionProfiles: ReferenceStandardCompositionProfile[];
  notes?: string | null;
};

export type ReferenceStandardCertificateDocumentSnapshot = {
  documentId: number;
  r2Key: string;
  fileName: string;
  fileSize: number;
  sha256: string;
  uploadedAt: Date | string;
  certificateNumber: string;
  calibrationDate: Date | string;
  nextCalibrationDate: Date | string;
};

/**
 * Reference Standard table - Lab's own master instruments for calibrations.
 * These are the "Truth" used to calibrate client equipment.
 *
 * Key concepts:
 * - Distinct from Client Assets (EUT) - these are the lab's own equipment
 * - Certificate data is critical for uncertainty calculations
 * - Supports both single-value (e.g., single weight) and multi-value (e.g., weight set)
 * - ISO 17025:2017 Clause 6.4 - Equipment
 */
export const referenceStandard = pgTable(
  "reference_standard",
  {
    id: serial("id").primaryKey(),
    unitId: integer("unit_id")
      .notNull()
      .references(() => organizationUnit.id, { onDelete: "restrict" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(), // e.g., "Conjunto de Pesos E2"
    kind: text("kind")
      .$type<ReferenceStandardKind>()
      .default("generic_scalar")
      .notNull(),
    type: text("type"), // Optional category: "Peso", "Bloco Padrão", etc.
    serialNumber: text("serial_number").notNull(),
    manufacturer: text("manufacturer"),
    model: text("model"),
    // Certificate traceability
    certificateNumber: text("certificate_number").notNull(),
    calibratedBy: text("calibrated_by"), // Calibration lab name (traceability)
    calibrationDate: timestamp("calibration_date").notNull(),
    nextCalibrationDate: timestamp("next_calibration_date").notNull(),
    // Single-value metrology data
    referenceValue: real("reference_value"), // For single-value standards
    uncertainty: real("uncertainty"),
    uncertaintyUnit: text("uncertainty_unit"),
    coverageFactor: real("coverage_factor").default(2.0).notNull(),
    distribution: text("distribution")
      .$type<UncertaintyDistribution>()
      .default("normal")
      .notNull(),
    drift: real("drift"),
    // Multi-value metrology data (for sets like weight sets, gauge blocks)
    certifiedValues: jsonb("certified_values").$type<CertifiedValue[]>(),
    metrologyData:
      jsonb("metrology_data").$type<ReferenceStandardMetrologyData>(),
    // Status
    status: text("status")
      .$type<ReferenceStandardStatus>()
      .default("ACTIVE")
      .notNull(),
    // Audit
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    deletedAt: timestamp("deleted_at"), // Soft delete
  },
  (table) => [
    index("standard_unit_id_idx").on(table.unitId),
    index("standard_organization_id_idx").on(table.organizationId),
    index("standard_status_idx").on(table.status),
    index("standard_next_cal_date_idx").on(table.nextCalibrationDate),
  ],
);

/**
 * Normalized catalog of mass composition-build profiles — the lab's available
 * buildup weights by class + nominal (e.g. M1 1g..20kg). Previously stored as a
 * byte-identical `compositionProfile: true` block copied onto every mass
 * reference_standard.certified_values; this table is the single source of
 * truth (one row per org+class+nominal, with provenance), and the runtime reads
 * profiles from here. See .goals/composition-profile-catalog-normalization.md.
 */
export const massCompositionProfile = pgTable(
  "mass_composition_profile",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    profileKey: text("profile_key").notNull(), // runtime key, e.g. "20kg-M1"
    profileClass: text("profile_class").notNull(), // "M1" | "M2" | "F1"
    // double precision (not real): faithfully preserves the float8 values that
    // lived in certified_values JSONB, so buildMassCompositionValue is identical.
    nominalG: doublePrecision("nominal_g").notNull(), // canonical nominal mass in grams (key dimension)
    nominal: text("nominal").notNull(), // display label, e.g. "20 kg"
    value: doublePrecision("value").notNull(),
    uncertainty: doublePrecision("uncertainty").notNull(),
    unit: text("unit").default("g").notNull(),
    maxError: doublePrecision("max_error"),
    drift: doublePrecision("drift"),
    buoyancy: doublePrecision("buoyancy"),
    coverageFactor: doublePrecision("coverage_factor"),
    quantityAvailable: integer("quantity_available"),
    // Provenance: which standard/certificate these values were sourced from.
    sourceStandardId: integer("source_standard_id").references(
      () => referenceStandard.id,
      { onDelete: "set null" },
    ),
    sourceCertificate: text("source_certificate"),
    status: text("status").default("ACTIVE").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    deletedAt: timestamp("deleted_at"),
  },
  (table) => [
    index("mass_composition_profile_org_idx").on(table.organizationId),
    index("mass_composition_profile_class_idx").on(
      table.organizationId,
      table.profileClass,
    ),
    uniqueIndex("mass_composition_profile_org_class_nominal_uidx").on(
      table.organizationId,
      table.profileClass,
      table.nominalG,
    ),
  ],
);

export type MassCompositionProfileRow =
  typeof massCompositionProfile.$inferSelect;

export const referenceStandardCertificateDocument = pgTable(
  "reference_standard_certificate_document",
  {
    id: serial("id").primaryKey(),
    standardId: integer("standard_id")
      .notNull()
      .references(() => referenceStandard.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    unitId: integer("unit_id")
      .notNull()
      .references(() => organizationUnit.id, { onDelete: "restrict" }),
    certificateNumber: text("certificate_number").notNull(),
    calibrationDate: timestamp("calibration_date").notNull(),
    nextCalibrationDate: timestamp("next_calibration_date").notNull(),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    fileSize: integer("file_size").notNull(),
    sha256: text("sha256").notNull(),
    r2Key: text("r2_key").notNull(),
    isCurrent: boolean("is_current").default(true).notNull(),
    uploadedBy: text("uploaded_by").references(() => user.id, {
      onDelete: "set null",
    }),
    uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
  },
  (table) => [
    index("standard_certificate_document_standard_idx").on(table.standardId),
    index("standard_certificate_document_org_idx").on(table.organizationId),
    index("standard_certificate_document_unit_idx").on(table.unitId),
    index("standard_certificate_document_current_idx").on(
      table.standardId,
      table.isCurrent,
    ),
  ],
);

// =============================================================================
// REFERENCE STANDARD AUDIT LOG - ISO 17025:2017 Clause 8.4 (Control of records)
// =============================================================================

/**
 * Audit log for reference standard changes.
 * Tracks all modifications for compliance and traceability.
 * Critical for ISO 17025 equipment management audits.
 */
export const referenceStandardAuditLog = pgTable(
  "reference_standard_audit_log",
  {
    id: serial("id").primaryKey(),
    standardId: integer("standard_id")
      .notNull()
      .references(() => referenceStandard.id, { onDelete: "cascade" }),
    action: text("action").notNull(), // 'create', 'update', 'renew', 'status_change', 'delete'
    changes: jsonb("changes"), // { field: { old: x, new: y } }
    performedBy: text("performed_by")
      .notNull()
      .references(() => user.id),
    performedAt: timestamp("performed_at").defaultNow().notNull(),
    ipAddress: text("ip_address"),
    reason: text("reason"), // Required for renewals and status changes (ISO 17025)
  },
  (table) => [
    index("standard_audit_log_standard_id_idx").on(table.standardId),
    index("standard_audit_log_performed_at_idx").on(table.performedAt),
  ],
);

// =============================================================================
// REFERENCE STANDARD RELATIONS
// =============================================================================

export const referenceStandardRelations = relations(
  referenceStandard,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [referenceStandard.organizationId],
      references: [organization.id],
    }),
    unit: one(organizationUnit, {
      fields: [referenceStandard.unitId],
      references: [organizationUnit.id],
    }),
    createdByUser: one(user, {
      fields: [referenceStandard.createdBy],
      references: [user.id],
    }),
    auditLogs: many(referenceStandardAuditLog),
    certificateDocuments: many(referenceStandardCertificateDocument),
  }),
);

export const referenceStandardCertificateDocumentRelations = relations(
  referenceStandardCertificateDocument,
  ({ one }) => ({
    standard: one(referenceStandard, {
      fields: [referenceStandardCertificateDocument.standardId],
      references: [referenceStandard.id],
    }),
    organization: one(organization, {
      fields: [referenceStandardCertificateDocument.organizationId],
      references: [organization.id],
    }),
    unit: one(organizationUnit, {
      fields: [referenceStandardCertificateDocument.unitId],
      references: [organizationUnit.id],
    }),
    uploadedByUser: one(user, {
      fields: [referenceStandardCertificateDocument.uploadedBy],
      references: [user.id],
    }),
  }),
);

export const referenceStandardAuditLogRelations = relations(
  referenceStandardAuditLog,
  ({ one }) => ({
    standard: one(referenceStandard, {
      fields: [referenceStandardAuditLog.standardId],
      references: [referenceStandard.id],
    }),
    performedByUser: one(user, {
      fields: [referenceStandardAuditLog.performedBy],
      references: [user.id],
    }),
  }),
);

// =============================================================================
// CALIBRATION JOB - Work Order (ISO 17025 Operational Layer)
// =============================================================================

/**
 * Job status values for workflow tracking
 * - DRAFT: Created, not started
 * - IN_PROGRESS: Technician is executing the calibration
 * - REVIEW: Submitted for manager review
 * - GENERATING_PDF: Approved, certificate being generated async
 * - APPROVED: Certificate generated and ready
 * - REJECTED: Manager rejected, needs rework
 * - CANCELED: Job was canceled (soft delete equivalent)
 * - SUPERSEDED: Certificate was amended and replaced by a new version (ISO 17025 Clause 7.8.4.1)
 */
export type JobStatus =
  | "DRAFT"
  | "IN_PROGRESS"
  | "REVIEW"
  | "GENERATING_PDF"
  | "APPROVED"
  | "REJECTED"
  | "CANCELED"
  | "SUPERSEDED";

/**
 * Method Snapshot - Frozen copy of method at job creation time.
 * This ensures future changes to the Method do not affect historical jobs.
 * Critical for ISO 17025 compliance: must be able to reproduce calculations
 * exactly as performed, even years later.
 */
export type MethodSnapshot = {
  methodId: number;
  methodName: string;
  methodVersion: number;
  compiledMethod?: unknown;
  methodFingerprint?: string | null;
  engineVersion?: string | null;
  engineOptionsFingerprint?: string | null;
  normalizedMethodJson?: string | null;
  publicationEvidence?: unknown;
  dataFields: MethodInputField[];
  variableBindings: MethodVariableBinding[];
  formulas: MethodFormula[];
  measurementModels: MethodMeasurementModel[];
  validations: MethodValidation[];
  uncertaintyParams: MethodTypeBComponent[];
  certificateContent?: MethodCertificateContent | null;
  /** Frozen ISO 17025 accredited-scope flag (absent on legacy snapshots). */
  accreditedScope?: boolean;
};

export type AssetSnapshot = {
  assetId: number;
  assetTypeId: number;
  assetTypeName: string;
  assetTypeSlug: string;
  baseMeasurementUnit: MeasurementUnit | null;
  name: string;
  tag: string;
  serialNumber: string;
  manufacturer: string | null;
  model: string | null;
  specifications: Record<string, unknown> | null;
  capturedAt: string;
};

/**
 * Standard Snapshot - Frozen copy of reference standards at execution time.
 * This ensures the standard values used are recorded exactly as they were
 * during calibration, even if the standard is recalibrated later.
 * Critical for ISO 17025 compliance: traceability and reproducibility.
 */
export type StandardSnapshot = {
  id: number;
  name: string;
  type?: string | null;
  kind?: ReferenceStandardKind;
  certificateNumber: string;
  calibratedBy?: string | null;
  calibrationDate: Date;
  nextCalibrationDate: Date | null;
  uncertainty: number | null;
  uncertaintyUnit: string | null;
  coverageFactor: number;
  distribution: UncertaintyDistribution;
  drift: number | null;
  certifiedValues: CertifiedValue[] | null;
  metrologyData?: ReferenceStandardMetrologyData | null;
  certificateDocument?: ReferenceStandardCertificateDocumentSnapshot | null;
};

export type EnvironmentalLimitsSnapshot = {
  temperature?: { min: number; max: number };
  humidity?: { min: number; max: number };
  pressure?: { min: number; max: number };
};

export type EnvironmentalSnapshot = {
  temperature: number | null;
  humidity: number | null;
  pressure: number | null;
  recordedAt: string;
  recordedBy: string;
  limits: EnvironmentalLimitsSnapshot | null;
  withinLimits: boolean;
  outOfLimitsJustification: string | null;
};

export type CalibrationLocationType = "customer_site" | "lab" | "other";

export type CalibrationLocationSnapshot = {
  type: CalibrationLocationType;
  addressText: string;
  notes?: string | null;
  recordedAt: string;
  recordedBy: string;
};

export type CalibrationPhaseMode =
  | "before_and_after"
  | "before_only"
  | "after_only"
  | "not_performed";

export type CalibrationPhaseSnapshot = {
  blocks: Record<
    string,
    {
      mode: CalibrationPhaseMode;
      reason?: string | null;
    }
  >;
  recordedAt: string;
  recordedBy: string;
};

export type CalibrationRequestStatus =
  | "PENDING"
  | "UNDER_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "CONVERTED";

/**
 * Calibration Job table - The Work Order / Operational Record
 * ISO 17025:2017 Clause 7.7 - Ensuring Validity of Results
 *
 * Key concepts:
 * - Connects Customer + Asset + Service + Method into a single record
 * - Method configuration is SNAPSHOTTED at job creation (immutable history)
 * - Workflow states enforce ISO 17025 separation of duties
 * - Approved jobs are immutable for compliance
 */
export const calibrationJob = pgTable(
  "calibration_job",
  {
    id: serial("id").primaryKey(),
    // Human-readable certificate number, unique within the laboratory.
    jobId: text("job_id").notNull(),
    // Optional human-readable/document filename generated from lab-specific
    // certificate naming rules. Older jobs keep this null and use jobId.
    certificateName: text("certificate_name"),
    certificateNumberingSnapshot: jsonb(
      "certificate_numbering_snapshot",
    ).$type<CertificateNumberingSnapshot>(),
    // Organization scope
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    unitId: integer("unit_id")
      .notNull()
      .references(() => organizationUnit.id, { onDelete: "restrict" }),
    // Customer who owns the asset
    customerId: integer("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "restrict" }),
    // Asset being calibrated
    assetId: integer("asset_id")
      .notNull()
      .references(() => asset.id, { onDelete: "restrict" }),
    // Service (commercial wrapper, contains pricing/TAT)
    serviceId: integer("service_id")
      .notNull()
      .references(() => service.id, { onDelete: "restrict" }),
    // Assigned technician (nullable - can be assigned later)
    technicianId: text("technician_id").references(() => user.id, {
      onDelete: "set null",
    }),
    // CRITICAL: Frozen copy of method configuration at job creation
    // This ensures reproducibility per ISO 17025 requirements
    methodSnapshot: jsonb("method_snapshot").$type<MethodSnapshot>().notNull(),
    // Frozen copy of asset identity and specifications used by calculations
    assetSnapshot: jsonb("asset_snapshot").$type<AssetSnapshot>(),
    // Workflow status
    status: text("status").$type<JobStatus>().default("DRAFT").notNull(),
    // On-site (calibração in loco): the scheduled visit this job belongs to, when
    // it came from an on-site request. Null for in-lab jobs.
    visitId: integer("visit_id").references(() => calibrationVisit.id, {
      onDelete: "set null",
    }),
    // Dates
    dueDate: timestamp("due_date"),
    performedAt: timestamp("performed_at"),
    // Execution data (filled by technician during calibration)
    data: jsonb("data").$type<Record<string, unknown>>(),
    // Calculated results (output from math engine)
    results: jsonb("results").$type<Record<string, unknown>>(),
    // Frozen copy of reference standards used during execution
    // This ensures traceability per ISO 17025 requirements
    standardsSnapshot: jsonb("standards_snapshot").$type<StandardSnapshot[]>(),
    // Frozen copy of environmental conditions at execution time
    // ISO 17025:2017 Clause 7.1.2 - Environmental conditions monitoring
    environmentalSnapshot: jsonb(
      "environmental_snapshot",
    ).$type<EnvironmentalSnapshot>(),
    calibrationLocationSnapshot: jsonb(
      "calibration_location_snapshot",
    ).$type<CalibrationLocationSnapshot>(),
    calibrationPhaseSnapshot: jsonb(
      "calibration_phase_snapshot",
    ).$type<CalibrationPhaseSnapshot>(),
    certificateTemplateId: integer("certificate_template_id").references(
      () => certificateTemplate.id,
      { onDelete: "set null" },
    ),
    certificateTemplateSnapshot: jsonb("certificate_template_snapshot").$type<
      Record<string, unknown>
    >(),
    // Certificate URL (populated after approval and PDF generation)
    certificateUrl: text("certificate_url"),
    // Label URL for thermal printer sticker (populated after label generation)
    labelUrl: text("label_url"),
    // Public verification token (UUID) - unguessable link for auditors/clients
    // Uses PostgreSQL's native gen_random_uuid() for automatic generation
    verificationToken: text("verification_token")
      .notNull()
      .unique()
      .default(sql`gen_random_uuid()`),
    // Timestamps and actors
    createdAt: timestamp("created_at").defaultNow().notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    // Approval tracking
    approvedBy: text("approved_by").references(() => user.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at"),
    // Rejection tracking
    rejectedBy: text("rejected_by").references(() => user.id, {
      onDelete: "set null",
    }),
    rejectedAt: timestamp("rejected_at"),
    rejectionReason: text("rejection_reason"),
    // ==========================================================================
    // AMENDMENT TRACKING - ISO 17025:2017 Clause 7.8.4.1
    // "When a report or certificate needs to be revised after issue, each
    // revision shall be uniquely identified and shall contain a reference
    // to the original."
    // ==========================================================================
    /**
     * References the job that this job supersedes (if this is a correction).
     * NULL for original certificates.
     * Example: Job #123 has error. Create Job #456 with supersedesId=123.
     */
    supersedesId: integer("supersedes_id"),
    /**
     * References the job that superseded this job (if this has been corrected).
     * NULL for current valid certificates.
     * Automatically set when another job is created to supersede this one.
     */
    supersededById: integer("superseded_by_id"),
    /**
     * Amendment number (1, 2, 3...) if this is a correction.
     * NULL for original certificates.
     * Used for display: "Retificação nº 2"
     */
    amendmentNumber: integer("amendment_number"),
    /**
     * Mandatory reason for amendment (ISO 17025 requirement).
     * Example: "Erro de digitação no valor de incerteza"
     */
    amendmentReason: text("amendment_reason"),
    /**
     * Timestamp when this job was superseded by another.
     */
    supersededAt: timestamp("superseded_at"),
    // ==========================================================================
    // DIGITAL SIGNATURE - ISO 17025:2017 Clause 7.8.2.1(q)
    // "Reports and certificates shall include... the signature..."
    // ==========================================================================
    /**
     * Digital signature metadata from ICP-Brasil certificate.
     * Populated after PDF signing. NULL if not signed.
     */
    signatureMetadata: jsonb("signature_metadata").$type<{
      signedAt: string; // ISO timestamp
      signerCertificateSerial: string;
      signerName: string;
      signerCpfCnpj: string | null;
      pdfHash: string; // SHA-256 hash of signed PDF
      ltvEnabled: boolean;
    }>(),
    /**
     * At-issue signature-integrity verdict (`@calibra-facil/signing` verifyPdf),
     * computed once when the certificate is signed. The public verification page
     * serves this directly and may additionally recheck the chain "now". NULL
     * when the certificate is unsigned or predates this column. Shape mirrors
     * VerifyPdfResult plus the timestamp it was computed at.
     */
    signatureVerdict: jsonb("signature_verdict").$type<{
      hashMatch: boolean | null;
      signatureCryptographicallyValid: boolean;
      chainValid: boolean;
      signerChainsToIcpRoot: boolean;
      certNotExpiredAtCheckDate: boolean;
      signaturePresent: boolean;
      signer: {
        commonName: string | null;
        cpfCnpj: string | null;
        certificateSerial: string | null;
      };
      overall: "VALID" | "ALTERED" | "UNSIGNED" | "UNVERIFIABLE";
      details: string[];
      computedAt: string; // ISO timestamp
    }>(),
  },
  (table) => [
    index("job_unit_id_idx").on(table.unitId),
    index("job_organization_id_idx").on(table.organizationId),
    index("job_customer_id_idx").on(table.customerId),
    index("job_asset_id_idx").on(table.assetId),
    index("job_service_id_idx").on(table.serviceId),
    index("job_technician_id_idx").on(table.technicianId),
    index("job_status_idx").on(table.status),
    index("job_due_date_idx").on(table.dueDate),
    index("job_org_status_due_idx").on(
      table.organizationId,
      table.status,
      table.dueDate,
    ),
    index("job_org_status_approved_at_idx").on(
      table.organizationId,
      table.status,
      table.approvedAt,
    ),
    index("job_org_status_rejected_at_idx").on(
      table.organizationId,
      table.status,
      table.rejectedAt,
    ),
    index("job_org_created_at_idx").on(table.organizationId, table.createdAt),
    uniqueIndex("job_org_job_id_uidx").on(table.organizationId, table.jobId),
    // Amendment tracking indexes for efficient chain lookups
    index("job_supersedes_id_idx").on(table.supersedesId),
    index("job_superseded_by_id_idx").on(table.supersededById),
    index("job_certificate_template_id_idx").on(table.certificateTemplateId),
  ],
);

// =============================================================================
// CALIBRATION JOB AUDIT LOG - ISO 17025:2017 Clause 8.4 (Control of records)
// =============================================================================

/**
 * Audit log for calibration job changes.
 * Tracks all modifications for compliance and traceability.
 * Critical for ISO 17025 audits and legal defensibility.
 */
export const jobAuditLog = pgTable(
  "job_audit_log",
  {
    id: serial("id").primaryKey(),
    jobId: integer("job_id")
      .notNull()
      .references(() => calibrationJob.id, { onDelete: "cascade" }),
    action: text("action").notNull(), // 'create', 'update', 'submit', 'approve', 'reject', 'cancel', 'assign', 'execute'
    changes: jsonb("changes"), // { field: { old: x, new: y } }
    performedBy: text("performed_by")
      .notNull()
      .references(() => user.id),
    performedAt: timestamp("performed_at").defaultNow().notNull(),
    ipAddress: text("ip_address"),
    reason: text("reason"), // Required for rejections, cancellations, approvals
  },
  (table) => [
    index("job_audit_log_job_id_idx").on(table.jobId),
    index("job_audit_log_performed_at_idx").on(table.performedAt),
    index("job_audit_log_action_idx").on(table.action),
  ],
);

// =============================================================================
// OPERATIONAL FINANCE - Contracts, snapshots, receivables and receipts
// =============================================================================

export type FinancialAuditEntityType =
  | "agreement"
  | "snapshot"
  | "document"
  | "installment"
  | "receipt"
  | "service_order";

export const commercialAgreement = pgTable(
  "commercial_agreement",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "cascade" }),
    status: text("status")
      .$type<CommercialAgreementStatus>()
      .default("DRAFT")
      .notNull(),
    agreementCode: text("agreement_code"),
    title: text("title").notNull(),
    externalReference: text("external_reference"),
    currency: text("currency").default("BRL").notNull(),
    effectiveFrom: timestamp("effective_from").notNull(),
    effectiveTo: timestamp("effective_to"),
    defaultPaymentTermDays: integer("default_payment_term_days")
      .default(28)
      .notNull(),
    notes: text("notes"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    updatedBy: text("updated_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("commercial_agreement_org_idx").on(table.organizationId),
    index("commercial_agreement_customer_idx").on(table.customerId),
    index("commercial_agreement_status_idx").on(table.status),
    index("commercial_agreement_effective_from_idx").on(table.effectiveFrom),
    uniqueIndex("commercial_agreement_org_code_uidx").on(
      table.organizationId,
      table.agreementCode,
    ),
  ],
);

export const commercialAgreementUnitScope = pgTable(
  "commercial_agreement_unit_scope",
  {
    id: serial("id").primaryKey(),
    agreementId: integer("agreement_id")
      .notNull()
      .references(() => commercialAgreement.id, { onDelete: "cascade" }),
    unitId: integer("unit_id")
      .notNull()
      .references(() => organizationUnit.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("commercial_agreement_unit_scope_uidx").on(
      table.agreementId,
      table.unitId,
    ),
    index("commercial_agreement_unit_scope_unit_idx").on(table.unitId),
  ],
);

export const commercialAgreementServiceTerm = pgTable(
  "commercial_agreement_service_term",
  {
    id: serial("id").primaryKey(),
    agreementId: integer("agreement_id")
      .notNull()
      .references(() => commercialAgreement.id, { onDelete: "cascade" }),
    serviceId: integer("service_id")
      .notNull()
      .references(() => service.id, { onDelete: "cascade" }),
    unitId: integer("unit_id").references(() => organizationUnit.id, {
      onDelete: "cascade",
    }),
    priceCents: integer("price_cents").notNull(),
    currency: text("currency").default("BRL").notNull(),
    tatDays: integer("tat_days"),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("commercial_agreement_service_term_agreement_idx").on(
      table.agreementId,
    ),
    index("commercial_agreement_service_term_service_idx").on(table.serviceId),
    index("commercial_agreement_service_term_unit_idx").on(table.unitId),
  ],
);

export const jobCommercialSnapshot = pgTable(
  "job_commercial_snapshot",
  {
    id: serial("id").primaryKey(),
    jobId: integer("job_id")
      .notNull()
      .unique()
      .references(() => calibrationJob.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "restrict" }),
    unitId: integer("unit_id")
      .notNull()
      .references(() => organizationUnit.id, { onDelete: "restrict" }),
    serviceId: integer("service_id")
      .notNull()
      .references(() => service.id, { onDelete: "restrict" }),
    agreementId: integer("agreement_id").references(
      () => commercialAgreement.id,
      {
        onDelete: "set null",
      },
    ),
    sourceType: text("source_type")
      .$type<JobCommercialSnapshotSource>()
      .notNull(),
    serviceName: text("service_name").notNull(),
    priceCents: integer("price_cents"),
    currency: text("currency").default("BRL").notNull(),
    paymentTermDays: integer("payment_term_days").default(28).notNull(),
    capturedAt: timestamp("captured_at").defaultNow().notNull(),
    capturedBySystemVersion: text("captured_by_system_version").notNull(),
  },
  (table) => [
    index("job_commercial_snapshot_org_idx").on(table.organizationId),
    index("job_commercial_snapshot_customer_idx").on(table.customerId),
    index("job_commercial_snapshot_service_idx").on(table.serviceId),
    index("job_commercial_snapshot_agreement_idx").on(table.agreementId),
  ],
);

export const billingDocument = pgTable(
  "billing_document",
  {
    id: serial("id").primaryKey(),
    // Non-sequential public identifier used in URLs so the global serial id
    // (and cross-tenant document volume) is never exposed. gen_random_uuid().
    publicId: text("public_id")
      .notNull()
      .unique()
      .default(sql`gen_random_uuid()`),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "restrict" }),
    unitId: integer("unit_id")
      .notNull()
      .references(() => organizationUnit.id, { onDelete: "restrict" }),
    agreementId: integer("agreement_id").references(
      () => commercialAgreement.id,
      {
        onDelete: "set null",
      },
    ),
    documentNumber: text("document_number"),
    status: text("status")
      .$type<BillingDocumentStatus>()
      .default("DRAFT")
      .notNull(),
    issueDate: timestamp("issue_date"),
    dueDate: timestamp("due_date").notNull(),
    currency: text("currency").default("BRL").notNull(),
    subtotalCents: integer("subtotal_cents").notNull(),
    discountCents: integer("discount_cents").default(0).notNull(),
    totalCents: integer("total_cents").notNull(),
    notes: text("notes"),
    issuedBy: text("issued_by").references(() => user.id, {
      onDelete: "set null",
    }),
    voidedBy: text("voided_by").references(() => user.id, {
      onDelete: "set null",
    }),
    voidReason: text("void_reason"),
    exportStatus: text("export_status")
      .$type<BillingDocumentExportStatus>()
      .default("NOT_EXPORTED")
      .notNull(),
    exportedAt: timestamp("exported_at"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    updatedBy: text("updated_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("billing_document_org_idx").on(table.organizationId),
    index("billing_document_customer_idx").on(table.customerId),
    index("billing_document_unit_idx").on(table.unitId),
    index("billing_document_status_idx").on(table.status),
    index("billing_document_due_date_idx").on(table.dueDate),
    index("billing_document_agreement_idx").on(table.agreementId),
    uniqueIndex("billing_document_org_number_uidx").on(
      table.organizationId,
      table.documentNumber,
    ),
  ],
);

export const billingDocumentItem = pgTable(
  "billing_document_item",
  {
    id: serial("id").primaryKey(),
    documentId: integer("document_id")
      .notNull()
      .references(() => billingDocument.id, { onDelete: "cascade" }),
    jobId: integer("job_id").references(() => calibrationJob.id, {
      onDelete: "set null",
    }),
    jobCommercialSnapshotId: integer("job_commercial_snapshot_id").references(
      () => jobCommercialSnapshot.id,
      { onDelete: "set null" },
    ),
    serviceOrderId: integer("service_order_id"),
    description: text("description").notNull(),
    quantity: integer("quantity").default(1).notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    totalCents: integer("total_cents").notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("billing_document_item_document_idx").on(table.documentId),
    index("billing_document_item_job_idx").on(table.jobId),
    index("billing_document_item_snapshot_idx").on(
      table.jobCommercialSnapshotId,
    ),
    index("billing_document_item_service_order_idx").on(table.serviceOrderId),
  ],
);

export const receivableInstallment = pgTable(
  "receivable_installment",
  {
    id: serial("id").primaryKey(),
    documentId: integer("document_id")
      .notNull()
      .references(() => billingDocument.id, { onDelete: "cascade" }),
    installmentNumber: integer("installment_number").default(1).notNull(),
    status: text("status")
      .$type<ReceivableInstallmentStatus>()
      .default("OPEN")
      .notNull(),
    dueDate: timestamp("due_date").notNull(),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").default("BRL").notNull(),
    paidAt: timestamp("paid_at"),
    paymentMethod: text("payment_method").$type<FinancialPaymentMethod>(),
    paymentReference: text("payment_reference"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("receivable_installment_document_number_uidx").on(
      table.documentId,
      table.installmentNumber,
    ),
    index("receivable_installment_status_idx").on(table.status),
    index("receivable_installment_due_date_idx").on(table.dueDate),
  ],
);

export const paymentReceipt = pgTable(
  "payment_receipt",
  {
    id: serial("id").primaryKey(),
    installmentId: integer("installment_id")
      .notNull()
      .references(() => receivableInstallment.id, { onDelete: "cascade" }),
    recordedBy: text("recorded_by")
      .notNull()
      .references(() => user.id),
    receivedAt: timestamp("received_at").notNull(),
    amountCents: integer("amount_cents").notNull(),
    paymentMethod: text("payment_method")
      .$type<FinancialPaymentMethod>()
      .notNull(),
    reference: text("reference"),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("payment_receipt_installment_idx").on(table.installmentId),
    index("payment_receipt_received_at_idx").on(table.receivedAt),
  ],
);

export const financialAuditLog = pgTable(
  "financial_audit_log",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    entityType: text("entity_type").$type<FinancialAuditEntityType>().notNull(),
    entityId: text("entity_id").notNull(),
    action: text("action").notNull(),
    changes: jsonb("changes"),
    performedBy: text("performed_by")
      .notNull()
      .references(() => user.id),
    performedAt: timestamp("performed_at").defaultNow().notNull(),
    reason: text("reason"),
  },
  (table) => [
    index("financial_audit_log_org_idx").on(table.organizationId),
    index("financial_audit_log_entity_idx").on(
      table.entityType,
      table.entityId,
    ),
    index("financial_audit_log_performed_at_idx").on(table.performedAt),
  ],
);

// =============================================================================
// CERTIFICATE RELEASE - Phase 2 slice 1. Separates technical approval
// (calibrationJob.status === "APPROVED") from commercial release of the
// certificate to the customer portal. Driven by a per-org / per-customer /
// per-contract / per-service-category policy that evaluates the Phase 1
// payment continuity state. ERP payment status must never mutate
// calibrationJob.status or issuedCertificateSnapshot.status.
// =============================================================================

export const certificateReleasePolicy = pgTable(
  "certificate_release_policy",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    mode: text("mode").$type<CertificateReleasePolicyMode>().notNull(),
    customerId: integer("customer_id").references(() => customer.id, {
      onDelete: "cascade",
    }),
    commercialAgreementId: integer("commercial_agreement_id").references(
      () => commercialAgreement.id,
      { onDelete: "cascade" },
    ),
    serviceCategory: text("service_category"),
    priority: integer("priority").default(0).notNull(),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    archivedAt: timestamp("archived_at"),
  },
  (table) => [
    index("certificate_release_policy_org_idx").on(table.organizationId),
    index("certificate_release_policy_customer_idx").on(
      table.organizationId,
      table.customerId,
    ),
    index("certificate_release_policy_agreement_idx").on(
      table.organizationId,
      table.commercialAgreementId,
    ),
    index("certificate_release_policy_category_idx").on(
      table.organizationId,
      table.serviceCategory,
    ),
    // One active org-default per organization. Drizzle's uniqueIndex with a
    // where-style partial cannot be expressed directly; enforce via the SQL
    // unique on (org, customer=null, agreement=null, category=null) where
    // archivedAt is null at the application layer in resolveCertificateReleasePolicy.
  ],
);

export const certificateRelease = pgTable(
  "certificate_release",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    calibrationJobId: integer("calibration_job_id")
      .notNull()
      .references(() => calibrationJob.id, { onDelete: "cascade" }),
    status: text("status").$type<CertificateReleaseStatus>().notNull(),
    appliedPolicyId: integer("applied_policy_id").references(
      () => certificateReleasePolicy.id,
      { onDelete: "set null" },
    ),
    lastEvaluatedAt: timestamp("last_evaluated_at").defaultNow().notNull(),
    paymentStateSnapshot: jsonb("payment_state_snapshot")
      .$type<CertificateReleasePaymentStateSnapshot | null>()
      .default(sql`'null'::jsonb`),
    releasedByUserId: text("released_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    releaseReason: text("release_reason"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("certificate_release_job_uidx").on(table.calibrationJobId),
    index("certificate_release_org_idx").on(table.organizationId),
    index("certificate_release_status_idx").on(
      table.organizationId,
      table.status,
    ),
    index("certificate_release_policy_idx").on(table.appliedPolicyId),
  ],
);

// Phase 2 slice 4 - automatic send rules by milestone. Mirrors the
// certificate-release-policy shape: org default + per-customer /
// per-agreement / per-service-name override scopes, priority + id
// tie-break. Triggered by certificate-approval / SO-delivery /
// contract-anniversary events.

export const automaticSendRule = pgTable(
  "automatic_send_rule",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    milestone: text("milestone").$type<AutomaticSendMilestone>().notNull(),
    customerId: integer("customer_id").references(() => customer.id, {
      onDelete: "cascade",
    }),
    commercialAgreementId: integer("commercial_agreement_id").references(
      () => commercialAgreement.id,
      { onDelete: "cascade" },
    ),
    serviceCategory: text("service_category"),
    priority: integer("priority").default(0).notNull(),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    archivedAt: timestamp("archived_at"),
  },
  (table) => [
    index("automatic_send_rule_org_idx").on(table.organizationId),
    index("automatic_send_rule_customer_idx").on(
      table.organizationId,
      table.customerId,
    ),
    index("automatic_send_rule_agreement_idx").on(
      table.organizationId,
      table.commercialAgreementId,
    ),
    index("automatic_send_rule_category_idx").on(
      table.organizationId,
      table.serviceCategory,
    ),
  ],
);

export const automaticSendAuditLog = pgTable(
  "automatic_send_audit_log",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    serviceOrderId: integer("service_order_id").references(
      () => serviceOrder.id,
      { onDelete: "set null" },
    ),
    appliedRuleId: integer("applied_rule_id").references(
      () => automaticSendRule.id,
      { onDelete: "set null" },
    ),
    milestone: text("milestone").$type<AutomaticSendMilestone>().notNull(),
    outcome: text("outcome").$type<AutomaticSendOutcome>().notNull(),
    actorUserId: text("actor_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    reason: text("reason"),
    providerResponseSummary: jsonb("provider_response_summary").$type<Record<
      string,
      unknown
    > | null>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("automatic_send_audit_org_idx").on(table.organizationId),
    index("automatic_send_audit_so_idx").on(table.serviceOrderId),
    index("automatic_send_audit_created_idx").on(table.createdAt),
  ],
);

// Phase 2 slice 9 - batch / consolidated billing groups. Many service
// orders can share one billing document via this group; compatibility
// rules live in apps/api/src/lib/billing-group.ts.

export const billingGroup = pgTable(
  "billing_group",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "restrict" }),
    status: text("status")
      .$type<BillingGroupStatus>()
      .default("OPEN")
      .notNull(),
    paymentTermDays: integer("payment_term_days").default(28).notNull(),
    currency: text("currency").default("BRL").notNull(),
    billingPeriodFrom: timestamp("billing_period_from"),
    billingPeriodTo: timestamp("billing_period_to"),
    notes: text("notes"),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("billing_group_org_idx").on(table.organizationId),
    index("billing_group_customer_idx").on(
      table.organizationId,
      table.customerId,
    ),
    index("billing_group_status_idx").on(table.organizationId, table.status),
  ],
);

export const billingGroupServiceOrder = pgTable(
  "billing_group_service_order",
  {
    id: serial("id").primaryKey(),
    groupId: integer("group_id")
      .notNull()
      .references(() => billingGroup.id, { onDelete: "cascade" }),
    serviceOrderId: integer("service_order_id")
      .notNull()
      .references(() => serviceOrder.id, { onDelete: "cascade" }),
    addedAt: timestamp("added_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("billing_group_service_order_uidx").on(
      table.groupId,
      table.serviceOrderId,
    ),
    index("billing_group_service_order_so_idx").on(table.serviceOrderId),
  ],
);

// Phase 2 slice 7 - normalized supplier / transporter records. Replaces
// the free-text supplierName captured in slice 6's
// service_order_outsourced_cost.

export const supplier = pgTable(
  "supplier",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    taxId: text("tax_id"),
    email: text("email"),
    phone: text("phone"),
    kind: text("kind").$type<SupplierKind>().default("other").notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    archivedAt: timestamp("archived_at"),
  },
  (table) => [
    index("supplier_org_idx").on(table.organizationId),
    index("supplier_org_name_idx").on(table.organizationId, table.name),
  ],
);

// Phase 2 slice 6 - outsourced calibration cost capture so margin per
// service order is visible. expected_cost_cents is set by the operator
// before dispatch; actual_cost_cents + payable_link_id are populated
// when the Conta Azul payable poll reconciles a matching payable.

export const serviceOrderOutsourcedCost = pgTable(
  "service_order_outsourced_cost",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    serviceOrderId: integer("service_order_id")
      .notNull()
      .references(() => serviceOrder.id, { onDelete: "cascade" }),
    supplierName: text("supplier_name").notNull(),
    expectedCostCents: integer("expected_cost_cents").notNull(),
    actualCostCents: integer("actual_cost_cents"),
    currency: text("currency").default("BRL").notNull(),
    payableLinkId: text("payable_link_id"),
    notes: text("notes"),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    voidedAt: timestamp("voided_at"),
  },
  (table) => [
    index("service_order_outsourced_cost_org_idx").on(table.organizationId),
    index("service_order_outsourced_cost_so_idx").on(table.serviceOrderId),
    index("service_order_outsourced_cost_payable_idx").on(table.payableLinkId),
  ],
);

export const certificateReleaseAuditLog = pgTable(
  "certificate_release_audit_log",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    certificateReleaseId: integer("certificate_release_id")
      .notNull()
      .references(() => certificateRelease.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    fromStatus: text("from_status").$type<CertificateReleaseStatus | null>(),
    toStatus: text("to_status").$type<CertificateReleaseStatus>().notNull(),
    appliedPolicyId: integer("applied_policy_id").references(
      () => certificateReleasePolicy.id,
      { onDelete: "set null" },
    ),
    paymentStateSnapshot: jsonb(
      "payment_state_snapshot",
    ).$type<CertificateReleasePaymentStateSnapshot | null>(),
    reason: text("reason"),
    source: text("source").$type<CertificateReleaseAuditSource>().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("certificate_release_audit_org_idx").on(table.organizationId),
    index("certificate_release_audit_release_idx").on(
      table.certificateReleaseId,
    ),
    index("certificate_release_audit_created_idx").on(table.createdAt),
  ],
);

// =============================================================================
// SERVICE ORDER - Operational intake, repair, quote and delivery workflow
// =============================================================================

export type ServiceOrderNumberingScope = "organization" | "unit";

export type ServiceOrderSignatureData = {
  signerName: string;
  signedAt?: string;
  dataUrl: string;
};

export const serviceOrder = pgTable(
  "service_order",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    unitId: integer("unit_id")
      .notNull()
      .references(() => organizationUnit.id, { onDelete: "restrict" }),
    serviceOrderNumber: text("service_order_number").notNull(),
    // Opaque, non-sequential identifier for client-facing URLs (the portal
    // routes by this instead of the enumerable serial id). Mirrors
    // calibrationJob.verificationToken / billingDocument.publicId.
    publicId: text("public_id")
      .notNull()
      .unique()
      .default(sql`gen_random_uuid()`),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "restrict" }),
    clientContactId: integer("client_contact_id"),
    clientContactSnapshot: jsonb("client_contact_snapshot").$type<
      Record<string, unknown>
    >(),
    assetId: integer("asset_id")
      .notNull()
      .references(() => asset.id, { onDelete: "restrict" }),
    intakeType: text("intake_type")
      .$type<ServiceOrderIntakeType>()
      .default("counter")
      .notNull(),
    sourceServiceOrderId: integer("source_service_order_id"),
    // External / in-loco service order: the technician travels to the client
    // to perform the work. Drives rendering the client service address on the
    // lab print copy.
    isExternalService: boolean("is_external_service").default(false).notNull(),
    status: text("status")
      .$type<ServiceOrderStatus>()
      .default("opened")
      .notNull(),
    priority: text("priority")
      .$type<ServiceOrderPriority>()
      .default("normal")
      .notNull(),
    openedAt: timestamp("opened_at").defaultNow().notNull(),
    // When the technician actually started the budget/service work. Distinct
    // from openedAt (OS creation); nullable and editable, not auto-set.
    serviceStartedAt: timestamp("service_started_at"),
    openedByUserId: text("opened_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    responsibleTechnicianId: text("responsible_technician_id").references(
      () => user.id,
      { onDelete: "set null" },
    ),
    evaluatedAt: timestamp("evaluated_at"),
    quotedAt: timestamp("quoted_at"),
    approvedAt: timestamp("approved_at"),
    rejectedAt: timestamp("rejected_at"),
    repairStartedAt: timestamp("repair_started_at"),
    repairFinishedAt: timestamp("repair_finished_at"),
    readyAt: timestamp("ready_at"),
    deliveredAt: timestamp("delivered_at"),
    deliveredToName: text("delivered_to_name"),
    deliveredToDocument: text("delivered_to_document"),
    deliveryNotes: text("delivery_notes"),
    closedAt: timestamp("closed_at"),
    canceledAt: timestamp("canceled_at"),
    cancelReason: text("cancel_reason"),
    claimedDefect: text("claimed_defect").notNull(),
    intakeCondition: text("intake_condition").notNull(),
    accessories: text("accessories"),
    // Lacre (security seal) numbers: rompido na entrada / afixado na saída.
    oldSealNumber: text("old_seal_number"),
    newSealNumber: text("new_seal_number"),
    // DEPRECATED: orphaned column — no input UI, not rendered on certificates,
    // redundant with inmetroRepairSealNumber (the Etiqueta de Reparo / selo).
    // No longer displayed anywhere; drop in a future contract migration.
    repairedSealNumber: text("repaired_seal_number"),
    // Etiqueta de Reparo (Inmetro "Marca de Instrumento Reparado") — the glued
    // repair sticker. Kept the inmetroRepairSeal* column names for stability.
    inmetroRepairSealNumber: text("inmetro_repair_seal_number"),
    inmetroRepairSealIssuedAt: timestamp("inmetro_repair_seal_issued_at"),
    inmetroRepairSealAppliedAt: timestamp("inmetro_repair_seal_applied_at"),
    inmetroRepairSealAppliedByUserId: text(
      "inmetro_repair_seal_applied_by_user_id",
    ).references(() => user.id, { onDelete: "set null" }),
    inmetroRepairSealNotes: text("inmetro_repair_seal_notes"),
    invoiceRemittanceNumber: text("invoice_remittance_number"),
    invoiceRemittanceKey: text("invoice_remittance_key"),
    invoiceRemittanceIssuedAt: timestamp("invoice_remittance_issued_at"),
    carrierName: text("carrier_name"),
    carrierDocument: text("carrier_document"),
    thirdPartyName: text("third_party_name"),
    thirdPartyDocument: text("third_party_document"),
    thirdPartyPhone: text("third_party_phone"),
    deliveryMethod: text("delivery_method")
      .$type<ServiceOrderDeliveryMethod>()
      .default("pickup_at_lab")
      .notNull(),
    internalNotes: text("internal_notes"),
    clientVisibleNotes: text("client_visible_notes"),
    totalQuotedCents: integer("total_quoted_cents").default(0).notNull(),
    totalApprovedCents: integer("total_approved_cents").default(0).notNull(),
    evaluationFeeCents: integer("evaluation_fee_cents").default(0).notNull(),
    evaluationFeeApplied: boolean("evaluation_fee_applied")
      .default(false)
      .notNull(),
    warrantyUntil: timestamp("warranty_until"),
    warrantyTerms: text("warranty_terms"),
    closingReason: text("closing_reason").$type<ServiceOrderClosingReason>(),
    billingDocumentId: integer("billing_document_id").references(
      () => billingDocument.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("service_order_org_number_uidx").on(
      table.organizationId,
      table.serviceOrderNumber,
    ),
    index("service_order_org_status_opened_idx").on(
      table.organizationId,
      table.status,
      table.openedAt,
    ),
    index("service_order_unit_status_idx").on(table.unitId, table.status),
    index("service_order_customer_idx").on(table.customerId),
    index("service_order_asset_idx").on(table.assetId),
    index("service_order_technician_idx").on(table.responsibleTechnicianId),
    index("service_order_source_idx").on(table.sourceServiceOrderId),
    index("service_order_billing_document_idx").on(table.billingDocumentId),
  ],
);

export const serviceOrderAssetSnapshot = pgTable(
  "service_order_asset_snapshot",
  {
    id: serial("id").primaryKey(),
    serviceOrderId: integer("service_order_id")
      .notNull()
      .unique()
      .references(() => serviceOrder.id, { onDelete: "cascade" }),
    assetId: integer("asset_id")
      .notNull()
      .references(() => asset.id, { onDelete: "restrict" }),
    assetName: text("asset_name").notNull(),
    assetType: text("asset_type"),
    manufacturer: text("manufacturer"),
    model: text("model"),
    serialNumber: text("serial_number"),
    patrimonyNumber: text("patrimony_number"),
    capacity: text("capacity"),
    resolution: text("resolution"),
    inventoryCode: text("inventory_code"),
    clientAssetCode: text("client_asset_code"),
    observedIdentification: text("observed_identification"),
    photos: jsonb("photos").$type<string[]>().default([]).notNull(),
    specifications: jsonb("specifications").$type<Record<string, unknown>>(),
    // Blueprint-driven instrument specs, frozen at intake as an ordered, printable
    // [{label, value}] list so the printed OS renders any asset type's specs
    // (not just weighing). Null for snapshots created before migration 0056 —
    // the doc renderer falls back to the live asset-type blueprint for those.
    displaySpecs:
      jsonb("display_specs").$type<{ label: string; value: string }[]>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("service_order_asset_snapshot_asset_idx").on(table.assetId),
  ],
);

export const serviceOrderIntakeDocument = pgTable(
  "service_order_intake_document",
  {
    id: serial("id").primaryKey(),
    serviceOrderId: integer("service_order_id")
      .notNull()
      .references(() => serviceOrder.id, { onDelete: "cascade" }),
    documentNumber: text("document_number").notNull(),
    version: integer("version").default(1).notNull(),
    type: text("type").default("combined").notNull(),
    pdfR2Key: text("pdf_r2_key"),
    issuedAt: timestamp("issued_at"),
    issuedByUserId: text("issued_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    accessTokenHash: text("access_token_hash"),
    qrCodePayload: text("qr_code_payload"),
    signatureData: jsonb("signature_data").$type<ServiceOrderSignatureData>(),
    canceledAt: timestamp("canceled_at"),
    canceledReason: text("canceled_reason"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("service_order_intake_document_order_idx").on(table.serviceOrderId),
    uniqueIndex("service_order_intake_document_number_version_uidx").on(
      table.documentNumber,
      table.version,
    ),
  ],
);

export const serviceOrderTag = pgTable(
  "service_order_tag",
  {
    id: serial("id").primaryKey(),
    serviceOrderId: integer("service_order_id")
      .notNull()
      .references(() => serviceOrder.id, { onDelete: "cascade" }),
    tagNumber: text("tag_number").notNull(),
    labelTemplateId: integer("label_template_id"),
    pdfR2Key: text("pdf_r2_key"),
    printedAt: timestamp("printed_at"),
    printedByUserId: text("printed_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("service_order_tag_order_idx").on(table.serviceOrderId),
    uniqueIndex("service_order_tag_number_uidx").on(table.tagNumber),
  ],
);

export const serviceOrderDeliveryDocument = pgTable(
  "service_order_delivery_document",
  {
    id: serial("id").primaryKey(),
    serviceOrderId: integer("service_order_id")
      .notNull()
      .references(() => serviceOrder.id, { onDelete: "cascade" }),
    documentNumber: text("document_number").notNull(),
    version: integer("version").default(1).notNull(),
    pdfR2Key: text("pdf_r2_key"),
    issuedAt: timestamp("issued_at"),
    issuedByUserId: text("issued_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    technicianSignatureData: jsonb(
      "technician_signature_data",
    ).$type<ServiceOrderSignatureData>(),
    clientSignatureData: jsonb(
      "client_signature_data",
    ).$type<ServiceOrderSignatureData>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("service_order_delivery_document_order_idx").on(table.serviceOrderId),
    uniqueIndex("service_order_delivery_document_number_version_uidx").on(
      table.documentNumber,
      table.version,
    ),
  ],
);

export const serviceOrderEvaluation = pgTable(
  "service_order_evaluation",
  {
    id: serial("id").primaryKey(),
    serviceOrderId: integer("service_order_id")
      .notNull()
      .references(() => serviceOrder.id, { onDelete: "cascade" }),
    technicianId: text("technician_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    evaluatedAt: timestamp("evaluated_at").defaultNow().notNull(),
    diagnosis: text("diagnosis").notNull(),
    detectedIssues: text("detected_issues"),
    recommendedAction: text("recommended_action")
      .$type<ServiceOrderRecommendedAction>()
      .notNull(),
    requiresQuote: boolean("requires_quote").default(true).notNull(),
    requiresClientApproval: boolean("requires_client_approval")
      .default(true)
      .notNull(),
    calibrationRecommended: boolean("calibration_recommended")
      .default(false)
      .notNull(),
    photos: jsonb("photos").$type<string[]>().default([]).notNull(),
    internalNotes: text("internal_notes"),
    clientVisibleNotes: text("client_visible_notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("service_order_evaluation_order_idx").on(table.serviceOrderId),
    index("service_order_evaluation_technician_idx").on(table.technicianId),
  ],
);

export const serviceOrderQuote = pgTable(
  "service_order_quote",
  {
    id: serial("id").primaryKey(),
    serviceOrderId: integer("service_order_id")
      .notNull()
      .references(() => serviceOrder.id, { onDelete: "cascade" }),
    quoteNumber: text("quote_number").notNull(),
    version: integer("version").default(1).notNull(),
    status: text("status")
      .$type<ServiceOrderQuoteStatus>()
      .default("draft")
      .notNull(),
    subtotalServicesCents: integer("subtotal_services_cents")
      .default(0)
      .notNull(),
    subtotalPartsCents: integer("subtotal_parts_cents").default(0).notNull(),
    discountCents: integer("discount_cents").default(0).notNull(),
    freightCents: integer("freight_cents").default(0).notNull(),
    totalCents: integer("total_cents").default(0).notNull(),
    validUntil: timestamp("valid_until"),
    paymentTerms: text("payment_terms"),
    deliveryEstimate: text("delivery_estimate"),
    warrantyTerms: text("warranty_terms"),
    clientMessage: text("client_message"),
    internalNotes: text("internal_notes"),
    sentAt: timestamp("sent_at"),
    sentByUserId: text("sent_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at"),
    approvedByPortalUserId: text("approved_by_portal_user_id").references(
      () => user.id,
      { onDelete: "set null" },
    ),
    approvedManuallyByUserId: text("approved_manually_by_user_id").references(
      () => user.id,
      { onDelete: "set null" },
    ),
    manualApprovalByName: text("manual_approval_by_name"),
    manualApprovalEvidenceType: text(
      "manual_approval_evidence_type",
    ).$type<ServiceOrderManualApprovalEvidenceType>(),
    manualApprovalEvidenceText: text("manual_approval_evidence_text"),
    rejectedAt: timestamp("rejected_at"),
    rejectionReason: text("rejection_reason"),
    pdfR2Key: text("pdf_r2_key"),
    portalAccessTokenHash: text("portal_access_token_hash"),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("service_order_quote_order_status_idx").on(
      table.serviceOrderId,
      table.status,
    ),
    uniqueIndex("service_order_quote_order_version_uidx").on(
      table.serviceOrderId,
      table.version,
    ),
    uniqueIndex("service_order_quote_number_version_uidx").on(
      table.quoteNumber,
      table.version,
    ),
    index("service_order_quote_token_idx").on(table.portalAccessTokenHash),
  ],
);

export const serviceOrderQuoteItem = pgTable(
  "service_order_quote_item",
  {
    id: serial("id").primaryKey(),
    quoteId: integer("quote_id")
      .notNull()
      .references(() => serviceOrderQuote.id, { onDelete: "cascade" }),
    type: text("type").$type<ServiceOrderItemType>().notNull(),
    description: text("description").notNull(),
    quantity: real("quantity").default(1).notNull(),
    unit: text("unit").default("un").notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    totalPriceCents: integer("total_price_cents").notNull(),
    taxable: boolean("taxable").default(true).notNull(),
    warrantyCovered: boolean("warranty_covered").default(false).notNull(),
    warrantyUntil: timestamp("warranty_until"),
    warrantyTerms: text("warranty_terms"),
    notes: text("notes"),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("service_order_quote_item_quote_idx").on(table.quoteId)],
);

export const serviceOrderExecution = pgTable(
  "service_order_execution",
  {
    id: serial("id").primaryKey(),
    serviceOrderId: integer("service_order_id")
      .notNull()
      .unique()
      .references(() => serviceOrder.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    startedByUserId: text("started_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    finishedAt: timestamp("finished_at"),
    finishedByUserId: text("finished_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    servicePerformed: text("service_performed"),
    partsUsedSummary: text("parts_used_summary"),
    technicalNotes: text("technical_notes"),
    technicianSignatureData: jsonb(
      "technician_signature_data",
    ).$type<ServiceOrderSignatureData>(),
    clientSignatureData: jsonb(
      "client_signature_data",
    ).$type<ServiceOrderSignatureData>(),
    calibrationRequiredAfterRepair: boolean("calibration_required_after_repair")
      .default(false)
      .notNull(),
    result: text("result").$type<ServiceOrderExecutionResult>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("service_order_execution_order_idx").on(table.serviceOrderId),
  ],
);

export const serviceOrderExecutionItem = pgTable(
  "service_order_execution_item",
  {
    id: serial("id").primaryKey(),
    executionId: integer("execution_id")
      .notNull()
      .references(() => serviceOrderExecution.id, { onDelete: "cascade" }),
    quoteItemId: integer("quote_item_id").references(
      () => serviceOrderQuoteItem.id,
      { onDelete: "set null" },
    ),
    type: text("type").$type<ServiceOrderItemType>().notNull(),
    description: text("description").notNull(),
    quantity: real("quantity").default(1).notNull(),
    unit: text("unit").default("un").notNull(),
    unitCostCents: integer("unit_cost_cents").default(0).notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    totalPriceCents: integer("total_price_cents").notNull(),
    technicianId: text("technician_id").references(() => user.id, {
      onDelete: "set null",
    }),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("service_order_execution_item_execution_idx").on(table.executionId),
    index("service_order_execution_item_quote_item_idx").on(table.quoteItemId),
  ],
);

export const serviceOrderEventLog = pgTable(
  "service_order_event_log",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    unitId: integer("unit_id")
      .notNull()
      .references(() => organizationUnit.id, { onDelete: "cascade" }),
    serviceOrderId: integer("service_order_id")
      .notNull()
      .references(() => serviceOrder.id, { onDelete: "cascade" }),
    actorType: text("actor_type").$type<ServiceOrderActorType>().notNull(),
    actorId: text("actor_id"),
    eventType: text("event_type").$type<ServiceOrderEventType>().notNull(),
    oldValue: jsonb("old_value").$type<Record<string, unknown>>(),
    newValue: jsonb("new_value").$type<Record<string, unknown>>(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("service_order_event_order_created_idx").on(
      table.serviceOrderId,
      table.createdAt,
    ),
    index("service_order_event_org_unit_created_idx").on(
      table.organizationId,
      table.unitId,
      table.createdAt,
    ),
    index("service_order_event_type_idx").on(table.eventType),
  ],
);

export const serviceOrderAttachment = pgTable(
  "service_order_attachment",
  {
    id: serial("id").primaryKey(),
    serviceOrderId: integer("service_order_id")
      .notNull()
      .references(() => serviceOrder.id, { onDelete: "cascade" }),
    uploadedByUserId: text("uploaded_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    r2Key: text("r2_key").notNull(),
    visibility: text("visibility").default("internal").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("service_order_attachment_order_idx").on(table.serviceOrderId),
  ],
);

export const serviceOrderCertificateLink = pgTable(
  "service_order_certificate_link",
  {
    id: serial("id").primaryKey(),
    serviceOrderId: integer("service_order_id")
      .notNull()
      .references(() => serviceOrder.id, { onDelete: "cascade" }),
    certificateJobId: integer("certificate_job_id")
      .notNull()
      .references(() => calibrationJob.id, { onDelete: "cascade" }),
    linkedByUserId: text("linked_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    linkedAt: timestamp("linked_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("service_order_certificate_link_uidx").on(
      table.serviceOrderId,
      table.certificateJobId,
    ),
    index("service_order_certificate_link_job_idx").on(table.certificateJobId),
  ],
);

export const serviceOrderSettings = pgTable(
  "service_order_settings",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .unique()
      .references(() => organization.id, { onDelete: "cascade" }),
    numberingTemplate: text("numbering_template")
      .default("OS-{YYYY}-{SEQ}")
      .notNull(),
    numberingScope: text("numbering_scope")
      .$type<ServiceOrderNumberingScope>()
      .default("unit")
      .notNull(),
    defaultIntakeTerms: text("default_intake_terms"),
    defaultQuoteTerms: text("default_quote_terms"),
    requirePhotoOnIntake: boolean("require_photo_on_intake")
      .default(false)
      .notNull(),
    requireInvoiceOrJustification: boolean("require_invoice_or_justification")
      .default(false)
      .notNull(),
    allowPublicQuoteApproval: boolean("allow_public_quote_approval")
      .default(true)
      .notNull(),
    requirePortalLoginForApproval: boolean("require_portal_login_for_approval")
      .default(false)
      .notNull(),
    autoEmailOnOpen: boolean("auto_email_on_open").default(true).notNull(),
    autoEmailOnQuoteSent: boolean("auto_email_on_quote_sent")
      .default(true)
      .notNull(),
    autoEmailOnReady: boolean("auto_email_on_ready").default(true).notNull(),
    autoEmailOnClose: boolean("auto_email_on_close").default(false).notNull(),
    showValuesInPortal: boolean("show_values_in_portal")
      .default(true)
      .notNull(),
    defaultQuoteValidityDays: integer("default_quote_validity_days")
      .default(15)
      .notNull(),
    defaultWarrantyTerms: text("default_warranty_terms"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("service_order_settings_org_uidx").on(table.organizationId),
  ],
);

export const serviceOrderNumberingSequence = pgTable(
  "service_order_numbering_sequence",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    unitId: integer("unit_id").references(() => organizationUnit.id, {
      onDelete: "cascade",
    }),
    sequenceKey: text("sequence_key").notNull(),
    currentValue: integer("current_value").default(0).notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    unique("service_order_numbering_sequence_uidx")
      .on(table.organizationId, table.unitId, table.sequenceKey)
      .nullsNotDistinct(),
  ],
);

export const serviceOrderPublicAccessToken = pgTable(
  "service_order_public_access_token",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    serviceOrderId: integer("service_order_id")
      .notNull()
      .references(() => serviceOrder.id, { onDelete: "cascade" }),
    quoteId: integer("quote_id").references(() => serviceOrderQuote.id, {
      onDelete: "cascade",
    }),
    tokenHash: text("token_hash").notNull(),
    scope: text("scope").default("service_order").notNull(),
    expiresAt: timestamp("expires_at"),
    revokedAt: timestamp("revoked_at"),
    lastViewedAt: timestamp("last_viewed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("service_order_public_access_token_hash_uidx").on(
      table.tokenHash,
    ),
    index("service_order_public_access_token_order_idx").on(
      table.serviceOrderId,
    ),
    index("service_order_public_access_token_quote_idx").on(table.quoteId),
  ],
);

// =============================================================================
// CALIBRATION REQUEST - Client Portal Intake Queue
// =============================================================================

export const calibrationRequest = pgTable(
  "calibration_request",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    unitId: integer("unit_id")
      .notNull()
      .references(() => organizationUnit.id, { onDelete: "restrict" }),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "restrict" }),
    authOrganizationId: text("auth_organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    status: text("status")
      .$type<CalibrationRequestStatus>()
      .default("PENDING")
      .notNull(),
    observations: text("observations"),
    internalNotes: text("internal_notes"),
    requestedDueDate: timestamp("requested_due_date", {
      withTimezone: true,
    }),
    // How the customer will get the assets to the lab. When shipping via a
    // carrier, they provide the "nota fiscal de remessa para conserto" so the
    // lab can receive the goods and later issue the return invoice. When
    // "onsite", a lab technician travels to the customer (calibração in loco) —
    // no goods move, so the customer instead provides a visit address + a
    // preferred date (the lab confirms and schedules the actual visit).
    deliveryMethod: text("delivery_method")
      .$type<"dropoff" | "carrier" | "onsite">()
      .default("dropoff")
      .notNull(),
    invoiceRemittanceNumber: text("invoice_remittance_number"),
    invoiceRemittanceKey: text("invoice_remittance_key"),
    invoiceRemittanceIssuedAt: timestamp("invoice_remittance_issued_at", {
      withTimezone: true,
    }),
    carrierName: text("carrier_name"),
    // On-site (deliveryMethod = "onsite") — where the technician visits and the
    // customer's preferred date. Address defaults to the customer's registered
    // address but can be overridden (e.g. a branch/temporary location).
    onsiteAddress: jsonb("onsite_address").$type<CustomerAddress>(),
    preferredVisitDate: timestamp("preferred_visit_date", {
      withTimezone: true,
    }),
    submittedBy: text("submitted_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    reviewedBy: text("reviewed_by").references(() => user.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    approvedBy: text("approved_by").references(() => user.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    rejectedBy: text("rejected_by").references(() => user.id, {
      onDelete: "set null",
    }),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),
    convertedBy: text("converted_by").references(() => user.id, {
      onDelete: "set null",
    }),
    convertedAt: timestamp("converted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("calibration_request_unit_id_idx").on(table.unitId),
    index("calibration_request_org_id_idx").on(table.organizationId),
    index("calibration_request_customer_id_idx").on(table.customerId),
    index("calibration_request_auth_org_id_idx").on(table.authOrganizationId),
    index("calibration_request_status_idx").on(table.status),
    index("calibration_request_submitted_at_idx").on(table.submittedAt),
  ],
);

export const calibrationRequestItem = pgTable(
  "calibration_request_item",
  {
    id: serial("id").primaryKey(),
    requestId: integer("request_id")
      .notNull()
      .references(() => calibrationRequest.id, { onDelete: "cascade" }),
    assetId: integer("asset_id")
      .notNull()
      .references(() => asset.id, { onDelete: "restrict" }),
    convertedJobId: integer("converted_job_id").references(
      () => calibrationJob.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("calibration_request_item_request_id_idx").on(table.requestId),
    index("calibration_request_item_asset_id_idx").on(table.assetId),
    index("calibration_request_item_job_id_idx").on(table.convertedJobId),
    uniqueIndex("calibration_request_item_request_asset_uidx").on(
      table.requestId,
      table.assetId,
    ),
  ],
);

export const calibrationRequestAuditLog = pgTable(
  "calibration_request_audit_log",
  {
    id: serial("id").primaryKey(),
    requestId: integer("request_id")
      .notNull()
      .references(() => calibrationRequest.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    changes: jsonb("changes"),
    performedBy: text("performed_by")
      .notNull()
      .references(() => user.id),
    performedAt: timestamp("performed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    ipAddress: text("ip_address"),
    reason: text("reason"),
  },
  (table) => [
    index("cal_request_audit_log_request_id_idx").on(table.requestId),
    index("cal_request_audit_log_performed_at_idx").on(table.performedAt),
  ],
);

// =============================================================================
// CALIBRATION VISIT (on-site / calibração in loco)
// =============================================================================

// A scheduled on-site visit: one technician trip that can cover many
// instruments (each becomes a calibration_job linked via calibration_job.visit_id).
// The customer proposes a date on the request; the lab confirms + assigns the
// technician here. Lifecycle: PROPOSED → CONFIRMED → IN_PROGRESS → COMPLETED
// (or CANCELLED at any point).
export type VisitStatus =
  | "PROPOSED"
  | "CONFIRMED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELLED";

export const calibrationVisit = pgTable(
  "calibration_visit",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    unitId: integer("unit_id")
      .notNull()
      .references(() => organizationUnit.id, { onDelete: "restrict" }),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "restrict" }),
    sourceRequestId: integer("source_request_id").references(
      () => calibrationRequest.id,
      { onDelete: "set null" },
    ),
    technicianId: text("technician_id").references(() => user.id, {
      onDelete: "set null",
    }),
    status: text("status").$type<VisitStatus>().default("PROPOSED").notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    scheduledEndAt: timestamp("scheduled_end_at", { withTimezone: true }),
    address: jsonb("address").$type<CustomerAddress>(),
    notes: text("notes"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    confirmedBy: text("confirmed_by").references(() => user.id, {
      onDelete: "set null",
    }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    cancelledBy: text("cancelled_by").references(() => user.id, {
      onDelete: "set null",
    }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
  },
  (table) => [
    index("calibration_visit_org_idx").on(table.organizationId),
    index("calibration_visit_unit_idx").on(table.unitId),
    index("calibration_visit_customer_idx").on(table.customerId),
    index("calibration_visit_technician_idx").on(table.technicianId),
    index("calibration_visit_status_idx").on(table.status),
    index("calibration_visit_scheduled_idx").on(table.scheduledAt),
  ],
);

// =============================================================================
// CALIBRATION JOB RELATIONS
// =============================================================================

export const calibrationJobRelations = relations(
  calibrationJob,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [calibrationJob.organizationId],
      references: [organization.id],
    }),
    unit: one(organizationUnit, {
      fields: [calibrationJob.unitId],
      references: [organizationUnit.id],
    }),
    customer: one(customer, {
      fields: [calibrationJob.customerId],
      references: [customer.id],
    }),
    asset: one(asset, {
      fields: [calibrationJob.assetId],
      references: [asset.id],
    }),
    service: one(service, {
      fields: [calibrationJob.serviceId],
      references: [service.id],
    }),
    technician: one(user, {
      fields: [calibrationJob.technicianId],
      references: [user.id],
      relationName: "jobTechnician",
    }),
    createdByUser: one(user, {
      fields: [calibrationJob.createdBy],
      references: [user.id],
      relationName: "jobCreator",
    }),
    approvedByUser: one(user, {
      fields: [calibrationJob.approvedBy],
      references: [user.id],
      relationName: "jobApprover",
    }),
    rejectedByUser: one(user, {
      fields: [calibrationJob.rejectedBy],
      references: [user.id],
      relationName: "jobRejecter",
    }),
    auditLogs: many(jobAuditLog),
    certificateTemplate: one(certificateTemplate, {
      fields: [calibrationJob.certificateTemplateId],
      references: [certificateTemplate.id],
    }),
    issuedCertificateSnapshot: one(issuedCertificateSnapshot, {
      fields: [calibrationJob.id],
      references: [issuedCertificateSnapshot.jobId],
    }),
    // Amendment tracking - ISO 17025:2017 Clause 7.8.4.1
    // The job that this one supersedes (original certificate being corrected)
    supersedes: one(calibrationJob, {
      fields: [calibrationJob.supersedesId],
      references: [calibrationJob.id],
      relationName: "amendmentChain",
    }),
    // The job that superseded this one (the corrected certificate)
    supersededBy: one(calibrationJob, {
      fields: [calibrationJob.supersededById],
      references: [calibrationJob.id],
      relationName: "amendmentChainReverse",
    }),
  }),
);

export const jobAuditLogRelations = relations(jobAuditLog, ({ one }) => ({
  job: one(calibrationJob, {
    fields: [jobAuditLog.jobId],
    references: [calibrationJob.id],
  }),
  performedByUser: one(user, {
    fields: [jobAuditLog.performedBy],
    references: [user.id],
  }),
}));

export const serviceOrderRelations = relations(
  serviceOrder,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [serviceOrder.organizationId],
      references: [organization.id],
    }),
    unit: one(organizationUnit, {
      fields: [serviceOrder.unitId],
      references: [organizationUnit.id],
    }),
    customer: one(customer, {
      fields: [serviceOrder.customerId],
      references: [customer.id],
    }),
    asset: one(asset, {
      fields: [serviceOrder.assetId],
      references: [asset.id],
    }),
    openedByUser: one(user, {
      fields: [serviceOrder.openedByUserId],
      references: [user.id],
      relationName: "serviceOrderOpenedBy",
    }),
    responsibleTechnician: one(user, {
      fields: [serviceOrder.responsibleTechnicianId],
      references: [user.id],
      relationName: "serviceOrderResponsibleTechnician",
    }),
    billingDocument: one(billingDocument, {
      fields: [serviceOrder.billingDocumentId],
      references: [billingDocument.id],
    }),
    assetSnapshot: one(serviceOrderAssetSnapshot),
    intakeDocuments: many(serviceOrderIntakeDocument),
    tags: many(serviceOrderTag),
    deliveryDocuments: many(serviceOrderDeliveryDocument),
    evaluations: many(serviceOrderEvaluation),
    quotes: many(serviceOrderQuote),
    execution: one(serviceOrderExecution),
    events: many(serviceOrderEventLog),
    attachments: many(serviceOrderAttachment),
    certificateLinks: many(serviceOrderCertificateLink),
  }),
);

export const serviceOrderAssetSnapshotRelations = relations(
  serviceOrderAssetSnapshot,
  ({ one }) => ({
    serviceOrder: one(serviceOrder, {
      fields: [serviceOrderAssetSnapshot.serviceOrderId],
      references: [serviceOrder.id],
    }),
    asset: one(asset, {
      fields: [serviceOrderAssetSnapshot.assetId],
      references: [asset.id],
    }),
  }),
);

export const serviceOrderDeliveryDocumentRelations = relations(
  serviceOrderDeliveryDocument,
  ({ one }) => ({
    serviceOrder: one(serviceOrder, {
      fields: [serviceOrderDeliveryDocument.serviceOrderId],
      references: [serviceOrder.id],
    }),
    issuedByUser: one(user, {
      fields: [serviceOrderDeliveryDocument.issuedByUserId],
      references: [user.id],
    }),
  }),
);

export const serviceOrderQuoteRelations = relations(
  serviceOrderQuote,
  ({ one, many }) => ({
    serviceOrder: one(serviceOrder, {
      fields: [serviceOrderQuote.serviceOrderId],
      references: [serviceOrder.id],
    }),
    createdByUser: one(user, {
      fields: [serviceOrderQuote.createdByUserId],
      references: [user.id],
    }),
    items: many(serviceOrderQuoteItem),
  }),
);

export const serviceOrderQuoteItemRelations = relations(
  serviceOrderQuoteItem,
  ({ one }) => ({
    quote: one(serviceOrderQuote, {
      fields: [serviceOrderQuoteItem.quoteId],
      references: [serviceOrderQuote.id],
    }),
  }),
);

export const serviceOrderExecutionRelations = relations(
  serviceOrderExecution,
  ({ one, many }) => ({
    serviceOrder: one(serviceOrder, {
      fields: [serviceOrderExecution.serviceOrderId],
      references: [serviceOrder.id],
    }),
    items: many(serviceOrderExecutionItem),
  }),
);

export const serviceOrderExecutionItemRelations = relations(
  serviceOrderExecutionItem,
  ({ one }) => ({
    execution: one(serviceOrderExecution, {
      fields: [serviceOrderExecutionItem.executionId],
      references: [serviceOrderExecution.id],
    }),
    quoteItem: one(serviceOrderQuoteItem, {
      fields: [serviceOrderExecutionItem.quoteItemId],
      references: [serviceOrderQuoteItem.id],
    }),
  }),
);

export const serviceOrderEventLogRelations = relations(
  serviceOrderEventLog,
  ({ one }) => ({
    serviceOrder: one(serviceOrder, {
      fields: [serviceOrderEventLog.serviceOrderId],
      references: [serviceOrder.id],
    }),
    organization: one(organization, {
      fields: [serviceOrderEventLog.organizationId],
      references: [organization.id],
    }),
    unit: one(organizationUnit, {
      fields: [serviceOrderEventLog.unitId],
      references: [organizationUnit.id],
    }),
  }),
);

export const serviceOrderCertificateLinkRelations = relations(
  serviceOrderCertificateLink,
  ({ one }) => ({
    serviceOrder: one(serviceOrder, {
      fields: [serviceOrderCertificateLink.serviceOrderId],
      references: [serviceOrder.id],
    }),
    certificateJob: one(calibrationJob, {
      fields: [serviceOrderCertificateLink.certificateJobId],
      references: [calibrationJob.id],
    }),
  }),
);

export const calibrationRequestRelations = relations(
  calibrationRequest,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [calibrationRequest.organizationId],
      references: [organization.id],
    }),
    unit: one(organizationUnit, {
      fields: [calibrationRequest.unitId],
      references: [organizationUnit.id],
    }),
    customer: one(customer, {
      fields: [calibrationRequest.customerId],
      references: [customer.id],
    }),
    authOrganization: one(organization, {
      fields: [calibrationRequest.authOrganizationId],
      references: [organization.id],
      relationName: "calibrationRequestAuthOrganization",
    }),
    submittedByUser: one(user, {
      fields: [calibrationRequest.submittedBy],
      references: [user.id],
      relationName: "calibrationRequestSubmitter",
    }),
    reviewedByUser: one(user, {
      fields: [calibrationRequest.reviewedBy],
      references: [user.id],
      relationName: "calibrationRequestReviewer",
    }),
    approvedByUser: one(user, {
      fields: [calibrationRequest.approvedBy],
      references: [user.id],
      relationName: "calibrationRequestApprover",
    }),
    rejectedByUser: one(user, {
      fields: [calibrationRequest.rejectedBy],
      references: [user.id],
      relationName: "calibrationRequestRejecter",
    }),
    convertedByUser: one(user, {
      fields: [calibrationRequest.convertedBy],
      references: [user.id],
      relationName: "calibrationRequestConverter",
    }),
    items: many(calibrationRequestItem),
    auditLogs: many(calibrationRequestAuditLog),
  }),
);

export const organizationUnitRelations = relations(
  organizationUnit,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [organizationUnit.organizationId],
      references: [organization.id],
    }),
    createdByUser: one(user, {
      fields: [organizationUnit.createdBy],
      references: [user.id],
    }),
    memberAssignments: many(memberUnitAssignment),
    services: many(service),
    standards: many(referenceStandard),
    jobs: many(calibrationJob),
    calibrationRequests: many(calibrationRequest),
    assets: many(asset),
    eventLogs: many(organizationEventLog),
    certificateTemplateAssignments: many(certificateTemplateAssignment),
  }),
);

export const calibrationRequestItemRelations = relations(
  calibrationRequestItem,
  ({ one }) => ({
    request: one(calibrationRequest, {
      fields: [calibrationRequestItem.requestId],
      references: [calibrationRequest.id],
    }),
    assetRecord: one(asset, {
      fields: [calibrationRequestItem.assetId],
      references: [asset.id],
    }),
    convertedJob: one(calibrationJob, {
      fields: [calibrationRequestItem.convertedJobId],
      references: [calibrationJob.id],
      relationName: "requestItemConvertedJob",
    }),
  }),
);

export const calibrationRequestAuditLogRelations = relations(
  calibrationRequestAuditLog,
  ({ one }) => ({
    request: one(calibrationRequest, {
      fields: [calibrationRequestAuditLog.requestId],
      references: [calibrationRequest.id],
    }),
    performedByUser: one(user, {
      fields: [calibrationRequestAuditLog.performedBy],
      references: [user.id],
    }),
  }),
);

// =============================================================================
// ENVIRONMENTAL LIMITS - ISO 17025:2017 Clause 7.1.2
// Configurable environmental condition limits per organization/asset type
// =============================================================================

export const environmentalLimits = pgTable(
  "environmental_limits",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    unitId: integer("unit_id")
      .notNull()
      .references(() => organizationUnit.id, { onDelete: "cascade" }),
    // NULL = unit default; specific assetTypeId = override for that instrument type
    assetTypeId: integer("asset_type_id").references(() => assetType.id, {
      onDelete: "cascade",
    }),
    // Temperature limits (°C)
    temperatureMin: real("temperature_min"),
    temperatureMax: real("temperature_max"),
    // Humidity limits (%RH)
    humidityMin: real("humidity_min"),
    humidityMax: real("humidity_max"),
    // Pressure limits (hPa)
    pressureMin: real("pressure_min"),
    pressureMax: real("pressure_max"),
    // Audit
    updatedBy: text("updated_by").references(() => user.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("env_limits_organization_id_idx").on(table.organizationId),
    index("env_limits_unit_id_idx").on(table.unitId),
    unique("env_limits_org_unit_asset_type_uidx")
      .on(table.organizationId, table.unitId, table.assetTypeId)
      .nullsNotDistinct(),
  ],
);

export const environmentalLimitsRelations = relations(
  environmentalLimits,
  ({ one }) => ({
    organization: one(organization, {
      fields: [environmentalLimits.organizationId],
      references: [organization.id],
    }),
    unit: one(organizationUnit, {
      fields: [environmentalLimits.unitId],
      references: [organizationUnit.id],
    }),
    assetType: one(assetType, {
      fields: [environmentalLimits.assetTypeId],
      references: [assetType.id],
    }),
  }),
);

// =============================================================================
// SUBSCRIPTION - Organization Billing (SaaS Tiering)
// =============================================================================

/**
 * Plan identifiers - matches shared/plans.ts
 */
export type PlanId = "FREE" | "STANDARD" | "PROFESSIONAL" | "ENTERPRISE";

/**
 * Subscription status
 */
export type SubscriptionStatus = "ACTIVE" | "PAST_DUE" | "CANCELED" | "TRIAL";

/**
 * Billing cycle
 */
export type BillingCycle = "MONTHLY" | "YEARLY";

/**
 * Billing/payment status matching Asaas webhook events
 */
export type PaymentStatus =
  | "PENDING"
  | "AWAITING_RISK_ANALYSIS"
  | "CONFIRMED"
  | "RECEIVED"
  | "OVERDUE"
  | "REFUNDED"
  | "REFUND_REQUESTED"
  | "CHARGEBACK_REQUESTED"
  | "CHARGEBACK_DISPUTE"
  | "AWAITING_CHARGEBACK_REVERSAL"
  | "DUNNING_REQUESTED"
  | "DUNNING_RECEIVED"
  | "DELETED";

/**
 * Commercial billing customer mapped to provider
 */
export const billingCustomer = pgTable(
  "billing_customer",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    provider: text("provider")
      .$type<CommercialProvider>()
      .default("ASAAS")
      .notNull(),
    providerCustomerId: text("provider_customer_id").notNull().unique(),
    status: text("status")
      .$type<BillingCustomerStatus>()
      .default("ACTIVE")
      .notNull(),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    taxId: text("tax_id"),
    addressSnapshot: jsonb("address_snapshot").$type<Record<string, unknown>>(),
    providerSnapshot:
      jsonb("provider_snapshot").$type<Record<string, unknown>>(),
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("billing_customer_org_idx").on(table.organizationId),
    index("billing_customer_status_idx").on(table.status),
    uniqueIndex("billing_customer_org_provider_uidx").on(
      table.organizationId,
      table.provider,
    ),
  ],
);

/**
 * Optional billing contacts for sales-issued offers
 */
export const billingContact = pgTable(
  "billing_contact",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    role: text("role"),
    isPrimary: boolean("is_primary").default(false).notNull(),
    notes: text("notes"),
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("billing_contact_org_idx").on(table.organizationId),
    index("billing_contact_primary_idx").on(
      table.organizationId,
      table.isPrimary,
    ),
  ],
);

/**
 * Closed-won deal envelope for issued offers
 */
export const commercialDeal = pgTable(
  "commercial_deal",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    status: text("status")
      .$type<CommercialDealStatus>()
      .default("OPEN")
      .notNull(),
    primaryBillingContactId: integer("primary_billing_contact_id").references(
      () => billingContact.id,
      { onDelete: "set null" },
    ),
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
    closedBy: text("closed_by").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("commercial_deal_org_idx").on(table.organizationId),
    index("commercial_deal_status_idx").on(table.status),
  ],
);

/**
 * Immutable issued commercial offer snapshot
 */
export const commercialOffer = pgTable(
  "commercial_offer",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    dealId: text("deal_id")
      .notNull()
      .references(() => commercialDeal.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    kind: text("kind").$type<CommercialOfferKind>().notNull(),
    status: text("status")
      .$type<CommercialOfferStatus>()
      .default("DRAFT")
      .notNull(),
    provider: text("provider")
      .$type<CommercialProvider>()
      .default("ASAAS")
      .notNull(),
    providerMode: text("provider_mode")
      .$type<CommercialProviderMode>()
      .notNull(),
    activationBehavior: text("activation_behavior")
      .$type<CommercialActivationBehavior>()
      .default("NONE")
      .notNull(),
    basePlanId: text("base_plan_id").$type<PlanId>(),
    billingCycle: text("billing_cycle").$type<BillingCycle>(),
    contractTermMonths: integer("contract_term_months"),
    renewalMode: text("renewal_mode")
      .$type<CommercialRenewalMode>()
      .default("NONE")
      .notNull(),
    currency: text("currency").default("BRL").notNull(),
    subtotalAmount: integer("subtotal_amount").notNull(),
    discountAmount: integer("discount_amount").default(0).notNull(),
    totalAmount: integer("total_amount").notNull(),
    dueDate: timestamp("due_date"),
    offerExpiresAt: timestamp("offer_expires_at"),
    paymentMethods: jsonb("payment_methods")
      .$type<CommercialPaymentMethod[]>()
      .default([])
      .notNull(),
    customerVisibleDescription: text("customer_visible_description"),
    internalNotes: text("internal_notes"),
    termsSnapshot: jsonb("terms_snapshot")
      .$type<Record<string, unknown>>()
      .notNull(),
    customerSnapshot: jsonb("customer_snapshot")
      .$type<Record<string, unknown>>()
      .notNull(),
    providerRequestSnapshot: jsonb("provider_request_snapshot").$type<
      Record<string, unknown>
    >(),
    providerResponseSnapshot: jsonb("provider_response_snapshot").$type<
      Record<string, unknown>
    >(),
    checkoutUrl: text("checkout_url"),
    providerCheckoutId: text("provider_checkout_id"),
    providerPaymentId: text("provider_payment_id"),
    providerSubscriptionId: text("provider_subscription_id"),
    publicTokenHash: text("public_token_hash"),
    publicTokenIssuedAt: timestamp("public_token_issued_at"),
    publicTokenRevokedAt: timestamp("public_token_revoked_at"),
    publicViewedAt: timestamp("public_viewed_at"),
    publicLastAccessAt: timestamp("public_last_access_at"),
    customerCheckoutUrlPath: text("customer_checkout_url_path"),
    billingCustomerId: integer("billing_customer_id")
      .notNull()
      .references(() => billingCustomer.id, { onDelete: "restrict" }),
    issuedAt: timestamp("issued_at"),
    paidAt: timestamp("paid_at"),
    activatedAt: timestamp("activated_at"),
    canceledAt: timestamp("canceled_at"),
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
    canceledBy: text("canceled_by").references(() => user.id, {
      onDelete: "set null",
    }),
    reissuedFromOfferId: text("reissued_from_offer_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("commercial_offer_org_idx").on(table.organizationId),
    index("commercial_offer_deal_idx").on(table.dealId),
    index("commercial_offer_status_idx").on(table.status),
    index("commercial_offer_kind_idx").on(table.kind),
    uniqueIndex("commercial_offer_provider_checkout_uidx").on(
      table.providerCheckoutId,
    ),
    uniqueIndex("commercial_offer_provider_payment_uidx").on(
      table.providerPaymentId,
    ),
    uniqueIndex("commercial_offer_provider_subscription_uidx").on(
      table.providerSubscriptionId,
    ),
    uniqueIndex("commercial_offer_public_token_hash_uidx").on(
      table.publicTokenHash,
    ),
  ],
);

/**
 * Immutable itemized snapshot inside a commercial offer
 */
export const commercialOfferItem = pgTable(
  "commercial_offer_item",
  {
    id: serial("id").primaryKey(),
    offerId: text("offer_id")
      .notNull()
      .references(() => commercialOffer.id, { onDelete: "cascade" }),
    type: text("type").$type<CommercialOfferItemType>().notNull(),
    label: text("label").notNull(),
    description: text("description"),
    quantity: integer("quantity").default(1).notNull(),
    unitAmount: integer("unit_amount").notNull(),
    totalAmount: integer("total_amount").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("commercial_offer_item_offer_idx").on(table.offerId)],
);

/**
 * Status transition log for commercial offers
 */
export const commercialOfferStatusHistory = pgTable(
  "commercial_offer_status_history",
  {
    id: serial("id").primaryKey(),
    offerId: text("offer_id")
      .notNull()
      .references(() => commercialOffer.id, { onDelete: "cascade" }),
    fromStatus: text("from_status").$type<CommercialOfferStatus>(),
    toStatus: text("to_status").$type<CommercialOfferStatus>().notNull(),
    reason: text("reason"),
    source: text("source").$type<CommercialHistorySource>().notNull(),
    sourceEventId: text("source_event_id"),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    changedBy: text("changed_by").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("commercial_offer_history_offer_idx").on(table.offerId),
    index("commercial_offer_history_source_event_idx").on(table.sourceEventId),
  ],
);

export const commercialOfferAccessLog = pgTable(
  "commercial_offer_access_log",
  {
    id: serial("id").primaryKey(),
    offerId: text("offer_id")
      .notNull()
      .references(() => commercialOffer.id, { onDelete: "cascade" }),
    eventType: text("event_type")
      .$type<CommercialOfferAccessEventType>()
      .notNull(),
    publicState: text("public_state").$type<CommercialPublicCheckoutState>(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("commercial_offer_access_log_offer_idx").on(table.offerId),
    index("commercial_offer_access_log_event_type_idx").on(table.eventType),
    index("commercial_offer_access_log_created_at_idx").on(table.createdAt),
  ],
);

/**
 * Runtime entitlements for an organization
 */
export const subscription = pgTable(
  "subscription",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .unique()
      .references(() => organization.id, { onDelete: "cascade" }),
    planId: text("plan_id").$type<PlanId>().notNull(),
    status: text("status")
      .$type<SubscriptionStatus>()
      .default("TRIAL")
      .notNull(),
    billingCycle: text("billing_cycle").$type<BillingCycle>(),
    renewalMode: text("renewal_mode")
      .$type<CommercialRenewalMode>()
      .default("NONE")
      .notNull(),
    contractTermMonths: integer("contract_term_months"),
    sourceCommercialOfferId: text("source_commercial_offer_id").references(
      () => commercialOffer.id,
      { onDelete: "set null" },
    ),
    providerSubscriptionId: text("provider_subscription_id").unique(),
    currentPeriodStart: timestamp("current_period_start"),
    currentPeriodEnd: timestamp("current_period_end"),
    nextBillingDate: timestamp("next_billing_date"),
    canceledAt: timestamp("canceled_at"),
    cancelReason: text("cancel_reason"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("subscription_org_id_idx").on(table.organizationId),
    index("subscription_status_idx").on(table.status),
    index("subscription_provider_sub_id_idx").on(table.providerSubscriptionId),
  ],
);

/**
 * Provider payment record stored from Asaas lifecycle
 */
export const paymentRecord = pgTable(
  "payment_record",
  {
    id: serial("id").primaryKey(),
    commercialOfferId: text("commercial_offer_id")
      .notNull()
      .references(() => commercialOffer.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    provider: text("provider")
      .$type<CommercialProvider>()
      .default("ASAAS")
      .notNull(),
    providerCheckoutId: text("provider_checkout_id"),
    providerPaymentId: text("provider_payment_id"),
    providerSubscriptionId: text("provider_subscription_id"),
    externalReference: text("external_reference"),
    amount: integer("amount").notNull(),
    netAmount: integer("net_amount"),
    currency: text("currency").default("BRL").notNull(),
    paymentMethod: text("payment_method")
      .$type<CommercialPaymentMethod>()
      .notNull(),
    status: text("status").$type<PaymentStatus>().notNull(),
    cardLast4: text("card_last4"),
    cardBrand: text("card_brand"),
    dueDate: timestamp("due_date"),
    paidAt: timestamp("paid_at"),
    invoiceUrl: text("invoice_url"),
    bankSlipUrl: text("bank_slip_url"),
    pixQrCodeUrl: text("pix_qr_code_url"),
    pixPayload: text("pix_payload"),
    providerSnapshot:
      jsonb("provider_snapshot").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("payment_record_offer_idx").on(table.commercialOfferId),
    index("payment_record_org_idx").on(table.organizationId),
    index("payment_record_status_idx").on(table.status),
    uniqueIndex("payment_record_provider_payment_uidx").on(
      table.providerPaymentId,
    ),
  ],
);

/**
 * Payment status transition history
 */
export const paymentStatusHistory = pgTable(
  "payment_status_history",
  {
    id: serial("id").primaryKey(),
    paymentRecordId: integer("payment_record_id")
      .notNull()
      .references(() => paymentRecord.id, { onDelete: "cascade" }),
    commercialOfferId: text("commercial_offer_id")
      .notNull()
      .references(() => commercialOffer.id, { onDelete: "cascade" }),
    fromStatus: text("from_status").$type<PaymentStatus>(),
    toStatus: text("to_status").$type<PaymentStatus>().notNull(),
    sourceEventId: text("source_event_id"),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("payment_status_history_payment_idx").on(table.paymentRecordId),
    index("payment_status_history_offer_idx").on(table.commercialOfferId),
  ],
);

/**
 * Provider webhook event log with idempotency
 */
export const providerWebhookEvent = pgTable(
  "provider_webhook_event",
  {
    id: serial("id").primaryKey(),
    provider: text("provider")
      .$type<CommercialProvider>()
      .default("ASAAS")
      .notNull(),
    eventId: text("event_id").notNull().unique(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    processedAt: timestamp("processed_at"),
    processingError: text("processing_error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("provider_webhook_event_uidx").on(
      table.provider,
      table.eventId,
    ),
    index("provider_webhook_event_type_idx").on(table.eventType),
    index("provider_webhook_event_created_idx").on(table.createdAt),
  ],
);

// =============================================================================
// BILLING RELATIONS
// =============================================================================

export const subscriptionRelations = relations(subscription, ({ one }) => ({
  organization: one(organization, {
    fields: [subscription.organizationId],
    references: [organization.id],
  }),
  sourceOffer: one(commercialOffer, {
    fields: [subscription.sourceCommercialOfferId],
    references: [commercialOffer.id],
  }),
}));

export const billingCustomerRelations = relations(
  billingCustomer,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [billingCustomer.organizationId],
      references: [organization.id],
    }),
    offers: many(commercialOffer),
  }),
);

export const commercialDealRelations = relations(
  commercialDeal,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [commercialDeal.organizationId],
      references: [organization.id],
    }),
    primaryBillingContact: one(billingContact, {
      fields: [commercialDeal.primaryBillingContactId],
      references: [billingContact.id],
    }),
    offers: many(commercialOffer),
  }),
);

export const commercialOfferRelations = relations(
  commercialOffer,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [commercialOffer.organizationId],
      references: [organization.id],
    }),
    deal: one(commercialDeal, {
      fields: [commercialOffer.dealId],
      references: [commercialDeal.id],
    }),
    billingCustomer: one(billingCustomer, {
      fields: [commercialOffer.billingCustomerId],
      references: [billingCustomer.id],
    }),
    items: many(commercialOfferItem),
    statusHistory: many(commercialOfferStatusHistory),
    accessLogs: many(commercialOfferAccessLog),
    paymentRecords: many(paymentRecord),
  }),
);

export const paymentRecordRelations = relations(
  paymentRecord,
  ({ one, many }) => ({
    offer: one(commercialOffer, {
      fields: [paymentRecord.commercialOfferId],
      references: [commercialOffer.id],
    }),
    organization: one(organization, {
      fields: [paymentRecord.organizationId],
      references: [organization.id],
    }),
    statusHistory: many(paymentStatusHistory),
  }),
);

export const paymentStatusHistoryRelations = relations(
  paymentStatusHistory,
  ({ one }) => ({
    paymentRecord: one(paymentRecord, {
      fields: [paymentStatusHistory.paymentRecordId],
      references: [paymentRecord.id],
    }),
    offer: one(commercialOffer, {
      fields: [paymentStatusHistory.commercialOfferId],
      references: [commercialOffer.id],
    }),
  }),
);

export const commercialOfferItemRelations = relations(
  commercialOfferItem,
  ({ one }) => ({
    offer: one(commercialOffer, {
      fields: [commercialOfferItem.offerId],
      references: [commercialOffer.id],
    }),
  }),
);

export const commercialOfferStatusHistoryRelations = relations(
  commercialOfferStatusHistory,
  ({ one }) => ({
    offer: one(commercialOffer, {
      fields: [commercialOfferStatusHistory.offerId],
      references: [commercialOffer.id],
    }),
  }),
);

export const commercialOfferAccessLogRelations = relations(
  commercialOfferAccessLog,
  ({ one }) => ({
    offer: one(commercialOffer, {
      fields: [commercialOfferAccessLog.offerId],
      references: [commercialOffer.id],
    }),
  }),
);

export const billingContactRelations = relations(billingContact, ({ one }) => ({
  organization: one(organization, {
    fields: [billingContact.organizationId],
    references: [organization.id],
  }),
}));

export const paymentHistory = paymentRecord;
export const webhookEventLog = providerWebhookEvent;

export const paymentHistoryRelations = relations(paymentRecord, ({ one }) => ({
  subscription: one(subscription, {
    fields: [paymentRecord.organizationId],
    references: [subscription.organizationId],
  }),
  offer: one(commercialOffer, {
    fields: [paymentRecord.commercialOfferId],
    references: [commercialOffer.id],
  }),
  organization: one(organization, {
    fields: [paymentRecord.organizationId],
    references: [organization.id],
  }),
}));

export const webhookEventLogRelations = relations(
  providerWebhookEvent,
  () => ({}),
);

// =============================================================================
// NOTIFICATION SYSTEM - ISO 17025 Compliance Alerts & Operational Notifications
// =============================================================================

/**
 * Notification type enum - categorizes notification events
 */
export type NotificationType =
  | "JOB_SUBMITTED_FOR_REVIEW"
  | "JOB_APPROVED"
  | "JOB_REJECTED"
  | "JOB_ASSIGNED"
  | "CERTIFICATE_READY"
  | "CERTIFICATE_AMENDED" // ISO 17025 Clause 7.8.4.1 - Certificate amendment notification
  | "ASSET_DUE_FOR_RECALIBRATION"
  | "STANDARD_EXPIRING"
  | "STANDARD_EXPIRED" // ISO 17025 Clause 6.4.6 - Standard expired, jobs blocked
  | "JOB_OVERDUE"
  | "PAYMENT_RECEIVED"
  | "PAYMENT_FAILED"
  | "NC_CREATED" // ISO 17025 Clause 8.7 - New non-conformance registered
  | "NC_ESCALATED_TO_CAPA" // ISO 17025 Clause 8.7 - NC escalated to CAPA
  | "COMPETENCE_EXPIRING" // ISO 17025 Clause 6.2.3 - Competence expiring soon
  | "COMPETENCE_EXPIRED" // ISO 17025 Clause 6.2.3 - Competence expired, blocks assignment
  | "COMPETENCE_REQUESTED" // ISO 17025 Clause 6.2.3 - New qualification request
  | "COMPETENCE_APPROVED" // ISO 17025 Clause 6.2.3 - Qualification approved
  | "CUSTOMER_SUCCESS_WORKFLOW_BLOCKED"
  | "CUSTOMER_SUCCESS_GO_LIVE_AT_RISK"
  | "CUSTOMER_SUCCESS_NEXT_ACTION_OVERDUE"
  | "CUSTOMER_SUCCESS_SLA_DUE_SOON"
  | "CUSTOMER_SUCCESS_SLA_BREACHED"
  | "CUSTOMER_SUCCESS_ESCALATION_REQUIRED"
  | "SUPPORT_REQUEST_REPLIED" // Backoffice operator replied to a lab's support request
  | "CALIBRATION_REQUEST_SUBMITTED"
  | "CALIBRATION_REQUEST_UNDER_REVIEW"
  | "CALIBRATION_REQUEST_APPROVED"
  | "CALIBRATION_REQUEST_REJECTED"
  | "CALIBRATION_REQUEST_CONVERTED"
  | "VISIT_SCHEDULED" // On-site visit proposed/assigned to a technician
  | "VISIT_CONFIRMED" // On-site visit confirmed (date + technician) for the customer
  | "VISIT_RESCHEDULED" // On-site visit date changed
  | "VISIT_CANCELLED" // On-site visit cancelled
  | "VISIT_REMINDER"; // On-site visit coming up soon (scheduled reminder)

/**
 * Notification priority levels
 */
export type NotificationPriority = "HIGH" | "MEDIUM" | "LOW";

/**
 * Notification status values
 */
export type NotificationStatus = "UNREAD" | "READ" | "ARCHIVED";

/**
 * Notification delivery channel
 */
export type NotificationChannel = "IN_APP" | "EMAIL";

/**
 * Related entity reference for deep linking
 */
export type NotificationRelatedEntity = {
  entityType:
    | "job"
    | "asset"
    | "standard"
    | "payment"
    | "customer"
    | "request"
    | "visit"
    | "nc"
    | "capa"
    | "competence";
  entityId: number | string;
  jobId?: string; // Human-readable job ID for display
};

/**
 * Notification table - Stores all notifications for users.
 * Never hard-delete for ISO 17025 audit compliance - use ARCHIVED status.
 */
export const notification = pgTable(
  "notification",
  {
    id: serial("id").primaryKey(),
    recipientUserId: text("recipient_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    type: text("type").$type<NotificationType>().notNull(),
    priority: text("priority")
      .$type<NotificationPriority>()
      .default("MEDIUM")
      .notNull(),
    title: text("title").notNull(),
    message: text("message").notNull(),
    relatedEntity: jsonb("related_entity").$type<NotificationRelatedEntity>(),
    actionUrl: text("action_url"),
    channelsSent: jsonb("channels_sent")
      .$type<NotificationChannel[]>()
      .default([])
      .notNull(),
    status: text("status")
      .$type<NotificationStatus>()
      .default("UNREAD")
      .notNull(),
    readAt: timestamp("read_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at"),
  },
  (table) => [
    index("notification_recipient_user_id_idx").on(table.recipientUserId),
    index("notification_organization_id_idx").on(table.organizationId),
    index("notification_status_idx").on(table.status),
    index("notification_type_idx").on(table.type),
    index("notification_created_at_idx").on(table.createdAt),
  ],
);

/**
 * Notification preference per notification type
 */
export type NotificationPreferenceMap = {
  [K in NotificationType]?: {
    inApp: boolean;
    email: boolean;
  };
};

/**
 * Digest frequency for email notifications
 */
export type DigestFrequency = "NONE" | "DAILY" | "WEEKLY";

/**
 * Notification Preference table - User preferences for notification delivery.
 * One record per user with JSONB preferences map.
 */
export const notificationPreference = pgTable(
  "notification_preference",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => user.id, { onDelete: "cascade" }),
    preferences: jsonb("preferences")
      .$type<NotificationPreferenceMap>()
      .notNull(),
    emailEnabled: boolean("email_enabled").default(true).notNull(),
    notifySelfActions: boolean("notify_self_actions").default(false).notNull(),
    digestFrequency: text("digest_frequency")
      .$type<DigestFrequency>()
      .default("NONE")
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("notification_preference_user_id_uidx").on(table.userId),
  ],
);

/**
 * Scheduled notification entity type
 */
export type ScheduledNotificationEntityType =
  | "asset"
  | "standard"
  | "job"
  | "competence"
  | "visit";

/**
 * Scheduled Notification table - Tracks scheduled compliance alerts.
 * Prevents duplicate alerts by using unique constraint on entity + type + lead time.
 */
export const scheduledNotification = pgTable(
  "scheduled_notification",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    type: text("type").$type<NotificationType>().notNull(),
    entityType: text("entity_type")
      .$type<ScheduledNotificationEntityType>()
      .notNull(),
    entityId: integer("entity_id").notNull(),
    scheduledFor: timestamp("scheduled_for").notNull(),
    leadTimeDays: integer("lead_time_days").default(7).notNull(),
    sentAt: timestamp("sent_at"),
    canceled: boolean("canceled").default(false).notNull(),
    canceledReason: text("canceled_reason"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("scheduled_notification_organization_id_idx").on(
      table.organizationId,
    ),
    index("scheduled_notification_scheduled_for_idx").on(table.scheduledFor),
    index("scheduled_notification_entity_idx").on(
      table.entityType,
      table.entityId,
    ),
    uniqueIndex("scheduled_notification_unique_idx").on(
      table.organizationId,
      table.type,
      table.entityType,
      table.entityId,
      table.leadTimeDays,
    ),
  ],
);

// =============================================================================
// NOTIFICATION RELATIONS
// =============================================================================

export const notificationRelations = relations(notification, ({ one }) => ({
  recipient: one(user, {
    fields: [notification.recipientUserId],
    references: [user.id],
  }),
  organization: one(organization, {
    fields: [notification.organizationId],
    references: [organization.id],
  }),
}));

export const notificationPreferenceRelations = relations(
  notificationPreference,
  ({ one }) => ({
    user: one(user, {
      fields: [notificationPreference.userId],
      references: [user.id],
    }),
  }),
);

export const scheduledNotificationRelations = relations(
  scheduledNotification,
  ({ one }) => ({
    organization: one(organization, {
      fields: [scheduledNotification.organizationId],
      references: [organization.id],
    }),
  }),
);

// =============================================================================
// APP QUEUE JOBS - Postgres-backed background queue
// =============================================================================

export type AppQueueJobType =
  | "CERTIFICATE"
  | "LABEL"
  | "SERVICE_ORDER_INTAKE_DOCUMENT"
  | "SERVICE_ORDER_TAG"
  | "SERVICE_ORDER_QUOTE"
  | "SERVICE_ORDER_DELIVERY_RECEIPT"
  | "INTEGRATION_SYNC"
  | "CERTIFICATE_XLSX_PREVIEW";

export type AppQueueJobStatus =
  | "PENDING"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED";

export const appQueueJob = pgTable(
  "app_queue_job",
  {
    id: serial("id").primaryKey(),
    type: text("type").$type<AppQueueJobType>().notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status")
      .$type<AppQueueJobStatus>()
      .default("PENDING")
      .notNull(),
    attempts: integer("attempts").default(0).notNull(),
    maxAttempts: integer("max_attempts").default(3).notNull(),
    availableAt: timestamp("available_at").defaultNow().notNull(),
    lockedBy: text("locked_by"),
    lockedAt: timestamp("locked_at"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("app_queue_job_status_available_idx").on(
      table.status,
      table.availableAt,
    ),
    index("app_queue_job_locked_at_idx").on(table.lockedAt),
    index("app_queue_job_type_idx").on(table.type),
  ],
);

// =============================================================================
// ORGANIZATION SIGNING CERTIFICATE - ICP-Brasil Digital Signature (ISO 7.8.2.1)
// =============================================================================

/**
 * Stores ICP-Brasil A1 certificates (PKCS#12) per organization.
 * Password is encrypted with AES-256-GCM using a master key from Cloudflare secrets.
 * Enables PDF signing for calibration certificates per NIT-DICLA-083 requirements.
 */
export const organizationSigningCertificate = pgTable(
  "organization_signing_certificate",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    unitId: integer("unit_id")
      .notNull()
      .references(() => organizationUnit.id, { onDelete: "cascade" }),
    // Certificate identification
    name: text("name").notNull(), // Display name, e.g., "Certificado Principal"
    serialNumber: text("serial_number").notNull(), // Certificate serial from ICP-Brasil
    issuerCn: text("issuer_cn").notNull(), // e.g., "AC SOLUTI Multipla v5"
    subjectCn: text("subject_cn").notNull(), // Company name from certificate
    subjectCpfCnpj: text("subject_cpf_cnpj"), // CPF/CNPJ extracted from certificate
    // Validity period
    validFrom: timestamp("valid_from").notNull(),
    validUntil: timestamp("valid_until").notNull(),
    // Encrypted storage
    encryptedP12: text("encrypted_p12").notNull(), // AES-256-GCM encrypted PKCS#12 blob (enc:v1)
    encryptedPassword: text("encrypted_password").notNull(), // AES-256-GCM encrypted
    passwordIv: text("password_iv").notNull(), // IV for AES decryption
    // Status
    isActive: boolean("is_active").default(true).notNull(),
    isDefault: boolean("is_default").default(false).notNull(),
    // Audit trail
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    revokedAt: timestamp("revoked_at"),
    revokedBy: text("revoked_by").references(() => user.id),
    revokedReason: text("revoked_reason"),
  },
  (table) => [
    index("org_signing_cert_org_id_idx").on(table.organizationId),
    index("org_signing_cert_unit_id_idx").on(table.unitId),
    index("org_signing_cert_valid_until_idx").on(table.validUntil),
    index("org_signing_cert_is_default_idx").on(
      table.organizationId,
      table.unitId,
      table.isDefault,
    ),
  ],
);

export const organizationSigningCertificateRelations = relations(
  organizationSigningCertificate,
  ({ one }) => ({
    organization: one(organization, {
      fields: [organizationSigningCertificate.organizationId],
      references: [organization.id],
    }),
    unit: one(organizationUnit, {
      fields: [organizationSigningCertificate.unitId],
      references: [organizationUnit.id],
    }),
    createdByUser: one(user, {
      fields: [organizationSigningCertificate.createdBy],
      references: [user.id],
      relationName: "signingCertCreator",
    }),
    revokedByUser: one(user, {
      fields: [organizationSigningCertificate.revokedBy],
      references: [user.id],
      relationName: "signingCertRevoker",
    }),
  }),
);

// =============================================================================
// MEMBER VISUAL SIGNATURE - Handwritten signature images
// =============================================================================

/**
 * Stores handwritten signature images for organization members.
 * Images are stored in a private R2 bucket and accessed via presigned URLs.
 * Used to display visual signatures on calibration certificates.
 */
export const memberVisualSignature = pgTable(
  "member_visual_signature",
  {
    id: serial("id").primaryKey(),
    memberId: text("member_id")
      .notNull()
      .references(() => member.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // Storage location
    r2Key: text("r2_key").notNull(), // "signatures/{org_id}/{member_id}.png"
    contentType: text("content_type").notNull(), // "image/png"
    // Image dimensions
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    fileSize: integer("file_size").notNull(), // In bytes
    // Timestamps
    uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("member_visual_sig_org_id_idx").on(table.organizationId),
    uniqueIndex("member_visual_sig_unique_idx").on(
      table.memberId,
      table.organizationId,
    ),
  ],
);

export const memberVisualSignatureRelations = relations(
  memberVisualSignature,
  ({ one }) => ({
    member: one(member, {
      fields: [memberVisualSignature.memberId],
      references: [member.id],
    }),
    organization: one(organization, {
      fields: [memberVisualSignature.organizationId],
      references: [organization.id],
    }),
  }),
);

// =============================================================================
// CORRECTIVE ACTION (CAPA) - ISO 17025:2017 Clause 8.2 / 8.7 / 8.9
// =============================================================================

/**
 * CAPA status values for lifecycle tracking
 */
export type CorrectiveActionStatus =
  | "OPEN"
  | "INVESTIGATION"
  | "IMPLEMENTATION"
  | "VERIFICATION"
  | "CLOSED";

/**
 * CAPA source - where the CAPA originated from
 */
export type CorrectiveActionSource =
  | "internal_audit"
  | "customer_complaint"
  | "nc_detection"
  | "external_audit"
  | "management_review";

/**
 * CAPA type - corrective vs preventive
 */
export type CorrectiveActionType = "corrective" | "preventive";

/**
 * CAPA severity classification
 */
export type CorrectiveActionSeverity = "minor" | "major" | "critical";

/**
 * CAPA category - affected area
 */
export type CorrectiveActionCategory =
  | "method"
  | "equipment"
  | "personnel"
  | "procedure"
  | "environment"
  | "other";

/**
 * Root cause analysis method used
 */
export type RootCauseAnalysisMethod =
  | "5_whys"
  | "fishbone"
  | "pareto"
  | "other";

/**
 * Corrective Action table - Root Cause Analysis & Corrective/Preventive Actions
 * ISO 17025:2017 Clause 8.2 (Corrective Actions) / Clause 8.7 / Clause 8.9 (Improvement)
 *
 * Key concepts:
 * - Can be linked to one or more Non-Conformances (nc_detection source)
 * - Can also originate from audits, complaints, or management reviews
 * - Tracks root cause analysis, corrective action plan, and effectiveness verification
 * - Requires approval from technical manager for closure
 */
export const correctiveAction = pgTable(
  "corrective_action",
  {
    id: serial("id").primaryKey(),
    capaNumber: text("capa_number").notNull().unique(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    // Source
    source: text("source")
      .$type<CorrectiveActionSource>()
      .default("nc_detection")
      .notNull(),
    sourceReference: text("source_reference"), // Job ID, complaint ID, NC number, etc.

    // Description
    title: text("title").notNull().default(""),
    description: text("description").notNull().default(""),
    detectionDate: timestamp("detection_date"),

    // Classification
    type: text("type")
      .$type<CorrectiveActionType>()
      .default("corrective")
      .notNull(),
    severity: text("severity")
      .$type<CorrectiveActionSeverity>()
      .default("minor")
      .notNull(),
    category: text("category")
      .$type<CorrectiveActionCategory>()
      .default("procedure")
      .notNull(),

    // Root cause analysis
    rootCauseAnalysis: text("root_cause_analysis"),
    rootCauseAnalysisMethod:
      text("rca_method").$type<RootCauseAnalysisMethod>(),

    // Corrective action plan
    actionPlan: text("action_plan"),
    // Preventive measures
    preventiveMeasures: text("preventive_measures"),

    // Responsible person
    responsibleId: text("responsible_id").references(() => user.id),
    // Target date for completion
    dueDate: timestamp("due_date"),

    // Implementation tracking
    implementationEvidence: text("implementation_evidence"),
    implementedAt: timestamp("implemented_at"),

    // Investigation
    investigationCompletedAt: timestamp("investigation_completed_at"),

    // Effectiveness verification
    verifiedAt: timestamp("verified_at"),
    verifiedBy: text("verified_by").references(() => user.id),
    verificationNotes: text("verification_notes"),
    effectivenessConfirmed: boolean("effectiveness_confirmed"),

    // Status tracking
    status: text("status")
      .$type<CorrectiveActionStatus>()
      .default("OPEN")
      .notNull(),

    // Closure
    closedAt: timestamp("closed_at"),
    closedBy: text("closed_by").references(() => user.id),

    // Audit
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("capa_organization_id_idx").on(table.organizationId),
    index("capa_status_idx").on(table.status),
    index("capa_responsible_id_idx").on(table.responsibleId),
    index("capa_severity_idx").on(table.severity),
    index("capa_category_idx").on(table.category),
    index("capa_source_idx").on(table.source),
    uniqueIndex("capa_number_uidx").on(table.capaNumber),
  ],
);

// =============================================================================
// CORRECTIVE ACTION AUDIT LOG - ISO 17025:2017 Clause 8.4 (Control of records)
// =============================================================================

/**
 * Audit log for CAPA changes.
 * Tracks all modifications for compliance and traceability.
 */
export const correctiveActionAuditLog = pgTable(
  "corrective_action_audit_log",
  {
    id: serial("id").primaryKey(),
    capaId: integer("capa_id")
      .notNull()
      .references(() => correctiveAction.id, { onDelete: "cascade" }),
    action: text("action").notNull(), // 'create', 'update', 'investigate', 'implement', 'verify', 'close'
    changes: jsonb("changes"),
    performedBy: text("performed_by")
      .notNull()
      .references(() => user.id),
    performedAt: timestamp("performed_at").defaultNow().notNull(),
    ipAddress: text("ip_address"),
    reason: text("reason"),
  },
  (table) => [
    index("capa_audit_log_capa_id_idx").on(table.capaId),
    index("capa_audit_log_performed_at_idx").on(table.performedAt),
  ],
);

// =============================================================================
// NON-CONFORMANCE - ISO 17025:2017 Clause 8.7 (Control of Nonconforming Work)
// =============================================================================

/**
 * NC type values
 */
export type NonConformanceType = "work" | "equipment" | "documentation";

/**
 * NC disposition values
 */
export type NonConformanceDisposition =
  | "rework"
  | "scrap"
  | "use_as_is"
  | "concession";

/**
 * NC status values
 */
export type NonConformanceStatus = "open" | "under_review" | "resolved";

/**
 * Non-Conformance table - ISO 17025:2017 Clause 8.7
 * Tracks nonconforming work, equipment issues, and documentation errors.
 *
 * Key concepts:
 * - Linked optionally to a calibration job
 * - Requires disposition decision (rework, scrap, use as is, concession)
 * - "use_as_is" and "concession" require technical manager approval
 * - Can be escalated to CAPA for root cause analysis
 */
export const nonConformance = pgTable(
  "non_conformance",
  {
    id: serial("id").primaryKey(),
    ncNumber: text("nc_number").notNull().unique(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // Optional link to calibration job
    jobId: integer("job_id").references(() => calibrationJob.id),
    // NC classification
    type: text("type").$type<NonConformanceType>().notNull(),
    description: text("description").notNull(),
    // Detection
    detectedBy: text("detected_by")
      .notNull()
      .references(() => user.id),
    detectedAt: timestamp("detected_at").notNull(),
    // Disposition
    disposition: text("disposition").$type<NonConformanceDisposition>(),
    dispositionJustification: text("disposition_justification"),
    dispositionApprovedBy: text("disposition_approved_by").references(
      () => user.id,
    ),
    dispositionApprovedAt: timestamp("disposition_approved_at"),
    // Resolution
    correctionTaken: text("correction_taken"),
    resolvedAt: timestamp("resolved_at"),
    resolvedBy: text("resolved_by").references(() => user.id),
    // Status
    status: text("status")
      .$type<NonConformanceStatus>()
      .default("open")
      .notNull(),
    // Link to CAPA (if escalated)
    capaId: integer("capa_id").references(() => correctiveAction.id),
    // Audit
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("nc_organization_id_idx").on(table.organizationId),
    index("nc_job_id_idx").on(table.jobId),
    index("nc_status_idx").on(table.status),
    index("nc_type_idx").on(table.type),
    index("nc_detected_at_idx").on(table.detectedAt),
    index("nc_capa_id_idx").on(table.capaId),
    uniqueIndex("nc_number_uidx").on(table.ncNumber),
  ],
);

// =============================================================================
// NON-CONFORMANCE AUDIT LOG - ISO 17025:2017 Clause 8.4 (Control of records)
// =============================================================================

/**
 * Audit log for non-conformance changes.
 * Tracks all modifications for compliance and traceability.
 */
export const nonConformanceAuditLog = pgTable(
  "non_conformance_audit_log",
  {
    id: serial("id").primaryKey(),
    ncId: integer("nc_id")
      .notNull()
      .references(() => nonConformance.id, { onDelete: "cascade" }),
    action: text("action").notNull(), // 'create', 'update', 'disposition', 'resolve', 'escalate_to_capa'
    changes: jsonb("changes"),
    performedBy: text("performed_by")
      .notNull()
      .references(() => user.id),
    performedAt: timestamp("performed_at").defaultNow().notNull(),
    ipAddress: text("ip_address"),
    reason: text("reason"),
  },
  (table) => [
    index("nc_audit_log_nc_id_idx").on(table.ncId),
    index("nc_audit_log_performed_at_idx").on(table.performedAt),
  ],
);

// =============================================================================
// NON-CONFORMANCE & CAPA RELATIONS
// =============================================================================

export const correctiveActionRelations = relations(
  correctiveAction,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [correctiveAction.organizationId],
      references: [organization.id],
    }),
    responsible: one(user, {
      fields: [correctiveAction.responsibleId],
      references: [user.id],
      relationName: "capaResponsible",
    }),
    verifiedByUser: one(user, {
      fields: [correctiveAction.verifiedBy],
      references: [user.id],
      relationName: "capaVerifier",
    }),
    closedByUser: one(user, {
      fields: [correctiveAction.closedBy],
      references: [user.id],
      relationName: "capaCloser",
    }),
    createdByUser: one(user, {
      fields: [correctiveAction.createdBy],
      references: [user.id],
      relationName: "capaCreator",
    }),
    nonConformances: many(nonConformance),
    auditLogs: many(correctiveActionAuditLog),
  }),
);

export const correctiveActionAuditLogRelations = relations(
  correctiveActionAuditLog,
  ({ one }) => ({
    correctiveAction: one(correctiveAction, {
      fields: [correctiveActionAuditLog.capaId],
      references: [correctiveAction.id],
    }),
    performedByUser: one(user, {
      fields: [correctiveActionAuditLog.performedBy],
      references: [user.id],
    }),
  }),
);

export const nonConformanceRelations = relations(
  nonConformance,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [nonConformance.organizationId],
      references: [organization.id],
    }),
    job: one(calibrationJob, {
      fields: [nonConformance.jobId],
      references: [calibrationJob.id],
    }),
    detectedByUser: one(user, {
      fields: [nonConformance.detectedBy],
      references: [user.id],
      relationName: "ncDetector",
    }),
    dispositionApprovedByUser: one(user, {
      fields: [nonConformance.dispositionApprovedBy],
      references: [user.id],
      relationName: "ncDispositionApprover",
    }),
    resolvedByUser: one(user, {
      fields: [nonConformance.resolvedBy],
      references: [user.id],
      relationName: "ncResolver",
    }),
    capa: one(correctiveAction, {
      fields: [nonConformance.capaId],
      references: [correctiveAction.id],
    }),
    createdByUser: one(user, {
      fields: [nonConformance.createdBy],
      references: [user.id],
      relationName: "ncCreator",
    }),
    auditLogs: many(nonConformanceAuditLog),
  }),
);

export const nonConformanceAuditLogRelations = relations(
  nonConformanceAuditLog,
  ({ one }) => ({
    nonConformance: one(nonConformance, {
      fields: [nonConformanceAuditLog.ncId],
      references: [nonConformance.id],
    }),
    performedByUser: one(user, {
      fields: [nonConformanceAuditLog.performedBy],
      references: [user.id],
    }),
  }),
);

// =============================================================================
// PERSONNEL COMPETENCE - ISO 17025:2017 Clause 6.2.3 (Personnel Competence)
// =============================================================================

/**
 * Competence workflow status values
 */
export type CompetenceStatus =
  | "REQUESTED"
  | "TRAINING_ASSIGNED"
  | "IN_TRAINING"
  | "PENDING_EVALUATION"
  | "ACTIVE"
  | "SUSPENDED"
  | "EXPIRED"
  | "CANCELLED";

/**
 * Training type values
 */
export type TrainingType = "internal" | "external" | "ojt" | "proficiency_test";

/**
 * Training status values
 */
export type TrainingStatus = "planned" | "in_progress" | "completed" | "failed";

/**
 * Personnel Competence table - Tracks technician qualifications per asset type
 * ISO 17025:2017 Clause 6.2.3 - Personnel competence requirements
 *
 * Key concepts:
 * - Tracks qualifications per user per asset type
 * - Full workflow: REQUESTED → TRAINING_ASSIGNED → IN_TRAINING → PENDING_EVALUATION → ACTIVE
 * - Auto-detect enforcement: skip if org has zero records, enforce once populated
 * - Supports expiration and renewal
 * - Supports cancellation before activation when qualification should not proceed
 */
export const personnelCompetence = pgTable(
  "personnel_competence",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    assetTypeId: integer("asset_type_id").references(() => assetType.id, {
      onDelete: "set null",
    }),
    scopeDescription: text("scope_description").notNull(),
    status: text("status")
      .$type<CompetenceStatus>()
      .default("REQUESTED")
      .notNull(),
    qualifiedAt: timestamp("qualified_at"),
    expiresAt: timestamp("expires_at"),
    certificateR2Key: text("certificate_r2_key"),
    certificateFileName: text("certificate_file_name"),
    notes: text("notes"),
    requestedBy: text("requested_by")
      .notNull()
      .references(() => user.id),
    evaluatedBy: text("evaluated_by").references(() => user.id),
    approvedBy: text("approved_by").references(() => user.id),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    deletedAt: timestamp("deleted_at"),
  },
  (table) => [
    index("competence_organization_id_idx").on(table.organizationId),
    index("competence_user_id_idx").on(table.userId),
    index("competence_asset_type_id_idx").on(table.assetTypeId),
    index("competence_status_idx").on(table.status),
    index("competence_expires_at_idx").on(table.expiresAt),
    unique("competence_org_user_asset_type_uidx")
      .on(table.organizationId, table.userId, table.assetTypeId)
      .nullsNotDistinct(),
  ],
);

// =============================================================================
// TRAINING RECORD - ISO 17025:2017 Clause 6.2.3 (Training Evidence)
// =============================================================================

/**
 * Training Record table - Stores training history for personnel
 * Links to personnel competence for qualification tracking
 */
export const trainingRecord = pgTable(
  "training_record",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    competenceId: integer("competence_id").references(
      () => personnelCompetence.id,
      { onDelete: "set null" },
    ),
    title: text("title").notNull(),
    type: text("type").$type<TrainingType>().notNull(),
    status: text("status").$type<TrainingStatus>().default("planned").notNull(),
    provider: text("provider"),
    description: text("description"),
    startDate: timestamp("start_date").notNull(),
    endDate: timestamp("end_date"),
    hoursCompleted: integer("hours_completed"),
    certificateR2Key: text("certificate_r2_key"),
    certificateFileName: text("certificate_file_name"),
    score: real("score"),
    passingScore: real("passing_score"),
    passed: boolean("passed"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    deletedAt: timestamp("deleted_at"),
  },
  (table) => [
    index("training_organization_id_idx").on(table.organizationId),
    index("training_user_id_idx").on(table.userId),
    index("training_competence_id_idx").on(table.competenceId),
    index("training_status_idx").on(table.status),
    index("training_start_date_idx").on(table.startDate),
  ],
);

// =============================================================================
// PERSONNEL COMPETENCE AUDIT LOG - ISO 17025:2017 Clause 8.4
// =============================================================================

export const personnelCompetenceAuditLog = pgTable(
  "personnel_competence_audit_log",
  {
    id: serial("id").primaryKey(),
    competenceId: integer("competence_id")
      .notNull()
      .references(() => personnelCompetence.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    changes: jsonb("changes"),
    performedBy: text("performed_by").notNull(),
    performedAt: timestamp("performed_at").defaultNow().notNull(),
    ipAddress: text("ip_address"),
    reason: text("reason"),
  },
  (table) => [
    index("competence_audit_log_competence_id_idx").on(table.competenceId),
    index("competence_audit_log_performed_at_idx").on(table.performedAt),
  ],
);

// =============================================================================
// TRAINING RECORD AUDIT LOG - ISO 17025:2017 Clause 8.4
// =============================================================================

export const trainingRecordAuditLog = pgTable(
  "training_record_audit_log",
  {
    id: serial("id").primaryKey(),
    trainingRecordId: integer("training_record_id")
      .notNull()
      .references(() => trainingRecord.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    changes: jsonb("changes"),
    performedBy: text("performed_by").notNull(),
    performedAt: timestamp("performed_at").defaultNow().notNull(),
    ipAddress: text("ip_address"),
    reason: text("reason"),
  },
  (table) => [
    index("training_audit_log_training_id_idx").on(table.trainingRecordId),
    index("training_audit_log_performed_at_idx").on(table.performedAt),
  ],
);

// =============================================================================
// AUTHORIZED SIGNATORY - ISO 17025:2017 Clause 6.2.6 (Authorization of personnel)
// =============================================================================

/**
 * Signatory authorization status.
 */
export type SignatoryAuthorizationStatus =
  | "ACTIVE"
  | "SUSPENDED"
  | "REVOKED"
  | "EXPIRED";

/**
 * Authorized Signatory table - who may APPROVE / sign off calibration
 * certificates, optionally scoped per asset type. ISO/IEC 17025:2017 Clause 6.2.6
 * (authorization of personnel for specific lab activities, incl. issuing
 * calibration reports).
 *
 * Distinct from `personnel_competence` (which authorizes who may EXECUTE a
 * calibration): a quality/technical manager is commonly an authorized signatory
 * across scopes without holding per-asset-type execution competence.
 *
 * - assetTypeId NULL = authorized to sign across ALL scopes (org-wide signatory).
 * - Auto-detect enforcement: skip if the org has zero records, enforce once populated.
 */
export const authorizedSignatory = pgTable(
  "authorized_signatory",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    assetTypeId: integer("asset_type_id").references(() => assetType.id, {
      onDelete: "set null",
    }),
    scopeDescription: text("scope_description"),
    status: text("status")
      .$type<SignatoryAuthorizationStatus>()
      .default("ACTIVE")
      .notNull(),
    authorizedBy: text("authorized_by")
      .notNull()
      .references(() => user.id),
    authorizedAt: timestamp("authorized_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at"),
    revokedBy: text("revoked_by").references(() => user.id),
    revokedAt: timestamp("revoked_at"),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    deletedAt: timestamp("deleted_at"),
  },
  (table) => [
    index("authorized_signatory_organization_id_idx").on(table.organizationId),
    index("authorized_signatory_user_id_idx").on(table.userId),
    index("authorized_signatory_asset_type_id_idx").on(table.assetTypeId),
    index("authorized_signatory_status_idx").on(table.status),
    index("authorized_signatory_expires_at_idx").on(table.expiresAt),
    unique("authorized_signatory_org_user_asset_type_uidx")
      .on(table.organizationId, table.userId, table.assetTypeId)
      .nullsNotDistinct(),
  ],
);

// =============================================================================
// AUTHORIZED SIGNATORY AUDIT LOG - ISO 17025:2017 Clause 8.4
// =============================================================================

export const authorizedSignatoryAuditLog = pgTable(
  "authorized_signatory_audit_log",
  {
    id: serial("id").primaryKey(),
    signatoryId: integer("signatory_id")
      .notNull()
      .references(() => authorizedSignatory.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    changes: jsonb("changes"),
    performedBy: text("performed_by").notNull(),
    performedAt: timestamp("performed_at").defaultNow().notNull(),
    ipAddress: text("ip_address"),
    reason: text("reason"),
  },
  (table) => [
    index("authorized_signatory_audit_log_signatory_id_idx").on(
      table.signatoryId,
    ),
    index("authorized_signatory_audit_log_performed_at_idx").on(
      table.performedAt,
    ),
  ],
);

// =============================================================================
// PERSONNEL COMPETENCE & TRAINING RELATIONS
// =============================================================================

export const personnelCompetenceRelations = relations(
  personnelCompetence,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [personnelCompetence.organizationId],
      references: [organization.id],
    }),
    user: one(user, {
      fields: [personnelCompetence.userId],
      references: [user.id],
      relationName: "competenceUser",
    }),
    assetType: one(assetType, {
      fields: [personnelCompetence.assetTypeId],
      references: [assetType.id],
    }),
    requestedByUser: one(user, {
      fields: [personnelCompetence.requestedBy],
      references: [user.id],
      relationName: "competenceRequester",
    }),
    evaluatedByUser: one(user, {
      fields: [personnelCompetence.evaluatedBy],
      references: [user.id],
      relationName: "competenceEvaluator",
    }),
    approvedByUser: one(user, {
      fields: [personnelCompetence.approvedBy],
      references: [user.id],
      relationName: "competenceApprover",
    }),
    createdByUser: one(user, {
      fields: [personnelCompetence.createdBy],
      references: [user.id],
      relationName: "competenceCreator",
    }),
    trainingRecords: many(trainingRecord),
    auditLogs: many(personnelCompetenceAuditLog),
  }),
);

export const trainingRecordRelations = relations(
  trainingRecord,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [trainingRecord.organizationId],
      references: [organization.id],
    }),
    user: one(user, {
      fields: [trainingRecord.userId],
      references: [user.id],
      relationName: "trainingUser",
    }),
    competence: one(personnelCompetence, {
      fields: [trainingRecord.competenceId],
      references: [personnelCompetence.id],
    }),
    createdByUser: one(user, {
      fields: [trainingRecord.createdBy],
      references: [user.id],
      relationName: "trainingCreator",
    }),
    auditLogs: many(trainingRecordAuditLog),
  }),
);

export const personnelCompetenceAuditLogRelations = relations(
  personnelCompetenceAuditLog,
  ({ one }) => ({
    competence: one(personnelCompetence, {
      fields: [personnelCompetenceAuditLog.competenceId],
      references: [personnelCompetence.id],
    }),
    performedByUser: one(user, {
      fields: [personnelCompetenceAuditLog.performedBy],
      references: [user.id],
    }),
  }),
);

export const trainingRecordAuditLogRelations = relations(
  trainingRecordAuditLog,
  ({ one }) => ({
    trainingRecord: one(trainingRecord, {
      fields: [trainingRecordAuditLog.trainingRecordId],
      references: [trainingRecord.id],
    }),
    performedByUser: one(user, {
      fields: [trainingRecordAuditLog.performedBy],
      references: [user.id],
    }),
  }),
);
