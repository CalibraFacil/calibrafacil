import { toRecord } from "@calibra-facil/shared/record";
import { describe, it, expect } from "vitest";
import type {
  MethodSnapshot,
  MethodInputField,
  AssetSnapshot,
  EnvironmentalLimitsSnapshot,
} from "@calibra-facil/db/schema";
import {
  decodeRouteIdentifier,
  stringFromUnknown,
  r2EnvFromUnknown,
  methodInputFieldsFromSnapshot,
  methodSnapshotDisplay,
  checkEnvironmentWithinLimits,
  hasSpecificationValue,
  findMissingRequiredAssetSpecs,
  stripAssetSpecData,
} from "./helpers";

/**
 * Direct unit tests for the pure utility leaves extracted from
 * apps/api/src/domains/jobs/routes/jobs.ts. These have no DB/session/await dependency.
 * Each assertion is written to go RED under a plausible mutation of the
 * function under test.
 */

describe("decodeRouteIdentifier", () => {
  it("decodes a percent-encoded identifier", () => {
    expect(decodeRouteIdentifier("CAL%2F2026%2F0001")).toBe("CAL/2026/0001");
    expect(decodeRouteIdentifier("a%20b")).toBe("a b");
  });

  it("returns a plain identifier unchanged", () => {
    expect(decodeRouteIdentifier("CAL-2026-0001")).toBe("CAL-2026-0001");
  });

  it("falls back to the raw input on malformed encoding (catch branch)", () => {
    // A lone "%" is not valid percent-encoding -> decodeURIComponent throws.
    expect(decodeRouteIdentifier("100%")).toBe("100%");
    expect(decodeRouteIdentifier("%E0%A4%A")).toBe("%E0%A4%A");
  });
});

describe("stringFromUnknown", () => {
  it("passes through strings", () => {
    expect(stringFromUnknown("hello")).toBe("hello");
  });

  it("returns an empty string for non-strings", () => {
    expect(stringFromUnknown(123)).toBe("");
    expect(stringFromUnknown(null)).toBe("");
    expect(stringFromUnknown(undefined)).toBe("");
    expect(stringFromUnknown({})).toBe("");
  });
});

describe("r2EnvFromUnknown", () => {
  it("coerces string env fields and drops non-strings", () => {
    const env = r2EnvFromUnknown({
      R2_ACCOUNT_ID: "acct",
      R2_ACCESS_KEY_ID: "akid",
      R2_SECRET_ACCESS_KEY: "secret",
      R2_BUCKET_NAME: "docs",
      R2_MEDIA_BUCKET_NAME: "media",
      R2_BUCKET_NAME_BOGUS: 5,
    });

    expect(env.R2_ACCOUNT_ID).toBe("acct");
    expect(env.R2_ACCESS_KEY_ID).toBe("akid");
    expect(env.R2_SECRET_ACCESS_KEY).toBe("secret");
    expect(env.R2_BUCKET_NAME).toBe("docs");
    expect(env.R2_MEDIA_BUCKET_NAME).toBe("media");
  });

  it("replaces non-string values with empty strings", () => {
    const env = r2EnvFromUnknown({ R2_ACCOUNT_ID: 9 });
    expect(env.R2_ACCOUNT_ID).toBe("");
  });
});

describe("methodInputFieldsFromSnapshot", () => {
  it("returns only the valid input-field entries", () => {
    const snapshot = {
      dataFields: [
        { key: "a", label: "A", type: "number" },
        { nope: true },
        { key: "b", label: "B", type: "text" },
        // a select without options, a key that is no identifier, a type that
        // does not exist: each is what the method editor refuses, so none is a field
        { key: "c", label: "C", type: "select" },
        { key: "1bad", label: "D", type: "number" },
        { key: "e", label: "E", type: "matrix" },
      ],
    } satisfies Partial<MethodSnapshot>;

    const fields = methodInputFieldsFromSnapshot(snapshot);
    expect(fields.map((f) => f.key)).toEqual(["a", "b"]);
  });

  it("returns [] when dataFields is missing or not an array", () => {
    expect(methodInputFieldsFromSnapshot(null)).toEqual([]);
    expect(methodInputFieldsFromSnapshot(undefined)).toEqual([]);
  });
});

describe("methodSnapshotDisplay", () => {
  it("extracts methodName and methodVersion when correctly typed", () => {
    expect(
      methodSnapshotDisplay({ methodName: "Exemplo M1", methodVersion: 3 }),
    ).toEqual({ methodName: "Exemplo M1", methodVersion: 3 });
  });

  it("drops wrongly-typed fields to undefined", () => {
    expect(
      methodSnapshotDisplay({ methodName: 5, methodVersion: "3" }),
    ).toEqual({ methodName: undefined, methodVersion: undefined });
    expect(methodSnapshotDisplay(null)).toEqual({
      methodName: undefined,
      methodVersion: undefined,
    });
  });
});

