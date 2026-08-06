import { describe, expect, it } from "vitest";

import {
  canTransitionServiceOrderStatus,
  isServiceOrderDecidingQuoteStatus,
  isServiceOrderFinalStatus,
  isServiceOrderStatus,
  isServiceOrderWorkInProgressStatus,
  SERVICE_ORDER_STATUSES,
} from "./service-orders";

describe("service order work-in-progress statuses", () => {
  it("covers the states where the instrument is already on the bench", () => {
    for (const status of [
      "repair_in_progress",
      "awaiting_calibration",
      "calibration_in_progress",
      "awaiting_final_review",
    ] as const) {
      expect(isServiceOrderWorkInProgressStatus(status)).toBe(true);
    }
  });

  it("excludes the states before work starts and after it ends", () => {
    for (const status of [
      "opened",
      "awaiting_tech_evaluation",
      "under_evaluation",
      "awaiting_quote_approval",
      "quote_approved",
      "quote_rejected",
      "ready_for_pickup",
      "delivered",
      "closed",
      "canceled",
    ] as const) {
      expect(isServiceOrderWorkInProgressStatus(status)).toBe(false);
    }
  });

  it("never overlaps with the final statuses", () => {
    for (const status of SERVICE_ORDER_STATUSES) {
      expect(
        isServiceOrderWorkInProgressStatus(status) &&
          isServiceOrderFinalStatus(status),
      ).toBe(false);
    }
  });

  it("marks exactly the statuses that cannot legally reach awaiting_quote_approval", () => {
    // This is why quote actions preserve the status in these states rather than
    // rewinding: the graph has no edge back, and the work has not stopped.
    for (const status of SERVICE_ORDER_STATUSES) {
      if (!isServiceOrderWorkInProgressStatus(status)) continue;
      expect(
        canTransitionServiceOrderStatus(status, "awaiting_quote_approval"),
      ).toBe(false);
    }
  });
});

describe("isServiceOrderStatus", () => {
  it("accepts every known status", () => {
    for (const status of SERVICE_ORDER_STATUSES) {
      expect(isServiceOrderStatus(status)).toBe(true);
    }
  });

  it("rejects values a jsonb column could plausibly hold", () => {
    // The reopen path reads a status back out of the event log, where a row
    // written by another deploy could carry anything.
    for (const value of [
      undefined,
      null,
      "",
      "CLOSED",
      "not_a_status",
      42,
      { status: "closed" },
      ["closed"],
    ]) {
      expect(isServiceOrderStatus(value)).toBe(false);
    }
  });
});

describe("isServiceOrderDecidingQuoteStatus", () => {
  it("is true only while the order is actually awaiting a decision", () => {
    expect(isServiceOrderDecidingQuoteStatus("awaiting_quote_approval")).toBe(
      true,
    );
    for (const status of SERVICE_ORDER_STATUSES) {
      if (status === "awaiting_quote_approval") continue;
      expect(isServiceOrderDecidingQuoteStatus(status)).toBe(false);
    }
  });

  it("excludes every status a late decision could arrive in", () => {
    // A public-access token outlives the bench: an unanswered mid-job re-quote
    // can still be approved after the OS reached ready_for_pickup, delivered
    // or closed. None of these may be rewound to quote_approved.
    for (const status of [
      "repair_in_progress",
      "awaiting_calibration",
      "calibration_in_progress",
      "awaiting_final_review",
      "ready_for_pickup",
      "delivered",
      "closed",
      "canceled",
    ] as const) {
      expect(isServiceOrderDecidingQuoteStatus(status)).toBe(false);
    }
  });
});
