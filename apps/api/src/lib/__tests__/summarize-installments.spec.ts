import { describe, expect, it } from "vitest";
import {
  summarizeInstallments,
  type FinancialInstallmentStatus,
} from "@calibra-facil/shared";

function row(
  status: FinancialInstallmentStatus["status"],
  amountCents: number,
): Pick<FinancialInstallmentStatus, "status" | "amountCents"> {
  return { status, amountCents };
}

describe("summarizeInstallments", () => {
  it("returns an empty summary for an empty list", () => {
    expect(summarizeInstallments([])).toEqual({
      total: 0,
      totalCents: 0,
      paidCents: 0,
      openCents: 0,
      overdueCents: 0,
      paidCount: 0,
      openCount: 0,
      overdueCount: 0,
      voidCount: 0,
    });
  });

  it("sums a single OPEN installment", () => {
    expect(summarizeInstallments([row("OPEN", 5_000)])).toEqual({
      total: 1,
      totalCents: 5_000,
      paidCents: 0,
      openCents: 5_000,
      overdueCents: 0,
      paidCount: 0,
      openCount: 1,
      overdueCount: 0,
      voidCount: 0,
    });
  });

  it("counts a mixed OPEN+PAID+OVERDUE list correctly", () => {
    expect(
      summarizeInstallments([
        row("PAID", 3_000),
        row("OPEN", 3_000),
        row("OVERDUE", 4_000),
      ]),
    ).toEqual({
      total: 3,
      totalCents: 10_000,
      paidCents: 3_000,
      openCents: 7_000, // OPEN + OVERDUE
      overdueCents: 4_000,
      paidCount: 1,
      openCount: 1,
      overdueCount: 1,
      voidCount: 0,
    });
  });

  it("counts all-paid as paidCount == total with overdueCount 0", () => {
    expect(
      summarizeInstallments([row("PAID", 2_000), row("PAID", 8_000)]),
    ).toEqual({
      total: 2,
      totalCents: 10_000,
      paidCents: 10_000,
      openCents: 0,
      overdueCents: 0,
      paidCount: 2,
      openCount: 0,
      overdueCount: 0,
      voidCount: 0,
    });
  });

  it("excludes VOID installments from totals and counts but tracks voidCount", () => {
    expect(
      summarizeInstallments([
        row("VOID", 5_000),
        row("PAID", 1_000),
        row("OPEN", 4_000),
      ]),
    ).toEqual({
      total: 3,
      totalCents: 5_000,
      paidCents: 1_000,
      openCents: 4_000,
      overdueCents: 0,
      paidCount: 1,
      openCount: 1,
      overdueCount: 0,
      voidCount: 1,
    });
  });

  it("handles an all-VOID list as zero-revenue but positive total + voidCount", () => {
    expect(
      summarizeInstallments([row("VOID", 1_000), row("VOID", 2_000)]),
    ).toEqual({
      total: 2,
      totalCents: 0,
      paidCents: 0,
      openCents: 0,
      overdueCents: 0,
      paidCount: 0,
      openCount: 0,
      overdueCount: 0,
      voidCount: 2,
    });
  });
});
