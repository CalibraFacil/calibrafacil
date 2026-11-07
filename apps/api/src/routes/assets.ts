import { parseNumericRouteIdentifier } from "@calibra-facil/shared/route-identifiers";
import { slugifyRouteIdentifier } from "@calibra-facil/shared/route-identifiers";
import { Hono } from "hono";
import type {
  AssetDetail,
  AssetRecord,
  AssetsListResponse,
  ServerShape,
} from "@calibra-facil/contracts";
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
import {
  CreateAssetSchema,
  UpdateAssetSchema,
  ListAssetsQuerySchema,
  RegulatedIntervalSchema,
} from "@calibra-facil/schemas";
import type { MeasurementUnit } from "@calibra-facil/shared";
import type { OrgDb } from "@calibra-facil/db/for-org";
import { eq, ilike, or, count, and, isNull, desc } from "drizzle-orm";
import {
  withLabPermission,
  type AuthVariables,
  type MemberData,
} from "../middleware/permission";
import { buildUnitScopeCondition } from "../lib/units";
import { orgDb } from "../lib/org-db";
import { isUniqueViolation } from "../lib/db-errors";
import { deriveNextCalibrationDate } from "../lib/portal-asset-interval";
import { deriveRegulatedNextDate } from "../lib/regulated-interval";
import { resolveAssetRegimeWrite } from "../lib/asset-regime";
import {
  denormalizeAssetSpecificationsForResponse,
  normalizeAssetSpecificationsFromInput,
  resolveAssetBaseMeasurementUnit,
} from "../lib/asset-measurement";
import {
  DomainError,
  forbidden,
  invalid,
  notFound,
} from "../lib/domain-errors";
import { withOrg } from "../lib/org-context";
import { requestActor } from "../middleware/request-actor";

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
            // Validate that customer exists
            const [foundCustomer] = await ctx.o
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
              throw notFound("customer_not_found", "Cliente não encontrado");
            }

            // Validate that asset type exists
            const [foundAssetType] = await ctx.o
              .select()
              .from(assetType)
              .where(eq(assetType.id, input.assetTypeId))
              .limit(1);

            if (!foundAssetType) {
              throw notFound(
                "asset_type_not_found",
                "Tipo de instrumento não encontrado",
              );
            }

            const baseMeasurementUnitResult = resolveAssetBaseMeasurementUnit(
              foundAssetType,
              input.baseMeasurementUnit,
            );

            if (!baseMeasurementUnitResult.ok) {
              throw invalid(
                "asset_base_measurement_unit_required",
                baseMeasurementUnitResult.error,
              );
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
                  throw invalid(
                    "invalid_request",
                    `Campo obrigatório: ${field.label}`,
                  );
                }
              }
            }

            // Check if tag is unique. SEC-03a: scope to the caller's org (join
            // asset → customer) so it cannot read another tenant's assets. The
            // residual GLOBAL DB unique is caught by the outer catch below.
            const [existingAsset] = await ctx.o
              .select({ id: asset.id })
              .from(asset)
              .innerJoin(customer, eq(asset.customerId, customer.id))
              .where(
                and(
                  eq(asset.tag, input.tag),
                  eq(customer.labOrganizationId, member.organizationId),
                ),
              )
              .limit(1);

            if (existingAsset) {
              throw invalid("asset_tag_conflict", "Tag já está em uso");
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
            const normalizedSpecifications =
              normalizeAssetSpecificationsFromInput({
                specifications: input.specifications || null,
                definition: foundAssetType.definition,
                baseMeasurementUnit:
                  baseMeasurementUnitResult.baseMeasurementUnit,
              });

            // Legal-metrology regime (Track 2): the regime + the regulation-fixed verification
            // periodicity, independent of the customer-owned calibration interval (Track 1),
            // which the lab never authors. (REQ-MLR-030/031/003)
            const regimeWrite = resolveAssetRegimeWrite({
              metrologyRegime: input.metrologyRegime,
              regulatedInterval: input.regulatedInterval,
              current: {
                metrologyRegime: "INDUSTRIAL",
                regulatedInterval: null,
              },
            });
            const nextLegalVerificationDate = regimeWrite.regulatedInterval
              ? deriveRegulatedNextDate(regimeWrite.regulatedInterval, {
                  lastVerificationDate: lastCalibrationDate,
                  firstVerificationDate: lastCalibrationDate,
                  installDate: installedAt,
                }).date
              : null;

            // Create asset
            const [newAsset] = await ctx.o
              .insert(asset)
              .values({
                unitId: activeUnitId,
                customerId: input.customerId,
                // SEC-03b (#638): denormalize the lab org from the (already
                // org-scoped) customer so UNIQUE(lab_organization_id, tag) is
                // enforced per org. foundCustomer was fetched WHERE labOrganizationId
                // = member.organizationId, so this is the caller's own lab org.
                labOrganizationId: foundCustomer.labOrganizationId,
                assetTypeId: input.assetTypeId,
                name: input.name,
                manufacturer: input.manufacturer || null,
                model: input.model || null,
                serialNumber: input.serialNumber,
                tag: input.tag,
                status: input.status || "ACTIVE",
                baseMeasurementUnit:
                  baseMeasurementUnitResult.baseMeasurementUnit,
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
              throw new DomainError({
                code: "asset_create_failed",
                status: 500,
                message: "Erro ao criar ativo",
              });
            }

            // Log audit entry
            await ctx.audit("asset", newAsset.id, {
              action: "create",
              changes: {
                asset: { old: null, new: newAsset },
                unitConversions:
                  normalizedSpecifications.conversions.length > 0
                    ? normalizedSpecifications.conversions
                    : undefined,
              },
            });

            return serializeAssetForResponse({
              ...newAsset,
              assetTypeDefinition: foundAssetType.definition,
            });
          },
        );

        return c.json(created satisfies ServerShape<AssetRecord>, 201);
      } catch (error) {
        // SEC-03b: the org-scoped tag check above ran first; this catch backstops
        // a SAME-org race that slips past it and hits the per-org unique
        // (asset_lab_org_tag_uidx → 23505). A cross-org duplicate no longer
        // raises (different lab_organization_id). Map 23505 to the SAME response
        // the app check returns (never a 500).
        if (isUniqueViolation(error)) {
          throw invalid("asset_tag_conflict", "Tag já está em uso");
        }
        throw error;
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

      const offset = (page - 1) * limit;

      return await orgDb(member.organizationId).transaction(async (o) => {
        // Build conditions array - always exclude soft-deleted assets
        const conditions = [isNull(asset.deletedAt)];
        const assetScopeCondition = getAssetScopeCondition(member);
        if (assetScopeCondition) {
          conditions.push(assetScopeCondition);
        }

        // If user is a client_user, they can only see their organization's assets
        if (member.organizationType === "CLIENT") {
          // Find the customer linked to this client organization
          const [linkedCustomer] = await o
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

        // Get total count for pagination
        const countResult = await o
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
        } satisfies ServerShape<AssetsListResponse>);
      });
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
  )

  // =========================================================================
  // GET /:id - Get asset by ID
  // =========================================================================
  .get("/:id", ...withLabPermission({ equipment: ["read"] }), async (c) => {
    const member = c.get("member");
    const id = await requireAssetId(c.req.param("id"), member, "ID inválido");

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

      // If user is a client_user, verify they can access this asset
      await requireClientCustomerLink(o, member, foundAsset.customerId);

      return c.json(
        serializeAssetForResponse(
          foundAsset,
        ) satisfies ServerShape<AssetDetail>,
      );
    });
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
      const member = c.get("member");
      const id = await requireAssetId(c.req.param("id"), member, "ID invalido");

      try {
        const updated = await withOrg(
          member.organizationId,
          requestActor(c),
          async (ctx) => {
            // Get existing asset (exclude soft-deleted)
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

            // If user is a client_user, verify they can update this asset
            const linkedCustomerId = await requireClientCustomerLink(
              ctx.o,
              member,
              existingAsset.customerId,
            );

            // Check if tag is being changed and if it's unique. SEC-03a: scope to
            // the caller's org (join asset → customer) so it cannot read another
            // tenant's assets. The residual GLOBAL DB unique is caught by the outer
            // catch below.
            if (input.tag && input.tag !== existingAsset.tag) {
              const [duplicateTag] = await ctx.o
                .select({ id: asset.id })
                .from(asset)
                .innerJoin(customer, eq(asset.customerId, customer.id))
                .where(
                  and(
                    eq(asset.tag, input.tag),
                    eq(customer.labOrganizationId, member.organizationId),
                  ),
                )
                .limit(1);

              if (duplicateTag) {
                throw invalid("asset_tag_conflict", "Tag ja esta em uso");
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
            if (input.model !== undefined)
              updateData.model = input.model || null;
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
            // the regulated interval, the install anchor (a standalone installed_at change
            // must re-derive next_legal_verification_date for an install-anchored LEGAL asset),
            // OR the last-calibration date (the stored proxy for the last-verification anchor —
            // without this, an anchor-based regulated date goes stale after a verification is
            // recorded and the recall sweep keeps re-reminding).
            // Independent of Track 1 (the customer-owned calibration interval).
            // (REQ-MLR-030/031/032 + REQ-INSTALL-002)
            if (
              input.metrologyRegime !== undefined ||
              input.regulatedInterval !== undefined ||
              installedAt !== undefined ||
              lastCalibrationDate !== undefined
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
              updateData.nextLegalVerificationDate =
                regimeWrite.regulatedInterval
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
              const oldValue = Object.fromEntries(
                Object.entries(existingAsset),
              )[key];
              if (JSON.stringify(oldValue) !== JSON.stringify(value)) {
                changes[key] = { old: oldValue, new: value };
              }
            }

            // Update asset
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

            // Log audit entry if there were changes
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

        return c.json(updated);
      } catch (error) {
        // SEC-03b: the org-scoped tag check above ran first; this catch backstops
        // a SAME-org race that hits the per-org unique (asset_lab_org_tag_uidx →
        // 23505). A cross-org duplicate no longer raises (different
        // lab_organization_id). Map 23505 to the SAME response the app check
        // returns (never a 500).
        if (isUniqueViolation(error)) {
          throw invalid("asset_tag_conflict", "Tag ja esta em uso");
        }
        throw error;
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

        const [deletedAsset] = await ctx.o
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
          throw notFound("asset_not_found", "Ativo nao encontrado");
        }

        // TODO: Check for active calibrations before deleting

        // Log audit entry before deletion
        await ctx.audit("asset", id, {
          action: "delete",
          changes: { asset: { old: existingAsset, new: null } },
        });
      });

      return c.json({ success: true });
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
      const id = await requireAssetId(c.req.param("id"), member, "ID inválido");

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

        // If user is a client_user, verify they can access this asset's audit log
        await requireClientCustomerLink(o, member, existingAsset.customerId);

        // Get audit logs with performer details
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

        return c.json({ data: logs });
      });
    },
  );
