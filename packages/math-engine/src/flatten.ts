import {
  INCLUDE_KEYS,
  EXCLUDE_KEYS,
  UNIT_TO_SI,
  UNIT_VALUE_PATTERN,
} from "./constants";
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
      // If unit not recognized, return the numeric value
      return parsed.value;
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

// ============================================
// Main flatten function
// ============================================
export function flattenForExecution(
  data: Record<string, unknown>,
  options: FlattenOptions = {},
): FormulaContext {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const includeSet = new Set([...INCLUDE_KEYS, ...opts.includeKeys]);
  const excludeSet = new Set([...EXCLUDE_KEYS, ...opts.excludeKeys]);

  const result: FormulaContext = {};
  const inputsUsed: string[] = [];

  function flatten(obj: unknown, currentKey: string, depth: number): void {
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

      if (numericValues.length === obj.length && numericValues.length > 0) {
        // Preserve array if option is enabled (for vector math: mean, std, etc.)
        if (opts.preserveArrays) {
          result[currentKey] = numericValues;
          inputsUsed.push(currentKey);
        }

        // Also create indexed access (for backward compatibility or specific point access)
        if (opts.includeArrayIndices) {
          numericValues.forEach((item, index) => {
            const key = `${currentKey}_${index}`;
            result[key] = item;
            inputsUsed.push(key);
          });
        }
        // Store count for aggregate functions
        result[`${currentKey}_count`] = numericValues.length;
        inputsUsed.push(`${currentKey}_count`);
        return;
      }

      // For mixed/object arrays, flatten each element
      obj.forEach((item, index) => {
        flatten(item, `${currentKey}_${index}`, depth + 1);
      });
      return;
    }

    // Handle objects
    if (typeof obj === "object") {
      for (const [key, value] of Object.entries(obj)) {
        const newKey = currentKey ? `${currentKey}_${key}` : key;
        flatten(value, newKey, depth + 1);
      }
    }
  }

  flatten(data, opts.prefix, 0);

  return result;
}

// ============================================
// Extract numeric readings from nested data
// ============================================
export function extractReadings(
  data: Record<string, unknown>,
  readingKeys: string[] = ["reading", "value", "leitura", "measured"],
): number[] {
  const readings: number[] = [];
  const seen = new Set<number>();

  function extract(obj: unknown, parentKey: string = ""): void {
    if (obj === null || obj === undefined) return;

    if (typeof obj === "number") {
      // Only add if parent key suggests it's a reading
      const isReadingKey = readingKeys.some(
        (rk) =>
          parentKey.toLowerCase().includes(rk.toLowerCase()) ||
          parentKey === "",
      );
      if (isReadingKey && !seen.has(obj)) {
        readings.push(obj);
        seen.add(obj);
      }
      return;
    }

    if (Array.isArray(obj)) {
      for (const item of obj) {
        if (typeof item === "number" && !seen.has(item)) {
          readings.push(item);
          seen.add(item);
        } else {
          extract(item, parentKey);
        }
      }
      return;
    }

    if (typeof obj === "object") {
      for (const [key, value] of Object.entries(obj)) {
        const isReadingKey = readingKeys.some((rk) =>
          key.toLowerCase().includes(rk.toLowerCase()),
        );

        if (isReadingKey) {
          if (typeof value === "number" && !seen.has(value)) {
            readings.push(value);
            seen.add(value);
          } else if (Array.isArray(value)) {
            for (const item of value) {
              if (typeof item === "number" && !seen.has(item)) {
                readings.push(item);
                seen.add(item);
              }
            }
          }
        }
        extract(value, key);
      }
    }
  }

  extract(data);

  return readings;
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
