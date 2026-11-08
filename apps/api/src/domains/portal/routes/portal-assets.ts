// The portal's instruments: list, detail, interval insight and setting, drift series.

import { createRouter } from "../../../server/router";
import { mount } from "../../../lib/endpoint-mount";
import { requirePortalLabScope } from "../portal-lab-scope";
import {
  organization,
  customer,
  calibrationJob,
  asset,
  assetType,
  service,
} from "@calibra-facil/db/schema";
import {
  portalAssetEndpoints,
  type PortalIntervalUpdateResponse,
  type ServerShape,
} from "@calibra-facil/contracts";
import {
  eq,
  ne,
  and,
  inArray,
  asc,
  desc,
  count,
  isNull,
  ilike,
  or,
  sql,
} from "drizzle-orm";
import {
  requirePermission,
  requirePortalProtected,
  type AuthVariables,
} from "../../../middleware/permission";
import { type R2Env } from "../../../lib/storage";
import {
  denormalizeAssetSpecificationsForResponse,
  decidePortalIntervalWrite,
  deriveNextCalibrationDate,
  buildIntervalInsight,
  assetInLab,
  fleetDueStatusCondition,
} from "../../assets";
import { applyPortalCertificateReleaseGate } from "../portal-certificate-release-gate";
import { buildAssetDriftSeries } from "../portal-fleet-reliability";
import { renderIntervalReportHtml } from "@calibra-facil/documents";
import { DEFAULT_INTERVAL_CONFIG } from "@calibra-facil/interval-analysis";
import {
  applyUnitFilter,
  resolvePortalCustomerScope,
} from "../portal-customer-scope";
import { orgDb } from "../../../lib/org-db";
import { notFound } from "../../../lib/domain-errors";
import { withOrg } from "../../../lib/org-context";
import { requestActor } from "../../../middleware/request-actor";
import type { OrgDb } from "@calibra-facil/db/for-org";

// The portal routes assets by the opaque `publicId` (uuid) so URLs never
// expose the enumerable serial id; plain numeric params stay accepted so
// pre-existing links and integrations keep working. Resolves to the internal
// serial id or null when the param matches nothing. Scope checks still happen
// downstream — this only translates the identifier.
async function resolvePortalAssetIdParam(
  o: Pick<OrgDb, "select">,
  param: string,
): Promise<number | null> {
  if (/^\d+$/.test(param)) {
    const id = Number.parseInt(param, 10);
    return Number.isNaN(id) ? null : id;
  }
  const [row] = await o
    .select({ id: asset.id })
    .from(asset)
    .where(eq(asset.publicId, param))
    .limit(1);
  return row?.id ?? null;
}

/**
 * Portal routes - endpoints specific to the client portal.
 * These routes handle client-facing functionality.
 * Uses Portal auth (portal_session cookie) for authentication.
 */
const PREFIX = "/api/portal";

export const portalAssetsRouter = createRouter<{
  Variables: AuthVariables;
  Bindings: R2Env;
}>();

