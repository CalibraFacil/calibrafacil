import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const engineFile = resolve(here, "..", "certificate-release.ts");
const reconciliationFile = resolve(
  here,
  "..",
  "certificate-release-reconciliation.ts",
);

/**
 * Boundary invariant: the payment-aware certificate-release flow MUST NEVER
 * write to `calibration_job.status` or `issued_certificate_snapshot.status`.
 * Phase 2 slice 1 separates technical approval from commercial release; the
 * strategy explicitly requires that ERP payment status not be allowed to
 * mutate technical approval (see docs/plans/conta-azul-product-strategy.md
 * "Certificate Release Versus Payment Status").
 *
 * The cheapest enforcement that survives refactors is a source-level scan
 * for forbidden mutation patterns. Anything that tries to call
 * `db.update(calibrationJob)` or `db.update(issuedCertificateSnapshot)` from
 * inside the release engine fails this test, even before any test database
 * sees it.
 */

const FORBIDDEN_MUTATION_PATTERNS = [
  /\bdb\.update\s*\(\s*calibrationJob\b/,
  /\bdb\.update\s*\(\s*issuedCertificateSnapshot\b/,
  /\bdb\.insert\s*\(\s*issuedCertificateSnapshot\b/,
  /\bdb\.delete\s*\(\s*calibrationJob\b/,
  /\bdb\.delete\s*\(\s*issuedCertificateSnapshot\b/,
];

describe("certificate-release reconciliation boundary", () => {
  it("never writes calibration_job.status from the release engine", async () => {
    const source = await readFile(engineFile, "utf-8");
    for (const pattern of FORBIDDEN_MUTATION_PATTERNS) {
      expect(
        pattern.test(source),
        `engine source matched forbidden mutation pattern ${pattern.source}`,
      ).toBe(false);
    }
  });

  it("never writes calibration_job or issued_certificate_snapshot from the reconciliation hook", async () => {
    const source = await readFile(reconciliationFile, "utf-8");
    for (const pattern of FORBIDDEN_MUTATION_PATTERNS) {
      expect(
        pattern.test(source),
        `reconciliation source matched forbidden mutation pattern ${pattern.source}`,
      ).toBe(false);
    }
  });

  it("does not import issuedCertificateSnapshot from the schema in either file", async () => {
    const engine = await readFile(engineFile, "utf-8");
    const reconciliation = await readFile(reconciliationFile, "utf-8");
    // The engine + reconciliation can mention the table name in comments
    // (the invariant is documented there) but must not import the schema
    // binding it would need to mutate the table.
    const importLine = /from\s+["']@calibra-facil\/db\/schema["'][^\n]*issuedCertificateSnapshot/s;
    const importBlock =
      /import\s*\{[^}]*issuedCertificateSnapshot[^}]*\}\s*from\s*["']@calibra-facil\/db\/schema["']/s;
    expect(importLine.test(engine) || importBlock.test(engine)).toBe(false);
    expect(
      importLine.test(reconciliation) || importBlock.test(reconciliation),
    ).toBe(false);
  });
});
