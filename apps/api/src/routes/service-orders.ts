import { Hono } from "hono";
import type {
  PortalFinancialSummaryResponse,
  PortalQuoteDecisionResponse,
  PortalServiceOrderDetailResponse,
  PortalServiceOrdersResponse,
  ServerShape,
  ServiceOrderCreateResponse,
  ServiceOrderDetailResponse,
  ServiceOrdersListResponse,
} from "@calibra-facil/contracts";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { serviceOrder } from "@calibra-facil/db/schema";
import {
  ApproveServiceOrderQuoteManuallySchema,
  ApproveServiceOrderQuotePortalSchema,
  AssignServiceOrderTechnicianSchema,
  CancelServiceOrderSchema,
  CloseServiceOrderSchema,
  CreateServiceOrderEvaluationSchema,
  CreateServiceOrderQuoteSchema,
  CreateServiceOrderSchema,
  DeliverServiceOrderSchema,
  FinishServiceOrderExecutionSchema,
  IssueServiceOrderDeliveryDocumentSchema,
  ListServiceOrdersQuerySchema,
  RedeemServiceOrderAccessCodeSchema,
  RejectServiceOrderQuoteManuallySchema,
  RejectServiceOrderQuotePortalSchema,
  ReopenServiceOrderSchema,
  SendServiceOrderQuoteSchema,
  StartServiceOrderExecutionSchema,
  UpdateServiceOrderEvaluationSchema,
  UpdateServiceOrderExecutionSchema,
  UpdateServiceOrderQuoteDraftSchema,
  UpdateServiceOrderRepairMarkSchema,
  UpdateServiceOrderSchema,
  UpdateServiceOrderSettingsSchema,
} from "@calibra-facil/schemas";
import {
  requirePermission,
  requirePortalProtected,
  withLabPermission,
  type AuthVariables,
} from "../middleware/permission";
import { buildUnitScopeCondition } from "../lib/units";
import { withOrg } from "../lib/org-context";
import { requestActor } from "../middleware/request-actor";
import {
  serviceOrderNotFound,
  serviceOrderPdfUnavailable,
  serviceOrderQuoteNotFound,
} from "../modules/service-orders/service-order-errors";
import {
  buildPortalBaseUrl,
  getLatestDeliveryDocumentDownloadUrl,
  getLatestIntakeDocumentDownloadUrl,
  getLatestTagDownloadUrl,
  getQuoteDocumentDownloadUrl,
  issueDeliveryDocument,
  issueIntakeDocument,
  issueTag,
  type ServiceOrderDocumentEnv,
} from "../modules/service-orders/service-order.documents";
import { createR2Client, generatePresignedUrl } from "../lib/storage";
import {
  getScopedServiceOrder,
  resolveServiceOrderIdByPublicId,
} from "../modules/service-orders/service-order.queries";
import {
  getPortalCustomerForAuthOrganization,
  getServiceOrderSummaryReport,
  listServiceOrdersForLab,
  listServiceOrdersForPortalCustomer,
  listServiceOrdersPendingCalibrationAfterRepair,
  resolvePortalServiceOrderIdByPublicId,
} from "../modules/service-orders/service-order.list-queries";
import {
  getServiceOrderDetail,
  toClientVisibleServiceOrderDetail,
} from "../modules/service-orders/service-order.read-model";
import { listServiceOrderCommunications } from "../modules/service-orders/service-order.communications";
import { buildPortalServiceOrderFinancialSummary } from "../lib/portal-financial-summary";
import {
  approveQuoteWithPublicServiceOrderAccess,
  redeemServiceOrderAccessCode,
  rejectQuoteWithPublicServiceOrderAccess,
  viewPublicServiceOrderAccess,
} from "../modules/service-orders/service-order.tokens";
import {
  assignServiceOrderTechnician,
  cancelServiceOrder,
  closeServiceOrder,
  createServiceOrder,
  deliverServiceOrder,
  getServiceOrderSettings,
  reopenServiceOrder,
  updateServiceOrder,
  updateServiceOrderRepairMark,
  updateServiceOrderSettings,
} from "../modules/service-orders/service-order.commands";
import {
  finishServiceOrderExecution,
  startServiceOrderExecution,
  updateServiceOrderExecution,
} from "../modules/service-orders/service-order.execution";
import {
  createServiceOrderEvaluation,
  updateServiceOrderEvaluation,
} from "../modules/service-orders/service-order.evaluations";
import {
  linkServiceOrderCertificate,
  unlinkServiceOrderCertificate,
} from "../modules/service-orders/service-order.certificates";
import {
  approveServiceOrderQuoteByPortalUser,
  approveServiceOrderQuoteManually,
  createServiceOrderQuote,
  rejectServiceOrderQuoteByPortalUser,
  rejectServiceOrderQuoteManually,
  sendServiceOrderQuote,
  updateServiceOrderQuoteDraft,
} from "../modules/service-orders/service-order.quotes";
import { clientIp, type ClientIpContext } from "../lib/client-ip";

