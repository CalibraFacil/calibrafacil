import { Client } from "pg";
import { LAB_TODAY_SQL } from "@calibra-facil/shared";
import {
  type AccreditationExpiringRow,
  type AccreditedScopeLineExpiringRow,
  type CompetenceExpiredRow,
  type CompetenceExpiringRow,
  type SigningCertificateExpiringRow,
  type VisitDueRow,
} from "./types.js";

/**
 * Check for personnel competences expiring within 30 days.
 * ISO 17025 Clause 6.2.3 - Personnel competence tracking.
 *
 * Duplicate prevention: Competences are notified once per 7-day window.
 */
export async function checkCompetencesExpiring(
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
export async function checkCompetencesExpired(
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
export async function checkVisitsDueSoon(
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
export async function checkSigningCertificatesExpiring(
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

/**
 * Accreditation vigência nearing its end (#647). Reuses the signing-cert
 * escalating-window decider (30/15/7) — same shape of problem: one validity
 * end date per entity + idempotency-per-window via scheduled_notification.
 * Only active accreditations with a filled validUntil are candidates.
 */
export async function checkAccreditationsExpiring(
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
            AND (
              sn.scheduled_for = o.accreditation_valid_until
              -- Rows recorded before migration 0116 hold the old instant
              -- (23:59:59.999 in Sao Paulo): match them by the day it named.
              OR (
                sn.scheduled_for <> date_trunc('day', sn.scheduled_for)
                AND (sn.scheduled_for AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date
                  = o.accreditation_valid_until
              )
            )
        ),
        ARRAY[]::int[]
      ) AS alerted_lead_days
    FROM organization o
    WHERE o.accreditation_active = true
      AND o.accreditation_valid_until IS NOT NULL
      -- Valid through its last day, inclusive (a calendar date).
      AND o.accreditation_valid_until >= ${LAB_TODAY_SQL}
      AND o.accreditation_valid_until <= ${LAB_TODAY_SQL} + 30
    ORDER BY o.accreditation_valid_until ASC, o.id ASC
    LIMIT $1 OFFSET $2
    `,
    [batchSize, offset],
  );

  return result.rows;
}

/**
 * Accredited-scope (CMC) line vigência nearing its end (#427 Phase 2). Same
 * escalating-window shape as the org-level accreditation above, but per line:
 * once a line expires, points it covered stop matching the scope and
 * accredited issuance in that range classifies OUT_OF_SCOPE (blocking under
 * enforce mode). Lines without a validUntil never expire and are skipped.
 */
export async function checkAccreditedScopeLinesExpiring(
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
