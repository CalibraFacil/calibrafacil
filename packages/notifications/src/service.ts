import { db } from "@calibra-facil/db";
import {
  notification,
  notificationPreference,
  member,
  user,
  accreditedScopeLine,
  calibrationJob,
  customer,
  asset,
  referenceStandard,
  paymentHistory,
  personnelCompetence,
  calibrationRequest,
  calibrationRequestItem,
  calibrationVisit,
  visitRescheduleRequest,
  organization,
  organizationCustomDomain,
  organizationSigningCertificate,
  organizationUnit,
  customerGroup,
  portalExportJob,
  ptPlanItem,
  type CustomerAddress,
  type NotificationType,
  type NotificationPriority,
  type NotificationChannel,
  type NotificationRelatedEntity,
  type NotificationPreferenceMap,
} from "@calibra-facil/db/schema";
import {
  eq,
  and,
  asc,
  desc,
  inArray,
  isNull,
  isNotNull,
  lt,
  lte,
  sql,
} from "drizzle-orm";
import {
  portalDigestFrequenciesFor,
  quantityKindLabelPt,
} from "@calibra-facil/shared";
import { buildLegalVerificationMessage } from "./legal-verification-message";
import { buildCertificateAmendedLinks } from "./portal-links";
import { isEmailSuppressed } from "./suppression";
import {
  formatLabFromHeader,
  resolveLabEmailSender,
  sendEmailWithLabSender,
} from "@calibra-facil/email-sender";
import { Resend } from "resend";
import { render } from "@react-email/render";
import {
  NotificationEmail,
  AuditPackReadyEmail,
  CertificateAmendedEmail,
  JobNotificationEmail,
  CertificateReadyEmail,
  AssetOotEmail,
  ComplianceAlertEmail,
  PaymentNotificationEmail,
  NCNotificationEmail,
  CompetenceNotificationEmail,
  CustomerSuccessEmail,
  CalibrationRequestEmail,
  VisitNotificationEmail,
  PortalDueDigestEmail,
  type PortalDueDigestItem,
  type EmailBrand,
} from "@calibra-facil/email";

// Track if email misconfiguration warning has been logged this session
let emailMisconfigWarningLogged = false;

// =============================================================================
// TYPES
// =============================================================================

/** Context for job-related email templates */
export interface JobEmailContext {
  jobId: string;
  jobInternalId: number;
  actorName?: string;
  reason?: string;
}

/** Context for certificate ready email templates */
export interface AssetOotEmailContext {
  assetTag: string;
  assetName?: string;
  jobId: string;
  portalUrl: string;
}

export interface CertificateEmailContext {
  jobId: string;
  originalJobId?: string;
  assetName?: string;
  customerName?: string;
  reason?: string;
  portalUrl: string;
}

/** Context for the audit-pack ready email template (#738) */
export interface AuditPackEmailContext {
  customerName?: string;
  periodLabel: string;
  certificateCount: number;
  expiresAtLabel?: string;
  portalUrl: string;
}

/** Context for compliance alert email templates */
export interface ComplianceEmailContext {
  itemName: string;
  dueDate: string;
  daysRemaining: number;
}

/** Context for payment email templates */
export interface PaymentEmailContext {
  amount?: string;
  description?: string;
}

/** Context for NC email templates */
export interface NCEmailContext {
  ncNumber: string;
  ncType?: "work" | "equipment" | "documentation" | "out_of_tolerance";
  description?: string;
  capaNumber?: string;
  actorName?: string;
}

/** Context for competence email templates */
export interface CompetenceEmailContext {
  subjectName: string;
  scopeDescription: string;
  dueDate?: string;
  daysRemaining?: number;
  actorName?: string;
}

/** Context for calibration request email templates */
export interface CalibrationRequestEmailContext {
  requestId: number;
  customerName: string;
  labName?: string;
  itemCount: number;
  requestedDueDate?: string;
  actorName?: string;
  reason?: string;
  jobCodes?: string[];
}

/** Context for on-site visit (calibração in loco) email templates */
export interface VisitEmailContext {
  customerName: string;
  scheduledDate: string;
  technicianName?: string;
  addressText?: string;
  labName?: string;
  reason?: string;
}

/** Union type for all email contexts */
export type EmailContext =
  | { type: "job"; data: JobEmailContext }
  | { type: "certificate"; data: CertificateEmailContext }
  | { type: "assetOot"; data: AssetOotEmailContext }
  | { type: "auditPack"; data: AuditPackEmailContext }
  | { type: "compliance"; data: ComplianceEmailContext }
  | { type: "payment"; data: PaymentEmailContext }
  | { type: "nc"; data: NCEmailContext }
  | { type: "competence"; data: CompetenceEmailContext }
  | { type: "calibrationRequest"; data: CalibrationRequestEmailContext }
  | { type: "visit"; data: VisitEmailContext }
  | { type: "customerSuccess"; data: Record<string, never> };

export interface SendNotificationOptions {
  recipientUserId: string;
  organizationId: string;
  type: NotificationType;
  priority?: NotificationPriority;
  title: string;
  message: string;
  relatedEntity?: NotificationRelatedEntity;
  actionUrl?: string;
  /** Optional context for specialized email templates */
  emailContext?: EmailContext;
  /** Lab/customer-facing visual identity. Omit for internal CalibraFácil emails. */
  emailBrand?: EmailBrand;
}

export interface NotificationResult {
  notificationId: number | null;
  channels: NotificationChannel[];
  emailSent: boolean;
}

// Default preferences when user has none set
const DEFAULT_PREFERENCES: NotificationPreferenceMap = {
  JOB_SUBMITTED_FOR_REVIEW: { inApp: true, email: true },
  JOB_APPROVED: { inApp: true, email: true },
  JOB_REJECTED: { inApp: true, email: true },
  JOB_ASSIGNED: { inApp: true, email: false },
  CERTIFICATE_READY: { inApp: true, email: true },
  CERTIFICATE_AMENDED: { inApp: true, email: true },
  AUDIT_PACK_READY: { inApp: true, email: true },
  ASSET_DUE_FOR_RECALIBRATION: { inApp: true, email: true },
  ASSET_DUE_FOR_LEGAL_VERIFICATION: { inApp: true, email: true },
  STANDARD_EXPIRING: { inApp: true, email: true },
  STANDARD_EXPIRED: { inApp: true, email: true },
  SIGNING_CERTIFICATE_EXPIRING: { inApp: true, email: true },
  JOB_OVERDUE: { inApp: true, email: true },
  PAYMENT_RECEIVED: { inApp: true, email: true },
  PAYMENT_FAILED: { inApp: true, email: true },
  NC_CREATED: { inApp: true, email: true },
  NC_ESCALATED_TO_CAPA: { inApp: true, email: true },
  OOT_NOTIFICATION_ACKNOWLEDGED: { inApp: true, email: true },
  COMPETENCE_EXPIRING: { inApp: true, email: true },
  COMPETENCE_EXPIRED: { inApp: true, email: true },
  COMPETENCE_REQUESTED: { inApp: true, email: true },
  COMPETENCE_APPROVED: { inApp: true, email: true },
  CUSTOMER_SUCCESS_WORKFLOW_BLOCKED: { inApp: true, email: true },
  CUSTOMER_SUCCESS_GO_LIVE_AT_RISK: { inApp: true, email: true },
  CUSTOMER_SUCCESS_NEXT_ACTION_OVERDUE: { inApp: true, email: true },
  CUSTOMER_SUCCESS_SLA_DUE_SOON: { inApp: true, email: true },
  CUSTOMER_SUCCESS_SLA_BREACHED: { inApp: true, email: true },
  CUSTOMER_SUCCESS_ESCALATION_REQUIRED: { inApp: true, email: true },
  SUPPORT_REQUEST_REPLIED: { inApp: true, email: true },
  CALIBRATION_REQUEST_SUBMITTED: { inApp: true, email: true },
  CALIBRATION_REQUEST_UNDER_REVIEW: { inApp: true, email: true },
  CALIBRATION_REQUEST_APPROVED: { inApp: true, email: true },
  CALIBRATION_REQUEST_REJECTED: { inApp: true, email: true },
  CALIBRATION_REQUEST_CONVERTED: { inApp: true, email: true },
};

// =============================================================================
// CORE NOTIFICATION SERVICE
// =============================================================================

/**
 * Get user's notification preferences
 */
async function getUserPreferences(userId: string): Promise<{
  preferences: NotificationPreferenceMap;
  emailEnabled: boolean;
  notifySelfActions: boolean;
}> {
  const [prefs] = await db
    .select()
    .from(notificationPreference)
    .where(eq(notificationPreference.userId, userId))
    .limit(1);

  if (!prefs) {
    return {
      preferences: DEFAULT_PREFERENCES,
      emailEnabled: true,
      notifySelfActions: false,
    };
  }

  return {
    preferences: prefs.preferences,
    emailEnabled: prefs.emailEnabled,
    notifySelfActions: prefs.notifySelfActions,
  };
}

/**
 * Core notification dispatcher that respects user preferences
 */
export async function sendNotification(
  options: SendNotificationOptions,
): Promise<NotificationResult> {
  const {
    recipientUserId,
    organizationId,
    type,
    priority = "MEDIUM",
    title,
    message,
    relatedEntity,
    actionUrl,
    emailContext,
    emailBrand,
  } = options;

  // Get user preferences
  const { preferences, emailEnabled } =
    await getUserPreferences(recipientUserId);
  const typePrefs = preferences[type] ?? { inApp: true, email: true };

  const channelsSent: NotificationChannel[] = [];
  let notificationId: number | null = null;
  let emailSent = false;

  // Create in-app notification if enabled
  if (typePrefs.inApp) {
    const [created] = await db
      .insert(notification)
      .values({
        recipientUserId,
        organizationId,
        type,
        priority,
        title,
        message,
        relatedEntity,
        actionUrl,
        channelsSent: ["IN_APP"],
        status: "UNREAD",
      })
      .returning();

    if (created) {
      notificationId = created.id;
      channelsSent.push("IN_APP");
    }
  }

  // Send email if enabled
  if (typePrefs.email && emailEnabled) {
    const emailResult = await sendNotificationEmail({
      recipientUserId,
      type,
      title,
      message,
      actionUrl,
      emailContext,
      emailBrand,
    });

    if (emailResult) {
      channelsSent.push("EMAIL");
      emailSent = true;

      // Update notification record with email channel
      if (notificationId) {
        await db
          .update(notification)
          .set({ channelsSent })
          .where(eq(notification.id, notificationId));
      }
    }
  }

  return { notificationId, channels: channelsSent, emailSent };
}

/**
 * Map notification type to job notification email type
 */
function getJobEmailType(
  type: NotificationType,
): "submitted" | "approved" | "rejected" | "assigned" | "overdue" {
  switch (type) {
    case "JOB_SUBMITTED_FOR_REVIEW":
      return "submitted";
    case "JOB_APPROVED":
      return "approved";
    case "JOB_REJECTED":
      return "rejected";
    case "JOB_ASSIGNED":
      return "assigned";
    case "JOB_OVERDUE":
      return "overdue";
    default:
      return "submitted";
  }
}

function getCompetenceEmailType(
  type: NotificationType,
): "expiring" | "expired" | "requested" | "approved" {
  switch (type) {
    case "COMPETENCE_EXPIRING":
      return "expiring";
    case "COMPETENCE_EXPIRED":
      return "expired";
    case "COMPETENCE_REQUESTED":
      return "requested";
    case "COMPETENCE_APPROVED":
      return "approved";
    default:
      return "expiring";
  }
}

function getCalibrationRequestEmailType(
  type: NotificationType,
): "submitted" | "underReview" | "approved" | "rejected" | "converted" {
  switch (type) {
    case "CALIBRATION_REQUEST_SUBMITTED":
      return "submitted";
    case "CALIBRATION_REQUEST_UNDER_REVIEW":
      return "underReview";
    case "CALIBRATION_REQUEST_APPROVED":
      return "approved";
    case "CALIBRATION_REQUEST_REJECTED":
      return "rejected";
    case "CALIBRATION_REQUEST_CONVERTED":
      return "converted";
    default:
      return "submitted";
  }
}

function getVisitEmailType(
  type: NotificationType,
):
  | "scheduled"
  | "confirmed"
  | "rescheduled"
  | "reschedule_declined"
  | "cancelled"
  | "reminder" {
  switch (type) {
    case "VISIT_SCHEDULED":
      return "scheduled";
    case "VISIT_CONFIRMED":
      return "confirmed";
    case "VISIT_RESCHEDULED":
      return "rescheduled";
    case "VISIT_RESCHEDULE_DECLINED":
      return "reschedule_declined";
    case "VISIT_CANCELLED":
      return "cancelled";
    case "VISIT_REMINDER":
      return "reminder";
    default:
      return "confirmed";
  }
}

function isCustomerSuccessType(
  type: NotificationType,
): type is
  | "CUSTOMER_SUCCESS_WORKFLOW_BLOCKED"
  | "CUSTOMER_SUCCESS_GO_LIVE_AT_RISK"
  | "CUSTOMER_SUCCESS_NEXT_ACTION_OVERDUE"
  | "CUSTOMER_SUCCESS_SLA_DUE_SOON"
  | "CUSTOMER_SUCCESS_SLA_BREACHED"
  | "CUSTOMER_SUCCESS_ESCALATION_REQUIRED" {
  return type.startsWith("CUSTOMER_SUCCESS_");
}

function getEmailLogoSrc(): string {
  const explicitLogoUrl = process.env.EMAIL_LOGO_URL;
  if (explicitLogoUrl) return explicitLogoUrl;

  const appUrl = process.env.WEB_URL ?? process.env.APP_URL;
  if (appUrl) return `${appUrl.replace(/\/$/, "")}/logo192.png`;

  return "https://calibrafacil.com/logo192.png";
}

