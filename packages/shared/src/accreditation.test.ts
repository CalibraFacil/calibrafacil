import { describe, expect, it } from "vitest";
import {
  accreditationBoundDay,
  accreditationDayToInstant,
  ACCREDITATION_NUMBER_PREFIX,
  ACCREDITATION_SEAL_FONT_FAMILY,
  ACCREDITATION_SEAL_SCHEME,
  ACCREDITATION_SEAL_SCHEME_LINE1,
  ACCREDITATION_SEAL_SCHEME_LINE2,
  formatAccreditationNumber,
  getAccreditationStatus,
  isAccreditationActive,
  normalizeAccreditationNumber,
  shouldRenderAccreditationSeal,
  decideAccreditationSeal,
  isAccreditationSealEligible,
  resolveIssuedAccreditationSeal,
  accreditationSealWithheldMessage,
  ACCREDITATION_SEAL_WITHHELD_MESSAGES_PT,
} from "./accreditation";

const PASS = { status: "PASS", findings: [] };

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
        scopeEvaluation: PASS,
        lab: activeLab,
        methodAccreditedScope: true,
      }),
    ).toBe(true);
  });

  // REQ-ACCR-011: active lab but methodAccreditedScope is false/null/undefined → false
  it("REQ-ACCR-011: returns false when lab is active but methodAccreditedScope is false", () => {
    expect(
      shouldRenderAccreditationSeal({
        scopeEvaluation: PASS,
        lab: activeLab,
        methodAccreditedScope: false,
      }),
    ).toBe(false);
  });

  it("REQ-ACCR-011: returns false when lab is active but methodAccreditedScope is null", () => {
    expect(
      shouldRenderAccreditationSeal({
        scopeEvaluation: PASS,
        lab: activeLab,
        methodAccreditedScope: null,
      }),
    ).toBe(false);
  });

  it("REQ-ACCR-011: returns false when lab is active but methodAccreditedScope is undefined", () => {
    expect(
      shouldRenderAccreditationSeal({
        scopeEvaluation: PASS,
        lab: activeLab,
        methodAccreditedScope: undefined,
      }),
    ).toBe(false);
  });

  it("REQ-ACCR-010+011: returns false when lab is inactive even if scope is true", () => {
    expect(
      shouldRenderAccreditationSeal({
        scopeEvaluation: PASS,
        lab: inactiveLab,
        methodAccreditedScope: true,
      }),
    ).toBe(false);
  });
});

// REQ-ACCR-012: exported seal constants must equal the regulated strings verbatim.
// Source: NIE-Cgcre-009 rev. 27 (Jul/2024) A.5/A.8 — the upper band of the symbol
// carries the accreditation-SCHEME norm on two lines. Rev. 27 dropped the previous
// "Calibração / NBR ISO/IEC / 17025"; the accreditation type is the CAL prefix below.
describe("seal constants", () => {
  it("REQ-ACCR-012: ACCREDITATION_SEAL_SCHEME equals the exact regulated string", () => {
    expect(ACCREDITATION_SEAL_SCHEME).toBe("ABNT NBR ISO/IEC 17025");
  });

  it("REQ-ACCR-012: the two rendered lines concatenate back to the scheme string", () => {
    expect(
      `${ACCREDITATION_SEAL_SCHEME_LINE1} ${ACCREDITATION_SEAL_SCHEME_LINE2}`,
    ).toBe(ACCREDITATION_SEAL_SCHEME);
  });

  it("REQ-ACCR-012: ACCREDITATION_NUMBER_PREFIX equals the exact regulated string", () => {
    expect(ACCREDITATION_NUMBER_PREFIX).toBe("CAL");
  });

  it("REQ-ACCR-012: the pre-rev.27 wording is gone from the seal", () => {
    // "Calibração" moved out of the symbol entirely in rev. 27 — if it comes
    // back, the symbol is non-conforming as of Jul/2027.
    expect(ACCREDITATION_SEAL_SCHEME).not.toContain("Calibração");
    expect(ACCREDITATION_SEAL_SCHEME).toContain("ABNT");
  });

  // REQ-ACCR-013: A.6.2 requires Arial. Carlito (a Calibri clone) ships with
  // LibreOffice and is present in the Gotenberg Chromium container, so it must
  // never precede Arial in the stack or the symbol silently stops being Arial.
  it("REQ-ACCR-013: the seal font stack names Arial first", () => {
    const families = ACCREDITATION_SEAL_FONT_FAMILY.split(",").map((family) =>
      family.trim().replaceAll('"', ""),
    );
    expect(families[0]).toBe("Arial");
    expect(families).not.toContain("Carlito");
    expect(families).not.toContain("Calibri");
  });
});