mount(
  portalAssetsRouter,
  PREFIX,
  portalAssetEndpoints.list,
  [...requirePortalProtected, requirePermission({ equipment: ["read"] })],
  async (c, { query: filters }) => {
    const member = c.get("member");
    const portalLabScope = await requirePortalLabScope(c);

    const { page, limit, query, dueStatus, sortBy, sortDir, ids, unitId } =
      filters;
    const offset = (page - 1) * limit;

    const scope = await resolvePortalCustomerScope({
      activeOrgId: member.organizationId,
      labScope: portalLabScope,
    });

    if (!scope) {
      return {
        data: [],
        pagination: { page, limit, total: 0, totalPages: 0 },
      };
    }

    const customerIds = applyUnitFilter(scope, unitId);
    if (customerIds.length === 0) {
      return {
        data: [],
        pagination: { page, limit, total: 0, totalPages: 0 },
      };
    }

    return await orgDb(scope.labOrganizationId).transaction(async (o) => {
      const whereCondition = and(
        inArray(asset.customerId, customerIds),
        eq(asset.status, "ACTIVE"),
        isNull(asset.deletedAt),
        ids && ids.length > 0 ? inArray(asset.id, ids) : undefined,
        query
          ? or(
              ilike(asset.name, `%${query}%`),
              ilike(asset.tag, `%${query}%`),
              ilike(asset.serialNumber, `%${query}%`),
              ilike(asset.manufacturer, `%${query}%`),
              ilike(asset.model, `%${query}%`),
            )
          : undefined,
        fleetDueStatusCondition(dueStatus, o),
      );

      const [countResult] = await o
        .select({ total: count() })
        .from(asset)
        .where(whereCondition);

      const sortColumn = {
        tag: asset.tag,
        name: asset.name,
        nextCalibrationDate: asset.nextCalibrationDate,
        lastCalibrationDate: asset.lastCalibrationDate,
      }[sortBy];
      // "nulls last" so unscheduled instruments don't lead a desc date sort;
      // tie-break on tag for a stable page order.
      const primaryOrder =
        sortDir === "desc"
          ? sql`${sortColumn} desc nulls last`
          : sql`${sortColumn} asc nulls last`;

      const assets = await o
        .select({
          id: asset.id,
          publicId: asset.publicId,
          customerId: asset.customerId,
          customerName: customer.name,
          assetTypeId: asset.assetTypeId,
          assetTypeName: sql<string>`coalesce(${assetType.name}, 'Sem tipo')`,
          assetTypeSlug: sql<string>`coalesce(${assetType.slug}, 'sem-tipo')`,
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
          inLab: assetInLab(o),
          comments: asset.comments,
          createdAt: asset.createdAt,
          updatedAt: asset.updatedAt,
        })
        .from(asset)
        .innerJoin(customer, eq(asset.customerId, customer.id))
        .leftJoin(assetType, eq(asset.assetTypeId, assetType.id))
        .where(whereCondition)
        .orderBy(primaryOrder, asc(asset.tag))
        .limit(limit)
        .offset(offset);

      // Latest approved certificate per instrument on this page, one query.
      const assetIds = assets.map((assetItem) => assetItem.id);
      const lastCertificateByAssetId = new Map<
        number,
        { id: number; jobId: string; approvedAt: string | Date | null }
      >();
      if (assetIds.length > 0) {
        const lastCertificates = await o
          .selectDistinctOn([calibrationJob.assetId], {
            assetId: calibrationJob.assetId,
            id: calibrationJob.id,
            jobId: calibrationJob.jobId,
            approvedAt: calibrationJob.approvedAt,
          })
          .from(calibrationJob)
          .where(
            and(
              inArray(calibrationJob.assetId, assetIds),
              inArray(calibrationJob.customerId, customerIds),
              eq(calibrationJob.status, "APPROVED"),
            ),
          )
          .orderBy(calibrationJob.assetId, desc(calibrationJob.approvedAt));

        for (const certificate of lastCertificates) {
          lastCertificateByAssetId.set(certificate.assetId, {
            id: certificate.id,
            jobId: certificate.jobId,
            approvedAt: certificate.approvedAt,
          });
        }
      }

      return {
        data: assets.map((assetItem) => ({
          ...assetItem,
          specifications:
            denormalizeAssetSpecificationsForResponse({
              specifications: assetItem.specifications,
              definition: assetItem.assetTypeDefinition,
              baseMeasurementUnit: assetItem.baseMeasurementUnit,
            }) ?? null,
          lastCertificate: lastCertificateByAssetId.get(assetItem.id) ?? null,
        })),
        pagination: {
          page,
          limit,
          total: countResult?.total ?? 0,
          totalPages: Math.ceil((countResult?.total ?? 0) / limit),
        },
      };
    });
  },
);

