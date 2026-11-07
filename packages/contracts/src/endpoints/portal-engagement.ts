import { z } from "zod";
import {
  ApproveServiceOrderQuotePortalSchema,
  CreateCalibrationRequestSchema,
  ListCalibrationRequestsQuerySchema,
  ListServiceOrdersQuerySchema,
  MarkNotificationsReadSchema,
  PortalListNotificationsQuerySchema,
  PortalUpdateNotificationPreferencesSchema,
  PortalVisitRescheduleRequestSchema,
  RejectServiceOrderQuotePortalSchema,
} from "@calibra-facil/schemas";

import {
  portalFinancialSummaryResponseSchema,
  portalNotificationCountResponseSchema,
  portalNotificationFeedResponseSchema,
  portalNotificationMarkReadResponseSchema,
  portalNotificationPreferencesResponseSchema,
  portalOotAcknowledgeResponseSchema,
  portalOotNotificationsResponseSchema,
  portalQuoteDecisionResponseSchema,
  portalRequestBatchResponseSchema,
  portalRequestDetailSchema,
  portalRequestsResponseSchema,
  portalServiceOrderDetailResponseSchema,
  portalServiceOrdersResponseSchema,
  portalVisitConfirmResponseSchema,
  portalVisitRescheduleResponseSchema,
  portalVisitsResponseSchema,
} from "../portal-engagement";
import { endpoint, type EndpointGroup } from "./define";

/**
 * What the customer does in the portal: notifications, out-of-tolerance
 * notices, visits, calibration requests and service orders. Served by
 * `apps/api/src/routes/portal.ts`, `portal-notifications.ts`,
 * `portal-requests.ts`, `portal-visits.ts` and the `portalServiceOrdersRouter`
 * of `service-orders.ts`; see `./portal.ts` for why they are `cloud-only` and
 * outside `ENDPOINT_GROUPS`.
 */

const PORTAL_DESKTOP_LABEL = "Portal do cliente";

/** The service-order routes address an order by its opaque `publicId`. */
const portalServiceOrderParamsSchema = z.object({
  id: z.string().trim().min(1),
});
const portalQuoteParamsSchema = portalServiceOrderParamsSchema.extend({
  quoteId: z.coerce.number().int().positive(),
});

/** The in-app notification center (the badge polls `unreadCount`). */
export const portalNotificationEndpoints = {
  list: endpoint({
    method: "get",
    path: "/api/portal/notifications",
    query: PortalListNotificationsQuerySchema,
    response: portalNotificationFeedResponseSchema,
    failure: "Falha ao carregar as notificações.",
    policy: "cloud-only",
    desktopLabel: PORTAL_DESKTOP_LABEL,
  }),
  unreadCount: endpoint({
    method: "get",
    path: "/api/portal/notifications/unread-count",
    response: portalNotificationCountResponseSchema,
    failure: "Falha ao carregar as notificações.",
    policy: "cloud-only",
    desktopLabel: PORTAL_DESKTOP_LABEL,
  }),
  markRead: endpoint({
    method: "post",
    path: "/api/portal/notifications/mark-read",
    body: MarkNotificationsReadSchema,
    response: portalNotificationMarkReadResponseSchema,
    failure: "Não foi possível marcar como lida.",
    policy: "cloud-only",
    desktopLabel: PORTAL_DESKTOP_LABEL,
  }),
  markAllRead: endpoint({
    method: "post",
    path: "/api/portal/notifications/mark-all-read",
    response: portalNotificationCountResponseSchema,
    failure: "Não foi possível marcar todas como lidas.",
    policy: "cloud-only",
    desktopLabel: PORTAL_DESKTOP_LABEL,
  }),
  preferences: endpoint({
    method: "get",
    path: "/api/portal/notification-preferences",
    response: portalNotificationPreferencesResponseSchema,
    failure: "Falha ao carregar preferências.",
    policy: "cloud-only",
    desktopLabel: PORTAL_DESKTOP_LABEL,
  }),
  updatePreferences: endpoint({
    method: "put",
    path: "/api/portal/notification-preferences",
    body: PortalUpdateNotificationPreferencesSchema,
    response: portalNotificationPreferencesResponseSchema,
    failure: "Falha ao salvar preferências.",
    policy: "cloud-only",
    desktopLabel: PORTAL_DESKTOP_LABEL,
  }),
} as const satisfies EndpointGroup;

