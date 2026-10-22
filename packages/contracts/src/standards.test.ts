import { describe, expect, it } from "vitest";
import type { z } from "zod";

import {
  deleteEnvironmentalLimitResponseSchema,
  effectiveEnvironmentalLimitsResponseSchema,
  environmentalLimitsResponseSchema,
  saveEnvironmentalLimitResponseSchema,
} from "./environmental-limits";
import {
  massCompositionProfilesResponseSchema,
  standardCertificateDocumentDownloadResponseSchema,
  standardCertificateDocumentUploadResponseSchema,
  standardRecordSchema,
  standardSchema,
  standardsListResponseSchema,
} from "./standards";
import * as fixtures from "./standards.fixtures";

/**
 * Every builder of the standards / environmental-limits fixtures with the
 * schema its payload must satisfy. A builder without a row here fails the
 * "no unregistered fixture" test.
 */
const registry = {
  buildStandardCertificateDocument: [
    fixtures.buildStandardCertificateDocument,
    standardSchema.shape.certificateDocument.unwrap().unwrap(),
  ],
  buildStandardRecord: [fixtures.buildStandardRecord, standardRecordSchema],
  buildStandard: [fixtures.buildStandard, standardSchema],
  buildStandardsList: [
    fixtures.buildStandardsList,
    standardsListResponseSchema,
  ],
  buildStandardCertificateDocumentUploadResponse: [
    fixtures.buildStandardCertificateDocumentUploadResponse,
    standardCertificateDocumentUploadResponseSchema,
  ],
  buildStandardCertificateDocumentDownloadResponse: [
    fixtures.buildStandardCertificateDocumentDownloadResponse,
    standardCertificateDocumentDownloadResponseSchema,
  ],
  buildMassCompositionProfile: [
    fixtures.buildMassCompositionProfile,
    massCompositionProfilesResponseSchema.shape.data.element,
  ],
  buildMassCompositionProfilesResponse: [
    fixtures.buildMassCompositionProfilesResponse,
    massCompositionProfilesResponseSchema,
  ],
  buildEnvironmentalLimitRow: [
    fixtures.buildEnvironmentalLimitRow,
    saveEnvironmentalLimitResponseSchema.shape.data,
  ],
  buildEnvironmentalLimit: [
    fixtures.buildEnvironmentalLimit,
    environmentalLimitsResponseSchema.shape.limits.element,
  ],
  buildEnvironmentalLimitsResponse: [
    fixtures.buildEnvironmentalLimitsResponse,
    environmentalLimitsResponseSchema,
  ],
  buildEffectiveEnvironmentalLimits: [
    fixtures.buildEffectiveEnvironmentalLimits,
    effectiveEnvironmentalLimitsResponseSchema,
  ],
  buildSaveEnvironmentalLimitResponse: [
    fixtures.buildSaveEnvironmentalLimitResponse,
    saveEnvironmentalLimitResponseSchema,
  ],
  buildDeleteEnvironmentalLimitResponse: [
    fixtures.buildDeleteEnvironmentalLimitResponse,
    deleteEnvironmentalLimitResponseSchema,
  ],
} satisfies Record<string, readonly [() => unknown, z.ZodType]>;

describe("standards and environmental-limits contracts", () => {
  it("REQ-TC-1: every exported fixture builder is registered with its schema", () => {
    expect(Object.keys(fixtures).sort()).toEqual(Object.keys(registry).sort());
  });

  for (const [name, [build, schema]] of Object.entries(registry)) {
    it(`REQ-TC-1: ${name}() parses with its response schema`, () => {
      const result = schema.safeParse(build());
      expect(
        result.success ? [] : result.error.issues,
        `${name} drifted from its schema`,
      ).toEqual([]);
    });
  }

  it("REQ-TC-1: a standard missing its validity verdict is rejected", () => {
    const withoutVerdict = Object.fromEntries(
      Object.entries(fixtures.buildStandard()).filter(
        ([key]) => key !== "isExpired",
      ),
    );
    expect(standardSchema.safeParse(withoutVerdict).success).toBe(false);
  });

  it("REQ-TC-1: a distribution outside the shared vocabulary is rejected", () => {
    expect(
      standardSchema.safeParse({
        ...fixtures.buildStandard(),
        distribution: "triangular",
      }).success,
    ).toBe(false);
  });

  it("REQ-TC-1: the effective-limits source is one of the two documented values (or null)", () => {
    expect(
      effectiveEnvironmentalLimitsResponseSchema.safeParse({
        limits: null,
        source: null,
      }).success,
    ).toBe(true);
    expect(
      effectiveEnvironmentalLimitsResponseSchema.safeParse({
        limits: fixtures.buildEnvironmentalLimitRow(),
        source: "local",
      }).success,
    ).toBe(false);
  });
});
