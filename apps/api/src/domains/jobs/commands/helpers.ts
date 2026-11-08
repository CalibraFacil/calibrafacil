import {
  type MethodSnapshot,
  type AssetSnapshot,
  type EnvironmentalLimitsSnapshot,
} from "@calibra-facil/db/schema";
import { type R2Env } from "../../../lib/storage";
import {
  MethodInputFieldSchema,
  type MethodInputField,
} from "@calibra-facil/schemas";
import { log } from "../../../lib/logger";
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

/**
 * The input fields a method snapshot froze, each proved with the schema the
 * method editor validates them with. An entry that does not match is left out
 * and logged (it is never taken for a field it is not).
 */
export function methodInputFieldsFromSnapshot(
  methodSnapshot: MethodSnapshot | null | undefined,
): MethodInputField[] {
  const dataFields: unknown = methodSnapshot?.dataFields;
  if (!Array.isArray(dataFields)) return [];
  return dataFields.flatMap((entry) => {
    const parsed = MethodInputFieldSchema.safeParse(entry);
    if (parsed.success) return [parsed.data];
    log("warn", "method_snapshot_input_field_invalid", {
      key:
        typeof toRecord(entry).key === "string"
          ? String(toRecord(entry).key)
          : null,
      methodId: methodSnapshot?.methodId ?? null,
    });
    return [];
  });
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
