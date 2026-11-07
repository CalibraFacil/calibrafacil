import { describe, expect, it } from "vitest";

import {
  API_ERROR_CODES,
  canonicalApiErrorCode,
  isApiErrorCode,
  LEGACY_API_ERROR_CODE_ALIASES,
} from "./api-errors";

describe("API error code registry", () => {
  it("lists every code once", () => {
    expect(new Set(API_ERROR_CODES).size).toBe(API_ERROR_CODES.length);
  });

  it("aliases every upper-case code whose snake_case twin is also listed, and only those", () => {
    const twins = API_ERROR_CODES.filter(
      (code) =>
        code === code.toUpperCase() && isApiErrorCode(code.toLowerCase()),
    );
    expect([...twins].sort()).toEqual(
      Object.keys(LEGACY_API_ERROR_CODE_ALIASES).sort(),
    );
    for (const [legacy, canonical] of Object.entries(
      LEGACY_API_ERROR_CODE_ALIASES,
    )) {
      expect(canonical).toBe(legacy.toLowerCase());
    }
  });

  it("maps a legacy spelling to the canonical code and leaves every other code alone", () => {
    expect(canonicalApiErrorCode("SCOPE_VIOLATION")).toBe("scope_violation");
    expect(canonicalApiErrorCode("JOB_STATUS_CONFLICT")).toBe(
      "job_status_conflict",
    );
    expect(canonicalApiErrorCode("scope_violation")).toBe("scope_violation");
    expect(canonicalApiErrorCode("LAST_CALIBRATION_APPROVER")).toBe(
      "LAST_CALIBRATION_APPROVER",
    );
  });
});
