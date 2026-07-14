import { Hono } from "hono";
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
import { getScopedServiceOrder } from "../modules/service-orders/service-order.queries";
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

type ServiceOrderEnv = ServiceOrderDocumentEnv;

const IdParamSchema = z.object({ id: z.coerce.number().int().positive() });
const QuoteParamSchema = z.object({
  id: z.coerce.number().int().positive(),
  quoteId: z.coerce.number().int().positive(),
});
const TokenParamSchema = z.object({ token: z.string().trim().min(16) });
// Portal routes service orders by the opaque publicId, not the serial id.
const PortalIdParamSchema = z.object({ id: z.string().trim().min(1) });
const PortalQuoteParamSchema = z.object({
  id: z.string().trim().min(1),
  quoteId: z.coerce.number().int().positive(),
});

function requestIp(c: {
  req: { header: (name: string) => string | undefined };
}) {
  return (
    c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? null
  );
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
      return c.json(await listServiceOrdersForLab(member, query));
    },
  )
  .post(
    "/",
    ...withLabPermission({ service_order: ["create"] }),
    zValidator("json", CreateServiceOrderSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const input = c.req.valid("json");
      const result = await createServiceOrder({
        member,
        actorUserId: session.user.id,
        values: input,
        metadata: {
          ipAddress: requestIp(c),
          userAgent: requestUserAgent(c),
        },
      });
      if (result.status === "no_unit") {
        return c.json({ error: "Nenhuma unidade ativa" }, 400);
      }
      if (result.status === "invalid_asset") {
        return c.json({ error: "Ativo ou cliente invalido para esta OS" }, 400);
      }
      return c.json({ data: result.data }, 201);
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
      const updated = await updateServiceOrderSettings({
        organizationId: member.organizationId,
        values: input,
      });
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
      if (!detail) return c.json({ error: "OS nao encontrada" }, 404);
      return c.json({ data: detail });
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
      if (!result) return c.json({ error: "OS nao encontrada" }, 404);
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
      const session = c.get("session");
      const { id } = c.req.valid("param");
      const input = c.req.valid("json");
      const result = await updateServiceOrder({
        serviceOrderId: id,
        member,
        actorUserId: session.user.id,
        values: input,
        metadata: {
          ipAddress: requestIp(c),
          userAgent: requestUserAgent(c),
        },
      });
      if (result.status === "not_found") {
        return c.json({ error: "OS nao encontrada" }, 404);
      }
      if (result.status === "invalid_transition") {
        return c.json({ error: "Transicao de status invalida" }, 400);
      }
      return c.json({ data: result.data });
    },
  )
  .post(
    "/:id/intake-document",
    ...withLabPermission({ service_order: ["print_intake_document"] }),
    zValidator("param", IdParamSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const { id } = c.req.valid("param");
      const document = await issueIntakeDocument({
        env: c.env,
        serviceOrderId: id,
        organizationId: member.organizationId,
        unitCondition: buildUnitScopeCondition(serviceOrder.unitId, member),
        actorUserId: session.user.id,
      });
      if (!document) return c.json({ error: "OS nao encontrada" }, 404);
      return c.json({ data: document });
    },
  )
  .post(
    "/:id/tag",
    ...withLabPermission({ service_order: ["print_tag"] }),
    zValidator("param", IdParamSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const { id } = c.req.valid("param");
      const tag = await issueTag({
        serviceOrderId: id,
        organizationId: member.organizationId,
        unitCondition: buildUnitScopeCondition(serviceOrder.unitId, member),
        actorUserId: session.user.id,
      });
      if (!tag) return c.json({ error: "OS nao encontrada" }, 404);
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
      if (!order) return c.json({ error: "OS nao encontrada" }, 404);
      const url = await getLatestIntakeDocumentDownloadUrl(c.env, id);
      if (!url) return c.json({ error: "PDF indisponivel" }, 404);
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
      if (!order) return c.json({ error: "OS nao encontrada" }, 404);
      const url = await getLatestTagDownloadUrl(c.env, id);
      if (!url) return c.json({ error: "PDF indisponivel" }, 404);
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
      const session = c.get("session");
      const { id } = c.req.valid("param");
      const input = c.req.valid("json");
      const document = await issueDeliveryDocument({
        serviceOrderId: id,
        organizationId: member.organizationId,
        unitCondition: buildUnitScopeCondition(serviceOrder.unitId, member),
        actorUserId: session.user.id,
        signatures: {
          technicianSignatureData: input.technicianSignatureData,
          clientSignatureData: input.clientSignatureData,
        },
      });
      if (!document) return c.json({ error: "OS nao encontrada" }, 404);
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
      if (!detail) return c.json({ error: "OS nao encontrada" }, 404);
      const url = await getLatestDeliveryDocumentDownloadUrl(c.env, id);
      if (!url) return c.json({ error: "PDF indisponivel" }, 404);
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
      const session = c.get("session");
      const { id } = c.req.valid("param");
      const input = c.req.valid("json");
      const updated = await updateServiceOrderRepairMark({
        serviceOrderId: id,
        member,
        actorUserId: session.user.id,
        values: input,
      });
      if (!updated) return c.json({ error: "OS nao encontrada" }, 404);
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
      const session = c.get("session");
      const { id } = c.req.valid("param");
      const { technicianId } = c.req.valid("json");
      const updated = await assignServiceOrderTechnician({
        serviceOrderId: id,
        member,
        actorUserId: session.user.id,
        technicianId,
      });
      if (!updated) return c.json({ error: "OS nao encontrada" }, 404);
      return c.json({ data: updated });
    },
  )
  .post(
    "/:id/evaluations",
    ...withLabPermission({ service_order: ["evaluate"] }),
    zValidator("param", IdParamSchema),
    zValidator("json", CreateServiceOrderEvaluationSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const { id } = c.req.valid("param");
      const input = c.req.valid("json");
      const result = await createServiceOrderEvaluation({
        serviceOrderId: id,
        member,
        actorUserId: session.user.id,
        values: input,
      });
      if (result.status === "not_found") {
        return c.json({ error: "OS nao encontrada" }, 404);
      }
      if (result.status === "already_exists") {
        return c.json(
          { error: "Avaliacao ja registrada. Edite a avaliacao existente." },
          409,
        );
      }
      return c.json({ data: result.data });
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
      const updated = await updateServiceOrderEvaluation({
        serviceOrderId: id,
        evaluationId,
        member,
        values: input,
      });
      if (!updated) return c.json({ error: "Avaliacao nao encontrada" }, 404);
      return c.json({ data: updated });
    },
  )
  .post(
    "/:id/quotes",
    ...withLabPermission({ service_order: ["quote_create"] }),
    zValidator("param", IdParamSchema),
    zValidator("json", CreateServiceOrderQuoteSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const { id } = c.req.valid("param");
      const input = c.req.valid("json");
      const result = await createServiceOrderQuote({
        serviceOrderId: id,
        member,
        actorUserId: session.user.id,
        values: input,
      });
      if (result.status === "not_found") {
        return c.json({ error: "OS nao encontrada" }, 404);
      }
      return c.json({ data: result.data }, 201);
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
      const result = await updateServiceOrderQuoteDraft({
        serviceOrderId: id,
        quoteId,
        member,
        values: input,
      });
      if (result.status === "not_found") {
        return c.json({ error: "Orcamento nao encontrado" }, 404);
      }
      if (result.status === "conflict") {
        return c.json({ error: "Orcamento enviado/aprovado e imutavel" }, 409);
      }
      return c.json({ data: result.data });
    },
  )
  .post(
    "/:id/quotes/:quoteId/send",
    ...withLabPermission({ service_order: ["quote_send"] }),
    zValidator("param", QuoteParamSchema),
    zValidator("json", SendServiceOrderQuoteSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const { id, quoteId } = c.req.valid("param");
      const input = c.req.valid("json");
      const result = await sendServiceOrderQuote({
        serviceOrderId: id,
        quoteId,
        member,
        actorUserId: session.user.id,
        values: input,
      });
      if (result.status === "quote_not_found") {
        return c.json({ error: "Orcamento nao encontrado" }, 404);
      }
      if (result.status === "conflict") {
        return c.json({ error: "Apenas rascunhos podem ser enviados" }, 409);
      }
      if (result.status === "order_not_found") {
        return c.json({ error: "OS nao encontrada" }, 404);
      }
      return c.json({
        data: result.data,
        publicUrl: `${buildPortalBaseUrl(c.env)}/service-order-access/${result.publicToken}`,
      });
    },
  )
  .post(
    "/:id/quotes/:quoteId/approve-manually",
    ...withLabPermission({ service_order: ["quote_approve_manually"] }),
    zValidator("param", QuoteParamSchema),
    zValidator("json", ApproveServiceOrderQuoteManuallySchema),
    async (c) => {
      const session = c.get("session");
      const member = c.get("member");
      const { id, quoteId } = c.req.valid("param");
      // SEC-01: resolve the OS within the caller's org+unit scope first, so a
      // cross-tenant :id is rejected with 404 (mirrors the .pdf route below).
      const scoped = await getScopedServiceOrder(id, member);
      if (!scoped) return c.json({ error: "OS nao encontrada" }, 404);
      const input = c.req.valid("json");
      const result = await approveServiceOrderQuoteManually({
        serviceOrderId: id,
        quoteId,
        organizationId: member.organizationId,
        actorUserId: session.user.id,
        values: input,
      });
      if (result.status === "conflict") {
        return c.json({ error: "Orcamento nao pode ser aprovado" }, 409);
      }
      if (result.status === "order_not_found") {
        return c.json({ error: "OS nao encontrada" }, 404);
      }
      return c.json({ ok: true });
    },
  )
  .post(
    "/:id/quotes/:quoteId/reject-manually",
    ...withLabPermission({ service_order: ["quote_reject_manually"] }),
    zValidator("param", QuoteParamSchema),
    zValidator("json", RejectServiceOrderQuoteManuallySchema),
    async (c) => {
      const session = c.get("session");
      const member = c.get("member");
      const { id, quoteId } = c.req.valid("param");
      // SEC-01: resolve the OS within the caller's org+unit scope first, so a
      // cross-tenant :id is rejected with 404 (mirrors the .pdf route below).
      const scoped = await getScopedServiceOrder(id, member);
      if (!scoped) return c.json({ error: "OS nao encontrada" }, 404);
      const input = c.req.valid("json");
      const result = await rejectServiceOrderQuoteManually({
        serviceOrderId: id,
        quoteId,
        organizationId: member.organizationId,
        actorUserId: session.user.id,
        values: input,
      });
      if (result.status === "conflict") {
        return c.json({ error: "Orcamento nao pode ser recusado" }, 409);
      }
      if (result.status === "order_not_found") {
        return c.json({ error: "OS nao encontrada" }, 404);
      }
      return c.json({ ok: true });
    },
  )
  .get(
    "/:id/quotes/:quoteId.pdf",
    ...withLabPermission({ service_order: ["read"] }),
    zValidator("param", QuoteParamSchema),
    async (c) => {
      const member = c.get("member");
      const { id, quoteId } = c.req.valid("param");
      const order = await getScopedServiceOrder(id, member);
      if (!order) return c.json({ error: "OS nao encontrada" }, 404);
      const url = await getQuoteDocumentDownloadUrl(c.env, id, quoteId);
      if (!url) return c.json({ error: "PDF indisponivel" }, 404);
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
      const session = c.get("session");
      const { id } = c.req.valid("param");
      const result = await startServiceOrderExecution({
        serviceOrderId: id,
        member,
        actorUserId: session.user.id,
        values: c.req.valid("json"),
      });
      if (result.status === "not_found") {
        return c.json({ error: "OS nao encontrada" }, 404);
      }
      if (result.status === "invalid_transition") {
        return c.json({ error: "Transicao de status invalida" }, 400);
      }
      return c.json({ data: result.data });
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
      const updated = await updateServiceOrderExecution({
        serviceOrderId: id,
        member,
        values: input,
      });
      if (!updated) return c.json({ error: "Execucao nao iniciada" }, 404);
      return c.json({ data: updated });
    },
  )
  .post(
    "/:id/execution/finish",
    ...withLabPermission({ service_order: ["execute"] }),
    zValidator("param", IdParamSchema),
    zValidator("json", FinishServiceOrderExecutionSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const { id } = c.req.valid("param");
      const input = c.req.valid("json");
      const result = await finishServiceOrderExecution({
        serviceOrderId: id,
        member,
        actorUserId: session.user.id,
        values: input,
      });
      if (result.status === "not_started") {
        return c.json({ error: "Execucao nao iniciada" }, 404);
      }
      if (result.status === "not_found") {
        return c.json({ error: "OS nao encontrada" }, 404);
      }
      if (result.status === "invalid_transition") {
        return c.json({ error: "Transicao de status invalida" }, 400);
      }
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
      const session = c.get("session");
      const { id } = c.req.valid("param");
      const input = c.req.valid("json");
      const updated = await deliverServiceOrder({
        serviceOrderId: id,
        member,
        actorUserId: session.user.id,
        values: input,
      });
      if (!updated) return c.json({ error: "OS nao encontrada" }, 404);
      return c.json({ data: updated });
    },
  )
  .post(
    "/:id/close",
    ...withLabPermission({ service_order: ["close"] }),
    zValidator("param", IdParamSchema),
    zValidator("json", CloseServiceOrderSchema),
    async (c) => {
      const session = c.get("session");
      const member = c.get("member");
      const { id } = c.req.valid("param");
      const input = c.req.valid("json");
      const updated = await closeServiceOrder({
        serviceOrderId: id,
        member,
        actorUserId: session.user.id,
        values: input,
      });
      if (!updated) return c.json({ error: "OS nao encontrada" }, 404);
      return c.json({ data: updated });
    },
  )
  .post(
    "/:id/cancel",
    ...withLabPermission({ service_order: ["cancel"] }),
    zValidator("param", IdParamSchema),
    zValidator("json", CancelServiceOrderSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const { id } = c.req.valid("param");
      const input = c.req.valid("json");
      const updated = await cancelServiceOrder({
        serviceOrderId: id,
        member,
        actorUserId: session.user.id,
        values: input,
      });
      if (!updated) return c.json({ error: "OS nao encontrada" }, 404);
      return c.json({ data: updated });
    },
  )
  .post(
    "/:id/reopen",
    ...withLabPermission({ service_order: ["reopen"] }),
    zValidator("param", IdParamSchema),
    zValidator("json", ReopenServiceOrderSchema),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const { id } = c.req.valid("param");
      const input = c.req.valid("json");
      const updated = await reopenServiceOrder({
        serviceOrderId: id,
        member,
        actorUserId: session.user.id,
        values: input,
      });
      if (!updated) return c.json({ error: "OS nao encontrada" }, 404);
      return c.json({ data: updated });
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
      const session = c.get("session");
      const member = c.get("member");
      const { id, certificateJobId } = c.req.valid("param");
      const result = await linkServiceOrderCertificate({
        serviceOrderId: id,
        certificateJobId,
        organizationId: member.organizationId,
        actorUserId: session.user.id,
      });
      if (result.status === "not_found") {
        return c.json({ error: "OS ou certificado nao encontrado" }, 404);
      }
      if (result.status === "incompatible") {
        return c.json({ error: "Certificado incompativel com a OS" }, 400);
      }
      return c.json({ data: result.data });
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
      const session = c.get("session");
      const member = c.get("member");
      const { id, certificateJobId } = c.req.valid("param");
      const result = await unlinkServiceOrderCertificate({
        serviceOrderId: id,
        certificateJobId,
        organizationId: member.organizationId,
        actorUserId: session.user.id,
      });
      if (result.status === "not_found") {
        return c.json({ error: "OS ou certificado nao encontrado" }, 404);
      }
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
        await listServiceOrdersForPortalCustomer(linkedCustomer.id, query),
      );
    },
  )
  .get(
    "/:id/financial-summary",
    ...requirePortalProtected,
    requirePermission({ service_order: ["read"] }),
    zValidator("param", PortalIdParamSchema),
    async (c) => {
      if (c.get("authSource") !== "portal") {
        return c.json({ error: "OS nao encontrada" }, 404);
      }

      const member = c.get("member");
      const linkedCustomer = await getPortalCustomerForAuthOrganization(
        member.organizationId,
      );
      if (!linkedCustomer) return c.json({ error: "OS nao encontrada" }, 404);

      const id = await resolvePortalServiceOrderIdByPublicId(
        c.req.valid("param").id,
        linkedCustomer.id,
      );
      if (id === null) return c.json({ error: "OS nao encontrada" }, 404);
      const detail = await getServiceOrderDetail(
        id,
        linkedCustomer.labOrganizationId,
      );
      if (!detail || detail.customerId !== linkedCustomer.id) {
        return c.json({ error: "OS nao encontrada" }, 404);
      }
      if (detail.unitId == null) {
        return c.json({ error: "OS nao encontrada" }, 404);
      }

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

      if (!summary) return c.json({ error: "OS nao encontrada" }, 404);
      return c.json({ data: summary });
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
      if (!linkedCustomer) return c.json({ error: "OS nao encontrada" }, 404);
      const orderId = await resolvePortalServiceOrderIdByPublicId(
        c.req.valid("param").id,
        linkedCustomer.id,
      );
      if (orderId === null) return c.json({ error: "OS nao encontrada" }, 404);
      const detail = await getServiceOrderDetail(
        orderId,
        linkedCustomer.labOrganizationId,
      );
      if (!detail || detail.customerId !== linkedCustomer.id) {
        return c.json({ error: "OS nao encontrada" }, 404);
      }
      return c.json({ data: toClientVisibleServiceOrderDetail(detail) });
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
      const session = c.get("session");
      const { id: publicId, quoteId } = c.req.valid("param");
      const linkedCustomer = await getPortalCustomerForAuthOrganization(
        member.organizationId,
      );
      if (!linkedCustomer) {
        return c.json({ error: "Orcamento nao encontrado" }, 404);
      }
      const id = await resolvePortalServiceOrderIdByPublicId(
        publicId,
        linkedCustomer.id,
      );
      if (id === null) {
        return c.json({ error: "Orcamento nao encontrado" }, 404);
      }
      const result = await approveServiceOrderQuoteByPortalUser({
        serviceOrderId: id,
        quoteId,
        authOrganizationId: member.organizationId,
        actorUserId: session.user.id,
        metadata: {
          ipAddress: requestIp(c),
          userAgent: requestUserAgent(c),
        },
      });
      if (result.status === "not_found") {
        return c.json({ error: "Orcamento nao encontrado" }, 404);
      }
      if (result.status === "conflict") {
        return c.json({ error: "Orcamento nao pode ser aprovado" }, 409);
      }
      return c.json({ ok: true });
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
      const session = c.get("session");
      const { id: publicId, quoteId } = c.req.valid("param");
      const input = c.req.valid("json");
      const linkedCustomer = await getPortalCustomerForAuthOrganization(
        member.organizationId,
      );
      if (!linkedCustomer) {
        return c.json({ error: "Orcamento nao encontrado" }, 404);
      }
      const id = await resolvePortalServiceOrderIdByPublicId(
        publicId,
        linkedCustomer.id,
      );
      if (id === null) {
        return c.json({ error: "Orcamento nao encontrado" }, 404);
      }
      const result = await rejectServiceOrderQuoteByPortalUser({
        serviceOrderId: id,
        quoteId,
        authOrganizationId: member.organizationId,
        actorUserId: session.user.id,
        values: input,
        metadata: {
          ipAddress: requestIp(c),
          userAgent: requestUserAgent(c),
        },
      });
      if (result.status === "not_found") {
        return c.json({ error: "Orcamento nao encontrado" }, 404);
      }
      return c.json({ ok: true });
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
      const result = await redeemServiceOrderAccessCode(
        c.req.valid("json").code,
        {
          ipAddress: requestIp(c),
          userAgent: requestUserAgent(c),
        },
      );

      // REQ-QPUB-014: throttled callers get 429 until the window elapses.
      if (result.status === "throttled") {
        return c.json({ error: result.error }, 429);
      }
      // REQ-QPUB-013: one generic 404 for every miss — no existence oracle.
      if (result.status === "not_found") {
        return c.json({ error: result.error }, 404);
      }
      return c.json({ data: result.data });
    },
  )
  .get("/:token", zValidator("param", TokenParamSchema), async (c) => {
    withPublicNoStoreHeaders(c);
    const result = await viewPublicServiceOrderAccess(
      c.req.valid("param").token,
      {
        ipAddress: requestIp(c),
        userAgent: requestUserAgent(c),
      },
    );

    // REQ-QPUB-006: decided grants answer 410 with a stable reason code and
    // no order/quote data; every other dead link stays a generic 404
    // (REQ-QPUB-005).
    if (result.status === "gone") return c.json({ error: result.error }, 410);
    if (result.status !== "ok") return c.json({ error: result.error }, 404);
    return c.json({ data: result.data });
  })
  .post(
    "/:token/approve-quote",
    zValidator("param", TokenParamSchema),
    zValidator("json", ApproveServiceOrderQuotePortalSchema),
    async (c) => {
      withPublicNoStoreHeaders(c);
      const result = await approveQuoteWithPublicServiceOrderAccess(
        c.req.valid("param").token,
        {
          ipAddress: requestIp(c),
          userAgent: requestUserAgent(c),
        },
      );

      if (result.status === "not_found" || result.status === "gone") {
        return c.json({ error: result.error }, 404);
      }
      if (result.status === "conflict") {
        return c.json({ error: result.error }, 409);
      }

      return c.json(result.data);
    },
  )
  .post(
    "/:token/reject-quote",
    zValidator("param", TokenParamSchema),
    zValidator("json", RejectServiceOrderQuotePortalSchema),
    async (c) => {
      withPublicNoStoreHeaders(c);
      const input = c.req.valid("json");
      const result = await rejectQuoteWithPublicServiceOrderAccess(
        c.req.valid("param").token,
        { rejectionReason: input.rejectionReason },
        {
          ipAddress: requestIp(c),
          userAgent: requestUserAgent(c),
        },
      );

      if (result.status === "not_found" || result.status === "gone") {
        return c.json({ error: result.error }, 404);
      }
      if (result.status === "conflict") {
        return c.json({ error: result.error }, 409);
      }

      return c.json(result.data);
    },
  );
