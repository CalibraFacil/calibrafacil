import { EXCLUDE_KEYS, UNIT_TO_SI, UNIT_VALUE_PATTERN } from "./constants";
import type { FormulaContext, UnitValue } from "./types";

// ============================================
// Flatten options
// ============================================
export interface FlattenOptions {
  includeKeys?: string[];
  excludeKeys?: string[];
  prefix?: string;
  maxDepth?: number;
  includeArrayIndices?: boolean;
  normalizeUnits?: boolean;
  preserveArrays?: boolean; // Keep arrays intact for vector math functions (mean, std, etc.)
}

const DEFAULT_OPTIONS: Required<FlattenOptions> = {
  includeKeys: [],
  excludeKeys: [],
  prefix: "",
  maxDepth: 5,
  includeArrayIndices: true,
  normalizeUnits: true,
  preserveArrays: false, // Default false for backward compatibility
};

// ============================================
// Parse value with unit string (e.g., "10.5 kg")
// ============================================
export function parseUnitValue(input: string): UnitValue | null {
  const match = input.trim().match(UNIT_VALUE_PATTERN);
  if (!match) return null;

  const value = parseFloat(match[1]!);
  const unit = match[2]!;

  if (isNaN(value)) return null;

  return { value, unit };
}

// ============================================
// Normalize value to SI base unit
// ============================================
export function normalizeToSI(
  value: number,
  unit: string,
): { value: number; baseUnit: string } | null {
  const conversion = UNIT_TO_SI[unit];
  if (!conversion) return null;

  return {
    value: value * conversion.factor,
    baseUnit: conversion.baseUnit,
  };
}

// ============================================
// Process a value, potentially with unit normalization
// ============================================
function processValue(
  val: unknown,
  normalizeUnits: boolean,
): number | string | boolean | null {
  if (typeof val === "number") return val;
  if (typeof val === "boolean") return val;
  if (val === null) return null;

  if (typeof val === "string" && normalizeUnits) {
    const parsed = parseUnitValue(val);
    if (parsed) {
      const normalized = normalizeToSI(parsed.value, parsed.unit);
      if (normalized) {
        return normalized.value;
      }
      // Unknown units must not be silently stripped in laboratory data.
      // Preserve the original string so formulas cannot accidentally treat
      // "10 foo" as a dimensionless numeric 10.
      return val;
    }
  }

  if (typeof val === "string") return val;

  return null;
}

// ============================================
// Check if a key should be excluded
// ============================================
function shouldExcludeKey(key: string, excludeSet: Set<string>): boolean {
  const lowerKey = key.toLowerCase();
  for (const excludeKey of excludeSet) {
    if (lowerKey.includes(excludeKey.toLowerCase())) {
      return true;
    }
  }
  return false;
}

function shouldIncludeKey(
  key: string,
  leafKey: string,
  includeSet: Set<string>,
): boolean {
  if (includeSet.size === 0) return true;
  return includeSet.has(key) || includeSet.has(leafKey);
}

// ============================================
// Main flatten function
// ============================================
export function flattenForExecution(
  data: Record<string, unknown>,
  options: FlattenOptions = {},
): FormulaContext {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const excludeSet = new Set([...EXCLUDE_KEYS, ...opts.excludeKeys]);
  const includeSet = new Set(opts.includeKeys);

  const result: FormulaContext = {};
  const inputsUsed: string[] = [];

  function flatten(
    obj: unknown,
    currentKey: string,
    depth: number,
    leafKey: string = currentKey,
  ): void {
    if (depth > opts.maxDepth) return;

    if (obj === null || obj === undefined) {
      return;
    }

    // Check if current key should be excluded
    if (currentKey && shouldExcludeKey(currentKey, excludeSet)) {
      return;
    }

    // Handle primitive values
    if (
      typeof obj === "number" ||
      typeof obj === "string" ||
      typeof obj === "boolean"
    ) {
      if (!shouldIncludeKey(currentKey, leafKey, includeSet)) {
        return;
      }
      const processed = processValue(obj, opts.normalizeUnits);
      if (processed !== null) {
        result[currentKey] = processed;
        inputsUsed.push(currentKey);
      }
      return;
    }

    // Handle arrays
    if (Array.isArray(obj)) {
      // For numeric arrays, create individual indexed variables
      const numericValues = obj.filter(
        (item): item is number => typeof item === "number",
      );

      // Check if array is all-numeric (or empty when preserveArrays is enabled)
      const isAllNumeric = numericValues.length === obj.length;
      const shouldProcess =
        isAllNumeric && (numericValues.length > 0 || opts.preserveArrays);

      if (shouldProcess) {
        const includeArray = shouldIncludeKey(currentKey, leafKey, includeSet);

        // Preserve array if option is enabled (for vector math: mean, std, etc.)
        if (opts.preserveArrays && includeArray) {
          result[currentKey] = numericValues; // Could be [] - that's valid!
          inputsUsed.push(currentKey);
        }

        // Create indexed access for specific point access (e.g., readings_0)
        if (opts.includeArrayIndices && numericValues.length > 0) {
          numericValues.forEach((item, index) => {
            const key = `${currentKey}_${index}`;
            if (includeArray || shouldIncludeKey(key, leafKey, includeSet)) {
              result[key] = item;
              inputsUsed.push(key);
            }
          });
        }

        // Store count for aggregate functions (0 for empty arrays)
        const countKey = `${currentKey}_count`;
        if (includeArray || shouldIncludeKey(countKey, leafKey, includeSet)) {
          result[countKey] = numericValues.length;
          inputsUsed.push(countKey);
        }
        return;
      }

      // For mixed/object arrays, flatten each element
      obj.forEach((item, index) => {
        flatten(item, `${currentKey}_${index}`, depth + 1, leafKey);
      });
      return;
    }

    // Handle objects
    if (typeof obj === "object") {
      for (const [key, value] of Object.entries(obj)) {
        const newKey = currentKey ? `${currentKey}_${key}` : key;
        flatten(value, newKey, depth + 1, key);
      }
    }
  }

  flatten(data, opts.prefix, 0);

  return result;
}

