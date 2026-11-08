import { createRouter } from "../../../server/router";
import { mount } from "../../../lib/endpoint-mount";
import { orgDb } from "../../../lib/org-db";
import {
  portalServiceOrderEndpoints,
  serviceOrderEndpoints,
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
} from "../../../middleware/permission";
import { buildUnitScopeCondition } from "../../../lib/units";
import { withOrg } from "../../../lib/org-context";
import { requestActor } from "../../../middleware/request-actor";
import {
  serviceOrderNotFound,
  serviceOrderPdfUnavailable,
  serviceOrderQuoteNotFound,
} from "../service-order-errors";
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
} from "../service-order.documents";
import { createR2Client, generatePresignedUrl } from "../../../lib/storage";
import {
  getScopedServiceOrder,
  resolveServiceOrderIdByPublicId,
} from "../service-order.queries";
import {
  getPortalCustomerForAuthOrganization,
  getServiceOrderSummaryReport,
  listServiceOrdersForLab,
  listServiceOrdersForPortalCustomer,
  listServiceOrdersPendingCalibrationAfterRepair,
  resolvePortalServiceOrderIdByPublicId,
} from "../service-order.list-queries";
import {
  getServiceOrderDetail,
  toClientVisibleServiceOrderDetail,
} from "../service-order.read-model";
import { listServiceOrderCommunications } from "../service-order.communications";
import { buildPortalServiceOrderFinancialSummary } from "../portal-financial-summary";
import {
  approveQuoteWithPublicServiceOrderAccess,
  redeemServiceOrderAccessCode,
  rejectQuoteWithPublicServiceOrderAccess,
  viewPublicServiceOrderAccess,
} from "../service-order.tokens";
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
} from "../service-order.commands";
import {
  finishServiceOrderExecution,
  startServiceOrderExecution,
  updateServiceOrderExecution,
} from "../service-order.execution";
import {
  createServiceOrderEvaluation,
  updateServiceOrderEvaluation,
} from "../service-order.evaluations";
import {
  linkServiceOrderCertificate,
  unlinkServiceOrderCertificate,
} from "../service-order.certificates";
import {
  approveServiceOrderQuoteByPortalUser,
  approveServiceOrderQuoteManually,
  createServiceOrderQuote,
  rejectServiceOrderQuoteByPortalUser,
  rejectServiceOrderQuoteManually,
  sendServiceOrderQuote,
  updateServiceOrderQuoteDraft,
} from "../service-order.quotes";
import { clientIp, type ClientIpContext } from "../../../lib/client-ip";

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

const PREFIX = "/api/service-orders";
// The portal routes service orders by the opaque publicId, not the serial id.
const PORTAL_PREFIX = "/api/portal/service-orders";

export const serviceOrdersRouter = createRouter<{
  Bindings: ServiceOrderEnv;
  Variables: AuthVariables;
}>();

mount(
  serviceOrdersRouter,
  PREFIX,
  serviceOrderEndpoints.list,
  withLabPermission({ service_order: ["read"] }),
  async (c, { query }) => {
    const member = c.get("member");
    return await listServiceOrdersForLab(member, query);
  },
);

mount(
  serviceOrdersRouter,
  PREFIX,
  serviceOrderEndpoints.create,
  withLabPermission({ service_order: ["create"] }),
  async (c, { body }) => {
    const member = c.get("member");
    const input = body;
    const data = await withOrg(member.organizationId, requestActor(c), (ctx) =>
      createServiceOrder(ctx, member, input),
    );
    return { data };
  },
);

serviceOrdersRouter.get(
  "/settings",
  ...withLabPermission({ service_order: ["manage_settings"] }),
  async (c) => {
    const member = c.get("member");
    const settings = await getServiceOrderSettings(member.organizationId);
    return c.json({ data: settings });
  },
);

serviceOrdersRouter.patch(
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
);

serviceOrdersRouter.get(
  "/reports/summary",
  ...withLabPermission({ service_order: ["read"] }),
  async (c) => {
    const member = c.get("member");
    return c.json({ data: await getServiceOrderSummaryReport(member) });
  },
);

// DOM-02 (#655) — REQ-DOM-REP-001: queue of repair OSs finalized with
// "calibration required after repair" that don't have a calibration opened yet.
serviceOrdersRouter.get(
  "/pending-calibration",
  ...withLabPermission({ service_order: ["read"] }),
  async (c) => {
    const member = c.get("member");
    return c.json(await listServiceOrdersPendingCalibrationAfterRepair(member));
  },
);

