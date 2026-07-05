import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "@calibra-facil/db";
import {
  customer,
  customerGroup,
  organization,
  member,
  invitation,
  user,
  customerAuditLog,
  asset,
  assetAuditLog,
} from "@calibra-facil/db/schema";
import {
  CreateCustomerSchema,
  ListCustomersQuerySchema,
  UpdateCustomerSchema,
  CreatePortalInvitationSchema,
  UpdateComplianceSchema,
  AuditLogQuerySchema,
} from "@calibra-facil/schemas";
import {
  PORTAL_MANAGEABLE_MEMBER_ROLES,
  PORTAL_VISIBLE_MEMBER_ROLES,
  isPortalManageableMemberRole,
} from "@calibra-facil/auth/access";
import { eq, ilike, or, count, and, desc, inArray, sql } from "drizzle-orm";
import {
  withLabPermission,
  type AuthVariables,
} from "../middleware/permission";
import { requireFeature } from "../middleware/tier-guard";
import { getLabCustomerById } from "../lib/customer-access";
import { fetchCnpjRegistration } from "../lib/cnpj-lookup";
import {
  loadCustomerActiveCommercialAgreement,
  syncComplianceWithActiveAgreement,
} from "../lib/finance";
import {
  cancelPortalInvitationAsService,
  createClientOrganizationAsServiceOwner,
  createPortalInvitationAsService,
  enforceClientPortalMembershipBoundary,
  PortalServiceAccountError,
  removePortalMemberAsService,
} from "../lib/portal-service-account";
import { resolveCustomerRouteId } from "../lib/customer-route-id";

const CommandPaletteCustomerSearchQuerySchema = z.object({
  query: z.string().trim().min(2),
  limit: z.coerce.number().min(1).max(10).default(5),
});

/**
 * Generate a URL-friendly slug from a string
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove diacritics
    .replace(/[^a-z0-9]+/g, "-") // Replace non-alphanumeric with hyphens
    .replace(/^-+|-+$/g, "") // Trim hyphens from start/end
    .substring(0, 50); // Limit length
}

/**
 * Generate a unique slug by appending a random suffix if needed
 */
function generateUniqueSlug(name: string): string {
  const baseSlug = slugify(name);
  const randomSuffix = Math.random().toString(36).substring(2, 8);
  return `${baseSlug}-${randomSuffix}`;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(Object.entries(value));
}

function getStringProperty(value: unknown, key: string) {
  const property = toRecord(value)[key];
  return typeof property === "string" ? property : undefined;
}

/** A branch may only join a group owned by the same lab (cross-tenant guard). */
async function groupBelongsToLab(
  groupId: number,
  labOrganizationId: string,
): Promise<boolean> {
  const [group] = await db
    .select({ id: customerGroup.id })
    .from(customerGroup)
    .where(
      and(
        eq(customerGroup.id, groupId),
        eq(customerGroup.labOrganizationId, labOrganizationId),
      ),
    )
    .limit(1);
  return Boolean(group);
}

