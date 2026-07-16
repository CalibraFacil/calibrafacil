import { describe, expect, it } from "vitest";
import { CANONICAL_BY_KIND } from "@calibra-facil/shared/units";

import { AccreditedScopeLineSchema, QuantityKindSchema } from "./index";

describe("QuantityKindSchema", () => {
  it("stays in sync with the shared unit registry kinds", () => {
    expect(QuantityKindSchema.options.toSorted()).toEqual(
      Object.keys(CANONICAL_BY_KIND).toSorted(),
    );
  });
});

describe("AccreditedScopeLineSchema", () => {
  const base = {
    quantityKind: "mass",
    rangeMin: 0,
    rangeMax: 500,
    rangeUnit: "g",
    cmcType: "fixed",
    cmcA: 0.01,
    cmcUnit: "g",
  };

  it("accepts a fixed CMC line and leaves an omitted k absent (preserve-on-update semantics)", () => {
    const parsed = AccreditedScopeLineSchema.parse(base);
    // No schema default: the API layer defaults k to 2 on create and
    // preserves the stored value on update when the field is omitted.
    expect(parsed.coverageFactor).toBeUndefined();
    expect(parsed.cmcType).toBe("fixed");
  });

  it("rejects an inverted range", () => {
    expect(
      AccreditedScopeLineSchema.safeParse({
        ...base,
        rangeMin: 500,
        rangeMax: 0,
      }).success,
    ).toBe(false);
  });

  it("requires cmcB for a linear CMC", () => {
    expect(
      AccreditedScopeLineSchema.safeParse({ ...base, cmcType: "linear" })
        .success,
    ).toBe(false);
    expect(
      AccreditedScopeLineSchema.safeParse({
        ...base,
        cmcType: "linear",
        cmcA: 0,
        cmcB: 0.0002,
      }).success,
    ).toBe(true);
  });

  it("rejects a zero fixed CMC", () => {
    expect(
      AccreditedScopeLineSchema.safeParse({ ...base, cmcA: 0 }).success,
    ).toBe(false);
  });
});
