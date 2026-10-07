import { relations, sql } from "drizzle-orm";
import type { MethodMeasurementModel } from "@calibra-facil/schemas";
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
  BillingDocumentExportStatus,
  BillingDocumentStatus,
  CommercialAgreementStatus,
  FinancialPaymentMethod,
  FinancialErpConnectionConfig,
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
  PublicApiResourceType,
  PublicApiWebhookDeliveryStatus,
  PublicApiWebhookEvent,
  PublicApiWebhookSubscriptionStatus,
  ReceivableInstallmentStatus,
  CertificateReleaseStatus,
  CertificateReleasePolicyMode,
  CertificateReleaseAuditSource,
  CertificateReleasePaymentStateSnapshot,
  AutomaticSendMilestone,
  AutomaticSendOutcome,
  SupplierKind,
  BillingGroupStatus,
  CmcExpressionType,
  MeasurementUnit,
  QuantityKind,
  ScopeComplianceFinding,
  ScopeComplianceStatus,
  ScopeEnforcementMode,
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

/** Tenant lifecycle state, set by the instance operator. */
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
    // Tenant lifecycle (suspend / offboard), set by the instance operator.
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
    // #647: vigência window. The seal only renders when the emission date
    // falls inside [validFrom, validUntil]; null bounds impose no constraint.
    accreditationValidFrom: timestamp("accreditation_valid_from"),
    accreditationValidUntil: timestamp("accreditation_valid_until"),
    // #427 Phase 1: accredited-scope (CMC) guard behavior. 'warn' keeps the
    // Phase 0 classification-only behavior; 'enforce' blocks accredited
    // approval on scope violations unless a documented override downgrades
    // the issuance to non-accredited (seal suppressed).
    scopeEnforcementMode: text("scope_enforcement_mode")
      .$type<ScopeEnforcementMode>()
      .default("warn")
      .notNull(),
    // Legal-metrology repair authorization (RBMLQ-I "oficina permissionária").
    // Distinct from the RBC/CGCRE accreditation above: required on repair OS
    // documents for instruments subject to legal metrology (Port. Inmetro 65/2015),
    // and carried on the permissionária's own seals. Stored as number + UF (sigla
    // do estado); the documents layer composes them as "<number>/<UF>".
    permissionariaAuthorizationNumber: text(
      "permissionaria_authorization_number",
    ),
    permissionariaAuthorizationState: text(
      "permissionaria_authorization_state",
    ),
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
    /**
     * #644 (CMP-01): when true, certificate emission REQUIRES an active signing
     * certificate — a missing cert fails the job (REJECTED) instead of emitting
     * unsigned. Signing FAILURES always fail regardless of this flag.
     */
    requireSignature: boolean("require_signature").default(false).notNull(),
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

/** BYOK now; "managed" is the future shared-platform-account mode (#584). */
export type OrganizationEmailDomainMode = "byok" | "managed";

/** Mirrors Resend's domain status vocabulary. */
export type OrganizationEmailDomainStatus =
  | "pending"
  | "verified"
  | "failed"
  | "not_started"
  | "partially_verified"
  | "partially_failed";

export type OrganizationEmailDomainKeyStatus =
  | "ok"
  | "invalid"
  | "rate_limited";

/**
 * Lab-owned email sending domain (issue #584). One per lab org. The lab brings
 * its own Resend account (BYOK): the API key is stored AES-256-GCM encrypted
 * (EMAIL_DOMAIN_MASTER_KEY, never the signing key) and must never be returned
 * by any API response — only `resendApiKeyLast4` is exposed for masking.
 */
export const organizationEmailDomain = pgTable(
  "organization_email_domain",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    mode: text("mode")
      .$type<OrganizationEmailDomainMode>()
      .default("managed")
      .notNull(),
    hostname: text("hostname").notNull(),
    resendDomainId: text("resend_domain_id").notNull(),
    // Null in `managed` mode: the domain lives in our own Resend account, so
    // the laboratory never holds a key and there is nothing to encrypt. A CHECK
    // constraint (migration 0110) keeps the two modes from drifting apart.
    resendApiKeyEncrypted: text("resend_api_key_encrypted"),
    resendApiKeyIv: text("resend_api_key_iv"),
    resendApiKeyLast4: text("resend_api_key_last4"),
    fromAddress: text("from_address").notNull(),
    /** Snapshot of Resend's generated DKIM/SPF rows (diagnostics only). */
    dnsRecords: jsonb("dns_records").$type<Record<string, unknown>[]>(),
    status: text("status")
      .$type<OrganizationEmailDomainStatus>()
      .default("pending")
      .notNull(),
    verifiedAt: timestamp("verified_at"),
    lastVerifiedAt: timestamp("last_verified_at"),
    activatedAt: timestamp("activated_at"),
    isActive: boolean("is_active").default(false).notNull(),
    keyStatus: text("key_status")
      .$type<OrganizationEmailDomainKeyStatus>()
      .default("ok")
      .notNull(),
    keyLastError: text("key_last_error"),
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
    uniqueIndex("org_email_domain_org_uidx").on(table.organizationId),
    uniqueIndex("org_email_domain_hostname_uidx").on(table.hostname),
    index("org_email_domain_active_idx").on(table.isActive),
  ],
);

/**
 * Which renderer produced an issued certificate.
 *
 * XLSX_LEGACY is the retired lab-authored workbook path; exactly one
 * historical row carries it and no new row ever will. FIXED_LAYOUT is the
 * system-designed React layout (#865 Phase 3). Reproducing an old certificate
 * means knowing which of the two made it.
 */
export type IssuedCertificateRenderPipeline = "XLSX_LEGACY" | "FIXED_LAYOUT";

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

/**
 * How the fixed layout was rendered. Recorded per issuance so a re-render years
 * later can be compared against the conditions that produced the stored bytes.
 */
export type CertificateFixedLayoutRenderPolicy = {
  converter: "gotenberg-chromium";
  /** Which layout component rendered it, and at which revision. */
  layoutKey: string;
  layoutVersion: string;
};

export type CertificateRenderPolicy =
  | CertificateXlsxRenderPolicy
  | CertificateFixedLayoutRenderPolicy;

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
    /**
     * Historical pointer to the retired lab-authored template system (#865).
     * Nullable and FK-free since 0107: the ON DELETE RESTRICT foreign keys are
     * exactly what would block dropping those tables in 0108, but the integers
     * are kept so the provenance of an already-issued, signed certificate is
     * not destroyed. New rows leave them null.
     */
    templateId: integer("template_id"),
    templateVersionId: integer("template_version_id"),
    /** Which renderer produced this row. 0108 adds the fixed-layout identity. */
    renderPipeline: text("render_pipeline")
      .$type<IssuedCertificateRenderPipeline>()
      .default("XLSX_LEGACY")
      .notNull(),
    certificateNumber: text("certificate_number"),
    pdfR2Key: text("pdf_r2_key").notNull(),
    pdfSha256: text("pdf_sha256").notNull(),
    /**
     * 0108 — which layout produced this row, so it can be re-rendered and
     * compared. Nullable because the one XLSX_LEGACY row predates them.
     */
    layoutKey: text("layout_key"),
    layoutVersion: text("layout_version"),
    rendererVersion: text("renderer_version"),
    /**
     * 0108 — the retired XLSX pipeline's provenance (workbook R2 key, its
     * sha256, the binding-manifest sha256, template ids), moved off the columns
     * rather than deleted so the single historical row still describes how it
     * was made. Null for everything the fixed layout issues.
     */
    legacyXlsx: jsonb("legacy_xlsx").$type<Record<string, unknown>>(),
    renderPolicy: jsonb("render_policy").$type<CertificateRenderPolicy>(),
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
    // CMP-07 (#692): soft references on purpose — NO FK. Append-only audit trail
    // (ISO/IEC 17025): a row must survive deletion of the api key OR organization
    // it documents, so the ids stay as plain values.
    apiKeyId: text("api_key_id").notNull(),
    organizationId: text("organization_id").notNull(),
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
    // Composite-unique TARGET of the integration_* composite foreign keys.
    // Declared as a table UNIQUE CONSTRAINT (not uniqueIndex) so drizzle emits it
    // before the ADD FOREIGN KEY statements. A uniqueIndex is emitted AFTER the
    // FKs, so the referencing FK can't find its target on a cold build (fresh DB
    // via drizzle-kit push/migrate) — see migration 0060.
    unique("organization_integration_id_org_uidx").on(
      table.id,
      table.organizationId,
    ),
  ],
);

