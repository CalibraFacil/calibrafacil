import { z } from "zod";
import {
  CreateServiceOrderEvaluationSchema,
  CreateServiceOrderQuoteSchema,
  CreateServiceOrderSchema,
  DeliverServiceOrderSchema,
  FinishServiceOrderExecutionSchema,
  IssueServiceOrderDeliveryDocumentSchema,
  ListServiceOrdersQuerySchema,
  SendServiceOrderQuoteSchema,
  MetrologyRegimeSchema,
  ServiceOrderPrioritySchema,
  ServiceOrderStatusSchema,
  StartServiceOrderExecutionSchema,
  UpdateServiceOrderEvaluationSchema,
  UpdateServiceOrderRepairMarkSchema,
  UpdateServiceOrderSchema,
} from "@calibra-facil/schemas";

import {
  SERVICE_ORDER_DELIVERY_METHODS,
  SERVICE_ORDER_EXECUTION_RESULTS,
  SERVICE_ORDER_ITEM_TYPES,
  SERVICE_ORDER_QUOTE_STATUSES,
  SERVICE_ORDER_RECOMMENDED_ACTIONS,
} from "@calibra-facil/shared";

import { nullableString, paginationSchema } from "../common";
import { endpoint, routeId, type EndpointGroup } from "./define";

/**
 * The laboratory's service orders (repair / evaluation / intake). Response
 * schemas are wire schemas written from what the handlers in
 * `apps/api/src/domains/service-orders/routes/service-orders.ts` return; the desktop local-server
 * answers `list`, `get` and `create` with the same ones
 * (`apps/local-server/src/contract.test.ts`), so what only the cloud keeps is
 * optional here.
 *
 * Not client-facing, so not defined here: settings, the summary report, the
 * pending-calibration queue, technician assignment, quote edits and manual
 * decisions, execution start/update, close/cancel/reopen, certificate links and
 * the quote PDF (no SDK method calls them), and the portal and public-access
 * routers.
 */

const jsonRecordSchema = z.record(z.string(), z.unknown());

export const serviceOrderStatusSchema = ServiceOrderStatusSchema;
const serviceOrderPrioritySchema = ServiceOrderPrioritySchema;

/** One row of GET /api/service-orders. */
const serviceOrderListItemSchema = z.object({
  id: z.number(),
  /** Opaque id the dashboard links with; the serial never reaches a URL. */
  publicId: z.string(),
  serviceOrderNumber: z.string(),
  customerName: z.string(),
  assetName: z.string(),
  assetSerialNumber: nullableString,
  status: serviceOrderStatusSchema,
  statusLabel: z.string(),
  priority: serviceOrderPrioritySchema,
  responsibleTechnicianName: nullableString,
  openedAt: z.string(),
  quotedAt: nullableString,
  approvedAt: nullableString,
  totalApprovedCents: z.number(),
  totalQuotedCents: z.number(),
  unitName: nullableString,
});

/** GET /api/service-orders */
export const serviceOrdersListResponseSchema = z.object({
  data: z.array(serviceOrderListItemSchema),
  pagination: paginationSchema,
});
export type ServiceOrdersListResponse = z.infer<
  typeof serviceOrdersListResponseSchema
>;

/** POST /api/service-orders (201): enough to redirect to the new order. */
export const serviceOrderCreateResponseSchema = z.object({
  data: z.object({
    id: z.number(),
    publicId: z.string(),
    serviceOrderNumber: z.string(),
  }),
});
export type ServiceOrderCreateResponse = z.infer<
  typeof serviceOrderCreateResponseSchema
>;

const serviceOrderQuoteItemSchema = z.object({
  id: z.number(),
  type: z.enum(SERVICE_ORDER_ITEM_TYPES),
  description: z.string(),
  quantity: z.number(),
  unit: z.string(),
  unitPriceCents: z.number(),
  totalPriceCents: z.number(),
  taxable: z.boolean().optional(),
  warrantyCovered: z.boolean().optional(),
  materialId: z.number().nullable().optional(),
  notes: nullableString.optional(),
});

