import type { SafeMetadata, SafeMetadataValue } from "./types";

const DANGEROUS_KEYS = new Set([
  "__proto__",
  "prototype",
  "constructor",
  "toString",
  "valueOf",
]);

function valueKind(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

export function assertSafeUnknown(value: unknown, path = "draft"): void {
  const seen = new WeakSet<object>();

  function visit(current: unknown, currentPath: string): void {
    if (
      current === null ||
      typeof current === "string" ||
      typeof current === "boolean"
    ) {
      return;
    }

    if (typeof current === "number") {
      if (!Number.isFinite(current)) {
        throw new Error(`${currentPath} must be a finite number`);
      }
      return;
    }

    if (
      typeof current === "undefined" ||
      typeof current === "function" ||
      typeof current === "symbol" ||
      typeof current === "bigint"
    ) {
      throw new Error(`${currentPath} has unsupported type ${valueKind(current)}`);
    }

    if (seen.has(current)) {
      throw new Error(`${currentPath} contains a circular reference`);
    }
    seen.add(current);

    if (Array.isArray(current)) {
      for (let index = 0; index < current.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(current, index)) {
          throw new Error(`${currentPath}[${index}] is a sparse array slot`);
        }
        visit(current[index], `${currentPath}[${index}]`);
      }
      return;
    }

    const prototype = Object.getPrototypeOf(current);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`${currentPath} must be a plain object`);
    }

    for (const key of Reflect.ownKeys(current)) {
      if (typeof key !== "string") {
        throw new Error(`${currentPath} contains a non-string key`);
      }
      if (DANGEROUS_KEYS.has(key)) {
        throw new Error(`${currentPath}.${key} is not allowed`);
      }
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (!descriptor) continue;
      if ("get" in descriptor || "set" in descriptor) {
        throw new Error(`${currentPath}.${key} must not be an accessor`);
      }
      visit(descriptor.value, `${currentPath}.${key}`);
    }
  }

  visit(value, path);
}

export function normalizeSafeMetadata(
  value: SafeMetadata | undefined,
): SafeMetadata | undefined {
  if (!value) return undefined;
  const normalized: SafeMetadata = {};
  for (const key of Object.keys(value).sort()) {
    if (DANGEROUS_KEYS.has(key)) {
      throw new Error(`metadata.${key} is not allowed`);
    }
    const item = value[key];
    normalized[key] = normalizeSafeMetadataValue(item, `metadata.${key}`);
  }
  return normalized;
}

export function normalizeSafeMetadataValue(
  value: unknown,
  path: string,
): SafeMetadataValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return Object.is(value, -0) ? 0 : value;
  }
  throw new Error(`${path} must be string, finite number, boolean, or null`);
}

export function deepFreezeJsonLike<T>(value: T): T {
  if (typeof value !== "object" || value === null) return value;
  Object.freeze(value);
  if (Array.isArray(value)) {
    for (const item of value) deepFreezeJsonLike(item);
    return value;
  }
  for (const key of Object.keys(value)) {
    deepFreezeJsonLike((value as Record<string, unknown>)[key]);
  }
  return value;
}