mount(
  portalAssetsRouter,
  PREFIX,
  portalAssetEndpoints.get,
  [...requirePortalProtected, requirePermission({ equipment: ["read"] })],
  async (c, { params }) => {
    const portalMember = c.get("member");
    const portalLabScope = await requirePortalLabScope(c);
    const scope = await resolvePortalCustomerScope({
      activeOrgId: portalMember.organizationId,
      labScope: portalLabScope,
    });

    if (!scope || scope.customerIds.length === 0) {
      throw notFound("asset_not_found", "Ativo nao encontrado");
    }
    return await orgDb(scope.labOrganizationId).transaction(async (o) => {
      const id = await resolvePortalAssetIdParam(o, params.id);
      if (id === null) {
        throw notFound("asset_not_found", "Ativo nao encontrado");
      }
      const { customerIds } = scope;

      const [assetDetails] = await o
        .select({
          id: asset.id,
          publicId: asset.publicId,
          customerId: asset.customerId,
          customerName: customer.name,
          assetTypeId: asset.assetTypeId,
          assetTypeName: sql<string>`coalesce(${assetType.name}, 'Sem tipo')`,
          assetTypeSlug: sql<string>`coalesce(${assetType.slug}, 'sem-tipo')`,
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
          // Customer-owned calibration interval (§7.8.4.3 + ILAC-G24): the
          // periodicity the customer sets/owns in the portal (for EVERY regime).
          calibrationIntervalMonths: asset.calibrationIntervalMonths,
          intervalSetBy: asset.intervalSetBy,
          // Legal-metrology regime + the regulation-fixed verification
          // periodicity (independent of the customer-owned interval; lab-recorded, read-only for the customer).
          metrologyRegime: asset.metrologyRegime,
          regulatedInterval: asset.regulatedInterval,
          nextLegalVerificationDate: asset.nextLegalVerificationDate,
          inLab: assetInLab(o),
          comments: asset.comments,
          createdAt: asset.createdAt,
          updatedAt: asset.updatedAt,
        })
        .from(asset)
        .innerJoin(customer, eq(asset.customerId, customer.id))
        .leftJoin(assetType, eq(asset.assetTypeId, assetType.id))
        .where(
          and(
            eq(asset.id, id),
            inArray(asset.customerId, customerIds),
            isNull(asset.deletedAt),
          ),
        )
        .limit(1);

      if (!assetDetails) {
        throw notFound("asset_not_found", "Ativo nao encontrado");
      }

      const assetCertificateWhere = and(
        eq(calibrationJob.assetId, assetDetails.id),
        inArray(calibrationJob.customerId, customerIds),
        eq(calibrationJob.status, "APPROVED"),
      );

      const [certificateCountResult] = await o
        .select({ total: count() })
        .from(calibrationJob)
        .where(assetCertificateWhere);

      const certificatesRaw = await o
        .select({
          id: calibrationJob.id,
          jobId: calibrationJob.jobId,
          certificateName: calibrationJob.certificateName,
          status: calibrationJob.status,
          performedAt: calibrationJob.performedAt,
          approvedAt: calibrationJob.approvedAt,
          certificateUrl: calibrationJob.certificateUrl,
          verificationToken: calibrationJob.verificationToken,
          serviceName: service.name,
          labName: organization.name,
        })
        .from(calibrationJob)
        .innerJoin(service, eq(calibrationJob.serviceId, service.id))
        .innerJoin(
          organization,
          eq(calibrationJob.organizationId, organization.id),
        )
        .where(assetCertificateWhere)
        .orderBy(desc(calibrationJob.approvedAt))
        .limit(5);

      // Hide certificateUrl for held releases.
      const certificates = await applyPortalCertificateReleaseGate(
        certificatesRaw,
        scope.labOrganizationId,
      );

      return {
        data: {
          ...assetDetails,
          specifications:
            denormalizeAssetSpecificationsForResponse({
              specifications: assetDetails.specifications,
              definition: assetDetails.assetTypeDefinition,
              baseMeasurementUnit: assetDetails.baseMeasurementUnit,
            }) ?? null,
          certificates,
          certificateCount: certificateCountResult?.total ?? 0,
        },
      };
    });
  },
);