// The OAuth application a laboratory registered with a provider (today only
// Conta Azul), for servers that do not supply one in their environment. One
// per laboratory and provider; the secret is encrypted with
// INTEGRATIONS_MASTER_KEY, like the tokens in integration_connection.
export const integrationOAuthApp = pgTable(
  "integration_oauth_app",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    provider: text("provider").$type<IntegrationProvider>().notNull(),
    clientId: text("client_id").notNull(),
    encryptedClientSecret: text("encrypted_client_secret").notNull(),
    clientSecretIv: text("client_secret_iv").notNull(),
    // Shown in settings so an admin can tell which secret is stored.
    clientSecretLast4: text("client_secret_last4").notNull(),
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
    uniqueIndex("integration_oauth_app_org_provider_uidx").on(
      table.organizationId,
      table.provider,
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
    name: text("name").notNull(), // Razao Social (legal name, the official identifier on documents)
    tradeName: text("trade_name"), // Nome Fantasia (trade name, display-only — never replaces razao social on certificates)
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
    // CMP-06 (#649): soft reference on purpose — NO FK. The audit trail is
    // append-only (ISO/IEC 17025): the "delete" row must survive the deletion
    // of the customer it documents, so it keeps the id as a plain integer.
    customerId: serial("customer_id").notNull(),
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
  emailDomains: many(organizationEmailDomain),
  issuedCertificateSnapshots: many(issuedCertificateSnapshot),
  apiKeyAuditLogs: many(organizationApiKeyAuditLog),
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
    ssoProviders: many(ssoProvider),
    customDomain: one(organizationCustomDomain),
    emailDomain: one(organizationEmailDomain),
    issuedCertificateSnapshots: many(issuedCertificateSnapshot),
    apiKeys: many(organizationApiKey),
    integrations: many(organizationIntegration),
    integrationConnections: many(integrationConnection),
    integrationSyncRuns: many(integrationSyncRun),
    integrationSyncCursors: many(integrationSyncCursor),
    integrationEventLogs: many(integrationEventLog),
    integrationObjectLinks: many(integrationObjectLink),
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

export const organizationEmailDomainRelations = relations(
  organizationEmailDomain,
  ({ one }) => ({
    organization: one(organization, {
      fields: [organizationEmailDomain.organizationId],
      references: [organization.id],
    }),
    createdByUser: one(user, {
      fields: [organizationEmailDomain.createdBy],
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
 * Provenance of an asset's customer-owned calibration interval (Track 1). The interval is
 * the equipment owner's (customer's) decision, never the lab's (ISO/IEC 17025:2017
 * §7.8.4.3 + ILAC-G24 / OIML D 10). There is deliberately NO `lab` value, and no
 * `legal_fixed` value — a legal-metrology instrument's regulation-fixed VERIFICATION
 * periodicity is a separate, independent track (`metrologyRegime` + `regulatedInterval`),
 * not a calibration-interval provenance.
 * - `customer_confirmed`: the customer set it in the portal.
 * - `engine_applied`: the customer applied a reliability-engine suggestion.
 */
export type AssetIntervalSetBy = "customer_confirmed" | "engine_applied";

/**
 * Legal-metrology regime of an instrument (Inmetro / RBMLQ-I), set by the lab as a known
 * regulatory fact (enquadramento + finalidade de uso), never inferred from assetType.
 * INDEPENDENT of the customer-owned calibration interval. `LEGAL` → the instrument has a
 * regulation-fixed verification periodicity (`regulatedInterval`); `UNKNOWN` → the lab has
 * not yet determined the enquadramento. Spec: `specs/legal-metrology-regime/spec.md`.
 */
export type MetrologyRegime = "INDUSTRIAL" | "LEGAL" | "UNKNOWN";

/**
 * Asset table - Equipment/Instruments linked to customers.
 * Each asset belongs to a customer and can have calibration history.
 */
export const asset = pgTable(
  "asset",
  {
    id: serial("id").primaryKey(),
    // Opaque, non-sequential identifier for client-facing URLs (the portal
    // routes by this instead of the enumerable serial id). Mirrors
    // serviceOrder.publicId / billingDocument.publicId.
    publicId: text("public_id")
      .notNull()
      .unique()
      .default(sql`gen_random_uuid()`),
    unitId: integer("unit_id")
      .notNull()
      .references(() => organizationUnit.id, { onDelete: "restrict" }),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "cascade" }),
    // Denormalized LAB organization owner (== customer.labOrganizationId). Lets
    // tag uniqueness be enforced PER ORG — UNIQUE(lab_organization_id, tag) below
    // — instead of globally, so two labs may reuse the same tag without a
    // cross-tenant collision or existence oracle (SEC-03 / #638). Every asset
    // write derives this from the in-scope customer's lab org; a customer's lab
    // org never changes after creation, so the invariant holds. `onDelete:
    // "cascade"` mirrors customer.labOrganizationId.
    labOrganizationId: text("lab_organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
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
    tag: text("tag").notNull(), // Internal Lab ID / Asset ID (unique per lab org — see asset_lab_org_tag_uidx)
    status: text("status").$type<AssetStatus>().default("ACTIVE").notNull(),
    baseMeasurementUnit: text("base_measurement_unit").$type<MeasurementUnit>(),
    lastCalibrationDate: timestamp("last_calibration_date"),
    nextCalibrationDate: timestamp("next_calibration_date"),
    // Date the instrument was installed/commissioned. Nullable. Anchors the
    // legal-metrology verification ceiling for `regulated_interval.kind =
    // 'max_months_from_install'` (hidrômetros): `next_legal_verification_date`
    // = `installed_at` + valueMonths. NULL → no fabricated date (REQ-INSTALL-003).
    installedAt: timestamp("installed_at"),
    comments: text("comments"), // Additional notes about the equipment
    // Calibration interval (periodicity) — OWNED BY THE CUSTOMER, never the lab
    // (ISO/IEC 17025:2017 §7.8.4.3 + ILAC-G24 / OIML D 10). NULL = "aguardando
    // definição do cliente" (the lab no longer attributes periodicity). When set,
    // `next_calibration_date` is derived = `last_calibration_date` + this many
    // months. `interval_rationale` is the required §7.5 technical record.
    calibrationIntervalMonths: integer("calibration_interval_months"),
    intervalSetBy: text("interval_set_by").$type<AssetIntervalSetBy>(),
    intervalSetAt: timestamp("interval_set_at"),
    intervalSetByUserId: text("interval_set_by_user_id").references(
      () => user.id,
      { onDelete: "set null" },
    ),
    intervalRationale: text("interval_rationale"),
    // Legal-metrology TRACK 2 (independent of the customer-owned calibration interval
    // above): the regulation-fixed VERIFICATION periodicity for instruments under Inmetro /
    // RBMLQ-I legal control. `metrologyRegime` is the lab-set source of truth;
    // `regulatedInterval` is the structured period (validated by `RegulatedIntervalSchema`
    // at the API boundary — stored loosely like `specifications`);
    // `nextLegalVerificationDate` is derived from it and is SEPARATE from
    // `nextCalibrationDate`. Spec: `specs/legal-metrology-regime/spec.md`.
    metrologyRegime: text("metrology_regime")
      .$type<MetrologyRegime>()
      .default("INDUSTRIAL")
      .notNull(),
    regulatedInterval:
      jsonb("regulated_interval").$type<Record<string, unknown>>(),
    nextLegalVerificationDate: timestamp("next_legal_verification_date"),
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
    // Tag is unique PER LAB ORG, not globally (SEC-03 / #638). This composite
    // replaces the former global `asset_tag_unique` constraint + `asset_tag_uidx`
    // index (both dropped in migration 0082). Its leftmost column also serves as
    // the lab-org lookup index, so no separate lab_organization_id index is kept.
    uniqueIndex("asset_lab_org_tag_uidx").on(
      table.labOrganizationId,
      table.tag,
    ),
    // Partial index for the legal-verification recall sweep (migration 0075).
    index("asset_legal_verification_due_idx")
      .on(table.nextLegalVerificationDate)
      .where(sql`${table.metrologyRegime} = 'LEGAL'`),
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
    // CMP-07 (#692): soft reference on purpose — NO FK. Append-only audit trail
    // (ISO/IEC 17025): the "delete" row must survive the deletion of the asset it
    // documents (assets cascade when their customer is deleted), so it keeps the
    // id as a plain integer.
    assetId: integer("asset_id").notNull(),
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
// LEGAL-METROLOGY REGULATION CATALOG (deferred #3 of #423)
// =============================================================================

/**
 * The shape of a regulation-fixed verification periodicity. Mirrors
 * `RegulatedInterval['kind']` from `@calibra-facil/schemas` (kept as a local union so
 * `schema.ts` carries no cross-package type import). Spec:
 * `specs/legal-metrology-regime/spec.md` (REQ-MLR-010/011).
 */
export type LegalMetrologyRegulationKind =
  | "fixed_months"
  | "max_months_from_install"
  | "per_technology"
  | "not_nationally_fixed";

/**
 * Provenance of a catalog row. `primary` → the period shape was confirmed against the
 * official Inmetro RTM / DOU. `secondary` → corroborated but the exact article still needs
 * operator re-confirmation before it backs a compliance certificate; the UI shows a
 * "(verificar artigo no DOU)" caveat. Spec: REQ-CATALOG-002/005.
 */
export type LegalMetrologyProvenance = "primary" | "secondary";

/**
 * Curated, in-house lookup of legal-metrology Portarias → the default regulated-interval
 * shape, so the lab regime form can auto-fill the regulated fields from a chosen regulation
 * (a default the lab can still override — the regime is use-dependent). There is no public
 * Inmetro registry, so this is seeded with provenance. GLOBAL reference data (the same
 * Portarias apply to every lab) — NOT tenant-scoped. `category` is the idempotent natural
 * key. Spec: `specs/legal-metrology-catalog/spec.md` (REQ-CATALOG-001).
 */
export const legalMetrologyRegulation = pgTable(
  "legal_metrology_regulation",
  {
    id: serial("id").primaryKey(),
    // Human label of the regulated instrument class (e.g. "Taxímetros").
    category: text("category").notNull(),
    // The period shape (reuses RegulatedInterval kinds).
    kind: text("kind").$type<LegalMetrologyRegulationKind>().notNull(),
    // Scalar months for `fixed_months` / `max_months_from_install`; NULL for
    // `per_technology` (resolved from byTechnology) and `not_nationally_fixed`.
    valueMonths: integer("value_months"),
    // Per-technology month map for `per_technology` (e.g. {"diafragma":120,...}).
    byTechnology: jsonb("by_technology").$type<Record<string, number>>(),
    // The counting anchor (last_verification / calendar_year / first_verification /
    // install_year). NULL for `not_nationally_fixed`.
    anchor: text("anchor"),
    // true → the Ipem operationalizes the cadence (derived date is indicative).
    operationalizedByDelegate: boolean("operationalized_by_delegate")
      .default(false)
      .notNull(),
    // The governing act, verbatim (e.g. "Portaria Inmetro nº 157, de 30 de março de 2022").
    regulationReference: text("regulation_reference").notNull(),
    // primary (RTM/DOU-confirmed) | secondary (needs operator re-confirmation).
    provenance: text("provenance").$type<LegalMetrologyProvenance>().notNull(),
    // Optional curator note (e.g. the distinct ANEEL regime for energia elétrica).
    note: text("note"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("legal_metrology_regulation_category_uidx").on(table.category),
  ],
);

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
    // NOTE: the `standard_value` per-row binding config (`standardValue`) is
    // deliberately NOT enumerated here. `data_fields` is a jsonb column, so it
    // round-trips the config either way; the authoritative validator is
    // @calibra-facil/schemas' MethodTableColumnSchema (which DOES carry it).
    // Adding the optional field to this view-only type pushes the API's inferred
    // Hono AppType past the TS7056 serialization limit.
  }>;
};

export type MethodFormulaReporting = {
  includeInCertificate?: boolean;
  role?:
    | "primary_result"
    | "expanded_uncertainty"
    | "coverage_factor"
    | "conformity_margin"
    | "conformity_verdict"
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

// The persisted measurement-model shape is owned by @calibra-facil/schemas
// (MethodMeasurementModelSchema). Importing it keeps the jsonb column type
// permanently in sync with the validation schema instead of a hand copy.
export type { MethodMeasurementModel };

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
  decisionRuleStatement?: string;
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
    // CMP-06 (#649): soft reference on purpose — NO FK. The audit trail is
    // append-only (ISO/IEC 17025 §7.2): the "delete" row must survive the
    // deletion of the method it documents, so it keeps the id as a plain integer.
    methodId: integer("method_id").notNull(),
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
    // CMP-07 (#692): soft reference on purpose — NO FK. Append-only audit trail
    // (ISO/IEC 17025): the row must survive deletion of the service it documents.
    serviceId: integer("service_id").notNull(),
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
// MATERIAL CATALOG - Peças e materiais (parts consumed on service orders)
// =============================================================================

/**
 * Provider-neutral parts/materials catalog. Service-order part line items
 * can reference a material to get unit/cost/price prefills and, when the
 * material is bound to an ERP product (via integrationObjectLink target
 * "catalog_item", localEntityId "material:{id}"), drive stock decrement
 * through the exported sale. `controlsStock` gates which materials ever
 * carry stock semantics — services must never fake stock fields.
 */
export const material = pgTable(
  "material",
  {
    id: serial("id").primaryKey(),
    unitId: integer("unit_id")
      .notNull()
      .references(() => organizationUnit.id, { onDelete: "restrict" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(), // E.g., "Célula de carga 50kg"
    description: text("description"),
    // Internal part code / SKU (also seeds the ERP product SKU when bound)
    sku: text("sku"),
    unit: text("unit").default("un").notNull(),
    // Default costs/prices in cents; line items still snapshot their own
    unitCostCents: integer("unit_cost_cents"),
    unitPriceCents: integer("unit_price_cents"),
    // Only stock-controlled materials participate in ERP stock movement
    controlsStock: boolean("controls_stock").default(false).notNull(),
    // Read-mostly snapshot of the ERP on-hand balance (stock truth lives in
    // the ERP; this mirror powers picker badges and the materials list).
    stockQuantity: real("stock_quantity"),
    stockSyncedAt: timestamp("stock_synced_at"),
    // Soft delete - never hard delete commercial data
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("material_unit_id_idx").on(table.unitId),
    index("material_organization_id_idx").on(table.organizationId),
    index("material_is_active_idx").on(table.isActive),
    uniqueIndex("material_org_sku_uidx")
      .on(table.organizationId, table.sku)
      .where(sql`${table.sku} is not null`),
  ],
);

export const materialRelations = relations(material, ({ one }) => ({
  organization: one(organization, {
    fields: [material.organizationId],
    references: [organization.id],
  }),
  unit: one(organizationUnit, {
    fields: [material.unitId],
    references: [organizationUnit.id],
  }),
}));

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
 * profiles from here.
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
    // CMP-07 (#692): soft reference on purpose — NO FK. Append-only audit trail
    // (ISO/IEC 17025): the row must survive deletion of the reference standard.
    standardId: integer("standard_id").notNull(),
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
 * - SUPERSEDED: Certificate was amended and replaced by a new version (ISO 17025 Clause 7.8.8)
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
    // Source repair service order (DOM-02): when this calibration was opened
    // directly from a service order flagged "calibration required after repair"
    // (serviceOrderExecution.calibrationRequiredAfterRepair), record the link
    // back so the OS's follow-up calibration is tracked and the technician does
    // not re-enter customer/asset. Null for standalone jobs. Set-null on delete
    // so removing an OS never cascades into an issued certificate.
    sourceServiceOrderId: integer("source_service_order_id").references(
      () => serviceOrder.id,
      { onDelete: "set null" },
    ),
    // Dates
    dueDate: timestamp("due_date"),
    performedAt: timestamp("performed_at"),
    // Execution data (filled by technician during calibration)
    data: jsonb("data").$type<Record<string, unknown>>(),
    // Calculated results (output from math engine)
    results: jsonb("results").$type<Record<string, unknown>>(),
    // As-found (pre-adjustment) conformity verdict — the reliability signal for
    // ILAC-G24 / NCSL RP-1 interval analysis. Derived ONCE at approval from the
    // frozen `results` (`margem_conformidade_antes`, NOT the as-left `_apos`) via
    // `apps/api/src/lib/as-found-reliability-verdict.ts`. UNKNOWN when the method
    // emits no as-found margin. Never feeds any certificate/approval logic.
    asFoundConformity: text("as_found_conformity").$type<
      "CONFORMING" | "NON_CONFORMING" | "UNKNOWN"
    >(),
    asFoundMargins: jsonb("as_found_margins").$type<number[]>(),
    // Accredited-scope (CMC) classification — ISO/IEC 17025 §7.6/§7.8.3,
    // ILAC P14 (#427 Phase 0). Stamped at submit (technician warning) and
    // re-stamped at approval (authoritative, frozen with the record) via
    // shared/scope-compliance.ts. Null when the certificate is not accredited
    // or the lab has no scope lines configured. Phase 0 never blocks.
    scopeComplianceStatus: text(
      "scope_compliance_status",
    ).$type<ScopeComplianceStatus>(),
    scopeComplianceFindings: jsonb("scope_compliance_findings").$type<
      ScopeComplianceFinding[]
    >(),
    // #427 Phase 1: documented scope-violation override. Non-null means the
    // approver knowingly issued DESPITE an adverse classification under
    // enforce mode — and the certificate was downgraded to non-accredited
    // (shouldRenderAccreditationSeal suppresses the seal when this is set).
    scopeOverrideJustification: text("scope_override_justification"),
    /**
     * ISO/IEC 17025 §7.8.2.1(n): additions to, deviations from, or exclusions
     * from the method, as actually executed — printed on the certificate when
     * present. A DIFFERENT question from the two justifications either side of
     * it: `scopeOverrideJustification` above is an accreditation-scope
     * override that suppresses the seal, and
     * `environmentalSnapshot.outOfLimitsJustification` covers environmental
     * limits only. Recorded by whoever executed the calibration.
     */
    methodDeviations: text("method_deviations"),
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
    /**
     * Frozen record of what an APPROVED job was issued with. Regulated
     * evidence, not a link: the `certificate_template_id` FK it used to sit
     * beside was dropped in 0107 with the lab-authored template system (#865).
     *
     * Read-only history. Nothing resolves a template any more, and nothing
     * fabricates a snapshot: the desktop-sync path in apps/api/src/routes/sync.ts
     * used to write a placeholder {name: "Padrão do Sistema"} whenever an
     * incoming job carried none, which put an invented template name into
     * regulated evidence for a certificate no template produced. It now passes
     * through what a pre-redesign desktop build sent, or null.
     */
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
    // AMENDMENT TRACKING - ISO 17025:2017 Clause 7.8.8 (amendments to
    // reports; 7.8.4 covers calibration-certificate content)
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
      // #646 (PAdES-T): RFC 3161 carimbo do tempo, when a TSA was configured.
      timestamped?: boolean;
      timestampIcpBrasilConformant?: boolean;
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
      // #646 (PAdES-T): optional for verdicts that predate the column.
      timestampPresent?: boolean;
      timestamp?: { time: string | null; tsaCommonName: string | null } | null;
      // #646 fase b: optional for verdicts computed before revocation checking.
      revocationChecked?: boolean;
      certificateRevoked?: boolean | null;
      revocationTime?: string | null;
      signer: {
        commonName: string | null;
        cpfCnpj: string | null;
        certificateSerial: string | null;
      };
      overall: "VALID" | "ALTERED" | "UNSIGNED" | "REVOKED" | "UNVERIFIABLE";
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
    // DOM-02: resolve "does this repair OS already have a calibration opened?"
    // (the pending-after-repair queue leftJoins on this column).
    index("job_source_service_order_id_idx").on(table.sourceServiceOrderId),
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
    // CMP-07 (#692): soft reference on purpose — NO FK. Append-only audit trail
    // (ISO/IEC 17025): the row must survive deletion of the calibration job.
    jobId: integer("job_id").notNull(),
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
    // Optional material-catalog reference copied from the SO part line item.
    // When set (and the material is bound to an ERP product), the exported
    // sale carries the product line so ERP stock decrements on billing.
    materialId: integer("material_id").references(() => material.id, {
      onDelete: "set null",
    }),
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
    index("billing_document_item_material_idx").on(table.materialId),
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
    // CMP-07 (#692): soft references on purpose — NO FK. Append-only audit trail
    // (ISO/IEC 17025): a row must survive deletion of the certificate release OR
    // organization it documents, so the ids stay as plain values.
    organizationId: text("organization_id").notNull(),
    certificateReleaseId: integer("certificate_release_id").notNull(),
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
    // Marca de selagem (Inmetro; "lacre" coloquial) numbers: retirada na
    // entrada / aposta na saída.
    removedSealingMarkNumber: text("removed_sealing_mark_number"),
    affixedSealingMarkNumber: text("affixed_sealing_mark_number"),
    // Marca de Reparo (Inmetro / RBMLQ-I) — the glued repair mark applied by
    // the permissionária.
    inmetroRepairMarkNumber: text("inmetro_repair_mark_number"),
    inmetroRepairMarkIssuedAt: timestamp("inmetro_repair_mark_issued_at"),
    inmetroRepairMarkAppliedAt: timestamp("inmetro_repair_mark_applied_at"),
    inmetroRepairMarkAppliedByUserId: text(
      "inmetro_repair_mark_applied_by_user_id",
    ).references(() => user.id, { onDelete: "set null" }),
    inmetroRepairMarkNotes: text("inmetro_repair_mark_notes"),
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
    // Optional catalog reference for "part" items; free-form items keep null
    materialId: integer("material_id").references(() => material.id, {
      onDelete: "set null",
    }),
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
  (table) => [
    index("service_order_quote_item_quote_idx").on(table.quoteId),
    index("service_order_quote_item_material_idx").on(table.materialId),
  ],
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
    // Optional catalog reference for "part" items; free-form items keep null
    materialId: integer("material_id").references(() => material.id, {
      onDelete: "set null",
    }),
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
    index("service_order_execution_item_material_idx").on(table.materialId),
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

/**
 * Why a public access token stopped granting access:
 * - "decided": the quote it grants access to was approved or rejected.
 * - "superseded": a newer quote version was sent for the same service order.
 */
export type ServiceOrderTokenRevokedReason = "decided" | "superseded";

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
    // Peppered HMAC-SHA-256 of the human-typeable approval code. Only set on
    // the grant minted at quote send; redemption-minted sibling tokens keep it
    // NULL. Nullable + unique is safe: Postgres unique indexes admit multiple
    // NULLs.
    codeHash: text("code_hash"),
    scope: text("scope").default("service_order").notNull(),
    expiresAt: timestamp("expires_at"),
    revokedAt: timestamp("revoked_at"),
    revokedReason:
      text("revoked_reason").$type<ServiceOrderTokenRevokedReason>(),
    lastViewedAt: timestamp("last_viewed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("service_order_public_access_token_hash_uidx").on(
      table.tokenHash,
    ),
    uniqueIndex("service_order_public_access_token_code_hash_uidx").on(
      table.codeHash,
    ),
    index("service_order_public_access_token_order_idx").on(
      table.serviceOrderId,
    ),
    index("service_order_public_access_token_quote_idx").on(table.quoteId),
  ],
);

/**
 * Per-IP failed-attempt counter for the public approval-code redemption
 * endpoint. Fixed-window buckets: one row per (ip_hash, window_starts_at).
 * The IP is stored as a SHA-256 hash (no raw PII at rest); the row carries no
 * organization/FK because the traffic is pre-auth and unattributable.
 */
export const publicCodeRedeemThrottle = pgTable(
  "public_code_redeem_throttle",
  {
    id: serial("id").primaryKey(),
    ipHash: text("ip_hash").notNull(),
    windowStartsAt: timestamp("window_starts_at").notNull(),
    failedAttempts: integer("failed_attempts").default(0).notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("public_code_redeem_throttle_ip_window_uidx").on(
      table.ipHash,
      table.windowStartsAt,
    ),
  ],
);

// =============================================================================
// SERVICE ORDER EMAIL LOG - Idempotency / dedup (mini-spec H, REQ-SOEMAIL-007)
// =============================================================================

/**
 * Records each sent transition email keyed by (serviceOrderId, eventKey).
 * A UNIQUE constraint on (service_order_id, event_key) enforces at-most-once
 * dispatch per service-order lifecycle event (REQ-SOEMAIL-008).
 *
 * The send-once helper in apps/api claims a row before dispatch and deletes it
 * on failure so a retry can resend (REQ-SOEMAIL-009). Only apps/api has DB
 * access; packages/notifications remains DB-free (preserves REQ-004 boundary).
 */
export const serviceOrderEmailLog = pgTable(
  "service_order_email_log",
  {
    id: serial("id").primaryKey(),
    serviceOrderId: integer("service_order_id")
      .notNull()
      .references(() => serviceOrder.id, { onDelete: "cascade" }),
    /** Stable event key, e.g. "nova_os", "orcamento_sent:42". */
    eventKey: text("event_key").notNull(),
    /** Resolved recipient address at send time (informational). */
    recipientEmail: text("recipient_email"),
    sentAt: timestamp("sent_at").defaultNow().notNull(),
  },
  (table) => [
    unique("service_order_email_log_so_event_uidx").on(
      table.serviceOrderId,
      table.eventKey,
    ),
    index("service_order_email_log_so_idx").on(table.serviceOrderId),
  ],
);

export const serviceOrderEmailLogRelations = relations(
  serviceOrderEmailLog,
  ({ one }) => ({
    serviceOrder: one(serviceOrder, {
      fields: [serviceOrderEmailLog.serviceOrderId],
      references: [serviceOrder.id],
    }),
  }),
);

// =============================================================================
// SERVICE ORDER EMAIL OUTBOX - Transactional outbox for customer status emails
// =============================================================================
// Rows are written in the SAME database transaction as the triggering status
// change so that a rollback never produces an orphaned email dispatch.
// A separate worker (mini-spec E2) drains this table and sends the actual email.

export const serviceOrderEmailOutbox = pgTable(
  "service_order_email_outbox",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // Nullable to match how events store unitId — some paths may not have it.
    unitId: integer("unit_id"),
    serviceOrderId: integer("service_order_id")
      .notNull()
      .references(() => serviceOrder.id, { onDelete: "cascade" }),
    // Stable per-transition dedup key, e.g. "status_email:repair_in_progress".
    eventKey: text("event_key").notNull(),
    // The service-order status that triggered this outbox entry.
    targetStatus: text("target_status").notNull(),
    // Minimal snapshot needed to send later; worker may re-load the order.
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    attempts: integer("attempts").default(0).notNull(),
    lastError: text("last_error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    // Terminal "done" marker — set only when the row is successfully sent (or
    // gracefully skipped). A NULL processedAt means the row is still owed.
    processedAt: timestamp("processed_at"),
    // Explicit dead-letter marker (REQ-REL-OBS-003) — set when a release pushes
    // `attempts` to `maxAttempts`, i.e. the row will never be drained again.
    // Before this, an exhausted row simply stopped being selected (silently);
    // now it is a queryable state. Distinct from processedAt (which means
    // "succeeded").
    deadLetterAt: timestamp("dead_letter_at"),
    // Lease marker — set when a drain claims the row for in-flight processing.
    // The drain reclaims a row whose lease is older than the lease window, so a
    // run killed mid-send (claimedAt set, processedAt still NULL) auto-recovers
    // instead of stranding. Cleared on send failure (released for retry).
    claimedAt: timestamp("claimed_at"),
  },
  (table) => [
    // At most one outbox row per (service order, transition event). INSERT with
    // onConflictDoNothing prevents duplicates on re-entry / retries.
    unique("service_order_email_outbox_order_event_uidx").on(
      table.serviceOrderId,
      table.eventKey,
    ),
    index("service_order_email_outbox_pending_idx").on(
      table.createdAt,
      table.processedAt,
    ),
  ],
);

export const serviceOrderEmailOutboxRelations = relations(
  serviceOrderEmailOutbox,
  ({ one }) => ({
    serviceOrder: one(serviceOrder, {
      fields: [serviceOrderEmailOutbox.serviceOrderId],
      references: [serviceOrder.id],
    }),
    organization: one(organization, {
      fields: [serviceOrderEmailOutbox.organizationId],
      references: [organization.id],
    }),
  }),
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
    // CMP-07 (#692): soft reference on purpose — NO FK. Append-only audit trail
    // (ISO/IEC 17025): the row must survive deletion of the calibration request.
    requestId: integer("request_id").notNull(),
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
    // Customer acknowledgement from the portal ("estaremos prontos para
    // receber o técnico"). An annotation, not a status transition — the lab
    // lifecycle above stays the single state machine, and confirmedBy/At keep
    // their lab-actor meaning. Both reset to NULL whenever scheduledAt moves
    // (a rescheduled visit must be re-confirmed).
    customerConfirmedBy: text("customer_confirmed_by").references(
      () => user.id,
      { onDelete: "set null" },
    ),
    customerConfirmedAt: timestamp("customer_confirmed_at", {
      withTimezone: true,
    }),
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
// VISIT RESCHEDULE REQUEST (portal customer → lab)
// =============================================================================

// A customer-initiated "this date doesn't work" request raised from the
// portal. First-class record (like calibrationRequest), NOT a mutation of the
// visit: the visit only moves when the lab accepts and reschedules. At most
// one PENDING request per visit (partial unique index). A lab-side reschedule
// while a request is pending marks it SUPERSEDED.
export type VisitRescheduleRequestStatus =
  | "PENDING"
  | "ACCEPTED"
  | "DECLINED"
  | "SUPERSEDED";

export type VisitReschedulePreferredPeriod = "MORNING" | "AFTERNOON" | "ANY";

export type VisitReschedulePreferredWindow = {
  /** Preferred date, ISO yyyy-mm-dd. */
  date: string;
  period: VisitReschedulePreferredPeriod;
  note?: string;
};

export const visitRescheduleRequest = pgTable(
  "visit_reschedule_request",
  {
    id: serial("id").primaryKey(),
    visitId: integer("visit_id")
      .notNull()
      .references(() => calibrationVisit.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "restrict" }),
    requestedBy: text("requested_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    reason: text("reason"),
    preferredWindows: jsonb("preferred_windows")
      .$type<VisitReschedulePreferredWindow[]>()
      .default([])
      .notNull(),
    status: text("status")
      .$type<VisitRescheduleRequestStatus>()
      .default("PENDING")
      .notNull(),
    resolvedBy: text("resolved_by").references(() => user.id, {
      onDelete: "set null",
    }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolutionNote: text("resolution_note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("visit_reschedule_request_visit_idx").on(table.visitId),
    index("visit_reschedule_request_customer_idx").on(table.customerId),
    index("visit_reschedule_request_org_pending_idx")
      .on(table.organizationId, table.status)
      .where(sql`${table.status} = 'PENDING'`),
    uniqueIndex("visit_reschedule_request_pending_uidx")
      .on(table.visitId)
      .where(sql`${table.status} = 'PENDING'`),
  ],
);

// Append-only audit trail for customer-facing visit actions (portal confirm,
// reschedule request lifecycle). Same pattern as calibrationRequestAuditLog:
// soft reference on purpose — NO FK — so rows survive deletion of the visit.
export const visitAuditLog = pgTable(
  "visit_audit_log",
  {
    id: serial("id").primaryKey(),
    visitId: integer("visit_id").notNull(),
    action: text("action").notNull(),
    changes: jsonb("changes"),
    performedBy: text("performed_by")
      .notNull()
      .references(() => user.id),
    performedAt: timestamp("performed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    reason: text("reason"),
  },
  (table) => [
    index("visit_audit_log_visit_id_idx").on(table.visitId),
    index("visit_audit_log_performed_at_idx").on(table.performedAt),
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
    issuedCertificateSnapshot: one(issuedCertificateSnapshot, {
      fields: [calibrationJob.id],
      references: [issuedCertificateSnapshot.jobId],
    }),
    // Amendment tracking - ISO 17025:2017 Clause 7.8.8
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

export const visitRescheduleRequestRelations = relations(
  visitRescheduleRequest,
  ({ one }) => ({
    visit: one(calibrationVisit, {
      fields: [visitRescheduleRequest.visitId],
      references: [calibrationVisit.id],
    }),
    customerRecord: one(customer, {
      fields: [visitRescheduleRequest.customerId],
      references: [customer.id],
    }),
    requestedByUser: one(user, {
      fields: [visitRescheduleRequest.requestedBy],
      references: [user.id],
    }),
    resolvedByUser: one(user, {
      fields: [visitRescheduleRequest.resolvedBy],
      references: [user.id],
    }),
  }),
);

export const visitAuditLogRelations = relations(visitAuditLog, ({ one }) => ({
  visit: one(calibrationVisit, {
    fields: [visitAuditLog.visitId],
    references: [calibrationVisit.id],
  }),
  performedByUser: one(user, {
    fields: [visitAuditLog.performedBy],
    references: [user.id],
  }),
}));

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
// ACCREDITED SCOPE (CMC) - ISO/IEC 17025 §7.6 / §7.8.3, ILAC P14 (#427)
// The lab's accredited scope: one line per grandeza × faixa × CMC, per unit
// (Cgcre accredits each laboratory site with its own scope). Certificate
// issuance is validated against these lines (see shared/scope-compliance.ts).
// =============================================================================

export const accreditedScopeLine = pgTable(
  "accredited_scope_line",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    unitId: integer("unit_id")
      .notNull()
      .references(() => organizationUnit.id, { onDelete: "cascade" }),
    // Grandeza — a QuantityKind from the shared unit registry (no DB table).
    quantityKind: text("quantity_kind").$type<QuantityKind>().notNull(),
    // Faixa de medição (inclusive bounds), in rangeUnit.
    rangeMin: doublePrecision("range_min").notNull(),
    rangeMax: doublePrecision("range_max").notNull(),
    rangeUnit: text("range_unit").$type<MeasurementUnit>().notNull(),
    // CMC expression: CMC(x) = cmcA + cmcB·|x| with x in rangeUnit and the
    // result in cmcUnit ('fixed' ignores cmcB). Cgcre's "table" format is
    // just multiple lines over sub-ranges; percent-of-reading maps to cmcB.
    cmcType: text("cmc_type")
      .$type<CmcExpressionType>()
      .default("fixed")
      .notNull(),
    cmcA: doublePrecision("cmc_a").notNull(),
    cmcB: doublePrecision("cmc_b"),
    cmcUnit: text("cmc_unit").$type<MeasurementUnit>().notNull(),
    // Coverage factor the CMC is stated at (ILAC P14: k=2 / ~95 %).
    coverageFactor: doublePrecision("coverage_factor").default(2).notNull(),
    // Free-text service description, e.g. "Balanças classe II".
    description: text("description"),
    // Vigência window of this scope line; null bounds impose no constraint
    // (mirrors organization-level accreditation vigência, #647).
    validFrom: timestamp("valid_from"),
    validUntil: timestamp("valid_until"),
    // Audit
    updatedBy: text("updated_by").references(() => user.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("accredited_scope_line_organization_id_idx").on(table.organizationId),
    index("accredited_scope_line_unit_id_idx").on(table.unitId),
  ],
);

export const accreditedScopeLineRelations = relations(
  accreditedScopeLine,
  ({ one }) => ({
    organization: one(organization, {
      fields: [accreditedScopeLine.organizationId],
      references: [organization.id],
    }),
    unit: one(organizationUnit, {
      fields: [accreditedScopeLine.unitId],
      references: [organizationUnit.id],
    }),
  }),
);

/**
 * Append-only audit trail for scope-line edits (ISO/IEC 17025 §8.4) — a
 * Cgcre auditor will ask who changed the accredited scope and when. Soft
 * reference on purpose (no FK): rows must survive deletion of the line.
 */
export const accreditedScopeLineAuditLog = pgTable(
  "accredited_scope_line_audit_log",
  {
    id: serial("id").primaryKey(),
    // Null for org-level scope events (e.g. enforcement-mode changes) that
    // are not tied to a single line.
    scopeLineId: integer("scope_line_id"),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    action: text("action").notNull(), // 'create', 'update', 'delete'
    changes: jsonb("changes"), // { field: { old: x, new: y } }
    performedBy: text("performed_by")
      .notNull()
      .references(() => user.id),
    performedAt: timestamp("performed_at").defaultNow().notNull(),
    ipAddress: text("ip_address"),
  },
  (table) => [
    index("accredited_scope_line_audit_log_line_idx").on(table.scopeLineId),
    index("accredited_scope_line_audit_log_org_idx").on(table.organizationId),
  ],
);

export const accreditedScopeLineAuditLogRelations = relations(
  accreditedScopeLineAuditLog,
  ({ one }) => ({
    performedByUser: one(user, {
      fields: [accreditedScopeLineAuditLog.performedBy],
      references: [user.id],
    }),
  }),
);

// =============================================================================
// =============================================================================
// =============================================================================
// EMAIL SUPPRESSION - unsubscribe / complaint / hard-bounce suppression list
// =============================================================================

/** Whether an address is suppressed for marketing-class email only, or all. */
export type EmailSuppressionScope = "marketing" | "all";

/** Why the address was suppressed. */
export type EmailSuppressionReason =
  | "unsubscribed"
  | "complaint"
  | "hard_bounce"
  | "manual";

/** What recorded the suppression. */
export type EmailSuppressionSource = "resend_webhook" | "admin" | "api";

/**
 * Addresses that must not be emailed (at a given scope). Driven by Resend
 * complaint/hard-bounce webhooks plus manual/API opt-outs. Email is stored
 * lowercased/trimmed; UNIQUE (email, scope) makes the suppress upsert idempotent.
 */
export const emailSuppression = pgTable(
  "email_suppression",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    scope: text("scope")
      .$type<EmailSuppressionScope>()
      .default("all")
      .notNull(),
    reason: text("reason").$type<EmailSuppressionReason>().notNull(),
    source: text("source").$type<EmailSuppressionSource>().notNull(),
    note: text("note"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("email_suppression_email_scope_uidx").on(
      table.email,
      table.scope,
    ),
    index("email_suppression_email_idx").on(table.email),
  ],
);

/**
 * Minimal dedup ledger for inbound Resend (Svix-signed) webhook deliveries.
 * Delivery is at-least-once, so the unique `svix_id` lets a redelivery be
 * recognized and skipped before the suppression side effect is applied again.
 */
export const emailWebhookEvent = pgTable("email_webhook_event", {
  id: serial("id").primaryKey(),
  svixId: text("svix_id").notNull().unique(),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  receivedAt: timestamp("received_at").defaultNow().notNull(),
});

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
  | "CERTIFICATE_AMENDED" // ISO 17025 Clause 7.8.8 - Certificate amendment notification
  | "AUDIT_PACK_READY" // Portal audit pack (bulk certificate + fleet-status export) ready for download
  | "ASSET_DUE_FOR_RECALIBRATION"
  | "ASSET_DUE_FOR_LEGAL_VERIFICATION" // Legal-metrology TRACK 2 — regulation-fixed verification periodicity (Inmetro/RBMLQ-I), independent of recalibration
  | "STANDARD_EXPIRING"
  | "STANDARD_EXPIRED" // ISO 17025 Clause 6.4.6 - Standard expired, jobs blocked
  | "SIGNING_CERTIFICATE_EXPIRING" // CMP-02 - ICP-Brasil A1 signing certificate nearing validUntil (emission degrades to unsigned once expired)
  | "ACCREDITATION_EXPIRING" // #647 - Cgcre/RBC accreditation vigência nearing validUntil (seal stops rendering once expired)
  | "ACCREDITED_SCOPE_LINE_EXPIRING" // #427 Phase 2 - a scope line's vigência nearing validUntil (points stop matching once expired)
  | "JOB_OVERDUE"
  | "NC_CREATED" // ISO 17025 Clause 8.7 - New non-conformance registered
  | "NC_ESCALATED_TO_CAPA" // ISO 17025 Clause 8.7 - NC escalated to CAPA
  | "OOT_NOTIFICATION_ACKNOWLEDGED" // ISO 17025 Clause 7.10 - Customer acknowledged an out-of-tolerance notification
  | "COMPETENCE_EXPIRING" // ISO 17025 Clause 6.2.3 - Competence expiring soon
  | "COMPETENCE_EXPIRED" // ISO 17025 Clause 6.2.3 - Competence expired, blocks assignment
  | "COMPETENCE_REQUESTED" // ISO 17025 Clause 6.2.3 - New qualification request
  | "COMPETENCE_APPROVED" // ISO 17025 Clause 6.2.3 - Qualification approved
  | "PT_PLAN_DUE" // ISO 17025 Clause 7.7.2 - Proficiency-test participation due for a scope part (#60)
  | "ASSET_FOUND_OUT_OF_TOLERANCE" // ISO 9001 7.1.5.2 / #740 - Customer's instrument reproved as-found; impact assessment required
  | "CALIBRATION_REQUEST_SUBMITTED"
  | "CALIBRATION_REQUEST_UNDER_REVIEW"
  | "CALIBRATION_REQUEST_APPROVED"
  | "CALIBRATION_REQUEST_REJECTED"
  | "CALIBRATION_REQUEST_CONVERTED"
  | "VISIT_SCHEDULED" // On-site visit proposed/assigned to a technician
  | "VISIT_CONFIRMED" // On-site visit confirmed (date + technician) for the customer
  | "VISIT_RESCHEDULED" // On-site visit date changed
  | "VISIT_CANCELLED" // On-site visit cancelled
  | "VISIT_REMINDER" // On-site visit coming up soon (scheduled reminder)
  | "VISIT_CUSTOMER_CONFIRMED" // Lab-bound (#739): portal customer confirmed attendance for a visit
  | "VISIT_RESCHEDULE_REQUESTED" // Lab-bound (#739): portal customer asked to reschedule a visit
  | "VISIT_RESCHEDULE_DECLINED"; // Customer-bound (#739): lab declined the customer's reschedule request

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
    | "competence"
    | "audit_pack"
    | "pt_plan_item";
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
  | "visit"
  | "signing_certificate" // CMP-02 - ICP-Brasil A1 signing-certificate expiry alert
  | "organization_accreditation" // #647 - entity_id is the constant 0 (one accreditation per org)
  | "accredited_scope_line"; // #427 Phase 2 - entity_id is accredited_scope_line.id

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
  | "AUDIT_PACK"
  | "OOT_NOTIFICATION";

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

export type QueueJobReceiptStatus = "RUNNING" | "COMPLETED";

/**
 * Idempotency ledger for queue consumers.
 *
 * Both delivery channels are at-least-once (Vercel Queue redelivers messages;
 * the app_queue_job stale-lease reclaim re-runs rows), so a consumer can see
 * the same DELIVERY UNIT twice. Each unit claims a receipt keyed by
 * (job_type, idempotency_key) before running: `app-queue-<rowId>` for DB-queue
 * rows, `vq:<messageId>` for Vercel Queue messages. A COMPLETED receipt means
 * the work already ran to success and the duplicate is skipped (enforce mode).
 *
 * Deliberately keyed by delivery unit and NOT by business ids (jobId /
 * serviceOrderId): a user re-requesting the same certificate is a NEW logical
 * dispatch and must run — a business-id key would wrongly skip it.
 */
export const queueJobReceipt = pgTable(
  "queue_job_receipt",
  {
    id: serial("id").primaryKey(),
    jobType: text("job_type").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status")
      .$type<QueueJobReceiptStatus>()
      .default("RUNNING")
      .notNull(),
    /** Claim attempts observed for this delivery unit (1 = first run). */
    attempts: integer("attempts").default(1).notNull(),
    /** Claim lease: an unexpired RUNNING receipt means another worker owns it. */
    lockedUntil: timestamp("locked_until").notNull(),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("queue_job_receipt_type_key_unique").on(
      table.jobType,
      table.idempotencyKey,
    ),
    index("queue_job_receipt_completed_at_idx").on(table.completedAt),
  ],
);

// =============================================================================
// PORTAL EXPORT JOBS - customer-requested bulk exports (audit packs)
// =============================================================================

export type PortalExportJobStatus =
  | "PENDING"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED";

export type PortalExportJobKind = "AUDIT_PACK";

/**
 * Audit-pack request parameters, frozen at enqueue time. `customerIds` is the
 * resolved portal scope (branch customer ids, already unit-filtered) so the
 * worker never re-derives tenant scope from mutable membership state; the
 * certificate release gate, by contrast, IS re-evaluated inside the worker at
 * generation time (statuses can change between enqueue and run).
 */
export type PortalAuditPackParams = {
  /** Inclusive approval-date window (YYYY-MM-DD, America/Sao_Paulo). */
  dateFrom: string;
  dateTo: string;
  /** Branch customer id when the group cockpit narrowed to one unit. */
  unitId: number | null;
  include: {
    certificates: boolean;
    fleetReport: boolean;
    verificationIndex: boolean;
  };
  customerIds: number[];
};

/**
 * A customer-facing export produced asynchronously by the worker (issue #738).
 * Rows are listed in the portal by the requesting CLIENT org
 * (`authOrganizationId`), so every portal user of that branch/group sees and
 * can re-download the pack until `expiresAt`.
 */
export const portalExportJob = pgTable(
  "portal_export_job",
  {
    id: serial("id").primaryKey(),
    kind: text("kind")
      .$type<PortalExportJobKind>()
      .default("AUDIT_PACK")
      .notNull(),
    /** The lab whose documents are exported (tenant / host-domain scope). */
    labOrganizationId: text("lab_organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** The CLIENT org (branch customer or customer group) that requested it. */
    authOrganizationId: text("auth_organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    requestedByUserId: text("requested_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    params: jsonb("params").$type<PortalAuditPackParams>().notNull(),
    status: text("status")
      .$type<PortalExportJobStatus>()
      .default("PENDING")
      .notNull(),
    /** Released certificates included in the pack (set by the worker). */
    certificateCount: integer("certificate_count"),
    /** calibration_job ids in the pack — re-gated on every download. */
    includedJobIds: jsonb("included_job_ids").$type<number[]>(),
    r2Key: text("r2_key"),
    fileSizeBytes: integer("file_size_bytes"),
    failureReason: text("failure_reason"),
    /** Download availability window; the pack is regenerate-on-demand after. */
    expiresAt: timestamp("expires_at"),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("portal_export_job_auth_org_idx").on(
      table.authOrganizationId,
      table.createdAt,
    ),
    index("portal_export_job_lab_org_idx").on(table.labOrganizationId),
    index("portal_export_job_status_idx").on(table.status),
  ],
);

// =============================================================================
// ORGANIZATION SIGNING CERTIFICATE - ICP-Brasil Digital Signature (ISO 7.8.2.1)
// =============================================================================

/**
 * Stores ICP-Brasil A1 certificates (PKCS#12) per organization.
 * Password is encrypted with AES-256-GCM using a master key from Cloudflare secrets.
 * Enables PDF signing for calibration certificates (ICP-Brasil, MP 2.200-2 /
 * DOC-ICP-15.03 — the prior NIT-DICLA-083 citation was incorrect, see #646).
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
  | "management_review"
  | "proficiency_test"
  | "spc_signal";

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
    // CMP-07 (#692): soft reference on purpose — NO FK. Append-only audit trail
    // (ISO/IEC 17025): the row must survive deletion of the corrective action.
    capaId: integer("capa_id").notNull(),
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
export type NonConformanceType =
  | "work"
  | "equipment"
  | "documentation"
  | "out_of_tolerance";

/**
 * What opened the NC. Distinguishes manually filed NCs from ones opened by the
 * as-found OOT verdict on a job (§7.10 customer notification, #426 Phase 0) and,
 * later, from a reference-standard recall (#426 Phase 1).
 */
export type NonConformanceTriggerSource =
  | "manual"
  | "as_found_verdict"
  | "standard_recall";

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
    // What opened this NC (nullable — legacy rows are implicitly "manual").
    triggerSource: text("trigger_source").$type<NonConformanceTriggerSource>(),
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
    // CMP-07 (#692): soft reference on purpose — NO FK. Append-only audit trail
    // (ISO/IEC 17025): the row must survive deletion of the non-conformance.
    ncId: integer("nc_id").notNull(),
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
// JOB ↔ REFERENCE STANDARD LINK - reverse traceability (#426 Phase 1)
// =============================================================================

/**
 * First-class, indexed projection of `calibration_job.standards_snapshot`
 * (which stays the frozen source of truth). Enables the reverse-traceability
 * query "which certificates relied on standard X between dates" without an
 * unindexed JSONB containment scan. Rows are derived data: rewritten whenever
 * the snapshot is persisted and backfilled from existing snapshots by
 * migration 0090 — hence plain cascades (always rebuildable).
 */
export const jobStandard = pgTable(
  "job_standard",
  {
    id: serial("id").primaryKey(),
    jobId: integer("job_id")
      .notNull()
      .references(() => calibrationJob.id, { onDelete: "cascade" }),
    standardId: integer("standard_id")
      .notNull()
      .references(() => referenceStandard.id, { onDelete: "cascade" }),
    // When the standard was used (execution time; falls back to job creation
    // for backfilled rows without performed_at).
    usedAt: timestamp("used_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    unique("job_standard_job_standard_uidx").on(table.jobId, table.standardId),
    index("job_standard_job_id_idx").on(table.jobId),
    index("job_standard_standard_id_idx").on(table.standardId),
  ],
);

export const jobStandardRelations = relations(jobStandard, ({ one }) => ({
  job: one(calibrationJob, {
    fields: [jobStandard.jobId],
    references: [calibrationJob.id],
  }),
  standard: one(referenceStandard, {
    fields: [jobStandard.standardId],
    references: [referenceStandard.id],
  }),
}));

// =============================================================================
// STANDARD RECALL - ISO 17025:2017 Clause 7.10 recall of work (#426 Phase 1)
// =============================================================================

/**
 * DRAFT → SENT. A recall stays DRAFT while the quality manager reviews the
 * impacted-certificate list; SENT is stamped by the approval-gated batch send.
 */
export type StandardRecallStatus = "DRAFT" | "SENT";

/**
 * One recall campaign for a reference standard found out-of-tolerance.
 * Created (with its NC) when the standard transitions to OUT_OF_TOLERANCE;
 * the batch send requires an admin/owner approver, recorded here (§7.10.1
 * defined responsibilities + the legal-sensitivity mitigation from #426).
 */
export const standardRecall = pgTable(
  "standard_recall",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    standardId: integer("standard_id")
      .notNull()
      .references(() => referenceStandard.id, { onDelete: "restrict" }),
    ncId: integer("nc_id")
      .notNull()
      .references(() => nonConformance.id, { onDelete: "restrict" }),
    status: text("status")
      .$type<StandardRecallStatus>()
      .default("DRAFT")
      .notNull(),
    // Reviewed notification window (defaults to the standard's last good
    // calibrationDate → now; both bounds editable — over-notification
    // mitigation from #426).
    fromDate: timestamp("from_date"),
    toDate: timestamp("to_date"),
    approvedBy: text("approved_by").references(() => user.id, {
      onDelete: "restrict",
    }),
    approvedAt: timestamp("approved_at"),
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
    index("standard_recall_organization_id_idx").on(table.organizationId),
    index("standard_recall_standard_id_idx").on(table.standardId),
    uniqueIndex("standard_recall_nc_uidx").on(table.ncId),
  ],
);

// =============================================================================
// OOT IMPACT ASSESSMENT - ISO 17025:2017 Clause 7.10.1 (#426 Phase 2)
// =============================================================================

/** Outcome of the customer-impact evaluation of an OOT event. */
export type OotImpactAssessmentConclusion =
  | "no_significant_impact"
  | "impact_confirmed"
  | "inconclusive";

/** Disposition per affected measurement/item. */
export type OotImpactAssessmentItemDisposition =
  | "no_impact"
  | "recheck"
  | "notify_downstream"
  | "other";

export type OotImpactAssessmentItem = {
  description: string;
  disposition: OotImpactAssessmentItemDisposition;
  note?: string | null;
};

/**
 * Guided §7.10 impact-assessment record — one per out-of-tolerance NC.
 * Structured after common OOT practice guidance: deviation nature/magnitude
 * vs. the customer's tolerance, affected period, per-measurement disposition,
 * conclusion and sign-off. Editable while unsigned; signing (admin/owner)
 * freezes it as retained §7.10.2 evidence. The magnitude/tolerance pair
 * feeds the UI's ~10%-of-tolerance triage hint (never an automatic
 * dismissal).
 */
export const ootImpactAssessment = pgTable(
  "oot_impact_assessment",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    ncId: integer("nc_id")
      .notNull()
      .references(() => nonConformance.id, { onDelete: "restrict" }),
    // Nature + magnitude of the deviation.
    deviationSummary: text("deviation_summary").notNull(),
    /** |worst deviation| in the measurement's units. */
    deviationMagnitude: real("deviation_magnitude"),
    /** The customer's tolerance band, same units. */
    customerTolerance: real("customer_tolerance"),
    toleranceUnit: text("tolerance_unit"),
    // Affected period (defaults suggested from the notification context).
    affectedFrom: timestamp("affected_from"),
    affectedTo: timestamp("affected_to"),
    // Per-measurement/item dispositions.
    items: jsonb("items").$type<OotImpactAssessmentItem[]>(),
    conclusion: text("conclusion").$type<OotImpactAssessmentConclusion>(),
    correctiveActionNote: text("corrective_action_note"),
    // Sign-off freezes the record (§7.10.1 defined responsibilities).
    signedBy: text("signed_by").references(() => user.id, {
      onDelete: "restrict",
    }),
    signedAt: timestamp("signed_at"),
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
    index("oot_impact_assessment_organization_id_idx").on(table.organizationId),
    uniqueIndex("oot_impact_assessment_nc_uidx").on(table.ncId),
  ],
);

export const ootImpactAssessmentRelations = relations(
  ootImpactAssessment,
  ({ one }) => ({
    organization: one(organization, {
      fields: [ootImpactAssessment.organizationId],
      references: [organization.id],
    }),
    nonConformance: one(nonConformance, {
      fields: [ootImpactAssessment.ncId],
      references: [nonConformance.id],
    }),
    signedByUser: one(user, {
      fields: [ootImpactAssessment.signedBy],
      references: [user.id],
      relationName: "ootImpactAssessmentSigner",
    }),
    createdByUser: one(user, {
      fields: [ootImpactAssessment.createdBy],
      references: [user.id],
      relationName: "ootImpactAssessmentCreator",
    }),
  }),
);

// =============================================================================
// OUT-OF-TOLERANCE NOTIFICATION - ISO 17025:2017 Clause 7.10 (#426 Phase 0)
// =============================================================================

/**
 * Lifecycle of a §7.10 customer notification.
 * PENDING → GENERATED (PDF on R2) → SENT (email dispatched) → ACKNOWLEDGED.
 */
export type OotNotificationStatus =
  | "PENDING"
  | "GENERATED"
  | "SENT"
  | "ACKNOWLEDGED";

/**
 * How the customer's acknowledgement was registered. `portal_link` is reserved
 * for the Phase 2 portal surface.
 */
export type OotAcknowledgedVia = "email_link" | "portal_link" | "manual";

/**
 * §7.10.2 evidence record: one row per customer notification about an
 * out-of-tolerance as-found result. Written in the same transaction as the
 * triggering NC; the PDF/email pipeline updates it as the notification
 * progresses. FKs are deliberately non-cascading — this is a retained
 * quality record and must block deletion of what it evidences.
 */
export const ootNotification = pgTable(
  "oot_notification",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    ncId: integer("nc_id")
      .notNull()
      .references(() => nonConformance.id, { onDelete: "restrict" }),
    jobId: integer("job_id")
      .notNull()
      .references(() => calibrationJob.id, { onDelete: "restrict" }),
    // #426 Phase 1: set when this notification belongs to a standard-recall
    // batch (one row per impacted certificate). Null for Phase 0 as-found
    // notifications. Changes the letter/email copy to the recall variant.
    recallId: integer("recall_id").references(() => standardRecall.id, {
      onDelete: "set null",
    }),
    // Context snapshot frozen at flag time (the certificate/customer may change
    // later; the notification must evidence what was communicated).
    certificateNumber: text("certificate_number"),
    recipientName: text("recipient_name"),
    recipientEmail: text("recipient_email"),
    // Manual affected-scope entry (the customer's measurement window/context),
    // frozen here for the generated PDF.
    affectedScope: text("affected_scope"),
    status: text("status")
      .$type<OotNotificationStatus>()
      .default("PENDING")
      .notNull(),
    // Generated §7.10 notification PDF.
    pdfR2Key: text("pdf_r2_key"),
    pdfSha256: text("pdf_sha256"),
    sentAt: timestamp("sent_at"),
    // Unguessable token embedded in the email's "confirmo o recebimento" link.
    ackToken: text("ack_token")
      .notNull()
      .unique()
      .default(sql`gen_random_uuid()`),
    acknowledgedAt: timestamp("acknowledged_at"),
    acknowledgedVia: text("acknowledged_via").$type<OotAcknowledgedVia>(),
    acknowledgedNote: text("acknowledged_note"),
    // Who triggered/approved sending the notification (§7.10.1 defined
    // responsibilities; legal-sensitivity mitigation from #426).
    approvedBy: text("approved_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("oot_notification_organization_id_idx").on(table.organizationId),
    index("oot_notification_nc_id_idx").on(table.ncId),
    index("oot_notification_job_id_idx").on(table.jobId),
    index("oot_notification_status_idx").on(table.status),
    index("oot_notification_recall_id_idx").on(table.recallId),
    // Batch-send idempotency: one notification per certificate per recall
    // (NULL recall_id — the Phase 0 as-found path — never collides).
    unique("oot_notification_recall_job_uidx").on(table.recallId, table.jobId),
  ],
);

// =============================================================================
// OOT EMAIL OUTBOX - Transactional outbox for §7.10 notification emails
// =============================================================================
// Same contract as service_order_email_outbox: rows are written in the SAME
// transaction as the oot_notification they dispatch, and a cron drain sends
// the actual email with claim-lease / retry / dead-letter semantics.

export const ootEmailOutbox = pgTable(
  "oot_email_outbox",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    notificationId: integer("notification_id")
      .notNull()
      .references(() => ootNotification.id, { onDelete: "cascade" }),
    // Stable dedup key, e.g. "oot_notification". One logical email per
    // (notification, event); INSERT with onConflictDoNothing.
    eventKey: text("event_key").notNull(),
    // Minimal snapshot needed to send later; the drain re-loads the
    // notification row for current state.
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    attempts: integer("attempts").default(0).notNull(),
    lastError: text("last_error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    // Terminal "done" marker — NULL means the row is still owed.
    processedAt: timestamp("processed_at"),
    // Dead-letter marker — set when attempts reach maxAttempts.
    deadLetterAt: timestamp("dead_letter_at"),
    // Lease marker — see service_order_email_outbox for the recovery contract.
    claimedAt: timestamp("claimed_at"),
  },
  (table) => [
    unique("oot_email_outbox_notification_event_uidx").on(
      table.notificationId,
      table.eventKey,
    ),
    index("oot_email_outbox_pending_idx").on(
      table.createdAt,
      table.processedAt,
    ),
  ],
);

export const ootNotificationRelations = relations(
  ootNotification,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [ootNotification.organizationId],
      references: [organization.id],
    }),
    nonConformance: one(nonConformance, {
      fields: [ootNotification.ncId],
      references: [nonConformance.id],
    }),
    job: one(calibrationJob, {
      fields: [ootNotification.jobId],
      references: [calibrationJob.id],
    }),
    approvedByUser: one(user, {
      fields: [ootNotification.approvedBy],
      references: [user.id],
      relationName: "ootNotificationApprover",
    }),
    recall: one(standardRecall, {
      fields: [ootNotification.recallId],
      references: [standardRecall.id],
    }),
    outboxEntries: many(ootEmailOutbox),
  }),
);

export const standardRecallRelations = relations(
  standardRecall,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [standardRecall.organizationId],
      references: [organization.id],
    }),
    standard: one(referenceStandard, {
      fields: [standardRecall.standardId],
      references: [referenceStandard.id],
    }),
    nonConformance: one(nonConformance, {
      fields: [standardRecall.ncId],
      references: [nonConformance.id],
    }),
    approvedByUser: one(user, {
      fields: [standardRecall.approvedBy],
      references: [user.id],
      relationName: "standardRecallApprover",
    }),
    createdByUser: one(user, {
      fields: [standardRecall.createdBy],
      references: [user.id],
      relationName: "standardRecallCreator",
    }),
    notifications: many(ootNotification),
  }),
);

export const ootEmailOutboxRelations = relations(ootEmailOutbox, ({ one }) => ({
  notification: one(ootNotification, {
    fields: [ootEmailOutbox.notificationId],
    references: [ootNotification.id],
  }),
  organization: one(organization, {
    fields: [ootEmailOutbox.organizationId],
    references: [organization.id],
  }),
}));

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
    // ISO/IEC 17025 §6.2 competence record. userId is nullable + ON DELETE SET
    // NULL (migration 0083): a user self-deletion (Better Auth deleteUser) must
    // NOT cascade-wipe this regulated record. The beforeDelete hook soft-deletes
    // (deletedAt) + writes an audit row with an identity snapshot first, then the
    // SET NULL lets the user row go while this row survives.
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
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
    // CMP-07 rework (#692): true DDL is a PARTIAL unique index —
    // `UNIQUE (organization_id, user_id, asset_type_id) NULLS NOT DISTINCT
    // WHERE user_id IS NOT NULL` — so a tombstoned row (user_id NULL after a
    // user's beforeDelete hook) never collides with another tombstone, while
    // ACTIVE rows keep the "one org-wide (asset_type_id NULL) row per user"
    // invariant. Confirmed (by reading the installed drizzle-orm@0.45.2
    // IndexBuilder + drizzle-kit@0.31.7 SQL generator): `nullsNotDistinct()`
    // exists ONLY on the `unique()` CONSTRAINT builder, and `.where()` exists
    // ONLY on the `uniqueIndex()` builder — neither builder supports both, and
    // drizzle-kit's DDL emitter never writes "NULLS NOT DISTINCT" for a
    // `CREATE INDEX` statement (only for `ADD CONSTRAINT ... UNIQUE`). This
    // declaration is therefore an APPROXIMATION for drizzle-kit's benefit
    // (keeps the object named/documented); the real WHERE + NULLS NOT
    // DISTINCT DDL is applied by migration 0083 (prod/dev) and by
    // `apps/api/test/integration/extensions.sql` (test harness, run once
    // after `drizzle-kit push` builds the per-run template DB).
    uniqueIndex("competence_org_user_asset_type_uidx")
      .on(table.organizationId, table.userId, table.assetTypeId)
      .where(sql`${table.userId} is not null`),
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
    // Nullable + ON DELETE SET NULL (migration 0083): a user self-deletion
    // (Better Auth deleteUser) must NOT cascade-wipe this ISO/IEC 17025 §6.2.3
    // training record (incl. the R2 certificate reference). The beforeDelete hook
    // soft-deletes (deletedAt) + audits with an identity snapshot first.
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
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
    // CMP-07 (#692): soft reference on purpose — NO FK. Append-only audit trail
    // (ISO/IEC 17025): the row must survive deletion of the competence record
    // (which itself cascades from user self-delete), so it keeps a plain integer.
    competenceId: integer("competence_id").notNull(),
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
    // CMP-07 (#692): soft reference on purpose — NO FK. Append-only audit trail
    // (ISO/IEC 17025): the row must survive deletion of the training record
    // (which itself cascades from user self-delete), so it keeps a plain integer.
    trainingRecordId: integer("training_record_id").notNull(),
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
    // Nullable + ON DELETE SET NULL (migration 0083): a user self-deletion
    // (Better Auth deleteUser) must NOT cascade-wipe this ISO/IEC 17025 §6.2.6
    // authorization history. The beforeDelete hook REVOKES the authorization
    // (status REVOKED + revokedAt) + audits with an identity snapshot first, so
    // the record survives with user_id NULL.
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
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
    // CMP-07 rework (#692): same partial-unique-index rationale as
    // personnel_competence above — see that comment for the full explanation
    // of why drizzle-orm/drizzle-kit cannot express `NULLS NOT DISTINCT` on a
    // partial `uniqueIndex()`. Real DDL: migration 0083 + extensions.sql.
    uniqueIndex("authorized_signatory_org_user_asset_type_uidx")
      .on(table.organizationId, table.userId, table.assetTypeId)
      .where(sql`${table.userId} is not null`),
  ],
);

// =============================================================================
// AUTHORIZED SIGNATORY AUDIT LOG - ISO 17025:2017 Clause 8.4
// =============================================================================

export const authorizedSignatoryAuditLog = pgTable(
  "authorized_signatory_audit_log",
  {
    id: serial("id").primaryKey(),
    // CMP-07 (#692): soft reference on purpose — NO FK. Append-only audit trail
    // (ISO/IEC 17025 §6.2.6): the record of who was an authorized signatory must
    // survive deletion of the authorization row, so it keeps a plain integer.
    signatoryId: integer("signatory_id").notNull(),
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

/**
 * Heartbeat + lease-lock for the Vercel cron dispatcher (one row per
 * /api/cron/* job). The dispatcher records each run's outcome here so a
 * silently-failing or never-firing cron is detectable from the DB, and takes a
 * short `lockedUntil` row-lease to prevent overlapping runs. Treated as
 * best-effort / fail-open by the dispatcher (see vercel-src/cron/cron-run.ts).
 */
export const cronRun = pgTable("cron_run", {
  job: text("job").primaryKey(),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastStatus: text("last_status"),
  lastError: text("last_error"),
  consecutiveFailures: integer("consecutive_failures").default(0).notNull(),
});

// ============================================================================
// Proficiency Testing & SPC — ISO/IEC 17025 §7.7 "Ensuring the validity of
// results" (#60). PT register (7.7.2) + check-standard control charts (7.7.1).
// ============================================================================

/**
 * 17025 §7.7.2: (a) proficiency testing, (b) other interlaboratory comparisons.
 */
export type PtActivityType = "proficiency_test" | "interlab_comparison";

/**
 * Performance-score statistic per ISO 13528:2022 §9. En is the default for
 * calibration PT rounds; z/z'/zeta apply the ±2 warning / ±3 action bands.
 */
export type PtScoreType = "en" | "z" | "z_prime" | "zeta";

export type PtScoreVerdict = "satisfactory" | "questionable" | "unsatisfactory";

export type PtOverallStatus =
  | "pending"
  | "satisfactory"
  | "questionable"
  | "unsatisfactory";

/**
 * One measured point of a PT round: the lab's reported value against the
 * provider's assigned value, with the computed performance score.
 */
export type PtResultPoint = {
  /** Measured point label, e.g. "100 g" or "10 V @ 1 kHz". */
  label: string;
  unit?: string | null;
  labValue: number;
  /** Lab expanded uncertainty (k=2) for En / zeta. */
  labUncertainty?: number | null;
  refValue: number;
  /** Provider expanded uncertainty (En) or sigma_pt (z-family). */
  refUncertainty?: number | null;
  sigmaPt?: number | null;
  scoreType: PtScoreType;
  score?: number | null;
  verdict?: PtScoreVerdict | null;
};

export const proficiencyTest = pgTable(
  "proficiency_test",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    unitId: integer("unit_id").references(() => organizationUnit.id, {
      onDelete: "restrict",
    }),

    activityType: text("activity_type")
      .$type<PtActivityType>()
      .default("proficiency_test")
      .notNull(),

    // Provider (ISO/IEC 17043; NIT-DICLA-026 §10 accreditation evidence)
    provider: text("provider").notNull(),
    providerAccreditation: text("provider_accreditation"),

    ptRound: text("pt_round").notNull(), // e.g. "PT-2026-01"
    /** "Significant part of scope" covered (NIT-DICLA-026 §9.3). */
    scopePart: text("scope_part").notNull(),
    metrologyKind: text("metrology_kind"),
    standardId: integer("standard_id").references(() => referenceStandard.id, {
      onDelete: "restrict",
    }),

    registrationDate: timestamp("registration_date"),
    participationDate: timestamp("participation_date"),
    resultReportedAt: timestamp("result_reported_at"),

    results: jsonb("results").$type<PtResultPoint[]>(),
    overallStatus: text("overall_status")
      .$type<PtOverallStatus>()
      .default("pending")
      .notNull(),

    // Set when an unsatisfactory result auto-opens a CAPA (§7.7.3)
    capaId: integer("capa_id").references(() => correctiveAction.id),

    notes: text("notes"),

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
    index("proficiency_test_organization_id_idx").on(table.organizationId),
    index("proficiency_test_unit_id_idx").on(table.unitId),
    index("proficiency_test_status_idx").on(table.overallStatus),
    index("proficiency_test_scope_part_idx").on(table.scopePart),
    index("proficiency_test_standard_id_idx").on(table.standardId),
  ],
);

/**
 * Risk-based PT participation plan per significant scope part
 * (NIT-DICLA-026 §9.4; default cycle 4 years per §9.2.2).
 */
export const ptPlanItem = pgTable(
  "pt_plan_item",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    unitId: integer("unit_id").references(() => organizationUnit.id, {
      onDelete: "restrict",
    }),

    scopePart: text("scope_part").notNull(),
    riskJustification: text("risk_justification"),
    frequencyMonths: integer("frequency_months").default(48).notNull(),

    // Denormalized from satisfactory rounds; drives due-date alerts
    lastSatisfactoryAt: timestamp("last_satisfactory_at"),
    nextDueAt: timestamp("next_due_at"),

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
    index("pt_plan_item_organization_id_idx").on(table.organizationId),
    index("pt_plan_item_next_due_at_idx").on(table.nextDueAt),
  ],
);

export const proficiencyTestAuditLog = pgTable(
  "proficiency_test_audit_log",
  {
    id: serial("id").primaryKey(),
    // Soft reference on purpose — NO FK. Append-only audit trail
    // (ISO/IEC 17025): the row must survive deletion of the PT round.
    proficiencyTestId: integer("proficiency_test_id").notNull(),
    action: text("action").notNull(), // 'create', 'update', 'record_results', 'escalate', 'close'
    changes: jsonb("changes"),
    performedBy: text("performed_by")
      .notNull()
      .references(() => user.id),
    performedAt: timestamp("performed_at").defaultNow().notNull(),
    ipAddress: text("ip_address"),
    reason: text("reason"),
  },
  (table) => [
    index("pt_audit_log_pt_id_idx").on(table.proficiencyTestId),
    index("pt_audit_log_performed_at_idx").on(table.performedAt),
  ],
);

/**
 * Raw check/working-standard readings (17025 §7.7.1). First-class rows —
 * not a jsonb array — so trends stay queryable and each point carries
 * provenance (who, when, optionally which calibration job).
 */
export const checkStandardReading = pgTable(
  "check_standard_reading",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    unitId: integer("unit_id").references(() => organizationUnit.id, {
      onDelete: "restrict",
    }),
    standardId: integer("standard_id")
      .notNull()
      .references(() => referenceStandard.id, { onDelete: "cascade" }),

    /** Measured point/parameter key, e.g. "100 g" — one chart per parameter. */
    parameter: text("parameter").notNull(),
    value: doublePrecision("value").notNull(),
    uncertainty: doublePrecision("uncertainty"),
    measuredAt: timestamp("measured_at").notNull(),
    /** Set when the reading was captured during a calibration job. */
    sourceJobId: integer("source_job_id"),

    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("check_standard_reading_org_idx").on(table.organizationId),
    index("check_standard_reading_standard_idx").on(
      table.standardId,
      table.parameter,
      table.measuredAt,
    ),
  ],
);

/**
 * I-MR is the default: check-standard monitoring usually yields one reading
 * per run (n=1), which X-bar/R cannot chart (NIST/SEMATECH §6.3.2).
 */
export type SpcChartType = "i_mr" | "xbar_r" | "cusum" | "ewma";

export type SpcStatus =
  | "insufficient_data"
  | "in_control"
  | "trending"
  | "out_of_control";

/**
 * Chart configuration. Limits are recomputed from the baseline window unless
 * frozen values are provided.
 */
export type SpcChartParams = {
  /** Number of initial in-control points used to estimate limits. */
  baselineWindow?: number | null;
  /** Frozen centerline/sigma — when set, recompute keeps them fixed. */
  centerline?: number | null;
  sigma?: number | null;
  /** Subgroup size (X-bar/R only). */
  subgroupSize?: number | null;
  /** CUSUM reference value k and decision interval h, in sigma units. */
  cusumK?: number | null;
  cusumH?: number | null;
  /** EWMA smoothing constant lambda and limit width in sigmas. */
  ewmaLambda?: number | null;
  ewmaK?: number | null;
  /** Individually toggleable detection rules (see interval-analysis/spc). */
  enabledRules?: string[] | null;
};

export type SpcRuleHit = {
  rule: string;
  severity: "trending" | "out_of_control";
  /** Indices into the evaluated reading sequence (chronological). */
  pointIndices: number[];
  description: string;
};

export type SpcEvaluationLimits = {
  centerline: number;
  sigma: number;
  ucl: number;
  lcl: number;
  /** Secondary (MR / R) chart limits when applicable. */
  secondaryUcl?: number | null;
  secondaryLcl?: number | null;
};

export type SpcEvaluation = {
  engineVersion: string;
  fingerprint: string;
  status: SpcStatus;
  sampleSize: number;
  limits?: SpcEvaluationLimits | null;
  ruleHits: SpcRuleHit[];
  evaluatedAt?: string | null;
};

export const controlChart = pgTable(
  "control_chart",
  {
    id: serial("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    unitId: integer("unit_id").references(() => organizationUnit.id, {
      onDelete: "restrict",
    }),
    standardId: integer("standard_id")
      .notNull()
      .references(() => referenceStandard.id, { onDelete: "cascade" }),
    parameter: text("parameter").notNull(),

    chartType: text("chart_type")
      .$type<SpcChartType>()
      .default("i_mr")
      .notNull(),
    params: jsonb("params").$type<SpcChartParams>(),

    status: text("status")
      .$type<SpcStatus>()
      .default("insufficient_data")
      .notNull(),
    lastEvaluation: jsonb("last_evaluation").$type<SpcEvaluation>(),
    lastEvaluatedAt: timestamp("last_evaluated_at"),

    // Set when a signal is escalated to the quality workflow
    ncId: integer("nc_id").references(() => nonConformance.id),
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
    index("control_chart_organization_id_idx").on(table.organizationId),
    index("control_chart_status_idx").on(table.status),
    uniqueIndex("control_chart_standard_parameter_uidx").on(
      table.standardId,
      table.parameter,
    ),
  ],
);

export const controlChartAuditLog = pgTable(
  "control_chart_audit_log",
  {
    id: serial("id").primaryKey(),
    // Soft reference on purpose — NO FK (append-only audit trail).
    controlChartId: integer("control_chart_id").notNull(),
    action: text("action").notNull(), // 'create', 'update', 'recalculate', 'escalate'
    changes: jsonb("changes"),
    performedBy: text("performed_by")
      .notNull()
      .references(() => user.id),
    performedAt: timestamp("performed_at").defaultNow().notNull(),
    ipAddress: text("ip_address"),
    reason: text("reason"),
  },
  (table) => [
    index("control_chart_audit_log_chart_id_idx").on(table.controlChartId),
    index("control_chart_audit_log_performed_at_idx").on(table.performedAt),
  ],
);

export const proficiencyTestRelations = relations(
  proficiencyTest,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [proficiencyTest.organizationId],
      references: [organization.id],
    }),
    unit: one(organizationUnit, {
      fields: [proficiencyTest.unitId],
      references: [organizationUnit.id],
    }),
    standard: one(referenceStandard, {
      fields: [proficiencyTest.standardId],
      references: [referenceStandard.id],
    }),
    capa: one(correctiveAction, {
      fields: [proficiencyTest.capaId],
      references: [correctiveAction.id],
    }),
    createdByUser: one(user, {
      fields: [proficiencyTest.createdBy],
      references: [user.id],
      relationName: "proficiencyTestCreator",
    }),
    auditLogs: many(proficiencyTestAuditLog),
  }),
);

