import { describe, expect, it } from "vitest";

import {
  DUE_SOON_DAYS,
  calibrationFilterToStatus,
  getCalibrationStatus,
  getInstrumentStatus,
  isCalibrationFilter,
} from "./calibration-status";

const NOW = new Date("2026-05-30T12:00:00Z");

describe("getCalibrationStatus", () => {
  it("returns UNSCHEDULED when there is no due date", () => {
    const info = getCalibrationStatus(null, NOW);
    expect(info.status).toBe("UNSCHEDULED");
    expect(info.tone).toBe("neutral");
    expect(info.daysDelta).toBeNull();
    expect(info.description).toBe("Sem data de calibração");
  });

  it("flags a past due date as OVERDUE with a positive day count", () => {
    const info = getCalibrationStatus("2026-05-27T12:00:00Z", NOW);
    expect(info.status).toBe("OVERDUE");
    expect(info.tone).toBe("critical");
    expect(info.daysDelta).toBe(-3);
    expect(info.description).toBe("Vencida há 3 dias");
  });

  it("treats today as DUE_SOON ('Vence hoje')", () => {
    const info = getCalibrationStatus("2026-05-30T23:00:00Z", NOW);
    expect(info.status).toBe("DUE_SOON");
    expect(info.tone).toBe("warning");
    expect(info.daysDelta).toBe(0);
    expect(info.description).toBe("Vence hoje");
  });

  it("treats a date inside the window as DUE_SOON", () => {
    const info = getCalibrationStatus("2026-06-10T12:00:00Z", NOW);
    expect(info.status).toBe("DUE_SOON");
    expect(info.description).toBe("Vence em 11 dias");
  });

  it("uses the inclusive DUE_SOON boundary", () => {
    const boundary = new Date(NOW);
    boundary.setDate(boundary.getDate() + DUE_SOON_DAYS);
    expect(getCalibrationStatus(boundary, NOW).status).toBe("DUE_SOON");

    const justAfter = new Date(NOW);
    justAfter.setDate(justAfter.getDate() + DUE_SOON_DAYS + 1);
    expect(getCalibrationStatus(justAfter, NOW).status).toBe("SCHEDULED");
  });

  it("singularizes a one-day delta", () => {
    expect(getCalibrationStatus("2026-05-29T12:00:00Z", NOW).description).toBe(
      "Vencida há 1 dia",
    );
  });
});

describe("getInstrumentStatus", () => {
  it("gives IN_LAB precedence over an overdue date", () => {
    const info = getInstrumentStatus(
      { nextCalibrationDate: "2026-05-27T12:00:00Z", inLab: true },
      NOW,
    );
    expect(info.status).toBe("IN_LAB");
    expect(info.tone).toBe("info");
    expect(info.label).toBe("No laboratório");
    expect(info.daysDelta).toBeNull();
    expect(info.description).toBe("Em atendimento no laboratório");
  });

  it("falls back to the date-derived status when not in lab", () => {
    const info = getInstrumentStatus(
      { nextCalibrationDate: "2026-05-27T12:00:00Z", inLab: false },
      NOW,
    );
    expect(info.status).toBe("OVERDUE");
    expect(info.description).toBe("Vencida há 3 dias");

    const unscheduled = getInstrumentStatus({ nextCalibrationDate: null }, NOW);
    expect(unscheduled.status).toBe("UNSCHEDULED");
  });
});

describe("calibration filters", () => {
  it("recognizes valid filter values", () => {
    expect(isCalibrationFilter("overdue")).toBe(true);
    expect(isCalibrationFilter("due_soon")).toBe(true);
    expect(isCalibrationFilter("in_lab")).toBe(true);
    expect(isCalibrationFilter("nonsense")).toBe(false);
    expect(isCalibrationFilter(42)).toBe(false);
  });

  it("maps filters to statuses", () => {
    expect(calibrationFilterToStatus("overdue")).toBe("OVERDUE");
    expect(calibrationFilterToStatus("unscheduled")).toBe("UNSCHEDULED");
    expect(calibrationFilterToStatus("in_lab")).toBe("IN_LAB");
  });
});
