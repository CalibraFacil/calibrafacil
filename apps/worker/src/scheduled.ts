/**
 * Scheduled Compliance Alerts - ISO 17025 Compliance
 *
 * Runs daily at 08:00 UTC to check for:
 * 1. Assets due for recalibration within 7 days
 * 2. Reference standards expiring within 30 days
 * 3. Reference standards that have EXPIRED (ISO 17025 Clause 6.4.6)
 * 4. Overdue calibration jobs
 */

import { Client } from "pg";
import {
  decideSigningCertificateExpiryAlert,
  notifyAccreditationExpiring,
  notifyAccreditedScopeLineExpiring,
  notifyAssetDueForLegalVerification,
  notifyAssetDueForRecalibration,
  notifyCompetenceExpired,
  notifyCompetenceExpiring,
  notifyJobOverdue,
  notifySigningCertificateExpiring,
  notifyPtPlanDue,
  notifyStandardExpired,
  notifyStandardExpiring,
  notifyVisitReminder,
  sendPortalDueDigests,
  syncLabUsersToResendAudience,
  type PortalDigestRunResult,
  type ResendAudienceSyncEnv,
  type ResendAudienceSyncResult,
} from "@calibra-facil/notifications";

interface ScheduledEnv {
  DATABASE_URL: string;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  EMAIL_FROM?: string;
  EMAIL_LOGO_URL?: string;
  WEB_URL?: string;
  APP_URL?: string;
}

// Types for database rows
interface AssetDueRow {
  id: number;
  name: string;
  tag: string;
  customer_id: number;
  customer_name: string;
  organization_id: string;
  next_calibration_date: Date;
  days_until_due: number;
}

interface AssetLegalVerificationDueRow {
  id: number;
  name: string;
  tag: string;
  customer_id: number;
  customer_name: string;
  organization_id: string;
  next_legal_verification_date: Date;
  days_until_due: number;
}

interface StandardExpiringRow {
  id: number;
  name: string;
  serial_number: string;
  organization_id: string;
  next_calibration_date: Date;
  days_until_expiry: number;
}

interface StandardExpiredRow {
  id: number;
  name: string;
  serial_number: string;
  organization_id: string;
  next_calibration_date: Date;
  days_expired: number;
}

interface OverdueJobRow {
  id: number;
  job_id: string;
  organization_id: string;
  technician_id: string | null;
  created_by: string;
  due_date: Date;
  days_overdue: number;
}

interface CompetenceExpiringRow {
  id: number;
  user_id: string;
  user_name: string;
  scope_description: string;
  organization_id: string;
  expires_at: Date;
  days_until_expiry: number;
}

interface CompetenceExpiredRow {
  id: number;
  user_id: string;
  user_name: string;
  scope_description: string;
  organization_id: string;
  expires_at: Date;
  days_expired: number;
}

interface VisitDueRow {
  id: number;
  organization_id: string;
  scheduled_at: Date;
  days_until_visit: number;
}

interface SigningCertificateExpiringRow {
  id: number;
  organization_id: string;
  unit_id: number;
  valid_until: Date;
  // Lead windows (lead_time_days) already alerted for this certificate. Drives
  // idempotency-per-window in the pure decider.
  alerted_lead_days: number[];
}

// Helper to run a database operation with a fresh connection
async function withDbClient<T>(
  env: ScheduledEnv,
  operation: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({
    connectionString: env.DATABASE_URL,
  });
  await client.connect();
  try {
    return await operation(client);
  } finally {
    await client.end();
  }
}

/**
 * Check for assets due for recalibration within 7 days.
 *
 * Duplicate prevention: Assets are notified once per 7-day window.
 * This is intentional - we alert once when entering the window, not daily spam.
 * The asset should be recalibrated or the alert will fire again next week.
 */
async function checkAssetsDueForRecalibration(
  client: Client,
  offset = 0,
  batchSize = 100,
): Promise<AssetDueRow[]> {
  const result = await client.query<AssetDueRow>(
    `
    SELECT
      a.id,
      a.name,
      a.tag,
      a.customer_id,
      c.name as customer_name,
      ou.organization_id,
      a.next_calibration_date,
      EXTRACT(DAY FROM a.next_calibration_date - CURRENT_DATE)::int as days_until_due
    FROM asset a
    JOIN customer c ON a.customer_id = c.id
    JOIN organization_unit ou ON a.unit_id = ou.id
    WHERE a.status = 'ACTIVE'
      AND a.next_calibration_date IS NOT NULL
      AND a.next_calibration_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
      AND NOT EXISTS (
        SELECT 1 FROM scheduled_notification sn
        WHERE sn.entity_type = 'asset'
          AND sn.entity_id = a.id
          AND sn.type = 'ASSET_DUE_FOR_RECALIBRATION'
          AND sn.lead_time_days = 7
          AND sn.sent_at IS NOT NULL
          AND sn.sent_at > CURRENT_DATE - INTERVAL '7 days'
      )
    ORDER BY a.next_calibration_date ASC
    LIMIT $1 OFFSET $2
    `,
    [batchSize, offset],
  );

  return result.rows;
}

/**
 * Check for LEGAL-metrology instruments due for their regulation-fixed
 * VERIFICATION (Track 2 — Inmetro / RBMLQ-I) within the 30-day lead window.
 *
 * This is INDEPENDENT of the recalibration sweep above: it selects on the
 * separate `metrology_regime='LEGAL'` + `next_legal_verification_date` columns
 * and dedupes against its OWN distinct scheduled_notification type
 * (`ASSET_DUE_FOR_LEGAL_VERIFICATION`, lead_time_days=30), so a recalibration
 * reminder for the same asset is neither suppressed nor created here.
 *
 * Duplicate prevention: notified once per 7-day window (NOT EXISTS recency
 * guard). With a 30-day lead time, up to ~4 weekly reminders before the date.
 */
