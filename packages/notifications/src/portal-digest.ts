// Opt-in due-calibration digest for client-portal users (see the section below).

import {
  getEmailLogoSrc,
  getLabEmailBrand,
  getPortalBaseUrl,
} from "./delivery";

import { inOrg, listPortalDigestRecipients } from "./lab-scope";
import { asset, organizationCustomDomain } from "@calibra-facil/db/schema";
import {
  eq,
  and,
  asc,
  inArray,
  isNull,
  isNotNull,
  lt,
  lte,
  sql,
} from "drizzle-orm";
import {
  addCalendarDays,
  isCalendarDatePast,
  labDaysUntil,
  labToday,
  portalDigestFrequenciesFor,
} from "@calibra-facil/shared";
import { formatCalendarDate } from "@calibra-facil/shared/format";

import { isEmailSuppressed } from "./suppression";
import {
  formatFromEmail,
  getPlatformFromEmail,
  getReplyToEmail,
  isPlatformEmailConfigured,
  sendPlatformEmail,
} from "@calibra-facil/email-sender";

import { render } from "@react-email/render";
import {
  PortalDueDigestEmail,
  type PortalDueDigestItem,
  type EmailBrand,
} from "@calibra-facil/email";

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

export type PortalDigestRunResult = {
  recipients: number;
  sent: number;
  skippedEmpty: number;
  /** Recipients skipped because their address is on the suppression ledger. */
  suppressed: number;
  errors: number;
};

function describePortalDigestDue(due: Date, now: Date): string {
  // `due` is a calendar date (UTC midnight of the day it names), counted in
  // laboratory days and printed as that same day.
  const days = labDaysUntil(due, now);
  const dateLabel = formatCalendarDate(due);
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
  const [domain] = await inOrg(labOrganizationId, (o) =>
    o
      .select({ hostname: organizationCustomDomain.hostname })
      .from(organizationCustomDomain)
      .where(
        and(
          eq(organizationCustomDomain.organizationId, labOrganizationId),
          eq(organizationCustomDomain.isActive, true),
          isNotNull(organizationCustomDomain.verifiedAt),
        ),
      )
      .limit(1),
  );

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

  const fromEmail = getPlatformFromEmail();
  if (!isPlatformEmailConfigured() || !fromEmail) {
    console.error(
      "[PortalDigest] EMAIL MISCONFIGURED: no e-mail transport (SMTP_HOST or RESEND_API_KEY) or no sender (EMAIL_FROM); skipping run.",
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

  const { customerRecipients, groupRecipients, branchesByGroup } =
    await listPortalDigestRecipients(frequencies);

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

  const logoSrc = getEmailLogoSrc();
  const brandByLab = new Map<string, EmailBrand | undefined>();
  const portalUrlByLab = new Map<string, string>();

  // next_calibration_date is a calendar day: overdue is before today in the
  // laboratory, due soon runs to today + 30.
  const today = labToday(now);
  const soon = addCalendarDays(today, PORTAL_DIGEST_DUE_SOON_DAYS);

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
      const [counts] = await inOrg(recipient.labOrganizationId, (o) =>
        o
          .select({
            total: sql<number>`cast(count(*) as int)`,
            overdue: sql<number>`cast(count(*) filter (where ${lt(asset.nextCalibrationDate, today)}) as int)`,
          })
          .from(asset)
          .where(dueWhere),
      );

      const total = counts?.total ?? 0;
      if (total === 0) {
        result.skippedEmpty += 1;
        continue;
      }
      const overdueCount = counts?.overdue ?? 0;
      const dueSoonCount = total - overdueCount;

      // oxlint-disable-next-line eslint/no-await-in-loop -- sequential per recipient (see above).
      const dueAssets = await inOrg(recipient.labOrganizationId, (o) =>
        o
          .select({
            name: asset.name,
            tag: asset.tag,
            nextCalibrationDate: asset.nextCalibrationDate,
          })
          .from(asset)
          .where(dueWhere)
          .orderBy(asc(asset.nextCalibrationDate), asc(asset.tag))
          .limit(PORTAL_DIGEST_MAX_ITEMS),
      );

      const items: PortalDueDigestItem[] = dueAssets.flatMap((item) => {
        if (!item.nextCalibrationDate) return [];
        return [
          {
            tag: item.tag,
            name: item.name,
            statusLabel: describePortalDigestDue(item.nextCalibrationDate, now),
            overdue: isCalendarDatePast(item.nextCalibrationDate, now),
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
      const delivery = await sendPlatformEmail({
        from: formatFromEmail(fromEmail, emailBrand),
        to: recipient.email,
        subject: `Resumo de calibrações: ${subjectParts.join(" · ")}`,
        html,
        replyTo: getReplyToEmail(emailBrand),
        headers: {
          "List-Unsubscribe": `<${unsubscribeUrl}>`,
        },
      });
      if (!delivery.ok) throw new Error(delivery.error);

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