const serviceOrderQuoteSchema = z.object({
  id: z.number(),
  status: z.enum(SERVICE_ORDER_QUOTE_STATUSES),
  totalCents: z.number(),
  version: z.number(),
  validUntil: nullableString.optional(),
  paymentTerms: nullableString.optional(),
  deliveryEstimate: nullableString.optional(),
  warrantyTerms: nullableString.optional(),
  clientMessage: nullableString.optional(),
  subtotalServicesCents: z.number().optional(),
  subtotalPartsCents: z.number().optional(),
  freightCents: z.number().optional(),
  discountCents: z.number().optional(),
  items: z.array(serviceOrderQuoteItemSchema),
});

const serviceOrderAssetSnapshotSchema = z.object({
  assetName: z.string(),
  assetType: nullableString.optional(),
  manufacturer: nullableString.optional(),
  model: nullableString.optional(),
  serialNumber: nullableString.optional(),
  patrimonyNumber: nullableString.optional(),
  capacity: nullableString.optional(),
  resolution: nullableString.optional(),
  observedIdentification: nullableString.optional(),
  displaySpecs: z
    .array(z.object({ label: z.string(), value: z.string() }))
    .nullable()
    .optional(),
});

const serviceOrderEvaluationSchema = z.object({
  id: z.number(),
  diagnosis: z.string(),
  detectedIssues: nullableString.optional(),
  recommendedAction: z.enum(SERVICE_ORDER_RECOMMENDED_ACTIONS),
  requiresQuote: z.boolean(),
  requiresClientApproval: z.boolean(),
  calibrationRecommended: z.boolean(),
  clientVisibleNotes: nullableString.optional(),
  internalNotes: nullableString.optional(),
  evaluatedAt: z.string(),
});

const serviceOrderExecutionSchema = z.object({
  id: z.number(),
  startedAt: z.string(),
  finishedAt: nullableString.optional(),
  servicePerformed: nullableString.optional(),
  partsUsedSummary: nullableString.optional(),
  technicalNotes: nullableString.optional(),
  calibrationRequiredAfterRepair: z.boolean(),
  result: z.enum(SERVICE_ORDER_EXECUTION_RESULTS).nullable().optional(),
  items: z.array(serviceOrderQuoteItemSchema),
});

/**
 * The order as GET /api/service-orders/:id returns it (the `data` of the
 * response). The organization, customer and delivery parts are the cloud's; the
 * offline mirror keeps the core only, so they are optional.
 */