// =========================================================================
// PUT /notification-preferences - Update digest opt-in
// =========================================================================
// =========================================================================
// GET /assets/:id/interval-insight - reliability-based suggestion (read-only)
// =========================================================================
// Computes the ILAC-G24 / NCSL RP-1 classification + suggestion from the asset's
// approved as-found history. Tenant-scoped. Regime-agnostic (REQ-MLR-050): a
// legal-metrology asset is analyzed like any other — there is NO LEGAL_FIXED
// suppression; its mandatory legal-verification periodicity is a separate,
// independent Track-2. This NEVER writes — the customer applies via PUT.
// =========================================================================
mount(
  portalAssetsRouter,
  PREFIX,
  portalAssetEndpoints.intervalInsight,
  [...requirePortalProtected, requirePermission({ equipment: ["read"] })],
  async (c, { params }) => {
    const portalMember = c.get("member");
    const portalLabScope = await requirePortalLabScope(c);

    const scope = await resolvePortalCustomerScope({
      activeOrgId: portalMember.organizationId,
      labScope: portalLabScope,
    });
    if (!scope || scope.customerIds.length === 0) {
      throw notFound("asset_not_found", "Ativo nao encontrado");
    }
    return await orgDb(scope.labOrganizationId).transaction(async (o) => {
      const id = await resolvePortalAssetIdParam(o, params.id);
      if (id === null) {
        throw notFound("asset_not_found", "Ativo nao encontrado");
      }
      const { customerIds } = scope;

      const [existing] = await o
        .select({
          assetTypeId: asset.assetTypeId,
          model: asset.model,
          calibrationIntervalMonths: asset.calibrationIntervalMonths,
        })
        .from(asset)
        .where(
          and(
            eq(asset.id, id),
            inArray(asset.customerId, customerIds),
            isNull(asset.deletedAt),
          ),
        )
        .limit(1);

      if (!existing) {
        throw notFound("asset_not_found", "Ativo nao encontrado");
      }

      const rows = await o
        .select({
          approvedAt: calibrationJob.approvedAt,
          asFoundConformity: calibrationJob.asFoundConformity,
          asFoundMargins: calibrationJob.asFoundMargins,
        })
        .from(calibrationJob)
        .where(
          and(
            eq(calibrationJob.assetId, id),
            inArray(calibrationJob.customerId, customerIds),
            eq(calibrationJob.status, "APPROVED"),
          ),
        )
        .orderBy(asc(calibrationJob.approvedAt));

      // Family borrow-strength (REQ-ENGINE-FAMILY-001): only when this unit's own
      // history is thin and it has a model to pool by; same assetType+model,
      // tenant-scoped, excluding legal-metrology siblings.
      const singleKnown = rows.filter(
        (r) =>
          r.asFoundConformity === "CONFORMING" ||
          r.asFoundConformity === "NON_CONFORMING",
      ).length;
      // Fetch the family whenever the unit itself would be INSUFFICIENT — matching the
      // engine's gate (too few KNOWN cycles OR too little coverage). The family pool is
      // tenant-scoped, same assetType+model, excludes legal-metrology + soft-deleted.
      const singleCoverageLow =
        rows.length > 0 &&
        singleKnown / rows.length < DEFAULT_INTERVAL_CONFIG.minCoverage;
      const familyModel = existing.model;
      const familyRows =
        (singleKnown < DEFAULT_INTERVAL_CONFIG.minKnownCycles ||
          singleCoverageLow) &&
        familyModel !== null
          ? await o
              .select({
                assetId: calibrationJob.assetId,
                approvedAt: calibrationJob.approvedAt,
                asFoundConformity: calibrationJob.asFoundConformity,
              })
              .from(calibrationJob)
              .innerJoin(asset, eq(calibrationJob.assetId, asset.id))
              .where(
                and(
                  eq(asset.assetTypeId, existing.assetTypeId),
                  eq(asset.model, familyModel),
                  ne(asset.metrologyRegime, "LEGAL"),
                  isNull(asset.deletedAt),
                  inArray(calibrationJob.customerId, customerIds),
                  eq(calibrationJob.status, "APPROVED"),
                ),
              )
          : [];

      const insight = buildIntervalInsight({
        rows,
        currentIntervalMonths: existing.calibrationIntervalMonths,
        familyRows,
      });
      return insight;
    });
  },
);

