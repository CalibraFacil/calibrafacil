/**
 * Quantity-kind-aware unit registry.
 *
 * This is the dependency root of the unit system. It owns the canonical
 * storage-at-rest unit for each quantity kind, the conversion factors/offsets,
 * and the alias normalization used to turn user/seed tokens into a stable
 * {@link MeasurementUnit}.
 *
 * Scope note: an asset's `baseMeasurementUnit` is a *single* unit — the
 * instrument's primary indication unit. Multi-kind assets (e.g. a
 * termohigrômetro indicating both °C and %RH) only convert fields that share
 * the base unit's kind; fields of other kinds are displayed in their literal
 * column units. See {@link normalizeSpecificationsForStorage} and friends.
 *
 * The math engine, certificate template engine, DB schema and stored method
 * JSON keys remain unit-unaware — this registry never renames stored keys and
 * only ever *widens* the accepted token set, so old snapshots keep parsing.
 */

export type QuantityKind =
  | "mass"
  | "length"
  | "temperature"
  | "pressure"
  | "volume"
  | "time"
  | "torque"
  | "humidity"
  | "force"
  // Electrical is modelled as three separate kinds on purpose: volt, ampere and
  // ohm are different dimensions and must never inter-convert. The single
  // `electrical` reference-standard kind maps to all three (see
  // reference-standard-kind-map.ts).
  | "voltage"
  | "current"
  | "resistance"
  | "frequency";

export type MeasurementUnit =
  // mass
  | "mg"
  | "g"
  | "kg"
  // length
  | "µm"
  | "mm"
  | "cm"
  | "m"
  // temperature
  | "°C"
  | "°F"
  | "K"
  // pressure
  | "Pa"
  | "kPa"
  | "MPa"
  | "bar"
  | "psi"
  | "kgf/cm²"
  | "mmHg"
  | "inHg"
  // volume
  | "µL"
  | "mL"
  | "L"
  // time
  | "ms"
  | "s"
  | "min"
  | "h"
  // torque
  | "N·m"
  | "kgf·m"
  // humidity
  | "%RH"
  // force
  | "N"
  | "kN"
  | "kgf"
  // voltage
  | "µV"
  | "mV"
  | "V"
  | "kV"
  // current
  | "µA"
  | "mA"
  | "A"
  // resistance (Ω = U+03A9; milliohm omitted to avoid the milli/mega
  // lowercase-alias collision with MΩ)
  | "Ω"
  | "kΩ"
  | "MΩ"
  // frequency (rpm folded in: 1 rpm = 1/60 Hz)
  | "Hz"
  | "kHz"
  | "MHz"
  | "rpm";

/**
 * Conversion definition to the kind's canonical unit. Affine (offset-bearing)
 * conversions are used by temperature only — every other kind is factor-only
 * so absolute and delta conversions coincide for them.
 */
export type UnitDef =
  | { kind: QuantityKind; toCanonical: { factor: number } }
  | { kind: QuantityKind; toCanonical: { factor: number; offset: number } };

/**
 * Canonical storage-at-rest unit per kind. These are permanent: stored values
 * are persisted in the canonical unit, so changing one would reinterpret
 * existing data. Free choices were made while no non-mass data exists, but the
 * mass canonical (`g`) is immutable for back-compat.
 */
export const CANONICAL_BY_KIND = {
  mass: "g",
  length: "mm",
  temperature: "°C",
  pressure: "kPa",
  volume: "µL",
  time: "s",
  torque: "N·m",
  humidity: "%RH",
  force: "N",
  voltage: "V",
  current: "A",
  resistance: "Ω",
  frequency: "Hz",
} as const satisfies Record<QuantityKind, MeasurementUnit>;

