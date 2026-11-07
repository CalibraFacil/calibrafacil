import { z } from "zod";
import {
  FleetAnalyticsQuerySchema,
  ListAssetsQuerySchema,
  RecordOotImpactAssessmentSchema,
  SetCalibrationIntervalSchema,
} from "@calibra-facil/schemas";
import { ASSET_OOT_EVENT_STATUSES } from "@calibra-facil/schemas/machines";

import {
  portalAssetDetailResponseSchema,
  portalBrandingResponseSchema,
  portalCalendarResponseSchema,
  portalFleetAssetsResponseSchema,
  portalIntervalInsightSchema,
  portalIntervalUpdateResponseSchema,
  portalOrganizationsResponseSchema,
  portalUnitsResponseSchema,
  portalUnitsSummaryResponseSchema,
} from "../portal-fleet";
import {
  portalAuditPackRequestedResponseSchema,
  portalAuditPacksResponseSchema,
  portalCertificateDetailSchema,
  portalCertificatesResponseSchema,
  portalDownloadLinkResponseSchema,
} from "../portal-certificates";
import {
  portalDriftSeriesResponseSchema,
  portalFleetAnalyticsResponseSchema,
  portalOotAssessmentResponseSchema,
  portalOotEventsResponseSchema,
} from "../portal-reliability";
import { portalOverviewResponseSchema } from "../portal";
import { endpoint, type EndpointGroup } from "./define";

/**
 * The client portal's own surface (`/api/portal/*`, served by
 * `apps/api/src/domains/portal/routes/portal.ts`). The portal frontend calls these through its
 * transport (`apps/portal/src/lib/portal-api.ts`); they are NOT in
 * `ENDPOINT_GROUPS` (see `PORTAL_ENDPOINT_GROUPS`), because the lab app and the
 * desktop never call them. Every definition is `cloud-only` for that reason too:
 * the portal does not run on the desktop.
 *
 * Response schemas are the wire contracts of `portal*.ts` at the root of this
 * package; the request schemas are the ones the handlers validate with (the
 * portal-local ones are declared here). Routes whose handler reads its query by
 * hand declare the schema the portal sends, kept lenient (see
 * `PortalListCertificatesQuerySchema`).
 */

const PORTAL_DESKTOP_LABEL = "Portal do cliente";

const calendarDaySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** The shared asset query plus the portal's due-status filter, server-side sort, exact-id lookup and unit narrowing. */
export const PortalListAssetsQuerySchema = ListAssetsQuerySchema.extend({
  dueStatus: z
    .enum(["overdue", "due_soon", "scheduled", "unscheduled", "in_lab"])
    .optional(),
  sortBy: z
    .enum(["tag", "name", "nextCalibrationDate", "lastCalibrationDate"])
    .default("tag"),
  sortDir: z.enum(["asc", "desc"]).default("asc"),
  // Exact-id lookup of the self-service recall flow: comma-separated on the
  // wire (a caller passes the array, `String()` joins it), at most 50 kept;
  // still combined with the customer scope, so foreign ids drop out.
  ids: z
    .string()
    .regex(/^\d+(,\d+)*$/)
    .optional()
    .transform((value) => {
      if (!value) return undefined;
      const ids = value.split(",").map((id) => Number.parseInt(id, 10));
      return ids.slice(0, 50);
    }),
  // Group cockpit: narrow the consolidated view to one unit (= branch customer
  // id). Ignored in single mode (only that customer is ever in scope).
  unitId: z.coerce.number().int().positive().optional(),
});

/** The visible month grid of the upcoming-dues calendar (the server caps the range). */
export const PortalCalendarQuerySchema = z.object({
  from: calendarDaySchema,
  to: calendarDaySchema,
  unitId: z.coerce.number().int().positive().optional(),
});

/**
 * The certificate list's filters. The handler reads them by hand (clamping
 * `page` and `limit`), so the numbers are only coerced here, never bounded.
 */
export const PortalListCertificatesQuerySchema = z.object({
  page: z.coerce.number().optional(),
  limit: z.coerce.number().optional(),
  query: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  assetId: z.coerce.number().optional(),
});

