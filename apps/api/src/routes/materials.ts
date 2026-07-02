import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { db } from "@calibra-facil/db";
import { material } from "@calibra-facil/db/schema";
import {
  AdjustMaterialStockSchema,
  CreateMaterialSchema,
  UpdateMaterialSchema,
  ListMaterialsQuerySchema,
} from "@calibra-facil/schemas";
import {
  adjustMaterialErpStock,
  type IntegrationsEnv,
} from "../lib/integrations";
import {
  withLabPermission,
  type AuthVariables,
} from "../middleware/permission";
import { eq, and, or, ilike, desc, count } from "drizzle-orm";
import { buildUnitScopeCondition } from "../lib/units";

/**
 * Materials Router - Parts/Materials Catalog (Peças e materiais)
 *
 * Materials are the provider-neutral registry of parts the lab consumes on
 * service orders (load cells, sensors, displays, ...). Part line items can
 * reference a material for unit/cost/price prefills; the ERP binding
 * (Conta Azul product + stock) hangs off this table via object links.
 *
 * Reuses the `service` permission domain — the commercial catalog registry:
 * - GET /: service:read (all roles)
 * - GET /:id: service:read (all roles)
 * - POST /: service:create (admin, owner - LAB only)
 * - PUT /:id: service:update (admin, owner - LAB only)
 * - DELETE /:id: service:delete (admin, owner - LAB only) - soft delete
 */
function parseMaterialId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const id = Number.parseInt(raw, 10);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function extractPgCode(error: unknown): unknown {
  if (!error || typeof error !== "object") return undefined;
  if ("code" in error && error.code !== undefined) return error.code;
  // Drizzle wraps driver errors (DrizzleQueryError) — the SQLSTATE lives on cause
  if ("cause" in error) return extractPgCode(error.cause);
  return undefined;
}

function isUniqueViolation(error: unknown) {
  const code = extractPgCode(error);
  return typeof code === "string" && code === "23505";
}