function sanitizeMailHeader(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function getEmailAddress(value: string): string {
  const match = value.match(/<([^>]+)>/);
  return match?.[1]?.trim() ?? value.trim();
}

function formatFromEmail(fromEmail: string, brand: EmailBrand | undefined) {
  if (!brand?.isWhiteLabel) return fromEmail;

  return `${sanitizeMailHeader(brand.name)} via CalibraFácil <${getEmailAddress(fromEmail)}>`;
}

function getReplyToEmail(brand: EmailBrand | undefined): string | undefined {
  const email = brand?.supportEmail?.trim();
  if (!email || !email.includes("@")) return undefined;
  return sanitizeMailHeader(email);
}

function getWebBaseUrl(): string {
  return (
    process.env.WEB_URL ??
    process.env.APP_URL ??
    "https://calibrafacil.com"
  ).replace(/\/$/, "");
}

function getPortalBaseUrl(): string {
  return (
    process.env.PORTAL_APP_URL ??
    process.env.PORTAL_URL ??
    "https://portal.calibrafacil.com"
  ).replace(/\/$/, "");
}

function formatLabAddress(
  lab: Pick<
    typeof organization.$inferSelect,
    | "street"
    | "number"
    | "complement"
    | "neighbourhood"
    | "city"
    | "state"
    | "cep"
  >,
): string | undefined {
  const streetLine = [lab.street, lab.number, lab.complement]
    .filter(Boolean)
    .join(", ");
  const cityLine = [
    lab.neighbourhood,
    [lab.city, lab.state].filter(Boolean).join(" - "),
    lab.cep ? `CEP ${lab.cep}` : undefined,
  ]
    .filter(Boolean)
    .join(", ");
  const address = [streetLine, cityLine].filter(Boolean).join(" · ");

  return address || undefined;
}

function createLabEmailBrand(
  lab: Pick<
    typeof organization.$inferSelect,
    | "name"
    | "logo"
    | "cnpj"
    | "accreditationNumber"
    | "accreditationBody"
    | "street"
    | "number"
    | "complement"
    | "neighbourhood"
    | "city"
    | "state"
    | "cep"
    | "phone"
    | "email"
    | "website"
  >,
): EmailBrand {
  const accreditation = [lab.accreditationBody, lab.accreditationNumber]
    .filter(Boolean)
    .join(" ");
  const legalLines = [
    lab.cnpj ? `CNPJ ${lab.cnpj}` : undefined,
    accreditation ? `Acreditação ${accreditation}` : undefined,
    formatLabAddress(lab),
    lab.phone ? `Telefone: ${lab.phone}` : undefined,
  ].filter((line): line is string => Boolean(line));

  return {
    name: lab.name,
    logoSrc: lab.logo ?? getEmailLogoSrc(),
    footerLegalLines: legalLines,
    supportEmail: lab.email ?? undefined,
    website: lab.website ?? undefined,
    isWhiteLabel: true,
  };
}

/**
 * Platform-variant copy of a brand: same identity, shared envelope. Used when
 * a lab-sender attempt falls back so the rendered HTML (which shows/hides the
 * "via CalibraFácil" wording) always matches the actual envelope.
 */
function stripBrandSender(
  brand: EmailBrand | undefined,
): EmailBrand | undefined {
  if (!brand?.sender) return brand;
  return { ...brand, sender: undefined };
}

export async function getLabEmailBrand(
  organizationId: string,
): Promise<EmailBrand | undefined> {
  const [lab] = await db
    .select({
      name: organization.name,
      logo: organization.logo,
      cnpj: organization.cnpj,
      accreditationNumber: organization.accreditationNumber,
      accreditationBody: organization.accreditationBody,
      street: organization.street,
      number: organization.number,
      complement: organization.complement,
      neighbourhood: organization.neighbourhood,
      city: organization.city,
      state: organization.state,
      cep: organization.cep,
      phone: organization.phone,
      email: organization.email,
      website: organization.website,
    })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1);

  const brand = lab ? createLabEmailBrand(lab) : undefined;
  if (!brand) return undefined;

  // Lab-owned sending domain (#584): when the org has a verified + active
  // email domain (and the entitlement), sends carry a first-party envelope.
  const sender = await resolveLabEmailSender(organizationId);
  if (sender) {
    brand.sender = {
      organizationId: sender.organizationId,
      fromAddress: sender.fromAddress,
    };
  }

  return brand;
}

function resolveEmailActionUrl(
  actionUrl: string | undefined,
): string | undefined {
  if (!actionUrl) return undefined;

  try {
    return new URL(actionUrl).toString();
  } catch {
    if (actionUrl === "/portal" || actionUrl.startsWith("/portal/")) {
      const portalPath = actionUrl.replace(/^\/portal(?=\/|$)/, "");
      return `${getPortalBaseUrl()}${portalPath || "/"}`;
    }

    return `${getWebBaseUrl()}${actionUrl.startsWith("/") ? actionUrl : `/${actionUrl}`}`;
  }
}

/**
 * Render the appropriate email template based on notification type
 */
function renderEmailTemplate(
  type: NotificationType,
  recipientName: string,
  title: string,
  message: string,
  actionUrl: string | undefined,
  emailContext: EmailContext | undefined,
  logoSrc: string,
  emailBrand: EmailBrand | undefined,
): React.ReactElement {
  // Job notifications
  if (
    emailContext?.type === "job" &&
    [
      "JOB_SUBMITTED_FOR_REVIEW",
      "JOB_APPROVED",
      "JOB_REJECTED",
      "JOB_ASSIGNED",
      "JOB_OVERDUE",
    ].includes(type)
  ) {
    const { jobId, actorName, reason } = emailContext.data;
    return JobNotificationEmail({
      recipientName,
      type: getJobEmailType(type),
      jobId,
      message,
      actorName,
      reason,
      actionUrl: actionUrl ?? "#",
      logoSrc,
      brand: emailBrand,
    });
  }

  // Certificate ready notification
  if (emailContext?.type === "certificate" && type === "CERTIFICATE_READY") {
    const { jobId, assetName, customerName, portalUrl } = emailContext.data;
    return CertificateReadyEmail({
      recipientName,
      jobId,
      assetName,
      customerName,
      portalUrl,
      logoSrc,
      brand: emailBrand,
    });
  }

  // Asset found out of tolerance as-found (#740, ISO 9001 7.1.5.2)
  if (
    emailContext?.type === "assetOot" &&
    type === "ASSET_FOUND_OUT_OF_TOLERANCE"
  ) {
    const { assetTag, assetName, jobId, portalUrl } = emailContext.data;
    return AssetOotEmail({
      recipientName,
      assetTag,
      assetName,
      jobId,
      portalUrl,
      logoSrc,
      brand: emailBrand,
    });
  }

  // Audit pack ready notification (#738)
  if (emailContext?.type === "auditPack" && type === "AUDIT_PACK_READY") {
    const {
      customerName,
      periodLabel,
      certificateCount,
      expiresAtLabel,
      portalUrl,
    } = emailContext.data;
    return AuditPackReadyEmail({
      recipientName,
      customerName,
      periodLabel,
      certificateCount,
      expiresAtLabel,
      portalUrl,
      logoSrc,
      brand: emailBrand,
    });
  }

  if (emailContext?.type === "certificate" && type === "CERTIFICATE_AMENDED") {
    const { jobId, originalJobId, assetName, customerName, reason, portalUrl } =
      emailContext.data;
    return CertificateAmendedEmail({
      recipientName,
      originalJobId: originalJobId ?? jobId,
      amendedJobId: jobId,
      assetName,
      customerName,
      reason: reason ?? message,
      actionUrl: actionUrl ?? portalUrl,
      logoSrc,
      brand: emailBrand,
    });
  }

  // Compliance alerts
  if (
    emailContext?.type === "compliance" &&
    [
      "ASSET_DUE_FOR_RECALIBRATION",
      "ASSET_DUE_FOR_LEGAL_VERIFICATION",
      "STANDARD_EXPIRING",
      "STANDARD_EXPIRED",
    ].includes(type)
  ) {
    const { itemName, dueDate, daysRemaining } = emailContext.data;
    return ComplianceAlertEmail({
      recipientName,
      type:
        type === "ASSET_DUE_FOR_RECALIBRATION" ||
        type === "ASSET_DUE_FOR_LEGAL_VERIFICATION"
          ? "asset"
          : type === "STANDARD_EXPIRED"
            ? "standardExpired"
            : "standard",
      itemName,
      dueDate,
      daysRemaining,
      actionUrl: actionUrl ?? "#",
      logoSrc,
      brand: emailBrand,
    });
  }

  // Payment notifications
  if (
    emailContext?.type === "payment" &&
    ["PAYMENT_RECEIVED", "PAYMENT_FAILED"].includes(type)
  ) {
    const { amount, description } = emailContext.data;
    return PaymentNotificationEmail({
      recipientName,
      type: type === "PAYMENT_RECEIVED" ? "received" : "failed",
      amount,
      description,
      actionUrl,
      logoSrc,
      brand: emailBrand,
    });
  }

  // NC notifications
  if (
    emailContext?.type === "nc" &&
    ["NC_CREATED", "NC_ESCALATED_TO_CAPA"].includes(type)
  ) {
    const { ncNumber, ncType, description, capaNumber, actorName } =
      emailContext.data;
    return NCNotificationEmail({
      recipientName,
      type: type === "NC_CREATED" ? "created" : "escalated",
      ncNumber,
      ncType,
      description,
      capaNumber,
      actorName,
      actionUrl: actionUrl ?? "#",
      logoSrc,
      brand: emailBrand,
    });
  }

  if (
    emailContext?.type === "competence" &&
    [
      "COMPETENCE_EXPIRING",
      "COMPETENCE_EXPIRED",
      "COMPETENCE_REQUESTED",
      "COMPETENCE_APPROVED",
    ].includes(type)
  ) {
    const { subjectName, scopeDescription, dueDate, daysRemaining, actorName } =
      emailContext.data;
    return CompetenceNotificationEmail({
      recipientName,
      type: getCompetenceEmailType(type),
      subjectName,
      scopeDescription,
      dueDate,
      daysRemaining,
      actorName,
      actionUrl: actionUrl ?? "#",
      logoSrc,
      brand: emailBrand,
    });
  }

  if (
    emailContext?.type === "calibrationRequest" &&
    [
      "CALIBRATION_REQUEST_SUBMITTED",
      "CALIBRATION_REQUEST_UNDER_REVIEW",
      "CALIBRATION_REQUEST_APPROVED",
      "CALIBRATION_REQUEST_REJECTED",
      "CALIBRATION_REQUEST_CONVERTED",
    ].includes(type)
  ) {
    const {
      requestId,
      customerName,
      labName,
      itemCount,
      requestedDueDate,
      actorName,
      reason,
      jobCodes,
    } = emailContext.data;

    return CalibrationRequestEmail({
      recipientName,
      type: getCalibrationRequestEmailType(type),
      requestId,
      customerName,
      labName,
      itemCount,
      requestedDueDate,
      actorName,
      reason,
      jobCodes,
      actionUrl: actionUrl ?? "#",
      logoSrc,
      brand: emailBrand,
    });
  }

  if (
    emailContext?.type === "visit" &&
    [
      "VISIT_SCHEDULED",
      "VISIT_CONFIRMED",
      "VISIT_RESCHEDULED",
      "VISIT_RESCHEDULE_DECLINED",
      "VISIT_CANCELLED",
      "VISIT_REMINDER",
    ].includes(type)
  ) {
    const {
      customerName,
      scheduledDate,
      technicianName,
      addressText,
      labName,
      reason,
    } = emailContext.data;
    return VisitNotificationEmail({
      recipientName,
      variant: getVisitEmailType(type),
      customerName,
      scheduledDate,
      technicianName,
      addressText,
      labName,
      reason,
      actionUrl: actionUrl ?? "#",
      logoSrc,
      brand: emailBrand,
    });
  }

  if (isCustomerSuccessType(type)) {
    return CustomerSuccessEmail({
      recipientName,
      type,
      title,
      message,
      actionUrl,
      logoSrc,
      brand: emailBrand,
    });
  }

  // Fallback to generic notification email
  return NotificationEmail({
    recipientName,
    title,
    message,
    actionUrl,
    actionLabel: "Ver Detalhes",
    logoSrc,
    brand: emailBrand,
  });
}

/**
 * Send notification email using Resend and React Email templates
 */
