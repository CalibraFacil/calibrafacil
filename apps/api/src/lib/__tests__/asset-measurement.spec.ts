import { describe, expect, it } from "vitest";
import {
  denormalizeMethodDataForDisplay,
  normalizeMethodDataForStorage,
} from "@calibra-facil/shared";
import {
  denormalizeAssetSpecificationsForResponse,
  normalizeAssetSpecificationsFromInput,
  resolveAssetBaseMeasurementUnit,
} from "../asset-measurement";

const balanceDefinition = [
  {
    key: "capacity",
    label: "Capacidade",
    type: "number" as const,
    unit: "g",
  },
  {
    key: "resolution",
    label: "Resolução",
    type: "number" as const,
    unit: "g",
  },
  {
    key: "weighingRanges",
    label: "Faixas",
    type: "weighing_ranges" as const,
  },
];

describe("asset measurement helpers", () => {
  it("requires a base unit for mass-based assets", () => {
    expect(
      resolveAssetBaseMeasurementUnit(
        {
          definition: balanceDefinition,
          slug: "balanca-digital",
          name: "Balança digital",
        },
        null,
      ),
    ).toEqual({
      ok: false,
      error:
        "Selecione a unidade base do instrumento (kg, g ou mg) para ativos de massa",
    });
  });

  it("normalizes mass specifications to canonical grams and restores display units", () => {
    const normalized = normalizeAssetSpecificationsFromInput({
      specifications: {
        capacity: 2,
        resolution: 0.001,
        weighingRanges: [
          {
            label: "0 a 2 kg",
            min: 0,
            max: 2,
            rangeUnit: "kg",
            resolution: 0.001,
            resolutionUnit: "kg",
          },
        ],
      },
      definition: balanceDefinition,
      baseMeasurementUnit: "kg",
    });

    expect(normalized.specifications).toEqual({
      capacity: 2000,
      resolution: 1,
      weighingRanges: [
        {
          label: "0 a 2 kg",
          min: 0,
          max: 2000,
          rangeUnit: "g",
          resolution: 1,
          resolutionUnit: "g",
        },
      ],
    });
    expect(normalized.conversions).toHaveLength(5);
    if (!normalized.specifications) {
      throw new Error("Expected normalized specifications.");
    }

    expect(
      denormalizeAssetSpecificationsForResponse({
        specifications: normalized.specifications,
        definition: balanceDefinition,
        baseMeasurementUnit: "kg",
      }),
    ).toEqual({
      capacity: 2,
      resolution: 0.001,
      weighingRanges: [
        {
          label: "0 a 2 kg",
          min: 0,
          max: 2,
          rangeUnit: "kg",
          resolution: 0.001,
          resolutionUnit: "kg",
        },
      ],
    });
  });

  it("normalizes method input data to canonical grams and denormalizes for display", () => {
    const fields = [
      {
        key: "tolerancia_maxima",
        type: "number" as const,
        unit: "g",
      },
      {
        key: "pontos",
        type: "table" as const,
        columns: [
          { key: "valor_padrao", type: "number" as const, unit: "g" },
          { key: "indicacao", type: "number" as const, unit: "g" },
        ],
      },
    ];

    const normalized = normalizeMethodDataForStorage(
      {
        tolerancia_maxima: 0.5,
        pontos: [{ valor_padrao: 2, indicacao: 2.001 }],
      },
      fields,
      "kg",
    );

    expect(normalized.data).toEqual({
      tolerancia_maxima: 500,
      pontos: [{ valor_padrao: 2000, indicacao: 2001 }],
    });
    if (!normalized.data) {
      throw new Error("Expected normalized method data.");
    }

    expect(
      denormalizeMethodDataForDisplay(
        normalized.data,
        fields,
        "kg",
      ),
    ).toEqual({
      tolerancia_maxima: 0.5,
      pontos: [{ valor_padrao: 2, indicacao: 2.001 }],
    });
  });
});