mount(
  serviceOrdersRouter,
  PREFIX,
  serviceOrderEndpoints.getByPublicId,
  [...withLabPermission({ service_order: ["read"] })],
  async (c, { params }) => {
    const member = c.get("member");
    const publicId = params.publicId;
    const id = await resolveServiceOrderIdByPublicId(publicId, member);
    if (id === null) throw serviceOrderNotFound();

    const detail = await orgDb(member.organizationId).transaction((o) =>
      getServiceOrderDetail(
        o,
        id,
        member.organizationId,
        buildUnitScopeCondition(serviceOrder.unitId, member),
      ),
    );
    if (!detail) throw serviceOrderNotFound();
    return { data: detail };
  },
);

mount(
  serviceOrdersRouter,
  PREFIX,
  serviceOrderEndpoints.get,
  [...withLabPermission({ service_order: ["read"] })],
  async (c, { params }) => {
    const member = c.get("member");
    const id = params.id;
    const detail = await orgDb(member.organizationId).transaction((o) =>
      getServiceOrderDetail(
        o,
        id,
        member.organizationId,
        buildUnitScopeCondition(serviceOrder.unitId, member),
      ),
    );
    if (!detail) throw serviceOrderNotFound();
    return { data: detail };
  },
);

// #343 — per-OS customer-communication log ("Comunicações"): merges the
// email ledger + outbox into a timestamped audit trail. Read-only, same
// permission as viewing the OS.
mount(
  serviceOrdersRouter,
  PREFIX,
  serviceOrderEndpoints.listCommunications,
  [...withLabPermission({ service_order: ["read"] })],
  async (c, { params }) => {
    const member = c.get("member");
    const id = params.id;
    const result = await orgDb(member.organizationId).transaction((o) =>
      listServiceOrderCommunications(
        o,
        id,
        member.organizationId,
        buildUnitScopeCondition(serviceOrder.unitId, member),
      ),
    );
    if (!result) throw serviceOrderNotFound();
    return result;
  },
);

mount(
  serviceOrdersRouter,
  PREFIX,
  serviceOrderEndpoints.update,
  [...withLabPermission({ service_order: ["update"] })],
  async (c, { params, body }) => {
    const member = c.get("member");
    const id = params.id;
    const input = body;
    const data = await withOrg(member.organizationId, requestActor(c), (ctx) =>
      updateServiceOrder(ctx, member, id, input),
    );
    return { data };
  },
);

mount(
  serviceOrdersRouter,
  PREFIX,
  serviceOrderEndpoints.generateIntakeDocument,
  [...withLabPermission({ service_order: ["print_intake_document"] })],
  async (c, { params }) => {
    const member = c.get("member");
    const id = params.id;
    const document = await withOrg(
      member.organizationId,
      requestActor(c),
      (ctx) =>
        issueIntakeDocument(ctx, member, { env: c.env, serviceOrderId: id }),
    );
    return { data: document };
  },
);

mount(
  serviceOrdersRouter,
  PREFIX,
  serviceOrderEndpoints.generateTag,
  [...withLabPermission({ service_order: ["print_tag"] })],
  async (c, { params }) => {
    const member = c.get("member");
    const id = params.id;
    const tag = await withOrg(member.organizationId, requestActor(c), (ctx) =>
      issueTag(ctx, member, id),
    );
    return { data: tag };
  },
);

mount(
  serviceOrdersRouter,
  PREFIX,
  serviceOrderEndpoints.getIntakeDocumentPdf,
  [...withLabPermission({ service_order: ["read"] })],
  async (c, { params }) => {
    const member = c.get("member");
    const id = params.id;
    const order = await orgDb(member.organizationId).transaction((o) =>
      getScopedServiceOrder(id, member, o),
    );
    if (!order) throw serviceOrderNotFound();
    const url = await getLatestIntakeDocumentDownloadUrl(
      c.env,
      id,
      member.organizationId,
    );
    if (!url) throw serviceOrderPdfUnavailable();
    return { url };
  },
);

mount(
  serviceOrdersRouter,
  PREFIX,
  serviceOrderEndpoints.getTagPdf,
  [...withLabPermission({ service_order: ["read"] })],
  async (c, { params }) => {
    const member = c.get("member");
    const id = params.id;
    const order = await orgDb(member.organizationId).transaction((o) =>
      getScopedServiceOrder(id, member, o),
    );
    if (!order) throw serviceOrderNotFound();
    const url = await getLatestTagDownloadUrl(c.env, id, member.organizationId);
    if (!url) throw serviceOrderPdfUnavailable();
    return { url };
  },
);

