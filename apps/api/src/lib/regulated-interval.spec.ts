import { describe, expect, it } from "vitest";

import {
  deriveRegulatedNextDate,
  type RegulatedIntervalAnchors,
} from "./regulated-interval.js";

const noAnchors: RegulatedIntervalAnchors = {
  lastVerificationDate: null,
  firstVerificationDate: null,
  installDate: null,
};

const iso = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null);

describe("deriveRegulatedNextDate", () => {
  // REQ-MLR-020: fixed_months anchored to the last verification.
  it("adds valueMonths to the last verification for fixed_months/last_verification", () => {
    const result = deriveRegulatedNextDate(
      {
        kind: "fixed_months",
        valueMonths: 24,
        anchor: "last_verification",
        regulationReference: "Portaria Inmetro nº 124/2022",
        operationalizedByDelegate: false,
      },
      { ...noAnchors, lastVerificationDate: new Date("2024-01-15T00:00:00Z") },
    );
    expect(iso(result.date)).toBe("2026-01-15");
    expect(result.indicative).toBe(false);
    expect(result.isCeiling).toBe(false);
  });

  // REQ-MLR-021: calendar-year validity → 31 Dec of (year + 1).
  it("returns 31 Dec of the following year for fixed_months/calendar_year", () => {
    const result = deriveRegulatedNextDate(
      {
        kind: "fixed_months",
        valueMonths: 12,
        anchor: "calendar_year",
        regulationReference: "Portaria Inmetro nº 157/2022",
        operationalizedByDelegate: true,
      },
      { ...noAnchors, lastVerificationDate: new Date("2024-06-10T00:00:00Z") },
    );
    expect(iso(result.date)).toBe("2025-12-31");
    // REQ-MLR-025: operationalizedByDelegate → indicative.
    expect(result.indicative).toBe(true);
  });

  // REQ-MLR-022: ceiling from year of installation, flagged isCeiling.
  it("derives a ceiling from the install date for max_months_from_install", () => {
    const result = deriveRegulatedNextDate(
      {
        kind: "max_months_from_install",
        valueMonths: 84,
        anchor: "install_year",
        regulationReference: "Portaria Inmetro nº 155/2022",
        operationalizedByDelegate: false,
      },
      { ...noAnchors, installDate: new Date("2020-03-01T00:00:00Z") },
    );
    expect(iso(result.date)).toBe("2027-03-01");
    expect(result.isCeiling).toBe(true);
  });

  // REQ-MLR-023: per_technology uses the configured anchor.
  it("uses first_verification for per_technology/first_verification", () => {
    const result = deriveRegulatedNextDate(
      {
        kind: "per_technology",
        technology: "diafragma",
        valueMonths: 120,
        anchor: "first_verification",
        regulationReference: "Portaria Inmetro nº 156/2022",
        operationalizedByDelegate: false,
      },
      {
        ...noAnchors,
        firstVerificationDate: new Date("2018-05-20T00:00:00Z"),
        lastVerificationDate: new Date("2024-05-20T00:00:00Z"),
      },
    );
    // first + 120 months = 2028-05-20 (NOT last + 120).
    expect(iso(result.date)).toBe("2028-05-20");
  });

  // REQ-MLR-024 + REQ-MLR-025: no national period → null date, indicative.
  it("returns null/indicative for not_nationally_fixed", () => {
    const result = deriveRegulatedNextDate(
      {
        kind: "not_nationally_fixed",
        regulationReference: "Portaria Inmetro nº 493/2021",
        operationalizedByDelegate: false,
      },
      { ...noAnchors, lastVerificationDate: new Date("2024-01-01T00:00:00Z") },
    );
    expect(result.date).toBeNull();
    expect(result.indicative).toBe(true);
  });

  // REQ-MLR-026: absent anchor → null (never fabricated).
  it("returns null when the required anchor date is absent", () => {
    const fixed = deriveRegulatedNextDate(
      {
        kind: "fixed_months",
        valueMonths: 24,
        anchor: "last_verification",
        regulationReference: "Portaria Inmetro nº 124/2022",
        operationalizedByDelegate: false,
      },
      noAnchors,
    );
    expect(fixed.date).toBeNull();

    const ceiling = deriveRegulatedNextDate(
      {
        kind: "max_months_from_install",
        valueMonths: 84,
        anchor: "install_year",
        regulationReference: "Portaria Inmetro nº 155/2022",
        operationalizedByDelegate: false,
      },
      noAnchors,
    );
    expect(ceiling.date).toBeNull();
  });
});
