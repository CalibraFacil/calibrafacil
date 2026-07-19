import { db } from "@calibra-facil/db";
import { calibrationJob, jobAuditLog, member } from "@calibra-facil/db/schema";
import type { ApproveJobSchema } from "@calibra-facil/schemas";
import { and, eq, inArray, ne } from "drizzle-orm";
import type { z } from "zod";
import type { AuthVariables } from "../../middleware/permission";
import { enqueueBackgroundJob } from "../../lib/background-jobs";
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
  findServiceOrdersForCalibrationJob,
  triggerAutomaticSendForMilestone,
} from "../../lib/automatic-send";
import { buildUnitScopeCondition } from "../../lib/units";
import {
  resolveMethodCertificateTemplate,
  serializeCertificateTemplateSnapshot,
} from "../../lib/certificate-template-snapshots";
import { notifyJobApproved } from "@calibra-facil/notifications";

type JobRow = typeof calibrationJob.$inferSelect;
type ApproveJobInput = z.infer<typeof ApproveJobSchema>;

export type FinanceSendResult = {
  ok: boolean;
  billingDocumentId?: number | null;
  error?: string | null;
};

export type ApproveJobResult =
  | { status: "not_found" }
  | { status: "invalid_status"; currentStatus: JobRow["status"] }
  | { status: "self_approval_blocked" }
  | { status: "not_authorized_signatory" }
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
      /**
       * The job's method has no certificate template linked (or the linked
       * template is archived / has no PUBLISHED version) — issuance would
       * fail in the worker, so approval blocks with an actionable error.
       */
      status: "certificate_template_required";
      reason: "method_missing" | "template_missing" | "template_unpublished";
    }
  | {
      status: "approved";
      job: JobRow | undefined;
      /** Accredited-scope (CMC) classification frozen at approval (#427). */
      scopeCompliance: JobRow["scopeComplianceStatus"];
    };

/**
 * Approve a calibration job: the ISO/IEC 17025 release gates, the
 * REVIEW → GENERATING_PDF transition, the audit trail, and the post-approval
 * side effects, callable without the HTTP pipeline. The route adapter maps
 * each result status to its response.
 */
