import { describe, expect, it } from "vitest";
import { REFERENCE_STANDARD_MACHINE } from "./inventory";
import { CORRECTIVE_ACTION_MACHINE } from "./quality";

describe("CORRECTIVE_ACTION_MACHINE (Q61)", () => {
  it("an effective check readies the CAPA to close; an ineffective one returns it to implementation", () => {
    expect(
      CORRECTIVE_ACTION_MACHINE.targetsOf("IMPLEMENTATION", "verify"),
    ).toEqual(["VERIFICATION", "IMPLEMENTATION"]);
    expect(CORRECTIVE_ACTION_MACHINE.allowedFrom("close")).toEqual([
      "VERIFICATION",
    ]);
  });
});

describe("REFERENCE_STANDARD_MACHINE (Q60)", () => {
  it("an out-of-tolerance or sent standard returns to use only by renewal", () => {
    for (const from of ["OUT_OF_TOLERANCE", "SENT_FOR_CALIBRATION"]) {
      expect(
        REFERENCE_STANDARD_MACHINE.canTransition(from, "set_status", "ACTIVE"),
      ).toBe(false);
      expect(REFERENCE_STANDARD_MACHINE.canTransition(from, "renew")).toBe(
        true,
      );
    }
    expect(
      REFERENCE_STANDARD_MACHINE.canTransition(
        "INACTIVE",
        "set_status",
        "ACTIVE",
      ),
    ).toBe(true);
  });
});
