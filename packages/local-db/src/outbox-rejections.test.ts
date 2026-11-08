import {
  OUTBOX_REJECTION_CLASSES,
  classifyOutboxRejection,
  isRegulatedOutboxOperation,
  parseOutboxErrorCode,
} from "@calibra-facil/contracts/outbox-rejections";
import { describe, expect, it } from "vitest";

describe("REQ-OB-1: classifying cloud rejection codes", () => {
  // Every code the API's sync push can put in `rejected` is typed
  // `OutboxRejectionCode` (keyof the table), so an unclassified refusal does not
  // compile; no source scan is needed.

  it.each([
    "UNSUPPORTED_SYNC_OPERATION",
    "STATUS_PAYLOAD_MISMATCH",
    "STANDARD_EXPIRED",
    "STANDARD_BACKDATE_REASON_REQUIRED",
    "TECHNICIAN_COMPETENCE_MISSING",
    "INVALID_STATUS_TRANSITION",
    "INVALID_DESKTOP_EVENT_PAYLOAD",
  ])("REQ-OB-1: %s is permanent", (code) => {
    expect(classifyOutboxRejection(code)).toBe("permanent");
  });

  it.each([
    "SYNC_EVENT_IN_PROGRESS",
    "DESKTOP_SYNC_APPLY_FAILED",
    "REMOTE_ENTITY_MAPPING_MISSING",
  ])("REQ-OB-1: %s is transient", (code) => {
    expect(classifyOutboxRejection(code)).toBe("transient");
  });

  it("REQ-OB-1: a code this build does not know backs off instead of dying", () => {
    expect(classifyOutboxRejection("SOMETHING_FROM_A_NEWER_CLOUD")).toBe(
      "transient",
    );
    expect(classifyOutboxRejection("toString")).toBe("transient");
  });

  it("REQ-OB-1: reads the code back out of a stored `CODE: reason` error", () => {
    expect(parseOutboxErrorCode("STANDARD_EXPIRED: padrao vencido")).toBe(
      "STANDARD_EXPIRED",
    );
    expect(parseOutboxErrorCode("Cloud push failed with HTTP 503")).toBeNull();
    expect(parseOutboxErrorCode("offline")).toBeNull();
    expect(parseOutboxErrorCode(null)).toBeNull();
  });

  it("REQ-OB-3: execution events are regulated work, a customer edit is not", () => {
    expect(isRegulatedOutboxOperation("submit_local_execution")).toBe(true);
    expect(isRegulatedOutboxOperation("save_local_execution")).toBe(true);
    expect(isRegulatedOutboxOperation("create_local_customer")).toBe(false);
  });
});
