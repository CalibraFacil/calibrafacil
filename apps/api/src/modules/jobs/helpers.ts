import {
  type MethodSnapshot,
  type MethodInputField,
  type AssetSnapshot,
  type EnvironmentalLimitsSnapshot,
} from "@calibra-facil/db/schema";
import { type CertificateTemplateSnapshot } from "@calibra-facil/shared/certificate-templates";
import { type R2Env, type R2BucketLike } from "../../lib/storage";
import { type CompiledMethod } from "@calibra-facil/method-definition";

export function decodeRouteIdentifier(identifier: string) {
  try {
    return decodeURIComponent(identifier);
  } catch {
    return identifier;
  }
}

export function shouldUseLocalR2Download(env: R2Env): env is R2Env & {
  CERTIFICATES_BUCKET: R2BucketLike;
} {
  return env.NODE_ENV === "development" && Boolean(env.CERTIFICATES_BUCKET);
}

export function recordFromUnknown(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(Object.entries(value));
}

export function stringFromUnknown(value: unknown) {
  return typeof value === "string" ? value : "";
}

export function r2EnvFromUnknown(value: unknown): R2Env {
  const env = recordFromUnknown(value);
  const bucket = env.CERTIFICATES_BUCKET;
  const bucketGet =
    bucket && typeof bucket === "object" ? Reflect.get(bucket, "get") : null;
  const mediaBucket = env.MEDIA_BUCKET;
  const mediaBucketGet =
    mediaBucket && typeof mediaBucket === "object"
      ? Reflect.get(mediaBucket, "get")
      : null;

  return {
    R2_ACCOUNT_ID: stringFromUnknown(env.R2_ACCOUNT_ID),
    R2_ACCESS_KEY_ID: stringFromUnknown(env.R2_ACCESS_KEY_ID),
    R2_SECRET_ACCESS_KEY: stringFromUnknown(env.R2_SECRET_ACCESS_KEY),
    R2_BUCKET_NAME: stringFromUnknown(env.R2_BUCKET_NAME),
    R2_MEDIA_BUCKET_NAME: stringFromUnknown(env.R2_MEDIA_BUCKET_NAME),
    CERTIFICATES_BUCKET:
      bucket && typeof bucketGet === "function"
        ? { get: (key) => bucketGet.call(bucket, key) }
        : undefined,
    MEDIA_BUCKET:
      mediaBucket && typeof mediaBucketGet === "function"
        ? { get: (key) => mediaBucketGet.call(mediaBucket, key) }
        : undefined,
    NODE_ENV:
      typeof env.NODE_ENV === "string" ? env.NODE_ENV : process.env.NODE_ENV,
    API_URL: typeof env.API_URL === "string" ? env.API_URL : undefined,
  };
}

export function isMethodInputField(value: unknown): value is MethodInputField {
  const field = recordFromUnknown(value);
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
  const snapshot = recordFromUnknown(value);
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
  const candidate = recordFromUnknown(value);
  const engine = recordFromUnknown(candidate.engine);
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

export function certificateTemplateSnapshotFromUnknown(
  value: unknown,
): CertificateTemplateSnapshot | null {
  const snapshot = recordFromUnknown(value);
  const id = snapshot.id;
  const name = snapshot.name;
  const slug = snapshot.slug;
  const version = snapshot.version;
  if (
    (id !== null && typeof id !== "number") ||
    typeof name !== "string" ||
    typeof slug !== "string" ||
    typeof version !== "number"
  ) {
    return null;
  }

  return { id, name, slug, version };
}

export function buildLocalJobFileUrl(
  requestUrl: string,
  routeId: string,
  type: "certificate" | "label",
  apiUrl?: string,
) {
  const origin = apiUrl ? new URL(apiUrl).origin : new URL(requestUrl).origin;
  const encodedRouteId = encodeURIComponent(routeId);
  const suffix = type === "certificate" ? "file" : "label-file";
  return `${origin}/api/jobs/${encodedRouteId}/${suffix}`;
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