mount(
  serviceOrdersRouter,
  PREFIX,
  serviceOrderEndpoints.issueDeliveryDocument,
  [...withLabPermission({ service_order: ["deliver"] })],
  async (c, { params, body }) => {
    const member = c.get("member");
    const id = params.id;
    const input = body;
    const document = await withOrg(
      member.organizationId,
      requestActor(c),
      (ctx) =>
        issueDeliveryDocument(ctx, member, id, {
          technicianSignatureData: input.technicianSignatureData,
          clientSignatureData: input.clientSignatureData,
        }),
    );
    return { data: document };
  },
);

mount(
  serviceOrdersRouter,
  PREFIX,
  serviceOrderEndpoints.getDeliveryDocumentPdf,
  [...withLabPermission({ service_order: ["read"] })],
  async (c, { params }) => {
    const member = c.get("member");
    const id = params.id;
    const detail = await orgDb(member.organizationId).transaction((o) =>
      getServiceOrderDetail(
        o,
        id,
        member.organizationId,
        buildUnitScopeCondition(serviceOrder.unitId, member),
      ),
    );
    if (!detail) throw serviceOrderNotFound();
    const url = await getLatestDeliveryDocumentDownloadUrl(
      c.env,
      id,
      member.organizationId,
    );
    if (!url) throw serviceOrderPdfUnavailable();
    return { url };
  },
);

mount(
  serviceOrdersRouter,
  PREFIX,
  serviceOrderEndpoints.updateRepairMark,
  [...withLabPermission({ service_order: ["deliver"] })],
  async (c, { params, body }) => {
    const member = c.get("member");
    const id = params.id;
    const input = body;
    const updated = await withOrg(
      member.organizationId,
      requestActor(c),
      (ctx) => updateServiceOrderRepairMark(ctx, member, id, input),
    );
    return { data: updated };
  },
);

serviceOrdersRouter.post(
  "/:id/assign-technician",
  ...withLabPermission({ service_order: ["assign_technician"] }),
  zValidator("param", IdParamSchema),
  zValidator("json", AssignServiceOrderTechnicianSchema),
  async (c) => {
    const member = c.get("member");
    const { id } = c.req.valid("param");
    const { technicianId } = c.req.valid("json");
    const data = await withOrg(member.organizationId, requestActor(c), (ctx) =>
      assignServiceOrderTechnician(ctx, member, id, technicianId),
    );
    return c.json({ data });
  },
);

mount(
  serviceOrdersRouter,
  PREFIX,
  serviceOrderEndpoints.createEvaluation,
  [...withLabPermission({ service_order: ["evaluate"] })],
  async (c, { params, body }) => {
    const member = c.get("member");
    const id = params.id;
    const input = body;
    const data = await withOrg(member.organizationId, requestActor(c), (ctx) =>
      createServiceOrderEvaluation(ctx, member, id, input),
    );
    return { data };
  },
);

mount(
  serviceOrdersRouter,
  PREFIX,
  serviceOrderEndpoints.updateEvaluation,
  [...withLabPermission({ service_order: ["evaluate"] })],
  async (c, { params, body }) => {
    const member = c.get("member");
    const id = params.id;
    const evaluationId = params.evaluationId;
    const input = body;
    // revisionReason is metadata about the edit, not a column on the row.
    const { revisionReason, ...values } = input;
    const data = await withOrg(member.organizationId, requestActor(c), (ctx) =>
      updateServiceOrderEvaluation(
        ctx,
        member,
        id,
        evaluationId,
        values,
        revisionReason,
      ),
    );
    return { data };
  },
);

mount(
  serviceOrdersRouter,
  PREFIX,
  serviceOrderEndpoints.createQuote,
  [...withLabPermission({ service_order: ["quote_create"] })],
  async (c, { params, body }) => {
    const member = c.get("member");
    const id = params.id;
    const input = body;
    const data = await withOrg(member.organizationId, requestActor(c), (ctx) =>
      createServiceOrderQuote(ctx, member, id, input),
    );
    return { data };
  },
);

