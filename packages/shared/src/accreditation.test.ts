import { describe, expect, it } from "vitest";
import {
  ACCREDITATION_NUMBER_PREFIX,
  ACCREDITATION_SEAL_SUBTITLE,
  ACCREDITATION_SEAL_TITLE,
  formatAccreditationNumber,
  getAccreditationStatus,
  isAccreditationActive,
  normalizeAccreditationNumber,
  shouldRenderAccreditationSeal,
} from "./accreditation";

// REQ-ACCR-001: free-form inputs normalize to digits-only "0123"
describe("normalizeAccreditationNumber", () => {
  it("REQ-ACCR-001: strips prefix and separators, returns digits only", () => {
    expect(normalizeAccreditationNumber("RBC 0123")).toBe("0123");
    expect(normalizeAccreditationNumber("CAL-0123")).toBe("0123");
    expect(normalizeAccreditationNumber("0123")).toBe("0123");
  });

  // REQ-ACCR-002: more than 6 digits → truncate to first 6
  it("REQ-ACCR-002: truncates to the first 6 digits when input has more", () => {
    expect(normalizeAccreditationNumber("1234567")).toBe("123456");
    expect(normalizeAccreditationNumber("CAL 9876543")).toBe("987654");
  });

  // REQ-ACCR-003: no digits in input → empty string
  it("REQ-ACCR-003: returns empty string when input contains no digits", () => {
    expect(normalizeAccreditationNumber("")).toBe("");
    expect(normalizeAccreditationNumber("CAL")).toBe("");
    expect(normalizeAccreditationNumber("RBC")).toBe("");
  });
});

// REQ-ACCR-004 / REQ-ACCR-005
describe("formatAccreditationNumber", () => {
  // REQ-ACCR-004: digit-bearing input produces "CAL " + normalized digits
  it("REQ-ACCR-004: returns CAL-prefixed display string for digit-bearing input", () => {
    expect(formatAccreditationNumber("0123")).toBe("CAL 0123");
    expect(formatAccreditationNumber("CAL-0123")).toBe("CAL 0123");
    expect(formatAccreditationNumber("RBC 9999")).toBe("CAL 9999");
  });

  // REQ-ACCR-005: null / undefined / digitless → null
  it("REQ-ACCR-005: returns null for null input", () => {
    expect(formatAccreditationNumber(null)).toBeNull();
  });

  it("REQ-ACCR-005: returns null for undefined input", () => {
    expect(formatAccreditationNumber(undefined)).toBeNull();
  });

  it("REQ-ACCR-005: returns null for a string with no digits", () => {
    expect(formatAccreditationNumber("CAL")).toBeNull();
    expect(formatAccreditationNumber("")).toBeNull();
  });
});

// REQ-ACCR-006 / REQ-ACCR-007 / REQ-ACCR-008
describe("getAccreditationStatus", () => {
  // REQ-ACCR-006: accreditationActive falsy → "inactive"
  it("REQ-ACCR-006: returns inactive when accreditationActive is false", () => {
    expect(getAccreditationStatus({ accreditationActive: false })).toBe(
      "inactive",
    );
  });

  it("REQ-ACCR-006: returns inactive when accreditationActive is null", () => {
    expect(getAccreditationStatus({ accreditationActive: null })).toBe(
      "inactive",
    );
  });

  it("REQ-ACCR-006: returns inactive when accreditationActive is undefined", () => {
    expect(getAccreditationStatus({})).toBe("inactive");
  });

  // REQ-ACCR-007: active + digit-bearing number → "active"
  it("REQ-ACCR-007: returns active when flag is true and number has digits", () => {
    expect(
      getAccreditationStatus({
        accreditationActive: true,
        accreditationNumber: "0123",
      }),
    ).toBe("active");

    expect(
      getAccreditationStatus({
        accreditationActive: true,
        accreditationNumber: "CAL-9999",
      }),
    ).toBe("active");
  });

  // REQ-ACCR-008: active + missing/digitless number → "incomplete"
  it("REQ-ACCR-008: returns incomplete when flag is true but number is missing", () => {
    expect(getAccreditationStatus({ accreditationActive: true })).toBe(
      "incomplete",
    );
  });

  it("REQ-ACCR-008: returns incomplete when flag is true but number is null", () => {
    expect(
      getAccreditationStatus({
        accreditationActive: true,
        accreditationNumber: null,
      }),
    ).toBe("incomplete");
  });

  it("REQ-ACCR-008: returns incomplete when flag is true but number has no digits", () => {
    expect(
      getAccreditationStatus({
        accreditationActive: true,
        accreditationNumber: "CAL",
      }),
    ).toBe("incomplete");
  });
});

