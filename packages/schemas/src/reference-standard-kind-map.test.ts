import { describe, expect, it } from "vitest";
import { canonicalUnitFor } from "@calibra-facil/shared/units";

import { ReferenceStandardKindSchema } from "./index";
import {
  REFERENCE_STANDARD_QUANTITY_KINDS,
  quantityKindForReferenceStandardKind,
} from "./reference-standard-kind-map";

describe("reference-standard-kind ↔ quantity-kind adapter", () => {
  it("maps every ReferenceStandardKind (totality)", () => {
    for (const kind of ReferenceStandardKindSchema.options) {
      expect(REFERENCE_STANDARD_QUANTITY_KINDS).toHaveProperty(kind);
    }
  });

  it("every mapped quantity kind is a real unit kind", () => {
    for (const kind of ReferenceStandardKindSchema.options) {
      for (const quantity of quantityKindForReferenceStandardKind(kind)) {
        // canonicalUnitFor only returns a unit for a known QuantityKind.
        expect(canonicalUnitFor(quantity)).toBeTruthy();
      }
    }
  });

  it("splits electrical into volt/ampere/ohm, folds rpm into frequency", () => {
    expect(quantityKindForReferenceStandardKind("electrical")).toEqual([
      "voltage",
      "current",
      "resistance",
    ]);
    expect(quantityKindForReferenceStandardKind("rpm")).toEqual(["frequency"]);
    expect(quantityKindForReferenceStandardKind("force_torque")).toEqual([
      "force",
      "torque",
    ]);
  });

  it("generic kinds carry no fixed dimension", () => {
    expect(quantityKindForReferenceStandardKind("generic_scalar")).toEqual([]);
    expect(
      quantityKindForReferenceStandardKind("generic_multi_channel"),
    ).toEqual([]);
  });
});