async function checkAssetsDueForLegalVerification(
  client: Client,
  offset = 0,
  batchSize = 100,
): Promise<AssetLegalVerificationDueRow[]> {
  const result = await client.query<AssetLegalVerificationDueRow>(
    `
    SELECT
      a.id,
      a.name,
      a.tag,
      a.customer_id,
      c.name as customer_name,
      ou.organization_id,
      a.next_legal_verification_date,
      EXTRACT(DAY FROM a.next_legal_verification_date - CURRENT_DATE)::int as days_until_due
    FROM asset a
    JOIN customer c ON a.customer_id = c.id
    JOIN organization_unit ou ON a.unit_id = ou.id
    WHERE a.status = 'ACTIVE'
      AND a.metrology_regime = 'LEGAL'
      AND a.next_legal_verification_date IS NOT NULL
      AND a.next_legal_verification_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
      AND NOT EXISTS (
        SELECT 1 FROM scheduled_notification sn
        WHERE sn.entity_type = 'asset'
          AND sn.entity_id = a.id
          AND sn.type = 'ASSET_DUE_FOR_LEGAL_VERIFICATION'
          AND sn.lead_time_days = 30
          AND sn.sent_at IS NOT NULL
          AND sn.sent_at > CURRENT_DATE - INTERVAL '7 days'
      )
    ORDER BY a.next_legal_verification_date ASC
    LIMIT $1 OFFSET $2
    `,
    [batchSize, offset],
  );

  return result.rows;
}

/**
 * Check for reference standards expiring within 30 days.
 *
 * Duplicate prevention: Standards are notified once per 7-day window.
 * With 30-day lead time, this means up to ~4 weekly reminders before expiry.
 */
async function checkStandardsExpiring(
  client: Client,
  offset = 0,
  batchSize = 100,
): Promise<StandardExpiringRow[]> {
  const result = await client.query<StandardExpiringRow>(
    `
    SELECT
      rs.id,
      rs.name,
      rs.serial_number,
      rs.organization_id,
      rs.next_calibration_date,
      EXTRACT(DAY FROM rs.next_calibration_date - CURRENT_DATE)::int as days_until_expiry
    FROM reference_standard rs
    WHERE rs.status = 'ACTIVE'
      AND rs.next_calibration_date IS NOT NULL
      AND rs.next_calibration_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
      AND NOT EXISTS (
        SELECT 1 FROM scheduled_notification sn
        WHERE sn.entity_type = 'standard'
          AND sn.entity_id = rs.id
          AND sn.type = 'STANDARD_EXPIRING'
          AND sn.lead_time_days = 30
          AND sn.sent_at IS NOT NULL
          AND sn.sent_at > CURRENT_DATE - INTERVAL '7 days'
      )
    ORDER BY rs.next_calibration_date ASC
    LIMIT $1 OFFSET $2
    `,
    [batchSize, offset],
  );

  return result.rows;
}

interface PtPlanDueRow {
  id: number;
  scope_part: string;
  organization_id: string;
  next_due_at: Date;
}

/**
 * Check for proficiency-test participation-plan items due within 90 days or
 * already overdue (ISO/IEC 17025 §7.7.2, issue #60).
 *
 * Duplicate prevention: plan items are notified once per 30-day window —
 * the cycle is measured in years, so a monthly reminder is enough.
 */
async function checkPtPlanDue(
  client: Client,
  offset = 0,
  batchSize = 100,
): Promise<PtPlanDueRow[]> {
  const result = await client.query<PtPlanDueRow>(
    `
    SELECT
      pp.id,
      pp.scope_part,
      pp.organization_id,
      pp.next_due_at
    FROM pt_plan_item pp
    WHERE pp.next_due_at IS NOT NULL
      AND pp.next_due_at <= CURRENT_DATE + INTERVAL '90 days'
      AND NOT EXISTS (
        SELECT 1 FROM scheduled_notification sn
        WHERE sn.entity_type = 'pt_plan_item'
          AND sn.entity_id = pp.id
          AND sn.type = 'PT_PLAN_DUE'
          AND sn.lead_time_days = 90
          AND sn.sent_at IS NOT NULL
          AND sn.sent_at > CURRENT_DATE - INTERVAL '30 days'
      )
    ORDER BY pp.next_due_at ASC
    LIMIT $1 OFFSET $2
    `,
    [batchSize, offset],
  );

  return result.rows;
}

/**
 * Check for reference standards that have EXPIRED (ISO 17025 Clause 6.4.6).
 *
 * Expired standards block job execution - this notifies admins immediately.
 * Duplicate prevention: Expired standards are notified weekly until renewed.
 */
async function checkStandardsExpired(
  client: Client,
  offset = 0,
  batchSize = 100,
): Promise<StandardExpiredRow[]> {
  const result = await client.query<StandardExpiredRow>(
    `
    SELECT
      rs.id,
      rs.name,
      rs.serial_number,
      rs.organization_id,
      rs.next_calibration_date,
      EXTRACT(DAY FROM CURRENT_DATE - rs.next_calibration_date)::int as days_expired
    FROM reference_standard rs
    WHERE rs.status = 'ACTIVE'
      AND rs.next_calibration_date IS NOT NULL
      AND rs.next_calibration_date < CURRENT_DATE
      AND NOT EXISTS (
        SELECT 1 FROM scheduled_notification sn
        WHERE sn.entity_type = 'standard'
          AND sn.entity_id = rs.id
          AND sn.type = 'STANDARD_EXPIRED'
          AND sn.sent_at IS NOT NULL
          AND sn.sent_at > CURRENT_DATE - INTERVAL '7 days'
      )
    ORDER BY rs.next_calibration_date ASC
    LIMIT $1 OFFSET $2
    `,
    [batchSize, offset],
  );

  return result.rows;
}