export const UNIT_REGISTRY = {
  // mass — canonical g
  mg: { kind: "mass", toCanonical: { factor: 0.001 } },
  g: { kind: "mass", toCanonical: { factor: 1 } },
  kg: { kind: "mass", toCanonical: { factor: 1000 } },
  // length — canonical mm
  "µm": { kind: "length", toCanonical: { factor: 0.001 } },
  mm: { kind: "length", toCanonical: { factor: 1 } },
  cm: { kind: "length", toCanonical: { factor: 10 } },
  m: { kind: "length", toCanonical: { factor: 1000 } },
  // temperature — canonical °C (affine)
  "°C": { kind: "temperature", toCanonical: { factor: 1, offset: 0 } },
  "°F": { kind: "temperature", toCanonical: { factor: 5 / 9, offset: -160 / 9 } },
  K: { kind: "temperature", toCanonical: { factor: 1, offset: -273.15 } },
  // pressure — canonical kPa
  Pa: { kind: "pressure", toCanonical: { factor: 0.001 } },
  kPa: { kind: "pressure", toCanonical: { factor: 1 } },
  MPa: { kind: "pressure", toCanonical: { factor: 1000 } },
  bar: { kind: "pressure", toCanonical: { factor: 100 } },
  psi: { kind: "pressure", toCanonical: { factor: 6.894757293168361 } },
  "kgf/cm²": { kind: "pressure", toCanonical: { factor: 98.0665 } },
  mmHg: { kind: "pressure", toCanonical: { factor: 0.1333224 } },
  inHg: { kind: "pressure", toCanonical: { factor: 3.386389 } },
  // volume — canonical µL
  "µL": { kind: "volume", toCanonical: { factor: 1 } },
  mL: { kind: "volume", toCanonical: { factor: 1000 } },
  L: { kind: "volume", toCanonical: { factor: 1000000 } },
  // time — canonical s
  ms: { kind: "time", toCanonical: { factor: 0.001 } },
  s: { kind: "time", toCanonical: { factor: 1 } },
  min: { kind: "time", toCanonical: { factor: 60 } },
  h: { kind: "time", toCanonical: { factor: 3600 } },
  // torque — canonical N·m
  "N·m": { kind: "torque", toCanonical: { factor: 1 } },
  "kgf·m": { kind: "torque", toCanonical: { factor: 9.80665 } },
  // humidity — canonical %RH (single-unit kind, identity conversion)
  "%RH": { kind: "humidity", toCanonical: { factor: 1 } },
  // force — canonical N
  N: { kind: "force", toCanonical: { factor: 1 } },
  kN: { kind: "force", toCanonical: { factor: 1000 } },
  kgf: { kind: "force", toCanonical: { factor: 9.80665 } },
  // voltage — canonical V
  "µV": { kind: "voltage", toCanonical: { factor: 0.000001 } },
  mV: { kind: "voltage", toCanonical: { factor: 0.001 } },
  V: { kind: "voltage", toCanonical: { factor: 1 } },
  kV: { kind: "voltage", toCanonical: { factor: 1000 } },
  // current — canonical A
  "µA": { kind: "current", toCanonical: { factor: 0.000001 } },
  mA: { kind: "current", toCanonical: { factor: 0.001 } },
  A: { kind: "current", toCanonical: { factor: 1 } },
  // resistance — canonical Ω
  "Ω": { kind: "resistance", toCanonical: { factor: 1 } },
  "kΩ": { kind: "resistance", toCanonical: { factor: 1000 } },
  "MΩ": { kind: "resistance", toCanonical: { factor: 1000000 } },
  // frequency — canonical Hz
  Hz: { kind: "frequency", toCanonical: { factor: 1 } },
  kHz: { kind: "frequency", toCanonical: { factor: 1000 } },
  MHz: { kind: "frequency", toCanonical: { factor: 1000000 } },
  rpm: { kind: "frequency", toCanonical: { factor: 1 / 60 } },
} as const satisfies Record<MeasurementUnit, UnitDef>;

const ALL_UNITS: MeasurementUnit[] = Object.keys(UNIT_REGISTRY).filter(
  isMeasurementUnit,
);

/** Ordered list of every registry token (storage tokens, not aliases). */
export const MEASUREMENT_UNITS: readonly MeasurementUnit[] = ALL_UNITS;

export function isMeasurementUnit(value: unknown): value is MeasurementUnit {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(UNIT_REGISTRY, value)
  );
}

export function unitKind(unit: unknown): QuantityKind | null {
  const normalized = normalizeUnitToken(unit);
  return normalized ? UNIT_REGISTRY[normalized].kind : null;
}

export function isUnitOfKind(unit: unknown, kind: QuantityKind): boolean {
  return unitKind(unit) === kind;
}

export function canonicalUnitFor(kind: QuantityKind): MeasurementUnit {
  return CANONICAL_BY_KIND[kind];
}

export function unitsForKind(kind: QuantityKind): MeasurementUnit[] {
  return ALL_UNITS.filter((unit) => UNIT_REGISTRY[unit].kind === kind);
}

