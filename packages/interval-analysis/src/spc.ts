/**
 * Statistical process control for check/working-standard monitoring
 * (ISO/IEC 17025 §7.7.1, issue #60). Pure + deterministic — same style as
 * `analyzeInterval`: typed result, engine version, provenance fingerprint.
 *
 * I-MR is the default chart: check-standard monitoring usually yields one
 * reading per run (n=1), which X-bar/R cannot chart. Constants and rule
 * definitions per NIST/SEMATECH e-Handbook §6.3.2 and the Western Electric
 * zone rules. Each rule is individually toggleable: WECO all-on raises the
 * in-control false-alarm rate to ~1/92 points vs ~1/371 for 3σ-only.
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

export const SPC_ENGINE_VERSION = "0.1.0";

export type SpcChartType = "i_mr" | "xbar_r" | "cusum" | "ewma";

export type SpcStatus =
  | "insufficient_data"
  | "in_control"
  | "trending"
  | "out_of_control";

export type SpcRuleId =
  | "weco_1_beyond_3sigma"
  | "weco_2_of_3_beyond_2sigma"
  | "weco_4_of_5_beyond_1sigma"
  | "weco_8_consecutive_same_side"
  | "trend_6_monotonic"
  | "trend_14_alternating"
  | "cusum_signal"
  | "ewma_beyond_limits";

export const ALL_SPC_RULES: readonly SpcRuleId[] = [
  "weco_1_beyond_3sigma",
  "weco_2_of_3_beyond_2sigma",
  "weco_4_of_5_beyond_1sigma",
  "weco_8_consecutive_same_side",
  "trend_6_monotonic",
  "trend_14_alternating",
  "cusum_signal",
  "ewma_beyond_limits",
];

export type SpcRuleHit = {
  rule: SpcRuleId;
  severity: "trending" | "out_of_control";
  /** Chronological indices into the plotted-statistic sequence. */
  pointIndices: number[];
  description: string;
};

export type SpcChartParams = {
  /** Points used to estimate centerline/sigma (default: all, capped at 25). */
  baselineWindow?: number | null;
  /** Frozen centerline/sigma — when set, estimation is skipped. */
  centerline?: number | null;
  sigma?: number | null;
  /** Subgroup size for X-bar/R (consecutive readings; default 5, range 2–10). */
  subgroupSize?: number | null;
  /** CUSUM reference value k and decision interval h, in sigma units. */
  cusumK?: number | null;
  cusumH?: number | null;
  /** EWMA smoothing constant λ and limit width in sigmas. */
  ewmaLambda?: number | null;
  ewmaK?: number | null;
  enabledRules?: readonly string[] | null;
};

export type SpcLimits = {
  centerline: number;
  sigma: number;
  ucl: number;
  lcl: number;
  /** Secondary (MR / R) chart limits when applicable. */
  secondaryUcl?: number | null;
  secondaryLcl?: number | null;
};

export type SpcEvaluation = {
  engineVersion: string;
  fingerprint: string;
  status: SpcStatus;
  sampleSize: number;
  limits?: SpcLimits | null;
  ruleHits: SpcRuleHit[];
  evaluatedAt?: string | null;
};

/** Fewer plotted points than this ⇒ insufficient_data (limits too unstable). */
export const MIN_PLOTTED_POINTS = 8;
const DEFAULT_BASELINE_CAP = 25;

/**
 * Shewhart constants for subgroup sizes 2–10 (NIST e-Handbook §6.3.2.1):
 * d2 (mean-range → sigma), A2 (X-bar limits), D3/D4 (R-chart limits).
 */
const SHEWHART_CONSTANTS: Record<
  number,
  { d2: number; a2: number; d3: number; d4: number }
> = {
  2: { d2: 1.128, a2: 1.88, d3: 0, d4: 3.267 },
  3: { d2: 1.693, a2: 1.023, d3: 0, d4: 2.574 },
  4: { d2: 2.059, a2: 0.729, d3: 0, d4: 2.282 },
  5: { d2: 2.326, a2: 0.577, d3: 0, d4: 2.114 },
  6: { d2: 2.534, a2: 0.483, d3: 0, d4: 2.004 },
  7: { d2: 2.704, a2: 0.419, d3: 0.076, d4: 1.924 },
  8: { d2: 2.847, a2: 0.373, d3: 0.136, d4: 1.864 },
  9: { d2: 2.97, a2: 0.337, d3: 0.184, d4: 1.816 },
  10: { d2: 3.078, a2: 0.308, d3: 0.223, d4: 1.777 },
};