// =========================================================================
// GET /assets/:id/interval-insight/report - printable HTML report
// =========================================================================
// Self-contained, print-optimized HTML of the reliability analysis the customer
// can save as a PDF. Explicitly NOT a calibration certificate (§7.8.4.3 disclaimer);
// never rendered through the certificate path. Tenant-scoped, read-only.
// =========================================================================
portalAssetsRouter.get(
  "/assets/:id/interval-insight/report",
  ...requirePortalProtected,
  requirePermission({ equipment: ["read"] }),
  async (c) => {
    const portalMember = c.get("member");
    const portalLabScope = await requirePortalLabScope(c);
    const scope = await resolvePortalCustomerScope({
      activeOrgId: portalMember.organizationId,
      labScope: portalLabScope,
    });
    if (!scope || scope.customerIds.length === 0) {
      throw notFound("asset_not_found", "Ativo nao encontrado");
    }
    return await orgDb(scope.labOrganizationId).transaction(async (o) => {
      const id = await resolvePortalAssetIdParam(o, c.req.param("id"));
      if (id === null) {
        throw notFound("asset_not_found", "Ativo nao encontrado");
      }
      const { customerIds } = scope;

      const [existing] = await o
        .select({
          name: asset.name,
          tag: asset.tag,
          serialNumber: asset.serialNumber,
          customerName: customer.name,
          assetTypeId: asset.assetTypeId,
          model: asset.model,
          calibrationIntervalMonths: asset.calibrationIntervalMonths,
        })
        .from(asset)
        .innerJoin(customer, eq(asset.customerId, customer.id))
        .where(
          and(
            eq(asset.id, id),
            inArray(asset.customerId, customerIds),
            isNull(asset.deletedAt),
          ),
        )
        .limit(1);

      if (!existing) {
        throw notFound("asset_not_found", "Ativo nao encontrado");
      }

      const rows = await o
        .select({
          approvedAt: calibrationJob.approvedAt,
          asFoundConformity: calibrationJob.asFoundConformity,
          asFoundMargins: calibrationJob.asFoundMargins,
        })
        .from(calibrationJob)
        .where(
          and(
            eq(calibrationJob.assetId, id),
            inArray(calibrationJob.customerId, customerIds),
            eq(calibrationJob.status, "APPROVED"),
          ),
        )
        .orderBy(asc(calibrationJob.approvedAt));

      const singleKnown = rows.filter(
        (r) =>
          r.asFoundConformity === "CONFORMING" ||
          r.asFoundConformity === "NON_CONFORMING",
      ).length;
      // Fetch the family whenever the unit itself would be INSUFFICIENT — matching the
      // engine's gate (too few KNOWN cycles OR too little coverage). The family pool is
      // tenant-scoped, same assetType+model, excludes legal-metrology + soft-deleted.
      const singleCoverageLow =
        rows.length > 0 &&
        singleKnown / rows.length < DEFAULT_INTERVAL_CONFIG.minCoverage;
      const familyModel = existing.model;
      const familyRows =
        (singleKnown < DEFAULT_INTERVAL_CONFIG.minKnownCycles ||
          singleCoverageLow) &&
        familyModel !== null
          ? await o
              .select({
                assetId: calibrationJob.assetId,
                approvedAt: calibrationJob.approvedAt,
                asFoundConformity: calibrationJob.asFoundConformity,
              })
              .from(calibrationJob)
              .innerJoin(asset, eq(calibrationJob.assetId, asset.id))
              .where(
                and(
                  eq(asset.assetTypeId, existing.assetTypeId),
                  eq(asset.model, familyModel),
                  ne(asset.metrologyRegime, "LEGAL"),
                  isNull(asset.deletedAt),
                  inArray(calibrationJob.customerId, customerIds),
                  eq(calibrationJob.status, "APPROVED"),
                ),
              )
          : [];

      const insight = buildIntervalInsight({
        rows,
        currentIntervalMonths: existing.calibrationIntervalMonths,
        familyRows,
      });

      const html = renderIntervalReportHtml({
        assetName: existing.name,
        assetTag: existing.tag,
        serialNumber: existing.serialNumber,
        customerName: existing.customerName,
        classification: insight.classification,
        reliability: insight.reliability,
        coverage: insight.coverage,
        currentIntervalMonths: existing.calibrationIntervalMonths,
        recommendation: insight.recommendation,
        generatedAtIso: new Date().toISOString(),
      });
      return c.html(html);
    });
  },
);

