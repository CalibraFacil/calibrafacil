import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { db } from "@calibra-facil/db";
import {
  asset,
  assetAuditLog,
  customer,
  assetType,
} from "@calibra-facil/db/schema";
import {
  CreateAssetSchema,
  UpdateAssetSchema,
  ListAssetsQuerySchema,
} from "@calibra-facil/schemas";
import { eq, ilike, or, count, and, isNull } from "drizzle-orm";
import {
  withLabPermission,
  type AuthVariables,
} from "../middleware/permission";

export const assetsRouter = new Hono<{ Variables: AuthVariables }>()
  // =========================================================================
  // POST / - Create a new asset
  // =========================================================================
  .post(
    "/",
    ...withLabPermission({ equipment: ["create"] }),
    zValidator("json", CreateAssetSchema),
    async (c) => {
      const input = c.req.valid("json");
      const session = c.get("session");

      try {
        // Validate that customer exists
        const [foundCustomer] = await db
          .select()
          .from(customer)
          .where(eq(customer.id, input.customerId))
          .limit(1);

        if (!foundCustomer) {
          return c.json({ error: "Cliente não encontrado" }, 404);
        }

        // Validate that asset type exists
        const [foundAssetType] = await db
          .select()
          .from(assetType)
          .where(eq(assetType.id, input.assetTypeId))
          .limit(1);

        if (!foundAssetType) {
          return c.json({ error: "Tipo de instrumento não encontrado" }, 404);
        }

        // Validate specifications against asset type definition
        if (foundAssetType.definition && input.specifications) {
          const requiredFields = foundAssetType.definition.filter(
            (field) => field.required,
          );
          for (const field of requiredFields) {
            if (
              input.specifications[field.key] === undefined ||
              input.specifications[field.key] === null ||
              input.specifications[field.key] === ""
            ) {
              return c.json(
                { error: `Campo obrigatório: ${field.label}` },
                400,
              );
            }
          }
        }

        // Check if tag is unique
        const [existingAsset] = await db
          .select()
          .from(asset)
          .where(eq(asset.tag, input.tag))
          .limit(1);

        if (existingAsset) {
          return c.json({ error: "Tag já está em uso" }, 400);
        }

        // Parse dates if provided
        const lastCalibrationDate = input.lastCalibrationDate
          ? new Date(input.lastCalibrationDate)
          : null;
        const nextCalibrationDate = input.nextCalibrationDate
          ? new Date(input.nextCalibrationDate)
          : null;

        // Create asset
        const [newAsset] = await db
          .insert(asset)
          .values({
            customerId: input.customerId,
            assetTypeId: input.assetTypeId,
            name: input.name,
            manufacturer: input.manufacturer || null,
            model: input.model || null,
            serialNumber: input.serialNumber,
            tag: input.tag,
            status: input.status || "ACTIVE",
            lastCalibrationDate,
            nextCalibrationDate,
            comments: input.comments || null,
            specifications: input.specifications || null,
          })
          .returning();

        if (!newAsset) {
          return c.json({ error: "Erro ao criar ativo" }, 500);
        }

        // Log audit entry
        await db.insert(assetAuditLog).values({
          assetId: newAsset.id,
          action: "create",
          changes: { asset: { old: null, new: newAsset } },
          performedBy: session.user.id,
          ipAddress:
            c.req.header("x-forwarded-for") ??
            c.req.header("x-real-ip") ??
            null,
        });

        return c.json(newAsset, 201);
      } catch (error) {
        console.error("Error creating asset:", error);
        return c.json({ error: "Erro ao criar ativo" }, 500);
      }
    },
  )

  // =========================================================================
  // GET / - List assets with pagination and filtering
  // =========================================================================
  .get(
    "/",
    ...withLabPermission({ equipment: ["read"] }),
    zValidator("query", ListAssetsQuerySchema),
    async (c) => {
      const { page, limit, customerId, assetTypeId, status, query } =
        c.req.valid("query");
      const member = c.get("member");

      try {
        const offset = (page - 1) * limit;

        // Build conditions array - always exclude soft-deleted assets
        const conditions = [isNull(asset.deletedAt)];

        // If user is a client_user, they can only see their organization's assets
        if (member.organizationType === "CLIENT") {
          // Find the customer linked to this client organization
          const [linkedCustomer] = await db
            .select()
            .from(customer)
            .where(eq(customer.authOrganizationId, member.organizationId))
            .limit(1);

          if (!linkedCustomer) {
            // Client has no linked customer, return empty
            return c.json({
              data: [],
              pagination: { page, limit, total: 0, totalPages: 0 },
            });
          }

          // Force filter by linked customer
          conditions.push(eq(asset.customerId, linkedCustomer.id));
        } else if (customerId) {
          // Lab staff can optionally filter by customer
          conditions.push(eq(asset.customerId, customerId));
        }

        // Filter by asset type
        if (assetTypeId) {
          conditions.push(eq(asset.assetTypeId, assetTypeId));
        }

        // Filter by status
        if (status) {
          conditions.push(eq(asset.status, status));
        }

        // Search by name, tag, or serialNumber
        if (query) {
          const searchCondition = or(
            ilike(asset.name, `%${query}%`),
            ilike(asset.tag, `%${query}%`),
            ilike(asset.serialNumber, `%${query}%`),
            ilike(asset.manufacturer, `%${query}%`),
            ilike(asset.model, `%${query}%`),
          );
          if (searchCondition) {
            conditions.push(searchCondition);
          }
        }

        const whereCondition =
          conditions.length > 0 ? and(...conditions) : undefined;

        // Get assets with customer and asset type info
        const assets = await db
          .select({
            id: asset.id,
            customerId: asset.customerId,
            customerName: customer.name,
            assetTypeId: asset.assetTypeId,
            assetTypeName: assetType.name,
            assetTypeSlug: assetType.slug,
            name: asset.name,
            manufacturer: asset.manufacturer,
            model: asset.model,
            serialNumber: asset.serialNumber,
            tag: asset.tag,
            status: asset.status,
            specifications: asset.specifications,
            lastCalibrationDate: asset.lastCalibrationDate,
            nextCalibrationDate: asset.nextCalibrationDate,
            comments: asset.comments,
            createdAt: asset.createdAt,
            updatedAt: asset.updatedAt,
          })
          .from(asset)
          .innerJoin(customer, eq(asset.customerId, customer.id))
          .innerJoin(assetType, eq(asset.assetTypeId, assetType.id))
          .where(whereCondition)
          .orderBy(asset.tag)
          .limit(limit)
          .offset(offset);

        // Get total count for pagination
        const countResult = await db
          .select({ total: count() })
          .from(asset)
          .innerJoin(customer, eq(asset.customerId, customer.id))
          .innerJoin(assetType, eq(asset.assetTypeId, assetType.id))
          .where(whereCondition);

        const total = countResult[0]?.total ?? 0;

        return c.json({
          data: assets,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        });
      } catch (error) {
        console.error("Error listing assets:", error);
        return c.json({ error: "Erro ao listar ativos" }, 500);
      }
    },
  )

  // =========================================================================
  // GET /:id - Get asset by ID
  // =========================================================================
  .get("/:id", ...withLabPermission({ equipment: ["read"] }), async (c) => {
    const id = parseInt(c.req.param("id"), 10);
    const member = c.get("member");

    if (isNaN(id)) {
      return c.json({ error: "ID inválido" }, 400);
    }

    try {
      const [foundAsset] = await db
        .select({
          id: asset.id,
          customerId: asset.customerId,
          customerName: customer.name,
          assetTypeId: asset.assetTypeId,
          assetTypeName: assetType.name,
          assetTypeSlug: assetType.slug,
          assetTypeDefinition: assetType.definition,
          name: asset.name,
          manufacturer: asset.manufacturer,
          model: asset.model,
          serialNumber: asset.serialNumber,
          tag: asset.tag,
          status: asset.status,
          specifications: asset.specifications,
          lastCalibrationDate: asset.lastCalibrationDate,
          nextCalibrationDate: asset.nextCalibrationDate,
          comments: asset.comments,
          createdAt: asset.createdAt,
          updatedAt: asset.updatedAt,
        })
        .from(asset)
        .innerJoin(customer, eq(asset.customerId, customer.id))
        .innerJoin(assetType, eq(asset.assetTypeId, assetType.id))
        .where(and(eq(asset.id, id), isNull(asset.deletedAt)))
        .limit(1);

      if (!foundAsset) {
        return c.json({ error: "Ativo não encontrado" }, 404);
      }

      // If user is a client_user, verify they can access this asset
      if (member.organizationType === "CLIENT") {
        const [linkedCustomer] = await db
          .select()
          .from(customer)
          .where(eq(customer.authOrganizationId, member.organizationId))
          .limit(1);

        if (!linkedCustomer || linkedCustomer.id !== foundAsset.customerId) {
          return c.json({ error: "Acesso negado" }, 403);
        }
      }

      return c.json(foundAsset);
    } catch (error) {
      console.error("Error getting asset:", error);
      return c.json({ error: "Erro ao buscar ativo" }, 500);
    }
  })

  // =========================================================================
  // PUT /:id - Update asset
  // =========================================================================
  .put(
    "/:id",
    ...withLabPermission({ equipment: ["update"] }),
    zValidator("json", UpdateAssetSchema),
    async (c) => {
      const id = parseInt(c.req.param("id"), 10);
      const input = c.req.valid("json");
      const session = c.get("session");
      const member = c.get("member");

      if (isNaN(id)) {
        return c.json({ error: "ID invalido" }, 400);
      }

      try {
        // Get existing asset (exclude soft-deleted)
        const [existingAsset] = await db
          .select()
          .from(asset)
          .where(and(eq(asset.id, id), isNull(asset.deletedAt)))
          .limit(1);

        if (!existingAsset) {
          return c.json({ error: "Ativo nao encontrado" }, 404);
        }

        // If user is a client_user, verify they can update this asset
        if (member.organizationType === "CLIENT") {
          const [linkedCustomer] = await db
            .select()
            .from(customer)
            .where(eq(customer.authOrganizationId, member.organizationId))
            .limit(1);

          if (
            !linkedCustomer ||
            linkedCustomer.id !== existingAsset.customerId
          ) {
            return c.json({ error: "Acesso negado" }, 403);
          }
        }

        // Check if tag is being changed and if it's unique
        if (input.tag && input.tag !== existingAsset.tag) {
          const [duplicateTag] = await db
            .select()
            .from(asset)
            .where(eq(asset.tag, input.tag))
            .limit(1);

          if (duplicateTag) {
            return c.json({ error: "Tag ja esta em uso" }, 400);
          }
        }

        // Parse dates if provided
        const lastCalibrationDate = input.lastCalibrationDate
          ? new Date(input.lastCalibrationDate)
          : undefined;
        const nextCalibrationDate = input.nextCalibrationDate
          ? new Date(input.nextCalibrationDate)
          : undefined;

        // Build update object
        const updateData: Record<string, unknown> = {
          updatedAt: new Date(),
        };

        if (input.name !== undefined) updateData.name = input.name;
        if (input.manufacturer !== undefined)
          updateData.manufacturer = input.manufacturer || null;
        if (input.model !== undefined) updateData.model = input.model || null;
        if (input.serialNumber !== undefined)
          updateData.serialNumber = input.serialNumber;
        if (input.tag !== undefined) updateData.tag = input.tag;
        if (input.status !== undefined) updateData.status = input.status;
        if (lastCalibrationDate !== undefined)
          updateData.lastCalibrationDate = lastCalibrationDate;
        if (nextCalibrationDate !== undefined)
          updateData.nextCalibrationDate = nextCalibrationDate;
        if (input.comments !== undefined)
          updateData.comments = input.comments || null;
        if (input.specifications !== undefined)
          updateData.specifications = input.specifications || null;

        // Build changes object for audit log
        const changes: Record<string, { old: unknown; new: unknown }> = {};
        for (const [key, value] of Object.entries(updateData)) {
          if (key === "updatedAt") continue;
          const oldValue = existingAsset[key as keyof typeof existingAsset];
          if (JSON.stringify(oldValue) !== JSON.stringify(value)) {
            changes[key] = { old: oldValue, new: value };
          }
        }

        // Update asset
        const [updatedAsset] = await db
          .update(asset)
          .set(updateData)
          .where(eq(asset.id, id))
          .returning();

        // Log audit entry if there were changes
        if (Object.keys(changes).length > 0) {
          const isStatusChange = "status" in changes;
          await db.insert(assetAuditLog).values({
            assetId: id,
            action: isStatusChange ? "status_change" : "update",
            changes,
            performedBy: session.user.id,
            ipAddress:
              c.req.header("x-forwarded-for") ??
              c.req.header("x-real-ip") ??
              null,
          });
        }

        return c.json(updatedAsset);
      } catch (error) {
        console.error("Error updating asset:", error);
        return c.json({ error: "Erro ao atualizar ativo" }, 500);
      }
    },
  )

  // =========================================================================
  // DELETE /:id - Delete asset
  // =========================================================================
  .delete(
    "/:id",
    ...withLabPermission({ equipment: ["delete"] }),
    async (c) => {
      const id = parseInt(c.req.param("id"), 10);
      const session = c.get("session");

      if (isNaN(id)) {
        return c.json({ error: "ID invalido" }, 400);
      }

      try {
        const [existingAsset] = await db
          .select()
          .from(asset)
          .where(and(eq(asset.id, id), isNull(asset.deletedAt)))
          .limit(1);

        if (!existingAsset) {
          return c.json({ error: "Ativo nao encontrado" }, 404);
        }

        // TODO: Check for active calibrations before deleting

        // Log audit entry before deletion
        await db.insert(assetAuditLog).values({
          assetId: id,
          action: "delete",
          changes: { asset: { old: existingAsset, new: null } },
          performedBy: session.user.id,
          ipAddress:
            c.req.header("x-forwarded-for") ??
            c.req.header("x-real-ip") ??
            null,
        });

        // Soft delete the asset (preserves audit logs for ISO 17025 compliance)
        await db
          .update(asset)
          .set({ deletedAt: new Date() })
          .where(eq(asset.id, id));

        return c.json({ success: true });
      } catch (error) {
        console.error("Error deleting asset:", error);
        return c.json({ error: "Erro ao excluir ativo" }, 500);
      }
    },
  );