const serviceOrderDetailSchema = z.object({
  id: z.number(),
  publicId: z.string(),
  serviceOrderNumber: z.string(),
  organizationName: nullableString.optional(),
  organizationCnpj: nullableString.optional(),
  organizationPhone: nullableString.optional(),
  organizationEmail: nullableString.optional(),
  organizationStreet: nullableString.optional(),
  organizationNumber: nullableString.optional(),
  organizationNeighbourhood: nullableString.optional(),
  organizationCity: nullableString.optional(),
  organizationState: nullableString.optional(),
  organizationCep: nullableString.optional(),
  status: serviceOrderStatusSchema,
  statusLabel: z.string(),
  priority: serviceOrderPrioritySchema,
  customerId: z.number(),
  customerName: z.string(),
  customerTaxId: nullableString.optional(),
  customerEmail: nullableString.optional(),
  customerPhone: nullableString.optional(),
  assetId: z.number(),
  assetName: z.string(),
  assetTag: nullableString.optional(),
  assetSerialNumber: nullableString,
  assetMetrologyRegime: MetrologyRegimeSchema.nullable().optional(),
  unitName: nullableString.optional(),
  responsibleTechnicianId: nullableString,
  claimedDefect: z.string(),
  intakeCondition: z.string(),
  accessories: nullableString,
  intakeType: z.string(),
  invoiceRemittanceNumber: nullableString.optional(),
  invoiceRemittanceKey: nullableString.optional(),
  carrierName: nullableString.optional(),
  thirdPartyName: nullableString.optional(),
  removedSealingMarkNumber: nullableString.optional(),
  affixedSealingMarkNumber: nullableString.optional(),
  inmetroRepairMarkNumber: nullableString.optional(),
  inmetroRepairMarkIssuedAt: nullableString.optional(),
  inmetroRepairMarkAppliedAt: nullableString.optional(),
  inmetroRepairMarkNotes: nullableString.optional(),
  deliveredAt: nullableString.optional(),
  deliveredToName: nullableString.optional(),
  deliveredToDocument: nullableString.optional(),
  deliveryMethod: z.enum(SERVICE_ORDER_DELIVERY_METHODS),
  deliveryNotes: nullableString.optional(),
  clientVisibleNotes: nullableString,
  internalNotes: nullableString,
  isExternalService: z.boolean().optional(),
  openedAt: z.string(),
  serviceStartedAt: nullableString.optional(),
  updatedAt: z.string(),
  assetSnapshot: serviceOrderAssetSnapshotSchema.nullable(),
  evaluations: z.array(serviceOrderEvaluationSchema),
  quotes: z.array(serviceOrderQuoteSchema),
  execution: serviceOrderExecutionSchema.nullable(),
  deliveryDocuments: z.array(
    z.object({
      id: z.number(),
      documentNumber: z.string(),
      version: z.number(),
      pdfR2Key: nullableString.optional(),
      issuedAt: nullableString.optional(),
    }),
  ),
  events: z.array(
    z.object({
      id: z.number(),
      eventType: z.string(),
      actorType: nullableString.optional(),
      actorName: nullableString.optional(),
      createdAt: z.string(),
    }),
  ),
});

/** GET /api/service-orders/:id */
export const serviceOrderDetailResponseSchema = z.object({
  data: serviceOrderDetailSchema,
});
export type ServiceOrderDetailResponse = z.infer<
  typeof serviceOrderDetailResponseSchema
>;
export type ServiceOrderDetail = ServiceOrderDetailResponse["data"];

export const SERVICE_ORDER_COMMUNICATION_STATUSES = [
  "sent",
  "queued",
  "retrying",
  "failed",
  "skipped",
] as const;
export type ServiceOrderCommunicationStatus =
  (typeof SERVICE_ORDER_COMMUNICATION_STATUSES)[number];

/** GET /api/service-orders/:id/communications: the customer-communication log of the order. */
const serviceOrderCommunicationsResponseSchema = z.object({
  data: z.array(
    z.object({
      eventKey: z.string(),
      channel: z.literal("email"),
      status: z.enum(SERVICE_ORDER_COMMUNICATION_STATUSES),
      recipientEmail: nullableString,
      recipientSuppressed: z.boolean(),
      sentAt: nullableString,
      queuedAt: nullableString,
      attempts: z.number(),
      lastError: nullableString,
    }),
  ),
});
export type ServiceOrderCommunicationsData = z.infer<
  typeof serviceOrderCommunicationsResponseSchema
>;

/**
 * What the lab's write commands answer: the stored row (or document) under
 * `data`. The command helpers type that row as possibly absent (an insert's
 * `.returning()`), so the schema does too.
 */
const serviceOrderRecordResponseSchema = z.object({
  data: jsonRecordSchema.nullish(),
});

/** The presigned URL of a generated PDF. */
const serviceOrderDocumentUrlSchema = z.object({ url: z.string() });
export type ServiceOrderDocumentUrl = z.infer<
  typeof serviceOrderDocumentUrlSchema
>;

/** Path parameters: the order's numeric id, the opaque public id the dashboard routes with, a quote or an evaluation of the order. */
const orderParams = z.object({ id: routeId });
const publicIdParams = z.object({ publicId: z.string().trim().min(1) });
const quoteParams = z.object({ id: routeId, quoteId: routeId });
const evaluationParams = z.object({ id: routeId, evaluationId: routeId });