/** Bulk export of released certificates and fleet status for a customer audit. */
export const PortalAuditPackRequestSchema = z
  .object({
    dateFrom: calendarDaySchema,
    dateTo: calendarDaySchema,
    unitId: z.number().int().positive().optional(),
    include: z.object({
      certificates: z.boolean(),
      fleetReport: z.boolean(),
      verificationIndex: z.boolean(),
    }),
  })
  .refine((value) => value.dateFrom <= value.dateTo, {
    message: "Período inválido",
  })
  .refine(
    (value) =>
      value.include.certificates ||
      value.include.fleetReport ||
      value.include.verificationIndex,
    { message: "Selecione ao menos um conteúdo para o pacote" },
  );

export const PortalOotEventsQuerySchema = z.object({
  status: z.enum(ASSET_OOT_EVENT_STATUSES).optional(),
  unitId: z.coerce.number().int().positive().optional(),
});

export const portalShellEndpoints = {
  /** Unauthenticated: the lab identity of the host the portal is served from. */
  branding: endpoint({
    method: "get",
    path: "/api/portal/branding",
    response: portalBrandingResponseSchema,
    failure: "Falha ao carregar a identidade do laboratório.",
    policy: "cloud-only",
    desktopLabel: PORTAL_DESKTOP_LABEL,
  }),
  organizations: endpoint({
    method: "get",
    path: "/api/portal/organizations",
    response: portalOrganizationsResponseSchema,
    failure: "Falha ao carregar as organizações",
    policy: "cloud-only",
    desktopLabel: PORTAL_DESKTOP_LABEL,
  }),
} as const satisfies EndpointGroup;

export const portalDashboardEndpoints = {
  overview: endpoint({
    method: "get",
    path: "/api/portal/overview",
    response: portalOverviewResponseSchema,
    failure: "Falha ao carregar o painel",
    policy: "cloud-only",
    desktopLabel: PORTAL_DESKTOP_LABEL,
  }),
  units: endpoint({
    method: "get",
    path: "/api/portal/units",
    response: portalUnitsResponseSchema,
    failure: "Falha ao carregar unidades",
    policy: "cloud-only",
    desktopLabel: PORTAL_DESKTOP_LABEL,
  }),
  unitsSummary: endpoint({
    method: "get",
    path: "/api/portal/units/summary",
    response: portalUnitsSummaryResponseSchema,
    failure: "Falha ao carregar o resumo por unidade",
    policy: "cloud-only",
    desktopLabel: PORTAL_DESKTOP_LABEL,
  }),
  calendar: endpoint({
    method: "get",
    path: "/api/portal/calendar",
    query: PortalCalendarQuerySchema,
    response: portalCalendarResponseSchema,
    failure: "Falha ao carregar o calendário",
    policy: "cloud-only",
    desktopLabel: PORTAL_DESKTOP_LABEL,
  }),
} as const satisfies EndpointGroup;

/** `:id` is the asset's opaque `publicId` or, for old links, its numeric id. */
export const portalAssetEndpoints = {
  list: endpoint({
    method: "get",
    path: "/api/portal/assets",
    query: PortalListAssetsQuerySchema,
    response: portalFleetAssetsResponseSchema,
    failure: "Falha ao carregar ativos",
    policy: "cloud-only",
    desktopLabel: PORTAL_DESKTOP_LABEL,
  }),
  get: endpoint({
    method: "get",
    path: "/api/portal/assets/:id",
    response: portalAssetDetailResponseSchema,
    failure: "Falha ao carregar ativo.",
    policy: "cloud-only",
    desktopLabel: PORTAL_DESKTOP_LABEL,
  }),
  intervalInsight: endpoint({
    method: "get",
    path: "/api/portal/assets/:id/interval-insight",
    response: portalIntervalInsightSchema,
    failure: "Falha ao carregar a análise.",
    policy: "cloud-only",
    desktopLabel: PORTAL_DESKTOP_LABEL,
  }),
  /**
   * A print-ready HTML document the browser opens from a link (never fetched as
   * JSON, so the portal builds its URL with `portalEndpointUrl`). The handler answers
   * `c.html(...)`: it stays a plain route when the API mounts the others.
   */
  intervalInsightReport: endpoint({
    method: "get",
    path: "/api/portal/assets/:id/interval-insight/report",
    response: z.string(),
    failure: "Falha ao carregar o relatório",
    policy: "cloud-only",
    desktopLabel: PORTAL_DESKTOP_LABEL,
  }),
  setInterval: endpoint({
    method: "put",
    path: "/api/portal/assets/:id/interval",
    body: SetCalibrationIntervalSchema,
    response: portalIntervalUpdateResponseSchema,
    failure: "Não foi possível salvar a periodicidade.",
    policy: "cloud-only",
    desktopLabel: PORTAL_DESKTOP_LABEL,
  }),
  driftSeries: endpoint({
    method: "get",
    path: "/api/portal/assets/:id/drift-series",
    response: portalDriftSeriesResponseSchema,
    failure: "Falha ao carregar a análise de deriva",
    policy: "cloud-only",
    desktopLabel: PORTAL_DESKTOP_LABEL,
  }),
} as const satisfies EndpointGroup;

