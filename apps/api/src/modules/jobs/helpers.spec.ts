import { describe, it, expect } from "vitest";
import type {
  MethodSnapshot,
  MethodInputField,
  AssetSnapshot,
  EnvironmentalLimitsSnapshot,
} from "@calibra-facil/db/schema";
import {
  decodeRouteIdentifier,
  shouldUseLocalR2Download,
  recordFromUnknown,
  stringFromUnknown,
  r2EnvFromUnknown,
  isMethodInputField,
  methodInputFieldsFromSnapshot,
  methodSnapshotDisplay,
  isCompiledMethod,
  buildLocalJobFileUrl,
  checkEnvironmentWithinLimits,
  hasSpecificationValue,
  findMissingRequiredAssetSpecs,
  stripAssetSpecData,
} from "./helpers";

/**
 * Direct unit tests for the pure utility leaves extracted from
 * apps/api/src/routes/jobs.ts. These have no DB/session/await dependency.
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

describe("shouldUseLocalR2Download", () => {
  const bucket = { get: async () => null };

  it("is true only in development with a certificates bucket bound", () => {
    expect(
      shouldUseLocalR2Download({
        R2_ACCOUNT_ID: "",
        R2_ACCESS_KEY_ID: "",
        R2_SECRET_ACCESS_KEY: "",
        R2_BUCKET_NAME: "",
        R2_MEDIA_BUCKET_NAME: "",
        NODE_ENV: "development",
        CERTIFICATES_BUCKET: bucket,
      }),
    ).toBe(true);
  });

  it("is false when not in development", () => {
    expect(
      shouldUseLocalR2Download({
        R2_ACCOUNT_ID: "",
        R2_ACCESS_KEY_ID: "",
        R2_SECRET_ACCESS_KEY: "",
        R2_BUCKET_NAME: "",
        R2_MEDIA_BUCKET_NAME: "",
        NODE_ENV: "production",
        CERTIFICATES_BUCKET: bucket,
      }),
    ).toBe(false);
  });

  it("is false in development without a certificates bucket", () => {
    expect(
      shouldUseLocalR2Download({
        R2_ACCOUNT_ID: "",
        R2_ACCESS_KEY_ID: "",
        R2_SECRET_ACCESS_KEY: "",
        R2_BUCKET_NAME: "",
        R2_MEDIA_BUCKET_NAME: "",
        NODE_ENV: "development",
      }),
    ).toBe(false);
  });
});

describe("recordFromUnknown", () => {
  it("returns the entries of a plain object", () => {
    expect(recordFromUnknown({ a: 1, b: "x" })).toEqual({ a: 1, b: "x" });
  });

  it("returns {} for non-objects, null, and arrays", () => {
    expect(recordFromUnknown(null)).toEqual({});
    expect(recordFromUnknown(undefined)).toEqual({});
    expect(recordFromUnknown("nope")).toEqual({});
    expect(recordFromUnknown(42)).toEqual({});
    expect(recordFromUnknown([1, 2, 3])).toEqual({});
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
      NODE_ENV: "development",
      API_URL: "https://api.example.com",
      R2_BUCKET_NAME_BOGUS: 5,
    });

    expect(env.R2_ACCOUNT_ID).toBe("acct");
    expect(env.R2_ACCESS_KEY_ID).toBe("akid");
    expect(env.R2_SECRET_ACCESS_KEY).toBe("secret");
    expect(env.R2_BUCKET_NAME).toBe("docs");
    expect(env.R2_MEDIA_BUCKET_NAME).toBe("media");
    expect(env.NODE_ENV).toBe("development");
    expect(env.API_URL).toBe("https://api.example.com");
  });

  it("replaces non-string values with empty strings", () => {
    const env = r2EnvFromUnknown({ R2_ACCOUNT_ID: 9 });
    expect(env.R2_ACCOUNT_ID).toBe("");
  });

  it("wraps a bucket-like object so get() is forwarded", async () => {
    const calls: string[] = [];
    const env = r2EnvFromUnknown({
      CERTIFICATES_BUCKET: {
        get: (key: string) => {
          calls.push(key);
          return Promise.resolve(null);
        },
      },
    });

    expect(typeof env.CERTIFICATES_BUCKET?.get).toBe("function");
    await env.CERTIFICATES_BUCKET?.get("some/key");
    expect(calls).toEqual(["some/key"]);
  });

  it("leaves CERTIFICATES_BUCKET undefined when none is provided", () => {
    const env = r2EnvFromUnknown({});
    expect(env.CERTIFICATES_BUCKET).toBeUndefined();
    expect(env.MEDIA_BUCKET).toBeUndefined();
  });
});

describe("isMethodInputField", () => {
  it("accepts an object with string key and string type", () => {
    expect(isMethodInputField({ key: "reading_1", type: "number" })).toBe(true);
  });

  it("rejects objects missing key or type, and non-objects", () => {
    expect(isMethodInputField({ key: "reading_1" })).toBe(false);
    expect(isMethodInputField({ type: "number" })).toBe(false);
    expect(isMethodInputField({ key: 1, type: "number" })).toBe(false);
    expect(isMethodInputField({ key: "x", type: 2 })).toBe(false);
    expect(isMethodInputField(null)).toBe(false);
    expect(isMethodInputField("text")).toBe(false);
  });
});

describe("methodInputFieldsFromSnapshot", () => {
  it("returns only the valid input-field entries", () => {
    const snapshot = {
      dataFields: [
        { key: "a", label: "A", type: "number" },
        { nope: true },
        { key: "b", label: "B", type: "text" },
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

describe("isCompiledMethod", () => {
  const valid = {
    status: "compiled",
    methodFingerprint: "fp",
    normalizedMethodJson: "{}",
    engine: { version: "0.3.0", optionsFingerprint: "opt" },
    inputs: [],
    formulas: [],
    measurementModels: [],
    acceptanceCriteria: [],
  };

  it("accepts a fully-formed compiled method", () => {
    expect(isCompiledMethod(valid)).toBe(true);
  });

  it("rejects when status is not 'compiled'", () => {
    expect(isCompiledMethod({ ...valid, status: "error" })).toBe(false);
  });

  it("rejects when a required engine field is missing", () => {
    expect(isCompiledMethod({ ...valid, engine: { version: "0.3.0" } })).toBe(
      false,
    );
  });

  it("rejects when a required array field is not an array", () => {
    expect(isCompiledMethod({ ...valid, formulas: "nope" })).toBe(false);
    expect(isCompiledMethod(null)).toBe(false);
  });
});


describe("buildLocalJobFileUrl", () => {
  it("builds a certificate URL from the request origin", () => {
    expect(
      buildLocalJobFileUrl(
        "https://api.example.com/api/jobs/123/file",
        "CAL-2026-0001",
        "certificate",
      ),
    ).toBe("https://api.example.com/api/jobs/CAL-2026-0001/file");
  });

  it("builds a label URL with the label-file suffix", () => {
    expect(
      buildLocalJobFileUrl(
        "https://api.example.com/whatever",
        "CAL-2026-0001",
        "label",
      ),
    ).toBe("https://api.example.com/api/jobs/CAL-2026-0001/label-file");
  });

  it("prefers the apiUrl origin when provided and percent-encodes the routeId", () => {
    expect(
      buildLocalJobFileUrl(
        "https://request.example.com/x",
        "CAL/2026/0001",
        "certificate",
        "https://override.example.com/base",
      ),
    ).toBe("https://override.example.com/api/jobs/CAL%2F2026%2F0001/file");
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
