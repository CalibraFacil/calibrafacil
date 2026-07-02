import { describe, expect, it } from "vitest";
import { decideAssetCalibrationAdvance } from "./asset-calibration-advance";

const BASE_ASSET = {
  lastCalibrationDate: null,
  calibrationIntervalMonths: null,
  regulatedInterval: null,
  installedAt: null,
};

describe("decideAssetCalibrationAdvance", () => {
  it("returns null when the job carries no calibration date", () => {
    expect(
      decideAssetCalibrationAdvance({
        calibrationDate: null,
        asset: BASE_ASSET,
      }),
    ).toBeNull();
  });

  it("is forward-only: an older or equal calibration never rewinds the asset", () => {
    const asset = {
      ...BASE_ASSET,
      lastCalibrationDate: new Date("2026-06-01T00:00:00.000Z"),
    };
    expect(
      decideAssetCalibrationAdvance({
        calibrationDate: new Date("2026-01-01T00:00:00.000Z"),
        asset,
      }),
    ).toBeNull();
    expect(
      decideAssetCalibrationAdvance({
        calibrationDate: new Date("2026-06-01T00:00:00.000Z"),
        asset,
      }),
    ).toBeNull();
  });

  it("advances last_calibration_date and derives next from the customer interval", () => {
    const advance = decideAssetCalibrationAdvance({
      calibrationDate: new Date("2026-06-15T00:00:00.000Z"),
      asset: {
        ...BASE_ASSET,
        lastCalibrationDate: new Date("2025-06-15T00:00:00.000Z"),
        calibrationIntervalMonths: 12,
      },
    });
    expect(advance).toEqual({
      lastCalibrationDate: new Date("2026-06-15T00:00:00.000Z"),
      nextCalibrationDate: new Date("2027-06-15T00:00:00.000Z"),
    });
  });

  it("derives a null next date when the customer has not set an interval (REQ-INTERVAL-003 — the lab never authors one)", () => {
    const advance = decideAssetCalibrationAdvance({
      calibrationDate: new Date("2026-06-15T00:00:00.000Z"),
      asset: BASE_ASSET,
    });
    expect(advance).toEqual({
      lastCalibrationDate: new Date("2026-06-15T00:00:00.000Z"),
      nextCalibrationDate: null,
    });
  });

  it("re-derives the regulated verification date for a LEGAL asset (Track 2)", () => {
    const advance = decideAssetCalibrationAdvance({
      calibrationDate: new Date("2026-06-15T00:00:00.000Z"),
      asset: {
        ...BASE_ASSET,
        calibrationIntervalMonths: 6,
        regulatedInterval: {
          kind: "fixed_months",
          valueMonths: 12,
          anchor: "last_verification",
          regulationReference: "Portaria Inmetro nº 157/2022",
          operationalizedByDelegate: false,
        },
      },
    });
    expect(advance?.nextLegalVerificationDate).toEqual(
      new Date("2027-06-15T00:00:00.000Z"),
    );
  });

  it("does not emit a legal date for a non-regulated asset (no fabricated Track-2 write)", () => {
    const advance = decideAssetCalibrationAdvance({
      calibrationDate: new Date("2026-06-15T00:00:00.000Z"),
      asset: { ...BASE_ASSET, calibrationIntervalMonths: 12 },
    });
    expect(advance).not.toBeNull();
    expect(advance && "nextLegalVerificationDate" in advance).toBe(false);
  });
});
