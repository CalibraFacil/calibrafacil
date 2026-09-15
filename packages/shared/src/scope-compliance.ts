/**
 * Accredited-scope (CMC) compliance gate — ISO/IEC 17025 §7.6 / §7.8.3, ILAC
 * P14 (#427, Phase 0).
 *
 * An accredited certificate must never report an expanded uncertainty smaller
 * than the laboratory's published CMC ("not less than" — ILAC P14 §6), nor
 * calibrate a point outside the accredited scope while carrying the
 * accreditation symbol. This module is the pure, side-effect-free core shared
 * by cloud (`apps/api`) and desktop so both modes classify identically:
 *
 *  - {@link extractScopeEvaluationPoints} — pulls (point, U, k) tuples out of
 *    a job's frozen `data`/`results` using the method snapshot's formula
 *    metadata (`reporting.role`), with well-known-key fallbacks for legacy
 *    snapshots.
 *  - {@link evaluateScopeCompliance} — compares each point against the
 *    scope lines and classifies PASS / OUT_OF_SCOPE / U_BELOW_CMC.
 *
 * Callers gate on `shouldRenderAccreditationSeal(...)` first — the guard
 * applies only to *accredited* issuance (see accreditation.ts).
 */

import {
  convertUnitDelta,
  convertUnitValue,
  parseNumericValue,
} from "./units/convert";
import {
  canonicalUnitFor,
  unitKind,
  type QuantityKind,
} from "./units/registry";

export type CmcExpressionType = "fixed" | "linear";

/**
 * pt-BR display names for the registry's quantity kinds — the single source
 * for the scope settings UI and the expiry notifications, so the same line
 * never reads "Massa" in one surface and a raw token in another.
 */
export const QUANTITY_KIND_OPTIONS_PT: ReadonlyArray<{
  value: QuantityKind;
  label: string;
}> = [
  { value: "mass", label: "Massa" },
  { value: "length", label: "Comprimento" },
  { value: "temperature", label: "Temperatura" },
  { value: "pressure", label: "Pressão" },
  { value: "volume", label: "Volume" },
  { value: "time", label: "Tempo" },
  { value: "torque", label: "Torque" },
  { value: "humidity", label: "Umidade" },
  { value: "force", label: "Força" },
  { value: "voltage", label: "Tensão elétrica" },
  { value: "current", label: "Corrente elétrica" },
  { value: "resistance", label: "Resistência elétrica" },
  { value: "frequency", label: "Frequência" },
];

export function quantityKindLabelPt(kind: string): string {
  return (
    QUANTITY_KIND_OPTIONS_PT.find((option) => option.value === kind)?.label ??
    kind
  );
}

/**
 * Org-level guard behavior (#427 Phase 1). Labs start in `warn` (Phase 0
 * classification only) and opt into `enforce` after trusting the output:
 * enforce blocks accredited approval on OUT_OF_SCOPE/U_BELOW_CMC unless a
 * documented override downgrades the issuance to non-accredited.
 */
export type ScopeEnforcementMode = "warn" | "enforce";

/**
 * One line of the lab's accredited scope (grandeza × faixa × CMC), as
 * published by Cgcre. A CMC "table" over sub-ranges is just multiple lines.
 *
 * CMC(x) = cmcA + cmcB·|x|, with x expressed in `rangeUnit` and the result in
 * `cmcUnit` (so cmcB carries cmcUnit-per-rangeUnit; a percent-of-reading CMC
 * maps onto cmcB with cmcA = 0). `cmcType: "fixed"` ignores cmcB.
 */
export type AccreditedScopeLineLike = {
  id?: number | null;
  quantityKind: string;
  rangeMin: number;
  rangeMax: number;
  rangeUnit: string;
  cmcType: string;
  cmcA: number;
  cmcB?: number | null;
  cmcUnit: string;
  /** Coverage factor the CMC is stated at (ILAC P14: k=2 / ~95 %). */
  coverageFactor?: number | null;
  /** Vigência window; null bounds impose no constraint (mirrors #647). */
  validFrom?: Date | string | null;
  validUntil?: Date | string | null;
};

/** One calibrated point with its reported expanded uncertainty. */
export type ScopeEvaluationPoint = {
  /** Calibrated point (nominal/reference value), in `unit`. */
  value: number;
  unit: string;
  /** Reported expanded uncertainty, in `uncertaintyUnit`, at `coverageFactor`. */
  expandedUncertainty: number;
  uncertaintyUnit: string;
  /** Coverage factor of the reported U; defaults to 2 when absent. */
  coverageFactor?: number | null;
};