/**
 * Check for overdue calibration jobs.
 *
 * Duplicate prevention: Overdue jobs are notified daily until resolved.
 * This ensures visibility for time-sensitive compliance issues.
 */
async function checkOverdueJobs(
  client: Client,
  offset = 0,
  batchSize = 100,
): Promise<OverdueJobRow[]> {
  const result = await client.query<OverdueJobRow>(
    `
    SELECT
      cj.id,
      cj.job_id,
      cj.organization_id,
      cj.technician_id,
      cj.created_by,
      cj.due_date,
      EXTRACT(DAY FROM CURRENT_DATE - cj.due_date)::int as days_overdue
    FROM calibration_job cj
    WHERE cj.status IN ('DRAFT', 'IN_PROGRESS', 'REVIEW')
      AND cj.due_date IS NOT NULL
      AND cj.due_date < CURRENT_DATE
      AND NOT EXISTS (
        SELECT 1 FROM scheduled_notification sn
        WHERE sn.entity_type = 'job'
          AND sn.entity_id = cj.id
          AND sn.type = 'JOB_OVERDUE'
          AND sn.lead_time_days = 0
          AND sn.sent_at IS NOT NULL
          AND sn.sent_at > CURRENT_DATE - INTERVAL '1 day'
      )
    ORDER BY cj.due_date ASC
    LIMIT $1 OFFSET $2
    `,
    [batchSize, offset],
  );

  return result.rows;
}

/**
 * Record that a scheduled notification was sent
 */
async function recordScheduledNotification(
  client: Client,
  params: {
    organizationId: string;
    type: string;
    entityType: string;
    entityId: number;
    scheduledFor: Date;
    leadTimeDays: number;
  },
): Promise<void> {
  await client.query(
    `
    INSERT INTO scheduled_notification (
      organization_id,
      type,
      entity_type,
      entity_id,
      scheduled_for,
      lead_time_days,
      sent_at
    ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
    ON CONFLICT (organization_id, type, entity_type, entity_id, lead_time_days)
    DO UPDATE SET sent_at = NOW(), scheduled_for = EXCLUDED.scheduled_for
    `,
    [
      params.organizationId,
      params.type,
      params.entityType,
      params.entityId,
      params.scheduledFor,
      params.leadTimeDays,
    ],
  );
}

/**
 * Check for personnel competences expiring within 30 days.
 * ISO 17025 Clause 6.2.3 - Personnel competence tracking.
 *
 * Duplicate prevention: Competences are notified once per 7-day window.
 */
async function checkCompetencesExpiring(
  client: Client,
  offset = 0,
  batchSize = 100,
): Promise<CompetenceExpiringRow[]> {
  const result = await client.query<CompetenceExpiringRow>(
    `
    SELECT
      pc.id,
      pc.user_id,
      u.name as user_name,
      pc.scope_description,
      pc.organization_id,
      pc.expires_at,
      EXTRACT(DAY FROM pc.expires_at - CURRENT_DATE)::int as days_until_expiry
    FROM personnel_competence pc
    JOIN "user" u ON pc.user_id = u.id
    WHERE pc.status = 'ACTIVE'
      AND pc.deleted_at IS NULL
      AND pc.expires_at IS NOT NULL
      AND pc.expires_at BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
      AND NOT EXISTS (
        SELECT 1 FROM scheduled_notification sn
        WHERE sn.entity_type = 'competence'
          AND sn.entity_id = pc.id
          AND sn.type = 'COMPETENCE_EXPIRING'
          AND sn.lead_time_days = 30
          AND sn.sent_at IS NOT NULL
          AND sn.sent_at > CURRENT_DATE - INTERVAL '7 days'
      )
    ORDER BY pc.expires_at ASC
    LIMIT $1 OFFSET $2
    `,
    [batchSize, offset],
  );

  return result.rows;
}

/**
 * Check for personnel competences that have EXPIRED.
 * Auto-expire: update status to EXPIRED.
 *
 * Duplicate prevention: Expired competences are notified weekly until renewed.
 */
async function checkCompetencesExpired(
  client: Client,
  offset = 0,
  batchSize = 100,
): Promise<CompetenceExpiredRow[]> {
  const result = await client.query<CompetenceExpiredRow>(
    `
    SELECT
      pc.id,
      pc.user_id,
      u.name as user_name,
      pc.scope_description,
      pc.organization_id,
      pc.expires_at,
      EXTRACT(DAY FROM CURRENT_DATE - pc.expires_at)::int as days_expired
    FROM personnel_competence pc
    JOIN "user" u ON pc.user_id = u.id
    WHERE pc.status = 'ACTIVE'
      AND pc.deleted_at IS NULL
      AND pc.expires_at IS NOT NULL
      AND pc.expires_at < CURRENT_DATE
      AND NOT EXISTS (
        SELECT 1 FROM scheduled_notification sn
        WHERE sn.entity_type = 'competence'
          AND sn.entity_id = pc.id
          AND sn.type = 'COMPETENCE_EXPIRED'
          AND sn.sent_at IS NOT NULL
          AND sn.sent_at > CURRENT_DATE - INTERVAL '7 days'
      )
    ORDER BY pc.expires_at ASC
    LIMIT $1 OFFSET $2
    `,
    [batchSize, offset],
  );

  return result.rows;
}

/**
 * Check for confirmed on-site visits happening within the next 3 days.
 *
 * Duplicate prevention: each visit is reminded once per 3-day window, so a
 * visit confirmed far ahead still gets exactly one heads-up as it approaches.
 */