// =========================================================================
// PUT /assets/:id/interval - Customer sets their OWN calibration interval
// =========================================================================
// The interval/periodicity is the equipment owner's decision, never the lab's
// (ISO/IEC 17025:2017 §7.8.4.3 + ILAC-G24 / OIML D 10). Tenant scope (404) is
// decided by the pure, unit-tested resolver `decidePortalIntervalWrite` — the
// ONLY guard: the customer owns the calibration interval for every regime
// (REQ-MLR-040/041; a legal instrument's regulation-fixed VERIFICATION
// periodicity is a separate, lab-recorded track). `rationale` is the required
// §7.5 technical record, persisted on the asset and the audit log.
// `next_calibration_date` is derived from the asset's last-calibration date +
// the chosen interval.
// =========================================================================
mount(
  portalAssetsRouter,
  PREFIX,
  portalAssetEndpoints.setInterval,
  [...requirePortalProtected, requirePermission({ equipment: ["update"] })],
  async (c, { params, body }) => {
    const session = c.get("session");
    const portalMember = c.get("member");
    const portalLabScope = await requirePortalLabScope(c);

    const { intervalMonths, rationale, source } = body;
    // REQ-ENGINE-APPLY-001: applying an engine suggestion records `engine_applied`.
    const intervalSetBy =
      source === "engine" ? "engine_applied" : "customer_confirmed";

    const scope = await resolvePortalCustomerScope({
      activeOrgId: portalMember.organizationId,
      labScope: portalLabScope,
    });
    if (!scope) {
      throw notFound("asset_not_found", "Ativo nao encontrado");
    }
    const scopedCustomerIds = scope.customerIds;
    const result = await withOrg(
      scope.labOrganizationId,
      requestActor(c),
      async (ctx) => {
        const id = await resolvePortalAssetIdParam(ctx.o, params.id);
        if (id === null) {
          throw notFound("asset_not_found", "Ativo nao encontrado");
        }

        const [existing] = await ctx.o
          .select({
            id: asset.id,
            labOrganizationId: asset.labOrganizationId,
            customerId: asset.customerId,
            lastCalibrationDate: asset.lastCalibrationDate,
            calibrationIntervalMonths: asset.calibrationIntervalMonths,
            nextCalibrationDate: asset.nextCalibrationDate,
          })
          .from(asset)
          .where(and(eq(asset.id, id), isNull(asset.deletedAt)))
          .limit(1);

        const decision = decidePortalIntervalWrite({
          asset: existing ?? null,
          scopedCustomerIds,
        });

        // REQ-MLR-040/041: the only guard is tenant scope (404). The customer owns the
        // calibration interval for every regime — a legal asset is NOT locked here.
        if (!decision.allowed) {
          throw notFound("asset_not_found", "Ativo nao encontrado");
        }

        // `decision.allowed` guarantees a row matched; narrow explicitly for TS.
        if (!existing) {
          throw notFound("asset_not_found", "Ativo nao encontrado");
        }

        // next = last + interval (REQ-INTERVAL-003). When the asset has no
        // last-calibration date yet, the interval alone derives nothing — keep
        // any pre-existing (grandfathered, pre-flip lab-set) next date instead
        // of erasing it, so the asset does not silently drop out of the
        // due-calibration reminders the moment the customer sets an interval.
        const nextCalibrationDate =
          deriveNextCalibrationDate(
            existing.lastCalibrationDate,
            intervalMonths,
          ) ?? existing.nextCalibrationDate;

        await ctx.o
          .update(asset)
          .set({
            calibrationIntervalMonths: intervalMonths,
            intervalSetBy,
            intervalSetByUserId: session.user.id,
            intervalSetAt: new Date(),
            intervalRationale: rationale,
            nextCalibrationDate,
          })
          // Defense-in-depth: the portal tenant boundary is the customer
          // (asset has no organizationId; org is derived via unit). Repeat the
          // exact scope `decidePortalIntervalWrite` already proved — the asset's
          // customer must be in the caller's in-scope set — so the UPDATE stays
          // customer-scoped even if that guard is refactored away.
          .where(
            and(eq(asset.id, id), inArray(asset.customerId, scopedCustomerIds)),
          );

        await ctx.audit("asset", id, {
          action: "interval_change",
          changes: {
            calibrationIntervalMonths: {
              old: existing.calibrationIntervalMonths,
              new: intervalMonths,
            },
            nextCalibrationDate: {
              old: existing.nextCalibrationDate,
              new: nextCalibrationDate,
            },
          },
          reason: rationale,
        });

        return {
          id,
          calibrationIntervalMonths: intervalMonths,
          nextCalibrationDate,
          intervalSetBy,
        } satisfies ServerShape<PortalIntervalUpdateResponse>;
      },
    );
    return result;
  },
);

