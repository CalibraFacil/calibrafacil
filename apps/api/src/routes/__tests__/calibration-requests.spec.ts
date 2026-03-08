import { describe, expect, it } from "vitest";
import {
  ConvertCalibrationRequestSchema,
  CreateCalibrationRequestSchema,
} from "@calibra-facil/schemas";

describe("Calibration request schemas", () => {
  it("rejects duplicate asset ids in a portal request", () => {
    const result = CreateCalibrationRequestSchema.safeParse({
      assetIds: [1, 1],
      observations: "Urgente",
    });

    expect(result.success).toBe(false);
  });

  it("accepts a valid multi-asset request", () => {
    const result = CreateCalibrationRequestSchema.safeParse({
      assetIds: [1, 2, 3],
      observations: "Validar antes do embarque",
      requestedDueDate: "2026-03-31T15:00:00.000Z",
    });

    expect(result.success).toBe(true);
  });

  it("rejects duplicate conversion mappings for the same request item", () => {
    const result = ConvertCalibrationRequestSchema.safeParse({
      items: [
        { itemId: 10, serviceId: 5 },
        { itemId: 10, serviceId: 6 },
      ],
    });

    expect(result.success).toBe(false);
  });
});