async function checkVisitsDueSoon(
  client: Client,
  offset = 0,
  batchSize = 100,
): Promise<VisitDueRow[]> {
  const result = await client.query<VisitDueRow>(
    `
    SELECT
      v.id,
      v.organization_id,
      v.scheduled_at,
      (v.scheduled_at::date - CURRENT_DATE)::int as days_until_visit
    FROM calibration_visit v
    WHERE v.status = 'CONFIRMED'
      AND v.scheduled_at IS NOT NULL
      AND v.scheduled_at::date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '3 days'
      AND NOT EXISTS (
        SELECT 1 FROM scheduled_notification sn
        WHERE sn.entity_type = 'visit'
          AND sn.entity_id = v.id
          AND sn.type = 'VISIT_REMINDER'
          AND sn.lead_time_days = 3
          AND sn.sent_at IS NOT NULL
          AND sn.sent_at > CURRENT_DATE - INTERVAL '3 days'
      )
    ORDER BY v.scheduled_at ASC
    LIMIT $1 OFFSET $2
    `,
    [batchSize, offset],
  );

  return result.rows;
}

/**
 * Check for ICP-Brasil A1 signing certificates nearing `validUntil` — CMP-02
 * (issue #645). When a signing certificate expires, emission silently degrades
 * to unsigned (CMP-01), so admins are warned ahead of time.
 *
 * This scan is a COARSE candidate filter: still-valid, active, non-revoked
 * certificates whose validity ends within the widest lead window (30 days),
 * scoped per organization + unit. The escalating-window decision and the
 * idempotency-per-window logic live in the pure decider
 * (`decideSigningCertificateExpiryAlert`); this query only gathers its inputs,
 * including the set of lead windows already alerted for each certificate.
 *
 * Signing certificates are low-cardinality (roughly one per unit), and this
 * scan carries no NOT-EXISTS narrowing, so the candidate set is stable across a
 * single run and pagination advances by the full page.
 */
async function checkSigningCertificatesExpiring(
  client: Client,
  offset = 0,
  batchSize = 100,
): Promise<SigningCertificateExpiringRow[]> {
  const result = await client.query<SigningCertificateExpiringRow>(
    `
    SELECT
      c.id,
      c.organization_id,
      c.unit_id,
      c.valid_until,
      COALESCE(
        ARRAY(
          SELECT sn.lead_time_days
          FROM scheduled_notification sn
          WHERE sn.type = 'SIGNING_CERTIFICATE_EXPIRING'
            AND sn.entity_type = 'signing_certificate'
            AND sn.entity_id = c.id
            AND sn.organization_id = c.organization_id
            AND sn.sent_at IS NOT NULL
        ),
        ARRAY[]::int[]
      ) AS alerted_lead_days
    FROM organization_signing_certificate c
    WHERE c.is_active = true
      AND c.revoked_at IS NULL
      AND c.valid_until > NOW()
      AND c.valid_until <= NOW() + INTERVAL '30 days'
    ORDER BY c.valid_until ASC, c.id ASC
    LIMIT $1 OFFSET $2
    `,
    [batchSize, offset],
  );

  return result.rows;
}

interface AccreditationExpiringRow {
  organization_id: string;
  valid_until: Date;
  alerted_lead_days: number[];
}

/**
 * Accreditation vigência nearing its end (#647). Reuses the signing-cert
 * escalating-window decider (30/15/7) — same shape of problem: one validity
 * end date per entity + idempotency-per-window via scheduled_notification.
 * Only active accreditations with a filled validUntil are candidates.
 */
async function checkAccreditationsExpiring(
  client: Client,
  offset = 0,
  batchSize = 100,
): Promise<AccreditationExpiringRow[]> {
  const result = await client.query<AccreditationExpiringRow>(
    `
    SELECT
      o.id as organization_id,
      o.accreditation_valid_until as valid_until,
      COALESCE(
        ARRAY(
          SELECT sn.lead_time_days
          FROM scheduled_notification sn
          WHERE sn.type = 'ACCREDITATION_EXPIRING'
            AND sn.entity_type = 'organization_accreditation'
            AND sn.organization_id = o.id
            AND sn.sent_at IS NOT NULL
            -- Only windows alerted for THIS expiry: a renewed vigência
            -- (new valid_until) re-arms all windows instead of staying
            -- suppressed forever by the previous cycle's rows.
            AND sn.scheduled_for = o.accreditation_valid_until
        ),
        ARRAY[]::int[]
      ) AS alerted_lead_days
    FROM organization o
    WHERE o.accreditation_active = true
      AND o.accreditation_valid_until IS NOT NULL
      AND o.accreditation_valid_until > NOW()
      AND o.accreditation_valid_until <= NOW() + INTERVAL '30 days'
    ORDER BY o.accreditation_valid_until ASC, o.id ASC
    LIMIT $1 OFFSET $2
    `,
    [batchSize, offset],
  );

  return result.rows;
}

interface AccreditedScopeLineExpiringRow {
  id: number;
  organization_id: string;
  valid_until: Date;
  alerted_lead_days: number[];
}

/**
 * Accredited-scope (CMC) line vigência nearing its end (#427 Phase 2). Same
 * escalating-window shape as the org-level accreditation above, but per line:
 * once a line expires, points it covered stop matching the scope and
 * accredited issuance in that range classifies OUT_OF_SCOPE (blocking under
 * enforce mode). Lines without a validUntil never expire and are skipped.
 */
