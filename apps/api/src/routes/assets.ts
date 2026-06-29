import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "@calibra-facil/db";
import {
  asset,
  assetAuditLog,
  customer,
  assetType,
  user,
  type AssetTypeFieldDefinition,
} from "@calibra-facil/db/schema";
import {
  CreateAssetSchema,
  UpdateAssetSchema,
  ListAssetsQuerySchema,
  RegulatedIntervalSchema,
} from "@calibra-facil/schemas";
import type { MeasurementUnit } from "@calibra-facil/shared";
import { eq, ilike, or, count, and, isNull, desc } from "drizzle-orm";
import {
  withLabPermission,
  type AuthVariables,
  type MemberData,
} from "../middleware/permission";
import { buildUnitScopeCondition } from "../lib/units";
import { deriveNextCalibrationDate } from "../lib/portal-asset-interval";
import { deriveRegulatedNextDate } from "../lib/regulated-interval";
import { resolveAssetRegimeWrite } from "../lib/asset-regime";
import {
  parseLegacyNumericIdentifier,
  slugifyRouteIdentifier,
} from "../lib/route-identifiers";
import {
  denormalizeAssetSpecificationsForResponse,
  normalizeAssetSpecificationsFromInput,
  resolveAssetBaseMeasurementUnit,
} from "../lib/asset-measurement";

const CommandPaletteAssetSearchQuerySchema = z.object({
  query: z.string().trim().min(2),
  limit: z.coerce.number().min(1).max(10).default(5),
});

function getAssetScopeCondition(member: MemberData) {
  return member.organizationType === "LAB"
    ? buildUnitScopeCondition(asset.unitId, member)
    : undefined;
}

function serializeAssetForResponse<
  T extends {
    specifications: Record<string, unknown> | null;
    assetTypeDefinition?: AssetTypeFieldDefinition[] | null;
    baseMeasurementUnit?: MeasurementUnit | null;
  },
>(assetRecord: T): T {
  const specifications = denormalizeAssetSpecificationsForResponse({
    specifications: assetRecord.specifications,
    definition: assetRecord.assetTypeDefinition,
    baseMeasurementUnit: assetRecord.baseMeasurementUnit,
  });

  return {
    ...assetRecord,
    specifications: specifications ?? null,
  };
}

