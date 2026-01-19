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
  type NotificationType,
  type NotificationPriority,
  type NotificationChannel,
  type NotificationRelatedEntity,
  type NotificationPreferenceMap,
} from "@calibra-facil/db/schema";
import { eq, and, inArray, lt, isNull, notInArray } from "drizzle-orm";
import { Resend } from "resend";
import { render } from "@react-email/components";
import {
  NotificationEmail,
  JobNotificationEmail,
  CertificateReadyEmail,
  ComplianceAlertEmail,
  PaymentNotificationEmail,
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
  assetName?: string;
  customerName?: string;
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

/** Union type for all email contexts */
export type EmailContext =
  | { type: "job"; data: JobEmailContext }
  | { type: "certificate"; data: CertificateEmailContext }
  | { type: "compliance"; data: ComplianceEmailContext }
  | { type: "payment"; data: PaymentEmailContext };

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
  ASSET_DUE_FOR_RECALIBRATION: { inApp: true, email: true },
  STANDARD_EXPIRING: { inApp: true, email: true },
  JOB_OVERDUE: { inApp: true, email: true },
  PAYMENT_RECEIVED: { inApp: true, email: true },
  PAYMENT_FAILED: { inApp: true, email: true },
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
    };
  }

  return {
    preferences: prefs.preferences,
    emailEnabled: prefs.emailEnabled,
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
  } = options;

  // Get user preferences
  const { preferences, emailEnabled } = await getUserPreferences(recipientUserId);
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
    });
  }

  // Compliance alerts
  if (
    emailContext?.type === "compliance" &&
    ["ASSET_DUE_FOR_RECALIBRATION", "STANDARD_EXPIRING"].includes(type)
  ) {
    const { itemName, dueDate, daysRemaining } = emailContext.data;
    return ComplianceAlertEmail({
      recipientName,
      type: type === "ASSET_DUE_FOR_RECALIBRATION" ? "asset" : "standard",
      itemName,
      dueDate,
      daysRemaining,
      actionUrl: actionUrl ?? "#",
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
    });
  }

  // Fallback to generic notification email
  return NotificationEmail({
    recipientName,
    title,
    message,
    actionUrl,
    actionLabel: "Ver Detalhes",
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
}): Promise<boolean> {
  const { recipientUserId, type, title, message, actionUrl, emailContext } = options;

  // Check if Resend is configured - log warning once per session
  const resendApiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL;

  if (!resendApiKey || !fromEmail) {
    if (!emailMisconfigWarningLogged) {
      console.error(
        "[Notifications] EMAIL MISCONFIGURED: RESEND_API_KEY or RESEND_FROM_EMAIL not set. " +
        "Users will only receive in-app notifications, no emails will be sent."
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
    const recipientName = userData.name ?? "Usuario";

    // Render the appropriate email template
    const emailElement = renderEmailTemplate(
      type,
      recipientName,
      title,
      message,
      actionUrl,
      emailContext,
    );

    const html = await render(emailElement);

    await resend.emails.send({
      from: fromEmail,
      to: userData.email,
      subject: title,
      html,
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
  const recipients = await getRecipientsByRole(job.organizationId, ["admin", "owner"]);

  // Send to each recipient (except the submitter)
  for (const recipientId of recipients) {
    if (recipientId === submittedByUserId) continue;

    await sendNotification({
      recipientUserId: recipientId,
      organizationId: job.organizationId,
      type: "JOB_SUBMITTED_FOR_REVIEW",
      priority: "HIGH",
      title: "Calibracao aguardando revisao",
      message: `${submitterName} submeteu a OS ${job.jobIdentifier} para revisao.`,
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
    title: "Calibracao aprovada",
    message: `${approverName} aprovou a OS ${job.jobIdentifier}. O certificado esta sendo gerado.`,
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
    title: "Calibracao rejeitada",
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

  // Don't notify if assigning to self
  if (technicianId === assignedByUserId) return;

  // Get assigner name
  const [assigner] = await db
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, assignedByUserId))
    .limit(1);

  const assignerName = assigner?.name ?? "Um gestor";

  await sendNotification({
    recipientUserId: technicianId,
    organizationId: job.organizationId,
    type: "JOB_ASSIGNED",
    priority: "MEDIUM",
    title: "Nova calibracao atribuida",
    message: `${assignerName} atribuiu a OS ${job.jobIdentifier} para voce.`,
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

  // Determine the portal URL (could be configurable)
  const portalUrl =
    process.env.PORTAL_URL ?? "https://app.calibrafacil.com/portal/certificates";

  // Send email notifications to all portal users
  for (const portalUser of portalUsers) {
    await sendNotification({
      recipientUserId: portalUser.userId,
      organizationId: customerData.authOrganizationId,
      type: "CERTIFICATE_READY",
      priority: "HIGH",
      title: "Certificado de calibracao disponivel",
      message: `O certificado da OS ${job.jobIdentifier} esta pronto para download no portal.`,
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
  const assetIdentifier = assetData.tag || assetData.serialNumber || assetData.name;
  const itemName = customerData
    ? `${assetData.name} (${customerData.name})`
    : assetData.name;

  // Notify admins and owners of the lab
  const recipients = await getRecipientsByRole(organizationId, ["admin", "owner"]);

  for (const recipientId of recipients) {
    await sendNotification({
      recipientUserId: recipientId,
      organizationId,
      type: "ASSET_DUE_FOR_RECALIBRATION",
      priority: daysRemaining <= 3 ? "HIGH" : "MEDIUM",
      title: "Ativo vencendo calibracao",
      message: `O instrumento ${assetIdentifier} esta com calibracao vencendo em ${daysRemaining} dias (${dueDate}).`,
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
  const recipients = await getRecipientsByRole(organizationId, ["admin", "owner"]);

  for (const recipientId of recipients) {
    await sendNotification({
      recipientUserId: recipientId,
      organizationId,
      type: "STANDARD_EXPIRING",
      priority: daysRemaining <= 3 ? "HIGH" : "MEDIUM",
      title: "Padrao de referencia vencendo",
      message: `O padrao ${standardIdentifier} esta com calibracao vencendo em ${daysRemaining} dias (${dueDate}).`,
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
  const admins = await getRecipientsByRole(jobData.organizationId, ["admin", "owner"]);
  admins.forEach((id) => recipientIds.add(id));

  for (const recipientId of recipientIds) {
    await sendNotification({
      recipientUserId: recipientId,
      organizationId: jobData.organizationId,
      type: "JOB_OVERDUE",
      priority: "HIGH",
      title: "Calibracao atrasada",
      message: `A OS ${jobData.jobIdentifier} esta atrasada ha ${daysOverdue} ${daysOverdue === 1 ? "dia" : "dias"} (vencimento: ${dueDate}).`,
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
  const recipients = await getRecipientsByRole(organizationId, ["admin", "owner"]);

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

  let message = "Nao foi possivel processar seu pagamento.";
  if (amount && dueDate) {
    message = `O pagamento de ${amount} com vencimento em ${dueDate} nao foi processado.`;
  } else if (amount) {
    message = `O pagamento de ${amount} nao foi processado.`;
  }

  if (failureReason) {
    message += ` Motivo: ${failureReason}`;
  }

  // Notify admins and owners
  const recipients = await getRecipientsByRole(organizationId, ["admin", "owner"]);

  for (const recipientId of recipients) {
    await sendNotification({
      recipientUserId: recipientId,
      organizationId,
      type: "PAYMENT_FAILED",
      priority: "HIGH",
      title: "Pagamento nao processado",
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
