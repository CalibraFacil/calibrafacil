import { describe, expect, it } from "vitest";
import {
  canPerformCalibrationAction,
  roleLabels,
  roles,
} from "@calibra-facil/auth/access";

describe("lab operator role", () => {
  it("can transcribe calibration work without review authority", () => {
    const operator = roles.operator;

    expect(operator.authorize({ calibration: ["create"] }).success).toBe(true);
    expect(
      operator.authorize({ calibration: ["assign_technician"] }).success,
    ).toBe(true);
    expect(operator.authorize({ calibration: ["execute"] }).success).toBe(true);
    expect(operator.authorize({ calibration: ["submit"] }).success).toBe(true);

    expect(operator.authorize({ calibration: ["approve"] }).success).toBe(
      false,
    );
    expect(operator.authorize({ calibration: ["reject"] }).success).toBe(false);
    expect(operator.authorize({ calibration: ["delete"] }).success).toBe(false);
  });

  it("participates in draft/rejected workflow entry but not deletion", () => {
    expect(canPerformCalibrationAction("operator", "DRAFT", "edit")).toBe(true);
    expect(canPerformCalibrationAction("operator", "DRAFT", "submit")).toBe(
      true,
    );
    expect(canPerformCalibrationAction("operator", "DRAFT", "delete")).toBe(
      false,
    );
    expect(canPerformCalibrationAction("operator", "REJECTED", "edit")).toBe(
      true,
    );
    expect(canPerformCalibrationAction("operator", "APPROVED", "edit")).toBe(
      false,
    );
  });

  it("has a UI label", () => {
    expect(roleLabels.operator).toBe("Operador");
  });
});
