import { createRouter } from "../../../server/router";
import { customerEndpoints } from "@calibra-facil/contracts";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  customer,
  customerGroup,
  member,
  invitation,
  user,
  customerAuditLog,
  asset,
  assetOotEvent,
  assetOotImpactAssessment,
  calibrationJob,
} from "@calibra-facil/db/schema";
import {
  PORTAL_MANAGEABLE_MEMBER_ROLES,
  PORTAL_VISIBLE_MEMBER_ROLES,
  isPortalManageableMemberRole,
} from "@calibra-facil/auth/access";
import { eq, ilike, or, count, and, desc, inArray, sql } from "drizzle-orm";
import {
  withLabPermission,
  type AuthVariables,
} from "../../../middleware/permission";
import { requireLabCustomer, requireLabCustomerId } from "../customer-access";
import {
  conflict,
  DomainError,
  forbidden,
  invalid,
  notFound,
  unprocessable,
} from "../../../lib/domain-errors";
import {
  createLabCustomer,
  deleteLabCustomer,
  groupBelongsToLab,
  provisionCustomerOrganization,
  updateLabCustomer,
} from "../customer-writes";
import { mount } from "../../../lib/endpoint-mount";
import { withOrg } from "../../../lib/org-context";
import { requestActor } from "../../../middleware/request-actor";
import { isReferencedRowViolation } from "../../../lib/db-errors";
import { fetchCnpjRegistration } from "../cnpj-lookup";
import {
  loadCustomerActiveCommercialAgreement,
  syncComplianceWithActiveAgreement,
} from "../../finance";
import {
  cancelPortalInvitationAsService,
  createPortalInvitationAsService,
  enforceClientPortalMembershipBoundary,
  removePortalMemberAsService,
} from "../../portal";
import { orgDb } from "../../../lib/org-db";
import { toRecord } from "@calibra-facil/shared/record";

const CommandPaletteCustomerSearchQuerySchema = z.object({
  query: z.string().trim().min(2),
  limit: z.coerce.number().min(1).max(10).default(5),
});

function getStringProperty(value: unknown, key: string) {
  const property = toRecord(value)[key];
  return typeof property === "string" ? property : undefined;
}

/**
 * Accent-insensitive customer search. Name + trade name match through the
 * `immutable_unaccent` wrapper (so "construcao" finds "construção"), accelerated by the
 * pg_trgm GIN indexes from migration 0071. Tax id and email stay plain ilike (ASCII, no
 * accents to fold). The matched value is normalized only for comparison — never stored.
 */
function customerSearchCondition(query: string) {
  const pattern = `%${query}%`;
  return or(
    sql`lower(immutable_unaccent(${customer.name})) like lower(immutable_unaccent(${pattern}))`,
    sql`lower(immutable_unaccent(${customer.tradeName})) like lower(immutable_unaccent(${pattern}))`,
    ilike(customer.taxId, pattern),
    ilike(customer.email, pattern),
  );
}

const PREFIX = "/api/customers";

export const customersRouter = createRouter<{ Variables: AuthVariables }>();

// Route order matters: the static `/search`, `/cnpj-lookup/:cnpj` and
// `/:id/...` segments are registered before the bare `/:id` routes.

// POST / - Create a new customer
mount(
  customersRouter,
  PREFIX,
  customerEndpoints.create,
  withLabPermission({ client: ["create"] }),
  async (c, { body: input }) => {
    const memberData = c.get("member");

    // Fail fast on an invalid group before provisioning the CLIENT org.
    const { groupId } = input;
    if (
      groupId != null &&
      !(await orgDb(memberData.organizationId).transaction((o) =>
        groupBelongsToLab(groupId, memberData.organizationId, o),
      ))
    ) {
      throw invalid("invalid_request", "Grupo invalido");
    }

    // Step 1: Create CLIENT organization via service account (3B model)
    const orgResult = await provisionCustomerOrganization(input.name);

    if (!orgResult?.id) {
      throw new DomainError({
        code: "customer_create_failed",
        status: 500,
        message: "Falha ao criar organizacao do cliente",
      });
    }

    // Step 2: Insert customer record
    // - authOrganizationId: The CLIENT org (for portal access)
    // - labOrganizationId: The LAB org that manages this customer (current user's org)
    const newCustomer = await withOrg(
      memberData.organizationId,
      requestActor(c),
      (ctx) => createLabCustomer(ctx, input, orgResult.id),
    );

    // Step 3: If email provided, create invitation for client portal access.
    let invitationId: string | null = null;
    if (input.email && input.email.trim() !== "") {
      try {
        const inviteResult = await createPortalInvitationAsService({
          email: input.email,
          role: PORTAL_MANAGEABLE_MEMBER_ROLES[0],
          organizationId: orgResult.id,
        });
        invitationId = inviteResult?.id ?? null;
      } catch (inviteError) {
        // Log but don't fail - customer was created successfully
        console.error("Failed to send invitation:", inviteError);
      }
    }

    return { ...newCustomer, invitationId };
  },
);

