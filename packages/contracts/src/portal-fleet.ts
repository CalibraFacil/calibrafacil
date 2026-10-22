import { z } from "zod";

import { nullableNumber, nullableString, paginationSchema } from "./common";

/**
 * Response contracts for the client portal's scope-level and instrument
 * endpoints (`/api/portal/*`): branding, organizations, units, calendar, the
 * instrument list/detail and the interval analysis. Wire schemas (see
 * `jobs.ts`): validate only, unknown keys allowed, timestamps are ISO strings.
 */

const jsonRecordSchema = z.record(z.string(), z.unknown());
const assetStatusSchema = z.enum([
  "ACTIVE",
  "INACTIVE",
  "MAINTENANCE",
  "SCRAPPED",
]);
const metrologyRegimeSchema = z.enum(["INDUSTRIAL", "LEGAL", "UNKNOWN"]);
const portalScopeModeSchema = z.enum(["single", "group"]);

/** GET /api/portal/branding (unauthenticated; nulls on the default host). */
export const portalBrandingResponseSchema = z.object({
  name: nullableString,
  logo: nullableString,
});
export type PortalBrandingResponse = z.infer<
  typeof portalBrandingResponseSchema
>;

/** GET /api/portal/organizations: the CLIENT organizations of the user. */
export const portalOrganizationsResponseSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    logo: nullableString,
    /** Always `CLIENT` here; the column is nullable. */
    type: nullableString,
    createdAt: z.string(),
    memberRole: z.string(),
    /** `group` = the consolidated "rede" organization. */
    kind: z.enum(["unit", "group"]),
  }),
);
export type PortalOrganizationsResponse = z.infer<
  typeof portalOrganizationsResponseSchema
>;

/** GET /api/portal/units */
export const portalUnitsResponseSchema = z.object({
  mode: portalScopeModeSchema.optional(),
  units: z.array(z.object({ id: z.number(), name: z.string() })),
});
export type PortalUnitsResponse = z.infer<typeof portalUnitsResponseSchema>;

/** GET /api/portal/units/summary */
export const portalUnitsSummaryResponseSchema = z.object({
  mode: portalScopeModeSchema.optional(),
  units: z.array(
    z.object({
      id: z.number(),
      name: z.string(),
      total: z.number(),
      overdue: z.number(),
      dueSoon: z.number(),
    }),
  ),
});
export type PortalUnitsSummaryResponse = z.infer<
  typeof portalUnitsSummaryResponseSchema
>;

/** GET /api/portal/calendar */
export const portalCalendarResponseSchema = z.object({
  data: z.array(
    z.object({
      id: z.number(),
      publicId: z.string(),
      name: z.string(),
      tag: z.string(),
      assetTypeName: z.string(),
      nextCalibrationDate: z.string(),
      inLab: z.boolean(),
      customerId: z.number(),
      customerName: z.string(),
    }),
  ),
});
export type PortalCalendarResponse = z.infer<
  typeof portalCalendarResponseSchema
>;

/** One instrument of the customer's fleet (GET /api/portal/assets). */
export const portalFleetAssetSchema = z.object({
  id: z.number(),
  /** Opaque identifier used in portal URLs (never the serial id). */
  publicId: z.string(),
  customerId: z.number(),
  customerName: z.string(),
  assetTypeId: z.number(),
  assetTypeName: z.string(),
  assetTypeSlug: z.string(),
  name: z.string(),
  manufacturer: nullableString,
  model: nullableString,
  serialNumber: z.string(),
  tag: z.string(),
  status: assetStatusSchema,
  specifications: jsonRecordSchema.nullable(),
  lastCalibrationDate: nullableString,
  nextCalibrationDate: nullableString,
  /** True while the instrument has an open calibration job or service order. */
  inLab: z.boolean(),
  lastCertificate: z
    .object({
      id: z.number(),
      jobId: z.string(),
      approvedAt: nullableString,
    })
    .nullable(),
  comments: nullableString,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PortalFleetAsset = z.infer<typeof portalFleetAssetSchema>;

/** GET /api/portal/assets */
export const portalFleetAssetsResponseSchema = z.object({
  data: z.array(portalFleetAssetSchema),
  pagination: paginationSchema,
});
export type PortalFleetAssetsResponse = z.infer<
  typeof portalFleetAssetsResponseSchema
>;

const portalAssetCertificateSchema = z.object({
  id: z.number(),
  jobId: z.string(),
  certificateName: nullableString,
  status: z.string(),
  performedAt: nullableString,
  approvedAt: nullableString,
  certificateUrl: nullableString,
  verificationToken: z.string(),
  serviceName: z.string(),
  labName: z.string(),
});

/**
 * The shape of `regulatedInterval` (the column is typed as an open record, so
 * the detail schema keeps it opaque and a reader narrows it with this).
 */
export const portalRegulatedIntervalSchema = z.object({
  kind: z.enum([
    "fixed_months",
    "max_months_from_install",
    "per_technology",
    "not_nationally_fixed",
  ]),
  regulationReference: z.string(),
  operationalizedByDelegate: z.boolean(),
});

/** GET /api/portal/assets/:id (`data`): the instrument with its newest certificates. */
export const portalAssetDetailSchema = portalFleetAssetSchema
  .omit({ lastCertificate: true })
  .extend({
    // Track 1: the customer-owned calibration interval (§7.8.4.3, ILAC-G24).
    calibrationIntervalMonths: nullableNumber,
    intervalSetBy: z.enum(["customer_confirmed", "engine_applied"]).nullable(),
    // Track 2: legal-metrology regime and the regulation-fixed verification period.
    metrologyRegime: metrologyRegimeSchema,
    regulatedInterval: jsonRecordSchema.nullable(),
    nextLegalVerificationDate: nullableString,
    certificates: z.array(portalAssetCertificateSchema),
    /** Total approved certificates; `certificates` holds only the 5 newest. */
    certificateCount: z.number(),
  });
export type PortalAssetDetail = z.infer<typeof portalAssetDetailSchema>;

export const portalAssetDetailResponseSchema = z.object({
  data: portalAssetDetailSchema,
});
export type PortalAssetDetailResponse = z.infer<
  typeof portalAssetDetailResponseSchema
>;

/** GET /api/portal/assets/:id/interval-insight */
export const portalIntervalInsightSchema = z.object({
  classification: z.enum(["INSUFFICIENT_DATA", "STABLE", "DRIFTING"]),
  reliability: nullableNumber,
  coverage: z.number(),
  recommendation: z
    .object({
      action: z.enum(["extend", "keep", "shorten"]),
      method: z.string(),
      proposedIntervalMonths: z.number(),
      reliabilityBound: nullableNumber,
    })
    .nullable(),
  series: z.array(
    z.object({
      approvedAt: z.string(),
      conformity: z.enum(["CONFORMING", "NON_CONFORMING", "UNKNOWN"]),
      minMargin: nullableNumber,
    }),
  ),
  engineVersion: z.string(),
  fingerprint: z.string(),
});
export type PortalIntervalInsight = z.infer<typeof portalIntervalInsightSchema>;

/** PUT /api/portal/assets/:id/interval */
export const portalIntervalUpdateResponseSchema = z.object({
  id: z.number(),
  calibrationIntervalMonths: z.number(),
  nextCalibrationDate: nullableString,
  intervalSetBy: z.enum(["customer_confirmed", "engine_applied"]),
});
export type PortalIntervalUpdateResponse = z.infer<
  typeof portalIntervalUpdateResponseSchema
>;
