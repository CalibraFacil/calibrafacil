// The portal's audit packs: request, list, download.

import { createRouter } from "../../../server/router";
import { mount } from "../../../lib/endpoint-mount";
import { requirePortalLabScope } from "../portal-lab-scope";
import { calibrationJob, portalExportJob } from "@calibra-facil/db/schema";
import {
  portalAuditPackEndpoints,
  type PortalAuditPackRequestedResponse,
} from "@calibra-facil/contracts";
import { eq, and, inArray, desc, isNull, isNotNull, sql } from "drizzle-orm";
import {
  requirePermission,
  requirePortalProtected,
  type AuthVariables,
} from "../../../middleware/permission";
import {
  attachmentDisposition,
  createR2Client,
  generatePresignedUrl,
  type R2Env,
} from "../../../lib/storage";
import { loadPortalReleaseStatuses } from "../portal-certificate-release-gate";
import {
  applyUnitFilter,
  resolvePortalCustomerScope,
} from "../portal-customer-scope";
import { orgDb } from "../../../lib/org-db";
import { conflict, gone, invalid, notFound } from "../../../lib/domain-errors";
import { withOrg } from "../../../lib/org-context";
import { requestActor } from "../../../middleware/request-actor";

// Audit pack: bulk export of released certificates + fleet status for
// customer audits. Hard cap so a single request can never fan out into an
// unbounded ZIP; the worker re-checks the same cap at generation time.
const AUDIT_PACK_MAX_CERTIFICATES = 500;

/**
 * Portal routes - endpoints specific to the client portal.
 * These routes handle client-facing functionality.
 * Uses Portal auth (portal_session cookie) for authentication.
 */
const PREFIX = "/api/portal";

export const portalAuditPacksRouter = createRouter<{
  Variables: AuthVariables;
  Bindings: R2Env;
}>();

// =========================================================================
// POST /audit-packs - Request an audit pack (async bulk export)
// =========================================================================
// Enqueues an AUDIT_PACK background job that builds a ZIP with every
// RELEASED certificate in the period + a fleet-status report + a
// verification-links index. The certificate release gate is applied here
// (fail fast on an empty/oversized selection) AND again inside the worker
// at generation time, since release statuses can change in between.
// =========================================================================
mount(
  portalAuditPacksRouter,
  PREFIX,
  portalAuditPackEndpoints.request,
  [...requirePortalProtected, requirePermission({ certificate: ["read"] })],
  async (c, { body }) => {
    const session = c.get("session");
    const portalMember = c.get("member");
    const portalLabScope = await requirePortalLabScope(c);

    const scope = await resolvePortalCustomerScope({
      activeOrgId: portalMember.organizationId,
      labScope: portalLabScope,
    });
    if (!scope || scope.customerIds.length === 0) {
      throw invalid("portal_customer_not_linked", "Nenhum cliente vinculado");
    }

    const customerIds = applyUnitFilter(scope, body.unitId);
    if (customerIds.length === 0) {
      throw invalid("invalid_request", "Unidade inválida");
    }

    // Candidate set: latest (non-superseded) approved certificates whose
    // approval date falls in the requested window. Same timezone
    // semantics as the /certificates list.
    const approvedAtPortalDate = sql`(${calibrationJob.approvedAt} AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date`;
    const candidates = await orgDb(scope.labOrganizationId).transaction((o) =>
      o
        .select({ id: calibrationJob.id })
        .from(calibrationJob)
        .where(
          and(
            inArray(calibrationJob.customerId, customerIds),
            eq(calibrationJob.status, "APPROVED"),
            isNull(calibrationJob.supersededById),
            isNotNull(calibrationJob.certificateUrl),
            sql`${approvedAtPortalDate} >= ${body.dateFrom}`,
            sql`${approvedAtPortalDate} <= ${body.dateTo}`,
          ),
        )
        .limit(AUDIT_PACK_MAX_CERTIFICATES + 1),
    );

    if (candidates.length > AUDIT_PACK_MAX_CERTIFICATES) {
      throw invalid(
        "audit_pack_too_large",
        `O período selecionado tem mais de ${AUDIT_PACK_MAX_CERTIFICATES} certificados. Reduza o período e gere pacotes menores.`,
      );
    }

    const releaseStatuses = await loadPortalReleaseStatuses({
      organizationId: scope.labOrganizationId,
      calibrationJobIds: candidates.map((row) => row.id),
    });
    const releasedCount = candidates.filter(
      (row) => (releaseStatuses.get(row.id) ?? "RELEASED") === "RELEASED",
    ).length;

    if (body.include.certificates && releasedCount === 0) {
      throw invalid(
        "audit_pack_empty",
        "Nenhum certificado disponível no período selecionado.",
      );
    }

    const exportRow = await withOrg(
      scope.labOrganizationId,
      requestActor(c),
      async (ctx) => {
        const [created] = await ctx.o
          .insert(portalExportJob)
          .values({
            kind: "AUDIT_PACK",
            labOrganizationId: scope.labOrganizationId,
            authOrganizationId: portalMember.organizationId,
            requestedByUserId: session.user.id,
            params: {
              dateFrom: body.dateFrom,
              dateTo: body.dateTo,
              unitId: body.unitId ?? null,
              include: body.include,
              customerIds,
            },
            status: "PENDING",
          })
          // typed `.returning({...})` collapses to the 0-arg overload (TS2554).
          .returning();

        if (!created) {
          throw new Error("Erro ao solicitar o pacote");
        }

        // The job reads the row it is queued for: it dispatches once the
        // row has committed.
        await ctx.emit({
          type: "AUDIT_PACK",
          exportId: created.id,
          userId: session.user.id,
        });
        return created;
      },
    );

    return {
      id: exportRow.id,
      status: "PENDING",
    } satisfies PortalAuditPackRequestedResponse;
  },
);

