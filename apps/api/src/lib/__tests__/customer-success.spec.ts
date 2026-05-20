import { describe, expect, it } from "vitest";
import type { PlanSupportPolicy } from "@calibra-facil/shared";
import {
  buildCustomerSuccessWorkflow,
  getSupportRequestSlaStatus,
  resolveDueSoonThresholdHours,
} from "../customer-success";

describe("customer success workflow policy", () => {
  const standardPolicy: PlanSupportPolicy = {
    supportMode: "standard",
    hasPrioritySupport: false,
    targetFirstResponseBusinessHours: 24,
    targetResolutionLabel: "Em horario comercial",
    includesAssistedOnboarding: false,
    includesAssistedMigration: false,
  };

  it("scales due-soon thresholds from the effective SLA target", () => {
    expect(resolveDueSoonThresholdHours(48)).toBe(8);
    expect(resolveDueSoonThresholdHours(24)).toBe(6);
    expect(resolveDueSoonThresholdHours(8)).toBe(2);
    expect(resolveDueSoonThresholdHours(4)).toBe(1);
  });

  it("classifies support SLA urgency using the provided threshold", () => {
    const now = new Date("2026-04-03T12:00:00.000Z");

    expect(
      getSupportRequestSlaStatus({
        status: "OPEN",
        slaTargetAt: new Date("2026-04-03T18:00:00.000Z"),
        dueSoonThresholdHours: 8,
        now,
      }),
    ).toBe("DUE_SOON");

    expect(
      getSupportRequestSlaStatus({
        status: "OPEN",
        slaTargetAt: new Date("2026-04-03T18:00:00.000Z"),
        dueSoonThresholdHours: 2,
        now,
      }),
    ).toBe("ON_TRACK");
  });

  it("warns when assisted workflows are tracked outside plan coverage", () => {
    const workflow = buildCustomerSuccessWorkflow({
      supportPolicy: standardPolicy,
      effectiveSlaTier: "PLAN_DEFAULT",
      prioritySupport: false,
      onboardingStatus: "DISCOVERY",
      migrationStatus: "IN_PROGRESS",
      goLiveStatus: "SCHEDULED",
      nextActionStatus: "PENDING",
      nextAction: "Agendar treinamento",
      internalOwnerUserId: "user_internal",
      blockers: [],
      openRequestsCount: 1,
      dueSoonRequestsCount: 0,
      breachedRequestsCount: 0,
      escalatedRequestsCount: 0,
    });

    expect(workflow.policy.targetFirstResponseBusinessHours).toBe(24);
    expect(workflow.policy.dueSoonThresholdBusinessHours).toBe(6);
    expect(workflow.warnings.map((warning) => warning.code)).toContain(
      "ONBOARDING_NOT_INCLUDED_IN_PLAN",
    );
    expect(workflow.warnings.map((warning) => warning.code)).toContain(
      "MIGRATION_NOT_INCLUDED_IN_PLAN",
    );
  });

  it("requires owner and next action for active delivery workflows", () => {
    const workflow = buildCustomerSuccessWorkflow({
      supportPolicy: {
        ...standardPolicy,
        includesAssistedOnboarding: true,
      },
      effectiveSlaTier: "PLAN_DEFAULT",
      prioritySupport: false,
      onboardingStatus: "CONFIGURATION",
      migrationStatus: "NOT_REQUIRED",
      goLiveStatus: "NOT_SCHEDULED",
      nextActionStatus: "NONE",
      nextAction: null,
      internalOwnerUserId: null,
      blockers: [],
      openRequestsCount: 0,
      dueSoonRequestsCount: 0,
      breachedRequestsCount: 0,
      escalatedRequestsCount: 0,
    });

    expect(workflow.accountOwnershipStatus).toBe("AT_RISK");
    expect(workflow.violations.map((violation) => violation.code)).toEqual(
      expect.arrayContaining(["MISSING_INTERNAL_OWNER", "MISSING_NEXT_ACTION"]),
    );
  });

  it("tightens support policy for dedicated SLA tiers", () => {
    const workflow = buildCustomerSuccessWorkflow({
      supportPolicy: {
        supportMode: "dedicated",
        hasPrioritySupport: true,
        targetFirstResponseBusinessHours: 4,
        targetResolutionLabel: "Prioritario",
        includesAssistedOnboarding: true,
        includesAssistedMigration: true,
      },
      effectiveSlaTier: "DEDICATED",
      prioritySupport: true,
      onboardingStatus: "LIVE",
      migrationStatus: "COMPLETED",
      goLiveStatus: "LIVE",
      nextActionStatus: "COMPLETED",
      nextAction: "Go-live concluido",
      internalOwnerUserId: "user_internal",
      blockers: [],
      openRequestsCount: 1,
      dueSoonRequestsCount: 1,
      breachedRequestsCount: 0,
      escalatedRequestsCount: 0,
    });

    expect(workflow.policy.supportMode).toBe("dedicated");
    expect(workflow.policy.targetFirstResponseBusinessHours).toBe(2);
    expect(workflow.policy.dueSoonThresholdBusinessHours).toBe(1);
    expect(workflow.supportState).toBe("AT_RISK");
  });
});