export type ScopeComplianceStatus =
  | "PASS"
  | "OUT_OF_SCOPE"
  | "U_BELOW_CMC"
  | "NOT_EVALUATED";

export type ScopeComplianceFinding = {
  /** `not_evaluated` = the point matched a line but its U could not be compared (unit mismatch); never adverse, always surfaced. */
  kind: "out_of_scope" | "u_below_cmc" | "not_evaluated";
  pointValue: number;
  pointUnit: string;
  /** Reported U normalized to k=2 and rounded to 2 significant digits, in `cmcUnit` (u_below_cmc only). */
  reportedU: number | null;
  cmcValue: number | null;
  cmcUnit: string | null;
  scopeLineId: number | null;
  message: string;
};

export type ScopeComplianceResult = {
  status: ScopeComplianceStatus;
  findings: ScopeComplianceFinding[];
  /** Points that were actually compared against a scope line. */
  pointsEvaluated: number;
  pointsTotal: number;
};

function toDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isScopeLineActive(line: AccreditedScopeLineLike, atDate: Date) {
  const from = toDate(line.validFrom);
  const until = toDate(line.validUntil);
  if (from && atDate < from) return false;
  if (until && atDate > until) return false;
  return true;
}

/**
 * Round half-up to `digits` significant digits — the ILAC P14 reporting form
 * for expanded uncertainty (at most 2 significant digits). The comparison runs
 * on this value so a U that rounds to the CMC is not flagged over float dust.
 */
export function roundToSignificantDigits(
  value: number,
  digits: number,
): number {
  if (!Number.isFinite(value) || value === 0) return value;
  const magnitude = Math.floor(Math.log10(Math.abs(value)));
  const factor = 10 ** (digits - 1 - magnitude);
  return Math.round(value * factor) / factor;
}

/** CMC at a point, with the point already expressed in the line's rangeUnit. */
export function cmcAtPoint(
  line: AccreditedScopeLineLike,
  valueInRangeUnit: number,
): number {
  if (line.cmcType === "linear") {
    return line.cmcA + (line.cmcB ?? 0) * Math.abs(valueInRangeUnit);
  }
  return line.cmcA;
}

/** Relative epsilon so unit-conversion float noise never flips a verdict. */
const REL_EPSILON = 1e-9;

function withinRange(value: number, min: number, max: number): boolean {
  const span = Math.max(Math.abs(min), Math.abs(max), 1);
  const eps = span * REL_EPSILON;
  return value >= min - eps && value <= max + eps;
}

/**
 * Classify a job's calibrated points against the accredited scope.
 *
 * Semantics (ILAC P14 / Cgcre):
 *  - Range bounds are inclusive; U == CMC passes ("not less than").
 *  - Reported U is normalized to k=2 (CMCs are stated at k=2) and rounded to
 *    2 significant digits before comparing.
 *  - A point passes when ANY matching, in-vigência line has CMC ≤ U.
 *  - A point whose unit kind or value matches no line is out of scope.
 *  - Points whose U cannot be resolved against a matching line's unit are
 *    skipped (counted in pointsTotal, not pointsEvaluated).
 */