// GET /search - Lightweight search for the command palette. Server-side only:
// no SDK method, so no endpoint definition.
customersRouter.get(
  "/search",
  ...withLabPermission({ client: ["read"] }),
  zValidator("query", CommandPaletteCustomerSearchQuerySchema),
  async (c) => {
    const memberData = c.get("member");
    const { query, limit } = c.req.valid("query");

    const results = await orgDb(memberData.organizationId).transaction((o) =>
      o
        .select({
          id: customer.id,
          name: customer.name,
          email: customer.email,
          taxId: customer.taxId,
        })
        .from(customer)
        .where(
          and(
            eq(customer.labOrganizationId, memberData.organizationId),
            customerSearchCondition(query)!,
          ),
        )
        .orderBy(customer.name)
        .limit(limit),
    );

    return c.json(results);
  },
);

// GET /cnpj-lookup/:cnpj - Resolve a CNPJ against the Receita Federal mirrors
// to pre-fill the cadastro. Read-only enrichment; never persists on its own.
// The static "cnpj-lookup" segment is registered before the /:id routes and
// cannot collide with them (their third segment is always static).
mount(
  customersRouter,
  PREFIX,
  customerEndpoints.lookupCnpj,
  withLabPermission({ client: ["read"] }),
  async (c, { params }) => {
    const outcome = await fetchCnpjRegistration(params.cnpj);
    switch (outcome.status) {
      case "ok":
        return outcome.result;
      case "invalid":
        throw unprocessable("cnpj_invalid", "CNPJ invalido");
      case "not-found":
        throw notFound(
          "cnpj_not_found",
          "CNPJ nao encontrado na Receita Federal",
        );
      case "error":
        // 502 is not a DomainError status (the registry is a mirror, not us).
        return c.json(
          {
            error: "Nao foi possivel consultar o CNPJ agora. Tente novamente.",
          },
          502,
        );
    }
  },
);