export const materialsRouter = new Hono<{
  Variables: AuthVariables;
  Bindings: IntegrationsEnv;
}>()
  // =========================================================================
  // GET / - List materials with pagination and filtering
  // =========================================================================
  .get(
    "/",
    ...withLabPermission({ service: ["read"] }),
    zValidator("query", ListMaterialsQuerySchema),
    async (c) => {
      const member = c.get("member");
      const { page, limit, query, controlsStock, isActive } =
        c.req.valid("query");
      const offset = (page - 1) * limit;

      const conditions = [
        eq(material.organizationId, member.organizationId),
        buildUnitScopeCondition(material.unitId, member),
      ];

      if (query) {
        conditions.push(
          or(
            ilike(material.name, `%${query}%`),
            ilike(material.sku, `%${query}%`),
            ilike(material.description, `%${query}%`),
          )!,
        );
      }
      if (controlsStock !== undefined) {
        conditions.push(eq(material.controlsStock, controlsStock));
      }
      if (isActive !== undefined) {
        conditions.push(eq(material.isActive, isActive));
      }

      const whereCondition = and(...conditions);

      const [countResult] = await db
        .select({ total: count() })
        .from(material)
        .where(whereCondition);

      const materials = await db
        .select({
          id: material.id,
          name: material.name,
          description: material.description,
          sku: material.sku,
          unit: material.unit,
          unitCostCents: material.unitCostCents,
          unitPriceCents: material.unitPriceCents,
          controlsStock: material.controlsStock,
          stockQuantity: material.stockQuantity,
          stockSyncedAt: material.stockSyncedAt,
          isActive: material.isActive,
          createdAt: material.createdAt,
          updatedAt: material.updatedAt,
        })
        .from(material)
        .where(whereCondition)
        .orderBy(desc(material.createdAt))
        .limit(limit)
        .offset(offset);

      return c.json({
        data: materials,
        pagination: {
          page,
          limit,
          total: countResult?.total ?? 0,
          totalPages: Math.ceil((countResult?.total ?? 0) / limit),
        },
      });
    },
  )

  // =========================================================================
  // GET /:id - Get single material by ID
  // =========================================================================
  .get("/:id", ...withLabPermission({ service: ["read"] }), async (c) => {
    const member = c.get("member");
    const id = parseMaterialId(c.req.param("id"));

    if (id === null) {
      return c.json({ error: "ID inválido" }, 400);
    }

    const [found] = await db
      .select()
      .from(material)
      .where(
        and(
          eq(material.id, id),
          eq(material.organizationId, member.organizationId),
          buildUnitScopeCondition(material.unitId, member),
        ),
      )
      .limit(1);

    if (!found) {
      return c.json({ error: "Material não encontrado" }, 404);
    }

    return c.json(found);
  })

  // =========================================================================
  // POST / - Create new material
  // =========================================================================
  .post(
    "/",
    ...withLabPermission({ service: ["create"] }),
    zValidator("json", CreateMaterialSchema),
    async (c) => {
      const member = c.get("member");
      const input = c.req.valid("json");

      if (!member.activeUnitId) {
        return c.json(
          { error: "Selecione uma unidade específica para criar materiais" },
          400,
        );
      }

      try {
        const [created] = await db
          .insert(material)
          .values({
            unitId: member.activeUnitId,
            organizationId: member.organizationId,
            name: input.name,
            description: input.description || null,
            sku: input.sku || null,
            unit: input.unit || "un",
            unitCostCents: input.unitCostCents ?? null,
            unitPriceCents: input.unitPriceCents ?? null,
            controlsStock: input.controlsStock ?? false,
            isActive: input.isActive ?? true,
          })
          .returning();

        if (!created) {
          return c.json({ error: "Falha ao criar material" }, 500);
        }

        return c.json(created, 201);
      } catch (error) {
        if (isUniqueViolation(error)) {
          return c.json(
            { error: "Já existe um material com este código" },
            409,
          );
        }
        throw error;
      }
    },
  )

  // =========================================================================
  // PUT /:id - Update existing material
  // =========================================================================
  .put(
    "/:id",
    ...withLabPermission({ service: ["update"] }),
    zValidator("json", UpdateMaterialSchema),
    async (c) => {
      const member = c.get("member");
      const input = c.req.valid("json");
      const id = parseMaterialId(c.req.param("id"));

      if (id === null) {
        return c.json({ error: "ID inválido" }, 400);
      }

      const [existing] = await db
        .select()
        .from(material)
        .where(
          and(
            eq(material.id, id),
            eq(material.organizationId, member.organizationId),
            buildUnitScopeCondition(material.unitId, member),
          ),
        )
        .limit(1);

      if (!existing) {
        return c.json({ error: "Material não encontrado" }, 404);
      }

      const updateData: Record<string, unknown> = {};
      if (input.name !== undefined) updateData.name = input.name;
      if (input.description !== undefined) {
        updateData.description = input.description;
      }
      if (input.sku !== undefined) updateData.sku = input.sku;
      if (input.unit !== undefined) updateData.unit = input.unit;
      if (input.unitCostCents !== undefined) {
        updateData.unitCostCents = input.unitCostCents;
      }
      if (input.unitPriceCents !== undefined) {
        updateData.unitPriceCents = input.unitPriceCents;
      }
      if (input.controlsStock !== undefined) {
        updateData.controlsStock = input.controlsStock;
      }
      if (input.isActive !== undefined) updateData.isActive = input.isActive;

      if (Object.keys(updateData).length === 0) {
        return c.json(existing);
      }

      try {
        const [updated] = await db
          .update(material)
          .set(updateData)
          .where(eq(material.id, id))
          .returning();

        return c.json(updated);
      } catch (error) {
        if (isUniqueViolation(error)) {
          return c.json(
            { error: "Já existe um material com este código" },
            409,
          );
        }
        throw error;
      }
    },
  )

  // =========================================================================
  // POST /:id/stock - Manual entrada/ajuste via the linked ERP product
  // =========================================================================
  .post(
    "/:id/stock",
    ...withLabPermission({ service: ["update"] }),
    zValidator("json", AdjustMaterialStockSchema),
    async (c) => {
      const member = c.get("member");
      const input = c.req.valid("json");
      const id = parseMaterialId(c.req.param("id"));

      if (id === null) {
        return c.json({ error: "ID inválido" }, 400);
      }

      const [existing] = await db
        .select({ id: material.id })
        .from(material)
        .where(
          and(
            eq(material.id, id),
            eq(material.organizationId, member.organizationId),
            buildUnitScopeCondition(material.unitId, member),
          ),
        )
        .limit(1);

      if (!existing) {
        return c.json({ error: "Material não encontrado" }, 404);
      }

      try {
        const result = await adjustMaterialErpStock({
          organizationId: member.organizationId,
          materialId: id,
          quantity: input.quantityOnHand,
          env: c.env,
        });
        return c.json({
          stockQuantity: result.stockQuantity,
          stockSyncedAt: result.stockSyncedAt,
        });
      } catch (error) {
        // Lab-actionable preconditions (no integration, unlinked material,
        // products sync disabled, plan gate) surface as a conflict with the
        // pt-BR message; unexpected failures still bubble to the 500 handler.
        const message =
          error instanceof Error ? error.message : "Falha ao ajustar estoque";
        return c.json({ error: message }, 409);
      }
    },
  )

  // =========================================================================
  // DELETE /:id - Deactivate material (soft delete)
  // =========================================================================
  .delete("/:id", ...withLabPermission({ service: ["delete"] }), async (c) => {
    const member = c.get("member");
    const id = parseMaterialId(c.req.param("id"));

    if (id === null) {
      return c.json({ error: "ID inválido" }, 400);
    }

    const [existing] = await db
      .select()
      .from(material)
      .where(
        and(
          eq(material.id, id),
          eq(material.organizationId, member.organizationId),
          buildUnitScopeCondition(material.unitId, member),
        ),
      )
      .limit(1);

    if (!existing) {
      return c.json({ error: "Material não encontrado" }, 404);
    }

    // Soft delete - never hard delete commercial data
    const [updated] = await db
      .update(material)
      .set({ isActive: false })
      .where(eq(material.id, id))
      .returning();

    return c.json({
      message: "Material desativado com sucesso",
      data: updated,
    });
  });
