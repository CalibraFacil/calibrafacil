import { type ScheduledEnv } from "./types.js";
import { withOrgSession, withSystemDbClient } from "../pdf-render.js";
import {
  processAssetsDueForLegalVerification,
  processAssetsDueForRecalibration,
  processOverdueJobs,
  processStandardsExpired,
  processStandardsExpiring,
} from "./steps-assets-standards.js";
import {
  processAccreditationsExpiring,
  processAccreditedScopeLinesExpiring,
  processCompetencesExpired,
  processCompetencesExpiring,
  processPtPlanDue,
  processSigningCertificatesExpiring,
  processVisitReminders,
} from "./steps-people-certificates.js";

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
  const totals = {
    assetsProcessed: 0,
    legalVerificationsProcessed: 0,
    standardsProcessed: 0,
    standardsExpiredProcessed: 0,
    jobsProcessed: 0,
    competencesExpiringProcessed: 0,
    competencesExpiredProcessed: 0,
    visitsProcessed: 0,
    signingCertsProcessed: 0,
    accreditationsProcessed: 0,
    scopeLinesProcessed: 0,
    ptPlanItemsProcessed: 0,
  };

  // The sweep is a cron job: no message names a laboratory. The laboratories are
  // listed here, in ONE statement on the system path (the owner connection),
  // because row-level security names one laboratory per transaction and this is
  // the one statement that has to look across all of them (`organization` is a
  // global table; deleted ones are not filtered, as before). Every step then
  // runs per laboratory on the application connection, each statement in a
  // short transaction that names it: a step e-mails between its statements, so
  // no transaction is ever held across a notification.
  const laboratories = await withSystemDbClient(env, async (client) => {
    const result = await client.query<{ id: string }>(
      "select id from organization where coalesce(type, 'LAB') = 'LAB' order by id",
    );
    return result.rows.map((row) => row.id);
  });

  // One laboratory failing must not stop the sweep of the laboratories after it;
  // the first failure is rethrown once every laboratory has had its turn.
  let firstFailure: { error: unknown } | null = null;
  for (const organizationId of laboratories) {
    try {
      await withOrgSession(env, organizationId, async (lab) => {
        totals.assetsProcessed += await processAssetsDueForRecalibration(lab);
        totals.legalVerificationsProcessed +=
          await processAssetsDueForLegalVerification(lab);
        totals.standardsProcessed += await processStandardsExpiring(lab);
        totals.standardsExpiredProcessed += await processStandardsExpired(lab);
        totals.jobsProcessed += await processOverdueJobs(lab);
        totals.competencesExpiringProcessed +=
          await processCompetencesExpiring(lab);
        totals.competencesExpiredProcessed +=
          await processCompetencesExpired(lab);
        totals.visitsProcessed += await processVisitReminders(lab);
        totals.signingCertsProcessed +=
          await processSigningCertificatesExpiring(lab);
        totals.accreditationsProcessed +=
          await processAccreditationsExpiring(lab);
        totals.scopeLinesProcessed +=
          await processAccreditedScopeLinesExpiring(lab);
        totals.ptPlanItemsProcessed += await processPtPlanDue(lab);
      });
    } catch (error) {
      console.error(
        `[Scheduled] Error sweeping laboratory ${organizationId}:`,
        error,
      );
      firstFailure ??= { error };
    }
  }
  if (firstFailure) throw firstFailure.error;

  return totals;
}
