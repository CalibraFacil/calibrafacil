import { canPerformCalibrationAction } from "@calibra-facil/auth/access";
import { db } from "@calibra-facil/db";
import {
  appendJobEvent,
  type JobApprovedChanges,
} from "@calibra-facil/db/job-events";
import { calibrationJob, member } from "@calibra-facil/db/schema";
import type { ApproveJobSchema } from "@calibra-facil/schemas";
import {
  allowedFrom,
  canTransition,
  requireTargetOf,
} from "@calibra-facil/schemas/job-transitions";
import { and, eq, inArray, ne } from "drizzle-orm";
import type { z } from "zod";
import {
  getCalibrationAuthorizationRole,
  type AuthVariables,
} from "../../middleware/permission";
import { enqueueBackgroundJob } from "../../lib/background-jobs";
import {
  dispatchStagedBackgroundJob,
  stageBackgroundJob,
} from "../../lib/background-job-outbox";
import { buildAsFoundReliabilityVerdict } from "../../lib/as-found-reliability-verdict";
import {
  classifyJobScopeCompliance,
  isAdverseScopeCompliance,
} from "../../lib/scope-compliance";
import type { ScopeComplianceResult } from "@calibra-facil/shared";
import { createAssetOotEventForApprovedJob } from "../../lib/asset-oot-events";
import { advanceAssetCalibrationDatesOnApproval } from "../../lib/asset-calibration-advance";
import { checkApproverIsAuthorizedSignatory } from "../../lib/signatory";
import {
  CertificateImagesChangedError,
  discardUnreleasedCertificateInput,
  freezeCertificateInput,
  lockJobForApproval,
  prefetchCertificateImages,
} from "@calibra-facil/db/certificate-input";
import { readCertificateImage } from "../../lib/certificate-input-images";
import {
  findServiceOrdersForCalibrationJob,
  triggerAutomaticSendForMilestone,
} from "../../lib/automatic-send";
import { buildUnitScopeCondition } from "../../lib/units";
import { notifyJobApproved } from "@calibra-facil/notifications";

type JobRow = typeof calibrationJob.$inferSelect;
type ApproveJobInput = z.infer<typeof ApproveJobSchema>;

/**
 * WHO is approving. Every entry point that can release a calibration builds
 * one of these explicitly, so the policy never infers an approver from a
 * transport (session cookie, API key). The policy always runs
 * against a PERSON (`member`): the role gate, separation of duties and the
 * signatory roster are properties of people, never of a credential.
 *
 * - `user`: an authenticated lab member. Cloud routes pass the session's
 *   member — never an actor id claimed in a request payload.
 * - `api_key`: an organization API key acting for its creator, who is the
 *   accountable approver (`member` = the creator's CURRENT membership, null if
 *   they left the organization, which refuses the approval). The key identity
 *   is recorded in the job audit row so the trail reads "creator X approved
 *   through key Y", not "in a session". Revoked keys never reach this point
 *   (API-key auth rejects them).
 */
export type ApprovalActor =
  | { kind: "user"; member: AuthVariables["member"] }
  | {
      kind: "api_key";
      apiKey: { id: string; name: string; keyPrefix: string };
      member: AuthVariables["member"] | null;
    };

/**
 * What a successful approval does to the job. There is exactly one completion:
 * approval and certificates are online-only, so the worker renders (and
 * signs) the certificate. No caller can hand `approveJob` PDF bytes or a
 * `certificateUrl`.
 */
export type ApprovalCompletion = {
  /** REVIEW → GENERATING_PDF, the worker renders the certificate. */
  kind: "generate_certificate_pdf";
  /**
   * Env-bound financial dispatch, injected by the route: the command owns
   * the "which service orders, which milestone" flow while the transport
   * to the finance engine stays with the caller.
   */
  sendServiceOrdersToFinance: (params: {
    organizationId: string;
    serviceOrderIds: number[];
    actorUserId: string;
  }) => Promise<ReadonlyArray<FinanceSendResult>>;
};

export type FinanceSendResult = {
  ok: boolean;
  billingDocumentId?: number | null;
  error?: string | null;
};

