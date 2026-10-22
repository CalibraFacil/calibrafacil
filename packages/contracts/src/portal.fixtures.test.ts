import { describe, expect, it } from "vitest";
import type { z } from "zod";

import {
  portalAssetDetailResponseSchema,
  portalBrandingResponseSchema,
  portalCalendarResponseSchema,
  portalFleetAssetSchema,
  portalFleetAssetsResponseSchema,
  portalIntervalInsightSchema,
  portalOrganizationsResponseSchema,
  portalUnitsResponseSchema,
  portalUnitsSummaryResponseSchema,
} from "./portal-fleet";
import {
  portalAuditPackRequestedResponseSchema,
  portalAuditPackSchema,
  portalAuditPacksResponseSchema,
  portalCertificateDetailSchema,
  portalCertificateListItemSchema,
  portalCertificatesResponseSchema,
  portalDownloadLinkResponseSchema,
} from "./portal-certificates";
import {
  portalFinancialSummarySchema,
  portalNotificationFeedResponseSchema,
  portalNotificationPreferencesResponseSchema,
  portalOotNotificationsResponseSchema,
  portalRequestBatchResponseSchema,
  portalRequestDetailSchema,
  portalRequestsResponseSchema,
  portalServiceOrderDetailSchema,
  portalServiceOrdersResponseSchema,
  portalVisitSchema,
  portalVisitsResponseSchema,
} from "./portal-engagement";
import {
  portalDriftSeriesResponseSchema,
  portalFleetAnalyticsResponseSchema,
  portalOotEventSchema,
  portalOotEventsResponseSchema,
} from "./portal-reliability";
import {
  invitationLookupResponseSchema,
  magicLinkPreviewResponseSchema,
  signatureVerificationResponseSchema,
  verificationMatchResponseSchema,
  verificationResponseSchema,
} from "./public-access";
import * as fixtures from "./portal.fixtures";

/**
 * Every builder of the portal fixtures with the schema its payload must
 * satisfy. A builder without a row here fails the "no unregistered fixture"
 * test, so a fixture cannot escape the check.
 */
