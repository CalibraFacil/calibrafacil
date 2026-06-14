import { describe, expect, it } from "vitest";

import {
  buildScalarResults,
  describeDueDate,
  summarizeConformity,
  type CertificateVerdict,
} from "./verdict";

const NOW = new Date("2026-06-14T12:00:00.000Z").getTime();

describe("describeDueDate", () => {
  it("returns null when there is no due date", () => {
    expect(describeDueDate(null, NOW)).toBeNull();
    expect(describeDueDate("not-a-date", NOW)).toBeNull();
  });

  it("flags an overdue certificate as critical", () => {
    expect(describeDueDate("2026-05-01T00:00:00.000Z", NOW)).toEqual({
      tone: "critical",
      hint: "vencido",
    });
  });

  it("warns when the next calibration is within 30 days", () => {
    const result = describeDueDate("2026-07-01T12:00:00.000Z", NOW);
    expect(result?.tone).toBe("warning");
    expect(result?.hint).toMatch(/^vence em \d+ d$/);
  });

  it("marks a far-future due date as vigente", () => {
    expect(describeDueDate("2027-06-14T12:00:00.000Z", NOW)).toEqual({
      tone: "neutral",
      hint: "vigente",
    });
  });
});

function verdict(over: Partial<CertificateVerdict> = {}): CertificateVerdict {
  return {
    conformity: "CONFORMING",
    pointsTotal: 4,
    pointsWithin: 4,
    expandedUncertainty: "±0.1 g",
    ...over,
  };
}

describe("summarizeConformity", () => {
  it("labels a conforming verdict with the points hint", () => {
    expect(summarizeConformity(verdict())).toEqual({
      tone: "ok",
      label: "Conforme",
      pointsHint: "4/4 pontos",
    });
  });

  it("downgrades a non-conforming verdict to a warning tone", () => {
    expect(
      summarizeConformity(
        verdict({ conformity: "NON_CONFORMING", pointsWithin: 3 }),
      ),
    ).toEqual({
      tone: "warning",
      label: "Não conforme",
      pointsHint: "3/4 pontos",
    });
  });

  it("falls back to a neutral 'Aprovado' when no tolerance is declared", () => {
    expect(
      summarizeConformity({
        conformity: "UNKNOWN",
        pointsTotal: 0,
        pointsWithin: 0,
        expandedUncertainty: null,
      }),
    ).toEqual({ tone: "neutral", label: "Aprovado", pointsHint: undefined });
    expect(summarizeConformity(null)).toEqual({
      tone: "neutral",
      label: "Aprovado",
      pointsHint: undefined,
    });
  });
});

describe("buildScalarResults", () => {
  const methodSnapshot = {
    name: "Massa",
    version: "1.0",
    formulas: [
      { outputKey: "erro_maximo", label: "Erro máximo", unit: "g" },
      { outputKey: "tendencia", label: "Tendência", unit: null },
      // Per-point / headline outputs are excluded from the scalar list.
      { outputKey: "margem_conformidade_apos", label: "Margem", unit: "g" },
      { outputKey: "incerteza_expandida_apos", label: "U", unit: "g" },
    ],
  };

  it("renders scalar outputs with their unit and skips margins/uncertainty", () => {
    const rows = buildScalarResults(methodSnapshot, {
      erro_maximo: 0.05,
      tendencia: -0.01,
      margem_conformidade_apos: [0.4, 1.2],
      incerteza_expandida_apos: [0.08],
    });

    expect(rows).toEqual([
      { key: "erro_maximo", label: "Erro máximo", value: "0.05 g" },
      { key: "tendencia", label: "Tendência", value: "-0.01" },
    ]);
  });

  it("drops non-numeric and missing results", () => {
    expect(buildScalarResults(methodSnapshot, { erro_maximo: "n/a" })).toEqual(
      [],
    );
    expect(buildScalarResults(null, null)).toEqual([]);
  });
});