async function resolveAssetRouteId(
  identifier: string,
  member: MemberData,
): Promise<number | null> {
  const legacyId = parseLegacyNumericIdentifier(identifier);
  const directConditions = [
    eq(asset.tag, identifier),
    eq(asset.serialNumber, identifier),
  ];

  if (legacyId !== null) {
    directConditions.unshift(eq(asset.id, legacyId));
  }

  const [directMatch] = await db
    .select({ id: asset.id })
    .from(asset)
    .innerJoin(customer, eq(asset.customerId, customer.id))
    .where(
      and(
        or(...directConditions)!,
        member.organizationType === "LAB"
          ? eq(customer.labOrganizationId, member.organizationId)
          : undefined,
        getAssetScopeCondition(member),
        isNull(asset.deletedAt),
      ),
    )
    .limit(1);

  if (directMatch) {
    return directMatch.id;
  }

  const scopedAssets = await db
    .select({
      id: asset.id,
      tag: asset.tag,
      serialNumber: asset.serialNumber,
    })
    .from(asset)
    .innerJoin(customer, eq(asset.customerId, customer.id))
    .where(
      and(
        member.organizationType === "LAB"
          ? eq(customer.labOrganizationId, member.organizationId)
          : undefined,
        getAssetScopeCondition(member),
        isNull(asset.deletedAt),
      ),
    );

  const match = scopedAssets.find(
    (candidate) =>
      slugifyRouteIdentifier(candidate.tag) === identifier ||
      slugifyRouteIdentifier(candidate.serialNumber) === identifier,
  );

  return match?.id ?? null;
}

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
      const member = c.get("member");

      if (!member.activeUnitId) {
        return c.json(
          { error: "Selecione uma unidade específica para criar ativos" },
          400,
        );
      }

      try {
        // Validate that customer exists
        const [foundCustomer] = await db
          .select()
          .from(customer)
          .where(
            and(
              eq(customer.id, input.customerId),
              eq(customer.labOrganizationId, member.organizationId),
            ),
          )
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

        const baseMeasurementUnitResult = resolveAssetBaseMeasurementUnit(
          foundAssetType,
          input.baseMeasurementUnit,
        );

        if (!baseMeasurementUnitResult.ok) {
          return c.json({ error: baseMeasurementUnitResult.error }, 400);
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

        // Parse dates if provided. The lab does NOT set the calibration interval
        // or next-calibration date — that periodicity is the customer's decision,
        // set in the portal (ISO/IEC 17025:2017 §7.8.4.3 + ILAC-G24). Any
        // client-supplied `nextCalibrationDate` is ignored here.
        const lastCalibrationDate = input.lastCalibrationDate
          ? new Date(input.lastCalibrationDate)
          : null;
        // Installation date anchors the legal-metrology verification ceiling
        // (regulated_interval.kind = 'max_months_from_install'). (REQ-INSTALL-002/003)
        const installedAt = input.installedAt
          ? new Date(input.installedAt)
          : null;
        const normalizedSpecifications = normalizeAssetSpecificationsFromInput({
          specifications: input.specifications || null,
          definition: foundAssetType.definition,
          baseMeasurementUnit: baseMeasurementUnitResult.baseMeasurementUnit,
        });

        // Legal-metrology regime (Track 2): the regime + the regulation-fixed verification
        // periodicity, independent of the customer-owned calibration interval (Track 1),
        // which the lab never authors. (REQ-MLR-030/031/003)
        const regimeWrite = resolveAssetRegimeWrite({
          metrologyRegime: input.metrologyRegime,
          regulatedInterval: input.regulatedInterval,
          current: { metrologyRegime: "INDUSTRIAL", regulatedInterval: null },
        });
        const nextLegalVerificationDate = regimeWrite.regulatedInterval
          ? deriveRegulatedNextDate(regimeWrite.regulatedInterval, {
              lastVerificationDate: lastCalibrationDate,
              firstVerificationDate: lastCalibrationDate,
              installDate: installedAt,
            }).date
          : null;

        // Create asset
        const [newAsset] = await db
          .insert(asset)
          .values({
            unitId: member.activeUnitId,
            customerId: input.customerId,
            assetTypeId: input.assetTypeId,
            name: input.name,
            manufacturer: input.manufacturer || null,
            model: input.model || null,
            serialNumber: input.serialNumber,
            tag: input.tag,
            status: input.status || "ACTIVE",
            baseMeasurementUnit: baseMeasurementUnitResult.baseMeasurementUnit,
            lastCalibrationDate,
            installedAt,
            comments: input.comments || null,
            specifications: normalizedSpecifications.specifications || null,
            metrologyRegime: regimeWrite.metrologyRegime,
            regulatedInterval: regimeWrite.regulatedInterval,
            nextLegalVerificationDate,
          })
          .returning();

        if (!newAsset) {
          return c.json({ error: "Erro ao criar ativo" }, 500);
        }

        // Log audit entry
        await db.insert(assetAuditLog).values({
          assetId: newAsset.id,
          action: "create",
          changes: {
            asset: { old: null, new: newAsset },
            unitConversions:
              normalizedSpecifications.conversions.length > 0
                ? normalizedSpecifications.conversions
                : undefined,
          },
          performedBy: session.user.id,
          ipAddress:
            c.req.header("x-forwarded-for") ??
            c.req.header("x-real-ip") ??
            null,
        });

        return c.json(
          serializeAssetForResponse({
            ...newAsset,
            assetTypeDefinition: foundAssetType.definition,
          }),
          201,
        );
      } catch (error) {
        console.error("Error creating asset:", error);
        return c.json({ error: "Erro ao criar ativo" }, 500);
      }
    },
  )

  // =========================================================================
  // GET /search - Lightweight search for command palette
  // =========================================================================
  .get(
    "/search",
    ...withLabPermission({ equipment: ["read"] }),
    zValidator("query", CommandPaletteAssetSearchQuerySchema),
    async (c) => {
      const member = c.get("member");
      const { query, limit } = c.req.valid("query");

      try {
        const results = await db
          .select({
            id: asset.id,
            tag: asset.tag,
            serialNumber: asset.serialNumber,
            assetTypeName: assetType.name,
            customerName: customer.name,
            customerTaxId: customer.taxId,
          })
          .from(asset)
          .innerJoin(customer, eq(asset.customerId, customer.id))
          .innerJoin(assetType, eq(asset.assetTypeId, assetType.id))
          .where(
            and(
              buildUnitScopeCondition(asset.unitId, member),
              isNull(asset.deletedAt),
              eq(customer.labOrganizationId, member.organizationId),
              or(
                ilike(asset.tag, `%${query}%`),
                ilike(asset.serialNumber, `%${query}%`),
                ilike(asset.name, `%${query}%`),
              )!,
            ),
          )
          .orderBy(asset.tag)
          .limit(limit);

        return c.json(results);
      } catch (error) {
        console.error("Error searching assets:", error);
        return c.json({ error: "Erro ao buscar ativos" }, 500);
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
        const assetScopeCondition = getAssetScopeCondition(member);
        if (assetScopeCondition) {
          conditions.push(assetScopeCondition);
        }

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
            customerTaxId: customer.taxId,
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
            baseMeasurementUnit: asset.baseMeasurementUnit,
            specifications: asset.specifications,
            lastCalibrationDate: asset.lastCalibrationDate,
            nextCalibrationDate: asset.nextCalibrationDate,
            comments: asset.comments,
            metrologyRegime: asset.metrologyRegime,
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
          data: assets.map((item) => serializeAssetForResponse(item)),
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
  // GET /:id/label - Get asset label by ID
  // =========================================================================
  .get(
    "/:id/label",
    ...withLabPermission({ equipment: ["read"] }),
    async (c) => {
      const member = c.get("member");
      const id = await resolveAssetRouteId(c.req.param("id"), member);

      if (id === null) {
        return c.json({ error: "ID inválido" }, 400);
      }

      const [foundAsset] = await db
        .select({
          id: asset.id,
          label: asset.name,
          customerId: asset.customerId,
        })
        .from(asset)
        .innerJoin(customer, eq(asset.customerId, customer.id))
        .where(
          and(
            eq(asset.id, id),
            member.organizationType === "LAB"
              ? eq(customer.labOrganizationId, member.organizationId)
              : undefined,
            getAssetScopeCondition(member),
            isNull(asset.deletedAt),
          ),
        )
        .limit(1);

      if (!foundAsset) {
        return c.json({ error: "Ativo não encontrado" }, 404);
      }

      if (member.organizationType === "CLIENT") {
        const [linkedCustomer] = await db
          .select({ id: customer.id })
          .from(customer)
          .where(eq(customer.authOrganizationId, member.organizationId))
          .limit(1);

        if (!linkedCustomer || linkedCustomer.id !== foundAsset.customerId) {
          return c.json({ error: "Acesso negado" }, 403);
        }
      }

      return c.json({
        id: foundAsset.id,
        label: foundAsset.label,
      });
    },
  )

  // =========================================================================
  // GET /:id - Get asset by ID
  // =========================================================================
  .get("/:id", ...withLabPermission({ equipment: ["read"] }), async (c) => {
    const member = c.get("member");
    const id = await resolveAssetRouteId(c.req.param("id"), member);

    if (id === null) {
      return c.json({ error: "ID inválido" }, 400);
    }

    try {
      const [foundAsset] = await db
        .select({
          id: asset.id,
          customerId: asset.customerId,
          customerName: customer.name,
          customerTaxId: customer.taxId,
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
          baseMeasurementUnit: asset.baseMeasurementUnit,
          specifications: asset.specifications,
          lastCalibrationDate: asset.lastCalibrationDate,
          nextCalibrationDate: asset.nextCalibrationDate,
          installedAt: asset.installedAt,
          comments: asset.comments,
          metrologyRegime: asset.metrologyRegime,
          regulatedInterval: asset.regulatedInterval,
          nextLegalVerificationDate: asset.nextLegalVerificationDate,
          createdAt: asset.createdAt,
          updatedAt: asset.updatedAt,
        })
        .from(asset)
        .innerJoin(customer, eq(asset.customerId, customer.id))
        .innerJoin(assetType, eq(asset.assetTypeId, assetType.id))
        .where(
          and(
            eq(asset.id, id),
            getAssetScopeCondition(member),
            isNull(asset.deletedAt),
          ),
        )
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

      return c.json(serializeAssetForResponse(foundAsset));
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
      const input = c.req.valid("json");
      const session = c.get("session");
      const member = c.get("member");
      const id = await resolveAssetRouteId(c.req.param("id"), member);

      if (id === null) {
        return c.json({ error: "ID invalido" }, 400);
      }

      try {
        // Get existing asset (exclude soft-deleted)
        const [existingAsset] = await db
          .select({
            id: asset.id,
            unitId: asset.unitId,
            customerId: asset.customerId,
            assetTypeId: asset.assetTypeId,
            specifications: asset.specifications,
            name: asset.name,
            manufacturer: asset.manufacturer,
            model: asset.model,
            serialNumber: asset.serialNumber,
            tag: asset.tag,
            status: asset.status,
            baseMeasurementUnit: asset.baseMeasurementUnit,
            lastCalibrationDate: asset.lastCalibrationDate,
            nextCalibrationDate: asset.nextCalibrationDate,
            installedAt: asset.installedAt,
            calibrationIntervalMonths: asset.calibrationIntervalMonths,
            comments: asset.comments,
            metrologyRegime: asset.metrologyRegime,
            regulatedInterval: asset.regulatedInterval,
            deletedAt: asset.deletedAt,
            assetTypeDefinition: assetType.definition,
          })
          .from(asset)
          .innerJoin(assetType, eq(asset.assetTypeId, assetType.id))
          .where(
            and(
              eq(asset.id, id),
              getAssetScopeCondition(member),
              isNull(asset.deletedAt),
            ),
          )
          .limit(1);

        if (!existingAsset) {
          return c.json({ error: "Ativo nao encontrado" }, 404);
        }

        let linkedCustomerId: number | null = null;

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

          linkedCustomerId = linkedCustomer.id;
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

        // Parse dates if provided. The lab does NOT set the next-calibration date
        // / interval — periodicity is the customer's decision (portal); any
        // client-supplied `nextCalibrationDate` is ignored here (§7.8.4.3 + ILAC-G24).
        const lastCalibrationDate = input.lastCalibrationDate
          ? new Date(input.lastCalibrationDate)
          : undefined;
        // Installation date (Track-2 install anchor). undefined → not provided in this
        // PATCH; only persisted when the client sends it. (REQ-INSTALL-002/004)
        const installedAt = input.installedAt
          ? new Date(input.installedAt)
          : undefined;

        // Build update object
        const updateData: Record<string, unknown> = {
          updatedAt: new Date(),
        };
        const changes: Record<string, { old: unknown; new: unknown }> = {};

        if (input.name !== undefined) updateData.name = input.name;
        if (input.manufacturer !== undefined)
          updateData.manufacturer = input.manufacturer || null;
        if (input.model !== undefined) updateData.model = input.model || null;
        if (input.serialNumber !== undefined)
          updateData.serialNumber = input.serialNumber;
        if (input.tag !== undefined) updateData.tag = input.tag;
        if (input.status !== undefined) updateData.status = input.status;
        if (lastCalibrationDate !== undefined) {
          updateData.lastCalibrationDate = lastCalibrationDate;
          // Keep the derived next-cal date in sync with the customer-owned interval
          // (REQ-INTERVAL-003): next = last + interval. Null when no interval is set.
          updateData.nextCalibrationDate =
            existingAsset.calibrationIntervalMonths === null
              ? null
              : deriveNextCalibrationDate(
                  lastCalibrationDate,
                  existingAsset.calibrationIntervalMonths,
                );
        }
        if (installedAt !== undefined) {
          updateData.installedAt = installedAt;
        }
        if (input.comments !== undefined)
          updateData.comments = input.comments || null;
        // Legal-metrology regime (Track 2) — recompute when the client touches the regime,
        // the regulated interval, OR the install anchor (a standalone installed_at change
        // must re-derive next_legal_verification_date for an install-anchored LEGAL asset).
        // Independent of Track 1 (the customer-owned calibration interval).
        // (REQ-MLR-030/031/032 + REQ-INSTALL-002)
        if (
          input.metrologyRegime !== undefined ||
          input.regulatedInterval !== undefined ||
          installedAt !== undefined
        ) {
          const parsedCurrent = RegulatedIntervalSchema.safeParse(
            existingAsset.regulatedInterval,
          );
          const regimeWrite = resolveAssetRegimeWrite({
            metrologyRegime: input.metrologyRegime,
            regulatedInterval: input.regulatedInterval,
            current: {
              metrologyRegime: existingAsset.metrologyRegime,
              regulatedInterval: parsedCurrent.success
                ? parsedCurrent.data
                : null,
            },
          });
          updateData.metrologyRegime = regimeWrite.metrologyRegime;
          updateData.regulatedInterval = regimeWrite.regulatedInterval;
          const anchorDate =
            (lastCalibrationDate !== undefined
              ? lastCalibrationDate
              : existingAsset.lastCalibrationDate) ?? null;
          // Install anchor: the PATCHed value if provided, else the stored one.
          // (REQ-INSTALL-002/003 — never fabricated when absent.)
          const installAnchor =
            (installedAt !== undefined
              ? installedAt
              : existingAsset.installedAt) ?? null;
          updateData.nextLegalVerificationDate = regimeWrite.regulatedInterval
            ? deriveRegulatedNextDate(regimeWrite.regulatedInterval, {
                lastVerificationDate: anchorDate,
                firstVerificationDate: anchorDate,
                installDate: installAnchor,
              }).date
            : null;
        }
        if (input.specifications !== undefined) {
          const normalizedSpecifications =
            normalizeAssetSpecificationsFromInput({
              specifications: input.specifications || null,
              definition: existingAsset.assetTypeDefinition,
              baseMeasurementUnit: existingAsset.baseMeasurementUnit,
            });
          updateData.specifications =
            normalizedSpecifications.specifications || null;
          if (normalizedSpecifications.conversions.length > 0) {
            changes.unitConversions = {
              old: null,
              new: normalizedSpecifications.conversions,
            };
          }
        }

        // Build changes object for audit log
        for (const [key, value] of Object.entries(updateData)) {
          if (key === "updatedAt") continue;
          const oldValue = Object.fromEntries(Object.entries(existingAsset))[
            key
          ];
          if (JSON.stringify(oldValue) !== JSON.stringify(value)) {
            changes[key] = { old: oldValue, new: value };
          }
        }

        // Update asset
        const [updatedAsset] = await db
          .update(asset)
          .set(updateData)
          .where(
            and(
              eq(asset.id, id),
              getAssetScopeCondition(member),
              isNull(asset.deletedAt),
              linkedCustomerId !== null
                ? eq(asset.customerId, linkedCustomerId)
                : undefined,
            ),
          )
          .returning();

        if (!updatedAsset) {
          return c.json({ error: "Ativo nao encontrado" }, 404);
        }

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

        return c.json(
          serializeAssetForResponse({
            ...updatedAsset,
            assetTypeDefinition: existingAsset.assetTypeDefinition,
          }),
        );
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
      const session = c.get("session");
      const member = c.get("member");
      const id = await resolveAssetRouteId(c.req.param("id"), member);

      if (id === null) {
        return c.json({ error: "ID invalido" }, 400);
      }

      try {
        const [existingAsset] = await db
          .select()
          .from(asset)
          .where(
            and(
              eq(asset.id, id),
              getAssetScopeCondition(member),
              isNull(asset.deletedAt),
            ),
          )
          .limit(1);

        if (!existingAsset) {
          return c.json({ error: "Ativo nao encontrado" }, 404);
        }

        let linkedCustomerId: number | null = null;

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

          linkedCustomerId = linkedCustomer.id;
        }

        const [deletedAsset] = await db
          .update(asset)
          .set({ deletedAt: new Date() })
          .where(
            and(
              eq(asset.id, id),
              getAssetScopeCondition(member),
              isNull(asset.deletedAt),
              linkedCustomerId !== null
                ? eq(asset.customerId, linkedCustomerId)
                : undefined,
            ),
          )
          .returning();

        if (!deletedAsset) {
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

        return c.json({ success: true });
      } catch (error) {
        console.error("Error deleting asset:", error);
        return c.json({ error: "Erro ao excluir ativo" }, 500);
      }
    },
  )

  // =========================================================================
  // GET /:id/audit-log - Get audit log for an asset (ISO 17025 Clause 8.4)
  // =========================================================================
  .get(
    "/:id/audit-log",
    ...withLabPermission({ equipment: ["read"] }),
    async (c) => {
      const member = c.get("member");
      const id = await resolveAssetRouteId(c.req.param("id"), member);

      if (id === null) {
        return c.json({ error: "ID inválido" }, 400);
      }

      try {
        // Verify asset exists (include soft-deleted for audit trail access)
        const [existingAsset] = await db
          .select({ id: asset.id, customerId: asset.customerId })
          .from(asset)
          .where(and(eq(asset.id, id), getAssetScopeCondition(member)))
          .limit(1);

        if (!existingAsset) {
          return c.json({ error: "Ativo não encontrado" }, 404);
        }

        // If user is a client_user, verify they can access this asset's audit log
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

        // Get audit logs with performer details
        const logs = await db
          .select({
            id: assetAuditLog.id,
            action: assetAuditLog.action,
            changes: assetAuditLog.changes,
            performedAt: assetAuditLog.performedAt,
            performedBy: assetAuditLog.performedBy,
            performerName: user.name,
            ipAddress: assetAuditLog.ipAddress,
            reason: assetAuditLog.reason,
          })
          .from(assetAuditLog)
          .leftJoin(user, eq(assetAuditLog.performedBy, user.id))
          .where(eq(assetAuditLog.assetId, id))
          .orderBy(desc(assetAuditLog.performedAt));

        return c.json({ data: logs });
      } catch (error) {
        console.error("Error getting asset audit log:", error);
        return c.json({ error: "Erro ao buscar histórico" }, 500);
      }
    },
  );