/**
 * Case-sensitive aliases, checked before lowercasing. These exist because some
 * tokens are case-significant and must not collide with lowercased variants:
 * the Unicode masculine-ordinal ` º` (U+00BA) vs the degree sign `°` (U+00B0),
 * and bare `C`/`F` for Celsius/Fahrenheit.
 */
const EXACT_ALIASES: Record<string, MeasurementUnit> = {
  "ºC": "°C",
  "ºF": "°F",
  C: "°C",
  F: "°F",
};

/**
 * Lowercased aliases. Keys are the lowercased form of the input. The ASCII
 * `u` → micro `µ` mapping (`um` → µm, `ul` → µL) and the Greek mu `μ`
 * (U+03BC) → micro `µ` (U+00B5) mapping live here. Composite tokens are
 * deliberately absent so they normalize to `null` (see normalizeUnitToken).
 */
const LOWER_ALIASES: Record<string, MeasurementUnit> = {
  // mass
  mg: "mg",
  g: "g",
  kg: "kg",
  // length
  "µm": "µm",
  "μm": "µm",
  um: "µm",
  mm: "mm",
  cm: "cm",
  m: "m",
  // temperature
  "°c": "°C",
  "ºc": "°C",
  celsius: "°C",
  "°f": "°F",
  "ºf": "°F",
  fahrenheit: "°F",
  k: "K",
  kelvin: "K",
  // pressure
  pa: "Pa",
  kpa: "kPa",
  mpa: "MPa",
  bar: "bar",
  psi: "psi",
  "kgf/cm²": "kgf/cm²",
  "kgf/cm2": "kgf/cm²",
  "kgf/cm^2": "kgf/cm²",
  mmhg: "mmHg",
  inhg: "inHg",
  // volume
  "µl": "µL",
  "μl": "µL",
  ul: "µL",
  ml: "mL",
  l: "L",
  // time
  ms: "ms",
  s: "s",
  sec: "s",
  min: "min",
  h: "h",
  hr: "h",
  // torque
  "n·m": "N·m",
  "n.m": "N·m",
  nm: "N·m",
  "n m": "N·m",
  "kgf·m": "kgf·m",
  "kgf.m": "kgf·m",
  kgfm: "kgf·m",
  "kgf m": "kgf·m",
  // humidity
  "%rh": "%RH",
  "% rh": "%RH",
  "%ur": "%RH",
  // force
  n: "N",
  newton: "N",
  newtons: "N",
  kn: "kN",
  kgf: "kgf",
  kgforca: "kgf",
  // voltage
  "µv": "µV",
  "μv": "µV",
  uv: "µV",
  mv: "mV",
  v: "V",
  volt: "V",
  volts: "V",
  kv: "kV",
  // current
  "µa": "µA",
  "μa": "µA",
  ua: "µA",
  ma: "mA",
  a: "A",
  amp: "A",
  amps: "A",
  ampere: "A",
  amperes: "A",
  // resistance (bare `mω` is deliberately absent — it is ambiguous between
  // milliohm and megaohm under lowercasing; type the `MΩ` symbol or `megohm`)
  "ω": "Ω",
  ohm: "Ω",
  ohms: "Ω",
  "kω": "kΩ",
  kohm: "kΩ",
  megohm: "MΩ",
  megaohm: "MΩ",
  // frequency
  hz: "Hz",
  hertz: "Hz",
  khz: "kHz",
  mhz: "MHz",
  rpm: "rpm",
};

/**
 * Normalize an arbitrary token into a {@link MeasurementUnit} via an explicit
 * alias map (never regexes / prefix matching). Returns `null` for unknown,
 * empty, kind-less or composite tokens.
 *
 * Deliberate `null` cases:
 *  - bare `%` — percent-error formulas must stay unconverted.
 *  - `µm/(m·K)` (bloco-padrão linear-expansion) — a composite token; the
 *    exact-match maps prevent it from being mistaken for `µm`.
 */
export function normalizeUnitToken(unit: unknown): MeasurementUnit | null {
  if (typeof unit !== "string") return null;
  const trimmed = unit.trim();
  if (trimmed === "") return null;

  if (isMeasurementUnit(trimmed)) return trimmed;

  const exact = EXACT_ALIASES[trimmed];
  if (exact) return exact;

  const lower = trimmed.toLowerCase();
  const alias = LOWER_ALIASES[lower];
  return alias ?? null;
}
