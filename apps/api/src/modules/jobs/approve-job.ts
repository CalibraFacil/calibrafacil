import { canPerformCalibrationAction } from "@calibra-facil/auth/access";
import type { OrgDb } from "@calibra-facil/db/for-org";
import {
  appendJobEvent,
  type JobApprovedChanges,
} from "@calibra-facil/db/job-events";
import { calibrationJob, member } from "@calibra-facil/db/schema";
import type { ApproveJobSchema, QueueMessage } from "@calibra-facil/schemas";
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
import {
  recordAssetOotEvent,
  withdrawAssetOotEvent,
} from "../../lib/asset-oot-events";
import {
  advanceAssetCalibrationDates,
  revertAssetCalibrationAdvance,
  type AssetCalibrationAdvanceApplied,
} from "../../lib/asset-calibration-advance";
import { checkApproverIsAuthorizedSignatory } from "../../lib/signatory";
import {
  CertificateImagesChangedError,
  type CertificateImageKeys,
  discardUnreleasedCertificateInput,
  findCertificateImageKeys,
  freezeCertificateInput,
  lockJobForApproval,
  readCertificateImages,
} from "@calibra-facil/db/certificate-input";
import { readCertificateImage } from "../../lib/certificate-input-images";
import {
  findServiceOrdersForCalibrationJob,
  triggerAutomaticSendForMilestone,
} from "../../lib/automatic-send";
import { orgDb } from "../../lib/org-db";
import { orgTransactionWithExecutor } from "../../lib/org-transaction";
import { buildUnitScopeCondition } from "../../lib/units";

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

