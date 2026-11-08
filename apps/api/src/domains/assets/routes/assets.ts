import { createRouter } from "../../../server/router";
import {
  parseNumericRouteIdentifier,
  slugifyRouteIdentifier,
} from "@calibra-facil/shared/route-identifiers";
import { assetEndpoints } from "@calibra-facil/contracts";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  asset,
  assetAuditLog,
  customer,
  assetType,
  user,
  type AssetTypeFieldDefinition,
} from "@calibra-facil/db/schema";
import type { MeasurementUnit } from "@calibra-facil/shared";
import type { OrgDb } from "@calibra-facil/db/for-org";
import { eq, ilike, or, count, and, isNull, desc } from "drizzle-orm";
import {
  withLabPermission,
  type AuthVariables,
  type MemberData,
} from "../../../middleware/permission";
import { buildUnitScopeCondition } from "../../../lib/units";
import { mount } from "../../../lib/endpoint-mount";
import { orgDb } from "../../../lib/org-db";
import { isUniqueViolation } from "../../../lib/db-errors";
import { deriveNextCalibrationDate } from "../portal-asset-interval";
import {
  denormalizeAssetSpecificationsForResponse,
  normalizeAssetSpecificationsFromInput,
} from "../asset-measurement";
import { forbidden, invalid, notFound } from "../../../lib/domain-errors";
import {
  assertAssetTagFree,
  createLabAsset,
  deleteLabAsset,
  planAssetRegimeUpdate,
} from "../asset-writes";
import { withOrg } from "../../../lib/org-context";
import { requestActor } from "../../../middleware/request-actor";
import { toRecord } from "@calibra-facil/shared/record";

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
  return orgDb(member.organizationId).transaction(async (o) => {
    const legacyId = parseNumericRouteIdentifier(identifier);
    const directConditions = [
      eq(asset.tag, identifier),
      eq(asset.serialNumber, identifier),
    ];

    if (legacyId !== null) {
      directConditions.unshift(eq(asset.id, legacyId));
    }

    const [directMatch] = await o
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

    const scopedAssets = await o
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
  });
}

/** A route parameter's asset id; throws 400 (with the route's own message) when no asset matches. */
async function requireAssetId(
  identifier: string,
  member: MemberData,
  message: string,
): Promise<number> {
  const id = await resolveAssetRouteId(identifier, member);
  if (id === null) throw invalid("invalid_request", message);
  return id;
}

/**
 * A client-organization caller may only touch the asset of the customer linked
 * to its organization (403 otherwise). Returns that customer's id, or null for
 * a laboratory caller.
 */
async function requireClientCustomerLink(
  o: Pick<OrgDb, "select">,
  member: MemberData,
  assetCustomerId: number,
): Promise<number | null> {
  if (member.organizationType !== "CLIENT") return null;
  const [linkedCustomer] = await o
    .select({ id: customer.id })
    .from(customer)
    .where(eq(customer.authOrganizationId, member.organizationId))
    .limit(1);
  if (!linkedCustomer || linkedCustomer.id !== assetCustomerId) {
    throw forbidden("forbidden", "Acesso negado");
  }
  return linkedCustomer.id;
}

const PREFIX = "/api/assets";

export const assetsRouter = createRouter<{ Variables: AuthVariables }>();

mount(
  assetsRouter,
  PREFIX,
  assetEndpoints.create,
  async (c, { body: input }) => {
    const member = c.get("member");

    if (!member.activeUnitId) {
      throw invalid(
        "invalid_request",
        "Selecione uma unidade específica para criar ativos",
      );
    }

    const { activeUnitId } = member;

    try {
      const created = await withOrg(
        member.organizationId,
        requestActor(c),
        async (ctx) => {
          const { created: newAsset, assetType: foundAssetType } =
            await createLabAsset(ctx, input, {
              resolveUnitId: async () => activeUnitId,
              enforceRequiredSpecifications: true,
            });
          return serializeAssetForResponse({
            ...newAsset,
            assetTypeDefinition: foundAssetType.definition,
          });
        },
      );

      return created;
    } catch (error) {
      // The org-scoped tag check ran first; this catch backstops
      // a SAME-org race that slips past it and hits the per-org unique
      // (asset_lab_org_tag_uidx → 23505). Map 23505 to the SAME response
      // the app check returns (never a 500).
      if (isUniqueViolation(error)) {
        throw invalid("asset_tag_conflict", "Tag já está em uso");
      }
      throw error;
    }
  },
);