// REQ-ACCR-014: NIE-Cgcre-009 §11.5.3/.4/.5 — external-provider results.
// Fail-closed tripwire. Nothing passes this flag today (subcontracting is not
// modelled); these tests exist so the guard cannot be silently dropped by the
// change that DOES model it.
describe("external-provider results suppress the seal", () => {
  const accreditedLab = {
    accreditationActive: true,
    accreditationNumber: "9999",
  };

  it("REQ-ACCR-014: any external-provider result suppresses the seal", () => {
    expect(
      shouldRenderAccreditationSeal({
        scopeEvaluation: PASS,
        lab: accreditedLab,
        methodAccreditedScope: true,
        hasExternalProviderResults: true,
      }),
    ).toBe(false);
  });

  it("REQ-ACCR-014: it overrides an otherwise fully accredited certificate", () => {
    // Same inputs, only the flag differs — proves the flag is what decides.
    expect(
      shouldRenderAccreditationSeal({
        scopeEvaluation: PASS,
        lab: accreditedLab,
        methodAccreditedScope: true,
      }),
    ).toBe(true);
    expect(
      shouldRenderAccreditationSeal({
        scopeEvaluation: PASS,
        lab: accreditedLab,
        methodAccreditedScope: true,
        hasExternalProviderResults: true,
      }),
    ).toBe(false);
  });

  it("REQ-ACCR-014: absent or false leaves today's behaviour untouched", () => {
    expect(
      shouldRenderAccreditationSeal({
        scopeEvaluation: PASS,
        lab: accreditedLab,
        methodAccreditedScope: true,
        hasExternalProviderResults: false,
      }),
    ).toBe(true);
    expect(
      shouldRenderAccreditationSeal({
        scopeEvaluation: PASS,
        lab: accreditedLab,
        methodAccreditedScope: true,
      }),
    ).toBe(true);
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
        scopeEvaluation: PASS,
        lab,
        methodAccreditedScope: true,
        atDate: after,
      }),
    ).toBe(false);
    expect(
      shouldRenderAccreditationSeal({
        scopeEvaluation: PASS,
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
        scopeEvaluation: PASS,
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
        scopeEvaluation: PASS,
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

// #427 Phase 1: a documented scope-violation override downgrades the issuance
// to NON-accredited — the seal must never render for an overridden approval.
describe("shouldRenderAccreditationSeal — scope-override downgrade", () => {
  const activeLab = { accreditationActive: true, accreditationNumber: "9999" };

  it("suppresses the seal when a scope-override justification is frozen on the job", () => {
    expect(
      shouldRenderAccreditationSeal({
        scopeEvaluation: PASS,
        lab: activeLab,
        methodAccreditedScope: true,
        scopeOverrideJustification: "Cliente exigiu emissão fora do escopo.",
      }),
    ).toBe(false);
  });

  it("keeps the seal when the override field is null, absent or blank", () => {
    expect(
      shouldRenderAccreditationSeal({
        scopeEvaluation: PASS,
        lab: activeLab,
        methodAccreditedScope: true,
        scopeOverrideJustification: null,
      }),
    ).toBe(true);
    expect(
      shouldRenderAccreditationSeal({
        scopeEvaluation: PASS,
        lab: activeLab,
        methodAccreditedScope: true,
        scopeOverrideJustification: "   ",
      }),
    ).toBe(true);
  });
});

// The vigência window is a pair of calendar days of the laboratory (São Paulo),
// not a pair of UTC instants: the server clock is UTC, so a certificate issued
// at 23:30 -03:00 on the last day is already the next UTC day.
describe("accreditation vigência window — laboratory calendar days", () => {
  const base = { accreditationActive: true, accreditationNumber: "9999" };

  describe.each([
    {
      shape: "stored by the lab-day anchor (00:00 / 23:59:59.999 -03:00)",
      from: "2027-03-01T03:00:00.000Z",
      until: "2027-03-06T02:59:59.999Z",
    },
    {
      shape: "legacy UTC anchor (UTC 00:00 / UTC 23:59:59.999)",
      from: "2027-03-01T00:00:00.000Z",
      until: "2027-03-05T23:59:59.999Z",
    },
  ])("window 2027-03-01..2027-03-05 $shape", ({ from, until }) => {
    const lab = {
      ...base,
      accreditationValidFrom: from,
      accreditationValidUntil: until,
    };

    it("REQ-CMP-VIG-002: an issue at 23:30 -03:00 on the last day is inside the window", () => {
      const issuedAt = new Date("2027-03-05T23:30:00-03:00");
      expect(getAccreditationStatus(lab, issuedAt)).toBe("active");
      expect(
        shouldRenderAccreditationSeal({
          scopeEvaluation: PASS,
          lab,
          methodAccreditedScope: true,
          atDate: issuedAt,
        }),
      ).toBe(true);
    });

    it("REQ-CMP-VIG-002: an issue at 00:30 -03:00 on the next day is outside the window", () => {
      const issuedAt = new Date("2027-03-06T00:30:00-03:00");
      expect(getAccreditationStatus(lab, issuedAt)).toBe("expired");
      expect(
        shouldRenderAccreditationSeal({
          scopeEvaluation: PASS,
          lab,
          methodAccreditedScope: true,
          atDate: issuedAt,
        }),
      ).toBe(false);
    });

    it("REQ-CMP-VIG-002: the first day counts from 00:00 -03:00 and not before", () => {
      expect(
        getAccreditationStatus(lab, new Date("2027-03-01T00:30:00-03:00")),
      ).toBe("active");
      expect(
        getAccreditationStatus(lab, new Date("2027-02-28T23:30:00-03:00")),
      ).toBe("expired");
    });
  });

  it("reads a stored bound as the calendar day it names", () => {
    expect(accreditationBoundDay("2027-03-01T03:00:00.000Z")).toBe(
      "2027-03-01",
    );
    expect(accreditationBoundDay("2027-03-01T00:00:00.000Z")).toBe(
      "2027-03-01",
    );
    expect(accreditationBoundDay("2027-03-06T02:59:59.999Z")).toBe(
      "2027-03-05",
    );
    expect(accreditationBoundDay("2027-03-05T23:59:59.999Z")).toBe(
      "2027-03-05",
    );
    expect(accreditationBoundDay(null)).toBeNull();
    expect(accreditationBoundDay("not a date")).toBeNull();
  });

  it("anchors a day to 00:00 and 23:59:59.999 in São Paulo", () => {
    expect(
      accreditationDayToInstant("2027-03-01", "start")?.toISOString(),
    ).toBe("2027-03-01T03:00:00.000Z");
    expect(accreditationDayToInstant("2027-03-05", "end")?.toISOString()).toBe(
      "2027-03-06T02:59:59.999Z",
    );
    // 2018 was still on daylight saving (-02:00) in November.
    expect(
      accreditationDayToInstant("2018-11-20", "start")?.toISOString(),
    ).toBe("2018-11-20T02:00:00.000Z");
    // DST ended 2019-02-17 at 00:00 (-02) -> 23:00 on the 16th (-03): the 16th
    // runs one hour longer and its last millisecond is the one before 03:00Z.
    expect(accreditationDayToInstant("2019-02-16", "end")?.toISOString()).toBe(
      "2019-02-17T02:59:59.999Z",
    );
    expect(accreditationDayToInstant("2027-02-30", "start")).toBeNull();
    expect(accreditationDayToInstant("2027-13-01", "end")).toBeNull();
    expect(accreditationDayToInstant("03/05/2027", "end")).toBeNull();
  });
});

// Q42 (P0-7): the seal needs a positive frozen scope verdict.
describe("decideAccreditationSeal — scope verdict (Q42)", () => {
  const lab = {
    accreditationActive: true,
    accreditationNumber: "9999",
    accreditationValidFrom: new Date("2026-01-01T12:00:00.000Z"),
    accreditationValidUntil: new Date("2027-01-01T12:00:00.000Z"),
  };
  const issueDate = new Date("2026-06-01T12:00:00.000Z");
  const decide = (
    overrides: Partial<Parameters<typeof decideAccreditationSeal>[0]> = {},
  ) =>
    decideAccreditationSeal({
      lab,
      methodAccreditedScope: true,
      atDate: issueDate,
      scopeEvaluation: PASS,
      ...overrides,
    });

  it("seals a positive PASS inside the window for a method in scope", () => {
    expect(decide()).toEqual({ accredited: true, withheldReason: null });
  });

  it.each([
    ["OUT_OF_SCOPE", "scope_out_of_scope"],
    ["U_BELOW_CMC", "scope_u_below_cmc"],
    ["PARTIALLY_EVALUATED", "scope_partially_evaluated"],
    ["NOT_EVALUATED", "scope_not_evaluated"],
    ["NO_SCOPE_LINES", "scope_no_scope_lines"],
    ["SOMETHING_NEW", "scope_not_assessed"],
  ])("withholds the seal on %s", (status, reason) => {
    expect(decide({ scopeEvaluation: { status, findings: [] } })).toEqual({
      accredited: false,
      withheldReason: reason,
    });
  });

  it("withholds the seal when there is no evaluation at all", () => {
    expect(decide({ scopeEvaluation: null })).toEqual({
      accredited: false,
      withheldReason: "scope_not_assessed",
    });
  });

  it("a legacy PASS that carries a not_evaluated finding never seals", () => {
    expect(
      decide({
        scopeEvaluation: {
          status: "PASS",
          findings: [{ kind: "not_evaluated" }],
        },
      }),
    ).toEqual({
      accredited: false,
      withheldReason: "scope_partially_evaluated",
    });
  });

  it("a PASS without findings stays positive", () => {
    expect(
      decide({ scopeEvaluation: { status: "PASS", findings: [] } }).accredited,
    ).toBe(true);
    expect(
      decide({ scopeEvaluation: { status: "PASS", findings: null } })
        .accredited,
    ).toBe(true);
  });

  it("a PASS cannot rescue an ineligible lab, method or issuance", () => {
    expect(decide({ methodAccreditedScope: false })).toEqual({
      accredited: false,
      withheldReason: "method_not_in_scope",
    });
    expect(
      decide({ lab: { ...lab, accreditationActive: false } }).withheldReason,
    ).toBe("lab_accreditation_inactive");
    expect(
      decide({ lab: { ...lab, accreditationNumber: "" } }).withheldReason,
    ).toBe("lab_accreditation_incomplete");
    expect(
      decide({ atDate: new Date("2027-06-01T12:00:00.000Z") }).withheldReason,
    ).toBe("lab_accreditation_expired");
    expect(
      decide({ atDate: new Date("2025-06-01T12:00:00.000Z") }).withheldReason,
    ).toBe("lab_accreditation_expired");
    expect(decide({ scopeOverrideJustification: "  cliente pediu " })).toEqual({
      accredited: false,
      withheldReason: "scope_override",
    });
    expect(decide({ hasExternalProviderResults: true }).withheldReason).toBe(
      "external_provider_results",
    );
  });

  it("eligibility ignores the verdict, which is what legacy records were sealed under", () => {
    expect(
      isAccreditationSealEligible({
        lab,
        methodAccreditedScope: true,
        atDate: issueDate,
      }),
    ).toBe(true);
  });

  it("every reason has a pt-BR message", () => {
    for (const [code, message] of Object.entries(
      ACCREDITATION_SEAL_WITHHELD_MESSAGES_PT,
    )) {
      expect(message.length).toBeGreaterThan(10);
      expect(accreditationSealWithheldMessage(code)).toBe(message);
    }
    expect(accreditationSealWithheldMessage(null)).toBeNull();
  });
});

describe("resolveIssuedAccreditationSeal", () => {
  const legacy = {
    lab: { accreditationActive: true, accreditationNumber: "9999" },
    methodAccreditedScope: true,
  };

  it("the frozen decision wins over the lab's current fields", () => {
    expect(
      resolveIssuedAccreditationSeal({
        frozenSeal: {
          accredited: false,
          withheldReason: "scope_out_of_scope",
        },
        legacy,
      }),
    ).toEqual({
      accredited: false,
      withheldReason: "scope_out_of_scope",
      source: "frozen",
    });
    expect(
      resolveIssuedAccreditationSeal({
        frozenSeal: { accredited: true },
        legacy: { ...legacy, methodAccreditedScope: false },
      }).accredited,
    ).toBe(true);
  });

  it("a record without a frozen decision keeps the rule it was issued under", () => {
    expect(
      resolveIssuedAccreditationSeal({ frozenSeal: null, legacy }),
    ).toEqual({ accredited: true, withheldReason: null, source: "legacy" });
    expect(
      resolveIssuedAccreditationSeal({
        frozenSeal: { accredited: "yes" },
        legacy: { ...legacy, methodAccreditedScope: false },
      }).accredited,
    ).toBe(false);
  });
});