export function evaluateScopeCompliance(input: {
  scopeLines: readonly AccreditedScopeLineLike[];
  points: readonly ScopeEvaluationPoint[];
  atDate?: Date;
}): ScopeComplianceResult {
  const atDate = input.atDate ?? /* @__PURE__ */ new Date();
  const activeLines = input.scopeLines.filter((line) =>
    isScopeLineActive(line, atDate),
  );

  const findings: ScopeComplianceFinding[] = [];
  let pointsEvaluated = 0;

  for (const point of input.points) {
    const pointKind = unitKind(point.unit);

    const matching = activeLines.flatMap((line) => {
      if (pointKind === null || line.quantityKind !== pointKind) return [];
      const valueInRangeUnit = convertUnitValue(
        point.value,
        point.unit,
        line.rangeUnit,
      );
      if (valueInRangeUnit == null) return [];
      if (!withinRange(valueInRangeUnit, line.rangeMin, line.rangeMax)) {
        return [];
      }
      return [{ line, valueInRangeUnit }];
    });

    if (matching.length === 0) {
      findings.push({
        kind: "out_of_scope",
        pointValue: point.value,
        pointUnit: point.unit,
        reportedU: null,
        cmcValue: null,
        cmcUnit: null,
        scopeLineId: null,
        message: `Ponto ${point.value} ${point.unit} fora do escopo acreditado (nenhuma linha de escopo cobre este ponto).`,
      });
      continue;
    }

    // Compare against every matching line; keep the most favorable (smallest
    // CMC) for the finding when none passes.
    let best: {
      line: AccreditedScopeLineLike;
      cmc: number;
      reportedU: number;
    } | null = null;
    let passed = false;

    for (const { line, valueInRangeUnit } of matching) {
      // The line's CMC is stated at line.coverageFactor (ILAC P14 publishes
      // k=2, but the field is an API input); normalize to k=2 so the
      // comparison and the reported values share one coverage.
      const lineK =
        line.coverageFactor != null &&
        Number.isFinite(line.coverageFactor) &&
        line.coverageFactor > 0
          ? line.coverageFactor
          : 2;
      const cmc = (cmcAtPoint(line, valueInRangeUnit) / lineK) * 2;
      const uInCmcUnit = convertUnitDelta(
        point.expandedUncertainty,
        point.uncertaintyUnit,
        line.cmcUnit,
      );
      if (uInCmcUnit == null) continue;

      const k = point.coverageFactor ?? 2;
      const uAtK2 =
        Number.isFinite(k) && k > 0 ? (uInCmcUnit / k) * 2 : uInCmcUnit;
      const reportedU = roundToSignificantDigits(uAtK2, 2);

      if (best === null || cmc < best.cmc) {
        best = { line, cmc, reportedU };
      }
      if (reportedU >= cmc - Math.abs(cmc) * REL_EPSILON) {
        passed = true;
        break;
      }
    }

    if (best === null) {
      // Matched a range but no line's CMC unit was resolvable against the
      // reported U — cannot classify this point. Never a silent skip: the
      // signer must know part of the job went unchecked.
      findings.push({
        kind: "not_evaluated",
        pointValue: point.value,
        pointUnit: point.unit,
        reportedU: null,
        cmcValue: null,
        cmcUnit: null,
        scopeLineId: null,
        message: `Ponto ${point.value} ${point.unit} não pôde ser comparado ao escopo (incerteza em unidade incompatível com a CMC da linha). Verifique manualmente.`,
      });
      continue;
    }

    pointsEvaluated += 1;
    if (!passed) {
      findings.push({
        kind: "u_below_cmc",
        pointValue: point.value,
        pointUnit: point.unit,
        reportedU: best.reportedU,
        cmcValue: best.cmc,
        cmcUnit: best.line.cmcUnit,
        scopeLineId: best.line.id ?? null,
        message: `Incerteza reportada (${best.reportedU} ${best.line.cmcUnit}, k=2) menor que a CMC acreditada (${best.cmc} ${best.line.cmcUnit}) no ponto ${point.value} ${point.unit}.`,
      });
    }
  }

  const hasOutOfScope = findings.some((f) => f.kind === "out_of_scope");
  const hasBelowCmc = findings.some((f) => f.kind === "u_below_cmc");

  const status: ScopeComplianceStatus = hasOutOfScope
    ? "OUT_OF_SCOPE"
    : hasBelowCmc
      ? "U_BELOW_CMC"
      : pointsEvaluated > 0
        ? "PASS"
        : "NOT_EVALUATED";

  return {
    status,
    findings,
    pointsEvaluated,
    pointsTotal: input.points.length,
  };
}

// =============================================================================
// Extraction — frozen job data/results → ScopeEvaluationPoint[]
// =============================================================================

/** Structural view of MethodSnapshot.formulas (packages/db). */
export type ScopeFormulaLike = {
  outputKey: string;
  unit?: string | null;
  scope?: { kind?: string; tableKey?: string } | null;
  reporting?: { role?: string | null; group?: string | null } | null;
};

/** Structural view of MethodSnapshot.dataFields (packages/db). */
export type ScopeDataFieldLike = {
  key: string;
  type?: string;
  unit?: string | null;
  columns?:
    | readonly { key: string; unit?: string | null; type?: string }[]
    | null;
  weighingRangeResolver?: {
    pointColumn?: string | null;
    pointUnit?: string | null;
  } | null;
};