// REQ-ACCR-009
describe("isAccreditationActive", () => {
  it("REQ-ACCR-009: returns true only when status is active", () => {
    expect(
      isAccreditationActive({
        accreditationActive: true,
        accreditationNumber: "0123",
      }),
    ).toBe(true);
  });

  it("REQ-ACCR-009: returns false for incomplete status", () => {
    expect(
      isAccreditationActive({
        accreditationActive: true,
        accreditationNumber: null,
      }),
    ).toBe(false);
  });

  it("REQ-ACCR-009: returns false for inactive status", () => {
    expect(isAccreditationActive({ accreditationActive: false })).toBe(false);
  });
});

// REQ-ACCR-010 / REQ-ACCR-011
describe("shouldRenderAccreditationSeal", () => {
  const activeLab = { accreditationActive: true, accreditationNumber: "9999" };
  const inactiveLab = {
    accreditationActive: false,
    accreditationNumber: "9999",
  };

  // REQ-ACCR-010: active lab + methodAccreditedScope true → true
  it("REQ-ACCR-010: returns true when lab is active and method is in accredited scope", () => {
    expect(
      shouldRenderAccreditationSeal({
        lab: activeLab,
        methodAccreditedScope: true,
      }),
    ).toBe(true);
  });

  // REQ-ACCR-011: active lab but methodAccreditedScope is false/null/undefined → false
  it("REQ-ACCR-011: returns false when lab is active but methodAccreditedScope is false", () => {
    expect(
      shouldRenderAccreditationSeal({
        lab: activeLab,
        methodAccreditedScope: false,
      }),
    ).toBe(false);
  });

  it("REQ-ACCR-011: returns false when lab is active but methodAccreditedScope is null", () => {
    expect(
      shouldRenderAccreditationSeal({
        lab: activeLab,
        methodAccreditedScope: null,
      }),
    ).toBe(false);
  });

  it("REQ-ACCR-011: returns false when lab is active but methodAccreditedScope is undefined", () => {
    expect(
      shouldRenderAccreditationSeal({
        lab: activeLab,
        methodAccreditedScope: undefined,
      }),
    ).toBe(false);
  });

  it("REQ-ACCR-010+011: returns false when lab is inactive even if scope is true", () => {
    expect(
      shouldRenderAccreditationSeal({
        lab: inactiveLab,
        methodAccreditedScope: true,
      }),
    ).toBe(false);
  });
});

// REQ-ACCR-012: exported seal constants must equal the regulated strings verbatim
describe("seal constants", () => {
  it("REQ-ACCR-012: ACCREDITATION_SEAL_SUBTITLE equals the exact regulated string", () => {
    expect(ACCREDITATION_SEAL_SUBTITLE).toBe("NBR ISO/IEC 17025");
  });

  it("REQ-ACCR-012: ACCREDITATION_NUMBER_PREFIX equals the exact regulated string", () => {
    expect(ACCREDITATION_NUMBER_PREFIX).toBe("CAL");
  });

  it("REQ-ACCR-012: ACCREDITATION_SEAL_TITLE equals the exact regulated string", () => {
    expect(ACCREDITATION_SEAL_TITLE).toBe("Calibração");
  });
});

