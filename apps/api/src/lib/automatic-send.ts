import { db } from "@calibra-facil/db";
import {
  automaticSendAuditLog,
  automaticSendRule,
  calibrationJob,
  commercialAgreement,
  serviceOrder,
  serviceOrderCertificateLink,
} from "@calibra-facil/db/schema";
import type {
  AutomaticSendMilestone,
  AutomaticSendOutcome,
} from "@calibra-facil/shared";
import { and, eq, isNull } from "drizzle-orm";

export interface ResolvedAutomaticSendRule {
  id: number | null;
  milestone: AutomaticSendMilestone;
  scope: "customer" | "agreement" | "service" | "organization" | "fallback";
}

const FALLBACK_RULE: ResolvedAutomaticSendRule = {
  id: null,
  milestone: "manual_only",
  scope: "fallback",
};

export interface AutomaticSendRuleResolutionInput {
  organizationId: string;
  customerId: number | null;
  commercialAgreementId: number | null;
  serviceName: string | null;
}

function byPriorityThenId(
  a: { priority: number; id: number },
  b: { priority: number; id: number },
) {
  if (a.priority !== b.priority) return b.priority - a.priority;
  return b.id - a.id;
}

export async function resolveAutomaticSendRule(
  input: AutomaticSendRuleResolutionInput,
): Promise<ResolvedAutomaticSendRule> {
  const rows = await db
    .select({
      id: automaticSendRule.id,
      milestone: automaticSendRule.milestone,
      customerId: automaticSendRule.customerId,
      commercialAgreementId: automaticSendRule.commercialAgreementId,
      serviceCategory: automaticSendRule.serviceCategory,
      priority: automaticSendRule.priority,
    })
    .from(automaticSendRule)
    .where(
      and(
        eq(automaticSendRule.organizationId, input.organizationId),
        isNull(automaticSendRule.archivedAt),
      ),
    );

  if (rows.length === 0) return FALLBACK_RULE;

  const customerMatch = rows
    .filter(
      (row) =>
        input.customerId !== null &&
        row.customerId === input.customerId &&
        row.commercialAgreementId === null &&
        row.serviceCategory === null,
    )
    .sort(byPriorityThenId);
  if (customerMatch[0]) {
    return {
      id: customerMatch[0].id,
      milestone: customerMatch[0].milestone,
      scope: "customer",
    };
  }

  const agreementMatch = rows
    .filter(
      (row) =>
        input.commercialAgreementId !== null &&
        row.commercialAgreementId === input.commercialAgreementId &&
        row.customerId === null &&
        row.serviceCategory === null,
    )
    .sort(byPriorityThenId);
  if (agreementMatch[0]) {
    return {
      id: agreementMatch[0].id,
      milestone: agreementMatch[0].milestone,
      scope: "agreement",
    };
  }

  if (input.serviceName !== null) {
    const lowered = input.serviceName.trim().toLowerCase();
    const serviceMatch = rows
      .filter(
        (row) =>
          row.serviceCategory !== null &&
          row.serviceCategory.trim().toLowerCase() === lowered &&
          row.customerId === null &&
          row.commercialAgreementId === null,
      )
      .sort(byPriorityThenId);
    if (serviceMatch[0]) {
      return {
        id: serviceMatch[0].id,
        milestone: serviceMatch[0].milestone,
        scope: "service",
      };
    }
  }

  const orgDefaultMatch = rows
    .filter(
      (row) =>
        row.customerId === null &&
        row.commercialAgreementId === null &&
        row.serviceCategory === null,
    )
    .sort(byPriorityThenId);
  if (orgDefaultMatch[0]) {
    return {
      id: orgDefaultMatch[0].id,
      milestone: orgDefaultMatch[0].milestone,
      scope: "organization",
    };
  }

  return FALLBACK_RULE;
}

export interface MilestoneEvaluationInput {
  event: AutomaticSendMilestone;
  ruleMilestone: AutomaticSendMilestone;
  serviceOrderAlreadySent: boolean;
  serviceOrderBlocked: boolean;
}

export interface MilestoneEvaluationResult {
  shouldSend: boolean;
  outcome: AutomaticSendOutcome;
}

/**
 * Pure milestone match. The engine never sends when:
 * - The rule says manual_only.
 * - The SO has already been sent (de-duplication).
 * - The SO is blocked from billing-readiness.
 * - The fired event doesn't match the rule's milestone.
 */
export function evaluateMilestone(
  input: MilestoneEvaluationInput,
): MilestoneEvaluationResult {
  if (input.ruleMilestone === "manual_only") {
    return { shouldSend: false, outcome: "skipped_manual_only" };
  }
  if (input.event !== input.ruleMilestone) {
    return { shouldSend: false, outcome: "skipped_milestone_not_matched" };
  }
  if (input.serviceOrderAlreadySent) {
    return { shouldSend: false, outcome: "skipped_already_sent" };
  }
  if (input.serviceOrderBlocked) {
    return { shouldSend: false, outcome: "skipped_blocked" };
  }
  return { shouldSend: true, outcome: "sent" };
}

export interface AutomaticSendEvent {
  event: AutomaticSendMilestone;
  serviceOrderId: number;
  organizationId: string;
}

export type AutomaticSendInvoker = (params: {
  organizationId: string;
  serviceOrderId: number;
  actorUserId: string;
}) => Promise<{
  ok: boolean;
  summary?: Record<string, unknown> | null;
  reason?: string;
}>;

export interface TriggerAutomaticSendInput {
  event: AutomaticSendEvent;
  actorUserId: string;
  invoker: AutomaticSendInvoker;
}

export interface TriggerAutomaticSendResult {
  outcome: AutomaticSendOutcome;
  ruleId: number | null;
  reason: string | null;
}