/** What the read phase of an approval hands to its write phase, or why it stopped. */
type PreparedApproval =
  | { kind: "refused"; result: ApproveJobResult }
  | {
      kind: "ready";
      existing: JobRow;
      approvedAt: Date;
      evaluation: Extract<ReleaseEvaluation, { status: "ok" }>;
      imageKeys: CertificateImageKeys;
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

async function evaluateRelease(
  params: {
    existing: JobRow;
    organizationId: string;
    values: ApproveJobInput;
    approvedAt: Date;
  },
  o: OrgDb,
): Promise<ReleaseEvaluation> {
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
  // results, for ILAC-G24 / NCSL RP-1 interval analysis and the out-of-tolerance
  // event. Read-only over `results`; it does not block the approval.
  // The method's declared decision rule (roadmap 2 C4) decides which as-found
  // points do not conform, and so whether the out-of-tolerance alert goes out.
  const asFound = buildAsFoundReliabilityVerdict({
    results: existing.results,
    decisionRule: existing.methodSnapshot?.certificateContent?.decisionRuleKind,
  });

  // Accredited-scope (CMC) guard — ISO/IEC 17025 §7.6/§7.8.3, ILAC P14
  // (#427). Re-classified here at the emission date so the frozen record is
  // authoritative even if scope lines changed since submit. In 'warn' mode
  // the classification never blocks; in 'enforce' mode an adverse result
  // blocks accredited issuance unless a documented override downgrades the
  // certificate to non-accredited (seal suppressed at every render site).
  const { compliance, enforcementMode } = await classifyJobScopeCompliance(
    {
      organizationId: params.organizationId,
      unitId: existing.unitId,
      methodSnapshot: existing.methodSnapshot,
      assetSnapshot: existing.assetSnapshot,
      data: existing.data,
      results: existing.results,
      atDate: params.approvedAt,
    },
    o,
  );

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
 * double-releasing.
 *
 * What the approval implies is split by its nature (roadmap 2 B2, ISO/IEC
 * 17025 7.10):
 * - the pure database effects (the asset out-of-tolerance event and the asset
 *   calibration-date advance, each with its audit row) are written in the SAME
 *   transaction as the approval: an approval cannot commit without them and
 *   they cannot exist without it;
 * - the effects that leave the database (the technician notification, the
 *   customer out-of-tolerance alert) are staged as queue jobs in that same
 *   transaction (outbox) and delivered after the commit with the queue's
 *   retries; a rolled-back approval stages nothing;
 * - the financial automatic-send needs this process (ERP integration, the
 *   member's unit scope) and stays a post-commit step.
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

  // The read phase: every gate and the release evaluation read in ONE short
  // transaction that names the laboratory (row-level security). It ends before
  // the certificate images are read from object storage and before the write
  // transaction opens, so nothing is held across I/O. The compare-and-set of
  // the write below is what protects the status between the two.
  const prepared = await orgDb(memberData.organizationId).transaction(
    async (o): Promise<PreparedApproval> => {
      const [existing] = await o
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
        return { kind: "refused", result: { status: "not_found" } };
      }

      // Can only approve from REVIEW status
      if (!canTransition(existing.status, "approve")) {
        return {
          kind: "refused",
          result: { status: "invalid_status", currentStatus: existing.status },
        };
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
        const [alternateApprover] = await o
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
          return {
            kind: "refused",
            result: { status: "self_approval_blocked" },
          };
        }
      }

      // Authorized-signatory scope (ISO/IEC 17025 §6.2.6): when the organization
      // maintains a signatory roster, the approver must be authorized to sign for
      // this instrument's asset type (or be an org-wide signatory). Auto-detected
      // — skipped when the org has no signatory records. Distinct from execution
      // competence (which gates the technician at assignment) and from the
      // self-approval gate above — four-eyes by identity vs. signatory scope.
      const signatoryGate = await checkApproverIsAuthorizedSignatory(
        {
          organizationId: memberData.organizationId,
          approverId,
          assetId: existing.assetId,
        },
        o,
      );
      if (!signatoryGate.ok) {
        return {
          kind: "refused",
          result: { status: "not_authorized_signatory" },
        };
      }

      // Check environmental conditions - block approval if out of limits without justification
      if (
        existing.environmentalSnapshot &&
        !existing.environmentalSnapshot.withinLimits &&
        !existing.environmentalSnapshot.outOfLimitsJustification &&
        !values.environmentalJustification
      ) {
        return {
          kind: "refused",
          result: {
            status: "environmental_justification_required",
            environmentalSnapshot: existing.environmentalSnapshot,
          },
        };
      }

      // The release evaluation (as-found verdict, accredited-scope classification
      // and its documented override) is frozen at the moment of release.
      const approvedAt = new Date();
      const evaluation = await evaluateRelease(
        {
          existing,
          organizationId: memberData.organizationId,
          values,
          approvedAt,
        },
        o,
      );
      if (evaluation.status === "scope_violation") {
        return { kind: "refused", result: evaluation };
      }

      // The keys of the logo and the signature the certificate embeds; the
      // objects themselves are read after this transaction ends.
      const imageKeys = await findCertificateImageKeys(o, {
        organizationId: memberData.organizationId,
        approverId,
      });

      return { kind: "ready", existing, approvedAt, evaluation, imageKeys };
    },
  );
  if (prepared.kind === "refused") return prepared.result;
  const { existing, approvedAt, evaluation, imageKeys } = prepared;

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
  const images = await readCertificateImages(imageKeys, readCertificateImage);

  // The write transaction names the laboratory (row-level security) and hands
  // the raw executor to the frozen certificate input and the queue outbox,
  // which run raw SQL. Every statement in it carries the organization predicate.
  const outcome = await orgTransactionWithExecutor(
    memberData.organizationId,
    async (o, tx) => {
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

      // The pure database effects of the approval, in this transaction (same
      // executor, after the job row is locked and written): the customer-facing
      // out-of-tolerance event of a NON_CONFORMING as-found verdict (idempotent
      // per job: a re-approval writes nothing and re-notifies nobody) and the
      // forward-only advance of the asset's calibration dates, each with its
      // audit row. A failure throws and rolls the whole approval back (the
      // status, the frozen input, the job audit row and the queue rows too).
      const ootEvent =
        evaluation.asFound.conformity === "NON_CONFORMING"
          ? await recordAssetOotEvent(o, {
              jobId,
              assetId: existing.assetId,
              customerId: existing.customerId,
              labOrganizationId: memberData.organizationId,
              detectedAt: updated.approvedAt ?? approvedAt,
              actorUserId: approverId,
              decisionRule: evaluation.asFound.decisionRule,
            })
          : null;
      const dateAdvance = await advanceAssetCalibrationDates(o, {
        assetId: existing.assetId,
        calibrationDate: existing.performedAt ?? updated.approvedAt ?? null,
        performedBy: approverId,
        source: "job_approval",
      });

      // Outbox: when jobs are dispatched through `app_queue_job` (same Postgres)
      // the queue rows commit atomically with the approval, so a dispatch failure
      // can never strand the job in GENERATING_PDF (the stale-lease backstop owns
      // every row that exists) and a notification exists only for an approval
      // that committed.
      const staged = await stageBackgroundJob(tx, {
        jobId,
        userId: approverId,
      });
      const approvedNotification: QueueMessage = {
        type: "JOB_APPROVED_NOTIFICATION",
        jobId,
        userId: approverId,
      };
      const effects: StagedEffect[] = [
        {
          message: approvedNotification,
          staged: await stageBackgroundJob(tx, approvedNotification),
        },
      ];
      if (ootEvent) {
        const ootNotification: QueueMessage = {
          type: "ASSET_OOT_NOTIFICATION",
          eventId: ootEvent.eventId,
          organizationId: memberData.organizationId,
          userId: approverId,
        };
        effects.push({
          message: ootNotification,
          staged: await stageBackgroundJob(tx, ootNotification),
        });
      }

      return {
        updated,
        staged,
        effects,
        ootEventId: ootEvent?.eventId ?? null,
        dateAdvance,
      };
    },
  ).catch((error: unknown) => {
    // The lab changed its logo (or the approver their signature) between the
    // read and the lock: nothing was written, the approval is retried.
    if (error instanceof CertificateImagesChangedError) return null;
    throw error;
  });

  if (!outcome) {
    return { status: "concurrent_approval" };
  }
  const { updated, staged, effects, ootEventId, dateAdvance } = outcome;

  if (staged) {
    // The certificate job and the notification jobs are rows of the queue,
    // committed with the approval; one wake-up drains them all.
    await dispatchStagedBackgroundJob();
  } else {
    try {
      await enqueueBackgroundJob({ jobId, userId: approverId });
    } catch (error) {
      // Not durable in our database (in-process): nothing
      // would ever pick the job up. Compensate instead of leaving it in
      // GENERATING_PDF forever.
      await revertApprovalAfterDispatchFailure({
        existing,
        approverId,
        error,
        ipAddress: input.metadata.ipAddress ?? null,
        ootEventId,
        dateAdvance,
      });
      return { status: "dispatch_failed" };
    }
  }

  // In-process dispatch (no database queue: development) has no outbox row to
  // drain, so the notification jobs are dispatched here, after the commit and
  // after the certificate job went out; a failure is logged, never fails the
  // approval. In `queue` mode `staged` is set for every one and nothing is left.
  await dispatchUnstagedEffects(effects);

  runCloudApprovalSideEffects({
    existing,
    approverId,
    organizationId: memberData.organizationId,
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
  /** The out-of-tolerance event this approval wrote, if any. */
  ootEventId: number | null;
  /** The asset date advance this approval made, if any. */
  dateAdvance: AssetCalibrationAdvanceApplied | null;
}) {
  const { existing, approverId } = params;
  const message =
    params.error instanceof Error ? params.error.message : "unknown error";
  try {
    const approvedStatus = requireTargetOf(existing.status, "approve");
    const revertedStatus = requireTargetOf(approvedStatus, "revert_approval");
    // Names the laboratory (row-level security); raw executor for the frozen
    // input's delete and the audit row, which carry the organization predicate.
    await orgTransactionWithExecutor(existing.organizationId, async (o, tx) => {
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

      // The records the approval wrote in its own transaction go with it: the job
      // is back in REVIEW, so no customer-facing out-of-tolerance event and no
      // advanced calibration date may outlive an approval that was not released.
      // Their audit rows are append-only and stay; entries say what was undone.
      const undone = `Aprovação do job ${existing.id} revertida antes da emissão`;
      if (params.ootEventId !== null) {
        await withdrawAssetOotEvent(o, {
          eventId: params.ootEventId,
          jobId: existing.id,
          labOrganizationId: existing.organizationId,
          actorUserId: approverId,
          reason: undone,
        });
      }
      if (params.dateAdvance) {
        await revertAssetCalibrationAdvance(o, params.dateAdvance, {
          performedBy: approverId,
          reason: undone,
        });
      }
    });
  } catch (revertError) {
    console.error(
      "[Jobs] Approval dispatch failed AND the revert failed; job may be stuck in GENERATING_PDF",
      { jobId: existing.id, dispatchError: message, revertError },
    );
  }
}

/** A notification job the approval transaction staged (null: no database queue). */
type StagedEffect = {
  message: QueueMessage;
  staged: Awaited<ReturnType<typeof stageBackgroundJob>>;
};

/**
 * Dispatch, after the commit, the notification jobs that were NOT written to
 * the database queue (in-process dispatch). Never throws: the approval stands.
 */
async function dispatchUnstagedEffects(
  effects: readonly StagedEffect[],
): Promise<void> {
  await Promise.all(
    effects
      .filter((effect) => !effect.staged)
      .map(async (effect) => {
        try {
          await enqueueBackgroundJob(effect.message);
        } catch (error) {
          console.error(
            "[Jobs] Failed to dispatch a post-approval notification",
            {
              type: effect.message.type,
              error: error instanceof Error ? error.message : "unknown error",
            },
          );
        }
      }),
  );
}

/**
 * Post-commit, fire-and-forget financial step of a cloud approval. Never
 * blocks or fails the approval response. (The notifications and the asset
 * records are not here: they are written / staged in the approval transaction.)
 */
function runCloudApprovalSideEffects(params: {
  existing: JobRow;
  approverId: string;
  organizationId: string;
  sendServiceOrdersToFinance: ApprovalCompletion["sendServiceOrdersToFinance"];
}) {
  const { existing, approverId, organizationId } = params;
  const jobId = existing.id;

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