/** Flatten nested result arrays into finite numbers (matches the dashboard). */
function numericValues(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => numericValues(item));
  }
  const parsed = parseNumericValue(value);
  return parsed === null ? [] : [parsed];
}

/**
 * Per-index numeric parse that PRESERVES positions (null = unresolvable).
 * Pairing rows[i] with series[i] must never compact away null entries —
 * a filtered flatten would shift every later uncertainty onto the wrong
 * point. Nested single-element cells keep their slot; anything else is null.
 */
function numericSeries(value: unknown): (number | null)[] {
  if (!Array.isArray(value)) {
    const single = parseNumericValue(value);
    return single === null ? [] : [single];
  }
  return value.map((item) => {
    if (Array.isArray(item)) {
      const flat = numericValues(item);
      return flat.length === 1 ? (flat[0] ?? null) : null;
    }
    return parseNumericValue(item);
  });
}

/**
 * The unit stored job values are actually in. `normalizeMethodDataForStorage`
 * (and the engine pipeline behind `results`) persist every value whose
 * declared unit shares the ASSET base unit's kind in that kind's CANONICAL
 * unit — the declared token is display metadata only. Values of other kinds
 * (or when no base unit exists, i.e. nothing was normalized) stay literal.
 */
function storedUnitFor(
  declaredUnit: string | null | undefined,
  assetBaseUnit: string | null | undefined,
): string | null {
  const declared = declaredUnit ?? assetBaseUnit ?? null;
  if (declared == null) return null;
  const kind = unitKind(declared);
  const baseKind = unitKind(assetBaseUnit);
  if (kind !== null && baseKind !== null && kind === baseKind) {
    return canonicalUnitFor(kind);
  }
  return declared;
}

/**
 * Point-column preference for table-scoped methods when the method does not
 * declare a weighing-range resolver: the conventional/nominal value columns
 * used by the built-in templates.
 */
const PREFERRED_POINT_COLUMNS = [
  "valor_padrao",
  "carga_nominal",
  "valor_nominal",
  "ponto_calibracao",
  "ponto",
];

function tableKeyOf(formula: ScopeFormulaLike): string | null {
  const scope = formula.scope;
  if (scope && scope.kind === "table_row" && scope.tableKey) {
    return scope.tableKey;
  }
  return null;
}

function isReportedExpandedUncertainty(formula: ScopeFormulaLike): boolean {
  const reporting = formula.reporting;
  if (reporting?.role === "expanded_uncertainty") {
    // `uncertainty_budget` rows carry intermediate combined/expanded terms;
    // only the calibration_result group is what the certificate reports.
    return reporting.group == null || reporting.group === "calibration_result";
  }
  return false;
}

function suffixRank(outputKey: string): number {
  // The certificate reports the as-left value when present.
  if (outputKey.endsWith("_apos")) return 0;
  if (outputKey.endsWith("_antes")) return 1;
  return 2;
}

/**
 * Extract (point, U, k) tuples from a job's frozen `data`/`results` using the
 * method snapshot metadata. Role-driven (`reporting.role`), with well-known
 * key fallbacks (`incerteza_expandida_*`, `fator_k_*`) for legacy snapshots.
 * Returns [] when the method emits no per-point expanded uncertainty.
 */