/**
 * Look up the active rule for the SO, evaluate the milestone match,
 * call the invoker if allowed, write a single audit row regardless.
 *
 * The invoker is injected so tests can stub the financial-send path
 * without needing the env/scope plumbing.
 */
export async function triggerAutomaticSendForMilestone(
  input: TriggerAutomaticSendInput,
): Promise<TriggerAutomaticSendResult> {
  const so = await loadServiceOrderForRuleMatch(input.event.serviceOrderId);
  if (!so) {
    return await persistAudit({
      organizationId: input.event.organizationId,
      serviceOrderId: input.event.serviceOrderId,
      ruleId: null,
      milestone: input.event.event,
      outcome: "failed",
      actorUserId: input.actorUserId,
      reason: "service_order_not_found",
      providerResponseSummary: null,
    });
  }

  const rule = await resolveAutomaticSendRule({
    organizationId: input.event.organizationId,
    customerId: so.customerId,
    commercialAgreementId: so.commercialAgreementId,
    serviceName: null,
  });

  const evaluation = evaluateMilestone({
    event: input.event.event,
    ruleMilestone: rule.milestone,
    serviceOrderAlreadySent: so.alreadySent,
    serviceOrderBlocked: so.blocked,
  });

  if (!evaluation.shouldSend) {
    return await persistAudit({
      organizationId: input.event.organizationId,
      serviceOrderId: input.event.serviceOrderId,
      ruleId: rule.id,
      milestone: input.event.event,
      outcome: evaluation.outcome,
      actorUserId: input.actorUserId,
      reason: null,
      providerResponseSummary: null,
    });
  }

  try {
    const invocation = await input.invoker({
      organizationId: input.event.organizationId,
      serviceOrderId: input.event.serviceOrderId,
      actorUserId: input.actorUserId,
    });
    return await persistAudit({
      organizationId: input.event.organizationId,
      serviceOrderId: input.event.serviceOrderId,
      ruleId: rule.id,
      milestone: input.event.event,
      outcome: invocation.ok ? "sent" : "failed",
      actorUserId: input.actorUserId,
      reason: invocation.reason ?? null,
      providerResponseSummary: invocation.summary ?? null,
    });
  } catch (error) {
    return await persistAudit({
      organizationId: input.event.organizationId,
      serviceOrderId: input.event.serviceOrderId,
      ruleId: rule.id,
      milestone: input.event.event,
      outcome: "failed",
      actorUserId: input.actorUserId,
      reason: error instanceof Error ? error.message : "unknown_error",
      providerResponseSummary: null,
    });
  }
}

interface ServiceOrderRuleMatchRow {
  customerId: number;
  commercialAgreementId: number | null;
  alreadySent: boolean;
  blocked: boolean;
}

async function loadServiceOrderForRuleMatch(
  serviceOrderId: number,
): Promise<ServiceOrderRuleMatchRow | null> {
  const [row] = await db
    .select({
      customerId: serviceOrder.customerId,
      commercialAgreementId: commercialAgreement.id,
      billingDocumentId: serviceOrder.billingDocumentId,
      status: serviceOrder.status,
    })
    .from(serviceOrder)
    .leftJoin(
      commercialAgreement,
      eq(commercialAgreement.customerId, serviceOrder.customerId),
    )
    .where(eq(serviceOrder.id, serviceOrderId))
    .limit(1);

  if (!row) return null;
  return {
    customerId: row.customerId,
    commercialAgreementId: row.commercialAgreementId ?? null,
    alreadySent: row.billingDocumentId !== null,
    // Conservative: never auto-send a CANCELED SO. Other blocker checks
    // (missing customer payer, fiscal info, etc.) are evaluated downstream
    // by sendServiceOrdersToFinance; if it returns ok:false the engine
    // records that as `failed` and the operator sees it in the audit.
    blocked: row.status === "canceled",
  };
}

async function persistAudit(params: {
  organizationId: string;
  serviceOrderId: number | null;
  ruleId: number | null;
  milestone: AutomaticSendMilestone;
  outcome: AutomaticSendOutcome;
  actorUserId: string | null;
  reason: string | null;
  providerResponseSummary: Record<string, unknown> | null;
}): Promise<TriggerAutomaticSendResult> {
  await db.insert(automaticSendAuditLog).values({
    organizationId: params.organizationId,
    serviceOrderId: params.serviceOrderId,
    appliedRuleId: params.ruleId,
    milestone: params.milestone,
    outcome: params.outcome,
    actorUserId: params.actorUserId,
    reason: params.reason,
    providerResponseSummary: params.providerResponseSummary,
  });
  return {
    outcome: params.outcome,
    ruleId: params.ruleId,
    reason: params.reason,
  };
}

/**
 * Discover every service order linked to a calibration job via
 * serviceOrderCertificateLink. Used by the certificate-approval
 * wiring to dispatch one automatic-send check per SO.
 */
export async function findServiceOrdersForCalibrationJob(
  calibrationJobId: number,
  organizationId: string,
): Promise<number[]> {
  const rows = await db
    .select({ serviceOrderId: serviceOrderCertificateLink.serviceOrderId })
    .from(serviceOrderCertificateLink)
    .innerJoin(
      serviceOrder,
      eq(serviceOrder.id, serviceOrderCertificateLink.serviceOrderId),
    )
    .innerJoin(
      calibrationJob,
      eq(calibrationJob.id, serviceOrderCertificateLink.certificateJobId),
    )
    .where(
      and(
        eq(serviceOrderCertificateLink.certificateJobId, calibrationJobId),
        eq(serviceOrder.organizationId, organizationId),
        eq(calibrationJob.organizationId, organizationId),
      ),
    );
  return rows.map((row) => row.serviceOrderId);
}