mount(
  portalAuditPacksRouter,
  PREFIX,
  portalAuditPackEndpoints.list,
  [...requirePortalProtected],
  async (c) => {
    const portalMember = c.get("member");
    const portalLabScope = await requirePortalLabScope(c);

    const scope = await resolvePortalCustomerScope({
      activeOrgId: portalMember.organizationId,
      labScope: portalLabScope,
    });
    if (!scope) {
      return { data: [] };
    }
    return await orgDb(scope.labOrganizationId).transaction(async (o) => {
      const rows = await o
        .select({
          id: portalExportJob.id,
          status: portalExportJob.status,
          params: portalExportJob.params,
          certificateCount: portalExportJob.certificateCount,
          fileSizeBytes: portalExportJob.fileSizeBytes,
          expiresAt: portalExportJob.expiresAt,
          completedAt: portalExportJob.completedAt,
          createdAt: portalExportJob.createdAt,
        })
        .from(portalExportJob)
        .where(
          eq(portalExportJob.authOrganizationId, portalMember.organizationId),
        )
        .orderBy(desc(portalExportJob.createdAt))
        .limit(20);

      const now = Date.now();
      const data = rows.map((row) => ({
        id: row.id,
        status: row.status,
        dateFrom: row.params.dateFrom,
        dateTo: row.params.dateTo,
        unitId: row.params.unitId,
        unitName: row.params.unitId
          ? (scope.customerById.get(row.params.unitId)?.name ?? null)
          : null,
        include: row.params.include,
        certificateCount: row.certificateCount,
        fileSizeBytes: row.fileSizeBytes,
        expiresAt: row.expiresAt,
        expired: row.expiresAt !== null && row.expiresAt.getTime() < now,
        completedAt: row.completedAt,
        createdAt: row.createdAt,
      }));

      return {
        data,
      };
    });
  },
);

mount(
  portalAuditPacksRouter,
  PREFIX,
  portalAuditPackEndpoints.download,
  [...requirePortalProtected],
  async (c, { params }) => {
    const portalMember = c.get("member");
    const portalLabScope = await requirePortalLabScope(c);
    const id = Number.parseInt(params.id, 10);
    if (Number.isNaN(id)) {
      throw invalid("invalid_request", "ID invalido");
    }

    const scope = await resolvePortalCustomerScope({
      activeOrgId: portalMember.organizationId,
      labScope: portalLabScope,
    });
    if (!scope) {
      throw notFound("audit_pack_not_found", "Pacote nao encontrado");
    }

    const [row] = await orgDb(scope.labOrganizationId).transaction((o) =>
      o
        .select({
          id: portalExportJob.id,
          status: portalExportJob.status,
          labOrganizationId: portalExportJob.labOrganizationId,
          params: portalExportJob.params,
          includedJobIds: portalExportJob.includedJobIds,
          r2Key: portalExportJob.r2Key,
          expiresAt: portalExportJob.expiresAt,
        })
        .from(portalExportJob)
        .where(
          and(
            eq(portalExportJob.id, id),
            eq(portalExportJob.authOrganizationId, portalMember.organizationId),
          ),
        )
        .limit(1),
    );

    if (!row) {
      throw notFound("audit_pack_not_found", "Pacote nao encontrado");
    }
    if (row.status !== "COMPLETED" || !row.r2Key) {
      throw invalid("audit_pack_not_ready", "Pacote ainda nao disponivel");
    }
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
      throw gone(
        "audit_pack_expired",
        "Pacote expirado. Gere um novo pacote de auditoria.",
      );
    }

    // Re-check the release gate at download time: a certificate released
    // when the pack was generated may have been held since.
    const includedJobIds = row.includedJobIds ?? [];
    if (includedJobIds.length > 0) {
      const releaseStatuses = await loadPortalReleaseStatuses({
        organizationId: row.labOrganizationId,
        calibrationJobIds: includedJobIds,
      });
      const anyHeld = includedJobIds.some(
        (jobId) =>
          (releaseStatuses.get(jobId) ?? "RELEASED") === "PAYMENT_PENDING",
      );
      if (anyHeld) {
        throw conflict(
          "certificate_payment_pending",
          "Um ou mais certificados deste pacote aguardam confirmação financeira. Gere um novo pacote.",
        );
      }
    }

    const env = c.env;
    const client = createR2Client(env);
    const filename = `pacote-auditoria-${row.params.dateFrom}-a-${row.params.dateTo}.zip`;
    const url = await generatePresignedUrl(
      client,
      env.R2_BUCKET_NAME,
      row.r2Key,
      {
        responseContentDisposition: attachmentDisposition(filename),
      },
    );

    return {
      url,
      filename,
    };
  },
);
