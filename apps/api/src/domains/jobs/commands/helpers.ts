import {
  type MethodSnapshot,
  type MethodInputField,
  type AssetSnapshot,
  type EnvironmentalLimitsSnapshot,
} from "@calibra-facil/db/schema";
import { type R2Env } from "../../../lib/storage";
import { type CompiledMethod } from "@calibra-facil/method-definition";
import { toRecord } from "@calibra-facil/shared/record";

export function decodeRouteIdentifier(identifier: string) {
  try {
    return decodeURIComponent(identifier);
  } catch {
    return identifier;
  }
}

export function stringFromUnknown(value: unknown) {
  return typeof value === "string" ? value : "";
}

export function r2EnvFromUnknown(value: unknown): R2Env {
  const env = toRecord(value);

  return {
    R2_ACCOUNT_ID: stringFromUnknown(env.R2_ACCOUNT_ID),
    R2_ACCESS_KEY_ID: stringFromUnknown(env.R2_ACCESS_KEY_ID),
    R2_SECRET_ACCESS_KEY: stringFromUnknown(env.R2_SECRET_ACCESS_KEY),
    R2_BUCKET_NAME: stringFromUnknown(env.R2_BUCKET_NAME),
    R2_MEDIA_BUCKET_NAME: stringFromUnknown(env.R2_MEDIA_BUCKET_NAME),
  };
}

export function isMethodInputField(value: unknown): value is MethodInputField {
  const field = toRecord(value);
  return typeof field.key === "string" && typeof field.type === "string";
}

export function methodInputFieldsFromSnapshot(
  methodSnapshot: MethodSnapshot | null | undefined,
) {
  return Array.isArray(methodSnapshot?.dataFields)
    ? methodSnapshot.dataFields.filter(isMethodInputField)
    : [];
}

export function methodSnapshotDisplay(value: unknown) {
  const snapshot = toRecord(value);
  return {
    methodName:
      typeof snapshot.methodName === "string" ? snapshot.methodName : undefined,
    methodVersion:
      typeof snapshot.methodVersion === "number"
        ? snapshot.methodVersion
        : undefined,
  };
}

export function isCompiledMethod(value: unknown): value is CompiledMethod {
  const candidate = toRecord(value);
  const engine = toRecord(candidate.engine);
  return (
    candidate.status === "compiled" &&
    typeof candidate.methodFingerprint === "string" &&
    typeof candidate.normalizedMethodJson === "string" &&
    typeof engine.version === "string" &&
    typeof engine.optionsFingerprint === "string" &&
    Array.isArray(candidate.inputs) &&
    Array.isArray(candidate.formulas) &&
    Array.isArray(candidate.measurementModels) &&
    Array.isArray(candidate.acceptanceCriteria)
  );
}

/**
 * Check if environmental readings are within configured limits.
 */
export function checkEnvironmentWithinLimits(
  env: {
    temperature: number | null;
    humidity: number | null;
    pressure: number | null;
  },
  limits: EnvironmentalLimitsSnapshot | null,
): boolean {
  if (!limits) return true; // No limits configured = always within
  if (
    limits.temperature &&
    env.temperature != null &&
    (env.temperature < limits.temperature.min ||
      env.temperature > limits.temperature.max)
  ) {
    return false;
  }
  if (
    limits.humidity &&
    env.humidity != null &&
    (env.humidity < limits.humidity.min || env.humidity > limits.humidity.max)
  ) {
    return false;
  }
  if (
    limits.pressure &&
    env.pressure != null &&
    (env.pressure < limits.pressure.min || env.pressure > limits.pressure.max)
  ) {
    return false;
  }
  return true;
}

export function hasSpecificationValue(
  specifications: Record<string, unknown> | null | undefined,
  key: string | undefined,
) {
  if (!specifications || !key) {
    return false;
  }

  const value = specifications[key];
  return value !== null && value !== undefined && value !== "";
}

export function findMissingRequiredAssetSpecs(
  methodSnapshot: MethodSnapshot | null | undefined,
  assetSnapshot: AssetSnapshot | null | undefined,
) {
  const fields = methodInputFieldsFromSnapshot(methodSnapshot);
  return fields.filter(
    (field) =>
      field.source === "asset_spec" &&
      field.required &&
      !hasSpecificationValue(assetSnapshot?.specifications, field.assetSpecKey),
  );
}

export function stripAssetSpecData(
  data: Record<string, unknown> | null | undefined,
  methodSnapshot: MethodSnapshot | null | undefined,
) {
  if (!data) {
    return data;
  }

  const assetSpecKeys = new Set(
    methodInputFieldsFromSnapshot(methodSnapshot)
      .filter((field) => field.source === "asset_spec")
      .map((field) => field.key),
  );

  if (assetSpecKeys.size === 0) {
    return data;
  }

  return Object.fromEntries(
    Object.entries(data).filter(([key]) => !assetSpecKeys.has(key)),
  );
}