async function checkAccreditedScopeLinesExpiring(
  client: Client,
  offset = 0,
  batchSize = 100,
): Promise<AccreditedScopeLineExpiringRow[]> {
  const result = await client.query<AccreditedScopeLineExpiringRow>(
    `
    SELECT
      l.id,
      l.organization_id,
      l.valid_until,
      COALESCE(
        ARRAY(
          SELECT sn.lead_time_days
          FROM scheduled_notification sn
          WHERE sn.type = 'ACCREDITED_SCOPE_LINE_EXPIRING'
            AND sn.entity_type = 'accredited_scope_line'
            AND sn.entity_id = l.id
            AND sn.organization_id = l.organization_id
            AND sn.sent_at IS NOT NULL
            -- Only windows alerted for THIS expiry: renewing the line's
            -- vigência in place (same id, new valid_until) re-arms all
            -- windows instead of staying suppressed by the previous cycle.
            AND sn.scheduled_for = l.valid_until
        ),
        ARRAY[]::int[]
      ) AS alerted_lead_days
    FROM accredited_scope_line l
    WHERE l.valid_until IS NOT NULL
      AND l.valid_until > NOW()
      AND l.valid_until <= NOW() + INTERVAL '30 days'
    ORDER BY l.valid_until ASC, l.id ASC
    LIMIT $1 OFFSET $2
    `,
    [batchSize, offset],
  );

  return result.rows;
}

const BATCH_SIZE = 100;

/**
 * Process all scheduled compliance notifications with pagination
 */
