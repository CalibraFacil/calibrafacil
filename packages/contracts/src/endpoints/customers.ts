import { z } from "zod";
import {
  AuditLogQuerySchema,
  CreateCustomerSchema,
  CreatePortalInvitationSchema,
  ListCustomersQuerySchema,
  UpdateComplianceSchema,
  UpdateCustomerSchema,
  QualificationStatusSchema,
  AssetOotImpactDecisionSchema,
  AddressSchema,
} from "@calibra-facil/schemas";
import { ASSET_OOT_EVENT_STATUSES } from "@calibra-facil/schemas/machines";

import { nullableNumber, nullableString, paginationSchema } from "../common";
import { endpoint, type EndpointGroup } from "./define";

/**
 * The laboratory's customers (the cadastro and its portal users). Response
 * schemas are wire schemas written from what the handlers in
 * `apps/api/src/domains/customers/routes/customers.ts` return; the desktop local-server answers
 * `list` and `get` with the same ones (`apps/local-server/src/contract.test.ts`).
 *
 * Not client-facing, so not defined here: `GET /search` (command palette,
 * server-side only), `GET /:id/label` and `DELETE /:id`.
 */

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

/** The ISO/IEC 17025 7.1 qualification block; the offline mirror keeps only the status. */
const customerComplianceSchema = z.object({
  qualificationStatus: QualificationStatusSchema.optional(),
  qualificationDate: z.string().optional(),
  qualificationExpiresAt: z.string().optional(),
  contractAgreementId: z.number().optional(),
  contractNumber: z.string().optional(),
  contractSignedAt: z.string().optional(),
  contractExpiresAt: z.string().optional(),
  qualityRequirementsAcknowledged: z.boolean().optional(),
  qualityRequirementsAcknowledgedAt: z.string().optional(),
  notes: z.string().optional(),
});

/** One customer row. */
const customerSchema = z.object({
  id: z.number(),
  name: z.string(),
  tradeName: nullableString.optional(),
  taxId: nullableString,
  email: nullableString,
  phone: nullableString,
  address: AddressSchema.nullable(),
  /** The CLIENT organization behind the portal; the offline mirror has none. */
  authOrganizationId: nullableString,
  groupId: nullableNumber.optional(),
  groupName: nullableString.optional(),
  compliance: customerComplianceSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CustomerRecord = z.infer<typeof customerSchema>;

/** GET /api/customers */
export const customersListResponseSchema = z.object({
  data: z.array(customerSchema),
  pagination: paginationSchema,
});
export type CustomersListResponse = z.infer<typeof customersListResponseSchema>;

const activeCommercialAgreementSchema = z.object({
  id: z.number(),
  agreementCode: nullableString,
  title: z.string(),
  effectiveFrom: z.string(),
  effectiveTo: nullableString,
  currency: z.string(),
  defaultPaymentTermDays: z.number(),
});

/** GET /api/customers/:id: the row plus its financial standing, agreement and group. */
export const customerDetailSchema = customerSchema.extend({
  financialSummary: z.object({
    openDocumentsCount: z.number(),
    overdueDocumentsCount: z.number(),
    openBalanceCents: z.number(),
    overdueBalanceCents: z.number(),
    overdueBalanceFlag: z.boolean(),
  }),
  /** The agreement in force today; the offline mirror does not keep agreements. */
  activeCommercialAgreement: activeCommercialAgreementSchema
    .nullable()
    .optional(),
  group: z.object({ id: z.number(), name: z.string() }).nullable().optional(),
});
export type CustomerDetail = z.infer<typeof customerDetailSchema>;

/** POST /api/customers (201): the stored row and the portal invitation sent to its e-mail, if any. */
const customerCreatedSchema = customerSchema.extend({
  invitationId: nullableString,
});

/** A user of the customer's portal (a member of its CLIENT organization). */
export const portalMemberSchema = z.object({
  id: z.string(),
  userId: z.string(),
  role: z.string(),
  createdAt: z.string(),
  userName: z.string(),
  userEmail: z.string(),
  userImage: nullableString,
});
export type CustomerPortalMember = z.infer<typeof portalMemberSchema>;

export const portalInvitationSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: nullableString,
  status: z.string(),
  expiresAt: z.string(),
  createdAt: z.string(),
  inviterName: z.string(),
  inviterEmail: z.string(),
});
export type CustomerPortalInvitation = z.infer<typeof portalInvitationSchema>;

const customerAuditEntrySchema = z.object({
  id: z.number(),
  action: z.string(),
  changes: z.unknown(),
  performedAt: z.string(),
  reason: nullableString,
  performedByName: z.string(),
  performedByEmail: z.string(),
});
export type CustomerAuditLogEntry = z.infer<typeof customerAuditEntrySchema>;