// =========================================================================
// GET /assets/:id/drift-series - matched-point as-found margin series
// =========================================================================
// The data drift.ts regresses, exposed for the portal drift chart: per
// positional point, the signed margin toward the 0 tolerance limit over
// time + OLS regression. Degrades honestly: cycles without margins are
// reported in coverage and simply absent from the series.
// =========================================================================
mount(
  portalAssetsRouter,
  PREFIX,
  portalAssetEndpoints.driftSeries,
  [...requirePortalProtected, requirePermission({ equipment: ["read"] })],
  async (c, { params }) => {
    const portalMember = c.get("member");
    const portalLabScope = await requirePortalLabScope(c);
    const scope = await resolvePortalCustomerScope({
      activeOrgId: portalMember.organizationId,
      labScope: portalLabScope,
    });
    if (!scope || scope.customerIds.length === 0) {
      throw notFound("asset_not_found", "Ativo nao encontrado");
    }
    return await orgDb(scope.labOrganizationId).transaction(async (o) => {
      const id = await resolvePortalAssetIdParam(o, params.id);
      if (id === null) {
        throw notFound("asset_not_found", "Ativo nao encontrado");
      }

      const [existing] = await o
        .select({ id: asset.id })
        .from(asset)
        .where(
          and(
            eq(asset.id, id),
            inArray(asset.customerId, scope.customerIds),
            isNull(asset.deletedAt),
          ),
        )
        .limit(1);
      if (!existing) {
        throw notFound("asset_not_found", "Ativo nao encontrado");
      }

      const rows = await o
        .select({
          approvedAt: calibrationJob.approvedAt,
          asFoundConformity: calibrationJob.asFoundConformity,
          asFoundMargins: calibrationJob.asFoundMargins,
        })
        .from(calibrationJob)
        .where(
          and(
            eq(calibrationJob.assetId, id),
            inArray(calibrationJob.customerId, scope.customerIds),
            eq(calibrationJob.status, "APPROVED"),
          ),
        )
        .orderBy(asc(calibrationJob.approvedAt));

      return {
        assetId: id,
        ...buildAssetDriftSeries(rows),
        attribution:
          "Margens conforme os resultados “como recebido” do certificado; parecer de conformidade do laboratório, reproduzido sem reavaliação.",
      };
    });
  },
);