export async function processScheduledNotifications(
  env: ScheduledEnv,
): Promise<{
  assetsProcessed: number;
  legalVerificationsProcessed: number;
  standardsProcessed: number;
  standardsExpiredProcessed: number;
  jobsProcessed: number;
  competencesExpiringProcessed: number;
  competencesExpiredProcessed: number;
  visitsProcessed: number;
  signingCertsProcessed: number;
  accreditationsProcessed: number;
  scopeLinesProcessed: number;
  ptPlanItemsProcessed: number;
}> {
  let assetsProcessed = 0;
  let legalVerificationsProcessed = 0;
  let standardsProcessed = 0;
  let standardsExpiredProcessed = 0;
  let jobsProcessed = 0;
  let competencesExpiringProcessed = 0;
  let competencesExpiredProcessed = 0;
  let visitsProcessed = 0;
  let signingCertsProcessed = 0;
  let accreditationsProcessed = 0;
  let scopeLinesProcessed = 0;
  let ptPlanItemsProcessed = 0;

  await withDbClient(env, async (client) => {
    // 1. Process assets due for recalibration (with pagination)
    let assetOffset = 0;
    let assetBatch: AssetDueRow[];

    do {
      assetBatch = await checkAssetsDueForRecalibration(
        client,
        assetOffset,
        BATCH_SIZE,
      );
      if (assetBatch.length > 0) {
        console.log(
          `[Scheduled] Processing ${assetBatch.length} assets (offset ${assetOffset})`,
        );
      }

      let batchFailures = 0;
      for (const asset of assetBatch) {
        try {
          await notifyAssetDueForRecalibration(asset.id, asset.organization_id);

          await recordScheduledNotification(client, {
            organizationId: asset.organization_id,
            type: "ASSET_DUE_FOR_RECALIBRATION",
            entityType: "asset",
            entityId: asset.id,
            scheduledFor: asset.next_calibration_date,
            leadTimeDays: 7,
          });

          assetsProcessed++;
        } catch (error) {
          batchFailures++;
          console.error(
            `[Scheduled] Error processing asset ${asset.id}:`,
            error,
          );
        }
      }

      // Successful rows leave the NOT-EXISTS window (recordScheduledNotification
      // sets sent_at), so the next page must start where the FAILED rows left
      // off — advancing by the full batch size skipped up to BATCH_SIZE
      // still-due rows per pass.
      assetOffset += batchFailures;
    } while (assetBatch.length === BATCH_SIZE);

    // 1b. Process LEGAL-metrology instruments due for regulation-fixed
    // VERIFICATION (Track 2 — Inmetro / RBMLQ-I), INDEPENDENT of recalibration.
    let legalOffset = 0;
    let legalBatch: AssetLegalVerificationDueRow[];

    do {
      legalBatch = await checkAssetsDueForLegalVerification(
        client,
        legalOffset,
        BATCH_SIZE,
      );
      if (legalBatch.length > 0) {
        console.log(
          `[Scheduled] Processing ${legalBatch.length} legal-verification reminders (offset ${legalOffset})`,
        );
      }

      let batchFailures = 0;
      for (const legalAsset of legalBatch) {
        try {
          await notifyAssetDueForLegalVerification(
            legalAsset.id,
            legalAsset.organization_id,
          );

          await recordScheduledNotification(client, {
            organizationId: legalAsset.organization_id,
            type: "ASSET_DUE_FOR_LEGAL_VERIFICATION",
            entityType: "asset",
            entityId: legalAsset.id,
            scheduledFor: legalAsset.next_legal_verification_date,
            leadTimeDays: 30,
          });

          legalVerificationsProcessed++;
        } catch (error) {
          batchFailures++;
          console.error(
            `[Scheduled] Error processing legal-verification for asset ${legalAsset.id}:`,
            error,
          );
        }
      }

      // Successful rows leave the NOT-EXISTS window (recordScheduledNotification
      // sets sent_at), so the next page must start where the FAILED rows left
      // off — advancing by the full batch size skipped up to BATCH_SIZE
      // still-due rows per pass.
      legalOffset += batchFailures;
    } while (legalBatch.length === BATCH_SIZE);

    // 2. Process expiring reference standards (with pagination)
    let standardOffset = 0;
    let standardBatch: StandardExpiringRow[];

    do {
      standardBatch = await checkStandardsExpiring(
        client,
        standardOffset,
        BATCH_SIZE,
      );
      if (standardBatch.length > 0) {
        console.log(
          `[Scheduled] Processing ${standardBatch.length} standards (offset ${standardOffset})`,
        );
      }

      let batchFailures = 0;
      for (const standard of standardBatch) {
        try {
          await notifyStandardExpiring(standard.id, standard.organization_id);

          await recordScheduledNotification(client, {
            organizationId: standard.organization_id,
            type: "STANDARD_EXPIRING",
            entityType: "standard",
            entityId: standard.id,
            scheduledFor: standard.next_calibration_date,
            leadTimeDays: 30,
          });

          standardsProcessed++;
        } catch (error) {
          batchFailures++;
          console.error(
            `[Scheduled] Error processing standard ${standard.id}:`,
            error,
          );
        }
      }

      // Successful rows leave the NOT-EXISTS window (recordScheduledNotification
      // sets sent_at), so the next page must start where the FAILED rows left
      // off — advancing by the full batch size skipped up to BATCH_SIZE
      // still-due rows per pass.
      standardOffset += batchFailures;
    } while (standardBatch.length === BATCH_SIZE);

    // 3. Process EXPIRED reference standards - ISO 17025 Clause 6.4.6 (with pagination)
    let expiredOffset = 0;
    let expiredBatch: StandardExpiredRow[];

    do {
      expiredBatch = await checkStandardsExpired(
        client,
        expiredOffset,
        BATCH_SIZE,
      );
      if (expiredBatch.length > 0) {
        console.log(
          `[Scheduled] Processing ${expiredBatch.length} expired standards (offset ${expiredOffset})`,
        );
      }

      let batchFailures = 0;
      for (const standard of expiredBatch) {
        try {
          await notifyStandardExpired(standard.id, standard.organization_id);

          await recordScheduledNotification(client, {
            organizationId: standard.organization_id,
            type: "STANDARD_EXPIRED",
            entityType: "standard",
            entityId: standard.id,
            scheduledFor: standard.next_calibration_date,
            leadTimeDays: 0,
          });

          standardsExpiredProcessed++;
        } catch (error) {
          batchFailures++;
          console.error(
            `[Scheduled] Error processing expired standard ${standard.id}:`,
            error,
          );
        }
      }

      // Successful rows leave the NOT-EXISTS window (recordScheduledNotification
      // sets sent_at), so the next page must start where the FAILED rows left
      // off — advancing by the full batch size skipped up to BATCH_SIZE
      // still-due rows per pass.
      expiredOffset += batchFailures;
    } while (expiredBatch.length === BATCH_SIZE);

    // 4. Process overdue jobs (with pagination)
    let jobOffset = 0;
    let jobBatch: OverdueJobRow[];

    do {
      jobBatch = await checkOverdueJobs(client, jobOffset, BATCH_SIZE);
      if (jobBatch.length > 0) {
        console.log(
          `[Scheduled] Processing ${jobBatch.length} overdue jobs (offset ${jobOffset})`,
        );
      }

      let batchFailures = 0;
      for (const job of jobBatch) {
        try {
          await notifyJobOverdue(job.id);

          await recordScheduledNotification(client, {
            organizationId: job.organization_id,
            type: "JOB_OVERDUE",
            entityType: "job",
            entityId: job.id,
            scheduledFor: job.due_date,
            leadTimeDays: 0,
          });

          jobsProcessed++;
        } catch (error) {
          batchFailures++;
          console.error(`[Scheduled] Error processing job ${job.id}:`, error);
        }
      }

      // Successful rows leave the NOT-EXISTS window (recordScheduledNotification
      // sets sent_at), so the next page must start where the FAILED rows left
      // off — advancing by the full batch size skipped up to BATCH_SIZE
      // still-due rows per pass.
      jobOffset += batchFailures;
    } while (jobBatch.length === BATCH_SIZE);

    // 5. Process competences expiring within 30 days - ISO 17025 Clause 6.2.3 (with pagination)
    let compExpiringOffset = 0;
    let compExpiringBatch: CompetenceExpiringRow[];

    do {
      compExpiringBatch = await checkCompetencesExpiring(
        client,
        compExpiringOffset,
        BATCH_SIZE,
      );
      if (compExpiringBatch.length > 0) {
        console.log(
          `[Scheduled] Processing ${compExpiringBatch.length} expiring competences (offset ${compExpiringOffset})`,
        );
      }

      let batchFailures = 0;
      for (const comp of compExpiringBatch) {
        try {
          await notifyCompetenceExpiring(comp.id, comp.organization_id);

          await recordScheduledNotification(client, {
            organizationId: comp.organization_id,
            type: "COMPETENCE_EXPIRING",
            entityType: "competence",
            entityId: comp.id,
            scheduledFor: comp.expires_at,
            leadTimeDays: 30,
          });

          competencesExpiringProcessed++;
        } catch (error) {
          batchFailures++;
          console.error(
            `[Scheduled] Error processing expiring competence ${comp.id}:`,
            error,
          );
        }
      }

      // Successful rows leave the NOT-EXISTS window (recordScheduledNotification
      // sets sent_at), so the next page must start where the FAILED rows left
      // off — advancing by the full batch size skipped up to BATCH_SIZE
      // still-due rows per pass.
      compExpiringOffset += batchFailures;
    } while (compExpiringBatch.length === BATCH_SIZE);

    // 6. Process EXPIRED competences - auto-expire and notify (with pagination)
    let compExpiredOffset = 0;
    let compExpiredBatch: CompetenceExpiredRow[];

    do {
      compExpiredBatch = await checkCompetencesExpired(
        client,
        compExpiredOffset,
        BATCH_SIZE,
      );
      if (compExpiredBatch.length > 0) {
        console.log(
          `[Scheduled] Processing ${compExpiredBatch.length} expired competences (offset ${compExpiredOffset})`,
        );
      }

      let batchFailures = 0;
      for (const comp of compExpiredBatch) {
        try {
          // Auto-expire: update status to EXPIRED
          await client.query(
            `UPDATE personnel_competence SET status = 'EXPIRED' WHERE id = $1 AND status = 'ACTIVE'`,
            [comp.id],
          );

          // Log the auto-expiration in audit log
          await client.query(
            `INSERT INTO personnel_competence_audit_log (competence_id, action, changes, performed_by)
             VALUES ($1, 'expire', $2, 'system')`,
            [
              comp.id,
              JSON.stringify({
                status: { old: "ACTIVE", new: "EXPIRED" },
                autoExpired: true,
              }),
            ],
          );

          await notifyCompetenceExpired(comp.id, comp.organization_id);

          await recordScheduledNotification(client, {
            organizationId: comp.organization_id,
            type: "COMPETENCE_EXPIRED",
            entityType: "competence",
            entityId: comp.id,
            scheduledFor: comp.expires_at,
            leadTimeDays: 0,
          });

          competencesExpiredProcessed++;
        } catch (error) {
          batchFailures++;
          console.error(
            `[Scheduled] Error processing expired competence ${comp.id}:`,
            error,
          );
        }
      }

      // Successful rows leave the NOT-EXISTS window (recordScheduledNotification
      // sets sent_at), so the next page must start where the FAILED rows left
      // off — advancing by the full batch size skipped up to BATCH_SIZE
      // still-due rows per pass.
      compExpiredOffset += batchFailures;
    } while (compExpiredBatch.length === BATCH_SIZE);

    // 7. Remind técnico + customer of upcoming on-site visits (with pagination)
    let visitOffset = 0;
    let visitBatch: VisitDueRow[];

    do {
      visitBatch = await checkVisitsDueSoon(client, visitOffset, BATCH_SIZE);
      if (visitBatch.length > 0) {
        console.log(
          `[Scheduled] Processing ${visitBatch.length} upcoming visits (offset ${visitOffset})`,
        );
      }

      let batchFailures = 0;
      for (const visit of visitBatch) {
        try {
          await notifyVisitReminder(visit.id);

          await recordScheduledNotification(client, {
            organizationId: visit.organization_id,
            type: "VISIT_REMINDER",
            entityType: "visit",
            entityId: visit.id,
            scheduledFor: visit.scheduled_at,
            leadTimeDays: 3,
          });

          visitsProcessed++;
        } catch (error) {
          batchFailures++;
          console.error(
            `[Scheduled] Error processing visit ${visit.id}:`,
            error,
          );
        }
      }

      // Successful rows leave the NOT-EXISTS window (recordScheduledNotification
      // sets sent_at), so the next page must start where the FAILED rows left
      // off — advancing by the full batch size skipped up to BATCH_SIZE
      // still-due rows per pass.
      visitOffset += batchFailures;
    } while (visitBatch.length === BATCH_SIZE);

    // 8. Warn admins/owners that an ICP-Brasil A1 signing certificate is nearing
    // validUntil — CMP-02 (issue #645). The escalating-window + idempotency
    // decision is delegated to the pure `decideSigningCertificateExpiryAlert`;
    // this loop only feeds it the candidate certificates and records the fired
    // window. Reads validity only — never touches signing crypto.
    let signingCertOffset = 0;
    let signingCertBatch: SigningCertificateExpiringRow[];

    do {
      signingCertBatch = await checkSigningCertificatesExpiring(
        client,
        signingCertOffset,
        BATCH_SIZE,
      );
      if (signingCertBatch.length > 0) {
        console.log(
          `[Scheduled] Evaluating ${signingCertBatch.length} signing certificates (offset ${signingCertOffset})`,
        );
      }

      const now = new Date();
      for (const cert of signingCertBatch) {
        try {
          const decision = decideSigningCertificateExpiryAlert({
            validUntil: cert.valid_until,
            now,
            alreadyAlertedLeadDays: cert.alerted_lead_days,
          });

          if (!decision.shouldAlert || decision.leadTimeDays === null) {
            continue;
          }

          await notifySigningCertificateExpiring(
            cert.id,
            cert.organization_id,
            { daysRemaining: decision.daysUntilExpiry },
          );

          await recordScheduledNotification(client, {
            organizationId: cert.organization_id,
            type: "SIGNING_CERTIFICATE_EXPIRING",
            entityType: "signing_certificate",
            entityId: cert.id,
            scheduledFor: cert.valid_until,
            leadTimeDays: decision.leadTimeDays,
          });

          signingCertsProcessed++;
        } catch (error) {
          console.error(
            `[Scheduled] Error processing signing certificate ${cert.id}:`,
            error,
          );
        }
      }

      // This scan carries no NOT-EXISTS narrowing, so the candidate set is
      // stable across the run — advance by the full page to make forward
      // progress (a suppressed "already-alerted" row stays in the set).
      signingCertOffset += signingCertBatch.length;
    } while (signingCertBatch.length === BATCH_SIZE);

    // 9. Warn admins/owners that the Cgcre/RBC accreditation vigência nears
    // its end (#647). Same escalating-window decider as the signing certs —
    // one validity end per org, idempotency-per-window via
    // scheduled_notification (entity_type organization_accreditation, id 0).
    let accreditationOffset = 0;
    let accreditationBatch: AccreditationExpiringRow[];

    do {
      accreditationBatch = await checkAccreditationsExpiring(
        client,
        accreditationOffset,
        BATCH_SIZE,
      );
      if (accreditationBatch.length > 0) {
        console.log(
          `[Scheduled] Evaluating ${accreditationBatch.length} accreditations (offset ${accreditationOffset})`,
        );
      }

      const accreditationNow = new Date();
      for (const row of accreditationBatch) {
        try {
          const decision = decideSigningCertificateExpiryAlert({
            validUntil: row.valid_until,
            now: accreditationNow,
            alreadyAlertedLeadDays: row.alerted_lead_days,
          });

          if (!decision.shouldAlert || decision.leadTimeDays === null) {
            continue;
          }

          await notifyAccreditationExpiring(row.organization_id, {
            daysRemaining: decision.daysUntilExpiry,
            validUntil: row.valid_until,
          });

          await recordScheduledNotification(client, {
            organizationId: row.organization_id,
            type: "ACCREDITATION_EXPIRING",
            entityType: "organization_accreditation",
            entityId: 0,
            scheduledFor: row.valid_until,
            leadTimeDays: decision.leadTimeDays,
          });

          accreditationsProcessed++;
        } catch (error) {
          console.error(
            `[Scheduled] Error processing accreditation for org ${row.organization_id}:`,
            error,
          );
        }
      }

      accreditationOffset += accreditationBatch.length;
    } while (accreditationBatch.length === BATCH_SIZE);

    // 10. Warn admins/owners that an accredited-scope (CMC) line's vigência
    // nears its end (#427 Phase 2). Same escalating-window decider — one
    // validity end per line, idempotency-per-window via scheduled_notification
    // (entity_type accredited_scope_line, entity_id = line id).
    let scopeLineOffset = 0;
    let scopeLineBatch: AccreditedScopeLineExpiringRow[];

    do {
      scopeLineBatch = await checkAccreditedScopeLinesExpiring(
        client,
        scopeLineOffset,
        BATCH_SIZE,
      );
      if (scopeLineBatch.length > 0) {
        console.log(
          `[Scheduled] Evaluating ${scopeLineBatch.length} accredited-scope lines (offset ${scopeLineOffset})`,
        );
      }

      const scopeLineNow = new Date();
      for (const row of scopeLineBatch) {
        try {
          const decision = decideSigningCertificateExpiryAlert({
            validUntil: row.valid_until,
            now: scopeLineNow,
            alreadyAlertedLeadDays: row.alerted_lead_days,
          });

          if (!decision.shouldAlert || decision.leadTimeDays === null) {
            continue;
          }

          await notifyAccreditedScopeLineExpiring(
            row.id,
            row.organization_id,
            { daysRemaining: decision.daysUntilExpiry },
          );

          await recordScheduledNotification(client, {
            organizationId: row.organization_id,
            type: "ACCREDITED_SCOPE_LINE_EXPIRING",
            entityType: "accredited_scope_line",
            entityId: row.id,
            scheduledFor: row.valid_until,
            leadTimeDays: decision.leadTimeDays,
          });

          scopeLinesProcessed++;
        } catch (error) {
          console.error(
            `[Scheduled] Error processing accredited-scope line ${row.id}:`,
            error,
          );
        }
      }

      // No NOT-EXISTS narrowing: the candidate set is stable across the run —
      // advance by the full page to make forward progress.
      scopeLineOffset += scopeLineBatch.length;
    } while (scopeLineBatch.length === BATCH_SIZE);

    // 11. Process proficiency-test participation-plan due dates (issue #60)
    let ptPlanOffset = 0;
    let ptPlanBatch: PtPlanDueRow[];

    do {
      ptPlanBatch = await checkPtPlanDue(client, ptPlanOffset, BATCH_SIZE);
      if (ptPlanBatch.length > 0) {
        console.log(
          `[Scheduled] Processing ${ptPlanBatch.length} PT plan items (offset ${ptPlanOffset})`,
        );
      }

      let batchFailures = 0;
      for (const planItem of ptPlanBatch) {
        try {
          await notifyPtPlanDue(planItem.id, planItem.organization_id);

          await recordScheduledNotification(client, {
            organizationId: planItem.organization_id,
            type: "PT_PLAN_DUE",
            entityType: "pt_plan_item",
            entityId: planItem.id,
            scheduledFor: planItem.next_due_at,
            leadTimeDays: 90,
          });

          ptPlanItemsProcessed++;
        } catch (error) {
          batchFailures++;
          console.error(
            `[Scheduled] Error processing PT plan item ${planItem.id}:`,
            error,
          );
        }
      }
      ptPlanOffset += batchFailures;
    } while (ptPlanBatch.length === BATCH_SIZE);
  });

  return {
    assetsProcessed,
    legalVerificationsProcessed,
    standardsProcessed,
    standardsExpiredProcessed,
    jobsProcessed,
    competencesExpiringProcessed,
    competencesExpiredProcessed,
    visitsProcessed,
    signingCertsProcessed,
    accreditationsProcessed,
    scopeLinesProcessed,
    ptPlanItemsProcessed,
  };
}

/**
 * Client-portal due-calibration digest (PORTAL_DIGEST background job).
 * All selection and sending lives in @calibra-facil/notifications; the worker
 * just provides the runtime (process.env carries DATABASE_URL + Resend keys,
 * exactly like the notify* calls above).
 */
export async function processPortalDigest(): Promise<PortalDigestRunResult> {
  return sendPortalDueDigests();
}

/**
 * Sync lab-org staff into the Resend marketing audience (MARKETING_CONTACT_SYNC
 * background job). Selection, suppression-awareness, the soft opt-in and the
 * idempotent upsert all live in @calibra-facil/notifications; the worker just
 * passes the runtime config (Resend key, audience + topic ids, the safety
 * flag). The whole path is a no-op unless MARKETING_CONTACT_SYNC_ENABLED is
 * exactly "true" AND the audience/topic ids are configured.
 */
export async function processMarketingContactSync(
  env: ResendAudienceSyncEnv,
): Promise<ResendAudienceSyncResult> {
  return syncLabUsersToResendAudience(env);
}