export const proficiencyTestAuditLogRelations = relations(
  proficiencyTestAuditLog,
  ({ one }) => ({
    proficiencyTest: one(proficiencyTest, {
      fields: [proficiencyTestAuditLog.proficiencyTestId],
      references: [proficiencyTest.id],
    }),
    performedByUser: one(user, {
      fields: [proficiencyTestAuditLog.performedBy],
      references: [user.id],
    }),
  }),
);

export const ptPlanItemRelations = relations(ptPlanItem, ({ one }) => ({
  organization: one(organization, {
    fields: [ptPlanItem.organizationId],
    references: [organization.id],
  }),
  unit: one(organizationUnit, {
    fields: [ptPlanItem.unitId],
    references: [organizationUnit.id],
  }),
  createdByUser: one(user, {
    fields: [ptPlanItem.createdBy],
    references: [user.id],
    relationName: "ptPlanItemCreator",
  }),
}));

export const checkStandardReadingRelations = relations(
  checkStandardReading,
  ({ one }) => ({
    organization: one(organization, {
      fields: [checkStandardReading.organizationId],
      references: [organization.id],
    }),
    standard: one(referenceStandard, {
      fields: [checkStandardReading.standardId],
      references: [referenceStandard.id],
    }),
    createdByUser: one(user, {
      fields: [checkStandardReading.createdBy],
      references: [user.id],
      relationName: "checkStandardReadingCreator",
    }),
  }),
);

