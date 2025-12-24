import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { auth } from "@calibra-facil/auth";
import { db } from "@calibra-facil/db";
import { customer } from "@calibra-facil/db/schema";
import {
  CreateCustomerSchema,
  ListCustomersQuerySchema,
} from "@calibra-facil/schemas";
import { eq, ilike, or, count } from "drizzle-orm";
import { withLabPermission, type AuthVariables } from "../middleware/permission";

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
        // Step 1: Create CLIENT organization via Better Auth
        const slug = generateUniqueSlug(input.name);

        const orgResult = await auth.api.createOrganization({
          body: {
            name: input.name,
            slug,
            metadata: { type: "CLIENT" },
          },
          headers: c.req.raw.headers,
        });

        if (!orgResult?.id) {
          return c.json({ error: "Falha ao criar organizacao do cliente" }, 500);
        }

        // Step 2: Insert customer record with authOrganizationId
        const [newCustomer] = await db
          .insert(customer)
          .values({
            name: input.name,
            taxId: input.taxId || null,
            email: input.email || null,
            phone: input.phone || null,
            address: input.address || null,
            authOrganizationId: orgResult.id,
          })
          .returning();

        // Step 3: If email provided, create invitation for client portal access
        let invitationId: string | null = null;
        if (input.email && input.email.trim() !== "") {
          try {
            const inviteResult = await auth.api.createInvitation({
              body: {
                email: input.email,
                role: "client_user",
                organizationId: orgResult.id,
              },
              headers: c.req.raw.headers,
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
    }
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

      try {
        const offset = (page - 1) * limit;

        // Build search condition if query provided
        const searchCondition = query
          ? or(
              ilike(customer.name, `%${query}%`),
              ilike(customer.taxId, `%${query}%`),
              ilike(customer.email, `%${query}%`)
            )
          : undefined;

        // Get customers with pagination
        const customers = await db
          .select()
          .from(customer)
          .where(searchCondition)
          .orderBy(customer.name)
          .limit(limit)
          .offset(offset);

        // Get total count for pagination
        const countResult = await db
          .select({ total: count() })
          .from(customer)
          .where(searchCondition);

        const total = countResult[0]?.total ?? 0;

        return c.json({
          data: customers,
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
    }
  )

  // =========================================================================
  // GET /:id - Get customer by ID
  // =========================================================================
  .get(
    "/:id",
    ...withLabPermission({ client: ["read"] }),
    async (c) => {
      const id = parseInt(c.req.param("id"), 10);

      if (isNaN(id)) {
        return c.json({ error: "ID invalido" }, 400);
      }

      try {
        const [foundCustomer] = await db
          .select()
          .from(customer)
          .where(eq(customer.id, id))
          .limit(1);

        if (!foundCustomer) {
          return c.json({ error: "Cliente nao encontrado" }, 404);
        }

        return c.json(foundCustomer);
      } catch (error) {
        console.error("Error getting customer:", error);
        return c.json({ error: "Erro ao buscar cliente" }, 500);
      }
    }
  );