async function sendNotificationEmail(options: {
  recipientUserId: string;
  type: NotificationType;
  title: string;
  message: string;
  actionUrl?: string;
  emailContext?: EmailContext;
  emailBrand?: EmailBrand;
}): Promise<boolean> {
  const {
    recipientUserId,
    type,
    title,
    message,
    actionUrl,
    emailContext,
    emailBrand,
  } = options;

  // Check if Resend is configured - log warning once per session
  const resendApiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL;

  if (!resendApiKey || !fromEmail) {
    if (!emailMisconfigWarningLogged) {
      console.error(
        "[Notifications] EMAIL MISCONFIGURED: RESEND_API_KEY or RESEND_FROM_EMAIL not set. " +
          "Users will only receive in-app notifications, no emails will be sent.",
      );
      emailMisconfigWarningLogged = true;
    }
    return false;
  }

  // Get user email
  const [userData] = await db
    .select({ email: user.email, name: user.name })
    .from(user)
    .where(eq(user.id, recipientUserId))
    .limit(1);

  if (!userData?.email) {
    console.warn(`[Notifications] User ${recipientUserId} has no email`);
    return false;
  }

  // Honor the suppression list (bounces/unsubscribes) on every send through
  // this path — customer-facing notifications must never override it.
  if (await isEmailSuppressed(userData.email, "all")) {
    return false;
  }

  try {
    const recipientName = userData.name ?? "Usuário";
    const logoSrc = getEmailLogoSrc();
    const emailActionUrl = resolveEmailActionUrl(actionUrl);

    // Lab-sender first when the brand carries one (#584); the payload is
    // (re-)rendered per variant so the HTML matches the actual envelope.
    const outcome = await sendEmailWithLabSender({
      organizationId: emailBrand?.sender?.organizationId,
      platformApiKey: resendApiKey,
      buildPayload: async (sender) => {
        const brandVariant = sender ? emailBrand : stripBrandSender(emailBrand);
        const emailElement = renderEmailTemplate(
          type,
          recipientName,
          title,
          message,
          emailActionUrl,
          emailContext,
          logoSrc,
          brandVariant,
        );
        const html = await render(emailElement);
        return {
          from:
            sender && brandVariant
              ? formatLabFromHeader(brandVariant.name, sender.fromAddress)
              : formatFromEmail(fromEmail, brandVariant),
          to: userData.email,
          subject: title,
          html,
          replyTo: getReplyToEmail(brandVariant),
        };
      },
    });

    if (!outcome.sent) {
      console.error("[Notifications] Failed to send email:", outcome.error);
    }
    return outcome.sent;
  } catch (error) {
    console.error("[Notifications] Failed to send email:", error);
    return false;
  }
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get users by role in an organization
 */
export async function getRecipientsByRole(
  organizationId: string,
  roles: string[],
): Promise<string[]> {
  const members = await db
    .select({ userId: member.userId })
    .from(member)
    .where(
      and(
        eq(member.organizationId, organizationId),
        inArray(member.role, roles),
      ),
    );

  return members.map((m) => m.userId);
}

/**
 * Get job details for notification context
 */
async function getJobDetails(jobId: number): Promise<{
  jobIdentifier: string;
  organizationId: string;
  technicianId: string | null;
  customerId: number;
  assetId: number;
  createdBy: string;
} | null> {
  const [job] = await db
    .select({
      jobIdentifier: calibrationJob.jobId,
      organizationId: calibrationJob.organizationId,
      technicianId: calibrationJob.technicianId,
      customerId: calibrationJob.customerId,
      assetId: calibrationJob.assetId,
      createdBy: calibrationJob.createdBy,
    })
    .from(calibrationJob)
    .where(eq(calibrationJob.id, jobId))
    .limit(1);

  return job ?? null;
}

/**
 * Get asset details for notification context
 */
async function getAssetDetails(assetId: number): Promise<{
  name: string;
  tag: string;
  manufacturer: string | null;
  model: string | null;
} | null> {
  const [assetData] = await db
    .select({
      name: asset.name,
      tag: asset.tag,
      manufacturer: asset.manufacturer,
      model: asset.model,
    })
    .from(asset)
    .where(eq(asset.id, assetId))
    .limit(1);

  return assetData ?? null;
}

async function getActorName(userId: string): Promise<string> {
  const [actor] = await db
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  return actor?.name ?? "Um usuário";
}

async function getCalibrationRequestDetails(requestId: number): Promise<{
  id: number;
  organizationId: string;
  authOrganizationId: string;
  submittedBy: string;
  customerName: string;
  labName: string;
  itemCount: number;
  requestedDueDate: Date | null;
} | null> {
  const [request] = await db
    .select({
      id: calibrationRequest.id,
      organizationId: calibrationRequest.organizationId,
      authOrganizationId: calibrationRequest.authOrganizationId,
      submittedBy: calibrationRequest.submittedBy,
      requestedDueDate: calibrationRequest.requestedDueDate,
      customerName: customer.name,
      labName: organization.name,
    })
    .from(calibrationRequest)
    .innerJoin(customer, eq(calibrationRequest.customerId, customer.id))
    .innerJoin(
      organization,
      eq(calibrationRequest.organizationId, organization.id),
    )
    .where(eq(calibrationRequest.id, requestId))
    .limit(1);

  if (!request) return null;

  const items = await db
    .select({ id: calibrationRequestItem.id })
    .from(calibrationRequestItem)
    .where(eq(calibrationRequestItem.requestId, requestId));

  return {
    ...request,
    itemCount: items.length,
  };
}

function createCalibrationRequestEmailContext(
  details: NonNullable<
    Awaited<ReturnType<typeof getCalibrationRequestDetails>>
  >,
  extras: {
    actorName?: string;
    reason?: string;
    jobCodes?: string[];
  } = {},
): CalibrationRequestEmailContext {
  return {
    requestId: details.id,
    customerName: details.customerName,
    labName: details.labName,
    itemCount: details.itemCount,
    requestedDueDate: details.requestedDueDate
      ? formatDateBR(details.requestedDueDate)
      : undefined,
    ...extras,
  };
}

export async function notifyCalibrationRequestSubmitted(
  requestId: number,
): Promise<void> {
  const details = await getCalibrationRequestDetails(requestId);
  if (!details) return;

  const recipients = await getRecipientsByRole(details.organizationId, [
    "owner",
    "admin",
    "operator",
  ]);

  for (const recipientId of recipients) {
    await sendNotification({
      recipientUserId: recipientId,
      organizationId: details.organizationId,
      type: "CALIBRATION_REQUEST_SUBMITTED",
      priority: "HIGH",
      title: "Nova solicitação de calibração",
      message: `${details.customerName} enviou a solicitação #${requestId} com ${details.itemCount} ${details.itemCount === 1 ? "item" : "itens"}.`,
      relatedEntity: {
        entityType: "request",
        entityId: requestId,
      },
      actionUrl: `/dashboard/requests/${requestId}`,
      emailContext: {
        type: "calibrationRequest",
        data: createCalibrationRequestEmailContext(details),
      },
    });
  }
}

export async function notifyCalibrationRequestUnderReview(
  requestId: number,
  actorUserId: string,
): Promise<void> {
  const details = await getCalibrationRequestDetails(requestId);
  if (!details || details.submittedBy === actorUserId) return;

  const actorName = await getActorName(actorUserId);
  const emailBrand = await getLabEmailBrand(details.organizationId);

  await sendNotification({
    recipientUserId: details.submittedBy,
    organizationId: details.authOrganizationId,
    type: "CALIBRATION_REQUEST_UNDER_REVIEW",
    priority: "MEDIUM",
    title: "Solicitação em análise",
    message: `${details.labName} começou a analisar a solicitação #${requestId}.`,
    relatedEntity: {
      entityType: "request",
      entityId: requestId,
    },
    actionUrl: `/portal/requests/${requestId}`,
    emailContext: {
      type: "calibrationRequest",
      data: createCalibrationRequestEmailContext(details, { actorName }),
    },
    emailBrand,
  });
}

export async function notifyCalibrationRequestApproved(
  requestId: number,
  actorUserId: string,
): Promise<void> {
  const details = await getCalibrationRequestDetails(requestId);
  if (!details || details.submittedBy === actorUserId) return;

  const actorName = await getActorName(actorUserId);
  const emailBrand = await getLabEmailBrand(details.organizationId);

  await sendNotification({
    recipientUserId: details.submittedBy,
    organizationId: details.authOrganizationId,
    type: "CALIBRATION_REQUEST_APPROVED",
    priority: "HIGH",
    title: "Solicitação de calibração aprovada",
    message: `${details.labName} aprovou a solicitação #${requestId}.`,
    relatedEntity: {
      entityType: "request",
      entityId: requestId,
    },
    actionUrl: `/portal/requests/${requestId}`,
    emailContext: {
      type: "calibrationRequest",
      data: createCalibrationRequestEmailContext(details, { actorName }),
    },
    emailBrand,
  });
}

export async function notifyCalibrationRequestRejected(
  requestId: number,
  actorUserId: string,
  reason: string,
): Promise<void> {
  const details = await getCalibrationRequestDetails(requestId);
  if (!details || details.submittedBy === actorUserId) return;

  const actorName = await getActorName(actorUserId);
  const emailBrand = await getLabEmailBrand(details.organizationId);

  await sendNotification({
    recipientUserId: details.submittedBy,
    organizationId: details.authOrganizationId,
    type: "CALIBRATION_REQUEST_REJECTED",
    priority: "HIGH",
    title: "Solicitação de calibração recusada",
    message: `${details.labName} recusou a solicitação #${requestId}. Motivo: ${reason}`,
    relatedEntity: {
      entityType: "request",
      entityId: requestId,
    },
    actionUrl: `/portal/requests/${requestId}`,
    emailContext: {
      type: "calibrationRequest",
      data: createCalibrationRequestEmailContext(details, {
        actorName,
        reason,
      }),
    },
    emailBrand,
  });
}

export async function notifyCalibrationRequestConverted(
  requestId: number,
  actorUserId: string,
  jobCodes: string[],
): Promise<void> {
  const details = await getCalibrationRequestDetails(requestId);
  if (!details || details.submittedBy === actorUserId) return;

  const actorName = await getActorName(actorUserId);
  const emailBrand = await getLabEmailBrand(details.organizationId);

  await sendNotification({
    recipientUserId: details.submittedBy,
    organizationId: details.authOrganizationId,
    type: "CALIBRATION_REQUEST_CONVERTED",
    priority: "HIGH",
    title: "Solicitação convertida em ordem de serviço",
    message: `${details.labName} converteu a solicitação #${requestId} em ${jobCodes.length} ${jobCodes.length === 1 ? "ordem de serviço" : "ordens de serviço"}.`,
    relatedEntity: {
      entityType: "request",
      entityId: requestId,
    },
    actionUrl: `/portal/requests/${requestId}`,
    emailContext: {
      type: "calibrationRequest",
      data: createCalibrationRequestEmailContext(details, {
        actorName,
        jobCodes,
      }),
    },
    emailBrand,
  });
}

// =============================================================================
// NOTIFICATION TRIGGERS - Called from visit routes (calibração in loco)
// =============================================================================

/**
 * Formats the visit's on-site address to a single-line text string for the
 * customer email. Mirrors the API-side `formatOnsiteAddressText` used to
 * freeze the calibration location snapshot at job-creation time.
 */
function formatVisitAddressText(
  address: CustomerAddress | null,
): string | undefined {
  if (!address) return undefined;
  const street = [address.street, address.number].filter(Boolean).join(", ");
  const region = [address.neighbourhood, address.city, address.state]
    .filter(Boolean)
    .join(" - ");
  const text = [street, address.complement, region, address.cep]
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join(" · ");
  return text || undefined;
}

function formatVisitDate(date: Date | null): string {
  if (!date) return "data a confirmar";
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  });
}

async function getVisitDetails(visitId: number): Promise<{
  id: number;
  organizationId: string;
  technicianId: string | null;
  scheduledAt: Date | null;
  sourceRequestId: number | null;
  address: CustomerAddress | null;
  customerName: string;
  labName: string;
  technicianName: string | null;
  requestSubmittedBy: string | null;
  requestAuthOrganizationId: string | null;
} | null> {
  const [visit] = await db
    .select({
      id: calibrationVisit.id,
      organizationId: calibrationVisit.organizationId,
      technicianId: calibrationVisit.technicianId,
      scheduledAt: calibrationVisit.scheduledAt,
      sourceRequestId: calibrationVisit.sourceRequestId,
      address: calibrationVisit.address,
      customerName: customer.name,
      labName: organization.name,
      technicianName: user.name,
      requestSubmittedBy: calibrationRequest.submittedBy,
      requestAuthOrganizationId: calibrationRequest.authOrganizationId,
    })
    .from(calibrationVisit)
    .innerJoin(customer, eq(calibrationVisit.customerId, customer.id))
    .innerJoin(
      organization,
      eq(calibrationVisit.organizationId, organization.id),
    )
    .leftJoin(user, eq(calibrationVisit.technicianId, user.id))
    .leftJoin(
      calibrationRequest,
      eq(calibrationVisit.sourceRequestId, calibrationRequest.id),
    )
    .where(eq(calibrationVisit.id, visitId))
    .limit(1);

  return visit ?? null;
}

/**
 * Notify the assigned technician when an on-site visit is scheduled/assigned.
 * Fired on convert (and on assign). No-op when the visit has no technician.
 */
export async function notifyVisitScheduled(
  visitId: number,
  actorUserId: string,
): Promise<void> {
  const visit = await getVisitDetails(visitId);
  if (!visit || !visit.technicianId) return;

  const isSelfAssignment = visit.technicianId === actorUserId;
  if (isSelfAssignment) {
    const { notifySelfActions } = await getUserPreferences(visit.technicianId);
    if (!notifySelfActions) return;
  }

  const actorName = isSelfAssignment ? "Você" : await getActorName(actorUserId);
  const visitDate = formatVisitDate(visit.scheduledAt);

  await sendNotification({
    recipientUserId: visit.technicianId,
    organizationId: visit.organizationId,
    type: "VISIT_SCHEDULED",
    priority: "MEDIUM",
    title: "Nova visita no local",
    message: isSelfAssignment
      ? `Você assumiu a visita ao cliente ${visit.customerName} (${visitDate}).`
      : `${actorName} agendou uma visita ao cliente ${visit.customerName} (${visitDate}) para você.`,
    relatedEntity: {
      entityType: "visit",
      entityId: visitId,
    },
    actionUrl: "/dashboard/visits",
  });
}

/**
 * Notify the customer (request submitter) when their on-site visit is confirmed.
 * Fired on confirm. No-op when the visit has no linked portal request.
 */
export async function notifyVisitConfirmed(
  visitId: number,
  actorUserId: string,
): Promise<void> {
  const visit = await getVisitDetails(visitId);
  if (!visit || !visit.requestSubmittedBy || !visit.requestAuthOrganizationId) {
    return;
  }
  if (visit.requestSubmittedBy === actorUserId) return;

  const emailBrand = await getLabEmailBrand(visit.organizationId);
  const visitDate = formatVisitDate(visit.scheduledAt);
  const technicianSuffix = visit.technicianName
    ? ` com o técnico ${visit.technicianName}`
    : "";

  await sendNotification({
    recipientUserId: visit.requestSubmittedBy,
    organizationId: visit.requestAuthOrganizationId,
    type: "VISIT_CONFIRMED",
    priority: "HIGH",
    title: "Visita no local confirmada",
    message: `${visit.labName} confirmou a visita de calibração no local para ${visitDate}${technicianSuffix}.`,
    relatedEntity: {
      entityType: "visit",
      entityId: visitId,
    },
    actionUrl: visit.sourceRequestId
      ? `/portal/requests/${visit.sourceRequestId}`
      : "/portal/requests",
    emailBrand,
    emailContext: {
      type: "visit",
      data: {
        customerName: visit.customerName,
        scheduledDate: visitDate,
        technicianName: visit.technicianName ?? undefined,
        addressText: formatVisitAddressText(visit.address),
        labName: visit.labName,
      },
    },
  });
}

/**
 * Notify the technician + customer when an on-site visit is rescheduled.
 * No-op for the recipient that triggered the change.
 */
