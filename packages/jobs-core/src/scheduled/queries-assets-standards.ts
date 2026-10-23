import { Client } from "pg";
import { LAB_TODAY_SQL } from "@calibra-facil/shared";
import {
  type AssetDueRow,
  type AssetLegalVerificationDueRow,
  type OverdueJobRow,
  type PtPlanDueRow,
  type StandardExpiredRow,
  type StandardExpiringRow,
} from "./types.js";

/**
 * Check for assets due for recalibration within 7 days.
 *
 * Duplicate prevention: Assets are notified once per 7-day window.
 * This is intentional - we alert once when entering the window, not daily spam.
 * The asset should be recalibrated or the alert will fire again next week.
 */
export async function checkAssetsDueForRecalibration(
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
      (a.next_calibration_date - ${LAB_TODAY_SQL})::int as days_until_due
    FROM asset a
    JOIN customer c ON a.customer_id = c.id
    JOIN organization_unit ou ON a.unit_id = ou.id
    WHERE a.status = 'ACTIVE'
      AND a.next_calibration_date IS NOT NULL
      AND a.next_calibration_date BETWEEN ${LAB_TODAY_SQL} AND ${LAB_TODAY_SQL} + 7
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
export async function checkAssetsDueForLegalVerification(
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
      (a.next_legal_verification_date - ${LAB_TODAY_SQL})::int as days_until_due
    FROM asset a
    JOIN customer c ON a.customer_id = c.id
    JOIN organization_unit ou ON a.unit_id = ou.id
    WHERE a.status = 'ACTIVE'
      AND a.metrology_regime = 'LEGAL'
      AND a.next_legal_verification_date IS NOT NULL
      AND a.next_legal_verification_date BETWEEN ${LAB_TODAY_SQL} AND ${LAB_TODAY_SQL} + 30
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
export async function checkStandardsExpiring(
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
      (rs.next_calibration_date - ${LAB_TODAY_SQL})::int as days_until_expiry
    FROM reference_standard rs
    WHERE rs.status = 'ACTIVE'
      AND rs.next_calibration_date IS NOT NULL
      AND rs.next_calibration_date BETWEEN ${LAB_TODAY_SQL} AND ${LAB_TODAY_SQL} + 30
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

/**
 * Check for proficiency-test participation-plan items due within 90 days or
 * already overdue (ISO/IEC 17025 §7.7.2, issue #60).
 *
 * Duplicate prevention: plan items are notified once per 30-day window —
 * the cycle is measured in years, so a monthly reminder is enough.
 */
export async function checkPtPlanDue(
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
export async function checkStandardsExpired(
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
      (${LAB_TODAY_SQL} - rs.next_calibration_date)::int as days_expired
    FROM reference_standard rs
    WHERE rs.status = 'ACTIVE'
      AND rs.next_calibration_date IS NOT NULL
      AND rs.next_calibration_date < ${LAB_TODAY_SQL}
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
export async function checkOverdueJobs(
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
      (${LAB_TODAY_SQL} - cj.due_date)::int as days_overdue
    FROM calibration_job cj
    WHERE cj.status IN ('DRAFT', 'IN_PROGRESS', 'REVIEW')
      AND cj.due_date IS NOT NULL
      AND cj.due_date < ${LAB_TODAY_SQL}
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
