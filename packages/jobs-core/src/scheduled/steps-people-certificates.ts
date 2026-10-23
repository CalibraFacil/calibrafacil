import { Client } from "pg";
import { labToday } from "@calibra-facil/shared";
import {
  decideSigningCertificateExpiryAlert,
  notifyAccreditationExpiring,
  notifyAccreditedScopeLineExpiring,
  notifyCompetenceExpired,
  notifyCompetenceExpiring,
  notifySigningCertificateExpiring,
  notifyPtPlanDue,
  notifyVisitReminder,
} from "@calibra-facil/notifications";
import {
  type AccreditationExpiringRow,
  type AccreditedScopeLineExpiringRow,
  type CompetenceExpiredRow,
  type CompetenceExpiringRow,
  type PtPlanDueRow,
  type SigningCertificateExpiringRow,
  type VisitDueRow,
} from "./types.js";
import {
  checkAccreditationsExpiring,
  checkAccreditedScopeLinesExpiring,
  checkCompetencesExpired,
  checkCompetencesExpiring,
  checkSigningCertificatesExpiring,
  checkVisitsDueSoon,
} from "./queries-people-certificates.js";
import { BATCH_SIZE, recordScheduledNotification } from "./shared.js";
import { checkPtPlanDue } from "./queries-assets-standards.js";

export async function processCompetencesExpiring(
  client: Client,
): Promise<number> {
  let competencesExpiringProcessed = 0;

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

  return competencesExpiringProcessed;
}

export async function processCompetencesExpired(
  client: Client,
): Promise<number> {
  let competencesExpiredProcessed = 0;

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
          `INSERT INTO personnel_competence_audit_log (organization_id, competence_id, action, changes, performed_by)
             VALUES ($1, $2, 'expire', $3, 'system')`,
          [
            comp.organization_id,
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

  return competencesExpiredProcessed;
}

export async function processVisitReminders(client: Client): Promise<number> {
  let visitsProcessed = 0;

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
        console.error(`[Scheduled] Error processing visit ${visit.id}:`, error);
      }
    }

    // Successful rows leave the NOT-EXISTS window (recordScheduledNotification
    // sets sent_at), so the next page must start where the FAILED rows left
    // off — advancing by the full batch size skipped up to BATCH_SIZE
    // still-due rows per pass.
    visitOffset += batchFailures;
  } while (visitBatch.length === BATCH_SIZE);

  return visitsProcessed;
}

export async function processSigningCertificatesExpiring(
  client: Client,
): Promise<number> {
  let signingCertsProcessed = 0;

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

        await notifySigningCertificateExpiring(cert.id, cert.organization_id, {
          daysRemaining: decision.daysUntilExpiry,
        });

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

  return signingCertsProcessed;
}

export async function processAccreditationsExpiring(
  client: Client,
): Promise<number> {
  let accreditationsProcessed = 0;

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
          // The laboratory's day, not the UTC one (the validity is a date).
          now: labToday(accreditationNow),
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

  return accreditationsProcessed;
}

export async function processAccreditedScopeLinesExpiring(
  client: Client,
): Promise<number> {
  let scopeLinesProcessed = 0;

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

        await notifyAccreditedScopeLineExpiring(row.id, row.organization_id, {
          daysRemaining: decision.daysUntilExpiry,
        });

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

  return scopeLinesProcessed;
}

export async function processPtPlanDue(client: Client): Promise<number> {
  let ptPlanItemsProcessed = 0;

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

  return ptPlanItemsProcessed;
}