type ServiceOrderEnv = ServiceOrderDocumentEnv;

const IdParamSchema = z.object({ id: z.coerce.number().int().positive() });

const QuoteParamSchema = z.object({
  id: z.coerce.number().int().positive(),
  quoteId: z.coerce.number().int().positive(),
});
const QuotePdfParamSchema = z.object({
  id: z.coerce.number().int().positive(),
  quoteFile: z
    .string()
    .regex(/^[0-9]+\.pdf$/)
    .transform((value) => Number.parseInt(value, 10))
    .pipe(z.number().int().positive()),
});
const TokenParamSchema = z.object({ token: z.string().trim().min(16) });
// Portal routes service orders by the opaque publicId, not the serial id.
const PortalIdParamSchema = z.object({ id: z.string().trim().min(1) });
const PortalQuoteParamSchema = z.object({
  id: z.string().trim().min(1),
  quoteId: z.coerce.number().int().positive(),
});

// The public (token) routes have no signed-in actor: the visitor's address and
// browser go to the event log.
function requestIp(c: ClientIpContext) {
  return clientIp(c);
}

function requestUserAgent(c: {
  req: { header: (name: string) => string | undefined };
}) {
  return c.req.header("user-agent") ?? null;
}

// Public token/code responses must never be cached or indexed (mirrors
// withPublicCheckoutHeaders in public-commercial-checkout.ts).
function withPublicNoStoreHeaders(c: {
  header(name: string, value: string): void;
}) {
  c.header("Cache-Control", "private, no-store, max-age=0");
  c.header("Pragma", "no-cache");
  c.header("X-Robots-Tag", "noindex, nofollow");
}