export type ApproveJobResult =
  | { status: "not_found" }
  | { status: "invalid_status"; currentStatus: JobRow["status"] }
  /** An API key whose creator is no longer a member: nobody is accountable. */
  | { status: "approval_requires_signatory" }
  /** The actor's role may not approve (`calibrationWorkflowPermissions`). */
  | { status: "role_not_permitted" }
  | { status: "self_approval_blocked" }
  | { status: "not_authorized_signatory" }
  | {
      /**
       * The certificate job could not be dispatched after the approval
       * committed; the approval was reverted to REVIEW (with an audit row) so
       * the job is not stranded in GENERATING_PDF. Retry the approval.
       */
      status: "dispatch_failed";
    }
  | {
      /**
       * Compare-and-set lost: the job left the status this approval was
       * evaluated against between the read and the write (a concurrent
       * approval/rejection). Nothing was written.
       */
      status: "concurrent_approval";
    }
  | {
      status: "environmental_justification_required";
      environmentalSnapshot: JobRow["environmentalSnapshot"];
    }
  | {
      /**
       * #427 Phase 1: adverse CMC classification under enforce mode and no
       * documented override — accredited issuance is blocked.
       */
      status: "scope_violation";
      scopeCompliance: ScopeComplianceResult;
    }
  | {
      status: "approved";
      job: JobRow;
      /** Accredited-scope (CMC) classification frozen at approval (#427). */
      scopeCompliance: JobRow["scopeComplianceStatus"];
    };

export type ApproveJobCommand = {
  jobId: number;
  actor: ApprovalActor;
  values: ApproveJobInput;
  metadata: { ipAddress?: string | null };
  completion: ApprovalCompletion;
};

type ReleaseEvaluation =
  | { status: "scope_violation"; scopeCompliance: ScopeComplianceResult }
  | {
      status: "ok";
      asFound: ReturnType<typeof buildAsFoundReliabilityVerdict>;
      scopeCompliance: {
        status: JobRow["scopeComplianceStatus"];
        findings: JobRow["scopeComplianceFindings"];
      };
      appliedScopeOverride: string | null;
      /** Snapshot with the approver's justification, when one applies. */
      environmentalSnapshot: JobRow["environmentalSnapshot"] | undefined;
    };

async function evaluateRelease(params: {
  existing: JobRow;
  organizationId: string;
  values: ApproveJobInput;
  approvedAt: Date;
}): Promise<ReleaseEvaluation> {
  const { existing, values } = params;

  // The environmental justification is persisted by the same compare-and-set
  // write as the transition, so a refused/raced approval never leaves a
  // justification behind on a job that was not released.
  const environmentalSnapshot =
    values.environmentalJustification &&
    existing.environmentalSnapshot &&
    !existing.environmentalSnapshot.withinLimits
      ? {
          ...existing.environmentalSnapshot,
          outOfLimitsJustification: values.environmentalJustification,
        }
      : undefined;

  // Derive the AS-FOUND (pre-adjustment) reliability verdict from the frozen
  // results, for ILAC-G24 / NCSL RP-1 interval analysis. Read-only over
  // `results`; it does NOT influence approval, conformity, or the certificate.
  const asFound = buildAsFoundReliabilityVerdict({ results: existing.results });

  // Accredited-scope (CMC) guard — ISO/IEC 17025 §7.6/§7.8.3, ILAC P14
  // (#427). Re-classified here at the emission date so the frozen record is
  // authoritative even if scope lines changed since submit. In 'warn' mode
  // the classification never blocks; in 'enforce' mode an adverse result
  // blocks accredited issuance unless a documented override downgrades the
  // certificate to non-accredited (seal suppressed at every render site).
  const { compliance, enforcementMode } = await classifyJobScopeCompliance({
    organizationId: params.organizationId,
    unitId: existing.unitId,
    methodSnapshot: existing.methodSnapshot,
    assetSnapshot: existing.assetSnapshot,
    data: existing.data,
    results: existing.results,
    atDate: params.approvedAt,
  });

  const scopeOverrideJustification =
    values.scopeOverrideJustification?.trim() || null;
  const scopeBlocked =
    enforcementMode === "enforce" && isAdverseScopeCompliance(compliance);
  if (scopeBlocked && compliance && !scopeOverrideJustification) {
    return { status: "scope_violation", scopeCompliance: compliance };
  }

  return {
    status: "ok",
    asFound,
    scopeCompliance: {
      status: compliance?.status ?? null,
      findings: compliance?.findings ?? null,
    },
    // The override is only meaningful when it is actually unblocking an
    // enforced violation — never let a stray justification downgrade a
    // passing (or warn-mode) certificate.
    appliedScopeOverride: scopeBlocked ? scopeOverrideJustification : null,
    environmentalSnapshot,
  };
}