export async function notifyVisitRescheduled(
  visitId: number,
  actorUserId: string,
): Promise<void> {
  const visit = await getVisitDetails(visitId);
  if (!visit) return;

  const visitDate = formatVisitDate(visit.scheduledAt);

  if (visit.technicianId && visit.technicianId !== actorUserId) {
    await sendNotification({
      recipientUserId: visit.technicianId,
      organizationId: visit.organizationId,
      type: "VISIT_RESCHEDULED",
      priority: "MEDIUM",
      title: "Visita no local reagendada",
      message: `A visita ao cliente ${visit.customerName} foi reagendada para ${visitDate}.`,
      relatedEntity: { entityType: "visit", entityId: visitId },
      actionUrl: "/dashboard/visits",
    });
  }

  if (
    visit.requestSubmittedBy &&
    visit.requestAuthOrganizationId &&
    visit.requestSubmittedBy !== actorUserId
  ) {
    await sendNotification({
      recipientUserId: visit.requestSubmittedBy,
      organizationId: visit.requestAuthOrganizationId,
      type: "VISIT_RESCHEDULED",
      priority: "HIGH",
      title: "Visita no local reagendada",
      message: `${visit.labName} reagendou sua visita de calibração no local para ${visitDate}.`,
      relatedEntity: { entityType: "visit", entityId: visitId },
      actionUrl: visit.sourceRequestId
        ? `/portal/requests/${visit.sourceRequestId}`
        : "/portal/requests",
      emailBrand: await getLabEmailBrand(visit.organizationId),
      emailContext: {
        type: "visit",
        data: {
          customerName: visit.customerName,
          scheduledDate: visitDate,
          technicianName: visit.technicianName ?? undefined,
          addressText: formatVisitAddressText(visit.address),
          labName: visit.labName,
        },
      },
    });
  }
}

/**
 * Notify the technician + customer when an on-site visit is cancelled.
 * No-op for the recipient that triggered the cancellation.
 */
export async function notifyVisitCancelled(
  visitId: number,
  actorUserId: string,
  reason?: string,
): Promise<void> {
  const visit = await getVisitDetails(visitId);
  if (!visit) return;

  const reasonSuffix = reason?.trim() ? ` Motivo: ${reason.trim()}.` : "";

  if (visit.technicianId && visit.technicianId !== actorUserId) {
    await sendNotification({
      recipientUserId: visit.technicianId,
      organizationId: visit.organizationId,
      type: "VISIT_CANCELLED",
      priority: "MEDIUM",
      title: "Visita no local cancelada",
      message: `A visita ao cliente ${visit.customerName} foi cancelada.${reasonSuffix}`,
      relatedEntity: { entityType: "visit", entityId: visitId },
      actionUrl: "/dashboard/visits",
    });
  }

  if (
    visit.requestSubmittedBy &&
    visit.requestAuthOrganizationId &&
    visit.requestSubmittedBy !== actorUserId
  ) {
    await sendNotification({
      recipientUserId: visit.requestSubmittedBy,
      organizationId: visit.requestAuthOrganizationId,
      type: "VISIT_CANCELLED",
      priority: "HIGH",
      title: "Visita no local cancelada",
      message: `${visit.labName} cancelou sua visita de calibração no local.${reasonSuffix}`,
      relatedEntity: { entityType: "visit", entityId: visitId },
      actionUrl: visit.sourceRequestId
        ? `/portal/requests/${visit.sourceRequestId}`
        : "/portal/requests",
      emailBrand: await getLabEmailBrand(visit.organizationId),
      emailContext: {
        type: "visit",
        data: {
          customerName: visit.customerName,
          scheduledDate: formatVisitDate(visit.scheduledAt),
          technicianName: visit.technicianName ?? undefined,
          addressText: formatVisitAddressText(visit.address),
          labName: visit.labName,
          reason: reason?.trim() || undefined,
        },
      },
    });
  }
}

/**
 * Remind the technician + customer that an on-site visit is coming up.
 * Driven by the scheduled-notifications cron (no actor — system reminder).
 */
export async function notifyVisitReminder(visitId: number): Promise<void> {
  const visit = await getVisitDetails(visitId);
  if (!visit) return;

  const visitDate = formatVisitDate(visit.scheduledAt);

  if (visit.technicianId) {
    await sendNotification({
      recipientUserId: visit.technicianId,
      organizationId: visit.organizationId,
      type: "VISIT_REMINDER",
      priority: "MEDIUM",
      title: "Lembrete de visita no local",
      message: `Lembrete: visita ao cliente ${visit.customerName} em ${visitDate}.`,
      relatedEntity: { entityType: "visit", entityId: visitId },
      actionUrl: "/dashboard/visits",
    });
  }

  if (visit.requestSubmittedBy && visit.requestAuthOrganizationId) {
    await sendNotification({
      recipientUserId: visit.requestSubmittedBy,
      organizationId: visit.requestAuthOrganizationId,
      type: "VISIT_REMINDER",
      priority: "MEDIUM",
      title: "Lembrete de visita no local",
      message: `Lembrete: ${visit.labName} fará a visita de calibração no local em ${visitDate}.`,
      relatedEntity: { entityType: "visit", entityId: visitId },
      actionUrl: visit.sourceRequestId
        ? `/portal/requests/${visit.sourceRequestId}`
        : "/portal/requests",
      emailBrand: await getLabEmailBrand(visit.organizationId),
      emailContext: {
        type: "visit",
        data: {
          customerName: visit.customerName,
          scheduledDate: visitDate,
          technicianName: visit.technicianName ?? undefined,
          addressText: formatVisitAddressText(visit.address),
          labName: visit.labName,
        },
      },
    });
  }
}

const VISIT_LAB_STAFF_ROLES = ["owner", "admin", "operator"];

/**
 * #739: notify the lab (unit staff) that the portal customer confirmed
 * attendance for a visit — schedulers chase only the unconfirmed ones.
 */
export async function notifyVisitCustomerConfirmed(
  visitId: number,
  actorUserId: string,
): Promise<void> {
  const visit = await getVisitDetails(visitId);
  if (!visit) return;

  const visitDate = formatVisitDate(visit.scheduledAt);
  const recipients = await getRecipientsByRole(
    visit.organizationId,
    VISIT_LAB_STAFF_ROLES,
  );

  for (const recipientId of recipients) {
    if (recipientId === actorUserId) continue;
    await sendNotification({
      recipientUserId: recipientId,
      organizationId: visit.organizationId,
      type: "VISIT_CUSTOMER_CONFIRMED",
      priority: "MEDIUM",
      title: "Cliente confirmou presença na visita",
      message: `${visit.customerName} confirmou que estará pronto para receber o técnico em ${visitDate}.`,
      relatedEntity: { entityType: "visit", entityId: visitId },
      actionUrl: `/dashboard/visits/${visitId}`,
    });
  }
}

/**
 * #739: notify the lab (unit staff) that the portal customer asked to
 * reschedule a visit — actionable: someone must accept or decline.
 */
export async function notifyVisitRescheduleRequested(
  visitId: number,
  actorUserId: string,
): Promise<void> {
  const visit = await getVisitDetails(visitId);
  if (!visit) return;

  const visitDate = formatVisitDate(visit.scheduledAt);
  const recipients = await getRecipientsByRole(
    visit.organizationId,
    VISIT_LAB_STAFF_ROLES,
  );

  for (const recipientId of recipients) {
    if (recipientId === actorUserId) continue;
    await sendNotification({
      recipientUserId: recipientId,
      organizationId: visit.organizationId,
      type: "VISIT_RESCHEDULE_REQUESTED",
      priority: "HIGH",
      title: "Cliente solicitou reagendamento de visita",
      message: `${visit.customerName} solicitou o reagendamento da visita de ${visitDate}. Aceite ou recuse a solicitação.`,
      relatedEntity: { entityType: "visit", entityId: visitId },
      actionUrl: `/dashboard/visits/${visitId}`,
    });
  }
}

/**
 * Resolve the portal (CLIENT) organization for a customer: the customer's own
 * linked org, or its group's org in multi-unit (group) mode.
 */
async function getPortalOrgForCustomer(
  customerId: number,
): Promise<string | null> {
  const [row] = await db
    .select({
      authOrganizationId: customer.authOrganizationId,
      groupAuthOrganizationId: customerGroup.authOrganizationId,
    })
    .from(customer)
    .leftJoin(customerGroup, eq(customer.groupId, customerGroup.id))
    .where(eq(customer.id, customerId))
    .limit(1);
  return row?.authOrganizationId ?? row?.groupAuthOrganizationId ?? null;
}

/**
 * #739: notify the requesting portal user that the lab declined their
 * reschedule request (the visit keeps its date). The recipient is whoever
 * opened the most recently declined request, not the original request
 * submitter — in group mode those can differ.
 */
export async function notifyVisitRescheduleDeclined(
  visitId: number,
  actorUserId: string,
  reason?: string,
): Promise<void> {
  const visit = await getVisitDetails(visitId);
  if (!visit) return;

  const [declined] = await db
    .select({
      requestedBy: visitRescheduleRequest.requestedBy,
      customerId: visitRescheduleRequest.customerId,
    })
    .from(visitRescheduleRequest)
    .where(
      and(
        eq(visitRescheduleRequest.visitId, visitId),
        eq(visitRescheduleRequest.status, "DECLINED"),
      ),
    )
    .orderBy(
      desc(visitRescheduleRequest.resolvedAt),
      desc(visitRescheduleRequest.id),
    )
    .limit(1);
  if (!declined || declined.requestedBy === actorUserId) return;

  const portalOrgId = await getPortalOrgForCustomer(declined.customerId);
  if (!portalOrgId) return;

  const visitDate = formatVisitDate(visit.scheduledAt);

  await sendNotification({
    recipientUserId: declined.requestedBy,
    organizationId: portalOrgId,
    type: "VISIT_RESCHEDULE_DECLINED",
    priority: "HIGH",
    title: "Reagendamento não foi possível",
    message: reason
      ? `${visit.labName} não pôde reagendar a visita de ${visitDate}: ${reason}`
      : `${visit.labName} não pôde reagendar a visita de ${visitDate}. A data original está mantida.`,
    relatedEntity: { entityType: "visit", entityId: visitId },
    actionUrl: "/portal/calendar",
    emailBrand: await getLabEmailBrand(visit.organizationId),
    emailContext: {
      type: "visit",
      data: {
        customerName: visit.customerName,
        scheduledDate: visitDate,
        technicianName: visit.technicianName ?? undefined,
        addressText: formatVisitAddressText(visit.address),
        labName: visit.labName,
        reason,
      },
    },
  });
}

// =============================================================================
// NOTIFICATION TRIGGERS - Called from job routes
// =============================================================================

/**
 * Notify admins/owners when a job is submitted for review
 */
export async function notifyJobSubmittedForReview(
  jobId: number,
  submittedByUserId: string,
): Promise<void> {
  const job = await getJobDetails(jobId);
  if (!job) return;

  // Get submitter name
  const [submitter] = await db
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, submittedByUserId))
    .limit(1);

  const submitterName = submitter?.name ?? "Um tecnico";

  // Get admins and owners
  const recipients = await getRecipientsByRole(job.organizationId, [
    "admin",
    "owner",
  ]);

  // Send to each recipient (except the submitter)
  for (const recipientId of recipients) {
    if (recipientId === submittedByUserId) continue;

    await sendNotification({
      recipientUserId: recipientId,
      organizationId: job.organizationId,
      type: "JOB_SUBMITTED_FOR_REVIEW",
      priority: "HIGH",
      title: "Calibração aguardando revisão",
      message: `${submitterName} submeteu a OS ${job.jobIdentifier} para revisão.`,
      relatedEntity: {
        entityType: "job",
        entityId: jobId,
        jobId: job.jobIdentifier,
      },
      actionUrl: `/dashboard/jobs/${jobId}`,
      emailContext: {
        type: "job",
        data: {
          jobId: job.jobIdentifier,
          jobInternalId: jobId,
          actorName: submitterName,
        },
      },
    });
  }
}

/**
 * Notify technician when their job is approved
 */
export async function notifyJobApproved(
  jobId: number,
  approvedByUserId: string,
): Promise<void> {
  const job = await getJobDetails(jobId);
  if (!job) return;

  // Get approver name
  const [approver] = await db
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, approvedByUserId))
    .limit(1);

  const approverName = approver?.name ?? "Um gestor";

  // Notify the technician (or job creator if no technician assigned)
  const recipientId = job.technicianId ?? job.createdBy;

  // Don't notify if the approver is the same as the recipient
  if (recipientId === approvedByUserId) return;

  await sendNotification({
    recipientUserId: recipientId,
    organizationId: job.organizationId,
    type: "JOB_APPROVED",
    priority: "HIGH",
    title: "Calibração aprovada",
    message: `${approverName} aprovou a OS ${job.jobIdentifier}. O certificado está sendo gerado.`,
    relatedEntity: {
      entityType: "job",
      entityId: jobId,
      jobId: job.jobIdentifier,
    },
    actionUrl: `/dashboard/jobs/${jobId}`,
    emailContext: {
      type: "job",
      data: {
        jobId: job.jobIdentifier,
        jobInternalId: jobId,
        actorName: approverName,
      },
    },
  });
}

/**
 * Notify technician when their job is rejected
 */
export async function notifyJobRejected(
  jobId: number,
  rejectedByUserId: string,
  reason: string,
): Promise<void> {
  const job = await getJobDetails(jobId);
  if (!job) return;

  // Get rejector name
  const [rejector] = await db
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, rejectedByUserId))
    .limit(1);

  const rejectorName = rejector?.name ?? "Um gestor";

  // Notify the technician (or job creator if no technician assigned)
  const recipientId = job.technicianId ?? job.createdBy;

  // Don't notify if the rejector is the same as the recipient
  if (recipientId === rejectedByUserId) return;

  await sendNotification({
    recipientUserId: recipientId,
    organizationId: job.organizationId,
    type: "JOB_REJECTED",
    priority: "HIGH",
    title: "Calibração rejeitada",
    message: `${rejectorName} rejeitou a OS ${job.jobIdentifier}. Motivo: ${reason}`,
    relatedEntity: {
      entityType: "job",
      entityId: jobId,
      jobId: job.jobIdentifier,
    },
    actionUrl: `/dashboard/jobs/${jobId}`,
    emailContext: {
      type: "job",
      data: {
        jobId: job.jobIdentifier,
        jobInternalId: jobId,
        actorName: rejectorName,
        reason,
      },
    },
  });
}

/**
 * Notify technician when a job is assigned to them
 */
