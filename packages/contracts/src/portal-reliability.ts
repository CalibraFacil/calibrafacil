import { AssetOotImpactDecisionSchema } from "@calibra-facil/schemas";
import { ASSET_OOT_EVENT_STATUSES } from "@calibra-facil/schemas/machines";
import { z } from "zod";

import { nullableNumber, nullableString } from "./common";

/**
 * Response contracts for the portal's reliability surface: fleet
 * as-found analytics, per-asset drift series and out-of-tolerance events
 * (`/api/portal/analytics/fleet`, `/assets/:id/drift-series`, `/oot-events`).
 * Wire schemas (see `jobs.ts`); the portal never recomputes verdicts.
 */

/**
 * The time unit of the drift regression's x axis (months since the first
 * cycle: 365.25 / 12 days). The API fits the line in it and the portal's chart
 * evaluates the fitted line in it, so both read this one constant.
 */
export const DRIFT_REGRESSION_MS_PER_MONTH = 1000 * 60 * 60 * 24 * 30.4375;

const conformitySchema = z.enum(["CONFORMING", "NON_CONFORMING", "UNKNOWN"]);

/** Rates are % over KNOWN cycles; `unknown` counts cycles without an as-found signal. */
const rateFieldsShape = {
  jobs: z.number(),
  known: z.number(),
  conforming: z.number(),
  nonConforming: z.number(),
  unknown: z.number(),
  ootRatePct: nullableNumber,
  coveragePct: nullableNumber,
};

/** GET /api/portal/analytics/fleet */
export const portalFleetAnalyticsResponseSchema = z.object({
  mode: z.enum(["single", "group"]),
  period: z.object({
    from: z.string(),
    to: z.string(),
    bucket: z.enum(["quarter", "year"]),
  }),
  totals: z.object(rateFieldsShape),
  /** LEGAL-regime (Inmetro) calibrations excluded from the indicators. */
  legalExcluded: z.number(),
  trend: z.array(z.object({ bucket: z.string(), ...rateFieldsShape })),
  byAssetType: z.array(
    z.object({
      assetTypeId: nullableNumber,
      assetTypeName: z.string(),
      ...rateFieldsShape,
    }),
  ),
  worstOffenders: z.array(
    z.object({
      assetId: z.number(),
      assetPublicId: z.string(),
      tag: z.string(),
      name: z.string(),
      assetTypeName: z.string(),
      jobs: z.number(),
      known: z.number(),
      nonConforming: z.number(),
      failureRatePct: nullableNumber,
      lastNonConformingAt: nullableString,
    }),
  ),
  /** pt-BR verdict-attribution sentence: must be displayed on the page. */
  attribution: z.string(),
});
export type PortalFleetAnalyticsResponse = z.infer<
  typeof portalFleetAnalyticsResponseSchema
>;

/** GET /api/portal/assets/:id/drift-series */
export const portalDriftSeriesResponseSchema = z.object({
  assetId: z.number(),
  cycles: z.array(
    z.object({
      approvedAt: z.string(),
      conformity: conformitySchema,
      minMargin: nullableNumber,
    }),
  ),
  points: z.array(
    z.object({
      /** Positional index of the measured point across cycles. */
      pointIndex: z.number(),
      series: z.array(z.object({ approvedAt: z.string(), margin: z.number() })),
      regression: z
        .object({
          slope: z.number(),
          intercept: z.number(),
          residualStdErr: z.number(),
          fittedAtLatest: z.number(),
          significant: z.boolean(),
        })
        .nullable(),
      drifting: z.boolean(),
    }),
  ),
  coverage: z.object({
    totalCycles: z.number(),
    cyclesWithMargins: z.number(),
  }),
  attribution: z.string(),
});
export type PortalDriftSeriesResponse = z.infer<
  typeof portalDriftSeriesResponseSchema
>;

const ootDecisionSchema = AssetOotImpactDecisionSchema;

export const portalOotEventSchema = z.object({
  id: z.number(),
  status: z.enum(ASSET_OOT_EVENT_STATUSES),
  detectedAt: z.string(),
  customerId: z.number(),
  assetId: z.number(),
  assetPublicId: z.string(),
  assetTag: z.string(),
  assetName: z.string(),
  jobId: z.number(),
  jobIdentifier: z.string(),
  /** Last known-good calibration: the suspect-window default start. */
  suggestedPeriodStart: nullableString,
  assessmentDecision: ootDecisionSchema.nullable(),
  assessmentRationale: nullableString,
  assessmentPeriodStart: nullableString,
  assessmentPeriodEnd: nullableString,
  assessmentSuspectShipped: z.boolean().nullable(),
  assessmentCustomerNotified: z.boolean().nullable(),
  assessmentCreatedAt: nullableString,
  assessmentBy: nullableString,
});
export type PortalOotEvent = z.infer<typeof portalOotEventSchema>;

/** GET /api/portal/oot-events */
export const portalOotEventsResponseSchema = z.object({
  data: z.array(portalOotEventSchema),
});
export type PortalOotEventsResponse = z.infer<
  typeof portalOotEventsResponseSchema
>;

/** POST /api/portal/oot-events/:id/assessment (201). */
export const portalOotAssessmentResponseSchema = z.object({
  message: z.string(),
  data: z.object({
    event: z.object({ id: z.number(), status: z.literal("ASSESSED") }),
    assessment: z.object({ id: z.number(), decision: ootDecisionSchema }),
  }),
});
export type PortalOotAssessmentResponse = z.infer<
  typeof portalOotAssessmentResponseSchema
>;
