import { describe, expect, it } from "vitest";

import {
  ENDPOINT_GROUPS,
  PORTAL_ENDPOINT_GROUPS,
  endpointLabel,
  type EndpointDef,
} from "./index";
import { buildEndpointRequest, endpointRequestUrl } from "./request";
import { buildPortalOverview } from "../fixtures";
import * as fixtures from "../portal.fixtures";

const { dashboard, assets, certificates, auditPacks, reliability } =
  PORTAL_ENDPOINT_GROUPS;
const { notifications, ootNotifications, visits, requests, serviceOrders } =
  PORTAL_ENDPOINT_GROUPS;

/** What each definition's response schema must accept: one contract-valid body per endpoint. */
const responses: Array<[EndpointDef, unknown]> = [
  [PORTAL_ENDPOINT_GROUPS.shell.branding, fixtures.buildPortalBranding()],
  [
    PORTAL_ENDPOINT_GROUPS.shell.organizations,
    fixtures.buildPortalOrganizations(),
  ],
  [dashboard.overview, buildPortalOverview()],
  [dashboard.units, fixtures.buildPortalUnits()],
  [dashboard.unitsSummary, fixtures.buildPortalUnitsSummary()],
  [dashboard.calendar, fixtures.buildPortalCalendar()],
  [assets.list, fixtures.buildPortalFleetAssetsResponse()],
  [assets.get, { data: fixtures.buildPortalAssetDetail() }],
  [assets.intervalInsight, fixtures.buildPortalIntervalInsight()],
  [
    assets.setInterval,
    {
      id: 1,
      calibrationIntervalMonths: 12,
      nextCalibrationDate: null,
      intervalSetBy: "customer_confirmed",
    },
  ],
  [assets.driftSeries, fixtures.buildPortalDriftSeries()],
  [certificates.list, fixtures.buildPortalCertificatesResponse()],
  [certificates.get, fixtures.buildPortalCertificateDetail()],
  [certificates.download, fixtures.buildPortalDownloadLink()],
  [certificates.referenceStandardDownload, fixtures.buildPortalDownloadLink()],
  [auditPacks.list, fixtures.buildPortalAuditPacksResponse()],
  [auditPacks.request, fixtures.buildPortalAuditPackRequested()],
  [auditPacks.download, fixtures.buildPortalDownloadLink()],
  [reliability.fleetAnalytics, fixtures.buildPortalFleetAnalytics()],
  [reliability.ootEvents, fixtures.buildPortalOotEventsResponse()],
  [
    reliability.assessOotEvent,
    {
      message: "Avaliação registrada",
      data: {
        event: { id: 1, status: "ASSESSED" },
        assessment: { id: 2, decision: "NO_IMPACT" },
      },
    },
  ],
  [notifications.list, fixtures.buildPortalNotificationFeed()],
  [notifications.unreadCount, { count: 3 }],
  [notifications.markRead, { updatedIds: [1] }],
  [notifications.markAllRead, { count: 0 }],
  [notifications.preferences, fixtures.buildPortalNotificationPreferences()],
  [
    notifications.updatePreferences,
    fixtures.buildPortalNotificationPreferences(),
  ],
  [ootNotifications.list, fixtures.buildPortalOotNotifications()],
  [ootNotifications.acknowledge, { message: "Recebimento confirmado" }],
  [visits.list, fixtures.buildPortalVisitsResponse()],
  [
    visits.confirm,
    { ok: true, customerConfirmedAt: "2026-06-15T12:00:00.000Z" },
  ],
  [visits.requestReschedule, { ok: true, requestId: 5 }],
  [requests.list, fixtures.buildPortalRequestsResponse()],
  [requests.get, fixtures.buildPortalRequestDetail()],
  [requests.createBatch, fixtures.buildPortalRequestBatch()],
  [serviceOrders.list, fixtures.buildPortalServiceOrdersResponse()],
  [serviceOrders.get, { data: fixtures.buildPortalServiceOrderDetail() }],
  [
    serviceOrders.financialSummary,
    { data: fixtures.buildPortalFinancialSummary() },
  ],
  [serviceOrders.approveQuote, { ok: true }],
  [serviceOrders.rejectQuote, { ok: true }],
];

/** Served as a document the browser opens from a link, not as JSON. */
const documents: ReadonlyArray<EndpointDef> = [assets.intervalInsightReport];

const portalDefinitions = Object.values(PORTAL_ENDPOINT_GROUPS).flatMap(
  (group) => Object.values<EndpointDef>(group),
);

describe("portal endpoint definitions", () => {
  it("are all under /api/portal, declared once, and apart from the lab's endpoints", () => {
    const labLabels = new Set(
      Object.values(ENDPOINT_GROUPS).flatMap((group) =>
        Object.values<EndpointDef>(group).map((def) => endpointLabel(def)),
      ),
    );
    const labels = portalDefinitions.map((def) => endpointLabel(def));

    expect(
      portalDefinitions.every((def) => def.path.startsWith("/api/portal/")),
    ).toBe(true);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels.filter((label) => labLabels.has(label))).toEqual([]);
  });

  it("every definition has a contract-valid response (or is a document)", () => {
    const covered = new Set(responses.map(([def]) => def));
    const missing = portalDefinitions.filter(
      (def) => !covered.has(def) && !documents.includes(def),
    );

    expect(missing.map((def) => endpointLabel(def))).toEqual([]);
  });

  for (const [def, payload] of responses) {
    it(`${endpointLabel(def)} accepts its fixture`, () => {
      const result = def.response.safeParse(payload);
      expect(result.success ? [] : result.error.issues).toEqual([]);
    });
  }
});

describe("buildEndpointRequest", () => {
  it("fills and encodes path parameters, serialises the query and keeps the body", () => {
    expect(
      buildEndpointRequest(certificates.referenceStandardDownload, {
        params: { id: "JOB 1/2", standardId: 7 },
      }).path,
    ).toBe(
      "/api/portal/certificates/JOB%201%2F2/reference-standards/7/certificate/download",
    );

    const request = buildEndpointRequest(visits.requestReschedule, {
      params: { id: 3 },
      body: { reason: null, preferredWindows: [] },
    });
    expect(request.method).toBe("POST");
    expect(request.body).toEqual({ reason: null, preferredWindows: [] });
  });

  it("drops undefined query entries and joins an array with commas", () => {
    const request = buildEndpointRequest(assets.list, {
      query: { page: 2, query: undefined, ids: [3, 4], unitId: undefined },
    });

    expect(request.query.toString()).toBe("page=2&ids=3%2C4");
  });

  it("refuses a call without a path parameter", () => {
    expect(() => buildEndpointRequest(assets.get, {})).toThrow(
      'Missing path parameter "id"',
    );
  });

  it("builds the target of a link", () => {
    expect(
      endpointRequestUrl(assets.intervalInsightReport, { params: { id: 9 } }),
    ).toBe("/api/portal/assets/9/interval-insight/report");
    expect(
      endpointRequestUrl(dashboard.calendar, {
        query: { from: "2026-06-01", to: "2026-06-30" },
      }),
    ).toBe("/api/portal/calendar?from=2026-06-01&to=2026-06-30");
  });
});
