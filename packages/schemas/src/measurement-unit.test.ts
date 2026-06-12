import { describe, expect, it } from "vitest";
import { MEASUREMENT_UNITS } from "@calibra-facil/shared/units";

import {
  CreateAssetSchema,
  MeasurementUnitSchema,
  WeighingRangeResolverConfigSchema,
} from "./index";

describe("MeasurementUnitSchema", () => {
  it("stays in sync with the shared unit registry", () => {
    expect([...MeasurementUnitSchema.options].sort()).toEqual(
      [...MEASUREMENT_UNITS].sort(),
    );
  });

  it("accepts a non-mass base unit on a new asset", () => {
    expect(
      CreateAssetSchema.safeParse({
        customerId: 1,
        assetTypeId: 1,
        name: "Termômetro digital",
        serialNumber: "SN-1",
        tag: "T-1",
        baseMeasurementUnit: "°C",
      }).success,
    ).toBe(true);
  });

  it("accepts a non-mass resolver pointUnit and the legacy mass one", () => {
    expect(
      WeighingRangeResolverConfigSchema.safeParse({ pointUnit: "°C" }).success,
    ).toBe(true);
    expect(
      WeighingRangeResolverConfigSchema.safeParse({ pointUnit: "g" }).success,
    ).toBe(true);
  });
});