// ============================================
// Extract numeric readings from nested data
// ============================================
/**
 * Extract numeric readings from nested data structure
 *
 * Traverses the data object to find numeric values associated with explicit
 * reading keys (e.g., "reading", "value", "leitura", "measured").
 * Matching is conservative: exact key, plural form, or a numbered suffix such
 * as "reading1" / "leitura_2". Ambiguous fields like "nominal_value" or
 * "reference_value" are intentionally not treated as Type A observations.
 *
 * IMPORTANT: All readings are preserved, including duplicates.
 * In metrology, repeated identical readings are valid and statistically
 * significant (e.g., [10, 10, 10, 10] represents 4 independent measurements).
 *
 * @param data - The data object to extract readings from
 * @param readingKeys - Keys that indicate a value is a reading (default: common terms)
 * @returns Array of numeric readings in the order they were found
 */
export function extractReadings(
  data: Record<string, unknown>,
  readingKeys: string[] = ["reading", "value", "leitura", "measured"],
): number[] {
  const readings: number[] = [];
  const normalizedReadingKeys = readingKeys.map((key) => key.toLowerCase());

  function isReadingKey(key: string): boolean {
    const lowerKey = key.toLowerCase();
    return normalizedReadingKeys.some((readingKey) => {
      if (lowerKey === readingKey || lowerKey === `${readingKey}s`) {
        return true;
      }

      return new RegExp(`^${escapeRegExp(readingKey)}[-_]?\\d+$`).test(
        lowerKey,
      );
    });
  }

  function extract(obj: unknown, parentKey: string = ""): void {
    if (obj === null || obj === undefined) return;

    if (typeof obj === "number") {
      // Only add if parent key suggests it's a reading
      if (parentKey && isReadingKey(parentKey)) {
        readings.push(obj);
      }
      return;
    }

    if (Array.isArray(obj)) {
      for (const item of obj) {
        if (typeof item === "number") {
          if (parentKey && isReadingKey(parentKey)) {
            readings.push(item);
          }
        } else {
          extract(item, parentKey);
        }
      }
      return;
    }

    if (typeof obj === "object") {
      for (const [key, value] of Object.entries(obj)) {
        const keyIsReading = isReadingKey(key);

        if (keyIsReading) {
          if (typeof value === "number") {
            readings.push(value);
            // Don't recurse - we've already captured the value
            continue;
          } else if (Array.isArray(value)) {
            // Check if array contains numbers directly or objects
            let hasNumericItems = false;
            for (const item of value) {
              if (typeof item === "number") {
                readings.push(item);
                hasNumericItems = true;
              } else if (typeof item === "object" && item !== null) {
                // Array contains objects - need to recurse into each
                extract(item, key);
              }
            }
            // If we found numeric items, don't recurse further
            if (hasNumericItems) {
              continue;
            }
            // If array had objects, we already recursed into them
            continue;
          }
        }
        // Only recurse for non-reading keys or non-numeric/non-array values
        extract(value, key);
      }
    }
  }

  extract(data);

  return readings;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ============================================
// Inject environmental data with prefix
// ============================================
export function injectEnvironmentData(
  context: FormulaContext,
  environment: Record<string, number | undefined>,
): FormulaContext {
  const result = { ...context };

  for (const [key, value] of Object.entries(environment)) {
    if (value !== undefined) {
      result[`env_${key}`] = value;
    }
  }

  return result;
}

// ============================================
// Inject instrument specs with prefix
// ============================================
export function injectInstrumentSpecs(
  context: FormulaContext,
  specs: Record<string, number | undefined>,
): FormulaContext {
  const result = { ...context };

  for (const [key, value] of Object.entries(specs)) {
    if (value !== undefined) {
      result[`inst_${key}`] = value;
    }
  }

  return result;
}

// ============================================
// Get list of all inputs used (for traceability)
// ============================================
export function getInputsUsed(context: FormulaContext): string[] {
  return Object.keys(context).filter(
    (key) => context[key] !== null && context[key] !== undefined,
  );
}
