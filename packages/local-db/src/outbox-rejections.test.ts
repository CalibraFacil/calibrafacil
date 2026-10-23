import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  classifyOutboxRejection,
  isRegulatedOutboxOperation,
  OUTBOX_REJECTION_CLASSES,
  parseOutboxErrorCode,
} from "@calibra-facil/contracts";

const apiSource = (relative: string) =>
  fileURLToPath(new URL(`../../../apps/api/src/${relative}`, import.meta.url));

/** Quoted SCREAMING_SNAKE literals in the API's sync routes and sync modules. */
function emittedSyncCodes() {
  const files = ["routes/sync", "modules/sync"].flatMap((relative) => {
    const directory = apiSource(relative);
    return readdirSync(directory)
      .filter((name) => name.endsWith(".ts") && !name.includes(".spec."))
      .map((name) => `${directory}/${name}`);
  });
  const codes = new Set<string>();
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/"([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)"/g)) {
      const code = match[1];
      if (code) codes.add(code);
    }
  }
  // Not a rejection code: the state of a duplicate-delivery claim.
  codes.delete("IN_PROGRESS");
  return [...codes].sort();
}

describe("REQ-OB-1: classifying cloud rejection codes", () => {
  it("REQ-OB-1: every code the API sync route emits has an explicit classification", () => {
    const emitted = emittedSyncCodes();

    expect(emitted.length).toBeGreaterThan(20);
    const unclassified = emitted.filter(
      (code) => !(code in OUTBOX_REJECTION_CLASSES),
    );
    expect(unclassified).toEqual([]);
  });

  it("REQ-OB-1: the table lists no code the API no longer emits", () => {
    const emitted = new Set(emittedSyncCodes());

    expect(
      Object.keys(OUTBOX_REJECTION_CLASSES).filter(
        (code) => !emitted.has(code),
      ),
    ).toEqual([]);
  });

  it.each([
    "UNSUPPORTED_SYNC_OPERATION",
    "OFFLINE_CERTIFICATE_PUBLICATION_NOT_SUPPORTED",
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