serviceOrdersRouter.patch(
  "/:id/quotes/:quoteId",
  ...withLabPermission({ service_order: ["quote_create"] }),
  zValidator("param", QuoteParamSchema),
  zValidator("json", UpdateServiceOrderQuoteDraftSchema),
  async (c) => {
    const member = c.get("member");
    const { id, quoteId } = c.req.valid("param");
    const input = c.req.valid("json");
    const data = await withOrg(member.organizationId, requestActor(c), (ctx) =>
      updateServiceOrderQuoteDraft(ctx, member, id, quoteId, input),
    );
    return c.json({ data });
  },
);

mount(
  serviceOrdersRouter,
  PREFIX,
  serviceOrderEndpoints.sendQuote,
  [...withLabPermission({ service_order: ["quote_send"] })],
  async (c, { params, body }) => {
    const member = c.get("member");
    const id = params.id;
    const quoteId = params.quoteId;
    const input = body;
    const sent = await withOrg(member.organizationId, requestActor(c), (ctx) =>
      sendServiceOrderQuote(ctx, member, id, quoteId, input),
    );
    return {
      data: sent.data,
      publicUrl: `${buildPortalBaseUrl(c.env)}/service-order-access/${sent.publicToken}`,
    };
  },
);

serviceOrdersRouter.post(
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
);

serviceOrdersRouter.post(
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
);

serviceOrdersRouter.get(
  "/:id/quotes/:quoteFile{[0-9]+\\.pdf}",
  ...withLabPermission({ service_order: ["read"] }),
  zValidator("param", QuotePdfParamSchema),
  async (c) => {
    const member = c.get("member");
    const { id, quoteFile: quoteId } = c.req.valid("param");
    const order = await orgDb(member.organizationId).transaction((o) =>
      getScopedServiceOrder(id, member, o),
    );
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
);

mount(
  serviceOrdersRouter,
  PREFIX,
  serviceOrderEndpoints.startExecution,
  [...withLabPermission({ service_order: ["execute"] })],
  async (c, { params, body }) => {
    const member = c.get("member");
    const id = params.id;
    const data = await withOrg(member.organizationId, requestActor(c), (ctx) =>
      startServiceOrderExecution(ctx, member, id, body),
    );
    return { data };
  },
);

serviceOrdersRouter.patch(
  "/:id/execution",
  ...withLabPermission({ service_order: ["execute"] }),
  zValidator("param", IdParamSchema),
  zValidator("json", UpdateServiceOrderExecutionSchema),
  async (c) => {
    const member = c.get("member");
    const { id } = c.req.valid("param");
    const input = c.req.valid("json");
    const data = await withOrg(member.organizationId, requestActor(c), (ctx) =>
      updateServiceOrderExecution(ctx, member, id, input),
    );
    return c.json({ data });
  },
);

mount(
  serviceOrdersRouter,
  PREFIX,
  serviceOrderEndpoints.saveExecution,
  [...withLabPermission({ service_order: ["execute"] })],
  async (c, { params, body }) => {
    const member = c.get("member");
    const id = params.id;
    const input = body;
    await withOrg(member.organizationId, requestActor(c), (ctx) =>
      finishServiceOrderExecution(ctx, member, id, input),
    );
    return { ok: true };
  },
);

mount(
  serviceOrdersRouter,
  PREFIX,
  serviceOrderEndpoints.deliver,
  [...withLabPermission({ service_order: ["deliver"] })],
  async (c, { params, body }) => {
    const member = c.get("member");
    const id = params.id;
    const input = body;
    const data = await withOrg(member.organizationId, requestActor(c), (ctx) =>
      deliverServiceOrder(ctx, member, id, input),
    );
    return { data };
  },
);

serviceOrdersRouter.post(
  "/:id/close",
  ...withLabPermission({ service_order: ["close"] }),
  zValidator("param", IdParamSchema),
  zValidator("json", CloseServiceOrderSchema),
  async (c) => {
    const member = c.get("member");
    const { id } = c.req.valid("param");
    const input = c.req.valid("json");
    const data = await withOrg(member.organizationId, requestActor(c), (ctx) =>
      closeServiceOrder(ctx, member, id, input),
    );
    return c.json({ data });
  },
);

serviceOrdersRouter.post(
  "/:id/cancel",
  ...withLabPermission({ service_order: ["cancel"] }),
  zValidator("param", IdParamSchema),
  zValidator("json", CancelServiceOrderSchema),
  async (c) => {
    const member = c.get("member");
    const { id } = c.req.valid("param");
    const input = c.req.valid("json");
    const data = await withOrg(member.organizationId, requestActor(c), (ctx) =>
      cancelServiceOrder(ctx, member, id, input),
    );
    return c.json({ data });
  },
);

serviceOrdersRouter.post(
  "/:id/reopen",
  ...withLabPermission({ service_order: ["reopen"] }),
  zValidator("param", IdParamSchema),
  zValidator("json", ReopenServiceOrderSchema),
  async (c) => {
    const member = c.get("member");
    const { id } = c.req.valid("param");
    const input = c.req.valid("json");
    const data = await withOrg(member.organizationId, requestActor(c), (ctx) =>
      reopenServiceOrder(ctx, member, id, input),
    );
    return c.json({ data });
  },
);

serviceOrdersRouter.post(
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
    const data = await withOrg(member.organizationId, requestActor(c), (ctx) =>
      linkServiceOrderCertificate(ctx, id, certificateJobId),
    );
    return c.json({ data });
  },
);

