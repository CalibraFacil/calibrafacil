import { SERVICE_ORDER_STATUSES } from "@calibra-facil/shared";
import { describe, expect, it } from "vitest";
import {
  SERVICE_ORDER_MACHINE,
  canSetServiceOrderStatus,
  isServiceOrderDecidingQuoteStatus,
  isServiceOrderWorkInProgressStatus,
} from "./service-order";
import {
  SERVICE_ORDER_QUOTE_MACHINE,
  canApproveServiceOrderQuote,
  canEditServiceOrderQuote,
} from "./service-order-quote";

describe("SERVICE_ORDER_MACHINE", () => {
  it("creates orders at intake only", () => {
    expect(SERVICE_ORDER_MACHINE.creationStates()).toEqual([
      "opened",
      "awaiting_tech_evaluation",
      "warranty_return",
    ]);
  });

  it("set_status walks the declared graph one step at a time", () => {
    expect(canSetServiceOrderStatus("opened", "awaiting_tech_evaluation")).toBe(
      true,
    );
    expect(canSetServiceOrderStatus("closed", "repair_in_progress")).toBe(
      false,
    );
    expect(canSetServiceOrderStatus("ready_for_pickup", "closed")).toBe(false);
  });

  it("closed and canceled leave only through reopen", () => {
    for (const status of ["closed", "canceled"] as const) {
      expect(SERVICE_ORDER_MACHINE.commandsFrom(status)).toEqual(["reopen"]);
    }
    expect(SERVICE_ORDER_MACHINE.targetsOf("closed", "reopen")).toEqual([
      "delivered",
      "awaiting_tech_evaluation",
    ]);
  });

  it("an evaluation is recorded only at intake and decides the next stage", () => {
    expect(SERVICE_ORDER_MACHINE.allowedFrom("evaluate")).toEqual([
      "opened",
      "awaiting_tech_evaluation",
      "under_evaluation",
      "warranty_return",
    ]);
    expect(
      SERVICE_ORDER_MACHINE.targetsOf("awaiting_tech_evaluation", "evaluate"),
    ).toEqual([
      "awaiting_quote_approval",
      "awaiting_calibration",
      "ready_for_pickup",
    ]);
    for (const status of ["delivered", "closed", "repair_in_progress"]) {
      expect(SERVICE_ORDER_MACHINE.canTransition(status, "evaluate")).toBe(
        false,
      );
    }
  });

  it("start_repair needs an approved quote; a re-start is a no-op", () => {
    expect(SERVICE_ORDER_MACHINE.allowedFrom("start_repair")).toEqual([
      "quote_approved",
      "repair_in_progress",
    ]);
  });

  it("send_quote rewinds an order off the bench, keeps one on it, never touches a final one", () => {
    for (const status of SERVICE_ORDER_STATUSES) {
      const target = SERVICE_ORDER_MACHINE.targetOf(status, "send_quote");
      if (status === "closed" || status === "canceled") {
        expect(target).toBeNull();
      } else if (isServiceOrderWorkInProgressStatus(status)) {
        expect(target).toBe(status);
      } else {
        expect(target).toBe("awaiting_quote_approval");
      }
    }
  });

  it("a quote decision advances the order only while it waits on it", () => {
    expect(isServiceOrderDecidingQuoteStatus("awaiting_quote_approval")).toBe(
      true,
    );
    for (const status of SERVICE_ORDER_STATUSES) {
      if (status === "awaiting_quote_approval") continue;
      expect(isServiceOrderDecidingQuoteStatus(status)).toBe(false);
      expect(SERVICE_ORDER_MACHINE.canTransition(status, "reject_quote")).toBe(
        false,
      );
    }
  });

  it("deliver and close are the last steps", () => {
    expect(SERVICE_ORDER_MACHINE.allowedFrom("deliver")).toEqual([
      "ready_for_pickup",
    ]);
    expect(SERVICE_ORDER_MACHINE.allowedFrom("close")).toEqual(["delivered"]);
  });
});

describe("SERVICE_ORDER_QUOTE_MACHINE", () => {
  it("draft → sent → approved | rejected; nothing else", () => {
    expect(SERVICE_ORDER_QUOTE_MACHINE.statePairs()).toEqual([
      ["draft", "sent"],
      ["sent", "approved"],
      ["sent", "rejected"],
    ]);
    expect(SERVICE_ORDER_QUOTE_MACHINE.terminalStates()).toEqual([
      "approved",
      "rejected",
    ]);
  });

  it("locks sent and decided quotes against edits", () => {
    expect(canEditServiceOrderQuote("draft")).toBe(true);
    expect(canEditServiceOrderQuote("sent")).toBe(false);
    expect(canEditServiceOrderQuote("approved")).toBe(false);
    expect(canApproveServiceOrderQuote("sent")).toBe(true);
    expect(canApproveServiceOrderQuote("approved")).toBe(false);
  });
});
