// The portal's fleet reliability analytics and out-of-tolerance impact assessments.

import { createRouter } from "../../../server/router";
import { mount } from "../../../lib/endpoint-mount";
import { requirePortalLabScope } from "../portal-lab-scope";
import {
  user,
  calibrationJob,
  asset,
  assetType,
  assetOotEvent,
  assetOotImpactAssessment,
} from "@calibra-facil/db/schema";
import {
  portalReliabilityEndpoints,
  type PortalOotAssessmentResponse,
  type ServerShape,
} from "@calibra-facil/contracts";
import { eq, and, inArray, desc, isNull, gte, sql } from "drizzle-orm";
import { ASSET_OOT_EVENT_MACHINE } from "@calibra-facil/schemas/machines";
import {
  requirePermission,
  requirePortalProtected,
  type AuthVariables,
} from "../../../middleware/permission";
import { type R2Env } from "../../../lib/storage";
import { buildFleetReliabilitySummary } from "../portal-fleet-reliability";
import {
  applyUnitFilter,
  resolvePortalCustomerScope,
} from "../portal-customer-scope";
import { orgDb } from "../../../lib/org-db";
import { invalid, notFound } from "../../../lib/domain-errors";
import { withOrg } from "../../../lib/org-context";
import { requestActor } from "../../../middleware/request-actor";

/**
 * Portal routes - endpoints specific to the client portal.
 * These routes handle client-facing functionality.
 * Uses Portal auth (portal_session cookie) for authentication.
 */
const PREFIX = "/api/portal";

export const portalReliabilityRouter = createRouter<{
  Variables: AuthVariables;
  Bindings: R2Env;
}>();

// =========================================================================
// GET /analytics/fleet - fleet reliability analytics
// =========================================================================
// Aggregates the lab-computed as-found verdicts (never recomputed here —
// ISO/IEC 17025 §7.8.6 / ILAC-G8): OOT rate trend, per-type breakdown and
// worst offenders. Rates use KNOWN cycles only; the UNKNOWN share and the
// LEGAL-regime exclusion are always reported so nothing is overstated.
// =========================================================================
mount(
  portalReliabilityRouter,
  PREFIX,
  portalReliabilityEndpoints.fleetAnalytics,
  [...requirePortalProtected, requirePermission({ equipment: ["read"] })],
  async (c, { query }) => {
    const portalMember = c.get("member");
    const portalLabScope = await requirePortalLabScope(c);
    const { periodMonths, bucket, assetTypeId, unitId } = query;

    const scope = await resolvePortalCustomerScope({
      activeOrgId: portalMember.organizationId,
      labScope: portalLabScope,
    });
    if (!scope || scope.customerIds.length === 0) {
      throw notFound("customer_not_found", "Cliente nao encontrado");
    }
    const customerIds = applyUnitFilter(scope, unitId);
    if (customerIds.length === 0) {
      throw notFound("unit_not_found", "Unidade nao encontrada");
    }

    const to = new Date();
    const from = new Date(to.getTime());
    from.setMonth(from.getMonth() - periodMonths);

    const conditions = [
      inArray(calibrationJob.customerId, customerIds),
      eq(calibrationJob.status, "APPROVED"),
      gte(calibrationJob.approvedAt, from),
      isNull(asset.deletedAt),
    ];
    if (assetTypeId) {
      conditions.push(eq(asset.assetTypeId, assetTypeId));
    }

    const rows = await orgDb(scope.labOrganizationId).transaction((o) =>
      o
        .select({
          approvedAt: calibrationJob.approvedAt,
          asFoundConformity: calibrationJob.asFoundConformity,
          assetId: calibrationJob.assetId,
          assetPublicId: asset.publicId,
          assetTag: asset.tag,
          assetName: asset.name,
          assetTypeId: asset.assetTypeId,
          assetTypeName: sql<string>`coalesce(${assetType.name}, 'Sem tipo')`,
          metrologyRegime: asset.metrologyRegime,
        })
        .from(calibrationJob)
        .innerJoin(asset, eq(calibrationJob.assetId, asset.id))
        .leftJoin(assetType, eq(asset.assetTypeId, assetType.id))
        .where(and(...conditions)),
    );

    const summary = buildFleetReliabilitySummary(rows, { bucket });

    return {
      mode: scope.mode,
      period: {
        from: from.toISOString(),
        to: to.toISOString(),
        bucket,
      },
      ...summary,
      attribution:
        "Pareceres de conformidade conforme a regra de decisão aplicada pelo laboratório em cada certificado; o portal reproduz os pareceres sem reavaliação.",
    };
  },
);

