import { type ScheduledEnv } from "./types.js";
import { withDbClient } from "./shared.js";
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
    assetsProcessed = await processAssetsDueForRecalibration(client);
    legalVerificationsProcessed =
      await processAssetsDueForLegalVerification(client);
    standardsProcessed = await processStandardsExpiring(client);
    standardsExpiredProcessed = await processStandardsExpired(client);
    jobsProcessed = await processOverdueJobs(client);
    competencesExpiringProcessed = await processCompetencesExpiring(client);
    competencesExpiredProcessed = await processCompetencesExpired(client);
    visitsProcessed = await processVisitReminders(client);
    signingCertsProcessed = await processSigningCertificatesExpiring(client);
    accreditationsProcessed = await processAccreditationsExpiring(client);
    scopeLinesProcessed = await processAccreditedScopeLinesExpiring(client);
    ptPlanItemsProcessed = await processPtPlanDue(client);
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