function mean(values: readonly number[]): number {
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

/**
 * I-MR limits from the mean moving range (NIST §6.3.2.2): individuals chart
 * x̄ ± 2.66·MR̄ (2.66 = 3/d2 for n=2), sigma estimate MR̄/1.128; MR chart
 * UCL = 3.267·MR̄, LCL = 0.
 */
export function iMrLimits(
  values: readonly number[],
  frozen?: { centerline?: number | null; sigma?: number | null },
): SpcLimits | null {
  if (values.length < 2) return null;
  const movingRanges: number[] = [];
  for (let i = 1; i < values.length; i += 1) {
    movingRanges.push(Math.abs((values[i] ?? 0) - (values[i - 1] ?? 0)));
  }
  const mrBar = mean(movingRanges);
  const centerline = frozen?.centerline ?? mean(values);
  const sigma = frozen?.sigma ?? mrBar / 1.128;
  return {
    centerline,
    sigma,
    ucl: centerline + 3 * sigma,
    lcl: centerline - 3 * sigma,
    secondaryUcl: 3.267 * mrBar,
    secondaryLcl: 0,
  };
}

/**
 * X-bar/R limits (NIST §6.3.2.1): x̿ ± A₂·R̄ and D₃·R̄ / D₄·R̄, over subgroup
 * means/ranges. `sigma` is the sigma of the PLOTTED statistic (A₂·R̄ / 3) so
 * the zone rules apply unchanged.
 */
export function xbarRLimits(
  subgroupMeans: readonly number[],
  subgroupRanges: readonly number[],
  subgroupSize: number,
  frozen?: { centerline?: number | null; sigma?: number | null },
): SpcLimits | null {
  const constants = SHEWHART_CONSTANTS[subgroupSize];
  if (!constants || subgroupMeans.length < 2) return null;
  const rBar = mean(subgroupRanges);
  const centerline = frozen?.centerline ?? mean(subgroupMeans);
  const sigma = frozen?.sigma ?? (constants.a2 * rBar) / 3;
  return {
    centerline,
    sigma,
    ucl: centerline + 3 * sigma,
    lcl: centerline - 3 * sigma,
    secondaryUcl: constants.d4 * rBar,
    secondaryLcl: constants.d3 * rBar,
  };
}

/** Western Electric zone rules + supplementary trend rules over a plotted series. */
export function detectRuleHits(
  values: readonly number[],
  centerline: number,
  sigma: number,
  enabledRules: readonly string[],
): SpcRuleHit[] {
  const hits: SpcRuleHit[] = [];
  if (!(sigma > 0)) return hits;
  const enabled = new Set(enabledRules);
  const z = values.map((v) => (v - centerline) / sigma);
  const side = z.map((v) => (v > 0 ? 1 : v < 0 ? -1 : 0));

  if (enabled.has("weco_1_beyond_3sigma")) {
    const indices = z.flatMap((v, i) => (Math.abs(v) > 3 ? [i] : []));
    if (indices.length > 0) {
      hits.push({
        rule: "weco_1_beyond_3sigma",
        severity: "out_of_control",
        pointIndices: indices,
        description: "Ponto além de 3σ do valor central",
      });
    }
  }

  if (enabled.has("weco_2_of_3_beyond_2sigma")) {
    const indices = new Set<number>();
    for (let i = 2; i < z.length; i += 1) {
      for (const s of [1, -1]) {
        const window = [i - 2, i - 1, i];
        const beyond = window.filter(
          (j) => (z[j] ?? 0) * s > 2 && side[j] === s,
        );
        if (beyond.length >= 2) beyond.forEach((j) => indices.add(j));
      }
    }
    if (indices.size > 0) {
      hits.push({
        rule: "weco_2_of_3_beyond_2sigma",
        severity: "out_of_control",
        pointIndices: [...indices].sort((a, b) => a - b),
        description: "2 de 3 pontos consecutivos além de 2σ do mesmo lado",
      });
    }
  }

  if (enabled.has("weco_4_of_5_beyond_1sigma")) {
    const indices = new Set<number>();
    for (let i = 4; i < z.length; i += 1) {
      for (const s of [1, -1]) {
        const window = [i - 4, i - 3, i - 2, i - 1, i];
        const beyond = window.filter(
          (j) => (z[j] ?? 0) * s > 1 && side[j] === s,
        );
        if (beyond.length >= 4) beyond.forEach((j) => indices.add(j));
      }
    }
    if (indices.size > 0) {
      hits.push({
        rule: "weco_4_of_5_beyond_1sigma",
        severity: "trending",
        pointIndices: [...indices].sort((a, b) => a - b),
        description: "4 de 5 pontos consecutivos além de 1σ do mesmo lado",
      });
    }
  }

  if (enabled.has("weco_8_consecutive_same_side")) {
    const indices = new Set<number>();
    let runStart = 0;
    for (let i = 1; i <= side.length; i += 1) {
      if (i === side.length || side[i] !== side[runStart] || side[i] === 0) {
        if (i - runStart >= 8 && side[runStart] !== 0) {
          for (let j = runStart; j < i; j += 1) indices.add(j);
        }
        runStart = i;
      }
    }
    if (indices.size > 0) {
      hits.push({
        rule: "weco_8_consecutive_same_side",
        severity: "trending",
        pointIndices: [...indices].sort((a, b) => a - b),
        description: "8 pontos consecutivos do mesmo lado do valor central",
      });
    }
  }

  if (enabled.has("trend_6_monotonic")) {
    const indices = new Set<number>();
    for (const dir of [1, -1]) {
      let runStart = 0;
      for (let i = 1; i <= values.length; i += 1) {
        const continues =
          i < values.length &&
          ((values[i] ?? 0) - (values[i - 1] ?? 0)) * dir > 0;
        if (!continues) {
          // Run of increments [runStart..i-1] ⇒ i - runStart points
          if (i - runStart >= 6) {
            for (let j = runStart; j < i; j += 1) indices.add(j);
          }
          runStart = i;
        }
      }
    }
    if (indices.size > 0) {
      hits.push({
        rule: "trend_6_monotonic",
        severity: "trending",
        pointIndices: [...indices].sort((a, b) => a - b),
        description: "6 pontos consecutivos em tendência crescente/decrescente",
      });
    }
  }

  if (enabled.has("trend_14_alternating")) {
    const indices = new Set<number>();
    let runStart = 0;
    for (let i = 2; i <= values.length; i += 1) {
      const d1 = (values[i - 1] ?? 0) - (values[i - 2] ?? 0);
      const d2 = i < values.length ? (values[i] ?? 0) - (values[i - 1] ?? 0) : 0;
      const alternates = i < values.length && d1 * d2 < 0;
      if (!alternates) {
        if (i - runStart >= 14) {
          for (let j = runStart; j < i; j += 1) indices.add(j);
        }
        runStart = i - 1;
      }
    }
    if (indices.size > 0) {
      hits.push({
        rule: "trend_14_alternating",
        severity: "trending",
        pointIndices: [...indices].sort((a, b) => a - b),
        description: "14 pontos consecutivos alternando acima/abaixo",
      });
    }
  }

  return hits;
}

/**
 * Tabular CUSUM (NIST §6.3.2.3): C⁺ᵢ = max(0, xᵢ − (μ₀ + kσ) + C⁺ᵢ₋₁),
 * C⁻ᵢ = max(0, (μ₀ − kσ) − xᵢ + C⁻ᵢ₋₁); signal when either exceeds hσ.
 * Defaults k = 0.5, h = 4.
 */
export function cusumSignals(
  values: readonly number[],
  mu0: number,
  sigma: number,
  k = 0.5,
  h = 4,
): number[] {
  if (!(sigma > 0)) return [];
  const indices: number[] = [];
  let cPlus = 0;
  let cMinus = 0;
  const allowance = k * sigma;
  const decision = h * sigma;
  for (let i = 0; i < values.length; i += 1) {
    const x = values[i] ?? 0;
    cPlus = Math.max(0, x - (mu0 + allowance) + cPlus);
    cMinus = Math.max(0, mu0 - allowance - x + cMinus);
    if (cPlus > decision || cMinus > decision) indices.push(i);
  }
  return indices;
}

/**
 * EWMA (NIST §6.3.2.4): zᵢ = λxᵢ + (1−λ)zᵢ₋₁ with exact time-varying limits
 * μ₀ ± Lσ√(λ/(2−λ)·(1−(1−λ)^{2i})). Defaults λ = 0.2, L = 3.
 */
export function ewmaSignals(
  values: readonly number[],
  mu0: number,
  sigma: number,
  lambda = 0.2,
  l = 3,
): number[] {
  if (!(sigma > 0) || !(lambda > 0) || lambda > 1) return [];
  const indices: number[] = [];
  let ewma = mu0;
  for (let i = 0; i < values.length; i += 1) {
    ewma = lambda * (values[i] ?? 0) + (1 - lambda) * ewma;
    const width =
      l *
      sigma *
      Math.sqrt(
        (lambda / (2 - lambda)) * (1 - Math.pow(1 - lambda, 2 * (i + 1))),
      );
    if (Math.abs(ewma - mu0) > width) indices.push(i);
  }
  return indices;
}

function spcFingerprint(
  values: readonly number[],
  chartType: SpcChartType,
  params: SpcChartParams,
): string {
  const canonical = JSON.stringify({
    v: SPC_ENGINE_VERSION,
    chartType,
    params: {
      baselineWindow: params.baselineWindow ?? null,
      centerline: params.centerline ?? null,
      sigma: params.sigma ?? null,
      subgroupSize: params.subgroupSize ?? null,
      cusumK: params.cusumK ?? null,
      cusumH: params.cusumH ?? null,
      ewmaLambda: params.ewmaLambda ?? null,
      ewmaK: params.ewmaK ?? null,
      enabledRules: params.enabledRules ?? null,
    },
    values,
  });
  return `sha256:${bytesToHex(sha256(utf8ToBytes(canonical)))}`;
}

/**
 * Evaluates a chronological reading series against the configured chart.
 * Baseline (centerline/sigma) is estimated from the first `baselineWindow`
 * plotted points (default: all, capped at 25) unless frozen values are given;
 * rules are then applied to the FULL series. Deterministic: same inputs ⇒
 * same fingerprint ⇒ same result (audit evidence for §7.7.1).
 */
export function evaluateChart(
  values: readonly number[],
  chartType: SpcChartType,
  params: SpcChartParams = {},
): SpcEvaluation {
  const fingerprint = spcFingerprint(values, chartType, params);
  const base = {
    engineVersion: SPC_ENGINE_VERSION,
    fingerprint,
  };
  const enabledRules = params.enabledRules ?? ALL_SPC_RULES;

  // Resolve the plotted statistic
  let plotted: number[] = [...values];
  let subgroupRanges: number[] | null = null;
  const subgroupSize = params.subgroupSize ?? 5;
  if (chartType === "xbar_r") {
    plotted = [];
    subgroupRanges = [];
    for (let i = 0; i + subgroupSize <= values.length; i += subgroupSize) {
      const group = values.slice(i, i + subgroupSize);
      plotted.push(mean(group));
      subgroupRanges.push(Math.max(...group) - Math.min(...group));
    }
  }

  if (plotted.length < MIN_PLOTTED_POINTS) {
    return {
      ...base,
      status: "insufficient_data",
      sampleSize: plotted.length,
      limits: null,
      ruleHits: [],
    };
  }

  const baselineCount = Math.min(
    params.baselineWindow ?? DEFAULT_BASELINE_CAP,
    plotted.length,
  );
  const frozen = {
    centerline: params.centerline ?? null,
    sigma: params.sigma ?? null,
  };

  let limits: SpcLimits | null;
  if (chartType === "xbar_r") {
    limits = xbarRLimits(
      plotted.slice(0, baselineCount),
      (subgroupRanges ?? []).slice(0, baselineCount),
      subgroupSize,
      frozen,
    );
  } else {
    limits = iMrLimits(plotted.slice(0, baselineCount), frozen);
  }

  if (!limits || !(limits.sigma > 0)) {
    return {
      ...base,
      status: "insufficient_data",
      sampleSize: plotted.length,
      limits,
      ruleHits: [],
    };
  }

  const ruleHits = detectRuleHits(
    plotted,
    limits.centerline,
    limits.sigma,
    enabledRules,
  );

  if (chartType === "cusum" && new Set(enabledRules).has("cusum_signal")) {
    const indices = cusumSignals(
      plotted,
      limits.centerline,
      limits.sigma,
      params.cusumK ?? 0.5,
      params.cusumH ?? 4,
    );
    if (indices.length > 0) {
      ruleHits.push({
        rule: "cusum_signal",
        severity: "out_of_control",
        pointIndices: indices,
        description: "CUSUM tabular acima do intervalo de decisão h",
      });
    }
  }

  if (chartType === "ewma" && new Set(enabledRules).has("ewma_beyond_limits")) {
    const indices = ewmaSignals(
      plotted,
      limits.centerline,
      limits.sigma,
      params.ewmaLambda ?? 0.2,
      params.ewmaK ?? 3,
    );
    if (indices.length > 0) {
      ruleHits.push({
        rule: "ewma_beyond_limits",
        severity: "out_of_control",
        pointIndices: indices,
        description: "EWMA além dos limites de controle",
      });
    }
  }

  const status: SpcStatus = ruleHits.some(
    (h) => h.severity === "out_of_control",
  )
    ? "out_of_control"
    : ruleHits.length > 0
      ? "trending"
      : "in_control";

  return {
    ...base,
    status,
    sampleSize: plotted.length,
    limits,
    ruleHits,
  };
}
