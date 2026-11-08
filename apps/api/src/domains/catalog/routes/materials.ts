import { createRouter } from "../../../server/router";
import { materialEndpoints } from "@calibra-facil/contracts";
import { material } from "@calibra-facil/db/schema";
import { adjustMaterialErpStock, type IntegrationsEnv } from "../../finance";
import {
  type AuthVariables,
  type MemberData,
} from "../../../middleware/permission";
import { eq, and, or, ilike, desc, count } from "drizzle-orm";
import { buildUnitScopeCondition } from "../../../lib/units";
import { mount } from "../../../lib/endpoint-mount";
import { orgDb } from "../../../lib/org-db";
import type { OrgExecutor } from "@calibra-facil/db/for-org";
import { isUniqueViolation } from "../../../lib/db-errors";
import { conflict, invalid, notFound } from "../../../lib/domain-errors";
import { withOrg } from "../../../lib/org-context";
import { requestActor } from "../../../middleware/request-actor";

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
/** A material the caller's units can see, or a 404. */
async function requireLabMaterial(
  id: number,
  member: MemberData,
  executor: Pick<OrgExecutor, "select">,
) {
  const [found] = await executor
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
  if (!found) throw notFound("material_not_found", "Material não encontrado");
  return found;
}

const DUPLICATE_SKU = "Já existe um material com este código";

const PREFIX = "/api/materials";

export const materialsRouter = createRouter<{
  Variables: AuthVariables;
  Bindings: IntegrationsEnv;
}>();

mount(
  materialsRouter,
  PREFIX,
  materialEndpoints.list,
  async (c, { query: filters }) => {
    const member = c.get("member");
    const { page, limit, query, controlsStock, isActive } = filters;
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

    const { countResult, materials } = await orgDb(
      member.organizationId,
    ).transaction(async (o) => {
      const [total] = await o
        .select({ total: count() })
        .from(material)
        .where(whereCondition);

      const rows = await o
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

      return { countResult: total, materials: rows };
    });

    return {
      data: materials,
      pagination: {
        page,
        limit,
        total: countResult?.total ?? 0,
        totalPages: Math.ceil((countResult?.total ?? 0) / limit),
      },
    };
  },
);

mount(materialsRouter, PREFIX, materialEndpoints.get, async (c, { params }) => {
  const member = c.get("member");
  const { id } = params;

  return await orgDb(member.organizationId).transaction((o) =>
    requireLabMaterial(id, member, o),
  );
});

mount(
  materialsRouter,
  PREFIX,
  materialEndpoints.create,
  async (c, { body: input }) => {
    const member = c.get("member");

    if (!member.activeUnitId) {
      throw invalid(
        "unit_active_required",
        "Selecione uma unidade específica para criar materiais",
      );
    }

    try {
      const { activeUnitId } = member;
      const created = await withOrg(
        member.organizationId,
        requestActor(c),
        async (ctx) => {
          const [row] = await ctx.o
            .insert(material)
            .values({
              unitId: activeUnitId,
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
          return row;
        },
      );

      if (!created) {
        throw new Error("Falha ao criar material");
      }

      return created;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw conflict("material_sku_conflict", DUPLICATE_SKU);
      }
      throw error;
    }
  },
);

mount(
  materialsRouter,
  PREFIX,
  materialEndpoints.update,
  async (c, { params, body: input }) => {
    const member = c.get("member");
    const { id } = params;

    const existing = await orgDb(member.organizationId).transaction((o) =>
      requireLabMaterial(id, member, o),
    );

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
      return existing;
    }

    try {
      const updated = await withOrg(
        member.organizationId,
        requestActor(c),
        async (ctx) => {
          const [row] = await ctx.o
            .update(material)
            .set(updateData)
            .where(eq(material.id, id))
            .returning();
          return row;
        },
      );

      // `requireLabMaterial` found the row a moment ago, so the update
      // returns it; the fallback is a concurrent delete.
      if (!updated)
        throw notFound("material_not_found", "Material não encontrado");
      return updated;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw conflict("material_sku_conflict", DUPLICATE_SKU);
      }
      throw error;
    }
  },
);

// =========================================================================
// POST /:id/stock - Manual entrada/ajuste via the linked ERP product
// =========================================================================
mount(
  materialsRouter,
  PREFIX,
  materialEndpoints.adjustStock,
  async (c, { params, body: input }) => {
    const member = c.get("member");
    const { id } = params;

    await orgDb(member.organizationId).transaction((o) =>
      requireLabMaterial(id, member, o),
    );

    // Lab-actionable preconditions (no integration, unlinked material, products
    // sync disabled, a refusal by the ERP) are typed 409s with a fixed pt-BR
    // message, thrown by `adjustMaterialErpStock`; anything else (a failed
    // query included) bubbles to the error handler: reported, opaque 500.
    const result = await adjustMaterialErpStock({
      organizationId: member.organizationId,
      materialId: id,
      quantity: input.quantityOnHand,
      env: c.env,
    });
    return {
      stockQuantity: result.stockQuantity,
      stockSyncedAt: result.stockSyncedAt,
    };
  },
);

mount(
  materialsRouter,
  PREFIX,
  materialEndpoints.deactivate,
  async (c, { params }) => {
    const member = c.get("member");
    const { id } = params;

    const updated = await withOrg(
      member.organizationId,
      requestActor(c),
      async (ctx) => {
        await requireLabMaterial(id, member, ctx.o);

        // Soft delete - never hard delete commercial data
        const [row] = await ctx.o
          .update(material)
          .set({ isActive: false })
          .where(eq(material.id, id))
          .returning();
        return row;
      },
    );

    if (!updated)
      throw notFound("material_not_found", "Material não encontrado");
    return {
      message: "Material desativado com sucesso",
      data: updated,
    };
  },
);