export const controlChartRelations = relations(
  controlChart,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [controlChart.organizationId],
      references: [organization.id],
    }),
    standard: one(referenceStandard, {
      fields: [controlChart.standardId],
      references: [referenceStandard.id],
    }),
    nonConformance: one(nonConformance, {
      fields: [controlChart.ncId],
      references: [nonConformance.id],
    }),
    capa: one(correctiveAction, {
      fields: [controlChart.capaId],
      references: [correctiveAction.id],
    }),
    createdByUser: one(user, {
      fields: [controlChart.createdBy],
      references: [user.id],
      relationName: "controlChartCreator",
    }),
    auditLogs: many(controlChartAuditLog),
  }),
);

export const controlChartAuditLogRelations = relations(
  controlChartAuditLog,
  ({ one }) => ({
    controlChart: one(controlChart, {
      fields: [controlChartAuditLog.controlChartId],
      references: [controlChart.id],
    }),
    performedByUser: one(user, {
      fields: [controlChartAuditLog.performedBy],
      references: [user.id],
    }),
  }),
);

// ============================================================================
// Asset out-of-tolerance (OOT) events & customer impact assessments (#740).
// Track B: when a certificate is approved with asFoundConformity =
// NON_CONFORMING, the owning customer gets an auditable "avaliar impacto"
// workflow — ISO 9001:2015 §7.1.5.2 (validity of previous results) and
// IATF 16949 §7.1.5.2.1 (risk assessment + customer notification records).
// The assessment is the CUSTOMER'S obligation; the portal is the workspace.
// ============================================================================