/**
 * Approve a calibration job — the ONE implementation behind every entry point
 * (cloud route, public API). It owns the ISO/IEC 17025 release
 * gates, the compare-and-set status transition, the audit trail and the
 * post-approval side effects, callable without the HTTP pipeline. Route
 * adapters only build the actor and map each result status to a response.
 *
 * Concurrency: the job row is written with
 * `WHERE id AND organization_id AND status = <status evaluated>` inside a
 * transaction together with its audit row, so a concurrent or repeated
 * approval matches zero rows and yields `concurrent_approval` instead of
 * double-releasing. Fire-and-forget side effects run after the commit.
 */
export async function approveJob(
  input: ApproveJobCommand,
): Promise<ApproveJobResult> {
  const { jobId, actor, values, completion } = input;

  // The accountable person. A key whose creator left the organization has
  // nobody to hold the approval, so it is refused before anything is read.
  const memberData = actor.member;
  if (!memberData) {
    return { status: "approval_requires_signatory" };
  }
  const approverId = memberData.userId;

  // Role gate: the workflow matrix (`calibrationWorkflowPermissions`) — REVIEW
  // is the `in_review` workflow state. Same effective-role mapping as the
  // `requireCalibrationAction` guard, so a caller that bypassed (or never had)
  // the route guard — a future entry point — is still held to it.
  if (
    !canPerformCalibrationAction(
      getCalibrationAuthorizationRole(memberData),
      "in_review",
      "approve",
    )
  ) {
    return { status: "role_not_permitted" };
  }

  const [existing] = await db
    .select()
    .from(calibrationJob)
    .where(
      and(
        eq(calibrationJob.id, jobId),
        eq(calibrationJob.organizationId, memberData.organizationId),
        buildUnitScopeCondition(calibrationJob.unitId, memberData),
      ),
    )
    .limit(1);

  if (!existing) {
    return { status: "not_found" };
  }

  // Can only approve from REVIEW status
  if (!canTransition(existing.status, "approve")) {
    return { status: "invalid_status", currentStatus: existing.status };
  }

  // Separation of duties (ISO/IEC 17025 §6.2.4 / §7.1): the technician who
  // executed — or the user who created — the calibration must not approve
  // their own work. Auto-detected like the personnel-competence gate: it is
  // enforced only when the organization actually has an *eligible alternate
  // approver*, so a genuine solo lab — or one whose only other members are
  // technicians/operators who cannot approve — is exempt rather than left
  // with a REVIEW job nobody can release. An eligible approver is another
  // member whose role grants `calibration.approve`, which access.ts grants
  // to admin/owner only; both are global multi-unit roles, so any such
  // member can access the job's unit by construction (no unit-scope join
  // needed here).
  if (
    existing.technicianId === approverId ||
    existing.createdBy === approverId
  ) {
    const [alternateApprover] = await db
      .select({ id: member.id })
      .from(member)
      .where(
        and(
          eq(member.organizationId, memberData.organizationId),
          inArray(member.role, ["admin", "owner"]),
          ne(member.userId, approverId),
        ),
      )
      .limit(1);

    if (alternateApprover) {
      return { status: "self_approval_blocked" };
    }
  }

  // Authorized-signatory scope (ISO/IEC 17025 §6.2.6): when the organization
  // maintains a signatory roster, the approver must be authorized to sign for
  // this instrument's asset type (or be an org-wide signatory). Auto-detected
  // — skipped when the org has no signatory records. Distinct from execution
  // competence (which gates the technician at assignment) and from the
  // self-approval gate above — four-eyes by identity vs. signatory scope.
  const signatoryGate = await checkApproverIsAuthorizedSignatory({
    organizationId: memberData.organizationId,
    approverId,
    assetId: existing.assetId,
  });
  if (!signatoryGate.ok) {
    return { status: "not_authorized_signatory" };
  }

  // Check environmental conditions - block approval if out of limits without justification
  if (
    existing.environmentalSnapshot &&
    !existing.environmentalSnapshot.withinLimits &&
    !existing.environmentalSnapshot.outOfLimitsJustification &&
    !values.environmentalJustification
  ) {
    return {
      status: "environmental_justification_required",
      environmentalSnapshot: existing.environmentalSnapshot,
    };
  }

  // The release evaluation (as-found verdict, accredited-scope classification
  // and its documented override) is frozen at the moment of release.
  const approvedAt = new Date();
  const evaluation = await evaluateRelease({
    existing,
    organizationId: memberData.organizationId,
    values,
    approvedAt,
  });
  if (evaluation.status === "scope_violation") {
    return evaluation;
  }

  const scopeChanges =
    existing.scopeComplianceStatus !== evaluation.scopeCompliance.status
      ? {
          scopeComplianceStatus: {
            old: existing.scopeComplianceStatus,
            new: evaluation.scopeCompliance.status,
          },
        }
      : {};
  const appliedScopeOverride = evaluation.appliedScopeOverride;

  // Status transition + audit row in ONE transaction, compare-and-set on the
  // status that was evaluated: a concurrent or repeated approval matches zero
  // rows and writes nothing (no double release, no orphan audit row), and an
  // audit failure rolls the approval back instead of releasing unaudited.
  // Approval through an API key: record the credential next to the person it
  // acted for (`performedBy`), so the trail shows creator X approved via key Y.
  const approvedVia: Pick<JobApprovedChanges, "approvedVia"> =
    actor.kind === "api_key"
      ? {
          approvedVia: {
            channel: "api_key",
            apiKeyId: actor.apiKey.id,
            apiKeyName: actor.apiKey.name,
            apiKeyPrefix: actor.apiKey.keyPrefix,
          },
        }
      : {};

  const approvedStatus = requireTargetOf(existing.status, "approve");

  // The logo and the signature the certificate embeds are read from object
  // storage BEFORE the transaction: network I/O does not run while the job row
  // is locked. A storage failure throws here, before anything is written, and
  // the approval is retried. The transaction checks the keys it reads are the
  // ones that were fetched.
  const images = await prefetchCertificateImages(
    db,
    { organizationId: memberData.organizationId, approverId },
    readCertificateImage,
  );

  const outcome = await db
    .transaction(async (tx) => {
      // Serialise on the job and clear what an earlier, unfinished approval of it
      // left behind (its frozen certificate input) while it is still in REVIEW.
      const locked = await lockJobForApproval(tx, {
        jobId,
        organizationId: memberData.organizationId,
        status: existing.status,
      });
      if (!locked) {
        return null;
      }

      const [updated] = await tx
        .update(calibrationJob)
        .set({
          // We set approved_by now so the PDF worker can fetch it.
          status: approvedStatus,
          approvedBy: approverId,
          approvedAt,
          ...(evaluation.environmentalSnapshot
            ? { environmentalSnapshot: evaluation.environmentalSnapshot }
            : {}),
          asFoundConformity: evaluation.asFound.conformity,
          asFoundMargins: evaluation.asFound.margins,
          scopeComplianceStatus: evaluation.scopeCompliance.status,
          scopeComplianceFindings: evaluation.scopeCompliance.findings,
          scopeOverrideJustification: evaluation.appliedScopeOverride,
          // A resubmitted (previously rejected) job is released clean:
          // the stale rejection must not read as the current state.
          rejectedBy: null,
          rejectedAt: null,
          rejectionReason: null,
        })
        .where(
          and(
            eq(calibrationJob.id, jobId),
            eq(calibrationJob.organizationId, memberData.organizationId),
            eq(calibrationJob.status, existing.status),
          ),
        )
        .returning();

      if (!updated) {
        return null;
      }

      // ISO/IEC 17025 §7.8: the certificate reflects the approved record. What the
      // renderer reads (lab, signatory, seal decision, customer, asset, results,
      // standards, method, layout) is frozen HERE, in the approval's own
      // transaction: it commits or rolls back with the status change and its audit
      // row, and the worker never reads that data live again.
      const frozen = await freezeCertificateInput(tx, updated, images);

      await appendJobEvent(tx, {
        action: "approve",
        organizationId: memberData.organizationId,
        jobId,
        actor: { kind: "user", userId: approverId },
        changes: {
          status: { old: existing.status, new: approvedStatus },
          ...approvedVia,
          certificateInputSha256: frozen.sha256,
          // Recorded on ANY transition — including adverse → null when the
          // guard stopped applying (scope lines deleted, vigência lapsed).
          // Erasing a previously frozen verdict without an audit entry
          // would leave a §8.4 gap and make bypass-by-deleting-scope-lines
          // invisible.
          ...scopeChanges,
          ...(appliedScopeOverride
            ? {
                scopeOverrideJustification: {
                  old: existing.scopeOverrideJustification,
                  new: appliedScopeOverride,
                },
              }
            : {}),
        },
        ipAddress: input.metadata.ipAddress ?? null,
        // Keep the approver's own notes alongside the override record —
        // the downgrade must not erase the supplied approval reason from
        // the trail.
        reason: appliedScopeOverride
          ? [
              `Aprovado SEM selo de acreditação (violação de escopo/CMC documentada): ${appliedScopeOverride}`,
              values.reason?.trim() || null,
            ]
              .filter(Boolean)
              .join(" | ")
          : values.reason || "Aprovado - Gerando PDF",
      });

      // Outbox: when certificate jobs are dispatched through `app_queue_job`
      // (same Postgres) the queue row commits atomically with the approval, so a
      // dispatch failure can never strand the job in GENERATING_PDF — the
      // stale-lease backstop owns every row that exists.
      const staged = await stageBackgroundJob(tx, {
        jobId,
        userId: approverId,
      });

      return { updated, staged };
    })
    .catch((error: unknown) => {
      // The lab changed its logo (or the approver their signature) between the
      // read and the lock: nothing was written, the approval is retried.
      if (error instanceof CertificateImagesChangedError) return null;
      throw error;
    });

  if (!outcome) {
    return { status: "concurrent_approval" };
  }
  const { updated, staged } = outcome;

  if (staged) {
    await dispatchStagedBackgroundJob();
  } else {
    try {
      await enqueueBackgroundJob({ jobId, userId: approverId });
    } catch (error) {
      // Not durable in our database (Vercel Queue / in-process): nothing
      // would ever pick the job up. Compensate instead of leaving it in
      // GENERATING_PDF forever.
      await revertApprovalAfterDispatchFailure({
        existing,
        approverId,
        error,
        ipAddress: input.metadata.ipAddress ?? null,
      });
      return { status: "dispatch_failed" };
    }
  }

  // Advance the asset's calibration dates from the approved work
  // (last_calibration_date + the derived next dates) — forward-only and
  // never fails the approval. Without this the due sweeps re-remind for
  // an instrument that was just calibrated.
  await advanceAssetCalibrationDatesOnApproval({
    assetId: existing.assetId,
    calibrationDate: existing.performedAt ?? updated.approvedAt ?? null,
    performedBy: approverId,
    source: "job_approval",
  });

  runCloudApprovalSideEffects({
    existing,
    updated,
    approverId,
    organizationId: memberData.organizationId,
    conformity: evaluation.asFound.conformity,
    sendServiceOrdersToFinance: completion.sendServiceOrdersToFinance,
  });

  return {
    status: "approved",
    job: updated,
    scopeCompliance: evaluation.scopeCompliance.status,
  };
}

