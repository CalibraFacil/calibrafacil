/**
 * Client-side DTOs for the #740 reliability surface: fleet as-found analytics
 * (EOPR — "confiabilidade observada"), per-asset drift series and the §7.1.5.2
 * out-of-tolerance ("fora de tolerância na condição 'como recebido'") events.
 * Shapes mirror the /api/portal responses; the portal never recomputes verdicts.
 */

export type FleetAnalyticsBucket = "quarter" | "year";

/** Rates are % over KNOWN cycles; `unknown` counts cycles without an as-found signal. */
export type FleetRateFields = {
  jobs: number;
  known: number;
  conforming: number;
  nonConforming: number;
  unknown: number;
  ootRatePct: number | null;
  coveragePct: number | null;
};

export type FleetTrendBucket = FleetRateFields & {
  /** "2026-T1" (quarter) or "2026" (year). */
  bucket: string;
};

export type FleetAssetTypeBreakdown = FleetRateFields & {
  assetTypeId: number | null;
  assetTypeName: string;
};

export type FleetWorstOffender = {
  assetId: number;
  assetPublicId: string;
  tag: string;
  name: string;
  assetTypeName: string;
  jobs: number;
  known: number;
  nonConforming: number;
  failureRatePct: number | null;
  lastNonConformingAt: string | null;
};

export type FleetAnalytics = {
  mode: "single" | "group";
  period: { from: string; to: string; bucket: FleetAnalyticsBucket };
  totals: FleetRateFields;
  /** LEGAL-regime (Inmetro) calibrations excluded from the indicators. */
  legalExcluded: number;
  trend: Array<FleetTrendBucket>;
  byAssetType: Array<FleetAssetTypeBreakdown>;
  worstOffenders: Array<FleetWorstOffender>;
  /** pt-BR verdict-attribution sentence — must be displayed on the page. */
  attribution: string;
};

export type DriftConformity = "CONFORMING" | "NON_CONFORMING" | "UNKNOWN";

export type DriftRegression = {
  slope: number;
  intercept: number;
  residualStdErr: number;
  fittedAtLatest: number;
  significant: boolean;
};

export type DriftPointSeries = {
  /** Positional index of the measured point across cycles. */
  pointIndex: number;
  series: Array<{ approvedAt: string; margin: number }>;
  regression: DriftRegression | null;
  drifting: boolean;
};

export type AssetDriftSeries = {
  assetId: number;
  cycles: Array<{
    approvedAt: string;
    conformity: DriftConformity;
    minMargin: number | null;
  }>;
  points: Array<DriftPointSeries>;
  coverage: { totalCycles: number; cyclesWithMargins: number };
  attribution: string;
};

export type OotEventStatus = "OPEN" | "ASSESSED";

export type OotDecision = "NO_IMPACT" | "IMPACT_CONTAINED" | "IMPACT_ESCALATED";

export type OotEvent = {
  id: number;
  status: OotEventStatus;
  detectedAt: string;
  customerId: number;
  assetId: number;
  assetPublicId: string;
  assetTag: string;
  assetName: string;
  jobId: number;
  jobIdentifier: string;
  /** Last known-good calibration — the suspect-window default start. */
  suggestedPeriodStart: string | null;
  assessmentDecision: OotDecision | null;
  assessmentRationale: string | null;
  assessmentPeriodStart: string | null;
  assessmentPeriodEnd: string | null;
  assessmentSuspectShipped: boolean | null;
  assessmentCustomerNotified: boolean | null;
  assessmentCreatedAt: string | null;
  assessmentBy: string | null;
};

export function isOotDecision(value: string): value is OotDecision {
  return (
    value === "NO_IMPACT" ||
    value === "IMPACT_CONTAINED" ||
    value === "IMPACT_ESCALATED"
  );
}
