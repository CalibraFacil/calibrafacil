import { z } from "zod";
import {
  AssignCustomerGroupBranchSchema,
  CreateCustomerGroupSchema,
  CreatePortalInvitationSchema,
} from "@calibra-facil/schemas";

import { nullableString } from "../common";
import { endpoint, type EndpointGroup } from "./define";
import { portalInvitationSchema, portalMemberSchema } from "./customers";

/**
 * Customer groups (redes): a multi-unit client modelled as a group whose
 * branches are customer rows, with its own CLIENT organization (the portal
 * tenant the managers sign in to). Response schemas are wire schemas written
 * from what the handlers in `apps/api/src/domains/customers/routes/customer-groups.ts` return.
 * Cloud-only lab feature: the desktop cannot provision CLIENT organizations.
 */

const customerGroupSchema = z.object({
  id: z.number(),
  name: z.string(),
  authOrganizationId: z.string(),
  createdAt: z.string(),
});

const customerGroupListItemSchema = customerGroupSchema.extend({
  branchCount: z.number(),
});
export type CustomerGroupListItem = z.infer<typeof customerGroupListItemSchema>;

/** GET /api/customer-groups */
const customerGroupsListResponseSchema = z.object({
  data: z.array(customerGroupListItemSchema),
});
export type CustomerGroupsListData = z.infer<
  typeof customerGroupsListResponseSchema
>;

const customerGroupBranchSchema = z.object({
  id: z.number(),
  name: z.string(),
  taxId: nullableString,
  /** Active-instrument counts of the branch (overview KPIs). */
  total: z.number(),
  overdue: z.number(),
  dueSoon: z.number(),
});
export type CustomerGroupBranch = z.infer<typeof customerGroupBranchSchema>;

/** GET /api/customer-groups/:id: the group with its branch customers. */
const customerGroupDetailSchema = customerGroupSchema.extend({
  branches: z.array(customerGroupBranchSchema),
});
export type CustomerGroupDetailData = z.infer<typeof customerGroupDetailSchema>;

const successSchema = z.object({ success: z.literal(true) });

const DESKTOP_LABEL = "Grupos de clientes";

export const customerGroupEndpoints = {
  list: endpoint({
    method: "get",
    path: "/api/customer-groups",
    response: customerGroupsListResponseSchema,
    failure: "Falha ao carregar grupos de clientes",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
    permission: { client: ["read"] },
  }),
  get: endpoint({
    method: "get",
    path: "/api/customer-groups/:id",
    response: customerGroupDetailSchema,
    failure: "Falha ao carregar grupo",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
    permission: { client: ["read"] },
  }),
  // The stored group and the manager invitation sent to its e-mail, if any.
  create: endpoint({
    method: "post",
    path: "/api/customer-groups",
    body: CreateCustomerGroupSchema,
    response: customerGroupSchema.extend({ invitationId: nullableString }),
    status: 201,
    failure: "Erro ao criar grupo",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
    permission: { client: ["create"] },
  }),
  addBranch: endpoint({
    method: "post",
    path: "/api/customer-groups/:id/branches",
    body: AssignCustomerGroupBranchSchema,
    response: successSchema,
    failure: "Erro ao vincular cliente ao grupo",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
    permission: { client: ["update"] },
  }),
  removeBranch: endpoint({
    method: "delete",
    path: "/api/customer-groups/:id/branches/:customerId",
    response: successSchema,
    failure: "Erro ao desvincular cliente do grupo",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
    permission: { client: ["update"] },
  }),
  listMembers: endpoint({
    method: "get",
    path: "/api/customer-groups/:id/members",
    response: z.array(portalMemberSchema),
    failure: "Falha ao carregar gestores",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
    permission: { client: ["manage_portal"] },
  }),
  listInvitations: endpoint({
    method: "get",
    path: "/api/customer-groups/:id/invitations",
    response: z.array(portalInvitationSchema),
    failure: "Falha ao carregar convites",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
    permission: { client: ["manage_portal"] },
  }),
  createInvitation: endpoint({
    method: "post",
    path: "/api/customer-groups/:id/invitations",
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
    permission: { client: ["manage_portal"] },
  }),
  resendInvitation: endpoint({
    method: "post",
    path: "/api/customer-groups/:id/invitations/:invId/resend",
    response: z.object({ id: z.string().optional(), email: z.string() }),
    failure: "Falha ao reenviar convite",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
    permission: { client: ["manage_portal"] },
  }),
  cancelInvitation: endpoint({
    method: "delete",
    path: "/api/customer-groups/:id/invitations/:invId",
    response: successSchema,
    failure: "Falha ao cancelar convite",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
    permission: { client: ["manage_portal"] },
  }),
  removeMember: endpoint({
    method: "delete",
    path: "/api/customer-groups/:id/members/:memberId",
    response: successSchema,
    failure: "Falha ao remover gestor",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
    permission: { client: ["manage_portal"] },
  }),
} as const satisfies EndpointGroup;