const registry = {
  buildPortalBranding: [
    fixtures.buildPortalBranding,
    portalBrandingResponseSchema,
  ],
  buildPortalOrganizations: [
    fixtures.buildPortalOrganizations,
    portalOrganizationsResponseSchema,
  ],
  buildPortalUnits: [fixtures.buildPortalUnits, portalUnitsResponseSchema],
  buildPortalUnitsSummary: [
    fixtures.buildPortalUnitsSummary,
    portalUnitsSummaryResponseSchema,
  ],
  buildPortalCalendar: [
    fixtures.buildPortalCalendar,
    portalCalendarResponseSchema,
  ],
  buildPortalFleetAsset: [
    fixtures.buildPortalFleetAsset,
    portalFleetAssetSchema,
  ],
  buildPortalFleetAssetsResponse: [
    fixtures.buildPortalFleetAssetsResponse,
    portalFleetAssetsResponseSchema,
  ],
  buildPortalAssetDetail: [
    () => ({ data: fixtures.buildPortalAssetDetail() }),
    portalAssetDetailResponseSchema,
  ],
  buildPortalIntervalInsight: [
    fixtures.buildPortalIntervalInsight,
    portalIntervalInsightSchema,
  ],
  buildPortalCertificateListItem: [
    fixtures.buildPortalCertificateListItem,
    portalCertificateListItemSchema,
  ],
  buildPortalCertificatesResponse: [
    fixtures.buildPortalCertificatesResponse,
    portalCertificatesResponseSchema,
  ],
  buildPortalCertificateDetail: [
    fixtures.buildPortalCertificateDetail,
    portalCertificateDetailSchema,
  ],
  buildPortalDownloadLink: [
    fixtures.buildPortalDownloadLink,
    portalDownloadLinkResponseSchema,
  ],
  buildPortalAuditPack: [fixtures.buildPortalAuditPack, portalAuditPackSchema],
  buildPortalAuditPacksResponse: [
    fixtures.buildPortalAuditPacksResponse,
    portalAuditPacksResponseSchema,
  ],
  buildPortalAuditPackRequested: [
    fixtures.buildPortalAuditPackRequested,
    portalAuditPackRequestedResponseSchema,
  ],
  buildPortalNotificationFeed: [
    fixtures.buildPortalNotificationFeed,
    portalNotificationFeedResponseSchema,
  ],
  buildPortalNotificationPreferences: [
    fixtures.buildPortalNotificationPreferences,
    portalNotificationPreferencesResponseSchema,
  ],
  buildPortalOotNotifications: [
    fixtures.buildPortalOotNotifications,
    portalOotNotificationsResponseSchema,
  ],
  buildPortalVisit: [fixtures.buildPortalVisit, portalVisitSchema],
  buildPortalVisitsResponse: [
    fixtures.buildPortalVisitsResponse,
    portalVisitsResponseSchema,
  ],
  buildPortalRequestsResponse: [
    fixtures.buildPortalRequestsResponse,
    portalRequestsResponseSchema,
  ],
  buildPortalRequestDetail: [
    fixtures.buildPortalRequestDetail,
    portalRequestDetailSchema,
  ],
  buildPortalRequestBatch: [
    fixtures.buildPortalRequestBatch,
    portalRequestBatchResponseSchema,
  ],
  buildPortalServiceOrdersResponse: [
    fixtures.buildPortalServiceOrdersResponse,
    portalServiceOrdersResponseSchema,
  ],
  buildPortalServiceOrderDetail: [
    fixtures.buildPortalServiceOrderDetail,
    portalServiceOrderDetailSchema,
  ],
  buildPortalFinancialSummary: [
    fixtures.buildPortalFinancialSummary,
    portalFinancialSummarySchema,
  ],
  buildPortalFleetAnalytics: [
    fixtures.buildPortalFleetAnalytics,
    portalFleetAnalyticsResponseSchema,
  ],
  buildPortalDriftSeries: [
    fixtures.buildPortalDriftSeries,
    portalDriftSeriesResponseSchema,
  ],
  buildPortalOotEvent: [fixtures.buildPortalOotEvent, portalOotEventSchema],
  buildPortalOotEventsResponse: [
    fixtures.buildPortalOotEventsResponse,
    portalOotEventsResponseSchema,
  ],
  buildVerificationResponse: [
    fixtures.buildVerificationResponse,
    verificationResponseSchema,
  ],
  buildSignatureVerification: [
    fixtures.buildSignatureVerification,
    signatureVerificationResponseSchema,
  ],
  buildVerificationMatch: [
    fixtures.buildVerificationMatch,
    verificationMatchResponseSchema,
  ],
  buildInvitationLookup: [
    fixtures.buildInvitationLookup,
    invitationLookupResponseSchema,
  ],
  buildMagicLinkPreview: [
    fixtures.buildMagicLinkPreview,
    magicLinkPreviewResponseSchema,
  ],
} satisfies Record<string, readonly [() => unknown, z.ZodType]>;

describe("portal contract fixtures", () => {
  it("REQ-TC-3: every exported fixture builder is registered with its schema", () => {
    expect(Object.keys(fixtures).sort()).toEqual(Object.keys(registry).sort());
  });

  for (const [name, [build, schema]] of Object.entries(registry)) {
    it(`REQ-TC-3: ${name}() parses with its response schema`, () => {
      const result = schema.safeParse(build());
      expect(
        result.success ? [] : result.error.issues,
        `${name} drifted from its schema`,
      ).toEqual([]);
    });
  }

  it("REQ-TC-3: a payload that breaks the contract is rejected", () => {
    expect(
      portalFleetAssetsResponseSchema.safeParse({ data: [{ id: 1 }] }).success,
    ).toBe(false);
    expect(
      portalCertificateDetailSchema.safeParse({
        ...fixtures.buildPortalCertificateDetail(),
        methodSnapshot: { name: "só o nome antigo", formulas: "x" },
      }).success,
    ).toBe(false);
  });
});
