import { describe, expect, it } from "vitest";

import { buildPortalCertificateVerdict } from "../portal-certificate-verdict";

const UNCERTAINTY_FORMULAS = [
  { outputKey: "incerteza_expandida_apos", unit: "g" },
  { outputKey: "incerteza_expandida_antes", unit: "g" },
];

describe("buildPortalCertificateVerdict", () => {
  it("reports CONFORMING when every post-adjustment margin is within tolerance", () => {
    const verdict = buildPortalCertificateVerdict({
      results: { margem_conformidade_apos: [0.4, 0, 1.2] },
      formulas: [],
    });

    expect(verdict.conformity).toBe("CONFORMING");
    expect(verdict.pointsTotal).toBe(3);
    expect(verdict.pointsWithin).toBe(3);
  });

  it("reports NON_CONFORMING when any margin is negative", () => {
    const verdict = buildPortalCertificateVerdict({
      results: { margem_conformidade_apos: [0.4, -0.1, 1.2] },
      formulas: [],
    });

    expect(verdict.conformity).toBe("NON_CONFORMING");
    expect(verdict.pointsTotal).toBe(3);
    expect(verdict.pointsWithin).toBe(2);
  });

  it("reports UNKNOWN when the method declares no tolerance margins", () => {
    const verdict = buildPortalCertificateVerdict({
      results: { erro: 0.01 },
      formulas: [],
    });

    expect(verdict.conformity).toBe("UNKNOWN");
    expect(verdict.pointsTotal).toBe(0);
    expect(verdict.pointsWithin).toBe(0);
  });

  it("formats the max post-adjustment expanded uncertainty with the formula unit", () => {
    const verdict = buildPortalCertificateVerdict({
      results: { incerteza_expandida_apos: [0.08, 0.12, 0.05] },
      formulas: UNCERTAINTY_FORMULAS,
    });

    expect(verdict.expandedUncertainty).toBe("±0.12 g");
  });

  it("falls back to the pre-adjustment uncertainty when post is absent", () => {
    const verdict = buildPortalCertificateVerdict({
      results: { incerteza_expandida_antes: 0.2 },
      formulas: UNCERTAINTY_FORMULAS,
    });

    expect(verdict.expandedUncertainty).toBe("±0.2 g");
  });

  it("tolerates comma decimals and null results", () => {
    expect(
      buildPortalCertificateVerdict({ results: null, formulas: null }),
    ).toEqual({
      conformity: "UNKNOWN",
      pointsTotal: 0,
      pointsWithin: 0,
      expandedUncertainty: null,
    });

    const verdict = buildPortalCertificateVerdict({
      results: { margem_conformidade_apos: ["0,5", "-0,2"] },
      formulas: [],
    });
    expect(verdict.pointsTotal).toBe(2);
    expect(verdict.pointsWithin).toBe(1);
  });
});
