// Tables of the "identity" area. Part of the schema entry packages/db/src/schema.ts.
import type {
  OrganizationEmailDomainKeyStatus,
  OrganizationEmailDomainStatus,
  OrganizationUnitStatus,
  OrganizationStatus,
} from "@calibra-facil/schemas/machines";
import {
  pgTable,
  text,
  timestamp,
  boolean,
  index,
  unique,
  uniqueIndex,
  serial,
  jsonb,
  integer,
} from "drizzle-orm/pg-core";
import { calendarDate } from "../calendar-date";
import type { ScopeEnforcementMode } from "@calibra-facil/shared";

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
    // Vigência window. The seal only renders when the emission date
    // falls inside [validFrom, validUntil]; null bounds impose no constraint.
    accreditationValidFrom: calendarDate("accreditation_valid_from"),
    accreditationValidUntil: calendarDate("accreditation_valid_until"),
    // Accredited-scope (CMC) guard behavior. 'warn' only classifies;
    // 'enforce' blocks accredited
    // approval on scope violations unless a documented override downgrades
    // the issuance to non-accredited (seal suppressed). NULL = the lab never
    // chose: the effective mode is
    // `resolveScopeEnforcementMode` (enforce while accredited, else warn), so
    // an explicit choice is never overridden by the default.
    scopeEnforcementMode: text(
      "scope_enforcement_mode",
    ).$type<ScopeEnforcementMode>(),
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
    // Records retention (docs/architecture/records-retention.md). A LAB organization is never hard-deleted while it
    // holds regulated records: it is soft-deleted (deleted_at, which also
    // suspends it so nobody signs in) and only the purge job may remove the row,
    // once the newest evidence is older than retention_years and no legal hold
    // applies. The CHECKs (retention_years >= 5, soft-delete implies SUSPENDED)
    // and the DELETE guard trigger live in sql/schema-extras.sql.
    deletedAt: timestamp("deleted_at"),
    deletedBy: text("deleted_by").references(() => user.id, {
      onDelete: "set null",
    }),
    deletionReason: text("deletion_reason"),
    retentionYears: integer("retention_years").default(10).notNull(),
    legalHold: boolean("legal_hold").default(false).notNull(),
    legalHoldReason: text("legal_hold_reason"),
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
      .references(() => organization.id, { onDelete: "restrict" }),
    profileId: integer("profile_id")
      .notNull()
      .references(() => certificateNumberingProfile.id, {
        onDelete: "restrict",
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
    // Evidence trail: a soft reference on purpose (no FK, like the other
    // audit tables), so the row survives deletion of its organization.
    organizationId: text("organization_id").notNull(),
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
     * When true, certificate emission REQUIRES an active signing
     * certificate — a missing cert fails the job (REJECTED) instead of emitting
     * unsigned. Signing FAILURES always fail regardless of this flag.
     */
    requireSignature: boolean("require_signature").default(false).notNull(),
    /**
     * The unit issues certificates UNSIGNED on purpose.
     * Non-null = the setting is on, and this is its mandatory justification.
     * Only an admin/owner sets it, never implicitly (an expired certificate does
     * not): without it a unit that has ever had a signing certificate fails
     * closed when none is valid. The change is audited in
     * `organization_event_log`; who/when are kept here.
     */
    unsignedIssuanceReason: text("unsigned_issuance_reason"),
    unsignedIssuanceSetBy: text("unsigned_issuance_set_by").references(
      () => user.id,
      { onDelete: "set null" },
    ),
    unsignedIssuanceSetAt: timestamp("unsigned_issuance_set_at"),
    /**
     * The unit as a distinct calibrating body
     * (ISO/IEC 17025 §7.8.2.1(a)): its own legal name, CNPJ and address. A unit
     * that declares a CNPJ is a distinct establishment and its block is printed
     * on the certificates it issues; otherwise the organization's profile is
     * the calibrating body. Frozen with the certificate input at approval.
     */
    legalName: text("legal_name"),
    cnpj: text("cnpj"),
    street: text("street"),
    number: text("number"),
    complement: text("complement"),
    neighbourhood: text("neighbourhood"),
    city: text("city"),
    state: text("state"),
    cep: text("cep"),
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
    // Target of the composite (id, organization) foreign keys of tenant children.
    unique("organization_unit_id_org_uidx").on(table.id, table.organizationId),
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
    // Evidence trail: a soft reference on purpose (no FK, like the other
    // audit tables), so the row survives deletion of its organization.
    organizationId: text("organization_id").notNull(),
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

/** BYOK now; "managed" is the future shared-platform-account mode. */
export type OrganizationEmailDomainMode = "byok" | "managed";

/** Mirrors Resend's domain status vocabulary. */

/**
 * Lab-owned email sending domain. One per lab org. The lab brings
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
    /** After this instant the key no longer authenticates (null: no expiry, keys made before 0137). */
    expiresAt: timestamp("expires_at"),
    /** Client addresses or CIDR ranges the key is accepted from; null or empty: any. */
    allowedIps: jsonb("allowed_ips").$type<string[]>(),
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
    // Soft references on purpose — NO FK. Append-only audit trail
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

// =============================================================================
// ORGANIZATION SIGNING CERTIFICATE - ICP-Brasil Digital Signature (ISO 7.8.2.1)
// =============================================================================

/**
 * Stores ICP-Brasil A1 certificates (PKCS#12) per organization.
 * Password is encrypted with AES-256-GCM using a master key from the environment (SIGNING_MASTER_KEY).
 * Enables PDF signing for calibration certificates (ICP-Brasil, MP 2.200-2 /
 * DOC-ICP-15.03, not NIT-DICLA-083).
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
    // Key custody. `kek_id` names the master key the credential's
    // data keys are wrapped under (NULL for a legacy row); `custody_format_version`
    // is 1 for the legacy storage (P12 and password straight under the master key)
    // and 2 for the envelope (per-field data key wrapped by the KEK, AAD =
    // organization + unit + serial). The CHECK that keeps the two in step lives in
    // sql/schema-extras.sql (migration 0133).
    kekId: text("kek_id"),
    custodyFormatVersion: integer("custody_format_version")
      .default(1)
      .notNull(),
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

// Append-only audit of the laboratory's compliance configuration
// (ISO/IEC 17025 8.4): signing-credential create / replace / delete,
// the "emitir sem assinatura" switch, the signing policy, and the accreditation
// profile (number, scope guard, seal settings). `changes` holds the before and
// after values and never a secret (no P12, password or key material). The row is
// written in the same transaction as the change; the append-only trigger and the
// REVOKE of UPDATE/DELETE from calibra_app live in sql/schema-extras.sql
// (migration 0133).
export const organizationComplianceAuditLog = pgTable(
  "organization_compliance_audit_log",
  {
    id: serial("id").primaryKey(),
    // Evidence trail: a soft reference on purpose (no FK, like the other
    // audit tables), so the row survives deletion of its organization.
    organizationId: text("organization_id").notNull(),
    unitId: integer("unit_id").references(() => organizationUnit.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    changes: jsonb("changes").$type<Record<string, unknown>>(),
    // NULL when the platform acted (the re-encrypt CLI).
    performedBy: text("performed_by").references(() => user.id, {
      onDelete: "set null",
    }),
    ipAddress: text("ip_address"),
    performedAt: timestamp("performed_at").defaultNow().notNull(),
  },
  (table) => [
    index("organization_compliance_audit_org_idx").on(table.organizationId),
    index("organization_compliance_audit_action_idx").on(table.action),
    index("organization_compliance_audit_performed_at_idx").on(
      table.performedAt,
    ),
  ],
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