export const serviceOrderEndpoints = {
  list: endpoint({
    method: "get",
    path: "/api/service-orders",
    query: ListServiceOrdersQuerySchema,
    response: serviceOrdersListResponseSchema,
    failure: "Erro ao carregar ordens de serviço",
    policy: "local-first-read-through-sync",
    permission: { service_order: ["read"] },
  }),
  // The opaque id is the dashboard's route key. The desktop does not call this
  // path (the local server routes on the local id): see `desktop-client.ts`.
  getByPublicId: endpoint({
    method: "get",
    path: "/api/service-orders/by-public-id/:publicId",
    params: publicIdParams,
    response: serviceOrderDetailResponseSchema,
    failure: "Erro ao carregar OS",
    // Same policy as `get`: it is the same read, keyed by the opaque id.
    policy: "local-first-read-through-sync",
    permission: { service_order: ["read"] },
  }),
  get: endpoint({
    method: "get",
    path: "/api/service-orders/:id",
    params: orderParams,
    response: serviceOrderDetailResponseSchema,
    failure: "Erro ao carregar OS",
    policy: "local-first-read-through-sync",
    permission: { service_order: ["read"] },
  }),
  listCommunications: endpoint({
    method: "get",
    path: "/api/service-orders/:id/communications",
    params: orderParams,
    response: serviceOrderCommunicationsResponseSchema,
    failure: "Erro ao carregar comunicações da OS",
    policy: "cloud-only",
    desktopLabel: "Comunicações da OS",
    permission: { service_order: ["read"] },
  }),
  create: endpoint({
    method: "post",
    path: "/api/service-orders",
    body: CreateServiceOrderSchema,
    response: serviceOrderCreateResponseSchema,
    status: 201,
    failure: "Erro ao criar OS",
    policy: "local-command-sync",
    permission: { service_order: ["create"] },
  }),
  update: endpoint({
    method: "patch",
    path: "/api/service-orders/:id",
    params: orderParams,
    body: UpdateServiceOrderSchema,
    response: serviceOrderRecordResponseSchema,
    failure: "Erro ao atualizar OS",
    policy: "cloud-only",
    desktopLabel: "Atualização da OS",
    permission: { service_order: ["update"] },
  }),
  createQuote: endpoint({
    method: "post",
    path: "/api/service-orders/:id/quotes",
    params: orderParams,
    body: CreateServiceOrderQuoteSchema,
    response: serviceOrderRecordResponseSchema,
    status: 201,
    failure: "Erro ao salvar orçamento",
    policy: "cloud-only",
    desktopLabel: "Orçamento da OS",
    permission: { service_order: ["quote_create"] },
  }),
  createEvaluation: endpoint({
    method: "post",
    path: "/api/service-orders/:id/evaluations",
    params: orderParams,
    body: CreateServiceOrderEvaluationSchema,
    response: serviceOrderRecordResponseSchema,
    failure: "Erro ao salvar avaliação",
    policy: "cloud-only",
    desktopLabel: "Avaliação técnica",
    permission: { service_order: ["evaluate"] },
  }),
  updateEvaluation: endpoint({
    method: "patch",
    path: "/api/service-orders/:id/evaluations/:evaluationId",
    params: evaluationParams,
    body: UpdateServiceOrderEvaluationSchema,
    response: serviceOrderRecordResponseSchema,
    failure: "Erro ao salvar avaliação",
    policy: "cloud-only",
    desktopLabel: "Avaliação técnica",
    permission: { service_order: ["evaluate"] },
  }),
  sendQuote: endpoint({
    method: "post",
    path: "/api/service-orders/:id/quotes/:quoteId/send",
    params: quoteParams,
    body: SendServiceOrderQuoteSchema,
    response: z.object({
      data: jsonRecordSchema.nullish(),
      publicUrl: z.string(),
    }),
    failure: "Erro ao emitir orçamento",
    policy: "cloud-only",
    desktopLabel: "Emissão de orçamento",
    permission: { service_order: ["quote_send"] },
  }),
  startExecution: endpoint({
    method: "post",
    path: "/api/service-orders/:id/execution/start",
    params: orderParams,
    body: StartServiceOrderExecutionSchema,
    response: serviceOrderRecordResponseSchema,
    failure: "Erro ao iniciar execução",
    policy: "cloud-only",
    desktopLabel: "Execução da OS",
    permission: { service_order: ["execute"] },
  }),
  saveExecution: endpoint({
    method: "post",
    path: "/api/service-orders/:id/execution/finish",
    params: orderParams,
    body: FinishServiceOrderExecutionSchema,
    response: z.object({ ok: z.literal(true) }),
    failure: "Erro ao salvar execução",
    policy: "cloud-only",
    desktopLabel: "Execução da OS",
    permission: { service_order: ["execute"] },
  }),
  generateIntakeDocument: endpoint({
    method: "post",
    path: "/api/service-orders/:id/intake-document",
    params: orderParams,
    response: serviceOrderRecordResponseSchema,
    failure: "Erro ao gerar comprovante",
    policy: "cloud-only",
    desktopLabel: "Geração de comprovante",
    permission: { service_order: ["print_intake_document"] },
  }),
  getIntakeDocumentPdf: endpoint({
    method: "get",
    path: "/api/service-orders/:id/intake-document.pdf",
    params: orderParams,
    response: serviceOrderDocumentUrlSchema,
    failure: "PDF ainda indisponível",
    policy: "cloud-only",
    desktopLabel: "Abertura de comprovante",
    permission: { service_order: ["read"] },
  }),
  generateTag: endpoint({
    method: "post",
    path: "/api/service-orders/:id/tag",
    params: orderParams,
    response: serviceOrderRecordResponseSchema,
    failure: "Erro ao gerar etiqueta",
    policy: "cloud-only",
    desktopLabel: "Geração de etiqueta",
    permission: { service_order: ["print_tag"] },
  }),
  getTagPdf: endpoint({
    method: "get",
    path: "/api/service-orders/:id/tag.pdf",
    params: orderParams,
    response: serviceOrderDocumentUrlSchema,
    failure: "PDF ainda indisponível",
    policy: "cloud-only",
    desktopLabel: "Abertura de etiqueta",
    permission: { service_order: ["read"] },
  }),
  updateRepairMark: endpoint({
    method: "patch",
    path: "/api/service-orders/:id/repair-mark",
    params: orderParams,
    body: UpdateServiceOrderRepairMarkSchema,
    response: serviceOrderRecordResponseSchema,
    failure: "Erro ao salvar a Marca de Reparo",
    policy: "cloud-only",
    desktopLabel: "Marca de Reparo",
    permission: { service_order: ["deliver"] },
  }),
  deliver: endpoint({
    method: "post",
    path: "/api/service-orders/:id/deliver",
    params: orderParams,
    body: DeliverServiceOrderSchema,
    response: serviceOrderRecordResponseSchema,
    failure: "Erro ao registrar entrega",
    policy: "cloud-only",
    desktopLabel: "Registro de entrega",
    permission: { service_order: ["deliver"] },
  }),
  issueDeliveryDocument: endpoint({
    method: "post",
    path: "/api/service-orders/:id/delivery-document",
    params: orderParams,
    body: IssueServiceOrderDeliveryDocumentSchema,
    response: serviceOrderRecordResponseSchema,
    failure: "Erro ao gerar comprovante de entrega",
    policy: "cloud-only",
    desktopLabel: "Documento de entrega",
    permission: { service_order: ["deliver"] },
  }),
  getDeliveryDocumentPdf: endpoint({
    method: "get",
    path: "/api/service-orders/:id/delivery-document.pdf",
    params: orderParams,
    response: serviceOrderDocumentUrlSchema,
    failure: "PDF ainda indisponível",
    policy: "cloud-only",
    desktopLabel: "Abertura do comprovante de entrega",
    permission: { service_order: ["read"] },
  }),
} as const satisfies EndpointGroup;