export function extractScopeEvaluationPoints(input: {
  data: Record<string, unknown> | null | undefined;
  results: Record<string, unknown> | null | undefined;
  formulas: readonly ScopeFormulaLike[];
  dataFields: readonly ScopeDataFieldLike[];
  /** Asset base unit, used when neither column nor formula declares one. */
  fallbackUnit?: string | null;
}): ScopeEvaluationPoint[] {
  const results = input.results ?? {};
  const data = input.data ?? {};

  let uFormulas = input.formulas.filter(isReportedExpandedUncertainty);
  if (uFormulas.length === 0) {
    uFormulas = input.formulas.filter((f) =>
      /(^|_)incerteza_expandida(_|$)/.test(f.outputKey),
    );
  }

  // ONE reported series per table, but EVERY uncertainty-bearing table is
  // evaluated — a violation in a second table (e.g. a separate range or
  // eccentricity table with its own U) must not hide behind the first.
  // Within a table the as-left (_apos) series wins over as-found (_antes).
  const seriesByTable = new Map<
    string,
    { formula: ScopeFormulaLike; values: (number | null)[] }
  >();
  const ranked = uFormulas
    .map((formula) => ({
      formula,
      values: numericSeries(results[formula.outputKey]),
    }))
    .filter((entry) => entry.values.some((value) => value !== null))
    .sort(
      (a, b) =>
        suffixRank(a.formula.outputKey) - suffixRank(b.formula.outputKey),
    );
  for (const entry of ranked) {
    const tableKey = tableKeyOf(entry.formula);
    if (!tableKey || seriesByTable.has(tableKey)) continue;
    seriesByTable.set(tableKey, entry);
  }

  const points: ScopeEvaluationPoint[] = [];
  for (const [tableKey, chosen] of seriesByTable) {
    points.push(
      ...extractPointsForTable({
        tableKey,
        chosen,
        data,
        results,
        formulas: input.formulas,
        dataFields: input.dataFields,
        fallbackUnit: input.fallbackUnit ?? null,
      }),
    );
  }
  return points;
}

function extractPointsForTable(params: {
  tableKey: string;
  chosen: { formula: ScopeFormulaLike; values: (number | null)[] };
  data: Record<string, unknown>;
  results: Record<string, unknown>;
  formulas: readonly ScopeFormulaLike[];
  dataFields: readonly ScopeDataFieldLike[];
  fallbackUnit: string | null;
}): ScopeEvaluationPoint[] {
  const { tableKey, chosen, data, results, formulas, dataFields } = params;

  const dataField = dataFields.find((field) => field.key === tableKey);
  const rowsRaw = data[tableKey];
  const rows = Array.isArray(rowsRaw) ? rowsRaw : [];

  const columns = dataField?.columns ?? [];
  const resolverColumn = dataField?.weighingRangeResolver?.pointColumn ?? null;
  const pointColumnKey =
    resolverColumn ??
    PREFERRED_POINT_COLUMNS.find((key) =>
      columns.some((column) => column.key === key),
    ) ??
    columns.find((column) => column.type === "number")?.key ??
    null;
  if (!pointColumnKey) return [];

  const pointColumn = columns.find((column) => column.key === pointColumnKey);
  const declaredPointUnit =
    pointColumn?.unit ??
    dataField?.weighingRangeResolver?.pointUnit ??
    params.fallbackUnit ??
    null;
  // Stored values are canonical whenever the declared unit shares the asset
  // base kind (see storedUnitFor) — labeling them with the declared token
  // would misclassify by the conversion factor (e.g. 200 kg stored as
  // 200000 g must not be read as "200000 kg").
  const pointUnit = storedUnitFor(declaredPointUnit, params.fallbackUnit);
  if (!pointUnit) return [];

  const uncertaintyUnit =
    storedUnitFor(
      chosen.formula.unit ?? declaredPointUnit,
      params.fallbackUnit,
    ) ?? pointUnit;

  // Coverage-factor series for the same table, matching the antes/apos phase
  // of the chosen U formula when both phases exist.
  const wantedRank = suffixRank(chosen.formula.outputKey);
  let kFormulas = formulas.filter(
    (f) =>
      tableKeyOf(f) === tableKey && f.reporting?.role === "coverage_factor",
  );
  if (kFormulas.length === 0) {
    kFormulas = formulas.filter(
      (f) =>
        tableKeyOf(f) === tableKey && /(^|_)fator_k(_|$)/.test(f.outputKey),
    );
  }
  const kFormula =
    kFormulas.find((f) => suffixRank(f.outputKey) === wantedRank) ??
    kFormulas[0] ??
    null;
  const kValues = kFormula ? numericSeries(results[kFormula.outputKey]) : [];

  const points: ScopeEvaluationPoint[] = [];
  const count = Math.min(rows.length, chosen.values.length);
  for (let i = 0; i < count; i += 1) {
    const row = rows[i];
    if (typeof row !== "object" || row === null) continue;
    const record: Record<string, unknown> = { ...row };
    const value = parseNumericValue(record[pointColumnKey]);
    const expandedUncertainty = chosen.values[i];
    if (value == null || expandedUncertainty == null) continue;
    points.push({
      value,
      unit: pointUnit,
      expandedUncertainty,
      uncertaintyUnit,
      coverageFactor: kValues[i] ?? null,
    });
  }

  return points;
}
