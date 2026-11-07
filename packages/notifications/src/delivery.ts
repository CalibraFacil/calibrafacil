// Delivery of one notification: the user's preferences, the in-app row and the
// e-mail. What is delivered, and to whom, is the recipes' business
// (recipes/*.ts, driven by `notify()` in service.ts).
//
// Notification dispatch is scoped per organization (row-level security).
// A dispatcher starts from the id of the entity the caller just operated on
// (already authorised and scoped there) or from an explicit laboratory; the
// one statement that learns the laboratory of an id runs on the system path
// (lab-scope.ts, `findJobLaboratory` and friends), and every statement after
// it runs in a transaction that names an organization: the laboratory's for
// the entity reads, the recipient's for the notification rows (a portal user's
// belong to the CLIENT organization). No transaction is held across an e-mail
// send. Global tables (user, organization, notification_preference) are read
// on the plain handle.
import { DEFAULT_NOTIFICATION_PREFERENCES } from "@calibra-facil/schemas";

import { db } from "@calibra-facil/db";

import { inOrg } from "./lab-scope";
import {
  notification,
  notificationPreference,
  member,
  user,
  organization,
  type NotificationType,
  type NotificationPriority,
  type NotificationChannel,
  type NotificationRelatedEntity,
  type NotificationPreferenceMap,
} from "@calibra-facil/db/schema";
import { eq, and, inArray } from "drizzle-orm";

import { readEmailConfig, readOriginsConfig } from "@calibra-facil/config";

import { isEmailSuppressed } from "./suppression";
import {
  formatFromEmail,
  formatLabFromHeader,
  getPlatformFromEmail,
  getReplyToEmail,
  isPlatformEmailConfigured,
  sendEmailWithLabSender,
  stripBrandSender,
} from "@calibra-facil/email-sender";
import {
  labEmailSenderResolver,
  resolveLabEmailSender,
} from "@calibra-facil/lab-email-domain";
import { render } from "@react-email/render";
import {
  NotificationEmail,
  AuditPackReadyEmail,
  CertificateAmendedEmail,
  JobNotificationEmail,
  CertificateReadyEmail,
  AssetOotEmail,
  ComplianceAlertEmail,
  NCNotificationEmail,
  CompetenceNotificationEmail,
  CalibrationRequestEmail,
  VisitNotificationEmail,
  type EmailBrand,
} from "@calibra-facil/email";
import { appBaseUrl, portalBaseUrl } from "@calibra-facil/shared/public-urls";

// Track if email misconfiguration warning has been logged this session
let emailMisconfigWarningLogged = false;

// =============================================================================
// TYPES
// =============================================================================

/** Context for job-related email templates */
interface JobEmailContext {
  jobId: string;
  jobInternalId: number;
  actorName?: string;
  reason?: string;
}

/** Context for certificate ready email templates */
interface AssetOotEmailContext {
  assetTag: string;
  assetName?: string;
  jobId: string;
  portalUrl: string;
}

interface CertificateEmailContext {
  jobId: string;
  originalJobId?: string;
  assetName?: string;
  customerName?: string;
  reason?: string;
  portalUrl: string;
}

/** Context for the audit-pack ready email template (#738) */
interface AuditPackEmailContext {
  customerName?: string;
  periodLabel: string;
  certificateCount: number;
  expiresAtLabel?: string;
  portalUrl: string;
}

/** Context for compliance alert email templates */
interface ComplianceEmailContext {
  itemName: string;
  dueDate: string;
  daysRemaining: number;
}

/** Context for NC email templates */
interface NCEmailContext {
  ncNumber: string;
  ncType?: "work" | "equipment" | "documentation" | "out_of_tolerance";
  description?: string;
  capaNumber?: string;
  actorName?: string;
}

