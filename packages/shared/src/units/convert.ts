/**
 * Value conversion helpers built on the {@link UNIT_REGISTRY}.
 *
 * Absolute vs delta is the correctness crux for affine kinds (temperature):
 *  - {@link convertUnitValue} — for measured/indicated/nominal/reference values
 *    and range *bounds*. Affine-aware (0 °C → 273.15 K).
 *  - {@link convertUnitDelta} — for resolutions, uncertainties, errors,
 *    tolerances and range *widths*. Factor-only (0.1 °C → 0.18 °F, never 32.18).
 *
 * For every factor-only kind (everything except temperature) the two coincide,
 * so mass behaviour is byte-identical regardless of which is used.
 */

import { UNIT_REGISTRY, normalizeUnitToken } from "./registry";

function offsetOf(unit: keyof typeof UNIT_REGISTRY): number {
  const def = UNIT_REGISTRY[unit];
  return "offset" in def.toCanonical ? def.toCanonical.offset : 0;
}

/** Convert an absolute value to its kind's canonical unit (affine-aware). */
export function toCanonicalValue(value: number, unit: unknown): number | null {
  const normalized = normalizeUnitToken(unit);
  if (!normalized) return null;
  const def = UNIT_REGISTRY[normalized];
  return value * def.toCanonical.factor + offsetOf(normalized);
}

/** Convert an absolute canonical value into the given unit (affine-aware). */
export function fromCanonicalValue(
  value: number,
  unit: unknown,
): number | null {
  const normalized = normalizeUnitToken(unit);
  if (!normalized) return null;
  const def = UNIT_REGISTRY[normalized];
  return (value - offsetOf(normalized)) / def.toCanonical.factor;
}

/**
 * Convert an absolute value between two units of the same kind. Returns `null`
 * for unknown tokens or cross-kind conversions.
 */
export function convertUnitValue(
  value: number,
  fromUnit: unknown,
  toUnit: unknown,
): number | null {
  const from = normalizeUnitToken(fromUnit);
  const to = normalizeUnitToken(toUnit);
  if (!from || !to) return null;
  if (UNIT_REGISTRY[from].kind !== UNIT_REGISTRY[to].kind) return null;

  const canonical = toCanonicalValue(value, from);
  if (canonical == null) return null;
  return fromCanonicalValue(canonical, to);
}

/**
 * Convert a *delta* (resolution / uncertainty / error / tolerance / span)
 * between two units of the same kind. Factor-only — offsets are intentionally
 * ignored. Returns `null` for unknown tokens or cross-kind conversions.
 */
export function convertUnitDelta(
  value: number,
  fromUnit: unknown,
  toUnit: unknown,
): number | null {
  const from = normalizeUnitToken(fromUnit);
  const to = normalizeUnitToken(toUnit);
  if (!from || !to) return null;
  if (UNIT_REGISTRY[from].kind !== UNIT_REGISTRY[to].kind) return null;

  return (
    (value * UNIT_REGISTRY[from].toCanonical.factor) /
    UNIT_REGISTRY[to].toCanonical.factor
  );
}

/**
 * Parse a numeric value, accepting comma decimals (pt-BR). Returns `null` for
 * non-finite or empty input. Promoted from the private mass-units helper.
 */
export function parseNumericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

/**
 * Number of fractional digits implied by a resolution, used to cap how many
 * decimals an operator may type for an instrument indication. When both
 * `resolutionUnit` and `displayUnit` are given, the resolution is first
 * delta-converted into the display unit (a 0.1 °C resolution shown in °F caps
 * at 2 decimals). Returns `null` when the resolution is not a usable positive
 * number.
 */
export function decimalsForResolution(
  resolution: number,
  resolutionUnit?: string | null,
  displayUnit?: string | null,
): number | null {
  if (!Number.isFinite(resolution) || resolution <= 0) return null;

  let value = resolution;
  if (resolutionUnit && displayUnit) {
    const converted = convertUnitDelta(resolution, resolutionUnit, displayUnit);
    if (converted != null && converted > 0) {
      value = converted;
    }
  }

  // Strip floating-point noise introduced by unit conversion before counting
  // fractional digits (e.g. 500 g -> 0.5 kg stays exact, but guards arithmetic).
  const normalized = Number(value.toPrecision(12));
  const text = String(normalized);

  const exponentMatch = text.match(/e-(\d+)/i);
  if (exponentMatch?.[1]) {
    return Number.parseInt(exponentMatch[1], 10);
  }

  const fractional = text.split(".")[1];
  return fractional ? fractional.length : 0;
}