mount(
  portalReliabilityRouter,
  PREFIX,
  portalReliabilityEndpoints.ootEvents,
  [...requirePortalProtected, requirePermission({ equipment: ["read"] })],
  async (c, { query }) => {
    const portalMember = c.get("member");
    const portalLabScope = await requirePortalLabScope(c);
    const { status, unitId } = query;

    const scope = await resolvePortalCustomerScope({
      activeOrgId: portalMember.organizationId,
      labScope: portalLabScope,
    });
    if (!scope || scope.customerIds.length === 0) {
      return { data: [] };
    }
    const customerIds = applyUnitFilter(scope, unitId);
    if (customerIds.length === 0) {
      return { data: [] };
    }

    const conditions = [inArray(assetOotEvent.customerId, customerIds)];
    if (status) {
      conditions.push(eq(assetOotEvent.status, status));
    }

    const events = await orgDb(scope.labOrganizationId).transaction((o) =>
      o
        .select({
          id: assetOotEvent.id,
          status: assetOotEvent.status,
          detectedAt: assetOotEvent.detectedAt,
          customerId: assetOotEvent.customerId,
          assetId: assetOotEvent.assetId,
          assetPublicId: asset.publicId,
          assetTag: asset.tag,
          assetName: asset.name,
          jobId: assetOotEvent.jobId,
          jobIdentifier: calibrationJob.jobId,
          // Suspect-window default (ISO 9001 §7.1.5.2 guidance): last
          // known-good as-found calibration before the failing one.
          suggestedPeriodStart: sql<string | null>`(
              select max(cj2.approved_at) from calibration_job cj2
              where cj2.asset_id = ${assetOotEvent.assetId}
                and cj2.approved_at < ${assetOotEvent.detectedAt}
                and cj2.as_found_conformity = 'CONFORMING'
                and cj2.status = 'APPROVED'
            )`,
          assessmentDecision: assetOotImpactAssessment.decision,
          assessmentRationale: assetOotImpactAssessment.rationale,
          assessmentPeriodStart: assetOotImpactAssessment.affectedPeriodStart,
          assessmentPeriodEnd: assetOotImpactAssessment.affectedPeriodEnd,
          assessmentSuspectShipped:
            assetOotImpactAssessment.suspectProductShipped,
          assessmentCustomerNotified: assetOotImpactAssessment.customerNotified,
          assessmentCreatedAt: assetOotImpactAssessment.createdAt,
          assessmentBy: user.name,
        })
        .from(assetOotEvent)
        .innerJoin(asset, eq(assetOotEvent.assetId, asset.id))
        .innerJoin(calibrationJob, eq(assetOotEvent.jobId, calibrationJob.id))
        .leftJoin(
          assetOotImpactAssessment,
          eq(assetOotImpactAssessment.eventId, assetOotEvent.id),
        )
        .leftJoin(user, eq(assetOotImpactAssessment.portalUserId, user.id))
        .where(and(...conditions))
        .orderBy(desc(assetOotEvent.detectedAt)),
    );

    return {
      data: events,
    };
  },
);

// =========================================================================
// POST /oot-events/:id/assessment - record the customer's impact assessment
// =========================================================================
// ISO 9001:2015 §7.1.5.2 / IATF 16949 §7.1.5.2.1. The record is the
// CUSTOMER'S own audit evidence — append-only with actor/ip/user-agent.
// =========================================================================
mount(
  portalReliabilityRouter,
  PREFIX,
  portalReliabilityEndpoints.assessOotEvent,
  [...requirePortalProtected, requirePermission({ equipment: ["update"] })],
  async (c, { params, body }) => {
    const portalMember = c.get("member");
    const session = c.get("session");
    const portalLabScope = await requirePortalLabScope(c);
    const id = Number.parseInt(params.id, 10);
    if (Number.isNaN(id)) {
      throw invalid("invalid_request", "ID invalido");
    }
    const input = body;

    const scope = await resolvePortalCustomerScope({
      activeOrgId: portalMember.organizationId,
      labScope: portalLabScope,
    });
    if (!scope || scope.customerIds.length === 0) {
      throw notFound("oot_event_not_found", "Evento nao encontrado");
    }

    const created = await withOrg(
      scope.labOrganizationId,
      requestActor(c),
      async (ctx) => {
        const [event] = await ctx.o
          .select()
          .from(assetOotEvent)
          .where(
            and(
              eq(assetOotEvent.id, id),
              inArray(assetOotEvent.customerId, scope.customerIds),
            ),
          )
          .limit(1);
        if (!event) {
          throw notFound("oot_event_not_found", "Evento nao encontrado");
        }

        const [existingAssessment] = await ctx.o
          .select({ id: assetOotImpactAssessment.id })
          .from(assetOotImpactAssessment)
          .where(eq(assetOotImpactAssessment.eventId, id))
          .limit(1);
        if (existingAssessment) {
          throw invalid(
            "oot_assessment_exists",
            "Avaliação de impacto já registrada para este evento",
          );
        }

        const [assessment] = await ctx.o
          .insert(assetOotImpactAssessment)
          .values({
            organizationId: event.labOrganizationId,
            eventId: id,
            decision: input.decision,
            rationale: input.rationale,
            affectedPeriodStart: input.affectedPeriodStart
              ? new Date(input.affectedPeriodStart)
              : null,
            affectedPeriodEnd: input.affectedPeriodEnd
              ? new Date(input.affectedPeriodEnd)
              : null,
            suspectProductShipped: input.suspectProductShipped ?? null,
            customerNotified: input.customerNotified ?? null,
            portalUserId: session.user.id,
            ipAddress: ctx.actor.ipAddress,
            userAgent: ctx.actor.userAgent ?? null,
          })
          .returning();
        // Never report a success without the row.
        if (!assessment)
          throw new Error("OOT assessment insert returned no row");

        await ctx.o
          .update(assetOotEvent)
          .set({
            status: ASSET_OOT_EVENT_MACHINE.requireTargetOf("OPEN", "assess"),
          })
          .where(
            and(
              eq(assetOotEvent.id, id),
              inArray(assetOotEvent.customerId, scope.customerIds),
              inArray(
                assetOotEvent.status,
                ASSET_OOT_EVENT_MACHINE.allowedFrom("assess"),
              ),
            ),
          );

        await ctx.audit("assetOotEvent", id, {
          action: "assess",
          changes: {
            decision: input.decision,
            affectedPeriodStart: input.affectedPeriodStart ?? null,
            affectedPeriodEnd: input.affectedPeriodEnd ?? null,
            suspectProductShipped: input.suspectProductShipped ?? null,
            customerNotified: input.customerNotified ?? null,
          },
        });

        return {
          message: "Avaliação registrada",
          data: { event: { ...event, status: "ASSESSED" }, assessment },
        } satisfies ServerShape<PortalOotAssessmentResponse>;
      },
    );
    return created;
  },
);
