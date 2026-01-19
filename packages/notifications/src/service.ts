import { db } from "@calibra-facil/db";
import {
  notification,
  notificationPreference,
  member,
  user,
  calibrationJob,
  customer,
  asset,
  type NotificationType,
  type NotificationPriority,
  type NotificationChannel,
  type NotificationRelatedEntity,
  type NotificationPreferenceMap,
} from "@calibra-facil/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { Resend } from "resend";
import { render } from "@react-email/components";
import { NotificationEmail } from "@calibra-facil/email";

// Track if email misconfiguration warning has been logged this session
let emailMisconfigWarningLogged = false;

// =============================================================================
// TYPES
// =============================================================================

export interface SendNotificationOptions {
  recipientUserId: string;
  organizationId: string;
  type: NotificationType;
  priority?: NotificationPriority;
  title: string;
  message: string;
  relatedEntity?: NotificationRelatedEntity;
  actionUrl?: string;
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
 * Send notification email using Resend and React Email templates
 */
async function sendNotificationEmail(options: {
  recipientUserId: string;
  type: NotificationType;
  title: string;
  message: string;
  actionUrl?: string;
}): Promise<boolean> {
  const { recipientUserId, title, message, actionUrl } = options;

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

    // Render email using React Email template
    const html = await render(
      NotificationEmail({
        recipientName: userData.name ?? "Usuário",
        title,
        message,
        actionUrl,
        actionLabel: "Ver Detalhes",
      }),
    );

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

  const submitterName = submitter?.name ?? "Um técnico";

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
      title: "Calibração aguardando revisão",
      message: `${submitterName} submeteu a OS ${job.jobIdentifier} para revisão.`,
      relatedEntity: {
        entityType: "job",
        entityId: jobId,
        jobId: job.jobIdentifier,
      },
      actionUrl: `/dashboard/jobs/${jobId}`,
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
    title: "Nova calibração atribuída",
    message: `${assignerName} atribuiu a OS ${job.jobIdentifier} para você.`,
    relatedEntity: {
      entityType: "job",
      entityId: jobId,
      jobId: job.jobIdentifier,
    },
    actionUrl: `/dashboard/jobs/${jobId}`,
  });
}

/**
 * Notify client portal users when a certificate is ready
 */
export async function notifyCertificateReady(jobId: number): Promise<void> {
  const job = await getJobDetails(jobId);
  if (!job) return;

  // Get the customer's organization ID
  const [customerData] = await db
    .select({
      authOrganizationId: customer.authOrganizationId,
      name: customer.name,
    })
    .from(customer)
    .where(eq(customer.id, job.customerId))
    .limit(1);

  if (!customerData?.authOrganizationId) return;

  // Get all portal users in the customer organization
  const portalUsers = await db
    .select({ userId: member.userId })
    .from(member)
    .where(eq(member.organizationId, customerData.authOrganizationId));

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
    });
  }
}