export async function approveJob(input: {
  jobId: number;
  member: AuthVariables["member"];
  approverId: string;
  values: ApproveJobInput;
  metadata: { ipAddress?: string | null };
  /**
   * Env-bound financial dispatch, injected by the route: the command owns the
   * "which service orders, which milestone" flow while the transport to the
   * finance engine stays with the caller.
   */
  sendServiceOrdersToFinance: (params: {
    organizationId: string;
    serviceOrderIds: number[];
    actorUserId: string;
  }) => Promise<ReadonlyArray<FinanceSendResult>>;
}): Promise<ApproveJobResult> {
  const { jobId, member: memberData, approverId, values } = input;

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
  if (existing.status !== "REVIEW") {
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

  // Save environmental justification if provided
  if (
    values.environmentalJustification &&
    existing.environmentalSnapshot &&
    !existing.environmentalSnapshot.withinLimits
  ) {
    await db
      .update(calibrationJob)
      .set({
        environmentalSnapshot: {
          ...existing.environmentalSnapshot,
          outOfLimitsJustification: values.environmentalJustification,
        },
      })
      .where(eq(calibrationJob.id, jobId));
  }

  // Derive the AS-FOUND (pre-adjustment) reliability verdict from the frozen
  // results, for ILAC-G24 / NCSL RP-1 interval analysis. Read-only over
  // `results`; it does NOT influence approval, conformity, or the certificate.
  const asFoundVerdict = buildAsFoundReliabilityVerdict({
    results: existing.results,
  });

  // Accredited-scope (CMC) guard — ISO/IEC 17025 §7.6/§7.8.3, ILAC P14
  // (#427). Re-classified here at the emission date so the frozen record is
  // authoritative even if scope lines changed since submit. In 'warn' mode
  // the classification never blocks; in 'enforce' mode an adverse result
  // blocks accredited issuance unless a documented override downgrades the
  // certificate to non-accredited (seal suppressed at every render site).
  const approvedAt = new Date();
  const { compliance: scopeCompliance, enforcementMode } =
    await classifyJobScopeCompliance({
      organizationId: memberData.organizationId,
      unitId: existing.unitId,
      methodSnapshot: existing.methodSnapshot,
      assetSnapshot: existing.assetSnapshot,
      data: existing.data,
      results: existing.results,
      atDate: approvedAt,
    });

  const scopeOverrideJustification =
    values.scopeOverrideJustification?.trim() || null;
  const scopeBlocked =
    enforcementMode === "enforce" && isAdverseScopeCompliance(scopeCompliance);
  if (scopeBlocked && scopeCompliance && !scopeOverrideJustification) {
    return { status: "scope_violation", scopeCompliance };
  }
  // The override is only meaningful when it is actually unblocking an
  // enforced violation — never let a stray justification downgrade a
  // passing (or warn-mode) certificate.
  const appliedScopeOverride = scopeBlocked ? scopeOverrideJustification : null;

  // Per-method certificate template (migration 0104): the frozen method must
  // own a renderable template BEFORE the job leaves REVIEW — otherwise the
  // worker would fail after the fact and strand the job in GENERATING_PDF.
  // Always re-resolved at approval (like the scope classification above) so a
  // re-approval picks up a re-linked method.
  const templateResolution = await resolveMethodCertificateTemplate({
    organizationId: memberData.organizationId,
    methodId: existing.methodSnapshot?.methodId ?? null,
  });
  if (!templateResolution.ok) {
    return {
      status: "certificate_template_required",
      reason: templateResolution.reason,
    };
  }
  const templateSnapshot = templateResolution.snapshot;

  // Update job status to GENERATING_PDF and set approver info
  // (we set approved_by now so the PDF worker can fetch it)
  const [updated] = await db
    .update(calibrationJob)
    .set({
      status: "GENERATING_PDF",
      approvedBy: approverId,
      approvedAt,
      asFoundConformity: asFoundVerdict.conformity,
      asFoundMargins: asFoundVerdict.margins,
      scopeComplianceStatus: scopeCompliance?.status ?? null,
      scopeComplianceFindings: scopeCompliance?.findings ?? null,
      scopeOverrideJustification: appliedScopeOverride,
      certificateTemplateId: templateSnapshot.id,
      certificateTemplateSnapshot:
        serializeCertificateTemplateSnapshot(templateSnapshot),
    })
    .where(eq(calibrationJob.id, jobId))
    .returning();

  // Audit log
  await db.insert(jobAuditLog).values({
    jobId,
    action: "approve",
    changes: {
      status: { old: existing.status, new: "GENERATING_PDF" },
      // Recorded on ANY transition — including adverse → null when the guard
      // stopped applying (scope lines deleted, vigência lapsed). Erasing a
      // previously frozen verdict without an audit entry would leave a §8.4
      // gap and make bypass-by-deleting-scope-lines invisible.
      ...(existing.scopeComplianceStatus !== (scopeCompliance?.status ?? null)
        ? {
            scopeComplianceStatus: {
              old: existing.scopeComplianceStatus,
              new: scopeCompliance?.status ?? null,
            },
          }
        : {}),
      ...(appliedScopeOverride
        ? {
            scopeOverrideJustification: {
              old: existing.scopeOverrideJustification,
              new: appliedScopeOverride,
            },
          }
        : {}),
    },
    performedBy: approverId,
    ipAddress: input.metadata.ipAddress ?? null,
    // Keep the approver's own notes alongside the override record — the
    // downgrade must not erase the supplied approval reason from the trail.
    reason: appliedScopeOverride
      ? [
          `Aprovado SEM selo de acreditação (violação de escopo/CMC documentada): ${appliedScopeOverride}`,
          values.reason?.trim() || null,
        ]
          .filter(Boolean)
          .join(" | ")
      : values.reason || "Aprovado - Gerando PDF",
  });

  // Advance the asset's calibration dates from the approved work
  // (last_calibration_date + the derived next dates) — forward-only and
  // never fails the approval. Without this the due sweeps re-remind for
  // an instrument that was just calibrated.
  await advanceAssetCalibrationDatesOnApproval({
    assetId: existing.assetId,
    calibrationDate: existing.performedAt ?? updated?.approvedAt ?? null,
    performedBy: approverId,
    source: "job_approval",
  });

  await enqueueBackgroundJob({
    jobId,
    userId: approverId,
  });

  // Send notification to technician (fire and forget)
  notifyJobApproved(jobId, approverId).catch((err) => {
    console.error("[Jobs] Failed to send approval notification:", err);
  });

  // #740 Track B: as-found non-conforming → customer-facing OOT event +
  // "avaliar impacto" alert (ISO 9001 §7.1.5.2). Idempotent per job;
  // fire-and-forget — never blocks the approval.
  if (asFoundVerdict.conformity === "NON_CONFORMING") {
    createAssetOotEventForApprovedJob({
      jobId,
      assetId: existing.assetId,
      customerId: existing.customerId,
      labOrganizationId: memberData.organizationId,
      detectedAt: updated?.approvedAt ?? new Date(),
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
      const orgId = memberData.organizationId;
      const linkedSoIds = await findServiceOrdersForCalibrationJob(
        jobId,
        orgId,
      );
      for (const serviceOrderId of linkedSoIds) {
        await triggerAutomaticSendForMilestone({
          event: {
            event: "certificate_approved",
            serviceOrderId,
            organizationId: orgId,
          },
          actorUserId: approverId,
          invoker: async (params) => {
            try {
              const results = await input.sendServiceOrdersToFinance({
                organizationId: params.organizationId,
                serviceOrderIds: [params.serviceOrderId],
                actorUserId: params.actorUserId,
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

  return {
    status: "approved",
    job: updated,
    scopeCompliance: scopeCompliance?.status ?? null,
  };
}
