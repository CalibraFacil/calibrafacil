import { Client } from "pg";
import {
  notifyAssetDueForLegalVerification,
  notifyAssetDueForRecalibration,
  notifyJobOverdue,
  notifyStandardExpired,
  notifyStandardExpiring,
} from "@calibra-facil/notifications";
import {
  type AssetDueRow,
  type AssetLegalVerificationDueRow,
  type OverdueJobRow,
  type StandardExpiredRow,
  type StandardExpiringRow,
} from "./types.js";
import {
  checkAssetsDueForLegalVerification,
  checkAssetsDueForRecalibration,
  checkOverdueJobs,
  checkStandardsExpired,
  checkStandardsExpiring,
} from "./queries-assets-standards.js";
import { BATCH_SIZE, recordScheduledNotification } from "./shared.js";

export async function processAssetsDueForRecalibration(
  client: Client,
): Promise<number> {
  let assetsProcessed = 0;

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
        console.error(`[Scheduled] Error processing asset ${asset.id}:`, error);
      }
    }

    // Successful rows leave the NOT-EXISTS window (recordScheduledNotification
    // sets sent_at), so the next page must start where the FAILED rows left
    // off — advancing by the full batch size skipped up to BATCH_SIZE
    // still-due rows per pass.
    assetOffset += batchFailures;
  } while (assetBatch.length === BATCH_SIZE);

  return assetsProcessed;
}

export async function processAssetsDueForLegalVerification(
  client: Client,
): Promise<number> {
  let legalVerificationsProcessed = 0;

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

  return legalVerificationsProcessed;
}

export async function processStandardsExpiring(
  client: Client,
): Promise<number> {
  let standardsProcessed = 0;

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

  return standardsProcessed;
}

export async function processStandardsExpired(client: Client): Promise<number> {
  let standardsExpiredProcessed = 0;

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

  return standardsExpiredProcessed;
}

export async function processOverdueJobs(client: Client): Promise<number> {
  let jobsProcessed = 0;

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

  return jobsProcessed;
}