export async function notifyJobAssigned(
  jobId: number,
  technicianId: string,
  assignedByUserId: string,
): Promise<void> {
  const job = await getJobDetails(jobId);
  if (!job) return;

  // Check if this is a self-assignment
  const isSelfAssignment = technicianId === assignedByUserId;

  if (isSelfAssignment) {
    // Check user's preference for self-action notifications
    const { notifySelfActions } = await getUserPreferences(technicianId);
    if (!notifySelfActions) return;
  }

  // Get assigner name
  const [assigner] = await db
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, assignedByUserId))
    .limit(1);

  const assignerName = isSelfAssignment
    ? "Você"
    : (assigner?.name ?? "Um gestor");

  await sendNotification({
    recipientUserId: technicianId,
    organizationId: job.organizationId,
    type: "JOB_ASSIGNED",
    priority: "MEDIUM",
    title: "Nova calibração atribuída",
    message: isSelfAssignment
      ? `Você atribuiu a OS ${job.jobIdentifier} para si mesmo.`
      : `${assignerName} atribuiu a OS ${job.jobIdentifier} para você.`,
    relatedEntity: {
      entityType: "job",
      entityId: jobId,
      jobId: job.jobIdentifier,
    },
    actionUrl: `/dashboard/jobs/${jobId}`,
    emailContext: {
      type: "job",
      data: {
        jobId: job.jobIdentifier,
        jobInternalId: jobId,
        actorName: assignerName,
      },
    },
  });
}

/**
 * Notify client portal users when a certificate is ready
 */
export async function notifyCertificateReady(jobId: number): Promise<void> {
  const job = await getJobDetails(jobId);
  if (!job) return;

  // Get the customer's organization ID and name
  const [customerData] = await db
    .select({
      authOrganizationId: customer.authOrganizationId,
      name: customer.name,
    })
    .from(customer)
    .where(eq(customer.id, job.customerId))
    .limit(1);

  if (!customerData?.authOrganizationId) return;

  // Get asset details
  const assetData = await getAssetDetails(job.assetId);

  // Get all portal users in the customer organization
  const portalUsers = await db
    .select({ userId: member.userId })
    .from(member)
    .where(eq(member.organizationId, customerData.authOrganizationId));

  const portalUrl = `${getPortalBaseUrl()}/certificates`;
  const emailBrand = await getLabEmailBrand(job.organizationId);

  // Send email notifications to all portal users
  for (const portalUser of portalUsers) {
    await sendNotification({
      recipientUserId: portalUser.userId,
      organizationId: customerData.authOrganizationId,
      type: "CERTIFICATE_READY",
      priority: "HIGH",
      title: "Certificado de calibração disponível",
      message: `O certificado da OS ${job.jobIdentifier} está pronto para download no portal.`,
      relatedEntity: {
        entityType: "job",
        entityId: jobId,
        jobId: job.jobIdentifier,
      },
      actionUrl: `/portal/certificates`,
      emailContext: {
        type: "certificate",
        data: {
          jobId: job.jobIdentifier,
          assetName: assetData?.name,
          customerName: customerData.name,
          portalUrl,
        },
      },
      emailBrand,
    });
  }
}

/**
 * Notify client portal users when their instrument was reproved in the
 * as-found ("como recebido") condition at certificate approval (#740 Track B).
 * The impact assessment is the CUSTOMER'S obligation (ISO 9001:2015 §7.1.5.2);
 * this only alerts and points at the portal workspace. Recipients mirror
 * notifyCertificateReady: every member of the customer's CLIENT org.
 */
export async function notifyAssetFoundOutOfTolerance(
  jobId: number,
): Promise<void> {
  const job = await getJobDetails(jobId);
  if (!job) return;

  const [customerData] = await db
    .select({
      authOrganizationId: customer.authOrganizationId,
      name: customer.name,
    })
    .from(customer)
    .where(eq(customer.id, job.customerId))
    .limit(1);

  if (!customerData?.authOrganizationId) return;

  const assetData = await getAssetDetails(job.assetId);

  const portalUsers = await db
    .select({ userId: member.userId })
    .from(member)
    .where(eq(member.organizationId, customerData.authOrganizationId));

  const portalUrl = `${getPortalBaseUrl()}/assets/${job.assetId}`;
  const emailBrand = await getLabEmailBrand(job.organizationId);
  const assetTag = assetData?.tag ?? String(job.assetId);

  for (const portalUser of portalUsers) {
    await sendNotification({
      recipientUserId: portalUser.userId,
      organizationId: customerData.authOrganizationId,
      type: "ASSET_FOUND_OUT_OF_TOLERANCE",
      priority: "HIGH",
      title: "Ação requerida: avaliar impacto",
      message: `O equipamento ${assetTag} foi reprovado na condição "como recebido" na calibração ${job.jobIdentifier}. Avalie o impacto sobre medições anteriores no portal.`,
      relatedEntity: {
        entityType: "asset",
        entityId: job.assetId,
      },
      actionUrl: `/portal/assets/${job.assetId}`,
      emailContext: {
        type: "assetOot",
        data: {
          assetTag,
          assetName: assetData?.name,
          jobId: job.jobIdentifier,
          portalUrl,
        },
      },
      emailBrand,
    });
  }
}

/**
 * Notify client portal users when an audit pack finished generating (#738).
 * Recipients are every member of the requesting CLIENT org (branch customer
 * or customer group) — the same audience that can see and download the pack
 * on the portal certificates page.
 */
export async function notifyAuditPackReady(exportId: number): Promise<void> {
  const [exportRow] = await db
    .select({
      id: portalExportJob.id,
      labOrganizationId: portalExportJob.labOrganizationId,
      authOrganizationId: portalExportJob.authOrganizationId,
      params: portalExportJob.params,
      certificateCount: portalExportJob.certificateCount,
      expiresAt: portalExportJob.expiresAt,
    })
    .from(portalExportJob)
    .where(eq(portalExportJob.id, exportId))
    .limit(1);

  if (!exportRow) return;

  const [authOrganization] = await db
    .select({ name: organization.name })
    .from(organization)
    .where(eq(organization.id, exportRow.authOrganizationId))
    .limit(1);

  const portalUsers = await db
    .select({ userId: member.userId })
    .from(member)
    .where(eq(member.organizationId, exportRow.authOrganizationId));

  const formatBr = (isoDate: string) => {
    const [year, month, day] = isoDate.split("-");
    return year && month && day ? `${day}/${month}/${year}` : isoDate;
  };
  const periodLabel = `${formatBr(exportRow.params.dateFrom)} a ${formatBr(exportRow.params.dateTo)}`;
  const expiresAtLabel = exportRow.expiresAt
    ? exportRow.expiresAt.toLocaleDateString("pt-BR", {
        timeZone: "America/Sao_Paulo",
      })
    : undefined;
  const portalUrl = `${getPortalBaseUrl()}/certificates`;
  const emailBrand = await getLabEmailBrand(exportRow.labOrganizationId);

  for (const portalUser of portalUsers) {
    await sendNotification({
      recipientUserId: portalUser.userId,
      organizationId: exportRow.authOrganizationId,
      type: "AUDIT_PACK_READY",
      priority: "HIGH",
      title: "Pacote de auditoria disponível",
      message: `O pacote de auditoria do período ${periodLabel} está pronto para download no portal.`,
      relatedEntity: {
        entityType: "audit_pack",
        entityId: exportId,
      },
      actionUrl: `/portal/certificates`,
      emailContext: {
        type: "auditPack",
        data: {
          customerName: authOrganization?.name,
          periodLabel,
          certificateCount: exportRow.certificateCount ?? 0,
          expiresAtLabel,
          portalUrl,
        },
      },
      emailBrand,
    });
  }
}

/**
 * Notify client portal users when a certificate is amended
 */
export async function notifyCertificateAmended(
  originalJobId: number,
  amendedJobId: number,
  reason: string,
): Promise<void> {
  const originalJob = await getJobDetails(originalJobId);
  const amendedJob = await getJobDetails(amendedJobId);
  if (!originalJob || !amendedJob) return;

  // Get the customer's organization ID and name
  const [customerData] = await db
    .select({
      authOrganizationId: customer.authOrganizationId,
      name: customer.name,
    })
    .from(customer)
    .where(eq(customer.id, originalJob.customerId))
    .limit(1);

  if (!customerData?.authOrganizationId) return;

  // Get asset details
  const assetData = await getAssetDetails(originalJob.assetId);

  // Get all portal users in the customer organization
  const portalUsers = await db
    .select({ userId: member.userId })
    .from(member)
    .where(eq(member.organizationId, customerData.authOrganizationId));

  // Deep-link to the superseded certificate's detail page (#744): it renders
  // the §7.8.8 supersession banner and links the retificação once issued —
  // the amendment itself is still DRAFT at this point.
  const { actionUrl, portalUrl } = buildCertificateAmendedLinks({
    portalBaseUrl: getPortalBaseUrl(),
    supersededJobIdentifier: originalJob.jobIdentifier,
  });
  const emailBrand = await getLabEmailBrand(originalJob.organizationId);

  // Send notifications to all portal users
  for (const portalUser of portalUsers) {
    await sendNotification({
      recipientUserId: portalUser.userId,
      organizationId: customerData.authOrganizationId,
      type: "CERTIFICATE_AMENDED",
      priority: "HIGH",
      title: "Certificado de calibração retificado",
      message: `O certificado ${originalJob.jobIdentifier} foi retificado. Novo certificado: ${amendedJob.jobIdentifier}. Motivo: ${reason}`,
      relatedEntity: {
        entityType: "job",
        entityId: amendedJobId,
        jobId: amendedJob.jobIdentifier,
      },
      actionUrl,
      emailContext: {
        type: "certificate",
        data: {
          jobId: amendedJob.jobIdentifier,
          originalJobId: originalJob.jobIdentifier,
          assetName: assetData?.name,
          customerName: customerData.name,
          reason,
          portalUrl,
        },
      },
      emailBrand,
    });
  }

  // Also notify lab admins/owners
  const labAdmins = await getRecipientsByRole(originalJob.organizationId, [
    "admin",
    "owner",
  ]);

  for (const adminId of labAdmins) {
    await sendNotification({
      recipientUserId: adminId,
      organizationId: originalJob.organizationId,
      type: "CERTIFICATE_AMENDED",
      priority: "HIGH",
      title: "Certificado retificado",
      message: `O certificado ${originalJob.jobIdentifier} foi retificado. Novo: ${amendedJob.jobIdentifier}. Motivo: ${reason}`,
      relatedEntity: {
        entityType: "job",
        entityId: amendedJobId,
        jobId: amendedJob.jobIdentifier,
      },
      actionUrl: `/dashboard/jobs/${amendedJobId}`,
      emailContext: {
        type: "certificate",
        data: {
          jobId: amendedJob.jobIdentifier,
          originalJobId: originalJob.jobIdentifier,
          assetName: assetData?.name,
          customerName: customerData.name,
          reason,
          portalUrl: `/dashboard/jobs/${amendedJobId}`,
        },
      },
    });
  }
}

// =============================================================================
// COMPLIANCE NOTIFICATION TRIGGERS
// =============================================================================

/**
 * Format a date to Brazilian format (DD/MM/YYYY)
 */
