import { describe, expect, it } from "vitest";

import {
  evaluateRevenueLeakage,
  summarizeRevenueLeakage,
  type RevenueLeakageAlertItem,
  type RevenueLeakageInput,
} from "../revenue-leakage";

const NOW = new Date("2026-05-27T00:00:00.000Z");

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

// An issue date and an installment due date are CALENDAR DATES (UTC midnight of
// the day they name), aged in laboratory days. NOW is 21:00 on 2026-05-26 in
// Sao Paulo, so the laboratory's today is the 26th: `daysAgo(n)` as a calendar
// date is the 26th minus n.
function calendarDaysAgo(days: number): Date {
  return new Date(Date.UTC(2026, 4, 26 - days));
}

function baseInput(
  overrides: Partial<RevenueLeakageInput> = {},
): RevenueLeakageInput {
  return {
    stage: "READY_TO_BILL",
    isOverdue: false,
    isBlocked: false,
    completedAt: null,
    sentAt: null,
    issuedAt: null,
    firstOverdueInstallmentDueDate: null,
    lastStatusChangedAt: null,
    ...overrides,
  };
}

describe("evaluateRevenueLeakage", () => {
  it("emits no alerts when timestamps are missing or fresh", () => {
    expect(
      evaluateRevenueLeakage(baseInput({ completedAt: daysAgo(2) }), NOW),
    ).toEqual([]);
  });

  it("emits STUCK_READY_TO_BILL after 7+ days", () => {
    expect(
      evaluateRevenueLeakage(
        baseInput({ stage: "READY_TO_BILL", completedAt: daysAgo(8) }),
        NOW,
      ),
    ).toContain("STUCK_READY_TO_BILL");
  });

  it("does not emit STUCK_READY_TO_BILL at exactly the threshold", () => {
    expect(
      evaluateRevenueLeakage(
        baseInput({ stage: "READY_TO_BILL", completedAt: daysAgo(7) }),
        NOW,
      ),
    ).not.toContain("STUCK_READY_TO_BILL");
  });

  it("emits STUCK_SENT_TO_FINANCE after 3+ days", () => {
    expect(
      evaluateRevenueLeakage(
        baseInput({ stage: "SENT_TO_FINANCE", sentAt: daysAgo(4) }),
        NOW,
      ),
    ).toContain("STUCK_SENT_TO_FINANCE");
  });

  it("emits STUCK_INVOICED only when not overdue", () => {
    expect(
      evaluateRevenueLeakage(
        baseInput({
          stage: "INVOICED",
          isOverdue: false,
          issuedAt: calendarDaysAgo(31),
        }),
        NOW,
      ),
    ).toContain("STUCK_INVOICED");
    expect(
      evaluateRevenueLeakage(
        baseInput({
          stage: "INVOICED",
          isOverdue: true,
          issuedAt: calendarDaysAgo(31),
          firstOverdueInstallmentDueDate: calendarDaysAgo(20),
        }),
        NOW,
      ),
    ).not.toContain("STUCK_INVOICED");
  });

  it("emits LONG_OVERDUE after 14+ days past due", () => {
    expect(
      evaluateRevenueLeakage(
        baseInput({
          stage: "INVOICED",
          isOverdue: true,
          firstOverdueInstallmentDueDate: calendarDaysAgo(15),
        }),
        NOW,
      ),
    ).toContain("LONG_OVERDUE");
  });

  it("ages issue and due dates in laboratory days, also between 21:00 and 24:00 in Sao Paulo", () => {
    // 23:30 on 2026-05-26 in Sao Paulo is 02:30Z on the 27th: the UTC day is
    // already tomorrow, the laboratory's is not.
    const lateEvening = new Date("2026-05-27T02:30:00.000Z");
    const invoiced = (issuedAt: Date) =>
      evaluateRevenueLeakage(
        baseInput({ stage: "INVOICED", issuedAt }),
        lateEvening,
      );
    // Issued exactly 30 laboratory days ago: not stuck yet; 31: stuck.
    expect(invoiced(calendarDaysAgo(30))).not.toContain("STUCK_INVOICED");
    expect(invoiced(calendarDaysAgo(31))).toContain("STUCK_INVOICED");

    const overdue = (firstOverdueInstallmentDueDate: Date) =>
      evaluateRevenueLeakage(
        baseInput({
          stage: "INVOICED",
          isOverdue: true,
          firstOverdueInstallmentDueDate,
        }),
        lateEvening,
      );
    expect(overdue(calendarDaysAgo(14))).not.toContain("LONG_OVERDUE");
    expect(overdue(calendarDaysAgo(15))).toContain("LONG_OVERDUE");
  });

  it("emits BLOCKED_TOO_LONG after 7+ days", () => {
    expect(
      evaluateRevenueLeakage(
        baseInput({
          stage: "READY_TO_BILL",
          isBlocked: true,
          lastStatusChangedAt: daysAgo(8),
        }),
        NOW,
      ),
    ).toContain("BLOCKED_TOO_LONG");
  });

  it("stacks multiple alert classes when applicable", () => {
    const classes = evaluateRevenueLeakage(
      baseInput({
        stage: "INVOICED",
        isOverdue: true,
        isBlocked: true,
        issuedAt: daysAgo(45),
        firstOverdueInstallmentDueDate: daysAgo(20),
        lastStatusChangedAt: daysAgo(10),
      }),
      NOW,
    );
    expect(classes).toContain("LONG_OVERDUE");
    expect(classes).toContain("BLOCKED_TOO_LONG");
    expect(classes).not.toContain("STUCK_INVOICED");
  });
});

describe("summarizeRevenueLeakage", () => {
  function alert(
    overrides: Partial<RevenueLeakageAlertItem> & {
      classes: RevenueLeakageAlertItem["classes"];
    },
  ): RevenueLeakageAlertItem {
    return {
      serviceOrderId: 1,
      serviceOrderNumber: "OS-1",
      customer: { id: 10, name: "Cliente A" },
      unit: { id: 1, name: "Sede" },
      amountCents: 10_000,
      currency: "BRL",
      ageInDays: 30,
      ...overrides,
    };
  }

  it("returns zero counts when there are no alerts", () => {
    const summary = summarizeRevenueLeakage([]);
    expect(summary.totalAlerts).toBe(0);
    expect(summary.classes.LONG_OVERDUE).toEqual({ count: 0, totalCents: 0 });
  });

  it("counts each class once per alert (double-counts across classes)", () => {
    const summary = summarizeRevenueLeakage([
      alert({
        serviceOrderId: 1,
        amountCents: 30_000,
        classes: ["LONG_OVERDUE", "BLOCKED_TOO_LONG"],
      }),
      alert({
        serviceOrderId: 2,
        amountCents: 5_000,
        classes: ["STUCK_READY_TO_BILL"],
      }),
    ]);
    expect(summary.totalAlerts).toBe(2);
    expect(summary.classes.LONG_OVERDUE).toEqual({
      count: 1,
      totalCents: 30_000,
    });
    expect(summary.classes.BLOCKED_TOO_LONG).toEqual({
      count: 1,
      totalCents: 30_000,
    });
    expect(summary.classes.STUCK_READY_TO_BILL).toEqual({
      count: 1,
      totalCents: 5_000,
    });
  });

  it("skips alerts with empty classes", () => {
    const summary = summarizeRevenueLeakage([alert({ classes: [] })]);
    expect(summary.totalAlerts).toBe(0);
  });
});