// GET / - List customers with pagination and search
mount(
  customersRouter,
  PREFIX,
  customerEndpoints.list,
  withLabPermission({ client: ["read"] }),
  async (c, { query: { page, limit, query } }) => {
    const memberData = c.get("member");

    const offset = (page - 1) * limit;

    // Build conditions - always filter by LAB organization
    const conditions = [
      eq(customer.labOrganizationId, memberData.organizationId),
    ];

    // Add search condition if query provided
    if (query) {
      const searchCondition = customerSearchCondition(query);
      if (searchCondition) {
        conditions.push(searchCondition);
      }
    }

    return await orgDb(memberData.organizationId).transaction(async (o) => {
      // Get customers with pagination (filtered by organization)
      const customers = await o
        .select()
        .from(customer)
        .where(and(...conditions))
        .orderBy(customer.name)
        .limit(limit)
        .offset(offset);

      // Get total count for pagination (filtered by organization)
      const countResult = await o
        .select({ total: count() })
        .from(customer)
        .where(and(...conditions));

      const total = countResult[0]?.total ?? 0;

      // Resolve group names for the rows on this page (batched single query).
      const pageGroupIds = [
        ...new Set(
          customers
            .map((row) => row.groupId)
            .filter((groupId): groupId is number => groupId !== null),
        ),
      ];
      const groupNameById = new Map<number, string>();
      if (pageGroupIds.length > 0) {
        const groups = await o
          .select({ id: customerGroup.id, name: customerGroup.name })
          .from(customerGroup)
          .where(
            and(
              eq(customerGroup.labOrganizationId, memberData.organizationId),
              inArray(customerGroup.id, pageGroupIds),
            ),
          );
        for (const group of groups) {
          groupNameById.set(group.id, group.name);
        }
      }

      const data = customers.map((row) => ({
        ...row,
        groupName:
          row.groupId === null
            ? null
            : (groupNameById.get(row.groupId) ?? null),
      }));

      return {
        data,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    });
  },
);

// GET /:id/label - Get customer label by ID. Server-side only (no SDK method).
customersRouter.get(
  "/:id/label",
  ...withLabPermission({ client: ["read"] }),
  async (c) => {
    const memberData = c.get("member");
    const id = await requireLabCustomerId(
      c.req.param("id"),
      memberData.organizationId,
    );

    return await orgDb(memberData.organizationId).transaction(async (o) => {
      const [foundCustomer] = await o
        .select({
          id: customer.id,
          label: customer.name,
        })
        .from(customer)
        .where(
          and(
            eq(customer.id, id),
            eq(customer.labOrganizationId, memberData.organizationId),
          ),
        )
        .limit(1);

      if (!foundCustomer) {
        throw notFound("customer_not_found", "Cliente nao encontrado");
      }

      return c.json(foundCustomer);
    });
  },
);

// GET /:id/oot-events - customer's asset OOT events + assessment status
// #740 Track B lab visibility: read-only view of whether the customer has
// closed their ISO 9001 §7.1.5.2 impact-assessment loop per OOT event.
mount(
  customersRouter,
  PREFIX,
  customerEndpoints.ootEvents,
  withLabPermission({ client: ["read"] }),
  async (c, { params }) => {
    const memberData = c.get("member");
    const id = await requireLabCustomerId(params.id, memberData.organizationId);

    return await orgDb(memberData.organizationId).transaction(async (o) => {
      const [foundCustomer] = await o
        .select({ id: customer.id })
        .from(customer)
        .where(
          and(
            eq(customer.id, id),
            eq(customer.labOrganizationId, memberData.organizationId),
          ),
        )
        .limit(1);
      if (!foundCustomer) {
        throw notFound("customer_not_found", "Cliente nao encontrado");
      }

      const events = await o
        .select({
          id: assetOotEvent.id,
          status: assetOotEvent.status,
          detectedAt: assetOotEvent.detectedAt,
          assetId: assetOotEvent.assetId,
          assetTag: asset.tag,
          assetName: asset.name,
          jobId: assetOotEvent.jobId,
          jobIdentifier: calibrationJob.jobId,
          assessmentDecision: assetOotImpactAssessment.decision,
          assessmentCreatedAt: assetOotImpactAssessment.createdAt,
        })
        .from(assetOotEvent)
        .innerJoin(asset, eq(assetOotEvent.assetId, asset.id))
        .innerJoin(calibrationJob, eq(assetOotEvent.jobId, calibrationJob.id))
        .leftJoin(
          assetOotImpactAssessment,
          eq(assetOotImpactAssessment.eventId, assetOotEvent.id),
        )
        .where(
          and(
            eq(assetOotEvent.customerId, id),
            eq(assetOotEvent.labOrganizationId, memberData.organizationId),
          ),
        )
        .orderBy(desc(assetOotEvent.detectedAt));

      return { data: events };
    });
  },
);

// GET /:id - Get customer by ID
mount(
  customersRouter,
  PREFIX,
  customerEndpoints.get,
  withLabPermission({ client: ["read"] }),
  async (c, { params }) =>
    requireLabCustomer(params.id, c.get("member").organizationId),
);

// PUT /:id - Update customer
mount(
  customersRouter,
  PREFIX,
  customerEndpoints.update,
  withLabPermission({ client: ["update"] }),
  async (c, { params, body: input }) => {
    const memberData = c.get("member");
    const existingCustomer = await requireLabCustomer(
      params.id,
      memberData.organizationId,
    );

    const updatedCustomer = await withOrg(
      memberData.organizationId,
      requestActor(c),
      (ctx) => updateLabCustomer(ctx, existingCustomer, input),
    );
    if (!updatedCustomer) {
      throw notFound("customer_not_found", "Cliente nao encontrado");
    }

    return updatedCustomer;
  },
);

// DELETE /:id - Delete customer. Server-side only (no SDK method).
customersRouter.delete(
  "/:id",
  ...withLabPermission({ client: ["delete"] }),
  async (c) => {
    const memberData = c.get("member");
    const existingCustomer = await requireLabCustomer(
      c.req.param("id"),
      memberData.organizationId,
    );

    // TODO: Check for active calibrations before deleting
    // For now, we allow deletion

    // Retention (decision Q16): a customer that still has regulated records
    // (jobs, certificates, service orders, billing documents, requests,
    // visits, OOT events) cannot be deleted. Those foreign keys are RESTRICT, so
    // Postgres refuses the DELETE; the audit rows below are written in the same
    // transaction so a refused delete leaves no "delete" entry behind.
    try {
      await withOrg(memberData.organizationId, requestActor(c), (ctx) =>
        deleteLabCustomer(ctx, existingCustomer),
      );
    } catch (error) {
      if (isReferencedRowViolation(error)) {
        throw conflict(
          "customer_has_retained_records",
          "Cliente possui registros regulados retidos (calibrações, ordens de serviço, documentos financeiros) e não pode ser excluído",
        );
      }
      throw error;
    }

    return c.json({ success: true });
  },
);

// GET /:id/members - List portal users for customer
mount(
  customersRouter,
  PREFIX,
  customerEndpoints.listMembers,
  withLabPermission({ client: ["manage_portal"] }),
  async (c, { params }) => {
    const memberData = c.get("member");
    // Get customer to find authOrganizationId
    const foundCustomer = await requireLabCustomer(
      params.id,
      memberData.organizationId,
    );

    // Get members of the CLIENT organization with user details
    // `member` rows of the CLIENT organization carry that organization as
    // their tenant column: it is the one the transaction names (the lab
    // already proved the customer is its own above).
    return orgDb(foundCustomer.authOrganizationId).transaction((o) =>
      o
        .select({
          id: member.id,
          userId: member.userId,
          role: member.role,
          createdAt: member.createdAt,
          userName: user.name,
          userEmail: user.email,
          userImage: user.image,
        })
        .from(member)
        .innerJoin(user, eq(member.userId, user.id))
        .where(
          and(
            eq(member.organizationId, foundCustomer.authOrganizationId),
            inArray(member.role, PORTAL_VISIBLE_MEMBER_ROLES),
          ),
        ),
    );
  },
);

// GET /:id/invitations - List invitations for customer
mount(
  customersRouter,
  PREFIX,
  customerEndpoints.listInvitations,
  withLabPermission({ client: ["manage_portal"] }),
  async (c, { params }) => {
    const memberData = c.get("member");
    // Get customer to find authOrganizationId
    const foundCustomer = await requireLabCustomer(
      params.id,
      memberData.organizationId,
    );

    // Get invitations for the CLIENT organization
    // The CLIENT organization's own invitation rows (see the members read).
    return orgDb(foundCustomer.authOrganizationId).transaction((o) =>
      o
        .select({
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          status: invitation.status,
          expiresAt: invitation.expiresAt,
          createdAt: invitation.createdAt,
          inviterName: user.name,
          inviterEmail: user.email,
        })
        .from(invitation)
        .innerJoin(user, eq(invitation.inviterId, user.id))
        .where(eq(invitation.organizationId, foundCustomer.authOrganizationId))
        .orderBy(desc(invitation.createdAt)),
    );
  },
);

// POST /:id/invitations - Create invitation for portal user
mount(
  customersRouter,
  PREFIX,
  customerEndpoints.createInvitation,
  withLabPermission({ client: ["manage_portal"] }),
  async (c, { params, body: { email, role } }) => {
    const memberData = c.get("member");
    const portalRole = role || PORTAL_MANAGEABLE_MEMBER_ROLES[0];
    // Get customer to find authOrganizationId
    const foundCustomer = await requireLabCustomer(
      params.id,
      memberData.organizationId,
    );

    await enforceClientPortalMembershipBoundary(
      foundCustomer.authOrganizationId,
    );

    const inviteResult = await createPortalInvitationAsService({
      email,
      role: portalRole,
      organizationId: foundCustomer.authOrganizationId,
    });

    if (!inviteResult?.id) {
      throw new DomainError({
        code: "portal_invitation_failed",
        status: 500,
        message: "Falha ao criar convite",
      });
    }

    // Log audit entry
    await withOrg(memberData.organizationId, requestActor(c), (ctx) =>
      ctx.audit("customer", foundCustomer.id, {
        action: "user_invited",
        changes: {
          email,
          role: portalRole,
          invitationId: inviteResult.id,
        },
      }),
    );

    return { id: inviteResult.id, email, role: portalRole };
  },
);

// POST /:id/invitations/:invId/resend - Resend invitation
mount(
  customersRouter,
  PREFIX,
  customerEndpoints.resendInvitation,
  withLabPermission({ client: ["manage_portal"] }),
  async (c, { params: { id, invId } }) => {
    const memberData = c.get("member");
    // Get customer to verify ownership
    const foundCustomer = await requireLabCustomer(
      id,
      memberData.organizationId,
    );

    // Get invitation to verify it belongs to this customer
    const [foundInvitation] = await orgDb(
      foundCustomer.authOrganizationId,
    ).transaction((o) =>
      o
        .select()
        .from(invitation)
        .where(
          and(
            eq(invitation.id, invId),
            eq(invitation.organizationId, foundCustomer.authOrganizationId),
          ),
        )
        .limit(1),
    );

    if (!foundInvitation) {
      throw notFound("portal_invitation_not_found", "Convite nao encontrado");
    }

    if (foundInvitation.status !== "pending") {
      throw invalid(
        "portal_invitation_not_pending",
        "Apenas convites pendentes podem ser reenviados",
      );
    }

    await enforceClientPortalMembershipBoundary(
      foundCustomer.authOrganizationId,
    );

    await cancelPortalInvitationAsService({
      invitationId: invId,
      organizationId: foundCustomer.authOrganizationId,
    });

    const newInvite = await createPortalInvitationAsService({
      email: foundInvitation.email,
      role: foundInvitation.role || PORTAL_MANAGEABLE_MEMBER_ROLES[0],
      organizationId: foundCustomer.authOrganizationId,
    });

    return {
      id: getStringProperty(newInvite, "id"),
      email: foundInvitation.email,
    };
  },
);

// DELETE /:id/invitations/:invId - Cancel invitation
mount(
  customersRouter,
  PREFIX,
  customerEndpoints.cancelInvitation,
  withLabPermission({ client: ["manage_portal"] }),
  async (c, { params: { id, invId } }) => {
    const memberData = c.get("member");
    // Get customer to verify ownership
    const foundCustomer = await requireLabCustomer(
      id,
      memberData.organizationId,
    );

    // Get invitation to verify it belongs to this customer
    const [foundInvitation] = await orgDb(
      foundCustomer.authOrganizationId,
    ).transaction((o) =>
      o
        .select()
        .from(invitation)
        .where(
          and(
            eq(invitation.id, invId),
            eq(invitation.organizationId, foundCustomer.authOrganizationId),
          ),
        )
        .limit(1),
    );

    if (!foundInvitation) {
      throw notFound("portal_invitation_not_found", "Convite nao encontrado");
    }

    if (foundInvitation.status !== "pending") {
      throw invalid(
        "portal_invitation_not_pending",
        "Apenas convites pendentes podem ser cancelados",
      );
    }

    await enforceClientPortalMembershipBoundary(
      foundCustomer.authOrganizationId,
    );

    await cancelPortalInvitationAsService({
      invitationId: invId,
      organizationId: foundCustomer.authOrganizationId,
    });

    // Log audit entry
    await withOrg(memberData.organizationId, requestActor(c), (ctx) =>
      ctx.audit("customer", foundCustomer.id, {
        action: "invitation_canceled",
        changes: { email: foundInvitation.email, invitationId: invId },
      }),
    );

    return { success: true as const };
  },
);

// DELETE /:id/members/:memberId - Remove member from portal
mount(
  customersRouter,
  PREFIX,
  customerEndpoints.removeMember,
  withLabPermission({ client: ["manage_portal"] }),
  async (c, { params: { id, memberId } }) => {
    const memberData = c.get("member");
    // Get customer to verify ownership
    const foundCustomer = await requireLabCustomer(
      id,
      memberData.organizationId,
    );

    // Get member to verify it belongs to this customer's organization
    const [foundMember] = await orgDb(
      foundCustomer.authOrganizationId,
    ).transaction((o) =>
      o
        .select({
          id: member.id,
          userId: member.userId,
          role: member.role,
          userName: user.name,
          userEmail: user.email,
        })
        .from(member)
        .innerJoin(user, eq(member.userId, user.id))
        .where(
          and(
            eq(member.id, memberId),
            eq(member.organizationId, foundCustomer.authOrganizationId),
          ),
        )
        .limit(1),
    );

    if (!foundMember) {
      throw notFound("portal_member_not_found", "Membro nao encontrado");
    }

    if (!isPortalManageableMemberRole(foundMember.role)) {
      throw forbidden(
        "portal_member_not_removable",
        "Apenas usuarios externos do portal podem ser removidos por esta tela",
      );
    }

    await enforceClientPortalMembershipBoundary(
      foundCustomer.authOrganizationId,
    );

    await removePortalMemberAsService({
      memberId,
      organizationId: foundCustomer.authOrganizationId,
    });

    // Log audit entry
    await withOrg(memberData.organizationId, requestActor(c), (ctx) =>
      ctx.audit("customer", foundCustomer.id, {
        action: "user_removed",
        changes: {
          email: foundMember.userEmail,
          name: foundMember.userName,
          memberId,
        },
      }),
    );

    return { success: true as const };
  },
);

// PUT /:id/compliance - Update compliance data
mount(
  customersRouter,
  PREFIX,
  customerEndpoints.updateCompliance,
  withLabPermission({ client: ["update"] }),
  async (c, { params, body: { compliance, reason } }) => {
    const memberData = c.get("member");
    const existingCustomer = await requireLabCustomer(
      params.id,
      memberData.organizationId,
    );
    const id = existingCustomer.id;

    const baseCompliance = existingCustomer.compliance ?? {
      qualificationStatus: "pending" as const,
      qualityRequirementsAcknowledged: false,
    };

    const mergedCompliance = {
      ...baseCompliance,
      ...compliance,
      // Ensure qualificationStatus has a value
      qualificationStatus:
        compliance.qualificationStatus ??
        baseCompliance.qualificationStatus ??
        ("pending" as const),
      qualityRequirementsAcknowledged:
        compliance.qualityRequirementsAcknowledged ??
        baseCompliance.qualityRequirementsAcknowledged ??
        false,
      // Auto-set acknowledgment timestamp if acknowledged
      ...(compliance.qualityRequirementsAcknowledged &&
      !baseCompliance.qualityRequirementsAcknowledged
        ? { qualityRequirementsAcknowledgedAt: new Date().toISOString() }
        : {}),
    };

    const updatedCustomer = await withOrg(
      memberData.organizationId,
      requestActor(c),
      async (ctx) => {
        const activeCommercialAgreement =
          await loadCustomerActiveCommercialAgreement(
            memberData.organizationId,
            id,
            ctx.o,
          );
        const updatedCompliance = syncComplianceWithActiveAgreement(
          mergedCompliance,
          activeCommercialAgreement,
        );

        const [updated] = await ctx.o
          .update(customer)
          .set({ compliance: updatedCompliance, updatedAt: new Date() })
          .where(
            and(
              eq(customer.id, id),
              eq(customer.labOrganizationId, memberData.organizationId),
            ),
          )
          .returning();

        await ctx.audit("customer", id, {
          action: "compliance_change",
          changes: {
            old: existingCustomer.compliance,
            new: updatedCompliance,
          },
          reason,
        });
        return updated;
      },
    );
    if (!updatedCustomer) {
      throw notFound("customer_not_found", "Cliente nao encontrado");
    }

    return updatedCustomer;
  },
);

// GET /:id/audit-log - The customer's audit trail
mount(
  customersRouter,
  PREFIX,
  customerEndpoints.auditLog,
  withLabPermission({ client: ["manage_portal"] }),
  async (c, { params, query: { page, limit } }) => {
    const memberData = c.get("member");
    // Verify customer exists
    const foundCustomer = await requireLabCustomer(
      params.id,
      memberData.organizationId,
    );
    const id = foundCustomer.id;

    const offset = (page - 1) * limit;

    return await orgDb(memberData.organizationId).transaction(async (o) => {
      // Get audit log entries with user details
      const entries = await o
        .select({
          id: customerAuditLog.id,
          action: customerAuditLog.action,
          changes: customerAuditLog.changes,
          performedAt: customerAuditLog.performedAt,
          reason: customerAuditLog.reason,
          performedByName: user.name,
          performedByEmail: user.email,
        })
        .from(customerAuditLog)
        .innerJoin(user, eq(customerAuditLog.performedBy, user.id))
        .where(eq(customerAuditLog.customerId, id))
        .orderBy(desc(customerAuditLog.performedAt))
        .limit(limit)
        .offset(offset);

      // Get total count
      const countResult = await o
        .select({ total: count() })
        .from(customerAuditLog)
        .where(eq(customerAuditLog.customerId, id));

      const total = countResult[0]?.total ?? 0;

      return {
        data: entries,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    });
  },
);