function formatDateBR(date: Date): string {
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/**
 * Calculate days remaining until a date
 */
function getDaysRemaining(dueDate: Date): number {
  const now = new Date();
  const diffTime = dueDate.getTime() - now.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Notify lab members when a customer's asset is due for recalibration
 * Called by a scheduled job that checks asset.nextCalibrationDate
 */
export async function notifyAssetDueForRecalibration(
  assetId: number,
  organizationId: string,
): Promise<void> {
  // Get asset details with customer info
  const [assetData] = await db
    .select({
      name: asset.name,
      serialNumber: asset.serialNumber,
      tag: asset.tag,
      nextCalibrationDate: asset.nextCalibrationDate,
      customerId: asset.customerId,
    })
    .from(asset)
    .where(eq(asset.id, assetId))
    .limit(1);

  if (!assetData?.nextCalibrationDate) return;

  // Get customer name
  const [customerData] = await db
    .select({ name: customer.name })
    .from(customer)
    .where(eq(customer.id, assetData.customerId))
    .limit(1);

  const daysRemaining = getDaysRemaining(assetData.nextCalibrationDate);
  const dueDate = formatDateBR(assetData.nextCalibrationDate);
  const assetIdentifier =
    assetData.tag || assetData.serialNumber || assetData.name;
  const itemName = customerData
    ? `${assetData.name} (${customerData.name})`
    : assetData.name;

  // Notify admins and owners of the lab
  const recipients = await getRecipientsByRole(organizationId, [
    "admin",
    "owner",
  ]);

  for (const recipientId of recipients) {
    await sendNotification({
      recipientUserId: recipientId,
      organizationId,
      type: "ASSET_DUE_FOR_RECALIBRATION",
      priority: daysRemaining <= 3 ? "HIGH" : "MEDIUM",
      title: "Ativo vencendo calibração",
      message: `O instrumento ${assetIdentifier} está com calibração vencendo em ${daysRemaining} dias (${dueDate}).`,
      relatedEntity: {
        entityType: "asset",
        entityId: assetId,
      },
      actionUrl: `/dashboard/assets/${assetId}`,
      emailContext: {
        type: "compliance",
        data: {
          itemName,
          dueDate,
          daysRemaining,
        },
      },
    });
  }
}

/**
 * Notify lab members when a customer's legal-metrology instrument is due for its
 * regulation-fixed VERIFICATION (Track 2 — Inmetro / RBMLQ-I), INDEPENDENTLY of
 * the recalibration reminder (`notifyAssetDueForRecalibration`). Called by the
 * scheduled sweep that checks asset.nextLegalVerificationDate for LEGAL-regime
 * instruments. No-ops for any asset whose `metrologyRegime` is not 'LEGAL' or
 * whose `nextLegalVerificationDate` is null.
 */
export async function notifyAssetDueForLegalVerification(
  assetId: number,
  organizationId: string,
): Promise<void> {
  // Get asset details with regime + regulated-interval info
  const [assetData] = await db
    .select({
      name: asset.name,
      serialNumber: asset.serialNumber,
      tag: asset.tag,
      metrologyRegime: asset.metrologyRegime,
      nextLegalVerificationDate: asset.nextLegalVerificationDate,
      regulatedInterval: asset.regulatedInterval,
      customerId: asset.customerId,
    })
    .from(asset)
    .where(eq(asset.id, assetId))
    .limit(1);

  // Track 2 only: never fire for a non-LEGAL regime or a missing legal-verification date.
  if (assetData?.metrologyRegime !== "LEGAL") return;
  if (!assetData.nextLegalVerificationDate) return;

  // Read the structured regulated interval defensively (stored loosely as
  // Record<string, unknown>; no `as` assertions — narrow by typeof).
  const regulated = assetData.regulatedInterval;
  const operationalizedByDelegate =
    regulated?.operationalizedByDelegate === true;
  const regulationRefValue = regulated?.regulationReference;
  const regulationReference =
    typeof regulationRefValue === "string" ? regulationRefValue : null;

  // Get customer name
  const [customerData] = await db
    .select({ name: customer.name })
    .from(customer)
    .where(eq(customer.id, assetData.customerId))
    .limit(1);

  const daysRemaining = getDaysRemaining(assetData.nextLegalVerificationDate);
  const dueDate = formatDateBR(assetData.nextLegalVerificationDate);
  const assetIdentifier =
    assetData.tag || assetData.serialNumber || assetData.name;
  const itemName = customerData
    ? `${assetData.name} (${customerData.name})`
    : assetData.name;

  const message = buildLegalVerificationMessage({
    assetIdentifier,
    dueDate,
    daysRemaining,
    operationalizedByDelegate,
    regulationReference,
  });

  // Notify admins and owners of the lab
  const recipients = await getRecipientsByRole(organizationId, [
    "admin",
    "owner",
  ]);

  for (const recipientId of recipients) {
    await sendNotification({
      recipientUserId: recipientId,
      organizationId,
      type: "ASSET_DUE_FOR_LEGAL_VERIFICATION",
      priority: daysRemaining <= 3 ? "HIGH" : "MEDIUM",
      title: "Verificação metrológica legal próxima",
      message,
      relatedEntity: {
        entityType: "asset",
        entityId: assetId,
      },
      actionUrl: `/dashboard/assets/${assetId}`,
      emailContext: {
        type: "compliance",
        data: {
          itemName,
          dueDate,
          daysRemaining,
        },
      },
    });
  }
}

/**
 * Notify lab members when a reference standard is expiring
 * Called by a scheduled job that checks referenceStandard.nextCalibrationDate
 */
export async function notifyStandardExpiring(
  standardId: number,
  organizationId: string,
): Promise<void> {
  // Get reference standard details
  const [standardData] = await db
    .select({
      name: referenceStandard.name,
      serialNumber: referenceStandard.serialNumber,
      certificateNumber: referenceStandard.certificateNumber,
      nextCalibrationDate: referenceStandard.nextCalibrationDate,
    })
    .from(referenceStandard)
    .where(eq(referenceStandard.id, standardId))
    .limit(1);

  if (!standardData?.nextCalibrationDate) return;

  const daysRemaining = getDaysRemaining(standardData.nextCalibrationDate);
  const dueDate = formatDateBR(standardData.nextCalibrationDate);
  const standardIdentifier =
    standardData.certificateNumber ||
    standardData.serialNumber ||
    standardData.name;
  const itemName = `${standardData.name} (${standardIdentifier})`;

  // Notify admins and owners of the lab
  const recipients = await getRecipientsByRole(organizationId, [
    "admin",
    "owner",
  ]);

  for (const recipientId of recipients) {
    await sendNotification({
      recipientUserId: recipientId,
      organizationId,
      type: "STANDARD_EXPIRING",
      priority: daysRemaining <= 3 ? "HIGH" : "MEDIUM",
      title: "Padrão de referência vencendo",
      message: `O padrão ${standardIdentifier} está com calibração vencendo em ${daysRemaining} dias (${dueDate}).`,
      relatedEntity: {
        entityType: "standard",
        entityId: standardId,
      },
      actionUrl: `/dashboard/standards/${standardId}`,
      emailContext: {
        type: "compliance",
        data: {
          itemName,
          dueDate,
          daysRemaining,
        },
      },
    });
  }
}

/**
 * Notify lab admins/owners when a proficiency-test participation-plan item is
 * due (or overdue) for its scope part — ISO/IEC 17025 §7.7.2 / issue #60.
 * Called by the scheduled sweep off ptPlanItem.nextDueAt.
 */
export async function notifyPtPlanDue(
  planItemId: number,
  organizationId: string,
): Promise<void> {
  const [planItem] = await db
    .select({
      scopePart: ptPlanItem.scopePart,
      nextDueAt: ptPlanItem.nextDueAt,
    })
    .from(ptPlanItem)
    .where(eq(ptPlanItem.id, planItemId))
    .limit(1);

  if (!planItem?.nextDueAt) return;

  const daysRemaining = getDaysRemaining(planItem.nextDueAt);
  const dueDate = formatDateBR(planItem.nextDueAt);
  const overdue = daysRemaining < 0;

  const recipients = await getRecipientsByRole(organizationId, [
    "admin",
    "owner",
  ]);

  for (const recipientId of recipients) {
    await sendNotification({
      recipientUserId: recipientId,
      organizationId,
      type: "PT_PLAN_DUE",
      priority: overdue ? "HIGH" : "MEDIUM",
      title: overdue
        ? "Participação em ensaio de proficiência vencida"
        : "Participação em ensaio de proficiência vencendo",
      message: overdue
        ? `O escopo "${planItem.scopePart}" está com a participação em ensaio de proficiência vencida desde ${dueDate} (ISO 17025 §7.7.2).`
        : `O escopo "${planItem.scopePart}" precisa de participação em ensaio de proficiência até ${dueDate} (${daysRemaining} dias).`,
      relatedEntity: {
        entityType: "pt_plan_item",
        entityId: planItemId,
      },
      actionUrl: `/dashboard/proficiency-tests/plan`,
      emailContext: {
        type: "compliance",
        data: {
          itemName: `Ensaio de proficiência — ${planItem.scopePart}`,
          dueDate,
          daysRemaining,
        },
      },
    });
  }
}

/**
 * Notify lab members when a reference standard is expired.
 * Called by scheduled jobs or manual checks that inspect referenceStandard.nextCalibrationDate.
 */
export async function notifyStandardExpired(
  standardId: number,
  organizationId: string,
): Promise<void> {
  const [standardData] = await db
    .select({
      name: referenceStandard.name,
      serialNumber: referenceStandard.serialNumber,
      certificateNumber: referenceStandard.certificateNumber,
      nextCalibrationDate: referenceStandard.nextCalibrationDate,
    })
    .from(referenceStandard)
    .where(eq(referenceStandard.id, standardId))
    .limit(1);

  if (!standardData?.nextCalibrationDate) return;

  const daysRemaining = getDaysRemaining(standardData.nextCalibrationDate);
  const dueDate = formatDateBR(standardData.nextCalibrationDate);
  const standardIdentifier =
    standardData.certificateNumber ||
    standardData.serialNumber ||
    standardData.name;
  const itemName = `${standardData.name} (${standardIdentifier})`;

  const recipients = await getRecipientsByRole(organizationId, [
    "admin",
    "owner",
  ]);

  for (const recipientId of recipients) {
    await sendNotification({
      recipientUserId: recipientId,
      organizationId,
      type: "STANDARD_EXPIRED",
      priority: "HIGH",
      title: "Padrão de referência vencido",
      message: `O padrão ${standardIdentifier} venceu em ${dueDate}. Atualize ou substitua antes de novas calibrações.`,
      relatedEntity: {
        entityType: "standard",
        entityId: standardId,
      },
      actionUrl: `/dashboard/standards/${standardId}`,
      emailContext: {
        type: "compliance",
        data: {
          itemName,
          dueDate,
          daysRemaining,
        },
      },
    });
  }
}

/**
 * Notify a lab's admins/owners that an ICP-Brasil A1 signing certificate is
 * nearing its `validUntil` (issue #645 · CMP-02). Called by the daily
 * compliance cron when a certificate enters an escalating lead window
 * (30/15/7 days). Reads validity only — never touches signing crypto.
 *
 * `daysRemaining`/`leadTimeDays` come from the pure decider so the copy stays
 * consistent with the window that triggered the alert.
 */
export async function notifySigningCertificateExpiring(
  certificateId: number,
  organizationId: string,
  context: { daysRemaining: number },
): Promise<void> {
  // Org-scoped read (defense in depth): a certificate id is globally unique,
  // but filtering by organizationId guarantees we never resolve/notify across
  // tenants. Join the unit so the alert names which unit's certificate expires.
  const [certData] = await db
    .select({
      name: organizationSigningCertificate.name,
      serialNumber: organizationSigningCertificate.serialNumber,
      validUntil: organizationSigningCertificate.validUntil,
      unitName: organizationUnit.name,
    })
    .from(organizationSigningCertificate)
    .innerJoin(
      organizationUnit,
      eq(organizationSigningCertificate.unitId, organizationUnit.id),
    )
    .where(
      and(
        eq(organizationSigningCertificate.id, certificateId),
        eq(organizationSigningCertificate.organizationId, organizationId),
      ),
    )
    .limit(1);

  if (!certData) return;

  const dueDate = formatDateBR(certData.validUntil);
  const daysRemaining = context.daysRemaining;
  const itemName = `${certData.name} (${certData.serialNumber}) — unidade ${certData.unitName}`;

  // Notify admins and owners of the lab
  const recipients = await getRecipientsByRole(organizationId, [
    "admin",
    "owner",
  ]);

  for (const recipientId of recipients) {
    await sendNotification({
      recipientUserId: recipientId,
      organizationId,
      type: "SIGNING_CERTIFICATE_EXPIRING",
      priority: daysRemaining <= 7 ? "HIGH" : "MEDIUM",
      title: "Certificado de assinatura expirando",
      message: `O certificado de assinatura ${certData.name} (${certData.serialNumber}) da unidade ${certData.unitName} expira em ${daysRemaining} ${daysRemaining === 1 ? "dia" : "dias"} (${dueDate}). Renove o certificado A1 ICP-Brasil antes do vencimento para manter a emissão assinada.`,
      actionUrl: "/dashboard/settings/signature",
      emailContext: {
        type: "compliance",
        data: {
          itemName,
          dueDate,
          daysRemaining,
        },
      },
    });
  }
}

/**
 * Warn lab admins/owners that the Cgcre/RBC accreditation vigência is nearing
 * its end (#647). Once expired, certificates of accredited-scope methods are
 * emitted WITHOUT the accreditation seal (decided 2026-07-05) — so the lab
 * must renew (or update the window) ahead of time.
 */
export async function notifyAccreditationExpiring(
  organizationId: string,
  context: { daysRemaining: number; validUntil: Date },
): Promise<void> {
  const dueDate = formatDateBR(context.validUntil);
  const daysRemaining = context.daysRemaining;

  const recipients = await getRecipientsByRole(organizationId, [
    "admin",
    "owner",
  ]);

  for (const recipientId of recipients) {
    await sendNotification({
      recipientUserId: recipientId,
      organizationId,
      type: "ACCREDITATION_EXPIRING",
      priority: daysRemaining <= 7 ? "HIGH" : "MEDIUM",
      title: "Acreditação com vigência expirando",
      message: `A vigência da acreditação Cgcre/RBC do laboratório termina em ${daysRemaining} ${daysRemaining === 1 ? "dia" : "dias"} (${dueDate}). Após o vencimento, certificados de métodos com escopo acreditado passam a ser emitidos SEM o selo da acreditação. Atualize a janela de vigência nas configurações após a renovação.`,
      actionUrl: "/dashboard/settings/organization",
      emailContext: {
        type: "compliance",
        data: {
          itemName: "Acreditação Cgcre/RBC",
          dueDate,
          daysRemaining,
        },
      },
    });
  }
}

/**
 * Warn lab admins/owners that one accredited-scope (CMC) line's vigência is
 * nearing its end (#427 Phase 2). Once the line expires, points it covered
 * stop matching and accredited issuance in that range classifies as
 * OUT_OF_SCOPE — blocking approval when the org enforces the guard.
 */
export async function notifyAccreditedScopeLineExpiring(
  scopeLineId: number,
  organizationId: string,
  context: { daysRemaining: number },
): Promise<void> {
  // Org-scoped read (defense in depth): never resolve/notify across tenants.
  // Join the unit so the alert names which site's scope line expires.
  const [lineData] = await db
    .select({
      quantityKind: accreditedScopeLine.quantityKind,
      rangeMin: accreditedScopeLine.rangeMin,
      rangeMax: accreditedScopeLine.rangeMax,
      rangeUnit: accreditedScopeLine.rangeUnit,
      description: accreditedScopeLine.description,
      validUntil: accreditedScopeLine.validUntil,
      unitName: organizationUnit.name,
    })
    .from(accreditedScopeLine)
    .innerJoin(
      organizationUnit,
      eq(accreditedScopeLine.unitId, organizationUnit.id),
    )
    .where(
      and(
        eq(accreditedScopeLine.id, scopeLineId),
        eq(accreditedScopeLine.organizationId, organizationId),
      ),
    )
    .limit(1);

  if (!lineData?.validUntil) return;

  const dueDate = formatDateBR(lineData.validUntil);
  const daysRemaining = context.daysRemaining;
  const kindLabel = quantityKindLabelPt(lineData.quantityKind);
  const lineName = `${kindLabel} ${lineData.rangeMin} a ${lineData.rangeMax} ${lineData.rangeUnit}${lineData.description ? ` (${lineData.description})` : ""} na unidade ${lineData.unitName}`;

  const recipients = await getRecipientsByRole(organizationId, [
    "admin",
    "owner",
  ]);

  for (const recipientId of recipients) {
    await sendNotification({
      recipientUserId: recipientId,
      organizationId,
      type: "ACCREDITED_SCOPE_LINE_EXPIRING",
      priority: daysRemaining <= 7 ? "HIGH" : "MEDIUM",
      title: "Linha do escopo acreditado expirando",
      message: `A vigência da linha ${lineName} termina em ${daysRemaining} ${daysRemaining === 1 ? "dia" : "dias"} (${dueDate}). Após o vencimento, pontos nessa faixa deixam de casar com o escopo e a emissão acreditada passa a classificar como fora de escopo. Atualize a linha nas configurações após a renovação do escopo.`,
      actionUrl: "/dashboard/settings/accredited-scope",
      emailContext: {
        type: "compliance",
        data: {
          itemName: lineName,
          dueDate,
          daysRemaining,
        },
      },
    });
  }
}

/**
 * Notify relevant users when a calibration job is overdue
 * Called by a scheduled job that checks calibrationJob.dueDate
 */
export async function notifyJobOverdue(jobId: number): Promise<void> {
  // Get job details with extended info
  const [jobData] = await db
    .select({
      jobIdentifier: calibrationJob.jobId,
      organizationId: calibrationJob.organizationId,
      technicianId: calibrationJob.technicianId,
      createdBy: calibrationJob.createdBy,
      dueDate: calibrationJob.dueDate,
      status: calibrationJob.status,
    })
    .from(calibrationJob)
    .where(eq(calibrationJob.id, jobId))
    .limit(1);

  if (!jobData?.dueDate) return;

  // Only notify for jobs that are still in progress
  const activeStatuses = ["DRAFT", "IN_PROGRESS", "REVIEW"];
  if (!activeStatuses.includes(jobData.status)) return;

  const daysOverdue = Math.abs(getDaysRemaining(jobData.dueDate));
  const dueDate = formatDateBR(jobData.dueDate);

  // Notify the technician (if assigned) and admins/owners
  const recipientIds = new Set<string>();

  if (jobData.technicianId) {
    recipientIds.add(jobData.technicianId);
  }
  recipientIds.add(jobData.createdBy);

  // Also notify admins/owners
  const admins = await getRecipientsByRole(jobData.organizationId, [
    "admin",
    "owner",
  ]);
  admins.forEach((id) => recipientIds.add(id));

  for (const recipientId of recipientIds) {
    await sendNotification({
      recipientUserId: recipientId,
      organizationId: jobData.organizationId,
      type: "JOB_OVERDUE",
      priority: "HIGH",
      title: "Calibração atrasada",
      message: `A OS ${jobData.jobIdentifier} está atrasada há ${daysOverdue} ${daysOverdue === 1 ? "dia" : "dias"} (vencimento: ${dueDate}).`,
      relatedEntity: {
        entityType: "job",
        entityId: jobId,
        jobId: jobData.jobIdentifier,
      },
      actionUrl: `/dashboard/jobs/${jobId}`,
      emailContext: {
        type: "job",
        data: {
          jobId: jobData.jobIdentifier,
          jobInternalId: jobId,
        },
      },
    });
  }
}

// =============================================================================
// PAYMENT NOTIFICATION TRIGGERS
// =============================================================================

/**
 * Format currency to Brazilian Real
 */
function formatCurrencyBRL(amount: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(amount / 100); // Assuming amount is in cents
}

/**
 * Notify organization when a payment is received
 * Called from payment webhook handler
 */
export async function notifyPaymentReceived(
  paymentId: number,
  organizationId: string,
): Promise<void> {
  // Get payment details
  const [payment] = await db
    .select({
      amount: paymentHistory.amount,
      paymentMethod: paymentHistory.paymentMethod,
      paidAt: paymentHistory.paidAt,
    })
    .from(paymentHistory)
    .where(eq(paymentHistory.id, paymentId))
    .limit(1);

  if (!payment) return;

  const amount = payment.amount ? formatCurrencyBRL(payment.amount) : undefined;
  const paidDate = payment.paidAt ? formatDateBR(payment.paidAt) : "hoje";

  // Notify admins and owners
  const recipients = await getRecipientsByRole(organizationId, [
    "admin",
    "owner",
  ]);

  for (const recipientId of recipients) {
    await sendNotification({
      recipientUserId: recipientId,
      organizationId,
      type: "PAYMENT_RECEIVED",
      priority: "MEDIUM",
      title: "Pagamento recebido",
      message: amount
        ? `Pagamento de ${amount} confirmado em ${paidDate}.`
        : `Pagamento confirmado em ${paidDate}.`,
      relatedEntity: {
        entityType: "payment",
        entityId: paymentId,
      },
      actionUrl: `/dashboard/settings/billing`,
      emailContext: {
        type: "payment",
        data: {
          amount,
          description: payment.paymentMethod ?? undefined,
        },
      },
    });
  }
}

/**
 * Notify organization when a payment fails
 * Called from payment webhook handler
 */
export async function notifyPaymentFailed(
  paymentId: number,
  organizationId: string,
  failureReason?: string,
): Promise<void> {
  // Get payment details
  const [payment] = await db
    .select({
      amount: paymentHistory.amount,
      paymentMethod: paymentHistory.paymentMethod,
      dueDate: paymentHistory.dueDate,
    })
    .from(paymentHistory)
    .where(eq(paymentHistory.id, paymentId))
    .limit(1);

  if (!payment) return;

  const amount = payment.amount ? formatCurrencyBRL(payment.amount) : undefined;
  const dueDate = payment.dueDate ? formatDateBR(payment.dueDate) : undefined;

  let message = "Não foi possível processar seu pagamento.";
  if (amount && dueDate) {
    message = `O pagamento de ${amount} com vencimento em ${dueDate} não foi processado.`;
  } else if (amount) {
    message = `O pagamento de ${amount} não foi processado.`;
  }

  if (failureReason) {
    message += ` Motivo: ${failureReason}`;
  }

  // Notify admins and owners
  const recipients = await getRecipientsByRole(organizationId, [
    "admin",
    "owner",
  ]);

  for (const recipientId of recipients) {
    await sendNotification({
      recipientUserId: recipientId,
      organizationId,
      type: "PAYMENT_FAILED",
      priority: "HIGH",
      title: "Pagamento não processado",
      message,
      relatedEntity: {
        entityType: "payment",
        entityId: paymentId,
      },
      actionUrl: `/dashboard/settings/billing`,
      emailContext: {
        type: "payment",
        data: {
          amount,
          description: failureReason ?? undefined,
        },
      },
    });
  }
}

// =============================================================================
// NON-CONFORMANCE NOTIFICATION TRIGGERS
// =============================================================================

/**
 * Notify admins/owners when a new non-conformance is created
 * Called from POST /api/nc
 */
export async function notifyNCCreated(
  ncId: number,
  ncNumber: string,
  ncType: "work" | "equipment" | "documentation" | "out_of_tolerance",
  description: string,
  organizationId: string,
  createdByUserId: string,
): Promise<void> {
  // Get creator name
  const [creator] = await db
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, createdByUserId))
    .limit(1);

  const creatorName = creator?.name ?? "Um usuário";
  const typeLabel =
    ncType === "work"
      ? "trabalho"
      : ncType === "equipment"
        ? "equipamento"
        : ncType === "out_of_tolerance"
          ? "fora de tolerância"
          : "documentação";

  // Notify admins and owners
  const recipients = await getRecipientsByRole(organizationId, [
    "admin",
    "owner",
  ]);

  for (const recipientId of recipients) {
    // Don't notify the creator
    if (recipientId === createdByUserId) continue;

    await sendNotification({
      recipientUserId: recipientId,
      organizationId,
      type: "NC_CREATED",
      priority: "HIGH",
      title: "Nova não conformidade registrada",
      message: `${creatorName} registrou a ${ncNumber} (${typeLabel}).`,
      relatedEntity: {
        entityType: "nc",
        entityId: ncId,
      },
      actionUrl: `/dashboard/nc/${ncId}`,
      emailContext: {
        type: "nc",
        data: {
          ncNumber,
          ncType,
          description,
          actorName: creatorName,
        },
      },
    });
  }
}