/** `:id` is the certificate's job code (`jobId`). */
export const portalCertificateEndpoints = {
  list: endpoint({
    method: "get",
    path: "/api/portal/certificates",
    query: PortalListCertificatesQuerySchema,
    response: portalCertificatesResponseSchema,
    failure: "Falha ao carregar certificados",
    policy: "cloud-only",
    desktopLabel: PORTAL_DESKTOP_LABEL,
  }),
  get: endpoint({
    method: "get",
    path: "/api/portal/certificates/:id",
    response: portalCertificateDetailSchema,
    failure: "Falha ao carregar certificado",
    policy: "cloud-only",
    desktopLabel: PORTAL_DESKTOP_LABEL,
  }),
  download: endpoint({
    method: "get",
    path: "/api/portal/certificates/:id/download",
    response: portalDownloadLinkResponseSchema,
    failure: "Falha ao baixar o certificado",
    policy: "cloud-only",
    desktopLabel: PORTAL_DESKTOP_LABEL,
  }),
  referenceStandardDownload: endpoint({
    method: "get",
    path: "/api/portal/certificates/:id/reference-standards/:standardId/certificate/download",
    response: portalDownloadLinkResponseSchema,
    failure: "Falha ao baixar",
    policy: "cloud-only",
    desktopLabel: PORTAL_DESKTOP_LABEL,
  }),
} as const satisfies EndpointGroup;

export const portalAuditPackEndpoints = {
  list: endpoint({
    method: "get",
    path: "/api/portal/audit-packs",
    response: portalAuditPacksResponseSchema,
    failure: "Falha ao carregar pacotes de auditoria",
    policy: "cloud-only",
    desktopLabel: PORTAL_DESKTOP_LABEL,
  }),
  request: endpoint({
    method: "post",
    path: "/api/portal/audit-packs",
    body: PortalAuditPackRequestSchema,
    response: portalAuditPackRequestedResponseSchema,
    status: 201,
    failure: "Falha ao solicitar o pacote.",
    policy: "cloud-only",
    desktopLabel: PORTAL_DESKTOP_LABEL,
  }),
  download: endpoint({
    method: "get",
    path: "/api/portal/audit-packs/:id/download",
    response: portalDownloadLinkResponseSchema,
    failure: "Falha ao baixar o pacote.",
    policy: "cloud-only",
    desktopLabel: PORTAL_DESKTOP_LABEL,
  }),
} as const satisfies EndpointGroup;

/** As-found reliability: the lab's verdicts, never recomputed by the portal. */
export const portalReliabilityEndpoints = {
  fleetAnalytics: endpoint({
    method: "get",
    path: "/api/portal/analytics/fleet",
    query: FleetAnalyticsQuerySchema,
    response: portalFleetAnalyticsResponseSchema,
    failure: "Falha ao carregar os indicadores de confiabilidade",
    policy: "cloud-only",
    desktopLabel: PORTAL_DESKTOP_LABEL,
  }),
  ootEvents: endpoint({
    method: "get",
    path: "/api/portal/oot-events",
    query: PortalOotEventsQuerySchema,
    response: portalOotEventsResponseSchema,
    failure: "Falha ao carregar eventos fora de tolerância",
    policy: "cloud-only",
    desktopLabel: PORTAL_DESKTOP_LABEL,
  }),
  assessOotEvent: endpoint({
    method: "post",
    path: "/api/portal/oot-events/:id/assessment",
    body: RecordOotImpactAssessmentSchema,
    response: portalOotAssessmentResponseSchema,
    status: 201,
    failure: "Não foi possível registrar a avaliação.",
    policy: "cloud-only",
    desktopLabel: PORTAL_DESKTOP_LABEL,
  }),
} as const satisfies EndpointGroup;