export type AssetOotEventStatus = "OPEN" | "ASSESSED";

export type AssetOotImpactDecision =
  | "NO_IMPACT"
  | "IMPACT_CONTAINED"
  | "IMPACT_ESCALATED";

export const assetOotEvent = pgTable(
  "asset_oot_event",
  {
    id: serial("id").primaryKey(),
    // One event per approved job — the approval hook is idempotent on this.
    jobId: integer("job_id")
      .notNull()
      .unique()
      .references(() => calibrationJob.id, { onDelete: "cascade" }),
    assetId: integer("asset_id")
      .notNull()
      .references(() => asset.id, { onDelete: "cascade" }),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "cascade" }),
    labOrganizationId: text("lab_organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    status: text("status")
      .$type<AssetOotEventStatus>()
      .default("OPEN")
      .notNull(),
    /** Approval time of the non-conforming as-found certificate. */
    detectedAt: timestamp("detected_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("asset_oot_event_customer_status_idx").on(
      table.customerId,
      table.status,
    ),
    index("asset_oot_event_asset_id_idx").on(table.assetId),
    index("asset_oot_event_lab_org_idx").on(table.labOrganizationId),
  ],
);

export const assetOotImpactAssessment = pgTable(
  "asset_oot_impact_assessment",
  {
    id: serial("id").primaryKey(),
    eventId: integer("event_id")
      .notNull()
      .references(() => assetOotEvent.id, { onDelete: "cascade" }),
    decision: text("decision").$type<AssetOotImpactDecision>().notNull(),
    rationale: text("rationale").notNull(),
    // Suspect window: last known-good calibration → the failing calibration.
    affectedPeriodStart: timestamp("affected_period_start"),
    affectedPeriodEnd: timestamp("affected_period_end"),
    // IATF 16949 §7.1.5.2.1 fields
    suspectProductShipped: boolean("suspect_product_shipped"),
    customerNotified: boolean("customer_notified"),
    // Actor provenance (portal user; append-only audit evidence)
    portalUserId: text("portal_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("asset_oot_impact_assessment_event_uidx").on(table.eventId),
  ],
);

export const assetOotAuditLog = pgTable(
  "asset_oot_audit_log",
  {
    id: serial("id").primaryKey(),
    // Soft reference on purpose — NO FK. Append-only audit trail: the row
    // must survive deletion of the event (customer's own audit evidence).
    eventId: integer("event_id").notNull(),
    action: text("action").notNull(), // 'create', 'notify', 'assess'
    changes: jsonb("changes"),
    performedBy: text("performed_by")
      .notNull()
      .references(() => user.id),
    performedAt: timestamp("performed_at").defaultNow().notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
  },
  (table) => [
    index("asset_oot_audit_log_event_id_idx").on(table.eventId),
    index("asset_oot_audit_log_performed_at_idx").on(table.performedAt),
  ],
);

export const assetOotEventRelations = relations(
  assetOotEvent,
  ({ one, many }) => ({
    job: one(calibrationJob, {
      fields: [assetOotEvent.jobId],
      references: [calibrationJob.id],
    }),
    asset: one(asset, {
      fields: [assetOotEvent.assetId],
      references: [asset.id],
    }),
    customer: one(customer, {
      fields: [assetOotEvent.customerId],
      references: [customer.id],
    }),
    labOrganization: one(organization, {
      fields: [assetOotEvent.labOrganizationId],
      references: [organization.id],
    }),
    assessments: many(assetOotImpactAssessment),
  }),
);

export const assetOotImpactAssessmentRelations = relations(
  assetOotImpactAssessment,
  ({ one }) => ({
    event: one(assetOotEvent, {
      fields: [assetOotImpactAssessment.eventId],
      references: [assetOotEvent.id],
    }),
    portalUser: one(user, {
      fields: [assetOotImpactAssessment.portalUserId],
      references: [user.id],
      relationName: "assetOotAssessor",
    }),
  }),
);

export const assetOotAuditLogRelations = relations(
  assetOotAuditLog,
  ({ one }) => ({
    event: one(assetOotEvent, {
      fields: [assetOotAuditLog.eventId],
      references: [assetOotEvent.id],
    }),
    performedByUser: one(user, {
      fields: [assetOotAuditLog.performedBy],
      references: [user.id],
    }),
  }),
);