export const serviceOrdersRouter = new Hono<{
  Bindings: ServiceOrderEnv;
  Variables: AuthVariables;
}>()
  .get(
    "/",
    ...withLabPermission({ service_order: ["read"] }),
    zValidator("query", ListServiceOrdersQuerySchema),
    async (c) => {
      const member = c.get("member");
      const query = c.req.valid("query");
      return c.json(
        (await listServiceOrdersForLab(
          member,
          query,
        )) satisfies ServerShape<ServiceOrdersListResponse>,
      );
    },
  )
  .post(
    "/",
    ...withLabPermission({ service_order: ["create"] }),
    zValidator("json", CreateServiceOrderSchema),
    async (c) => {
      const member = c.get("member");
      const input = c.req.valid("json");
      const data = await withOrg(
        member.organizationId,
        requestActor(c),
        (ctx) => createServiceOrder(ctx, member, input),
      );
      return c.json(
        { data } satisfies ServerShape<ServiceOrderCreateResponse>,
        201,
      );
    },
  )
  .get(
    "/settings",
    ...withLabPermission({ service_order: ["manage_settings"] }),
    async (c) => {
      const member = c.get("member");
      const settings = await getServiceOrderSettings(member.organizationId);
      return c.json({ data: settings });
    },
  )
  .patch(
    "/settings",
    ...withLabPermission({ service_order: ["manage_settings"] }),
    zValidator("json", UpdateServiceOrderSettingsSchema.partial()),
    async (c) => {
      const member = c.get("member");
      const input = c.req.valid("json");
      const updated = await withOrg(
        member.organizationId,
        requestActor(c),
        (ctx) => updateServiceOrderSettings(ctx, input),
      );
      return c.json({ data: updated });
    },
  )
  .get(
    "/reports/summary",
    ...withLabPermission({ service_order: ["read"] }),
    async (c) => {
      const member = c.get("member");
      return c.json({ data: await getServiceOrderSummaryReport(member) });
    },
  )
  // DOM-02 (#655) — REQ-DOM-REP-001: queue of repair OSs finalized with
  // "calibration required after repair" that don't have a calibration opened yet.
  .get(
    "/pending-calibration",
    ...withLabPermission({ service_order: ["read"] }),
    async (c) => {
      const member = c.get("member");
      return c.json(
        await listServiceOrdersPendingCalibrationAfterRepair(member),
      );
    },
  )
  .get(
    "/by-public-id/:publicId",
    ...withLabPermission({ service_order: ["read"] }),
    zValidator("param", z.object({ publicId: z.string().trim().min(1) })),
    async (c) => {
      const member = c.get("member");
      const { publicId } = c.req.valid("param");
      const id = await resolveServiceOrderIdByPublicId(publicId, member);
      if (id === null) throw serviceOrderNotFound();

      const detail = await getServiceOrderDetail(
        id,
        member.organizationId,
        buildUnitScopeCondition(serviceOrder.unitId, member),
      );
      if (!detail) throw serviceOrderNotFound();
      return c.json({ data: detail });
    },
  )
  .get(
    "/:id",
    ...withLabPermission({ service_order: ["read"] }),
    zValidator("param", IdParamSchema),
    async (c) => {
      const member = c.get("member");
      const { id } = c.req.valid("param");
      const detail = await getServiceOrderDetail(
        id,
        member.organizationId,
        buildUnitScopeCondition(serviceOrder.unitId, member),
      );
      if (!detail) throw serviceOrderNotFound();
      return c.json({
        data: detail,
      } satisfies ServerShape<ServiceOrderDetailResponse>);
    },
  )
  // #343 — per-OS customer-communication log ("Comunicações"): merges the
  // email ledger + outbox into a timestamped audit trail. Read-only, same
  // permission as viewing the OS.
  .get(
    "/:id/communications",
    ...withLabPermission({ service_order: ["read"] }),
    zValidator("param", IdParamSchema),
    async (c) => {
      const member = c.get("member");
      const { id } = c.req.valid("param");
      const result = await listServiceOrderCommunications(
        id,
        member.organizationId,
        buildUnitScopeCondition(serviceOrder.unitId, member),
      );
      if (!result) throw serviceOrderNotFound();
      return c.json(result);
    },
  )
  .patch(
    "/:id",
    ...withLabPermission({ service_order: ["update"] }),
    zValidator("param", IdParamSchema),
    zValidator("json", UpdateServiceOrderSchema),
    async (c) => {
      const member = c.get("member");
      const { id } = c.req.valid("param");
      const input = c.req.valid("json");
      const data = await withOrg(
        member.organizationId,
        requestActor(c),
        (ctx) => updateServiceOrder(ctx, member, id, input),
      );
      return c.json({ data });
    },
  )
  .post(
    "/:id/intake-document",
    ...withLabPermission({ service_order: ["print_intake_document"] }),
    zValidator("param", IdParamSchema),
    async (c) => {
      const member = c.get("member");
      const { id } = c.req.valid("param");
      const document = await withOrg(
        member.organizationId,
        requestActor(c),
        (ctx) =>
          issueIntakeDocument(ctx, member, { env: c.env, serviceOrderId: id }),
      );
      return c.json({ data: document });
    },
  )
  .post(
    "/:id/tag",
    ...withLabPermission({ service_order: ["print_tag"] }),
    zValidator("param", IdParamSchema),
    async (c) => {
      const member = c.get("member");
      const { id } = c.req.valid("param");
      const tag = await withOrg(member.organizationId, requestActor(c), (ctx) =>
        issueTag(ctx, member, id),
      );
      return c.json({ data: tag });
    },
  )
  .get(
    "/:id/intake-document.pdf",
    ...withLabPermission({ service_order: ["read"] }),
    zValidator("param", IdParamSchema),
    async (c) => {
      const member = c.get("member");
      const { id } = c.req.valid("param");
      const order = await getScopedServiceOrder(id, member);
      if (!order) throw serviceOrderNotFound();
      const url = await getLatestIntakeDocumentDownloadUrl(
        c.env,
        id,
        member.organizationId,
      );
      if (!url) throw serviceOrderPdfUnavailable();
      return c.json({ url });
    },
  )
  .get(
    "/:id/tag.pdf",
    ...withLabPermission({ service_order: ["read"] }),
    zValidator("param", IdParamSchema),
    async (c) => {
      const member = c.get("member");
      const { id } = c.req.valid("param");
      const order = await getScopedServiceOrder(id, member);
      if (!order) throw serviceOrderNotFound();
      const url = await getLatestTagDownloadUrl(
        c.env,
        id,
        member.organizationId,
      );
      if (!url) throw serviceOrderPdfUnavailable();
      return c.json({ url });
    },
  )
  .post(
    "/:id/delivery-document",
    ...withLabPermission({ service_order: ["deliver"] }),
    zValidator("param", IdParamSchema),
    zValidator("json", IssueServiceOrderDeliveryDocumentSchema),
    async (c) => {
      const member = c.get("member");
      const { id } = c.req.valid("param");
      const input = c.req.valid("json");
      const document = await withOrg(
        member.organizationId,
        requestActor(c),
        (ctx) =>
          issueDeliveryDocument(ctx, member, id, {
            technicianSignatureData: input.technicianSignatureData,
            clientSignatureData: input.clientSignatureData,
          }),
      );
      return c.json({ data: document });
    },
  )
  .get(
    "/:id/delivery-document.pdf",
    ...withLabPermission({ service_order: ["read"] }),
    zValidator("param", IdParamSchema),
    async (c) => {
      const member = c.get("member");
      const { id } = c.req.valid("param");
      const detail = await getServiceOrderDetail(
        id,
        member.organizationId,
        buildUnitScopeCondition(serviceOrder.unitId, member),
      );
      if (!detail) throw serviceOrderNotFound();
      const url = await getLatestDeliveryDocumentDownloadUrl(
        c.env,
        id,
        member.organizationId,
      );
      if (!url) throw serviceOrderPdfUnavailable();
      return c.json({ url });
    },
  )
  .patch(
    "/:id/repair-mark",
    ...withLabPermission({ service_order: ["deliver"] }),
    zValidator("param", IdParamSchema),
    zValidator("json", UpdateServiceOrderRepairMarkSchema),
    async (c) => {
      const member = c.get("member");
      const { id } = c.req.valid("param");
      const input = c.req.valid("json");
      const updated = await withOrg(
        member.organizationId,
        requestActor(c),
        (ctx) => updateServiceOrderRepairMark(ctx, member, id, input),
      );
      return c.json({ data: updated });
    },
  )
  .post(
    "/:id/assign-technician",
    ...withLabPermission({ service_order: ["assign_technician"] }),
    zValidator("param", IdParamSchema),
    zValidator("json", AssignServiceOrderTechnicianSchema),
    async (c) => {
      const member = c.get("member");
      const { id } = c.req.valid("param");
      const { technicianId } = c.req.valid("json");
      const data = await withOrg(
        member.organizationId,
        requestActor(c),
        (ctx) => assignServiceOrderTechnician(ctx, member, id, technicianId),
      );
      return c.json({ data });
    },
  )
  .post(
    "/:id/evaluations",
    ...withLabPermission({ service_order: ["evaluate"] }),
    zValidator("param", IdParamSchema),
    zValidator("json", CreateServiceOrderEvaluationSchema),
    async (c) => {
      const member = c.get("member");
      const { id } = c.req.valid("param");
      const input = c.req.valid("json");
      const data = await withOrg(
        member.organizationId,
        requestActor(c),
        (ctx) => createServiceOrderEvaluation(ctx, member, id, input),
      );
      return c.json({ data });
    },
  )
  .patch(
    "/:id/evaluations/:evaluationId",
    ...withLabPermission({ service_order: ["evaluate"] }),
    zValidator(
      "param",
      z.object({
        id: z.coerce.number().int().positive(),
        evaluationId: z.coerce.number().int().positive(),
      }),
    ),
    zValidator("json", UpdateServiceOrderEvaluationSchema),
    async (c) => {
      const member = c.get("member");
      const { id, evaluationId } = c.req.valid("param");
      const input = c.req.valid("json");
      // revisionReason is metadata about the edit, not a column on the row.
      const { revisionReason, ...values } = input;
      const data = await withOrg(
        member.organizationId,
        requestActor(c),
        (ctx) =>
          updateServiceOrderEvaluation(
            ctx,
            member,
            id,
            evaluationId,
            values,
            revisionReason,
          ),
      );
      return c.json({ data });
    },
  )
  .post(
    "/:id/quotes",
    ...withLabPermission({ service_order: ["quote_create"] }),
    zValidator("param", IdParamSchema),
    zValidator("json", CreateServiceOrderQuoteSchema),
    async (c) => {
      const member = c.get("member");
      const { id } = c.req.valid("param");
      const input = c.req.valid("json");
      const data = await withOrg(
        member.organizationId,
        requestActor(c),
        (ctx) => createServiceOrderQuote(ctx, member, id, input),
      );
      return c.json({ data }, 201);
    },
  )
  .patch(
    "/:id/quotes/:quoteId",
    ...withLabPermission({ service_order: ["quote_create"] }),
    zValidator("param", QuoteParamSchema),
    zValidator("json", UpdateServiceOrderQuoteDraftSchema),
    async (c) => {
      const member = c.get("member");
      const { id, quoteId } = c.req.valid("param");
      const input = c.req.valid("json");
      const data = await withOrg(
        member.organizationId,
        requestActor(c),
        (ctx) => updateServiceOrderQuoteDraft(ctx, member, id, quoteId, input),
      );
      return c.json({ data });
    },
  )
  .post(
    "/:id/quotes/:quoteId/send",
    ...withLabPermission({ service_order: ["quote_send"] }),
    zValidator("param", QuoteParamSchema),
    zValidator("json", SendServiceOrderQuoteSchema),
    async (c) => {
      const member = c.get("member");
      const { id, quoteId } = c.req.valid("param");
      const input = c.req.valid("json");
      const sent = await withOrg(
        member.organizationId,
        requestActor(c),
        (ctx) => sendServiceOrderQuote(ctx, member, id, quoteId, input),
      );
      return c.json({
        data: sent.data,
        publicUrl: `${buildPortalBaseUrl(c.env)}/service-order-access/${sent.publicToken}`,
      });
    },
  )
  .post(
    "/:id/quotes/:quoteId/approve-manually",
    ...withLabPermission({ service_order: ["quote_approve_manually"] }),
    zValidator("param", QuoteParamSchema),
    zValidator("json", ApproveServiceOrderQuoteManuallySchema),
    async (c) => {
      const member = c.get("member");
      const { id, quoteId } = c.req.valid("param");
      const input = c.req.valid("json");
      await withOrg(member.organizationId, requestActor(c), (ctx) =>
        approveServiceOrderQuoteManually(ctx, member, id, quoteId, input),
      );
      return c.json({ ok: true });
    },
  )
  .post(
    "/:id/quotes/:quoteId/reject-manually",
    ...withLabPermission({ service_order: ["quote_reject_manually"] }),
    zValidator("param", QuoteParamSchema),
    zValidator("json", RejectServiceOrderQuoteManuallySchema),
    async (c) => {
      const member = c.get("member");
      const { id, quoteId } = c.req.valid("param");
      const input = c.req.valid("json");
      await withOrg(member.organizationId, requestActor(c), (ctx) =>
        rejectServiceOrderQuoteManually(ctx, member, id, quoteId, input),
      );
      return c.json({ ok: true });
    },
  )
  .get(
    // Hono cannot put a literal ".pdf" after a regex param, so the param is the
    // whole "<quoteId>.pdf" segment, restricted to digits + the suffix.
    "/:id/quotes/:quoteFile{[0-9]+\\.pdf}",
    ...withLabPermission({ service_order: ["read"] }),
    zValidator("param", QuotePdfParamSchema),
    async (c) => {
      const member = c.get("member");
      const { id, quoteFile: quoteId } = c.req.valid("param");
      const order = await getScopedServiceOrder(id, member);
      if (!order) throw serviceOrderNotFound();
      const url = await getQuoteDocumentDownloadUrl(
        c.env,
        id,
        quoteId,
        member.organizationId,
      );
      if (!url) throw serviceOrderPdfUnavailable();
      return c.json({ url });
    },
  )
  .post(
    "/:id/execution/start",
    ...withLabPermission({ service_order: ["execute"] }),
    zValidator("param", IdParamSchema),
    zValidator("json", StartServiceOrderExecutionSchema),
    async (c) => {
      const member = c.get("member");
      const { id } = c.req.valid("param");
      const input = c.req.valid("json");
      const data = await withOrg(
        member.organizationId,
        requestActor(c),
        (ctx) => startServiceOrderExecution(ctx, member, id, input),
      );
      return c.json({ data });
    },
  )
  .patch(
    "/:id/execution",
    ...withLabPermission({ service_order: ["execute"] }),
    zValidator("param", IdParamSchema),
    zValidator("json", UpdateServiceOrderExecutionSchema),
    async (c) => {
      const member = c.get("member");
      const { id } = c.req.valid("param");
      const input = c.req.valid("json");
      const data = await withOrg(
        member.organizationId,
        requestActor(c),
        (ctx) => updateServiceOrderExecution(ctx, member, id, input),
      );
      return c.json({ data });
    },
  )
  .post(
    "/:id/execution/finish",
    ...withLabPermission({ service_order: ["execute"] }),
    zValidator("param", IdParamSchema),
    zValidator("json", FinishServiceOrderExecutionSchema),
    async (c) => {
      const member = c.get("member");
      const { id } = c.req.valid("param");
      const input = c.req.valid("json");
      await withOrg(member.organizationId, requestActor(c), (ctx) =>
        finishServiceOrderExecution(ctx, member, id, input),
      );
      return c.json({ ok: true });
    },
  )
  .post(
    "/:id/deliver",
    ...withLabPermission({ service_order: ["deliver"] }),
    zValidator("param", IdParamSchema),
    zValidator("json", DeliverServiceOrderSchema),
    async (c) => {
      const member = c.get("member");
      const { id } = c.req.valid("param");
      const input = c.req.valid("json");
      const data = await withOrg(
        member.organizationId,
        requestActor(c),
        (ctx) => deliverServiceOrder(ctx, member, id, input),
      );
      return c.json({ data });
    },
  )
  .post(
    "/:id/close",
    ...withLabPermission({ service_order: ["close"] }),
    zValidator("param", IdParamSchema),
    zValidator("json", CloseServiceOrderSchema),
    async (c) => {
      const member = c.get("member");
      const { id } = c.req.valid("param");
      const input = c.req.valid("json");
      const data = await withOrg(
        member.organizationId,
        requestActor(c),
        (ctx) => closeServiceOrder(ctx, member, id, input),
      );
      return c.json({ data });
    },
  )
  .post(
    "/:id/cancel",
    ...withLabPermission({ service_order: ["cancel"] }),
    zValidator("param", IdParamSchema),
    zValidator("json", CancelServiceOrderSchema),
    async (c) => {
      const member = c.get("member");
      const { id } = c.req.valid("param");
      const input = c.req.valid("json");
      const data = await withOrg(
        member.organizationId,
        requestActor(c),
        (ctx) => cancelServiceOrder(ctx, member, id, input),
      );
      return c.json({ data });
    },
  )
  .post(
    "/:id/reopen",
    ...withLabPermission({ service_order: ["reopen"] }),
    zValidator("param", IdParamSchema),
    zValidator("json", ReopenServiceOrderSchema),
    async (c) => {
      const member = c.get("member");
      const { id } = c.req.valid("param");
      const input = c.req.valid("json");
      const data = await withOrg(
        member.organizationId,
        requestActor(c),
        (ctx) => reopenServiceOrder(ctx, member, id, input),
      );
      return c.json({ data });
    },
  )
  .post(
    "/:id/certificates/:certificateJobId/link",
    ...withLabPermission({ service_order: ["update"] }),
    zValidator(
      "param",
      z.object({
        id: z.coerce.number().int().positive(),
        certificateJobId: z.coerce.number().int().positive(),
      }),
    ),
    async (c) => {
      const member = c.get("member");
      const { id, certificateJobId } = c.req.valid("param");
      const data = await withOrg(
        member.organizationId,
        requestActor(c),
        (ctx) => linkServiceOrderCertificate(ctx, id, certificateJobId),
      );
      return c.json({ data });
    },
  )
  .delete(
    "/:id/certificates/:certificateJobId/link",
    ...withLabPermission({ service_order: ["update"] }),
    zValidator(
      "param",
      z.object({
        id: z.coerce.number().int().positive(),
        certificateJobId: z.coerce.number().int().positive(),
      }),
    ),
    async (c) => {
      const member = c.get("member");
      const { id, certificateJobId } = c.req.valid("param");
      await withOrg(member.organizationId, requestActor(c), (ctx) =>
        unlinkServiceOrderCertificate(ctx, id, certificateJobId),
      );
      return c.json({ ok: true });
    },
  );