const customerOotEventSchema = z.object({
  id: z.number(),
  status: z.enum(ASSET_OOT_EVENT_STATUSES),
  detectedAt: z.string(),
  assetId: z.number(),
  assetTag: z.string(),
  assetName: z.string(),
  jobId: z.number(),
  jobIdentifier: z.string(),
  assessmentDecision: AssetOotImpactDecisionSchema.nullable(),
  assessmentCreatedAt: nullableString,
});
export type CustomerOotEvent = z.infer<typeof customerOotEventSchema>;

/** Receita Federal registry data resolved from a CNPJ, used to pre-fill the cadastro. */
const cnpjLookupResultSchema = z.object({
  taxId: z.string(),
  name: z.string(),
  tradeName: nullableString,
  email: nullableString,
  phone: nullableString,
  status: nullableString,
  address: z.object({
    cep: nullableString,
    street: nullableString,
    number: nullableString,
    complement: nullableString,
    neighbourhood: nullableString,
    city: nullableString,
    state: nullableString,
  }),
});
export type CnpjLookupResult = z.infer<typeof cnpjLookupResultSchema>;

const successSchema = z.object({ success: z.literal(true) });

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

const DESKTOP_LABEL = "Clientes";

export const customerEndpoints = {
  list: endpoint({
    method: "get",
    path: "/api/customers",
    query: ListCustomersQuerySchema,
    response: customersListResponseSchema,
    failure: "Falha ao carregar clientes",
    policy: "local-first-read-through-sync",
  }),
  // Reaches the external Receita Federal mirrors, which the offline local
  // server cannot proxy: the cadastro still works with manual entry.
  lookupCnpj: endpoint({
    method: "get",
    path: "/api/customers/cnpj-lookup/:cnpj",
    response: cnpjLookupResultSchema,
    failure: "Falha ao consultar o CNPJ",
    policy: "cloud-only",
    desktopLabel: "Consulta de CNPJ",
  }),
  ootEvents: endpoint({
    method: "get",
    path: "/api/customers/:id/oot-events",
    response: z.object({ data: z.array(customerOotEventSchema) }),
    failure: "Falha ao carregar eventos fora de tolerância",
    policy: "cloud-only",
    desktopLabel: "Eventos fora de tolerância",
  }),
  create: endpoint({
    method: "post",
    path: "/api/customers",
    body: CreateCustomerSchema,
    response: customerCreatedSchema,
    status: 201,
    failure: "Erro ao criar cliente",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  get: endpoint({
    method: "get",
    path: "/api/customers/:id",
    response: customerDetailSchema,
    failure: "Falha ao carregar cliente",
    policy: "local-first-read-through-sync",
  }),
  update: endpoint({
    method: "put",
    path: "/api/customers/:id",
    body: UpdateCustomerSchema,
    response: customerSchema,
    failure: "Falha ao atualizar cliente",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  auditLog: endpoint({
    method: "get",
    path: "/api/customers/:id/audit-log",
    query: AuditLogQuerySchema,
    response: z.object({
      data: z.array(customerAuditEntrySchema),
      pagination: paginationSchema,
    }),
    failure: "Falha ao carregar historico",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  updateCompliance: endpoint({
    method: "put",
    path: "/api/customers/:id/compliance",
    body: UpdateComplianceSchema,
    response: customerSchema,
    failure: "Falha ao atualizar conformidade",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  listMembers: endpoint({
    method: "get",
    path: "/api/customers/:id/members",
    response: z.array(portalMemberSchema),
    failure: "Falha ao carregar usuarios",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  listInvitations: endpoint({
    method: "get",
    path: "/api/customers/:id/invitations",
    response: z.array(portalInvitationSchema),
    failure: "Falha ao carregar convites",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  createInvitation: endpoint({
    method: "post",
    path: "/api/customers/:id/invitations",
    body: CreatePortalInvitationSchema,
    response: z.object({
      id: z.string(),
      email: z.string(),
      role: z.string(),
    }),
    status: 201,
    failure: "Falha ao enviar convite",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  resendInvitation: endpoint({
    method: "post",
    path: "/api/customers/:id/invitations/:invId/resend",
    response: z.object({ id: z.string().optional(), email: z.string() }),
    failure: "Falha ao reenviar convite",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  cancelInvitation: endpoint({
    method: "delete",
    path: "/api/customers/:id/invitations/:invId",
    response: successSchema,
    failure: "Falha ao cancelar convite",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  removeMember: endpoint({
    method: "delete",
    path: "/api/customers/:id/members/:memberId",
    response: successSchema,
    failure: "Falha ao remover usuário",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
} as const satisfies EndpointGroup;