/**
 * Notify admins/owners when a customer acknowledges a §7.10 out-of-tolerance
 * notification (#426 Phase 0). Called from the public ack route and recorded
 * against the owning NC.
 */
export async function notifyOotAcknowledged(
  notificationId: number,
  ncId: number,
  ncNumber: string,
  organizationId: string,
): Promise<void> {
  const recipients = await getRecipientsByRole(organizationId, [
    "admin",
    "owner",
  ]);

  for (const recipientId of recipients) {
    await sendNotification({
      recipientUserId: recipientId,
      organizationId,
      type: "OOT_NOTIFICATION_ACKNOWLEDGED",
      priority: "MEDIUM",
      title: "Notificação 7.10 confirmada pelo cliente",
      message: `O cliente confirmou o recebimento da notificação de fora de tolerância da ${ncNumber} (notificação #${notificationId}).`,
      relatedEntity: {
        entityType: "nc",
        entityId: ncId,
      },
      actionUrl: `/dashboard/nc/${ncId}`,
    });
  }
}

/**
 * Notify admins/owners when an NC is escalated to CAPA
 * Called from POST /api/nc/:id/escalate-to-capa
 */
export async function notifyNCEscalatedToCapa(
  _ncId: number,
  ncNumber: string,
  capaId: number,
  capaNumber: string,
  description: string,
  organizationId: string,
  escalatedByUserId: string,
): Promise<void> {
  // Get escalator name
  const [escalator] = await db
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, escalatedByUserId))
    .limit(1);

  const escalatorName = escalator?.name ?? "Um usuário";

  // Notify admins and owners
  const recipients = await getRecipientsByRole(organizationId, [
    "admin",
    "owner",
  ]);

  for (const recipientId of recipients) {
    // Don't notify the person who escalated
    if (recipientId === escalatedByUserId) continue;

    await sendNotification({
      recipientUserId: recipientId,
      organizationId,
      type: "NC_ESCALATED_TO_CAPA",
      priority: "HIGH",
      title: "NC escalada para CAPA",
      message: `${escalatorName} escalou a ${ncNumber} para ${capaNumber}.`,
      relatedEntity: {
        entityType: "capa",
        entityId: capaId,
      },
      actionUrl: `/dashboard/capa/${capaId}`,
      emailContext: {
        type: "nc",
        data: {
          ncNumber,
          description,
          capaNumber,
          actorName: escalatorName,
        },
      },
    });
  }
}

// =============================================================================
// COMPETENCE NOTIFICATION TRIGGERS
// =============================================================================

/**
 * Notify admins when a competence is expiring
 * Called by scheduled worker
 */
export async function notifyCompetenceExpiring(
  competenceId: number,
  organizationId: string,
): Promise<void> {
  const [comp] = await db
    .select({
      userId: personnelCompetence.userId,
      scopeDescription: personnelCompetence.scopeDescription,
      expiresAt: personnelCompetence.expiresAt,
      assetTypeId: personnelCompetence.assetTypeId,
    })
    .from(personnelCompetence)
    .where(
      and(
        eq(personnelCompetence.id, competenceId),
        eq(personnelCompetence.organizationId, organizationId),
      ),
    )
    .limit(1);

  // userId is nullable since migration 0083; skip when the competence has no
  // owning user (deleted) — there is no technician to notify about.
  if (!comp?.expiresAt || !comp.userId) return;

  const [userData] = await db
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, comp.userId))
    .limit(1);

  const techName = userData?.name ?? "Um técnico";
  const daysRemaining = getDaysRemaining(comp.expiresAt);
  const dueDate = formatDateBR(comp.expiresAt);

  const recipients = await getRecipientsByRole(organizationId, [
    "admin",
    "owner",
  ]);

  for (const recipientId of recipients) {
    await sendNotification({
      recipientUserId: recipientId,
      organizationId,
      type: "COMPETENCE_EXPIRING",
      priority: daysRemaining <= 7 ? "HIGH" : "MEDIUM",
      title: "Competência vencendo",
      message: `A competência de ${techName} (${comp.scopeDescription}) vence em ${daysRemaining} dias (${dueDate}).`,
      relatedEntity: {
        entityType: "competence",
        entityId: competenceId,
      },
      actionUrl: `/dashboard/personnel/${competenceId}`,
      emailContext: {
        type: "competence",
        data: {
          subjectName: techName,
          scopeDescription: comp.scopeDescription,
          dueDate,
          daysRemaining,
        },
      },
    });
  }
}

/**
 * Notify admins when a competence has expired
 * Called by scheduled worker
 */
export async function notifyCompetenceExpired(
  competenceId: number,
  organizationId: string,
): Promise<void> {
  const [comp] = await db
    .select({
      userId: personnelCompetence.userId,
      scopeDescription: personnelCompetence.scopeDescription,
      expiresAt: personnelCompetence.expiresAt,
    })
    .from(personnelCompetence)
    .where(
      and(
        eq(personnelCompetence.id, competenceId),
        eq(personnelCompetence.organizationId, organizationId),
      ),
    )
    .limit(1);

  // userId is nullable since migration 0083 (a deleted user leaves the
  // competence with user_id NULL). These notifications are about a specific
  // technician, so skip when there is no owning user.
  if (!comp?.userId) return;

  const [userData] = await db
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, comp.userId))
    .limit(1);

  const techName = userData?.name ?? "Um técnico";
  const dueDate = comp.expiresAt ? formatDateBR(comp.expiresAt) : undefined;

  const recipients = await getRecipientsByRole(organizationId, [
    "admin",
    "owner",
  ]);

  for (const recipientId of recipients) {
    await sendNotification({
      recipientUserId: recipientId,
      organizationId,
      type: "COMPETENCE_EXPIRED",
      priority: "HIGH",
      title: "Competência EXPIRADA",
      message: `A competência de ${techName} (${comp.scopeDescription}) expirou. Atribuições com este escopo estão bloqueadas.`,
      relatedEntity: {
        entityType: "competence",
        entityId: competenceId,
      },
      actionUrl: `/dashboard/personnel/${competenceId}`,
      emailContext: {
        type: "competence",
        data: {
          subjectName: techName,
          scopeDescription: comp.scopeDescription,
          dueDate,
        },
      },
    });
  }
}

/**
 * Notify admins when a new competence request is submitted
 * Called from POST /api/competences
 */
export async function notifyCompetenceRequested(
  competenceId: number,
  organizationId: string,
  requestedByUserId: string,
): Promise<void> {
  const [comp] = await db
    .select({
      userId: personnelCompetence.userId,
      scopeDescription: personnelCompetence.scopeDescription,
    })
    .from(personnelCompetence)
    .where(
      and(
        eq(personnelCompetence.id, competenceId),
        eq(personnelCompetence.organizationId, organizationId),
      ),
    )
    .limit(1);

  // userId is nullable since migration 0083 (a deleted user leaves the
  // competence with user_id NULL). These notifications are about a specific
  // technician, so skip when there is no owning user.
  if (!comp?.userId) return;

  const [requester] = await db
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, requestedByUserId))
    .limit(1);

  const [technician] = await db
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, comp.userId))
    .limit(1);

  const requesterName = requester?.name ?? "Um usuário";
  const techName = technician?.name ?? "um técnico";

  const recipients = await getRecipientsByRole(organizationId, [
    "admin",
    "owner",
  ]);

  for (const recipientId of recipients) {
    if (recipientId === requestedByUserId) continue;

    await sendNotification({
      recipientUserId: recipientId,
      organizationId,
      type: "COMPETENCE_REQUESTED",
      priority: "MEDIUM",
      title: "Nova solicitação de competência",
      message: `${requesterName} solicitou qualificação para ${techName}: ${comp.scopeDescription}.`,
      relatedEntity: {
        entityType: "competence",
        entityId: competenceId,
      },
      actionUrl: `/dashboard/personnel/${competenceId}`,
      emailContext: {
        type: "competence",
        data: {
          subjectName: techName,
          scopeDescription: comp.scopeDescription,
          actorName: requesterName,
        },
      },
    });
  }
}

