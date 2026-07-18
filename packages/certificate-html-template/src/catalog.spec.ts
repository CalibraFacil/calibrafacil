import { describe, expect, it } from "vitest";

import {
  MissingRequiredPlaceholderError,
  PLACEHOLDER_CATALOG,
  UnknownPlaceholderError,
  findUnknownPlaceholderPaths,
  getPlaceholderEntry,
  resolvePlaceholder,
} from "./catalog.js";
import { BANNED_PLACEHOLDER_SEGMENTS, parseCertificateDocument } from "./document-schema.js";
import { sampleCertificateInputData } from "./fixtures/sample-input-data.js";
import { completeWysiwygDocument } from "./starter-document.js";

describe("PLACEHOLDER_CATALOG", () => {
  it("has unique paths and pt-BR labels", () => {
    const paths = PLACEHOLDER_CATALOG.map((entry) => entry.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const catalogEntry of PLACEHOLDER_CATALOG) {
      expect(catalogEntry.label.length, catalogEntry.path).toBeGreaterThan(2);
      expect(catalogEntry.source.length, catalogEntry.path).toBeGreaterThan(2);
    }
  });

  it("contains no banned path (§7.8.4.3) — defense in depth", () => {
    for (const catalogEntry of PLACEHOLDER_CATALOG) {
      for (const banned of BANNED_PLACEHOLDER_SEGMENTS) {
        expect(catalogEntry.path.split("."), catalogEntry.path).not.toContain(banned);
      }
    }
  });

  it("EVERY entry resolves against the sample input data, or is explicitly optional", () => {
    for (const catalogEntry of PLACEHOLDER_CATALOG) {
      if (catalogEntry.required) {
        const resolved = resolvePlaceholder(sampleCertificateInputData, catalogEntry.path);
        expect(resolved, catalogEntry.path).not.toBe("");
      } else {
        // optional entries must still resolve without throwing
        expect(
          () => resolvePlaceholder(sampleCertificateInputData, catalogEntry.path),
          catalogEntry.path,
        ).not.toThrow();
      }
    }
  });

  it("resolves representative values with correct formatting", () => {
    const resolve = (path: string) => resolvePlaceholder(sampleCertificateInputData, path);
    expect(resolve("certificate.number")).toBe("CAL-2026-0042");
    expect(resolve("certificate.issuedAt")).toBe("01/07/2026");
    expect(resolve("customer.taxId")).toBe("98.765.432/0001-10");
    expect(resolve("lab.cnpj")).toBe("12.345.678/0001-90");
    expect(resolve("uncertainty.expanded.value")).toBe("0,0004");
    expect(resolve("uncertainty.coverageFactor.value")).toBe("2");
    expect(resolve("accreditation.accredited")).toBe("Sim");
    expect(resolve("environment.withinLimits")).toBe("Sim");
    expect(resolve("method.version")).toBe("3");
    expect(resolve("serviceOrder.inmetroRepairMarkNumber")).toBe("MR-2026-0099");
  });

  it("optional missing values resolve to empty string, never a fallback", () => {
    expect(resolvePlaceholder(sampleCertificateInputData, "certificate.amendmentReason")).toBe("");
    expect(resolvePlaceholder(sampleCertificateInputData, "certificate.name")).toBe("");
  });

  it("unknown path throws a typed error", () => {
    expect(() => resolvePlaceholder(sampleCertificateInputData, "asset.doesNotExist")).toThrow(
      UnknownPlaceholderError,
    );
  });

  it("required path missing from data throws MissingRequiredPlaceholderError (fail-loud)", () => {
    const data = JSON.parse(JSON.stringify(sampleCertificateInputData));
    delete data.customer.name;
    expect(() => resolvePlaceholder(data, "customer.name")).toThrow(
      MissingRequiredPlaceholderError,
    );
    try {
      resolvePlaceholder(data, "customer.name");
    } catch (error) {
      expect(error instanceof MissingRequiredPlaceholderError && error.path).toBe(
        "customer.name",
      );
    }
  });

  it("findUnknownPlaceholderPaths flags only unknown paths in a document", () => {
    const starter = completeWysiwygDocument();
    const document = parseCertificateDocument({
      ...JSON.parse(JSON.stringify(starter)),
      content: [
        // Insert the paragraph in the BODY, before the trailing footer band.
        ...starter.content.slice(0, -1),
        {
          type: "paragraph",
          content: [
            { type: "placeholder", attrs: { path: "customer.name" } },
            { type: "placeholder", attrs: { path: "made.up.path" } },
          ],
        },
        ...starter.content.slice(-1),
      ],
    });
    expect(findUnknownPlaceholderPaths(document)).toEqual(["made.up.path"]);
  });

  it("exposes entries for the editor (label/group/source present)", () => {
    const catalogEntry = getPlaceholderEntry("uncertainty.expanded.value");
    expect(catalogEntry?.group).toBe("Incerteza");
    expect(catalogEntry?.source).toContain("results");
  });

  it("catalog is instrument-agnostic: weighing-flavored entries are marked", () => {
    expect(getPlaceholderEntry("asset.capacityText")?.instrumentSpecific).toBe(true);
    expect(getPlaceholderEntry("asset.divisionText")?.instrumentSpecific).toBe(true);
    expect(getPlaceholderEntry("asset.tag")?.instrumentSpecific).toBeUndefined();
  });
});