/**
 * Compensation for a dispatch that failed after the approval committed:
 * compare-and-set the job back to the status it was approved from (only if it
 * is still the approval this call made), restore what the approval wrote, and
 * leave an audit row saying why. Never throws — a failed revert is logged
 * loudly, the caller still reports the dispatch failure.
 */
async function revertApprovalAfterDispatchFailure(params: {
  existing: JobRow;
  approverId: string;
  error: unknown;
  ipAddress: string | null;
}) {
  const { existing, approverId } = params;
  const message =
    params.error instanceof Error ? params.error.message : "unknown error";
  try {
    const approvedStatus = requireTargetOf(existing.status, "approve");
    const revertedStatus = requireTargetOf(approvedStatus, "revert_approval");
    await db.transaction(async (tx) => {
      const [reverted] = await tx
        .update(calibrationJob)
        .set({
          status: revertedStatus,
          approvedBy: existing.approvedBy,
          approvedAt: existing.approvedAt,
          environmentalSnapshot: existing.environmentalSnapshot,
          asFoundConformity: existing.asFoundConformity,
          asFoundMargins: existing.asFoundMargins,
          scopeComplianceStatus: existing.scopeComplianceStatus,
          scopeComplianceFindings: existing.scopeComplianceFindings,
          scopeOverrideJustification: existing.scopeOverrideJustification,
          rejectedBy: existing.rejectedBy,
          rejectedAt: existing.rejectedAt,
          rejectionReason: existing.rejectionReason,
        })
        .where(
          and(
            eq(calibrationJob.id, existing.id),
            eq(calibrationJob.organizationId, existing.organizationId),
            inArray(calibrationJob.status, allowedFrom("revert_approval")),
            eq(calibrationJob.approvedBy, approverId),
          ),
        )
        .returning();

      if (!reverted) return;

      // The approval did not complete: what it froze documents nothing released.
      await discardUnreleasedCertificateInput(tx, {
        jobId: existing.id,
        organizationId: existing.organizationId,
      });

      await appendJobEvent(tx, {
        action: "approve_reverted",
        organizationId: existing.organizationId,
        jobId: existing.id,
        actor: { kind: "user", userId: approverId },
        changes: {
          status: { old: approvedStatus, new: revertedStatus },
        },
        ipAddress: params.ipAddress,
        reason: `Aprovação revertida: falha ao enfileirar a geração do certificado (${message})`,
      });
    });
  } catch (revertError) {
    console.error(
      "[Jobs] Approval dispatch failed AND the revert failed; job may be stuck in GENERATING_PDF",
      { jobId: existing.id, dispatchError: message, revertError },
    );
  }
}

