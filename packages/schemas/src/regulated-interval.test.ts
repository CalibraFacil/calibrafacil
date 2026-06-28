import { describe, expect, it } from "vitest";

import { RegulatedIntervalSchema } from "./index";

describe("RegulatedIntervalSchema", () => {
  // REQ-MLR-010: a valid fixed_months period parses (taxímetro: 24m, last_verification).
  it("accepts a fixed_months period", () => {
    expect(
      RegulatedIntervalSchema.safeParse({
        kind: "fixed_months",
        valueMonths: 24,
        anchor: "last_verification",
        regulationReference: "Portaria Inmetro nº 124/2022",
        operationalizedByDelegate: false,
      }).success,
    ).toBe(true);
  });

  // REQ-MLR-010: balanças — annual cadence anchored to the calendar year, Ipem-operationalized.
  it("accepts a fixed_months/calendar_year period operationalized by the delegate", () => {
    expect(
      RegulatedIntervalSchema.safeParse({
        kind: "fixed_months",
        valueMonths: 12,
        anchor: "calendar_year",
        regulationReference: "Portaria Inmetro nº 157/2022",
        operationalizedByDelegate: true,
      }).success,
    ).toBe(true);
  });

  // REQ-MLR-011: max_months_from_install REQUIRES anchor=install_year.
  it("accepts max_months_from_install with install_year and rejects another anchor", () => {
    expect(
      RegulatedIntervalSchema.safeParse({
        kind: "max_months_from_install",
        valueMonths: 84,
        anchor: "install_year",
        regulationReference: "Portaria Inmetro nº 155/2022",
        operationalizedByDelegate: false,
      }).success,
    ).toBe(true);
    expect(
      RegulatedIntervalSchema.safeParse({
        kind: "max_months_from_install",
        valueMonths: 84,
        anchor: "last_verification",
        regulationReference: "Portaria Inmetro nº 155/2022",
        operationalizedByDelegate: false,
      }).success,
    ).toBe(false);
  });

  // REQ-MLR-011: per_technology REQUIRES a non-empty technology.
  it("accepts per_technology with a technology and rejects it without one", () => {
    expect(
      RegulatedIntervalSchema.safeParse({
        kind: "per_technology",
        technology: "diafragma",
        valueMonths: 120,
        anchor: "first_verification",
        regulationReference: "Portaria Inmetro nº 156/2022",
        operationalizedByDelegate: false,
      }).success,
    ).toBe(true);
    expect(
      RegulatedIntervalSchema.safeParse({
        kind: "per_technology",
        technology: "   ",
        valueMonths: 120,
        anchor: "first_verification",
        regulationReference: "Portaria Inmetro nº 156/2022",
        operationalizedByDelegate: false,
      }).success,
    ).toBe(false);
  });

  // REQ-MLR-010: not_nationally_fixed needs no months (energia elétrica → cite ANEEL).
  it("accepts not_nationally_fixed without a period", () => {
    expect(
      RegulatedIntervalSchema.safeParse({
        kind: "not_nationally_fixed",
        note: "Sem periodicidade Inmetro; verificação inicial + após reparo. ANEEL Res. 414/2010 é regime distinto.",
        regulationReference: "Portaria Inmetro nº 493/2021",
        operationalizedByDelegate: false,
      }).success,
    ).toBe(true);
  });

  // REQ-MLR-011: valueMonths must be an integer within [1, 600].
  it("rejects out-of-range or non-integer valueMonths", () => {
    for (const valueMonths of [0, 601, 12.5]) {
      expect(
        RegulatedIntervalSchema.safeParse({
          kind: "fixed_months",
          valueMonths,
          anchor: "last_verification",
          regulationReference: "Portaria Inmetro nº 124/2022",
          operationalizedByDelegate: false,
        }).success,
      ).toBe(false);
    }
  });

  // REQ-MLR-010: regulationReference + operationalizedByDelegate are required on every member.
  it("rejects a missing regulationReference or operationalizedByDelegate", () => {
    expect(
      RegulatedIntervalSchema.safeParse({
        kind: "fixed_months",
        valueMonths: 24,
        anchor: "last_verification",
        operationalizedByDelegate: false,
      }).success,
    ).toBe(false);
    expect(
      RegulatedIntervalSchema.safeParse({
        kind: "fixed_months",
        valueMonths: 24,
        anchor: "last_verification",
        regulationReference: "Portaria Inmetro nº 124/2022",
      }).success,
    ).toBe(false);
  });

  // REQ-MLR-010: an unknown discriminator is rejected.
  it("rejects an unknown kind", () => {
    expect(
      RegulatedIntervalSchema.safeParse({
        kind: "rolling_window",
        valueMonths: 12,
        regulationReference: "Portaria Inmetro nº 124/2022",
        operationalizedByDelegate: false,
      }).success,
    ).toBe(false);
  });
});
