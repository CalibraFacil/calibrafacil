import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

import {
  auditMethodRow,
  buildMethodDimensionAuditReport,
  formatMethodDimensionAuditReport,
} from "./audit-method-dimensions.mjs";

// REQ-DIM-203: the audit script SHALL report every stored method with
// OK/diagnostics (grouped by status) and perform ZERO writes.
//
// The .mjs runner issues a single read-only SELECT and delegates to the pure
// core exercised here. "Seeds 2 methods (one bad, one good)" is modelled as two
// stored-shape method rows; the core has NO database handle, so it structurally
// cannot write — and the runner is statically asserted to contain no write SQL.

const BAD_METHOD = {
  id: 6,
  name: "Balança Exemplo (incoerente)",
  organizationId: "org-exemplo",
  status: "PUBLISHED",
  dataFields: [
    { key: "massa", type: "number", unit: "g" },
    { key: "tensao", type: "number", unit: "V" },
  ],
  variableBindings: [],
  formulas: [{ outputKey: "erro", expression: "massa + tensao", unit: "g" }],
  measurementModels: [],
};

const GOOD_METHOD = {
  id: 3,
  name: "Umidade Magnus (coerente)",
  organizationId: "org-demo",
  status: "DRAFT",
  dataFields: [{ key: "t", type: "number", unit: "°C" }],
  variableBindings: [],
  formulas: [
    {
      outputKey: "es",
      expression: "6.112 * exp(17.62 * t / (243.12 + t))",
      unit: "hPa",
    },
  ],
  measurementModels: [],
};

describe("REQ-DIM-203: audit-method-dimensions core", () => {
  test("reports OK vs diagnostics per method, grouped by status", () => {
    const report = buildMethodDimensionAuditReport([BAD_METHOD, GOOD_METHOD]);

    expect(report.total).toBe(2);
    expect(report.okCount).toBe(1);
    expect(report.failCount).toBe(1);

    // Grouped by status.
    expect(Object.keys(report.byStatus).sort()).toEqual(["DRAFT", "PUBLISHED"]);
    expect(report.byStatus.PUBLISHED).toHaveLength(1);
    expect(report.byStatus.DRAFT).toHaveLength(1);

    const bad = report.results.find((r) => r.id === 6);
    expect(bad?.ok).toBe(false);
    expect(bad?.diagnostics[0]?.formulaId).toBe("erro");
    // The report carries the formatted dimensions of the mismatch.
    expect(bad?.diagnostics[0]?.message).toContain("M·L^2·T^-3·I^-1");

    const good = report.results.find((r) => r.id === 3);
    expect(good?.ok).toBe(true);
    expect(good?.diagnostics).toEqual([]);
  });

  test("auditMethodRow carries id / name / org / status through", () => {
    const verdict = auditMethodRow(GOOD_METHOD);
    expect(verdict).toMatchObject({
      id: 3,
      name: "Umidade Magnus (coerente)",
      organizationId: "org-demo",
      status: "DRAFT",
      ok: true,
    });
  });

  test("formatted report lists both the OK and the FAIL method", () => {
    const text = formatMethodDimensionAuditReport(
      buildMethodDimensionAuditReport([BAD_METHOD, GOOD_METHOD]),
    );
    expect(text).toContain('[FAIL] #6 "Balança Exemplo (incoerente)"');
    expect(text).toContain('[OK]   #3 "Umidade Magnus (coerente)"');
  });

  test("is pure — does not mutate the input rows", () => {
    const snapshot = JSON.stringify([BAD_METHOD, GOOD_METHOD]);
    buildMethodDimensionAuditReport([BAD_METHOD, GOOD_METHOD]);
    expect(JSON.stringify([BAD_METHOD, GOOD_METHOD])).toBe(snapshot);
  });

  test("ZERO writes: the runner contains no write SQL (read-only SELECT only)", () => {
    const source = readFileSync(
      new URL("./audit-method-dimensions.mjs", import.meta.url),
    ).toString();
    // Strip comments so prose like "no insert/update/delete" is not counted.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");

    expect(code).toMatch(/select/i); // it DOES read
    expect(code).not.toMatch(/\binsert\s+into\b/i);
    expect(code).not.toMatch(/\bupdate\s+\w+\s+set\b/i);
    expect(code).not.toMatch(/\bdelete\s+from\b/i);
    expect(code).not.toMatch(/\btruncate\b/i);
    expect(code).not.toMatch(/\bdrop\s+(table|database)\b/i);
    expect(code).not.toMatch(/\balter\s+table\b/i);
  });
});