// Command palette search: not part of the SDK, so a plain route.
assetsRouter.get(
  "/search",
  ...withLabPermission({ equipment: ["read"] }),
  zValidator("query", CommandPaletteAssetSearchQuerySchema),
  async (c) => {
    const member = c.get("member");
    const { query, limit } = c.req.valid("query");

    const results = await orgDb(member.organizationId).transaction((o) =>
      o
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
        .limit(limit),
    );

    return c.json(results);
  },
);

mount(
  assetsRouter,
  PREFIX,
  assetEndpoints.list,
  async (
    c,
    { query: { page, limit, customerId, assetTypeId, status, query } },
  ) => {
    const member = c.get("member");

    const offset = (page - 1) * limit;

    return await orgDb(member.organizationId).transaction(async (o) => {
      const conditions = [isNull(asset.deletedAt)];
      const assetScopeCondition = getAssetScopeCondition(member);
      if (assetScopeCondition) {
        conditions.push(assetScopeCondition);
      }

      if (member.organizationType === "CLIENT") {
        const [linkedCustomer] = await o
          .select()
          .from(customer)
          .where(eq(customer.authOrganizationId, member.organizationId))
          .limit(1);

        if (!linkedCustomer) {
          return {
            data: [],
            pagination: { page, limit, total: 0, totalPages: 0 },
          };
        }

        conditions.push(eq(asset.customerId, linkedCustomer.id));
      } else if (customerId) {
        conditions.push(eq(asset.customerId, customerId));
      }

      if (assetTypeId) {
        conditions.push(eq(asset.assetTypeId, assetTypeId));
      }

      if (status) {
        conditions.push(eq(asset.status, status));
      }

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

      const assets = await o
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

      const countResult = await o
        .select({ total: count() })
        .from(asset)
        .innerJoin(customer, eq(asset.customerId, customer.id))
        .innerJoin(assetType, eq(asset.assetTypeId, assetType.id))
        .where(whereCondition);

      const total = countResult[0]?.total ?? 0;

      return {
        data: assets.map((item) => serializeAssetForResponse(item)),
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

// Not client-facing (nothing in the frontends calls it), so a plain route.
assetsRouter.get(
  "/:id/label",
  ...withLabPermission({ equipment: ["read"] }),
  async (c) => {
    const member = c.get("member");
    const id = await requireAssetId(c.req.param("id"), member, "ID inválido");

    return await orgDb(member.organizationId).transaction(async (o) => {
      const [foundAsset] = await o
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
        throw notFound("asset_not_found", "Ativo não encontrado");
      }

      await requireClientCustomerLink(o, member, foundAsset.customerId);

      return c.json({
        id: foundAsset.id,
        label: foundAsset.label,
      });
    });
  },
);

mount(assetsRouter, PREFIX, assetEndpoints.get, async (c, { params }) => {
  const member = c.get("member");
  const id = await requireAssetId(params.id, member, "ID inválido");

  return await orgDb(member.organizationId).transaction(async (o) => {
    const [foundAsset] = await o
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
      throw notFound("asset_not_found", "Ativo não encontrado");
    }

    await requireClientCustomerLink(o, member, foundAsset.customerId);

    return serializeAssetForResponse(foundAsset);
  });
});

mount(
  assetsRouter,
  PREFIX,
  assetEndpoints.update,
  async (c, { params, body: input }) => {
    const member = c.get("member");
    const id = await requireAssetId(params.id, member, "ID invalido");

    try {
      const updated = await withOrg(
        member.organizationId,
        requestActor(c),
        async (ctx) => {
          const [existingAsset] = await ctx.o
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
            throw notFound("asset_not_found", "Ativo nao encontrado");
          }

          const linkedCustomerId = await requireClientCustomerLink(
            ctx.o,
            member,
            existingAsset.customerId,
          );

          // Check if tag is being changed and if it's unique (the residual
          // 23505 is caught by the outer catch below).
          if (input.tag && input.tag !== existingAsset.tag) {
            await assertAssetTagFree(
              ctx.o,
              member.organizationId,
              input.tag,
              "Tag ja esta em uso",
            );
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
          // Legal-metrology regime (Track 2): recomputed when the client touches
          // the regime, the regulated interval, the install anchor or the
          // last-calibration date (planAssetRegimeUpdate).
          const regimeUpdate = planAssetRegimeUpdate(existingAsset, {
            metrologyRegime: input.metrologyRegime,
            regulatedInterval: input.regulatedInterval,
            lastCalibrationDate,
            installedAt,
          });
          if (regimeUpdate) {
            updateData.metrologyRegime = regimeUpdate.metrologyRegime;
            updateData.regulatedInterval = regimeUpdate.regulatedInterval;
            updateData.nextLegalVerificationDate =
              regimeUpdate.nextLegalVerificationDate;
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

          const existingValues = toRecord(existingAsset);
          for (const [key, value] of Object.entries(updateData)) {
            if (key === "updatedAt") continue;
            const oldValue = existingValues[key];
            if (JSON.stringify(oldValue) !== JSON.stringify(value)) {
              changes[key] = { old: oldValue, new: value };
            }
          }

          const [updatedAsset] = await ctx.o
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
            throw notFound("asset_not_found", "Ativo nao encontrado");
          }

          if (Object.keys(changes).length > 0) {
            const isStatusChange = "status" in changes;
            await ctx.audit("asset", id, {
              action: isStatusChange ? "status_change" : "update",
              changes,
            });
          }

          return serializeAssetForResponse({
            ...updatedAsset,
            assetTypeDefinition: existingAsset.assetTypeDefinition,
          });
        },
      );

      return updated;
    } catch (error) {
      // The org-scoped tag check above ran first; this catch backstops
      // a SAME-org race that hits the per-org unique (asset_lab_org_tag_uidx →
      // 23505). Map 23505 to the SAME response the app check
      // returns (never a 500).
      if (isUniqueViolation(error)) {
        throw invalid("asset_tag_conflict", "Tag ja esta em uso");
      }
      throw error;
    }
  },
);

// Not client-facing (the SDK does not delete assets), so a plain route.
assetsRouter.delete(
  "/:id",
  ...withLabPermission({ equipment: ["delete"] }),
  async (c) => {
    const member = c.get("member");
    const id = await requireAssetId(c.req.param("id"), member, "ID invalido");

    await withOrg(member.organizationId, requestActor(c), async (ctx) => {
      const [existingAsset] = await ctx.o
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
        throw notFound("asset_not_found", "Ativo nao encontrado");
      }

      const linkedCustomerId = await requireClientCustomerLink(
        ctx.o,
        member,
        existingAsset.customerId,
      );

      await deleteLabAsset(
        ctx,
        existingAsset,
        and(
          getAssetScopeCondition(member),
          linkedCustomerId !== null
            ? eq(asset.customerId, linkedCustomerId)
            : undefined,
        ),
      );
    });

    return c.json({ success: true });
  },
);

mount(assetsRouter, PREFIX, assetEndpoints.auditLog, async (c, { params }) => {
  const member = c.get("member");
  const id = await requireAssetId(params.id, member, "ID inválido");

  return await orgDb(member.organizationId).transaction(async (o) => {
    // Verify asset exists (include soft-deleted for audit trail access)
    const [existingAsset] = await o
      .select({ id: asset.id, customerId: asset.customerId })
      .from(asset)
      .where(and(eq(asset.id, id), getAssetScopeCondition(member)))
      .limit(1);

    if (!existingAsset) {
      throw notFound("asset_not_found", "Ativo não encontrado");
    }

    await requireClientCustomerLink(o, member, existingAsset.customerId);

    const logs = await o
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

    return { data: logs };
  });
});
