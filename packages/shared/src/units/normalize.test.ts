import { describe, expect, it } from "vitest";

import {
  type MethodInputFieldLike,
  type SpecificationFieldLike,
  denormalizeSpecificationsForDisplay,
  denormalizeMethodDataForDisplay,
  dominantKindForAssetType,
  normalizeMethodDataForStorage,
  normalizeRangeSpecsForStorage,
  normalizeSpecificationsForStorage,
  resolveDisplayUnit,
} from "./index";
import {
  normalizeAssetSpecificationsForStorage,
  denormalizeAssetSpecificationsForDisplay,
} from "../mass-units";

// A termômetro-digital + humidity fixture (NOT seeded in production) proving the
// kind-aware path: temperature fields convert affine, %RH stays untouched.
const thermoDefinition: SpecificationFieldLike[] = [
  { key: "faixaMax", type: "number", unit: "°C" },
  { key: "umidadeMax", type: "number", unit: "%RH" },
  { key: "faixas", type: "weighing_ranges", unit: "°C" },
];

describe("kind-aware specification normalization (°F base)", () => {
  it("affine-converts temperature, leaves humidity untouched", () => {
    const stored = normalizeSpecificationsForStorage(
      { faixaMax: 212, umidadeMax: 80 },
      thermoDefinition,
      "°F",
    );

    // 212 °F -> 100 °C (canonical), humidity carried verbatim.
    expect(stored.specifications?.faixaMax).toBeCloseTo(100, 9);
    expect(stored.specifications?.umidadeMax).toBe(80);
    expect(
      stored.conversions.some((c) => c.fieldPath === "umidadeMax"),
    ).toBe(false);

    const back = denormalizeSpecificationsForDisplay(
      stored.specifications,
      thermoDefinition,
      "°F",
    );
    expect(back?.faixaMax).toBeCloseTo(212, 9);
    expect(back?.umidadeMax).toBe(80);
  });
});

describe("range specs: bounds absolute, resolution delta (°F base)", () => {
  it("converts bounds affine and resolution factor-only", () => {
    const stored = normalizeRangeSpecsForStorage(
      [{ label: "faixa", min: 32, max: 212, resolution: 0.1 }],
      "°F",
    );
    const range = Array.isArray(stored.value) ? stored.value[0] : null;
    expect(range).toBeTruthy();
    // bounds: 32 °F -> 0 °C, 212 °F -> 100 °C
    expect(range.min).toBeCloseTo(0, 9);
    expect(range.max).toBeCloseTo(100, 9);
    // resolution is a width: 0.1 °F -> 0.0555.. °C (delta, no offset)
    expect(range.resolution).toBeCloseTo((0.1 * 5) / 9, 9);
    expect(range.rangeUnit).toBe("°C");
    expect(range.resolutionUnit).toBe("°C");
  });
});

describe("method data normalization", () => {
  const fields: MethodInputFieldLike[] = [
    {
      key: "leituras",
      type: "table",
      columns: [
        { key: "indicacao", type: "number", unit: "°C" },
        { key: "umidade", type: "number", unit: "%RH" },
      ],
    },
  ];

  it("converts same-kind columns, leaves other-kind columns", () => {
    const stored = normalizeMethodDataForStorage(
      { leituras: [{ indicacao: 212, umidade: 55 }] },
      fields,
      "°F",
    );
    const rows = stored.data?.leituras;
    const row = Array.isArray(rows) ? rows[0] : null;
    expect(row.indicacao).toBeCloseTo(100, 9);
    expect(row.umidade).toBe(55);

    const back = denormalizeMethodDataForDisplay(stored.data, fields, "°F");
    const backRows = back?.leituras;
    const backRow = Array.isArray(backRows) ? backRows[0] : null;
    expect(backRow.indicacao).toBeCloseTo(212, 9);
    expect(backRow.umidade).toBe(55);
  });
});

describe("mass golden-value regression", () => {
  const massDefinition: SpecificationFieldLike[] = [
    { key: "capacidade", type: "number", unit: "g" },
  ];

  it("stores kg specs as grams and round-trips", () => {
    const stored = normalizeSpecificationsForStorage(
      { capacidade: 1.5 },
      massDefinition,
      "kg",
    );
    expect(stored.specifications?.capacidade).toBe(1500);

    const back = denormalizeSpecificationsForDisplay(
      stored.specifications,
      massDefinition,
      "kg",
    );
    expect(back?.capacidade).toBe(1.5);
  });

  it("mass wrappers byte-match the generic helpers", () => {
    const input = { capacidade: 2.5 };
    const wrapper = normalizeAssetSpecificationsForStorage(
      input,
      massDefinition,
      "kg",
    );
    const generic = normalizeSpecificationsForStorage(
      input,
      massDefinition,
      "kg",
    );
    expect(wrapper).toEqual(generic);

    expect(
      denormalizeAssetSpecificationsForDisplay(
        wrapper.specifications,
        massDefinition,
        "kg",
      ),
    ).toEqual(
      denormalizeSpecificationsForDisplay(
        generic.specifications,
        massDefinition,
        "kg",
      ),
    );
  });
});

describe("helpers", () => {
  it("resolveDisplayUnit returns base only for same kind", () => {
    expect(resolveDisplayUnit("kg", "g")).toBe("kg");
    expect(resolveDisplayUnit("kg", "mm")).toBe("mm");
    expect(resolveDisplayUnit("kg", null)).toBeUndefined();
    expect(resolveDisplayUnit(null, "g")).toBe("g");
  });

  it("dominantKindForAssetType picks the most common kind", () => {
    expect(dominantKindForAssetType(thermoDefinition)).toBe("temperature");
    expect(
      dominantKindForAssetType([{ key: "x", type: "weighing_ranges" }]),
    ).toBe("mass");
    expect(
      dominantKindForAssetType([{ key: "x", type: "text" }]),
    ).toBeNull();
  });
});