export const portalServiceOrdersRouter = new Hono<{
  Bindings: ServiceOrderEnv;
  Variables: AuthVariables;
}>()
  .get(
    "/",
    ...requirePortalProtected,
    requirePermission({ service_order: ["read"] }),
    zValidator("query", ListServiceOrdersQuerySchema),
    async (c) => {
      const member = c.get("member");
      const linkedCustomer = await getPortalCustomerForAuthOrganization(
        member.organizationId,
      );
      if (!linkedCustomer)
        return c.json({
          data: [],
          pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
        });
      const query = c.req.valid("query");
      return c.json(
        (await listServiceOrdersForPortalCustomer(
          linkedCustomer.id,
          query,
          linkedCustomer.labOrganizationId,
        )) satisfies ServerShape<PortalServiceOrdersResponse>,
      );
    },
  )
  .get(
    "/:id/financial-summary",
    ...requirePortalProtected,
    requirePermission({ service_order: ["read"] }),
    zValidator("param", PortalIdParamSchema),
    async (c) => {
      if (c.get("authSource") !== "portal") throw serviceOrderNotFound();

      const member = c.get("member");
      const linkedCustomer = await getPortalCustomerForAuthOrganization(
        member.organizationId,
      );
      if (!linkedCustomer) throw serviceOrderNotFound();

      const id = await resolvePortalServiceOrderIdByPublicId(
        c.req.valid("param").id,
        linkedCustomer.id,
        linkedCustomer.labOrganizationId,
      );
      if (id === null) throw serviceOrderNotFound();
      const detail = await getServiceOrderDetail(
        id,
        linkedCustomer.labOrganizationId,
      );
      if (!detail || detail.customerId !== linkedCustomer.id) {
        throw serviceOrderNotFound();
      }
      if (detail.unitId == null) throw serviceOrderNotFound();

      let r2Client: ReturnType<typeof createR2Client> | null = null;

      const summary = await buildPortalServiceOrderFinancialSummary({
        organizationId: linkedCustomer.labOrganizationId,
        serviceOrderId: id,
        // The portal route has already scoped the order by org and linked
        // customer. The shared financial read model still requires a unit
        // scope, so keep it limited to the visible order's unit instead of
        // inventing a broader client-side unit scope for portal users.
        scope: {
          activeUnitId: detail.unitId,
          accessibleUnitIds: [detail.unitId],
          selectedUnitScope: "unit",
        },
        documentHrefSigner: (r2Key) => {
          r2Client ??= createR2Client(c.env);
          return generatePresignedUrl(r2Client, c.env.R2_BUCKET_NAME, r2Key);
        },
      });

      if (!summary) throw serviceOrderNotFound();
      return c.json({
        data: summary,
      } satisfies ServerShape<PortalFinancialSummaryResponse>);
    },
  )
  .get(
    "/:id",
    ...requirePortalProtected,
    requirePermission({ service_order: ["read"] }),
    zValidator("param", PortalIdParamSchema),
    async (c) => {
      const member = c.get("member");
      const linkedCustomer = await getPortalCustomerForAuthOrganization(
        member.organizationId,
      );
      if (!linkedCustomer) throw serviceOrderNotFound();
      const orderId = await resolvePortalServiceOrderIdByPublicId(
        c.req.valid("param").id,
        linkedCustomer.id,
        linkedCustomer.labOrganizationId,
      );
      if (orderId === null) throw serviceOrderNotFound();
      const detail = await getServiceOrderDetail(
        orderId,
        linkedCustomer.labOrganizationId,
      );
      if (!detail || detail.customerId !== linkedCustomer.id) {
        throw serviceOrderNotFound();
      }
      return c.json({
        data: toClientVisibleServiceOrderDetail(detail),
      } satisfies ServerShape<PortalServiceOrderDetailResponse>);
    },
  )
  .post(
    "/:id/quotes/:quoteId/approve",
    ...requirePortalProtected,
    requirePermission({ service_order: ["read"] }),
    zValidator("param", PortalQuoteParamSchema),
    zValidator("json", ApproveServiceOrderQuotePortalSchema),
    async (c) => {
      const member = c.get("member");
      const { id: publicId, quoteId } = c.req.valid("param");
      const linkedCustomer = await getPortalCustomerForAuthOrganization(
        member.organizationId,
      );
      if (!linkedCustomer) throw serviceOrderQuoteNotFound();
      const id = await resolvePortalServiceOrderIdByPublicId(
        publicId,
        linkedCustomer.id,
        linkedCustomer.labOrganizationId,
      );
      if (id === null) throw serviceOrderQuoteNotFound();
      await withOrg(linkedCustomer.labOrganizationId, requestActor(c), (ctx) =>
        approveServiceOrderQuoteByPortalUser(ctx, linkedCustomer, id, quoteId),
      );
      return c.json({
        ok: true,
      } satisfies ServerShape<PortalQuoteDecisionResponse>);
    },
  )
  .post(
    "/:id/quotes/:quoteId/reject",
    ...requirePortalProtected,
    requirePermission({ service_order: ["read"] }),
    zValidator("param", PortalQuoteParamSchema),
    zValidator("json", RejectServiceOrderQuotePortalSchema),
    async (c) => {
      const member = c.get("member");
      const { id: publicId, quoteId } = c.req.valid("param");
      const input = c.req.valid("json");
      const linkedCustomer = await getPortalCustomerForAuthOrganization(
        member.organizationId,
      );
      if (!linkedCustomer) throw serviceOrderQuoteNotFound();
      const id = await resolvePortalServiceOrderIdByPublicId(
        publicId,
        linkedCustomer.id,
        linkedCustomer.labOrganizationId,
      );
      if (id === null) throw serviceOrderQuoteNotFound();
      await withOrg(linkedCustomer.labOrganizationId, requestActor(c), (ctx) =>
        rejectServiceOrderQuoteByPortalUser(
          ctx,
          linkedCustomer,
          id,
          quoteId,
          input,
        ),
      );
      return c.json({
        ok: true,
      } satisfies ServerShape<PortalQuoteDecisionResponse>);
    },
  );