describe("checkEnvironmentWithinLimits", () => {
  const limits: EnvironmentalLimitsSnapshot = {
    temperature: { min: 18, max: 25 },
    humidity: { min: 40, max: 60 },
    pressure: { min: 990, max: 1030 },
  };

  it("is true when no limits are configured", () => {
    expect(
      checkEnvironmentWithinLimits(
        { temperature: 999, humidity: 999, pressure: 999 },
        null,
      ),
    ).toBe(true);
  });

  it("is true when all readings are inside the limits", () => {
    expect(
      checkEnvironmentWithinLimits(
        { temperature: 20, humidity: 50, pressure: 1010 },
        limits,
      ),
    ).toBe(true);
  });

  it("is true at the inclusive boundaries", () => {
    expect(
      checkEnvironmentWithinLimits(
        { temperature: 18, humidity: 60, pressure: 990 },
        limits,
      ),
    ).toBe(true);
  });

  it("is false when temperature is below the minimum", () => {
    expect(
      checkEnvironmentWithinLimits(
        { temperature: 17.9, humidity: 50, pressure: 1010 },
        limits,
      ),
    ).toBe(false);
  });

  it("is false when humidity exceeds the maximum", () => {
    expect(
      checkEnvironmentWithinLimits(
        { temperature: 20, humidity: 61, pressure: 1010 },
        limits,
      ),
    ).toBe(false);
  });

  it("is false when pressure is out of range", () => {
    expect(
      checkEnvironmentWithinLimits(
        { temperature: 20, humidity: 50, pressure: 1031 },
        limits,
      ),
    ).toBe(false);
  });

  it("ignores a reading that is null even if its limit is configured", () => {
    expect(
      checkEnvironmentWithinLimits(
        { temperature: null, humidity: 50, pressure: 1010 },
        limits,
      ),
    ).toBe(true);
  });
});

describe("hasSpecificationValue", () => {
  it("is true when the keyed value is a meaningful non-empty value", () => {
    expect(hasSpecificationValue({ capacity: "6000 g" }, "capacity")).toBe(
      true,
    );
    expect(hasSpecificationValue({ n: 0 }, "n")).toBe(true);
    expect(hasSpecificationValue({ b: false }, "b")).toBe(true);
  });

  it("is false for null/undefined/empty-string values", () => {
    expect(hasSpecificationValue({ x: null }, "x")).toBe(false);
    expect(hasSpecificationValue({ x: undefined }, "x")).toBe(false);
    expect(hasSpecificationValue({ x: "" }, "x")).toBe(false);
  });

  it("is false when specifications or key is missing", () => {
    expect(hasSpecificationValue(null, "x")).toBe(false);
    expect(hasSpecificationValue(undefined, "x")).toBe(false);
    expect(hasSpecificationValue({ x: "v" }, undefined)).toBe(false);
  });
});

describe("findMissingRequiredAssetSpecs", () => {
  const methodSnapshot = {
    dataFields: [
      {
        key: "cap",
        label: "Capacidade",
        type: "number",
        source: "asset_spec",
        required: true,
        assetSpecKey: "capacity",
      },
      {
        key: "div",
        label: "Divisão",
        type: "number",
        source: "asset_spec",
        required: false,
        assetSpecKey: "division",
      },
      {
        key: "reading",
        label: "Leitura",
        type: "number",
        source: "manual",
        required: true,
      },
    ],
  } satisfies Partial<MethodSnapshot>;

  it("flags a required asset-spec field whose value is missing", () => {
    const assetSnapshot = {
      specifications: { division: "0.1 g" },
    } satisfies Partial<AssetSnapshot>;

    const missing = findMissingRequiredAssetSpecs(
      methodSnapshot,
      assetSnapshot,
    );
    expect(missing.map((f) => f.key)).toEqual(["cap"]);
  });

  it("returns nothing when the required asset spec is present", () => {
    const assetSnapshot = {
      specifications: { capacity: "6000 g" },
    } satisfies Partial<AssetSnapshot>;

    expect(
      findMissingRequiredAssetSpecs(methodSnapshot, assetSnapshot),
    ).toEqual([]);
  });

  it("does not flag non-required or non-asset-spec fields", () => {
    const assetSnapshot = {
      specifications: { capacity: "6000 g" },
    } satisfies Partial<AssetSnapshot>;
    // division (not required) and reading (manual source) must never be flagged.
    const missing = findMissingRequiredAssetSpecs(
      methodSnapshot,
      assetSnapshot,
    );
    expect(missing.some((f) => f.key === "div")).toBe(false);
    expect(missing.some((f) => f.key === "reading")).toBe(false);
  });
});

describe("stripAssetSpecData", () => {
  const methodSnapshot = {
    dataFields: [
      {
        key: "cap",
        label: "Capacidade",
        type: "number",
        source: "asset_spec",
        assetSpecKey: "capacity",
      },
      {
        key: "reading",
        label: "Leitura",
        type: "number",
        source: "manual",
      },
    ] satisfies MethodInputField[],
  } satisfies Partial<MethodSnapshot>;

  it("removes keys backed by asset_spec fields, keeping the rest", () => {
    const result = stripAssetSpecData(
      { cap: "6000 g", reading: 12.3, other: "keep" },
      methodSnapshot,
    );
    expect(result).toEqual({ reading: 12.3, other: "keep" });
  });

  it("returns the data unchanged when there are no asset_spec keys", () => {
    const noSpecSnapshot = {
      dataFields: [
        { key: "reading", label: "Leitura", type: "number", source: "manual" },
      ],
    } satisfies Partial<MethodSnapshot>;
    const data = { reading: 1 };
    expect(stripAssetSpecData(data, noSpecSnapshot)).toBe(data);
  });

  it("returns null/undefined data untouched", () => {
    expect(stripAssetSpecData(null, methodSnapshot)).toBeNull();
    expect(stripAssetSpecData(undefined, methodSnapshot)).toBeUndefined();
  });
});