serviceOrdersRouter.delete(
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

export const portalServiceOrdersRouter = createRouter<{
  Bindings: ServiceOrderEnv;
  Variables: AuthVariables;
}>();

mount(
  portalServiceOrdersRouter,
  PORTAL_PREFIX,
  portalServiceOrderEndpoints.list,
  [...requirePortalProtected, requirePermission({ service_order: ["read"] })],
  async (c, { query }) => {
    const member = c.get("member");
    const linkedCustomer = await getPortalCustomerForAuthOrganization(
      member.organizationId,
    );
    if (!linkedCustomer)
      return {
        data: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      };
    return await listServiceOrdersForPortalCustomer(
      linkedCustomer.id,
      query,
      linkedCustomer.labOrganizationId,
    );
  },
);

mount(
  portalServiceOrdersRouter,
  PORTAL_PREFIX,
  portalServiceOrderEndpoints.financialSummary,
  [...requirePortalProtected, requirePermission({ service_order: ["read"] })],
  async (c, { params }) => {
    if (c.get("authSource") !== "portal") throw serviceOrderNotFound();

    const member = c.get("member");
    const linkedCustomer = await getPortalCustomerForAuthOrganization(
      member.organizationId,
    );
    if (!linkedCustomer) throw serviceOrderNotFound();

    const id = await resolvePortalServiceOrderIdByPublicId(
      params.id,
      linkedCustomer.id,
      linkedCustomer.labOrganizationId,
    );
    if (id === null) throw serviceOrderNotFound();
    const detail = await orgDb(linkedCustomer.labOrganizationId).transaction(
      (o) => getServiceOrderDetail(o, id, linkedCustomer.labOrganizationId),
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
    return {
      data: summary,
    };
  },
);

mount(
  portalServiceOrdersRouter,
  PORTAL_PREFIX,
  portalServiceOrderEndpoints.get,
  [...requirePortalProtected, requirePermission({ service_order: ["read"] })],
  async (c, { params }) => {
    const member = c.get("member");
    const linkedCustomer = await getPortalCustomerForAuthOrganization(
      member.organizationId,
    );
    if (!linkedCustomer) throw serviceOrderNotFound();
    const orderId = await resolvePortalServiceOrderIdByPublicId(
      params.id,
      linkedCustomer.id,
      linkedCustomer.labOrganizationId,
    );
    if (orderId === null) throw serviceOrderNotFound();
    const detail = await orgDb(linkedCustomer.labOrganizationId).transaction(
      (o) =>
        getServiceOrderDetail(o, orderId, linkedCustomer.labOrganizationId),
    );
    if (!detail || detail.customerId !== linkedCustomer.id) {
      throw serviceOrderNotFound();
    }
    return {
      data: toClientVisibleServiceOrderDetail(detail),
    };
  },
);

mount(
  portalServiceOrdersRouter,
  PORTAL_PREFIX,
  portalServiceOrderEndpoints.approveQuote,
  [...requirePortalProtected, requirePermission({ service_order: ["read"] })],
  async (c, { params }) => {
    const member = c.get("member");
    const { id: publicId, quoteId } = params;
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
    return {
      ok: true,
    };
  },
);

mount(
  portalServiceOrdersRouter,
  PORTAL_PREFIX,
  portalServiceOrderEndpoints.rejectQuote,
  [...requirePortalProtected, requirePermission({ service_order: ["read"] })],
  async (c, { params, body }) => {
    const member = c.get("member");
    const { id: publicId, quoteId } = params;
    const input = body;
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
    return {
      ok: true,
    };
  },
);

export const publicServiceOrderAccessRouter = createRouter<{
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
