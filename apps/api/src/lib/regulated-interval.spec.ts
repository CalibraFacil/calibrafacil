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

const iso = (date: Date | null) =>
  date ? date.toISOString().slice(0, 10) : null;

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

  // REQ-INSTALL-002: max_months_from_install + installDate present → installDate + valueMonths.
  it("REQ-INSTALL-002: derives next_legal_verification_date from installDate for max_months_from_install", () => {
    const result = deriveRegulatedNextDate(
      {
        kind: "max_months_from_install",
        valueMonths: 60,
        anchor: "install_year",
        regulationReference: "Portaria Inmetro nº 155/2022",
        operationalizedByDelegate: false,
      },
      { ...noAnchors, installDate: new Date("2021-07-15T00:00:00Z") },
    );
    // 2021-07-15 + 60 months = 2026-07-15.
    expect(iso(result.date)).toBe("2026-07-15");
    expect(result.isCeiling).toBe(true);
  });

  // REQ-INSTALL-003: max_months_from_install + installDate absent → null (never fabricated).
  it("REQ-INSTALL-003: keeps the date null when installDate is absent for max_months_from_install", () => {
    const result = deriveRegulatedNextDate(
      {
        kind: "max_months_from_install",
        valueMonths: 60,
        anchor: "install_year",
        regulationReference: "Portaria Inmetro nº 155/2022",
        operationalizedByDelegate: false,
      },
      // last/first verification present, but installDate is null → must NOT fabricate.
      {
        lastVerificationDate: new Date("2024-01-01T00:00:00Z"),
        firstVerificationDate: new Date("2024-01-01T00:00:00Z"),
        installDate: null,
      },
    );
    expect(result.date).toBeNull();
  });

  // REQ-INSTALL-005: the install anchor affects ONLY max_months_from_install; fixed_months
  // and per_technology derive the SAME date with and without an installDate.
  it("REQ-INSTALL-005: installDate does not change fixed_months / per_technology derivation", () => {
    const withoutInstall: RegulatedIntervalAnchors = {
      lastVerificationDate: new Date("2024-03-10T00:00:00Z"),
      firstVerificationDate: new Date("2019-03-10T00:00:00Z"),
      installDate: null,
    };
    const withInstall: RegulatedIntervalAnchors = {
      ...withoutInstall,
      installDate: new Date("2000-01-01T00:00:00Z"),
    };

    const fixed = {
      kind: "fixed_months" as const,
      valueMonths: 24,
      anchor: "last_verification" as const,
      regulationReference: "Portaria Inmetro nº 124/2022",
      operationalizedByDelegate: false,
    };
    expect(iso(deriveRegulatedNextDate(fixed, withInstall).date)).toBe(
      iso(deriveRegulatedNextDate(fixed, withoutInstall).date),
    );

    const perTech = {
      kind: "per_technology" as const,
      technology: "diafragma" as const,
      valueMonths: 120,
      anchor: "first_verification" as const,
      regulationReference: "Portaria Inmetro nº 156/2022",
      operationalizedByDelegate: false,
    };
    expect(iso(deriveRegulatedNextDate(perTech, withInstall).date)).toBe(
      iso(deriveRegulatedNextDate(perTech, withoutInstall).date),
    );
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