/**
 * Post-commit, fire-and-forget effects of a cloud approval. Never blocks or
 * fails the approval response.
 */
function runCloudApprovalSideEffects(params: {
  existing: JobRow;
  updated: JobRow;
  approverId: string;
  organizationId: string;
  conformity: JobRow["asFoundConformity"];
  sendServiceOrdersToFinance: ApprovalCompletion["sendServiceOrdersToFinance"];
}) {
  const { existing, updated, approverId, organizationId } = params;
  const jobId = existing.id;

  // Send notification to technician (fire and forget)
  notifyJobApproved(jobId, approverId).catch((err) => {
    console.error("[Jobs] Failed to send approval notification:", err);
  });

  // #740 Track B: as-found non-conforming → customer-facing OOT event +
  // "avaliar impacto" alert (ISO 9001 §7.1.5.2). Idempotent per job;
  // fire-and-forget — never blocks the approval.
  if (params.conformity === "NON_CONFORMING") {
    createAssetOotEventForApprovedJob({
      jobId,
      assetId: existing.assetId,
      customerId: existing.customerId,
      labOrganizationId: organizationId,
      detectedAt: updated.approvedAt ?? new Date(),
      actorUserId: approverId,
    }).catch((err) => {
      console.error("[Jobs] Failed to create asset OOT event:", err);
    });
  }

  // Phase 2 slice 4 wire-up: fire automatic-send for every SO linked
  // to this job. Fire-and-forget — never block the approval response
  // on the financial-send pathway. Engine writes an audit row per
  // call regardless of outcome.
  void (async () => {
    try {
      const linkedSoIds = await findServiceOrdersForCalibrationJob(
        jobId,
        organizationId,
      );
      for (const serviceOrderId of linkedSoIds) {
        await triggerAutomaticSendForMilestone({
          event: {
            event: "certificate_approved",
            serviceOrderId,
            organizationId,
          },
          actorUserId: approverId,
          invoker: async (invokerParams) => {
            try {
              const results = await params.sendServiceOrdersToFinance({
                organizationId: invokerParams.organizationId,
                serviceOrderIds: [invokerParams.serviceOrderId],
                actorUserId: invokerParams.actorUserId,
              });
              const first = results[0];
              if (!first) {
                return { ok: false, reason: "no_result" };
              }
              return {
                ok: first.ok,
                summary: {
                  ok: first.ok,
                  billingDocumentId: first.billingDocumentId ?? null,
                },
                reason: first.ok ? undefined : (first.error ?? "send_failed"),
              };
            } catch (error) {
              return {
                ok: false,
                reason: error instanceof Error ? error.message : "send_threw",
              };
            }
          },
        });
      }
    } catch (error) {
      console.error("[Jobs] Automatic-send wire-up failed:", error);
    }
  })();
}