function portalErrorStatus(
  error: PortalServiceAccountError,
): 400 | 401 | 403 | 404 | 409 | 500 {
  switch (error.status) {
    case 400:
    case 401:
    case 403:
    case 404:
    case 409:
      return error.status;
    default:
      return 500;
  }
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

export const customersRouter = new Hono<{ Variables: AuthVariables }>()
  // =========================================================================
  // POST / - Create a new customer
  // =========================================================================
  .post(
    "/",
    ...withLabPermission({ client: ["create"] }),
    zValidator("json", CreateCustomerSchema),
    async (c) => {
      const input = c.req.valid("json");

      try {
        const memberData = c.get("member");

        // Fail fast on an invalid group before provisioning the CLIENT org.
        if (
          input.groupId != null &&
          !(await groupBelongsToLab(input.groupId, memberData.organizationId))
        ) {
          return c.json({ error: "Grupo invalido" }, 400);
        }

        // Step 1: Create CLIENT organization via service account (3B model)
        const slug = generateUniqueSlug(input.name);

        const orgResult = await createClientOrganizationAsServiceOwner({
          name: input.name,
          slug,
        });

        if (!orgResult?.id) {
          return c.json(
            { error: "Falha ao criar organizacao do cliente" },
            500,
          );
        }

        // Step 2: Insert customer record
        // - authOrganizationId: The CLIENT org (for portal access)
        // - labOrganizationId: The LAB org that manages this customer (current user's org)
        const [newCustomer] = await db
          .insert(customer)
          .values({
            name: input.name,
            tradeName: input.tradeName || null,
            taxId: input.taxId || null,
            email: input.email || null,
            phone: input.phone || null,
            address: input.address || null,
            authOrganizationId: orgResult.id,
            labOrganizationId: memberData.organizationId,
            groupId: input.groupId ?? null,
          })
          .returning();

        // Step 3: If email provided, create invitation for client portal access
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

        return c.json({ ...newCustomer, invitationId }, 201);
      } catch (error) {
        console.error("Error creating customer:", error);
        return c.json({ error: "Erro ao criar cliente" }, 500);
      }
    },
  )

  // =========================================================================
  // GET /search - Lightweight search for command palette
  // =========================================================================
  .get(
    "/search",
    ...withLabPermission({ client: ["read"] }),
    zValidator("query", CommandPaletteCustomerSearchQuerySchema),
    async (c) => {
      const memberData = c.get("member");
      const { query, limit } = c.req.valid("query");

      try {
        const results = await db
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
          .limit(limit);

        return c.json(results);
      } catch (error) {
        console.error("Error searching customers:", error);
        return c.json({ error: "Erro ao buscar clientes" }, 500);
      }
    },
  )

  // =========================================================================
  // GET /cnpj-lookup/:cnpj - Resolve a CNPJ against the Receita Federal mirrors
  // to pre-fill the cadastro. Read-only enrichment; never persists on its own.
  // The static "cnpj-lookup" segment is registered before the /:id routes and
  // cannot collide with them (their third segment is always static).
  // =========================================================================
  .get(
    "/cnpj-lookup/:cnpj",
    ...withLabPermission({ client: ["read"] }),
    async (c) => {
      const outcome = await fetchCnpjRegistration(c.req.param("cnpj"));
      switch (outcome.status) {
        case "ok":
          return c.json(outcome.result);
        case "invalid":
          return c.json({ error: "CNPJ invalido" }, 422);
        case "not-found":
          return c.json(
            { error: "CNPJ nao encontrado na Receita Federal" },
            404,
          );
        case "error":
          return c.json(
            {
              error:
                "Nao foi possivel consultar o CNPJ agora. Tente novamente.",
            },
            502,
          );
      }
    },
  )

  // =========================================================================
  // GET / - List customers with pagination and search
  // =========================================================================
  .get(
    "/",
    ...withLabPermission({ client: ["read"] }),
    zValidator("query", ListCustomersQuerySchema),
    async (c) => {
      const { page, limit, query } = c.req.valid("query");
      const memberData = c.get("member");

      try {
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

        // Get customers with pagination (filtered by organization)
        const customers = await db
          .select()
          .from(customer)
          .where(and(...conditions))
          .orderBy(customer.name)
          .limit(limit)
          .offset(offset);

        // Get total count for pagination (filtered by organization)
        const countResult = await db
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
          const groups = await db
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

        return c.json({
          data,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        });
      } catch (error) {
        console.error("Error listing customers:", error);
        return c.json({ error: "Erro ao listar clientes" }, 500);
      }
    },
  )

  // =========================================================================
  // GET /:id/label - Get customer label by ID
  // =========================================================================
  .get("/:id/label", ...withLabPermission({ client: ["read"] }), async (c) => {
    const memberData = c.get("member");
    const id = await resolveCustomerRouteId(
      c.req.param("id"),
      memberData.organizationId,
    );

    if (id === null) {
      return c.json({ error: "ID invalido" }, 400);
    }

    const [foundCustomer] = await db
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
      return c.json({ error: "Cliente nao encontrado" }, 404);
    }

    return c.json(foundCustomer);
  })

  // =========================================================================
  // GET /:id - Get customer by ID
  // =========================================================================
  .get("/:id", ...withLabPermission({ client: ["read"] }), async (c) => {
    const memberData = c.get("member");
    const id = await resolveCustomerRouteId(
      c.req.param("id"),
      memberData.organizationId,
    );

    if (id === null) {
      return c.json({ error: "ID invalido" }, 400);
    }

    try {
      const foundCustomer = await getLabCustomerById(
        id,
        memberData.organizationId,
      );

      if (!foundCustomer) {
        return c.json({ error: "Cliente nao encontrado" }, 404);
      }

      return c.json(foundCustomer);
    } catch (error) {
      console.error("Error getting customer:", error);
      return c.json({ error: "Erro ao buscar cliente" }, 500);
    }
  })

  // =========================================================================
  // PUT /:id - Update customer
  // =========================================================================
  .put(
    "/:id",
    ...withLabPermission({ client: ["update"] }),
    zValidator("json", UpdateCustomerSchema),
    async (c) => {
      const input = c.req.valid("json");
      const session = c.get("session");
      const memberData = c.get("member");
      const id = await resolveCustomerRouteId(
        c.req.param("id"),
        memberData.organizationId,
      );

      if (id === null) {
        return c.json({ error: "ID invalido" }, 400);
      }

      try {
        // Get existing customer for audit log
        const existingCustomer = await getLabCustomerById(
          id,
          memberData.organizationId,
        );

        if (!existingCustomer) {
          return c.json({ error: "Cliente nao encontrado" }, 404);
        }

        // A group reassignment must target a group owned by the same lab.
        if (
          input.groupId != null &&
          !(await groupBelongsToLab(input.groupId, memberData.organizationId))
        ) {
          return c.json({ error: "Grupo invalido" }, 400);
        }

        // Build changes object for audit log
        const changes: Record<string, { old: unknown; new: unknown }> = {};
        const existingCustomerRecord = toRecord(existingCustomer);
        for (const [key, value] of Object.entries(input)) {
          const oldValue = existingCustomerRecord[key];
          if (JSON.stringify(oldValue) !== JSON.stringify(value)) {
            changes[key] = { old: oldValue, new: value };
          }
        }

        // Update customer
        const [updatedCustomer] = await db
          .update(customer)
          .set({
            ...input,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(customer.id, id),
              eq(customer.labOrganizationId, memberData.organizationId),
            ),
          )
          .returning();

        // Log audit entry if there were changes
        if (Object.keys(changes).length > 0) {
          await db.insert(customerAuditLog).values({
            customerId: id,
            action: "update",
            changes,
            performedBy: session.user.id,
            ipAddress:
              c.req.header("x-forwarded-for") ??
              c.req.header("x-real-ip") ??
              null,
          });
        }

        return c.json(updatedCustomer);
      } catch (error) {
        console.error("Error updating customer:", error);
        return c.json({ error: "Erro ao atualizar cliente" }, 500);
      }
    },
  )

  // =========================================================================
  // DELETE /:id - Delete customer
  // =========================================================================
  .delete("/:id", ...withLabPermission({ client: ["delete"] }), async (c) => {
    const session = c.get("session");
    const memberData = c.get("member");
    const id = await resolveCustomerRouteId(
      c.req.param("id"),
      memberData.organizationId,
    );

    if (id === null) {
      return c.json({ error: "ID invalido" }, 400);
    }

    try {
      const existingCustomer = await getLabCustomerById(
        id,
        memberData.organizationId,
      );

      if (!existingCustomer) {
        return c.json({ error: "Cliente nao encontrado" }, 404);
      }

      // TODO: Check for active calibrations before deleting
      // For now, we allow deletion

      const ipAddress =
        c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip") ?? null;

      // Log audit entry before deletion
      await db.insert(customerAuditLog).values({
        customerId: id,
        action: "delete",
        changes: { customer: { old: existingCustomer, new: null } },
        performedBy: session.user.id,
        ipAddress,
      });

      // CMP-07 (#692): deleting the customer cascades its assets
      // (asset.customer_id → customer, intentional). Record a 'delete' audit row
      // for EACH asset first — the asset_audit_log.asset_id FK no longer cascades,
      // so these rows survive the delete and the ISO/IEC 17025 trail is preserved.
      const customerAssets = await db
        .select()
        .from(asset)
        .where(eq(asset.customerId, id));
      if (customerAssets.length > 0) {
        await db.insert(assetAuditLog).values(
          customerAssets.map((assetRow) => ({
            assetId: assetRow.id,
            action: "delete",
            changes: { asset: { old: assetRow, new: null } },
            performedBy: session.user.id,
            ipAddress,
            reason: "Cliente excluído",
          })),
        );
      }

      // Delete the customer (the asset/customer audit trail above survives)
      await db
        .delete(customer)
        .where(
          and(
            eq(customer.id, id),
            eq(customer.labOrganizationId, memberData.organizationId),
          ),
        );

      // Also delete the associated organization
      await db
        .delete(organization)
        .where(eq(organization.id, existingCustomer.authOrganizationId));

      return c.json({ success: true });
    } catch (error) {
      console.error("Error deleting customer:", error);
      return c.json({ error: "Erro ao excluir cliente" }, 500);
    }
  })

  // =========================================================================
  // GET /:id/members - List portal users for customer
  // =========================================================================
  .get(
    "/:id/members",
    ...withLabPermission({ client: ["manage_portal"] }),
    async (c) => {
      const memberData = c.get("member");
      const id = await resolveCustomerRouteId(
        c.req.param("id"),
        memberData.organizationId,
      );

      if (id === null) {
        return c.json({ error: "ID invalido" }, 400);
      }

      try {
        // Get customer to find authOrganizationId
        const foundCustomer = await getLabCustomerById(
          id,
          memberData.organizationId,
        );

        if (!foundCustomer) {
          return c.json({ error: "Cliente nao encontrado" }, 404);
        }

        // Get members of the CLIENT organization with user details
        const members = await db
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
          );

        return c.json(members);
      } catch (error) {
        console.error("Error listing customer members:", error);
        return c.json({ error: "Erro ao listar usuarios do portal" }, 500);
      }
    },
  )

  // =========================================================================
  // GET /:id/invitations - List invitations for customer
  // =========================================================================
  .get(
    "/:id/invitations",
    ...withLabPermission({ client: ["manage_portal"] }),
    async (c) => {
      const memberData = c.get("member");
      const id = await resolveCustomerRouteId(
        c.req.param("id"),
        memberData.organizationId,
      );

      if (id === null) {
        return c.json({ error: "ID invalido" }, 400);
      }

      try {
        // Get customer to find authOrganizationId
        const foundCustomer = await getLabCustomerById(
          id,
          memberData.organizationId,
        );

        if (!foundCustomer) {
          return c.json({ error: "Cliente nao encontrado" }, 404);
        }

        // Get invitations for the CLIENT organization
        const invitations = await db
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
          .where(
            eq(invitation.organizationId, foundCustomer.authOrganizationId),
          )
          .orderBy(desc(invitation.createdAt));

        return c.json(invitations);
      } catch (error) {
        console.error("Error listing customer invitations:", error);
        return c.json({ error: "Erro ao listar convites" }, 500);
      }
    },
  )

  // =========================================================================
  // POST /:id/invitations - Create invitation for portal user
  // =========================================================================
  .post(
    "/:id/invitations",
    ...withLabPermission({ client: ["manage_portal"] }),
    requireFeature("portal"), // Requires PROFESSIONAL+ plan
    zValidator("json", CreatePortalInvitationSchema),
    async (c) => {
      const { email, role } = c.req.valid("json");
      const session = c.get("session");
      const memberData = c.get("member");
      const portalRole = role || PORTAL_MANAGEABLE_MEMBER_ROLES[0];
      const id = await resolveCustomerRouteId(
        c.req.param("id"),
        memberData.organizationId,
      );

      if (id === null) {
        return c.json({ error: "ID invalido" }, 400);
      }

      try {
        // Get customer to find authOrganizationId
        const foundCustomer = await getLabCustomerById(
          id,
          memberData.organizationId,
        );

        if (!foundCustomer) {
          return c.json({ error: "Cliente nao encontrado" }, 404);
        }

        await enforceClientPortalMembershipBoundary(
          foundCustomer.authOrganizationId,
        );

        const inviteResult = await createPortalInvitationAsService({
          email,
          role: portalRole,
          organizationId: foundCustomer.authOrganizationId,
        });

        if (!inviteResult?.id) {
          return c.json({ error: "Falha ao criar convite" }, 500);
        }

        // Log audit entry
        await db.insert(customerAuditLog).values({
          customerId: id,
          action: "user_invited",
          changes: {
            email,
            role: portalRole,
            invitationId: inviteResult.id,
          },
          performedBy: session.user.id,
          ipAddress:
            c.req.header("x-forwarded-for") ??
            c.req.header("x-real-ip") ??
            null,
        });

        return c.json({ id: inviteResult.id, email, role: portalRole }, 201);
      } catch (error) {
        console.error("Error creating invitation:", error);
        if (error instanceof PortalServiceAccountError) {
          return c.json(
            {
              error: error.message,
              code: error.code,
            },
            portalErrorStatus(error),
          );
        }

        return c.json({ error: "Erro ao criar convite" }, 500);
      }
    },
  )

  // =========================================================================
  // POST /:id/invitations/:invId/resend - Resend invitation
  // =========================================================================
  .post(
    "/:id/invitations/:invId/resend",
    ...withLabPermission({ client: ["manage_portal"] }),
    async (c) => {
      const invId = c.req.param("invId");
      const memberData = c.get("member");
      const id = await resolveCustomerRouteId(
        c.req.param("id"),
        memberData.organizationId,
      );

      if (id === null) {
        return c.json({ error: "ID invalido" }, 400);
      }

      try {
        // Get customer to verify ownership
        const foundCustomer = await getLabCustomerById(
          id,
          memberData.organizationId,
        );

        if (!foundCustomer) {
          return c.json({ error: "Cliente nao encontrado" }, 404);
        }

        // Get invitation to verify it belongs to this customer
        const [foundInvitation] = await db
          .select()
          .from(invitation)
          .where(
            and(
              eq(invitation.id, invId),
              eq(invitation.organizationId, foundCustomer.authOrganizationId),
            ),
          )
          .limit(1);

        if (!foundInvitation) {
          return c.json({ error: "Convite nao encontrado" }, 404);
        }

        if (foundInvitation.status !== "pending") {
          return c.json(
            { error: "Apenas convites pendentes podem ser reenviados" },
            400,
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

        return c.json({
          id: getStringProperty(newInvite, "id"),
          email: foundInvitation.email,
        });
      } catch (error) {
        console.error("Error resending invitation:", error);
        if (error instanceof PortalServiceAccountError) {
          return c.json(
            {
              error: error.message,
              code: error.code,
            },
            portalErrorStatus(error),
          );
        }
        return c.json({ error: "Erro ao reenviar convite" }, 500);
      }
    },
  )

  // =========================================================================
  // DELETE /:id/invitations/:invId - Cancel invitation
  // =========================================================================
  .delete(
    "/:id/invitations/:invId",
    ...withLabPermission({ client: ["manage_portal"] }),
    async (c) => {
      const invId = c.req.param("invId");
      const session = c.get("session");
      const memberData = c.get("member");
      const id = await resolveCustomerRouteId(
        c.req.param("id"),
        memberData.organizationId,
      );

      if (id === null) {
        return c.json({ error: "ID invalido" }, 400);
      }

      try {
        // Get customer to verify ownership
        const foundCustomer = await getLabCustomerById(
          id,
          memberData.organizationId,
        );

        if (!foundCustomer) {
          return c.json({ error: "Cliente nao encontrado" }, 404);
        }

        // Get invitation to verify it belongs to this customer
        const [foundInvitation] = await db
          .select()
          .from(invitation)
          .where(
            and(
              eq(invitation.id, invId),
              eq(invitation.organizationId, foundCustomer.authOrganizationId),
            ),
          )
          .limit(1);

        if (!foundInvitation) {
          return c.json({ error: "Convite nao encontrado" }, 404);
        }

        if (foundInvitation.status !== "pending") {
          return c.json(
            { error: "Apenas convites pendentes podem ser cancelados" },
            400,
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
        await db.insert(customerAuditLog).values({
          customerId: id,
          action: "invitation_canceled",
          changes: { email: foundInvitation.email, invitationId: invId },
          performedBy: session.user.id,
          ipAddress:
            c.req.header("x-forwarded-for") ??
            c.req.header("x-real-ip") ??
            null,
        });

        return c.json({ success: true });
      } catch (error) {
        console.error("Error canceling invitation:", error);
        if (error instanceof PortalServiceAccountError) {
          return c.json(
            {
              error: error.message,
              code: error.code,
            },
            portalErrorStatus(error),
          );
        }
        return c.json({ error: "Erro ao cancelar convite" }, 500);
      }
    },
  )

  // =========================================================================
  // DELETE /:id/members/:memberId - Remove member from portal
  // =========================================================================
  .delete(
    "/:id/members/:memberId",
    ...withLabPermission({ client: ["manage_portal"] }),
    async (c) => {
      const memberId = c.req.param("memberId");
      const session = c.get("session");
      const memberData = c.get("member");
      const id = await resolveCustomerRouteId(
        c.req.param("id"),
        memberData.organizationId,
      );

      if (id === null) {
        return c.json({ error: "ID invalido" }, 400);
      }

      try {
        // Get customer to verify ownership
        const foundCustomer = await getLabCustomerById(
          id,
          memberData.organizationId,
        );

        if (!foundCustomer) {
          return c.json({ error: "Cliente nao encontrado" }, 404);
        }

        // Get member to verify it belongs to this customer's organization
        const [foundMember] = await db
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
          .limit(1);

        if (!foundMember) {
          return c.json({ error: "Membro nao encontrado" }, 404);
        }

        if (!isPortalManageableMemberRole(foundMember.role)) {
          return c.json(
            {
              error:
                "Apenas usuarios externos do portal podem ser removidos por esta tela",
            },
            403,
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
        await db.insert(customerAuditLog).values({
          customerId: id,
          action: "user_removed",
          changes: {
            email: foundMember.userEmail,
            name: foundMember.userName,
            memberId,
          },
          performedBy: session.user.id,
          ipAddress:
            c.req.header("x-forwarded-for") ??
            c.req.header("x-real-ip") ??
            null,
        });

        return c.json({ success: true });
      } catch (error) {
        console.error("Error removing member:", error);
        if (error instanceof PortalServiceAccountError) {
          return c.json(
            {
              error: error.message,
              code: error.code,
            },
            portalErrorStatus(error),
          );
        }
        return c.json({ error: "Erro ao remover membro" }, 500);
      }
    },
  )

  // =========================================================================
  // PUT /:id/compliance - Update compliance data
  // =========================================================================
  .put(
    "/:id/compliance",
    ...withLabPermission({ client: ["update"] }),
    zValidator("json", UpdateComplianceSchema),
    async (c) => {
      const { compliance, reason } = c.req.valid("json");
      const session = c.get("session");
      const memberData = c.get("member");
      const id = await resolveCustomerRouteId(
        c.req.param("id"),
        memberData.organizationId,
      );

      if (id === null) {
        return c.json({ error: "ID invalido" }, 400);
      }

      try {
        // Get existing customer for audit log
        const existingCustomer = await getLabCustomerById(
          id,
          memberData.organizationId,
        );

        if (!existingCustomer) {
          return c.json({ error: "Cliente nao encontrado" }, 404);
        }

        // Merge with existing compliance data, ensuring required fields have defaults
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

        const activeCommercialAgreement =
          await loadCustomerActiveCommercialAgreement(
            memberData.organizationId,
            id,
          );
        const updatedCompliance = syncComplianceWithActiveAgreement(
          mergedCompliance,
          activeCommercialAgreement,
        );

        // Update customer
        const [updatedCustomer] = await db
          .update(customer)
          .set({
            compliance: updatedCompliance,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(customer.id, id),
              eq(customer.labOrganizationId, memberData.organizationId),
            ),
          )
          .returning();

        // Log audit entry with reason (required for compliance changes per ISO 17025)
        await db.insert(customerAuditLog).values({
          customerId: id,
          action: "compliance_change",
          changes: { old: existingCustomer.compliance, new: updatedCompliance },
          performedBy: session.user.id,
          ipAddress:
            c.req.header("x-forwarded-for") ??
            c.req.header("x-real-ip") ??
            null,
          reason,
        });

        return c.json(updatedCustomer);
      } catch (error) {
        console.error("Error updating compliance:", error);
        return c.json({ error: "Erro ao atualizar conformidade" }, 500);
      }
    },
  )

  // =========================================================================
  // GET /:id/audit-log - Get audit trail for customer
  // =========================================================================
  .get(
    "/:id/audit-log",
    ...withLabPermission({ client: ["manage_portal"] }),
    zValidator("query", AuditLogQuerySchema),
    async (c) => {
      const { page, limit } = c.req.valid("query");
      const memberData = c.get("member");
      const id = await resolveCustomerRouteId(
        c.req.param("id"),
        memberData.organizationId,
      );

      if (id === null) {
        return c.json({ error: "ID invalido" }, 400);
      }

      try {
        // Verify customer exists
        const foundCustomer = await getLabCustomerById(
          id,
          memberData.organizationId,
        );

        if (!foundCustomer) {
          return c.json({ error: "Cliente nao encontrado" }, 404);
        }

        const offset = (page - 1) * limit;

        // Get audit log entries with user details
        const entries = await db
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
        const countResult = await db
          .select({ total: count() })
          .from(customerAuditLog)
          .where(eq(customerAuditLog.customerId, id));

        const total = countResult[0]?.total ?? 0;

        return c.json({
          data: entries,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        });
      } catch (error) {
        console.error("Error getting audit log:", error);
        return c.json({ error: "Erro ao buscar historico" }, 500);
      }
    },
  );