/** ISO/IEC 17025 §7.10 notices; `:token` is the opaque acknowledgment token. */
export const portalOotNotificationEndpoints = {
  list: endpoint({
    method: "get",
    path: "/api/portal/oot-notifications",
    response: portalOotNotificationsResponseSchema,
    failure: "Falha ao carregar as notificações.",
    policy: "cloud-only",
    desktopLabel: PORTAL_DESKTOP_LABEL,
  }),
  acknowledge: endpoint({
    method: "post",
    path: "/api/portal/oot-notifications/:token/acknowledge",
    response: portalOotAcknowledgeResponseSchema,
    failure: "Não foi possível confirmar o recebimento.",
    policy: "cloud-only",
    desktopLabel: PORTAL_DESKTOP_LABEL,
  }),
} as const satisfies EndpointGroup;

export const portalVisitEndpoints = {
  list: endpoint({
    method: "get",
    path: "/api/portal/visits",
    response: portalVisitsResponseSchema,
    failure: "Falha ao carregar as visitas",
    policy: "cloud-only",
    desktopLabel: PORTAL_DESKTOP_LABEL,
  }),
  confirm: endpoint({
    method: "post",
    path: "/api/portal/visits/:id/confirm",
    response: portalVisitConfirmResponseSchema,
    failure: "Não foi possível confirmar a presença.",
    policy: "cloud-only",
    desktopLabel: PORTAL_DESKTOP_LABEL,
  }),
  requestReschedule: endpoint({
    method: "post",
    path: "/api/portal/visits/:id/reschedule-request",
    body: PortalVisitRescheduleRequestSchema,
    response: portalVisitRescheduleResponseSchema,
    failure: "Não foi possível solicitar o reagendamento.",
    policy: "cloud-only",
    desktopLabel: PORTAL_DESKTOP_LABEL,
  }),
} as const satisfies EndpointGroup;

/**
 * Calibration requests. The single `POST /api/portal/requests` the API also
 * serves is not defined: the portal sends every request through `/batch`.
 */
export const portalRequestEndpoints = {
  list: endpoint({
    method: "get",
    path: "/api/portal/requests",
    query: ListCalibrationRequestsQuerySchema,
    response: portalRequestsResponseSchema,
    failure: "Falha ao carregar solicitacoes",
    policy: "cloud-only",
    desktopLabel: PORTAL_DESKTOP_LABEL,
  }),
  get: endpoint({
    method: "get",
    path: "/api/portal/requests/:id",
    response: portalRequestDetailSchema,
    failure: "Falha ao carregar solicitação",
    policy: "cloud-only",
    desktopLabel: PORTAL_DESKTOP_LABEL,
  }),
  createBatch: endpoint({
    method: "post",
    path: "/api/portal/requests/batch",
    body: CreateCalibrationRequestSchema,
    response: portalRequestBatchResponseSchema,
    status: 201,
    failure: "Erro ao criar solicitação",
    policy: "cloud-only",
    desktopLabel: PORTAL_DESKTOP_LABEL,
  }),
} as const satisfies EndpointGroup;

/** `:id` is the order's opaque `publicId`. */
export const portalServiceOrderEndpoints = {
  list: endpoint({
    method: "get",
    path: "/api/portal/service-orders",
    query: ListServiceOrdersQuerySchema,
    response: portalServiceOrdersResponseSchema,
    failure: "Falha ao carregar ordens de serviço.",
    policy: "cloud-only",
    desktopLabel: PORTAL_DESKTOP_LABEL,
  }),
  get: endpoint({
    method: "get",
    path: "/api/portal/service-orders/:id",
    params: portalServiceOrderParamsSchema,
    response: portalServiceOrderDetailResponseSchema,
    failure: "Falha ao carregar ordem de serviço.",
    policy: "cloud-only",
    desktopLabel: PORTAL_DESKTOP_LABEL,
  }),
  financialSummary: endpoint({
    method: "get",
    path: "/api/portal/service-orders/:id/financial-summary",
    params: portalServiceOrderParamsSchema,
    response: portalFinancialSummaryResponseSchema,
    failure: "Falha ao carregar informações financeiras.",
    policy: "cloud-only",
    desktopLabel: PORTAL_DESKTOP_LABEL,
  }),
  approveQuote: endpoint({
    method: "post",
    path: "/api/portal/service-orders/:id/quotes/:quoteId/approve",
    params: portalQuoteParamsSchema,
    body: ApproveServiceOrderQuotePortalSchema,
    response: portalQuoteDecisionResponseSchema,
    failure: "Falha ao aprovar orçamento.",
    policy: "cloud-only",
    desktopLabel: PORTAL_DESKTOP_LABEL,
  }),
  rejectQuote: endpoint({
    method: "post",
    path: "/api/portal/service-orders/:id/quotes/:quoteId/reject",
    params: portalQuoteParamsSchema,
    body: RejectServiceOrderQuotePortalSchema,
    response: portalQuoteDecisionResponseSchema,
    failure: "Falha ao recusar orçamento.",
    policy: "cloud-only",
    desktopLabel: PORTAL_DESKTOP_LABEL,
  }),
} as const satisfies EndpointGroup;
