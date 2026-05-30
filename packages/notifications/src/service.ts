import { db } from "@calibra-facil/db";
import {
  notification,
  notificationPreference,
  member,
  user,
  calibrationJob,
  customer,
  asset,
  referenceStandard,
  paymentHistory,
  personnelCompetence,
  calibrationRequest,
  calibrationRequestItem,
  organization,
  type NotificationType,
  type NotificationPriority,
  type NotificationChannel,
  type NotificationRelatedEntity,
  type NotificationPreferenceMap,
} from "@calibra-facil/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { Resend } from "resend";
import { render } from "@react-email/render";
import {
  NotificationEmail,
  CertificateAmendedEmail,
  JobNotificationEmail,
  CertificateReadyEmail,
  ComplianceAlertEmail,
  PaymentNotificationEmail,
  NCNotificationEmail,
  CompetenceNotificationEmail,
  CustomerSuccessEmail,
  CalibrationRequestEmail,
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
export interface CertificateEmailContext {
  jobId: string;
  originalJobId?: string;
  assetName?: string;
  customerName?: string;
  reason?: string;
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
  ncType?: "work" | "equipment" | "documentation";
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

/** Union type for all email contexts */
export type EmailContext =
  | { type: "job"; data: JobEmailContext }
  | { type: "certificate"; data: CertificateEmailContext }
  | { type: "compliance"; data: ComplianceEmailContext }
  | { type: "payment"; data: PaymentEmailContext }
  | { type: "nc"; data: NCEmailContext }
  | { type: "competence"; data: CompetenceEmailContext }
  | { type: "calibrationRequest"; data: CalibrationRequestEmailContext }
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
  ASSET_DUE_FOR_RECALIBRATION: { inApp: true, email: true },
  STANDARD_EXPIRING: { inApp: true, email: true },
  STANDARD_EXPIRED: { inApp: true, email: true },
  JOB_OVERDUE: { inApp: true, email: true },
  PAYMENT_RECEIVED: { inApp: true, email: true },
  PAYMENT_FAILED: { inApp: true, email: true },
  NC_CREATED: { inApp: true, email: true },
  NC_ESCALATED_TO_CAPA: { inApp: true, email: true },
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

async function getLabEmailBrand(
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

  return lab ? createLabEmailBrand(lab) : undefined;
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
      "STANDARD_EXPIRING",
      "STANDARD_EXPIRED",
    ].includes(type)
  ) {
    const { itemName, dueDate, daysRemaining } = emailContext.data;
    return ComplianceAlertEmail({
      recipientName,
      type:
        type === "ASSET_DUE_FOR_RECALIBRATION"
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

  try {
    const resend = new Resend(resendApiKey);
    const recipientName = userData.name ?? "Usuário";
    const logoSrc = getEmailLogoSrc();
    const emailActionUrl = resolveEmailActionUrl(actionUrl);

    // Render the appropriate email template
    const emailElement = renderEmailTemplate(
      type,
      recipientName,
      title,
      message,
      emailActionUrl,
      emailContext,
      logoSrc,
      emailBrand,
    );

    const html = await render(emailElement);

    await resend.emails.send({
      from: formatFromEmail(fromEmail, emailBrand),
      to: userData.email,
      subject: title,
      html,
      replyTo: getReplyToEmail(emailBrand),
    });

    return true;
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
  manufacturer: string | null;
  model: string | null;
} | null> {
  const [assetData] = await db
    .select({
      name: asset.name,
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

  const portalUrl = `${getPortalBaseUrl()}/certificates`;
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
      actionUrl: `/portal/certificates`,
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
  ncType: "work" | "equipment" | "documentation",
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

  if (!comp?.expiresAt) return;

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

  if (!comp) return;

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

  if (!comp) return;

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

  if (!comp) return;

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
