import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AutomaticSendMilestone } from "@calibra-facil/shared";

const mocks = vi.hoisted(() => ({
  ruleRows: [] as Array<{
    id: number;
    milestone: AutomaticSendMilestone;
    customerId: number | null;
    commercialAgreementId: number | null;
    serviceCategory: string | null;
    priority: number;
  }>,
}));

vi.mock("@calibra-facil/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async () => mocks.ruleRows,
      }),
    }),
  },
}));

import {
  evaluateMilestone,
  resolveAutomaticSendRule,
} from "../automatic-send";

beforeEach(() => {
  mocks.ruleRows = [];
});

describe("evaluateMilestone", () => {
  it("skips manual_only regardless of event", () => {
    expect(
      evaluateMilestone({
        event: "certificate_approved",
        ruleMilestone: "manual_only",
        serviceOrderAlreadySent: false,
        serviceOrderBlocked: false,
      }),
    ).toEqual({ shouldSend: false, outcome: "skipped_manual_only" });
  });

  it("skips when event does not match the rule milestone", () => {
    expect(
      evaluateMilestone({
        event: "service_order_delivered",
        ruleMilestone: "certificate_approved",
        serviceOrderAlreadySent: false,
        serviceOrderBlocked: false,
      }),
    ).toEqual({
      shouldSend: false,
      outcome: "skipped_milestone_not_matched",
    });
  });

  it("skips when the service order has already been sent", () => {
    expect(
      evaluateMilestone({
        event: "certificate_approved",
        ruleMilestone: "certificate_approved",
        serviceOrderAlreadySent: true,
        serviceOrderBlocked: false,
      }),
    ).toEqual({ shouldSend: false, outcome: "skipped_already_sent" });
  });

  it("skips when the service order is blocked", () => {
    expect(
      evaluateMilestone({
        event: "certificate_approved",
        ruleMilestone: "certificate_approved",
        serviceOrderAlreadySent: false,
        serviceOrderBlocked: true,
      }),
    ).toEqual({ shouldSend: false, outcome: "skipped_blocked" });
  });

  it("sends when event matches and the SO is neither sent nor blocked", () => {
    expect(
      evaluateMilestone({
        event: "certificate_approved",
        ruleMilestone: "certificate_approved",
        serviceOrderAlreadySent: false,
        serviceOrderBlocked: false,
      }),
    ).toEqual({ shouldSend: true, outcome: "sent" });
  });
});

describe("resolveAutomaticSendRule", () => {
  it("returns the fallback when no rules exist", async () => {
    mocks.ruleRows = [];
    const result = await resolveAutomaticSendRule({
      organizationId: "org-1",
      customerId: 10,
      commercialAgreementId: null,
      serviceName: null,
    });
    expect(result).toEqual({
      id: null,
      milestone: "manual_only",
      scope: "fallback",
    });
  });

  it("prefers a customer-scoped override over the org default", async () => {
    mocks.ruleRows = [
      {
        id: 1,
        milestone: "manual_only",
        customerId: null,
        commercialAgreementId: null,
        serviceCategory: null,
        priority: 0,
      },
      {
        id: 2,
        milestone: "certificate_approved",
        customerId: 10,
        commercialAgreementId: null,
        serviceCategory: null,
        priority: 0,
      },
    ];
    const result = await resolveAutomaticSendRule({
      organizationId: "org-1",
      customerId: 10,
      commercialAgreementId: null,
      serviceName: null,
    });
    expect(result.id).toBe(2);
    expect(result.scope).toBe("customer");
    expect(result.milestone).toBe("certificate_approved");
  });

  it("falls back to the org default when no override matches", async () => {
    mocks.ruleRows = [
      {
        id: 1,
        milestone: "service_order_delivered",
        customerId: null,
        commercialAgreementId: null,
        serviceCategory: null,
        priority: 0,
      },
      {
        id: 2,
        milestone: "certificate_approved",
        customerId: 999,
        commercialAgreementId: null,
        serviceCategory: null,
        priority: 0,
      },
    ];
    const result = await resolveAutomaticSendRule({
      organizationId: "org-1",
      customerId: 10,
      commercialAgreementId: null,
      serviceName: null,
    });
    expect(result.id).toBe(1);
    expect(result.scope).toBe("organization");
    expect(result.milestone).toBe("service_order_delivered");
  });

  it("breaks ties by higher priority then higher id", async () => {
    mocks.ruleRows = [
      {
        id: 5,
        milestone: "manual_only",
        customerId: 10,
        commercialAgreementId: null,
        serviceCategory: null,
        priority: 0,
      },
      {
        id: 7,
        milestone: "certificate_approved",
        customerId: 10,
        commercialAgreementId: null,
        serviceCategory: null,
        priority: 10,
      },
      {
        id: 8,
        milestone: "service_order_delivered",
        customerId: 10,
        commercialAgreementId: null,
        serviceCategory: null,
        priority: 0,
      },
    ];
    const result = await resolveAutomaticSendRule({
      organizationId: "org-1",
      customerId: 10,
      commercialAgreementId: null,
      serviceName: null,
    });
    expect(result.id).toBe(7);
    expect(result.scope).toBe("customer");
  });
});