export const publicServiceOrderAccessRouter = new Hono<{
  Variables: AuthVariables;
}>()
  .post(
    "/redeem-code",
    zValidator("json", RedeemServiceOrderAccessCodeSchema),
    async (c) => {
      withPublicNoStoreHeaders(c);
      // REQ-QPUB-014: throttled callers get 429 until the window elapses.
      // REQ-QPUB-013: one generic 404 for every miss — no existence oracle.
      const data = await redeemServiceOrderAccessCode(
        c.req.valid("json").code,
        {
          ipAddress: requestIp(c),
          userAgent: requestUserAgent(c),
        },
      );
      return c.json({ data });
    },
  )
  .get("/:token", zValidator("param", TokenParamSchema), async (c) => {
    withPublicNoStoreHeaders(c);
    // REQ-QPUB-006: decided grants answer 410 with a stable reason code and
    // no order/quote data; every other dead link stays a generic 404
    // (REQ-QPUB-005).
    const data = await viewPublicServiceOrderAccess(
      c.req.valid("param").token,
      {
        ipAddress: requestIp(c),
        userAgent: requestUserAgent(c),
      },
    );
    return c.json({ data });
  })
  .post(
    "/:token/approve-quote",
    zValidator("param", TokenParamSchema),
    zValidator("json", ApproveServiceOrderQuotePortalSchema),
    async (c) => {
      withPublicNoStoreHeaders(c);
      return c.json(
        await approveQuoteWithPublicServiceOrderAccess(
          c.req.valid("param").token,
          {
            ipAddress: requestIp(c),
            userAgent: requestUserAgent(c),
          },
        ),
      );
    },
  )
  .post(
    "/:token/reject-quote",
    zValidator("param", TokenParamSchema),
    zValidator("json", RejectServiceOrderQuotePortalSchema),
    async (c) => {
      withPublicNoStoreHeaders(c);
      const input = c.req.valid("json");
      return c.json(
        await rejectQuoteWithPublicServiceOrderAccess(
          c.req.valid("param").token,
          { rejectionReason: input.rejectionReason },
          {
            ipAddress: requestIp(c),
            userAgent: requestUserAgent(c),
          },
        ),
      );
    },
  );