// #647 (CMP — vigência da acreditação)
describe("accreditation vigência window", () => {
  const base = { accreditationActive: true, accreditationNumber: "9999" };
  const from = new Date("2024-03-01T00:00:00.000Z");
  const until = new Date("2027-03-01T00:00:00.000Z");

  it("REQ-CMP-VIG-002: outside [validFrom, validUntil] the seal never renders and status is 'expired'", () => {
    const lab = {
      ...base,
      accreditationValidFrom: from,
      accreditationValidUntil: until,
    };
    const after = new Date("2027-06-01T00:00:00.000Z");
    const before = new Date("2024-01-01T00:00:00.000Z");

    expect(getAccreditationStatus(lab, after)).toBe("expired");
    expect(getAccreditationStatus(lab, before)).toBe("expired");
    expect(
      shouldRenderAccreditationSeal({
        lab,
        methodAccreditedScope: true,
        atDate: after,
      }),
    ).toBe(false);
    expect(
      shouldRenderAccreditationSeal({
        lab,
        methodAccreditedScope: true,
        atDate: before,
      }),
    ).toBe(false);
  });

  it("inside the window the seal renders as before", () => {
    const lab = {
      ...base,
      accreditationValidFrom: from,
      accreditationValidUntil: until,
    };
    const inside = new Date("2026-07-05T12:00:00.000Z");
    expect(getAccreditationStatus(lab, inside)).toBe("active");
    expect(
      shouldRenderAccreditationSeal({
        lab,
        methodAccreditedScope: true,
        atDate: inside,
      }),
    ).toBe(true);
  });

  it("REQ-CMP-VIG-004: orgs without a window keep the current behavior (no gate)", () => {
    const lab = {
      ...base,
      accreditationValidFrom: null,
      accreditationValidUntil: null,
    };
    expect(getAccreditationStatus(lab, new Date("2099-01-01"))).toBe("active");
    expect(
      shouldRenderAccreditationSeal({
        lab,
        methodAccreditedScope: true,
        atDate: new Date("2099-01-01"),
      }),
    ).toBe(true);
  });

  it("half-open configs gate on the side that exists", () => {
    const untilOnly = { ...base, accreditationValidUntil: until };
    expect(getAccreditationStatus(untilOnly, new Date("2026-01-01"))).toBe(
      "active",
    );
    expect(getAccreditationStatus(untilOnly, new Date("2028-01-01"))).toBe(
      "expired",
    );

    const fromOnly = { ...base, accreditationValidFrom: from };
    expect(getAccreditationStatus(fromOnly, new Date("2024-01-01"))).toBe(
      "expired",
    );
    expect(getAccreditationStatus(fromOnly, new Date("2099-01-01"))).toBe(
      "active",
    );
  });

  it("accepts ISO-string dates (hydrated rows)", () => {
    const lab = {
      ...base,
      accreditationValidFrom: "2024-03-01T00:00:00.000Z",
      accreditationValidUntil: "2027-03-01T00:00:00.000Z",
    };
    expect(getAccreditationStatus(lab, new Date("2028-01-01"))).toBe("expired");
    expect(getAccreditationStatus(lab, new Date("2026-01-01"))).toBe("active");
  });

  it("expired still reports 'inactive'/'incomplete' first when those apply", () => {
    expect(
      getAccreditationStatus(
        {
          accreditationActive: false,
          accreditationValidUntil: new Date("2020-01-01"),
        },
        new Date("2026-01-01"),
      ),
    ).toBe("inactive");
    expect(
      getAccreditationStatus(
        {
          accreditationActive: true,
          accreditationNumber: "",
          accreditationValidUntil: new Date("2020-01-01"),
        },
        new Date("2026-01-01"),
      ),
    ).toBe("incomplete");
  });
});
