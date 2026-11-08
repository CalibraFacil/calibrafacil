import { describe, expect, it } from "vitest";
import {
  getCalibrationLocationSnapshotOrNull,
  getCalibrationPhaseSnapshotOrNull,
  getEnvironmentalSnapshotOrNull,
} from "./snapshot-parsers";

const recorded = {
  recordedAt: "2026-06-10T10:00:00.000Z",
  recordedBy: "user-1",
};

describe("the frozen calibration record a desktop pushes", () => {
  it("accepts an environmental snapshot with every field the cloud writes", () => {
    const snapshot = {
      temperature: 21.5,
      humidity: null,
      pressure: null,
      ...recorded,
      limits: { temperature: { min: 18, max: 25 } },
      withinLimits: true,
      outOfLimitsJustification: null,
    };
    expect(getEnvironmentalSnapshotOrNull({ s: snapshot }, "s")).toEqual(
      snapshot,
    );
  });

  it("refuses an environmental snapshot the old check let through", () => {
    // Had one of three readings and the two strings: no limits verdict, which
    // the approval reads (withinLimits) from the frozen record.
    expect(
      getEnvironmentalSnapshotOrNull(
        { s: { temperature: 21.5, ...recorded } },
        "s",
      ),
    ).toBeNull();
    expect(getEnvironmentalSnapshotOrNull({ s: null }, "s")).toBeNull();
  });

  it("accepts a location and refuses a type that is not a location type", () => {
    const location = { type: "lab", addressText: "Bancada 3", ...recorded };
    expect(getCalibrationLocationSnapshotOrNull({ s: location }, "s")).toEqual(
      location,
    );
    expect(
      getCalibrationLocationSnapshotOrNull(
        { s: { ...location, type: "moon" } },
        "s",
      ),
    ).toBeNull();
  });

  it("accepts phase blocks and refuses blocks whose mode does not exist", () => {
    const phases = {
      blocks: {
        main: { mode: "before_and_after" },
        extra: { mode: "not_performed", reason: "sem acesso" },
      },
      ...recorded,
    };
    expect(getCalibrationPhaseSnapshotOrNull({ s: phases }, "s")).toEqual(
      phases,
    );
    // `blocks` was only checked to be an object: anything inside passed.
    expect(
      getCalibrationPhaseSnapshotOrNull(
        { s: { blocks: { main: "yes" }, ...recorded } },
        "s",
      ),
    ).toBeNull();
    expect(
      getCalibrationPhaseSnapshotOrNull(
        { s: { blocks: { main: { mode: "sometimes" } }, ...recorded } },
        "s",
      ),
    ).toBeNull();
  });
});