/** Context for competence email templates */
interface CompetenceEmailContext {
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
interface VisitEmailContext {
  customerName: string;
  scheduledDate: string;
  technicianName?: string;
  addressText?: string;
  labName?: string;
  reason?: string;
}

/** Union type for all email contexts */
type EmailContext =
  | { type: "job"; data: JobEmailContext }
  | { type: "certificate"; data: CertificateEmailContext }
  | { type: "assetOot"; data: AssetOotEmailContext }
  | { type: "auditPack"; data: AuditPackEmailContext }
  | { type: "compliance"; data: ComplianceEmailContext }
  | { type: "nc"; data: NCEmailContext }
  | { type: "competence"; data: CompetenceEmailContext }
  | { type: "calibrationRequest"; data: CalibrationRequestEmailContext }
  | { type: "visit"; data: VisitEmailContext };

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

// =============================================================================
// CORE NOTIFICATION SERVICE
// =============================================================================

/**
 * Get user's notification preferences
 */
export async function getUserPreferences(userId: string): Promise<{
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
      preferences: DEFAULT_NOTIFICATION_PREFERENCES,
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

  const { preferences, emailEnabled } =
    await getUserPreferences(recipientUserId);
  const typePrefs = preferences[type] ?? { inApp: true, email: true };

  const channelsSent: NotificationChannel[] = [];
  let notificationId: number | null = null;
  let emailSent = false;

  if (typePrefs.inApp) {
    // The row belongs to the RECIPIENT's organization (the laboratory for its
    // staff, the CLIENT organization for a portal user).
    const [created] = await inOrg(organizationId, (o) =>
      o
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
        .returning(),
    );

    if (created) {
      notificationId = created.id;
      channelsSent.push("IN_APP");
    }
  }

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

      if (notificationId) {
        const createdId = notificationId;
        await inOrg(organizationId, async (o) => {
          await o
            .update(notification)
            .set({ channelsSent })
            .where(eq(notification.id, createdId));
        });
      }
    }
  }

  return { notificationId, channels: channelsSent, emailSent };
}

/**
 * Map notification type to job notification email type
 */
const JOB_EMAIL_TYPES = {
  JOB_SUBMITTED_FOR_REVIEW: "submitted",
  JOB_APPROVED: "approved",
  JOB_REJECTED: "rejected",
  JOB_ASSIGNED: "assigned",
  JOB_OVERDUE: "overdue",
} as const satisfies Partial<Record<NotificationType, string>>;

/** The job e-mail a notification type renders, or null when it is not a job notification. */
function jobEmailType(
  type: NotificationType,
): (typeof JOB_EMAIL_TYPES)[keyof typeof JOB_EMAIL_TYPES] | null {
  for (const [key, value] of Object.entries(JOB_EMAIL_TYPES)) {
    if (key === type) return value;
  }
  return null;
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

export function getEmailLogoSrc(): string {
  const explicitLogoUrl = readEmailConfig().emailLogoUrl;
  if (explicitLogoUrl) return explicitLogoUrl;

  const origins = readOriginsConfig();
  const appUrl = origins.webUrl ?? origins.appUrl;
  if (appUrl) return `${appUrl.replace(/\/$/, "")}/logo192.png`;

  return `${appBaseUrl()}/logo192.png`;
}

function getWebBaseUrl(): string {
  return appBaseUrl();
}

export function getPortalBaseUrl(): string {
  return portalBaseUrl();
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
  const jobType = jobEmailType(type);
  if (emailContext?.type === "job" && jobType) {
    const { jobId, actorName, reason } = emailContext.data;
    return JobNotificationEmail({
      recipientName,
      type: jobType,
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
 * Send notification email using the platform transport and React Email templates
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

  // Check if e-mail is configured - log warning once per session
  const fromEmail = getPlatformFromEmail();

  if (!isPlatformEmailConfigured() || !fromEmail) {
    if (!emailMisconfigWarningLogged) {
      console.error(
        "[Notifications] EMAIL MISCONFIGURED: no e-mail transport (SMTP_HOST or RESEND_API_KEY) or no sender (EMAIL_FROM). " +
          "Users will only receive in-app notifications, no emails will be sent.",
      );
      emailMisconfigWarningLogged = true;
    }
    return false;
  }

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
      labSender: labEmailSenderResolver,
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
  const members = await inOrg(organizationId, (o) =>
    o
      .select({ userId: member.userId })
      .from(member)
      .where(
        and(
          eq(member.organizationId, organizationId),
          inArray(member.role, roles),
        ),
      ),
  );

  return members.map((m) => m.userId);
}