/**
 * Notify technician when their competence is approved
 * Called from POST /api/competences/:id/evaluate (when passed)
 */
export async function notifyCompetenceApproved(
  competenceId: number,
  organizationId: string,
  approvedByUserId: string,
): Promise<void> {
  const [comp] = await db
    .select({
      userId: personnelCompetence.userId,
      scopeDescription: personnelCompetence.scopeDescription,
    })
    .from(personnelCompetence)
    .where(
      and(
        eq(personnelCompetence.id, competenceId),
        eq(personnelCompetence.organizationId, organizationId),
      ),
    )
    .limit(1);

  // userId is nullable since migration 0083 (a deleted user leaves the
  // competence with user_id NULL). These notifications are about a specific
  // technician, so skip when there is no owning user.
  if (!comp?.userId) return;

  const [approver] = await db
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, approvedByUserId))
    .limit(1);

  const approverName = approver?.name ?? "Um gestor";
  const [technician] = await db
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, comp.userId))
    .limit(1);
  const techName = technician?.name ?? "Você";

  if (comp.userId === approvedByUserId) return;

  await sendNotification({
    recipientUserId: comp.userId,
    organizationId,
    type: "COMPETENCE_APPROVED",
    priority: "MEDIUM",
    title: "Competência aprovada",
    message: `${approverName} aprovou sua qualificação: ${comp.scopeDescription}.`,
    relatedEntity: {
      entityType: "competence",
      entityId: competenceId,
    },
    actionUrl: `/dashboard/personnel/${competenceId}`,
    emailContext: {
      type: "competence",
      data: {
        subjectName: techName,
        scopeDescription: comp.scopeDescription,
        actorName: approverName,
      },
    },
  });
}

// =============================================================================
// PORTAL DUE-CALIBRATION DIGEST
// =============================================================================
// Opt-in summary email for client-portal users: their instruments that are
// overdue or due within the next 30 days, branded as the lab. Fired by the
// daily portal-digest cron via the PORTAL_DIGEST background job; which users
// receive it on a given run is decided by `portalDigestFrequenciesFor` (DAILY
// every run, WEEKLY on Mondays UTC) against `notification_preference.
// digest_frequency` — this is that dormant column's first consumer.

/** Mirrors the portal's DUE_SOON window (apps/portal calibration-status). */
const PORTAL_DIGEST_DUE_SOON_DAYS = 30;
/** Instruments listed in the email body; the rest become "e mais N". */
const PORTAL_DIGEST_MAX_ITEMS = 15;

const PORTAL_DIGEST_DATE = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "America/Sao_Paulo",
});

export type PortalDigestRunResult = {
  recipients: number;
  sent: number;
  skippedEmpty: number;
  /** Recipients skipped because their address is on the suppression ledger. */
  suppressed: number;
  errors: number;
};

function describePortalDigestDue(due: Date, now: Date): string {
  const days = Math.round(
    (due.getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
  );
  const dateLabel = PORTAL_DIGEST_DATE.format(due);
  if (days < 0) {
    const overdueDays = Math.abs(days);
    return `Vencida há ${overdueDays} ${overdueDays === 1 ? "dia" : "dias"} (${dateLabel})`;
  }
  if (days === 0) return `Vence hoje (${dateLabel})`;
  return `Vence em ${days} ${days === 1 ? "dia" : "dias"} (${dateLabel})`;
}

/**
 * Portal base URL for a lab: its verified custom portal domain when active,
 * otherwise the default portal host. (Plan entitlement is not re-checked here
 * — a stale-but-still-bound domain only changes which host serves the link.)
 */
async function getPortalDigestBaseUrl(
  labOrganizationId: string,
): Promise<string> {
  const [domain] = await db
    .select({ hostname: organizationCustomDomain.hostname })
    .from(organizationCustomDomain)
    .where(
      and(
        eq(organizationCustomDomain.organizationId, labOrganizationId),
        eq(organizationCustomDomain.isActive, true),
        isNotNull(organizationCustomDomain.verifiedAt),
      ),
    )
    .limit(1);

  return domain?.hostname ? `https://${domain.hostname}` : getPortalBaseUrl();
}

export async function sendPortalDueDigests(
  now: Date = new Date(),
): Promise<PortalDigestRunResult> {
  const result: PortalDigestRunResult = {
    recipients: 0,
    sent: 0,
    skippedEmpty: 0,
    suppressed: 0,
    errors: 0,
  };

  const resendApiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL;
  if (!resendApiKey || !fromEmail) {
    console.error(
      "[PortalDigest] EMAIL MISCONFIGURED: RESEND_API_KEY or RESEND_FROM_EMAIL not set; skipping run.",
    );
    return result;
  }

  const frequencies = portalDigestFrequenciesFor(now);

  // A digest recipient is a (user, scope) pair where the scope is the set of
  // branch customers to aggregate. Branch-org members scope to their one
  // customer; group-org members scope to all of the group's branches (one
  // consolidated digest). The "client_user" literal mirrors PORTAL_ACCESS_ROLES
  // (packages/auth/src/access.ts), which this package doesn't depend on.
  type DigestRecipient = {
    userId: string;
    email: string | null;
    name: string | null;
    frequency: string;
    labOrganizationId: string;
    customerIds: number[];
    scopeLabel: string;
  };

  const optedInWhere = and(
    eq(organization.type, "CLIENT"),
    eq(member.role, "client_user"),
    inArray(notificationPreference.digestFrequency, frequencies),
    eq(notificationPreference.emailEnabled, true),
  );

  // Members of a branch customer's CLIENT org → one customer each.
  const customerRecipients = await db
    .selectDistinct({
      userId: user.id,
      email: user.email,
      name: user.name,
      frequency: notificationPreference.digestFrequency,
      customerId: customer.id,
      labOrganizationId: customer.labOrganizationId,
    })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .innerJoin(customer, eq(customer.authOrganizationId, organization.id))
    .innerJoin(user, eq(member.userId, user.id))
    .innerJoin(
      notificationPreference,
      eq(notificationPreference.userId, member.userId),
    )
    .where(optedInWhere);

  // Members of a customer-group's CLIENT org → consolidated over its branches.
  const groupRecipients = await db
    .selectDistinct({
      userId: user.id,
      email: user.email,
      name: user.name,
      frequency: notificationPreference.digestFrequency,
      groupId: customerGroup.id,
      labOrganizationId: customerGroup.labOrganizationId,
    })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .innerJoin(
      customerGroup,
      eq(customerGroup.authOrganizationId, organization.id),
    )
    .innerJoin(user, eq(member.userId, user.id))
    .innerJoin(
      notificationPreference,
      eq(notificationPreference.userId, member.userId),
    )
    .where(optedInWhere);

  // Resolve each group's branch customer ids in one query.
  const branchesByGroup = new Map<number, number[]>();
  const groupIds = [...new Set(groupRecipients.map((row) => row.groupId))];
  if (groupIds.length > 0) {
    const branches = await db
      .select({ id: customer.id, groupId: customer.groupId })
      .from(customer)
      .where(inArray(customer.groupId, groupIds));
    for (const branch of branches) {
      if (branch.groupId === null) continue;
      const list = branchesByGroup.get(branch.groupId) ?? [];
      list.push(branch.id);
      branchesByGroup.set(branch.groupId, list);
    }
  }

  const recipients: DigestRecipient[] = [
    ...customerRecipients.map((row) => ({
      userId: row.userId,
      email: row.email,
      name: row.name,
      frequency: row.frequency,
      labOrganizationId: row.labOrganizationId,
      customerIds: [row.customerId],
      scopeLabel: `customer:${row.customerId}`,
    })),
    ...groupRecipients.flatMap((row) => {
      const customerIds = branchesByGroup.get(row.groupId) ?? [];
      if (customerIds.length === 0) return [];
      return [
        {
          userId: row.userId,
          email: row.email,
          name: row.name,
          frequency: row.frequency,
          labOrganizationId: row.labOrganizationId,
          customerIds,
          scopeLabel: `group:${row.groupId}`,
        },
      ];
    }),
  ];

  result.recipients = recipients.length;
  if (recipients.length === 0) return result;

  const resend = new Resend(resendApiKey);
  const logoSrc = getEmailLogoSrc();
  const brandByLab = new Map<string, EmailBrand | undefined>();
  const portalUrlByLab = new Map<string, string>();

  const soon = new Date(now);
  soon.setUTCDate(soon.getUTCDate() + PORTAL_DIGEST_DUE_SOON_DAYS);

  for (const recipient of recipients) {
    if (!recipient.email || recipient.customerIds.length === 0) continue;

    try {
      const dueWhere = and(
        inArray(asset.customerId, recipient.customerIds),
        eq(asset.status, "ACTIVE"),
        isNull(asset.deletedAt),
        isNotNull(asset.nextCalibrationDate),
        lte(asset.nextCalibrationDate, soon),
      );

      // oxlint-disable-next-line eslint/no-await-in-loop -- digests are sent sequentially per recipient on purpose (cron job, small volume).
      const [counts] = await db
        .select({
          total: sql<number>`cast(count(*) as int)`,
          overdue: sql<number>`cast(count(*) filter (where ${lt(asset.nextCalibrationDate, now)}) as int)`,
        })
        .from(asset)
        .where(dueWhere);

      const total = counts?.total ?? 0;
      if (total === 0) {
        result.skippedEmpty += 1;
        continue;
      }
      const overdueCount = counts?.overdue ?? 0;
      const dueSoonCount = total - overdueCount;

      // oxlint-disable-next-line eslint/no-await-in-loop -- sequential per recipient (see above).
      const dueAssets = await db
        .select({
          name: asset.name,
          tag: asset.tag,
          nextCalibrationDate: asset.nextCalibrationDate,
        })
        .from(asset)
        .where(dueWhere)
        .orderBy(asc(asset.nextCalibrationDate), asc(asset.tag))
        .limit(PORTAL_DIGEST_MAX_ITEMS);

      const items: PortalDueDigestItem[] = dueAssets.flatMap((item) => {
        if (!item.nextCalibrationDate) return [];
        return [
          {
            tag: item.tag,
            name: item.name,
            statusLabel: describePortalDigestDue(item.nextCalibrationDate, now),
            overdue: item.nextCalibrationDate.getTime() < now.getTime(),
          },
        ];
      });

      let emailBrand = brandByLab.get(recipient.labOrganizationId);
      if (!brandByLab.has(recipient.labOrganizationId)) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- cached per lab across the run.
        emailBrand = await getLabEmailBrand(recipient.labOrganizationId);
        brandByLab.set(recipient.labOrganizationId, emailBrand);
      }

      let portalBaseUrl = portalUrlByLab.get(recipient.labOrganizationId);
      if (!portalBaseUrl) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- cached per lab across the run.
        portalBaseUrl = await getPortalDigestBaseUrl(
          recipient.labOrganizationId,
        );
        portalUrlByLab.set(recipient.labOrganizationId, portalBaseUrl);
      }

      // The digest is marketing-class mail: never send it to an address on the
      // suppression ledger (a Resend complaint / hard bounce, fed by the webhook
      // in PR #591). isEmailSuppressed normalizes the address and also honours
      // the broader 'all' scope. Per-recipient lookup is fine at cron volume.
      // oxlint-disable-next-line eslint/no-await-in-loop -- sequential per recipient (see above).
      if (await isEmailSuppressed(recipient.email, "all")) {
        result.suppressed += 1;
        continue;
      }

      const frequencyLabel =
        recipient.frequency === "WEEKLY" ? "semanal" : "diário";
      const portalUrl =
        overdueCount > 0
          ? `${portalBaseUrl}/assets?dueStatus=overdue`
          : `${portalBaseUrl}/calendar`;
      // The digest is a marketing-class email: expose a native unsubscribe via
      // the portal notification-settings page (one-click List-Unsubscribe-Post
      // is out of scope here).
      const unsubscribeUrl = `${portalBaseUrl}/settings/notifications`;

      const emailElement = PortalDueDigestEmail({
        recipientName: recipient.name ?? "Usuário",
        frequencyLabel,
        overdueCount,
        dueSoonCount,
        items,
        moreCount: Math.max(0, total - items.length),
        portalUrl,
        logoSrc,
        brand: emailBrand,
      });

      // oxlint-disable-next-line eslint/no-await-in-loop -- sequential per recipient (see above).
      const html = await render(emailElement);

      const overdueLabel = `${overdueCount} ${overdueCount === 1 ? "vencida" : "vencidas"}`;
      const dueSoonLabel = `${dueSoonCount} a vencer`;
      const subjectParts = [
        overdueCount > 0 ? overdueLabel : null,
        dueSoonCount > 0 ? dueSoonLabel : null,
      ].filter(Boolean);

      // oxlint-disable-next-line eslint/no-await-in-loop -- sequential per recipient (see above).
      await resend.emails.send({
        from: formatFromEmail(fromEmail, emailBrand),
        to: recipient.email,
        subject: `Resumo de calibrações: ${subjectParts.join(" · ")}`,
        html,
        replyTo: getReplyToEmail(emailBrand),
        headers: {
          "List-Unsubscribe": `<${unsubscribeUrl}>`,
        },
      });

      result.sent += 1;
    } catch (error) {
      result.errors += 1;
      console.error("[PortalDigest] Failed to send digest", {
        userId: recipient.userId,
        scope: recipient.scopeLabel,
        error: error instanceof Error ? error.message : "unknown error",
      });
    }
  }

  console.log("[PortalDigest] Run complete", result);
  return result;
}
