import { createRouter } from "../../../server/router";
import { mount } from "../../../lib/endpoint-mount";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  PORTAL_NOTIFICATION_TYPES,
} from "@calibra-facil/schemas";
import {
  requirePortalLabScope,
  resolvePortalLabScope,
} from "../portal-lab-scope";
import {
  member,
  user,
  organization,
  customer,
  customerGroup,
  calibrationJob,
  calibrationMethod,
  certificateInput,
  calibrationRequest,
  calibrationRequestItem,
  serviceOrder,
  asset,
  assetType,
  service,
  referenceStandardCertificateDocument,
  notificationPreference,
  nonConformance,
  ootNotification,
  portalExportJob,
  assetOotEvent,
  assetOotImpactAssessment,
} from "@calibra-facil/db/schema";
import {
  portalAssetEndpoints,
  portalAuditPackEndpoints,
  portalCertificateEndpoints,
  portalDashboardEndpoints,
  portalNotificationEndpoints,
  portalOotNotificationEndpoints,
  portalReliabilityEndpoints,
  portalShellEndpoints,
  type PortalAuditPackRequestedResponse,
  type PortalOotAcknowledgeResponse,
  type PortalOotAssessmentResponse,
  type PortalIntervalUpdateResponse,
  type PortalNotificationPreferencesResponse,
  type PortalOverviewResponse,
  type ServerShape,
} from "@calibra-facil/contracts";
import { notify } from "@calibra-facil/notifications";
import { PORTAL_ACCESS_ROLES } from "@calibra-facil/auth/access";
import {
  eq,
  ne,
  and,
  inArray,
  asc,
  desc,
  count,
  isNull,
  isNotNull,
  lt,
  gte,
  ilike,
  or,
  sql,
} from "drizzle-orm";
import {
  ASSET_OOT_EVENT_MACHINE,
  OOT_NOTIFICATION_MACHINE,
} from "@calibra-facil/schemas/machines";
import { normalizeAccreditationNumber } from "@calibra-facil/shared";
import {
  frozenAccreditationNumberColumn,
  frozenSealColumn,
  frozenSealJoin,
  issuedSealOf,
  createPortalAmendmentChainLoader,
  resolvePortalAmendmentInfo,
  PORTAL_TERMINAL_CERTIFICATE_STATUSES,
  loadCertificateLifecycles,
  withdrawalOf,
} from "../../jobs";
import { isRecord } from "@calibra-facil/shared/record";
import { finalizedStandardCertificateDocument } from "@calibra-facil/db/standard-certificate-documents";
import { isPendingObjectKey } from "@calibra-facil/shared/storage-keys";

// Upcoming-dues calendar: a bounded date window of instruments coming due.
// The frontend asks for the visible month grid padded by a day on each side,
// so the cap just guards against unbounded scans.
const CALENDAR_MAX_RANGE_DAYS = 100;

// Notification preferences exposed to the portal: the digest opt-in, the
// global email switch and the per-type channel map — the map restricted to
// the customer-facing whitelist (PortalUpdateNotificationPreferencesSchema).
// The row is per-user and shared with the lab surface, so reads project only
// the whitelisted keys and writes merge instead of clobbering.
type PortalPreferenceChannels = { inApp: boolean; email: boolean };

function portalPreferencesPayload(
  stored:
    | {
        preferences: Record<string, PortalPreferenceChannels | undefined>;
        emailEnabled: boolean;
        digestFrequency: "NONE" | "DAILY" | "WEEKLY";
      }
    | undefined,
) {
  const preferences: Record<string, PortalPreferenceChannels> = {};
  for (const type of PORTAL_NOTIFICATION_TYPES) {
    // Same fallback as the dispatcher (sendNotification): absent = both on.
    preferences[type] = stored?.preferences[type] ?? {
      inApp: true,
      email: true,
    };
  }
  return {
    digestFrequency: stored?.digestFrequency ?? "NONE",
    emailEnabled: stored?.emailEnabled ?? true,
    preferences,
  };
}

// Audit pack: bulk export of released certificates + fleet status for
// customer audits. Hard cap so a single request can never fan out into an
// unbounded ZIP; the worker re-checks the same cap at generation time.
const AUDIT_PACK_MAX_CERTIFICATES = 500;
const AUDIT_PACK_EXPIRY_DAYS = 7;

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

function emptyOverview(): ServerShape<PortalOverviewResponse> {
  return {
    equipment: {
      total: 0,
      overdue: 0,
      dueSoon: 0,
      scheduled: 0,
      unscheduled: 0,
      inLab: 0,
      attention: [],
    },
    certificates: { available: 0, recent: [] },
    requests: { total: 0, open: 0, rejected: 0, recent: [] },
    serviceOrders: {
      total: 0,
      inProgress: 0,
      awaitingQuoteApproval: 0,
      readyForPickup: 0,
      awaitingQuote: [],
      recent: [],
    },
  };
}
import {
  requirePortalAuth,
  requirePermission,
  requirePortalProtected,
  type AuthVariables,
} from "../../../middleware/permission";
import {
  attachmentDisposition,
  createR2Client,
  generatePresignedUrl,
  extractKeyFromUrl,
  type R2Env,
} from "../../../lib/storage";
import {
  denormalizeAssetSpecificationsForResponse,
  decidePortalIntervalWrite,
  deriveNextCalibrationDate,
  buildIntervalInsight,
  assetInLab,
  fleetDueCountsByCustomer,
  fleetDueStatusCondition,
} from "../../assets";
import { resolveLabOrganizationIdByPortalHostname } from "../../org";
import {
  applyPortalCertificateReleaseGate,
  loadPortalReleaseStatuses,
} from "../portal-certificate-release-gate";
import { buildPortalCertificateVerdict } from "../portal-certificate-verdict";
import {
  buildAssetDriftSeries,
  buildFleetReliabilitySummary,
} from "../portal-fleet-reliability";
import { renderIntervalReportHtml } from "@calibra-facil/documents";
import { DEFAULT_INTERVAL_CONFIG } from "@calibra-facil/interval-analysis";
import {
  applyUnitFilter,
  listPortalClientOrganizations,
  resolvePortalAccessibleCustomers,
  resolvePortalCustomerScope,
} from "../portal-customer-scope";
import { orgDb, orgSetDb } from "../../../lib/org-db";
import { conflict, gone, invalid, notFound } from "../../../lib/domain-errors";
import { withOrg } from "../../../lib/org-context";
import { requestActor } from "../../../middleware/request-actor";
import type { OrgDb } from "@calibra-facil/db/for-org";
import { portalBaseUrl } from "@calibra-facil/shared/public-urls";

/**
 * Resolve a `/certificates/:id` URL param to a Drizzle predicate. Customers see
 * the human-readable certificate number (`jobId`, e.g. `CAL-2026-9001`) in the
 * URL rather than the sequential database id, but older links carrying the
 * numeric id keep resolving. `jobId` is unique within a lab and every portal
 * query is already scoped to the customer's lab, so there is no cross-lab clash.
 */
function matchPortalCertificateParam(rawParam: string) {
  const numericId = Number(rawParam);
  return Number.isInteger(numericId) && numericId > 0
    ? eq(calibrationJob.id, numericId)
    : eq(calibrationJob.jobId, rawParam);
}

type PortalReferenceStandardDocument = {
  documentId: number;
  r2Key: string;
  fileName: string;
  fileSize: number;
  sha256: string;
  uploadedAt: string | Date;
  certificateNumber: string;
  calibrationDate: string | Date;
  nextCalibrationDate: string | Date;
};

type PortalReferenceStandardSnapshot = {
  id: number;
  name: string;
  type?: string | null;
  certificateNumber: string;
  calibratedBy?: string | null;
  calibrationDate: string | Date;
  nextCalibrationDate: string | Date | null;
  certificateDocument?: PortalReferenceStandardDocument | null;
};

function getString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function getNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizePortalDocument(
  value: unknown,
): PortalReferenceStandardDocument | null {
  if (!isRecord(value)) return null;
  const documentId = getNumber(value.documentId);
  const r2Key = getString(value.r2Key);
  const fileName = getString(value.fileName);
  const fileSize = getNumber(value.fileSize);
  const sha256 = getString(value.sha256);
  const certificateNumber = getString(value.certificateNumber);
  const calibrationDate =
    getString(value.calibrationDate) ??
    (value.calibrationDate instanceof Date ? value.calibrationDate : null);
  const nextCalibrationDate =
    getString(value.nextCalibrationDate) ??
    (value.nextCalibrationDate instanceof Date
      ? value.nextCalibrationDate
      : null);
  const uploadedAt =
    getString(value.uploadedAt) ??
    (value.uploadedAt instanceof Date ? value.uploadedAt : null);

  if (
    documentId === null ||
    !r2Key ||
    isPendingObjectKey(r2Key) ||
    !fileName ||
    fileSize === null ||
    !sha256 ||
    !certificateNumber ||
    !calibrationDate ||
    !nextCalibrationDate ||
    !uploadedAt
  ) {
    return null;
  }

  return {
    documentId,
    r2Key,
    fileName,
    fileSize,
    sha256,
    uploadedAt,
    certificateNumber,
    calibrationDate,
    nextCalibrationDate,
  };
}

function normalizePortalReferenceStandards(
  value: unknown,
): PortalReferenceStandardSnapshot[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const id = getNumber(item.id);
    const name = getString(item.name);
    const certificateNumber = getString(item.certificateNumber);
    const calibrationDate =
      getString(item.calibrationDate) ??
      (item.calibrationDate instanceof Date ? item.calibrationDate : null);
    const nextCalibrationDate =
      getString(item.nextCalibrationDate) ??
      (item.nextCalibrationDate instanceof Date
        ? item.nextCalibrationDate
        : null);

    if (id === null || !name || !certificateNumber || !calibrationDate) {
      return [];
    }

    return [
      {
        id,
        name,
        type: getString(item.type),
        certificateNumber,
        calibratedBy: getString(item.calibratedBy),
        calibrationDate,
        nextCalibrationDate,
        certificateDocument: normalizePortalDocument(item.certificateDocument),
      },
    ];
  });
}

function portalStandardDocumentResponse(
  document: typeof referenceStandardCertificateDocument.$inferSelect,
): PortalReferenceStandardDocument {
  return {
    documentId: document.id,
    r2Key: document.r2Key,
    fileName: document.fileName,
    fileSize: document.fileSize,
    sha256: document.sha256,
    uploadedAt: document.uploadedAt,
    certificateNumber: document.certificateNumber,
    calibrationDate: document.calibrationDate,
    nextCalibrationDate: document.nextCalibrationDate,
  };
}

async function withMatchingPortalStandardDocuments(
  o: Pick<OrgDb, "select">,
  referenceStandards: PortalReferenceStandardSnapshot[],
): Promise<PortalReferenceStandardSnapshot[]> {
  const missingDocumentStandards = referenceStandards.filter(
    (standard) => !standard.certificateDocument,
  );

  if (missingDocumentStandards.length === 0) {
    return referenceStandards;
  }

  const conditions = missingDocumentStandards.map((standard) =>
    and(
      eq(referenceStandardCertificateDocument.standardId, standard.id),
      eq(referenceStandardCertificateDocument.isCurrent, true),
      eq(
        referenceStandardCertificateDocument.certificateNumber,
        standard.certificateNumber,
      ),
      finalizedStandardCertificateDocument(),
    ),
  );

  const documents = await o
    .select()
    .from(referenceStandardCertificateDocument)
    .where(or(...conditions))
    .orderBy(
      desc(referenceStandardCertificateDocument.isCurrent),
      desc(referenceStandardCertificateDocument.uploadedAt),
    );

  const documentsByKey = new Map<string, PortalReferenceStandardDocument>();
  for (const document of documents) {
    const key = `${document.standardId}:${document.certificateNumber}`;
    if (!documentsByKey.has(key)) {
      documentsByKey.set(key, portalStandardDocumentResponse(document));
    }
  }

  return referenceStandards.map((standard) => {
    if (standard.certificateDocument) return standard;
    return {
      ...standard,
      certificateDocument:
        documentsByKey.get(`${standard.id}:${standard.certificateNumber}`) ??
        null,
    };
  });
}

/**
 * Portal routes - endpoints specific to the client portal.
 * These routes handle client-facing functionality.
 * Uses Portal auth (portal_session cookie) for authentication.
 */
const PREFIX = "/api/portal";

export const portalRouter = createRouter<{
  Variables: AuthVariables;
  Bindings: R2Env;
}>();

// =========================================================================
// GET /branding - Public white-label identity for the active portal host
// =========================================================================
// Unauthenticated on purpose: the sign-in page needs the lab's name + logo
// before a session exists. Resolved from the request Origin via the custom
// domain (resolvePortalLabScope). Degrades to nulls on the default portal host
// or an unrecognized domain, so the SPA falls back to CalibraFácil branding.
// =========================================================================
mount(portalRouter, PREFIX, portalShellEndpoints.branding, [], async (c) => {
  const portalLabScope = await resolvePortalLabScope(c);
  if (!portalLabScope.labOrganizationId) {
    return {
      name: null,
      logo: null,
    };
  }

  // `organization` is a global table (no policy): no transaction needed.
  const [labOrganization] = await orgDb(portalLabScope.labOrganizationId)
    .select({ name: organization.name, logo: organization.logo })
    .from(organization)
    .where(eq(organization.id, portalLabScope.labOrganizationId))
    .limit(1);

  return {
    name: labOrganization?.name ?? null,
    logo: labOrganization?.logo ?? null,
  };
});

// =========================================================================
// GET /organizations - List CLIENT organizations for the portal
// =========================================================================
// Returns only organizations where:
// 1. The organization type is "CLIENT"
// 2. The user's role is in PORTAL_ACCESS_ROLES (external portal roles)
//
// This ensures only external portal members can access client organizations
// in the portal, regardless of internal/system ownership members.
// =========================================================================
mount(
  portalRouter,
  PREFIX,
  portalShellEndpoints.organizations,
  [requirePortalAuth],
  async (c) => {
    const session = c.get("session");
    const portalLabScope = await requirePortalLabScope(c);

    // A CLIENT org the user belongs to is either a branch customer's org or a
    // customer-group org (the consolidated "rede" view). Left-join both so a
    // group org — which has no `customer` row — is not dropped, and tag each
    // with `kind` to drive the switcher label ("unit" vs "group · consolidado").
    const clientOrganizations = await listPortalClientOrganizations({
      userId: session.user.id,
      labScope: portalLabScope,
    });

    return clientOrganizations;
  },
);

// =========================================================================
// GET /overview - Command-center aggregation for the active portal org
// =========================================================================
// One round-trip that powers the dashboard with accurate, fleet-wide numbers
// (not guessed from the first page of a list). Scoped to the active org's
// linked customer, exactly like /assets.
// =========================================================================
mount(
  portalRouter,
  PREFIX,
  portalDashboardEndpoints.overview,
  [...requirePortalProtected],
  async (c) => {
    const member = c.get("member");
    const portalLabScope = await requirePortalLabScope(c);

    // Resolve the active org to a single branch customer or, for a group org,
    // the whole set of branch customers (consolidated cockpit).
    const scope = await resolvePortalCustomerScope({
      activeOrgId: member.organizationId,
      labScope: portalLabScope,
    });

    if (!scope || scope.customerIds.length === 0) {
      return emptyOverview();
    }
    const { customerIds } = scope;
    return await orgDb(scope.labOrganizationId).transaction(async (o) => {
      const equipmentWhere = and(
        inArray(asset.customerId, customerIds),
        eq(asset.status, "ACTIVE"),
        isNull(asset.deletedAt),
      );
      // Group mode aggregates requests across branches whose authOrg differs
      // from the active (group) org, so scope by customerId alone.
      // The counts and the recent list share one predicate: the portal customer's
      // requests, inside the laboratory the scope resolved to.
      const requestWhere = inArray(calibrationRequest.customerId, customerIds);
      const certificateWhere = and(
        inArray(calibrationJob.customerId, customerIds),
        eq(calibrationJob.status, "APPROVED"),
      );
      const serviceOrderWhere = inArray(serviceOrder.customerId, customerIds);

      const [
        equipmentCountsByCustomer,
        equipmentAttention,
        certificateCounts,
        recentCertificatesRaw,
        requestCounts,
        recentRequests,
        serviceOrderCounts,
        awaitingQuoteOrders,
        recentServiceOrders,
      ] = await Promise.all([
        fleetDueCountsByCustomer(o, customerIds, { inLab: true }),
        o
          .select({
            id: asset.id,
            publicId: asset.publicId,
            name: asset.name,
            tag: asset.tag,
            nextCalibrationDate: asset.nextCalibrationDate,
            customerId: asset.customerId,
            customerName: customer.name,
          })
          .from(asset)
          .innerJoin(customer, eq(asset.customerId, customer.id))
          .where(and(equipmentWhere, isNotNull(asset.nextCalibrationDate)))
          .orderBy(asc(asset.nextCalibrationDate))
          .limit(6),
        o
          .select({ available: sql<number>`cast(count(*) as int)` })
          .from(calibrationJob)
          .where(certificateWhere),
        o
          .select({
            id: calibrationJob.id,
            jobId: calibrationJob.jobId,
            approvedAt: calibrationJob.approvedAt,
            certificateUrl: calibrationJob.certificateUrl,
            assetName: asset.name,
            assetTag: asset.tag,
          })
          .from(calibrationJob)
          .innerJoin(asset, eq(calibrationJob.assetId, asset.id))
          .where(certificateWhere)
          .orderBy(desc(calibrationJob.approvedAt))
          .limit(5),
        o
          .select({
            total: sql<number>`cast(count(*) as int)`,
            open: sql<number>`cast(count(*) filter (where ${calibrationRequest.status} in ('PENDING','UNDER_REVIEW')) as int)`,
            rejected: sql<number>`cast(count(*) filter (where ${calibrationRequest.status} = 'REJECTED') as int)`,
          })
          .from(calibrationRequest)
          .where(requestWhere),
        o
          .select({
            id: calibrationRequest.id,
            status: calibrationRequest.status,
            submittedAt: calibrationRequest.submittedAt,
            itemCount: sql<number>`cast((select count(*) from ${calibrationRequestItem} where ${calibrationRequestItem.requestId} = ${calibrationRequest.id}) as int)`,
          })
          .from(calibrationRequest)
          .where(requestWhere)
          .orderBy(desc(calibrationRequest.submittedAt))
          .limit(5),
        o
          .select({
            total: sql<number>`cast(count(*) as int)`,
            inProgress: sql<number>`cast(count(*) filter (where ${serviceOrder.status} not in ('delivered','closed','canceled')) as int)`,
            awaitingQuoteApproval: sql<number>`cast(count(*) filter (where ${serviceOrder.status} = 'awaiting_quote_approval') as int)`,
            readyForPickup: sql<number>`cast(count(*) filter (where ${serviceOrder.status} = 'ready_for_pickup') as int)`,
          })
          .from(serviceOrder)
          .where(serviceOrderWhere),
        o
          .select({
            id: serviceOrder.id,
            publicId: serviceOrder.publicId,
            serviceOrderNumber: serviceOrder.serviceOrderNumber,
            status: serviceOrder.status,
            openedAt: serviceOrder.openedAt,
            assetName: asset.name,
          })
          .from(serviceOrder)
          .leftJoin(asset, eq(serviceOrder.assetId, asset.id))
          .where(
            and(
              serviceOrderWhere,
              eq(serviceOrder.status, "awaiting_quote_approval"),
            ),
          )
          .orderBy(desc(serviceOrder.openedAt))
          .limit(5),
        o
          .select({
            id: serviceOrder.id,
            publicId: serviceOrder.publicId,
            serviceOrderNumber: serviceOrder.serviceOrderNumber,
            status: serviceOrder.status,
            openedAt: serviceOrder.openedAt,
            assetName: asset.name,
          })
          .from(serviceOrder)
          .leftJoin(asset, eq(serviceOrder.assetId, asset.id))
          .where(serviceOrderWhere)
          .orderBy(desc(serviceOrder.openedAt))
          .limit(5),
      ]);

      const recentCertificates = (
        await applyPortalCertificateReleaseGate(
          recentCertificatesRaw,
          scope.labOrganizationId,
        )
      ).map((cert) => ({
        id: cert.id,
        jobId: cert.jobId,
        approvedAt: cert.approvedAt,
        assetName: cert.assetName,
        assetTag: cert.assetTag,
        releaseStatus: cert.releaseStatus,
        ready: cert.certificateUrl !== null,
      }));

      // The network's totals: the counts of every branch added up.
      const equipment = [...equipmentCountsByCustomer.values()].reduce(
        (sum, counts) => ({
          total: sum.total + counts.total,
          overdue: sum.overdue + counts.overdue,
          dueSoon: sum.dueSoon + counts.dueSoon,
          scheduled: sum.scheduled + counts.scheduled,
          unscheduled: sum.unscheduled + counts.unscheduled,
          inLab: sum.inLab + counts.inLab,
        }),
        {
          total: 0,
          overdue: 0,
          dueSoon: 0,
          scheduled: 0,
          unscheduled: 0,
          inLab: 0,
        },
      );
      const requests = requestCounts[0] ?? { total: 0, open: 0, rejected: 0 };
      const orders = serviceOrderCounts[0] ?? {
        total: 0,
        inProgress: 0,
        awaitingQuoteApproval: 0,
        readyForPickup: 0,
      };

      return {
        equipment: { ...equipment, attention: equipmentAttention },
        certificates: {
          available: certificateCounts[0]?.available ?? 0,
          recent: recentCertificates,
        },
        requests: { ...requests, recent: recentRequests },
        serviceOrders: {
          ...orders,
          awaitingQuote: awaitingQuoteOrders,
          recent: recentServiceOrders,
        },
      };
    });
  },
);

mount(
  portalRouter,
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
  portalRouter,
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
// GET /calendar - Instruments coming due inside a date window
// =========================================================================
// Powers the portal's upcoming-dues calendar. Same customer scoping as
// /assets; the window is inclusive of both bounds and capped so a client
// can't request an unbounded scan.
// =========================================================================
mount(
  portalRouter,
  PREFIX,
  portalDashboardEndpoints.calendar,
  [...requirePortalProtected, requirePermission({ equipment: ["read"] })],
  async (c, { query }) => {
    const member = c.get("member");
    const portalLabScope = await requirePortalLabScope(c);

    const { from, to, unitId } = query;
    const fromDate = new Date(`${from}T00:00:00.000Z`);
    const toExclusive = new Date(`${to}T00:00:00.000Z`);
    toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);

    const rangeDays = (toExclusive.getTime() - fromDate.getTime()) / 86_400_000;
    if (
      Number.isNaN(fromDate.getTime()) ||
      Number.isNaN(toExclusive.getTime()) ||
      rangeDays <= 0 ||
      rangeDays > CALENDAR_MAX_RANGE_DAYS
    ) {
      throw invalid("invalid_request", "Periodo invalido");
    }

    const scope = await resolvePortalCustomerScope({
      activeOrgId: member.organizationId,
      labScope: portalLabScope,
    });

    if (!scope) {
      return { data: [] };
    }
    const customerIds = applyUnitFilter(scope, unitId);
    if (customerIds.length === 0) {
      return { data: [] };
    }

    return await orgDb(scope.labOrganizationId).transaction(async (o) => {
      const dues = await o
        .select({
          id: asset.id,
          publicId: asset.publicId,
          name: asset.name,
          tag: asset.tag,
          assetTypeName: sql<string>`coalesce(${assetType.name}, 'Sem tipo')`,
          nextCalibrationDate: asset.nextCalibrationDate,
          inLab: assetInLab(o),
          customerId: asset.customerId,
          customerName: customer.name,
        })
        .from(asset)
        .innerJoin(customer, eq(asset.customerId, customer.id))
        .leftJoin(assetType, eq(asset.assetTypeId, assetType.id))
        .where(
          and(
            inArray(asset.customerId, customerIds),
            eq(asset.status, "ACTIVE"),
            isNull(asset.deletedAt),
            gte(asset.nextCalibrationDate, fromDate),
            lt(asset.nextCalibrationDate, toExclusive),
          ),
        )
        .orderBy(asc(asset.nextCalibrationDate), asc(asset.tag));

      // The window filter above keeps only dated assets; narrow the type with it.
      const data = dues.flatMap((due) =>
        due.nextCalibrationDate
          ? [{ ...due, nextCalibrationDate: due.nextCalibrationDate }]
          : [],
      );
      return { data };
    });
  },
);

// =========================================================================
// GET /units - Units (branch customers) in the active scope
// =========================================================================
// Powers the group cockpit's unit filter. Single mode returns the one
// customer; group mode returns every branch. The portal shows the filter
// only when more than one unit is present.
// =========================================================================
mount(
  portalRouter,
  PREFIX,
  portalDashboardEndpoints.units,
  [...requirePortalProtected],
  async (c) => {
    const member = c.get("member");
    const portalLabScope = await requirePortalLabScope(c);

    const scope = await resolvePortalCustomerScope({
      activeOrgId: member.organizationId,
      labScope: portalLabScope,
    });

    if (!scope) {
      return { units: [] };
    }

    const units = [...scope.customerById.values()]
      .map((unit) => ({ id: unit.id, name: unit.name }))
      .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));

    return {
      mode: scope.mode,
      units,
    };
  },
);

// =========================================================================
// GET /units/summary - Per-unit calibration status breakdown (group KPIs)
// =========================================================================
// For the network manager: each unit (branch) with its overdue / due-soon /
// total active-instrument counts, worst-first. Single mode returns one row;
// the portal shows the breakdown only in group mode.
// =========================================================================
mount(
  portalRouter,
  PREFIX,
  portalDashboardEndpoints.unitsSummary,
  [...requirePortalProtected],
  async (c) => {
    const member = c.get("member");
    const portalLabScope = await requirePortalLabScope(c);

    const scope = await resolvePortalCustomerScope({
      activeOrgId: member.organizationId,
      labScope: portalLabScope,
    });

    if (!scope || scope.customerIds.length === 0) {
      return { units: [] };
    }

    const byId = await orgDb(scope.labOrganizationId).transaction((o) =>
      fleetDueCountsByCustomer(o, scope.customerIds),
    );
    const units = [...scope.customerById.values()]
      .map((unit) => {
        const counts = byId.get(unit.id);
        return {
          id: unit.id,
          name: unit.name,
          total: counts?.total ?? 0,
          overdue: counts?.overdue ?? 0,
          dueSoon: counts?.dueSoon ?? 0,
        };
      })
      .sort(
        (left, right) =>
          right.overdue - left.overdue ||
          right.dueSoon - left.dueSoon ||
          left.name.localeCompare(right.name, "pt-BR"),
      );

    return {
      mode: scope.mode,
      units,
    };
  },
);

// =========================================================================
// GET /notification-preferences - Digest opt-in + per-type channel map
// (whitelisted types only) for the portal user
// =========================================================================
mount(
  portalRouter,
  PREFIX,
  portalNotificationEndpoints.preferences,
  [...requirePortalProtected],
  async (c) => {
    const session = c.get("session");
    await requirePortalLabScope(c);

    const [prefs] = await orgDb(c.get("member").organizationId).transaction(
      (o) =>
        o
          .select({
            preferences: notificationPreference.preferences,
            emailEnabled: notificationPreference.emailEnabled,
            digestFrequency: notificationPreference.digestFrequency,
          })
          .from(notificationPreference)
          .where(eq(notificationPreference.userId, session.user.id))
          .limit(1),
    );

    return portalPreferencesPayload(prefs);
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
  portalRouter,
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
portalRouter.get(
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
  portalRouter,
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

mount(
  portalRouter,
  PREFIX,
  portalNotificationEndpoints.updatePreferences,
  [...requirePortalProtected],
  async (c, { body }) => {
    const session = c.get("session");
    await requirePortalLabScope(c);

    const input = body;

    const result = await withOrg(
      c.get("member").organizationId,
      requestActor(c),
      async (ctx) => {
        const [existing] = await ctx.o
          .select({
            preferences: notificationPreference.preferences,
            emailEnabled: notificationPreference.emailEnabled,
            digestFrequency: notificationPreference.digestFrequency,
          })
          .from(notificationPreference)
          .where(eq(notificationPreference.userId, session.user.id))
          .limit(1);

        // Merge-write: the schema only lets whitelisted keys through, and the
        // spread preserves every other stored key — a dual-role user's
        // lab-side preferences survive portal edits untouched.
        const mergedPreferences = {
          ...(existing?.preferences ?? DEFAULT_NOTIFICATION_PREFERENCES),
          ...input.preferences,
        };
        const merged = {
          preferences: mergedPreferences,
          emailEnabled: input.emailEnabled ?? existing?.emailEnabled ?? true,
          digestFrequency:
            input.digestFrequency ?? existing?.digestFrequency ?? "NONE",
        };

        await ctx.o
          .insert(notificationPreference)
          .values({ userId: session.user.id, ...merged })
          .onConflictDoUpdate({
            target: notificationPreference.userId,
            set: merged,
          });

        return portalPreferencesPayload(
          merged,
        ) satisfies ServerShape<PortalNotificationPreferencesResponse>;
      },
    );
    return result;
  },
);

// =========================================================================
// GET /certificates - List certificates for portal user
// =========================================================================
// Returns approved calibration jobs (certificates) for the authenticated
// portal user's organizations.
// =========================================================================
mount(
  portalRouter,
  PREFIX,
  portalCertificateEndpoints.list,
  [...requirePortalProtected],
  async (c, { query }) => {
    const session = c.get("session");
    const portalLabScope = await requirePortalLabScope(c);

    // Pagination: the contract coerces the numbers, the bounds are the route's.
    const page = Math.max(1, Math.trunc(query.page ?? 1));
    const limit = Math.min(100, Math.max(1, Math.trunc(query.limit || 20)));
    const offset = (page - 1) * limit;
    const search = query.query?.trim();
    const { dateFrom, dateTo } = query;

    // Per-instrument archive: scope the certificate list to one asset.
    // Tenant safety is unchanged — the customerIds condition below still
    // applies, so a foreign assetId just yields an empty page.
    const assetId = query.assetId || undefined;

    // All customers this user can access (direct branch orgs + group orgs).
    const { customerIds, labOrganizationIds } =
      await resolvePortalAccessibleCustomers({
        userId: session.user.id,
        labScope: portalLabScope,
      });

    if (customerIds.length === 0) {
      return {
        data: [],
        pagination: { page, limit, total: 0, totalPages: 0 },
      };
    }

    const o = orgSetDb(labOrganizationIds);

    const approvedAtPortalDate = sql`(${calibrationJob.approvedAt} AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date`;

    // Superseded originals stay listed (ISO 17025 §7.8.8 — the customer
    // must be able to tell them apart, not lose them), flagged below.
    const whereCondition = and(
      inArray(calibrationJob.customerId, customerIds),
      inArray(calibrationJob.status, PORTAL_TERMINAL_CERTIFICATE_STATUSES),
      assetId !== undefined ? eq(calibrationJob.assetId, assetId) : undefined,
      search
        ? or(
            ilike(calibrationJob.jobId, `%${search}%`),
            ilike(calibrationJob.certificateName, `%${search}%`),
            ilike(asset.name, `%${search}%`),
            ilike(asset.tag, `%${search}%`),
            ilike(asset.serialNumber, `%${search}%`),
            ilike(asset.manufacturer, `%${search}%`),
            ilike(service.name, `%${search}%`),
          )
        : undefined,
      dateFrom ? sql`${approvedAtPortalDate} >= ${dateFrom}` : undefined,
      dateTo ? sql`${approvedAtPortalDate} <= ${dateTo}` : undefined,
    );

    const [totalResult] = await o
      .select({ count: count() })
      .from(calibrationJob)
      .innerJoin(asset, eq(calibrationJob.assetId, asset.id))
      .innerJoin(service, eq(calibrationJob.serviceId, service.id))
      .where(whereCondition);

    const total = totalResult?.count ?? 0;

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
        supersedesId: calibrationJob.supersedesId,
        supersededById: calibrationJob.supersededById,
        amendmentNumber: calibrationJob.amendmentNumber,
        assetId: calibrationJob.assetId,
        assetPublicId: asset.publicId,
        assetName: asset.name,
        assetTag: asset.tag,
        assetManufacturer: asset.manufacturer,
        assetModel: asset.model,
        assetSerialNumber: asset.serialNumber,
        serviceName: service.name,
        labName: organization.name,
      })
      .from(calibrationJob)
      .innerJoin(asset, eq(calibrationJob.assetId, asset.id))
      .innerJoin(service, eq(calibrationJob.serviceId, service.id))
      .innerJoin(
        organization,
        eq(calibrationJob.organizationId, organization.id),
      )
      .where(whereCondition)
      .orderBy(desc(calibrationJob.approvedAt))
      .limit(limit)
      .offset(offset);

    // Hide certificateUrl for held releases.
    const gatedCertificates = await applyPortalCertificateReleaseGate(
      certificatesRaw,
      labOrganizationIds,
    );

    // Amendment chips (§7.8.8) — derived from the row's own links, same
    // semantics as the public verification page: superseded reads as
    // superseded even while its replacement is still in DRAFT.
    // The lifecycle (ISSUED / SUPERSEDED / WITHDRAWN) is the latest row of
    // the certificate's append-only status stream: an original whose
    // amendment is still in progress is ISSUED and stays valid.
    const lifecycles = await loadCertificateLifecycles(
      o,
      gatedCertificates.map((row) => ({
        id: row.id,
        supersededById: row.supersededById,
      })),
    );
    const certificates = gatedCertificates.map((row) => {
      const lifecycle = lifecycles.get(row.id);
      return {
        ...row,
        certificateStatus: lifecycle?.status ?? "ISSUED",
        withdrawnAt: withdrawalOf(lifecycle)?.withdrawnAt.toISOString() ?? null,
        isSuperseded:
          row.supersededById !== null || row.status === "SUPERSEDED",
        isAmendment: row.supersedesId !== null,
        supersedesId: undefined,
        supersededById: undefined,
      };
    });

    return {
      data: certificates,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  },
);

mount(
  portalRouter,
  PREFIX,
  portalCertificateEndpoints.get,
  [...requirePortalProtected],
  async (c, { params }) => {
    const session = c.get("session");
    const portalLabScope = await requirePortalLabScope(c);
    const certificateParam = params.id;

    const { customerIds, labOrganizationIds } =
      await resolvePortalAccessibleCustomers({
        userId: session.user.id,
        labScope: portalLabScope,
      });

    if (customerIds.length === 0) {
      throw notFound("certificate_not_found", "Certificado nao encontrado");
    }

    const o = orgSetDb(labOrganizationIds);

    const [certificate] = await o
      .select({
        id: calibrationJob.id,
        jobId: calibrationJob.jobId,
        status: calibrationJob.status,
        performedAt: calibrationJob.performedAt,
        approvedAt: calibrationJob.approvedAt,
        dueDate: calibrationJob.dueDate,
        certificateUrl: calibrationJob.certificateUrl,
        verificationToken: calibrationJob.verificationToken,
        supersedesId: calibrationJob.supersedesId,
        supersededById: calibrationJob.supersededById,
        amendmentNumber: calibrationJob.amendmentNumber,
        amendmentReason: calibrationJob.amendmentReason,
        supersededAt: calibrationJob.supersededAt,
        methodSnapshot: calibrationJob.methodSnapshot,
        standardsSnapshot: calibrationJob.standardsSnapshot,
        calibrationLocationSnapshot: calibrationJob.calibrationLocationSnapshot,
        results: calibrationJob.results,
        assetId: calibrationJob.assetId,
        assetPublicId: asset.publicId,
        assetName: asset.name,
        assetTag: asset.tag,
        assetManufacturer: asset.manufacturer,
        assetModel: asset.model,
        assetSerialNumber: asset.serialNumber,
        serviceName: service.name,
        labName: organization.name,
        labLogo: organization.logo,
        labEmail: organization.email,
        labPhone: organization.phone,
        // Accreditation seal - frozen method flag with current-method fallback
        scopeOverrideJustification: calibrationJob.scopeOverrideJustification,
        serviceMethodAccreditedScope: calibrationMethod.accreditedScope,
        labAccreditationActive: organization.accreditationActive,
        labAccreditationNumber: organization.accreditationNumber,
        labAccreditationValidFrom: organization.accreditationValidFrom,
        labAccreditationValidUntil: organization.accreditationValidUntil,
        // The seal decision frozen at approval; null before migration 0120.
        frozenSeal: frozenSealColumn,
        frozenAccreditationNumber: frozenAccreditationNumberColumn,
      })
      .from(calibrationJob)
      .innerJoin(asset, eq(calibrationJob.assetId, asset.id))
      .innerJoin(service, eq(calibrationJob.serviceId, service.id))
      .innerJoin(
        organization,
        eq(calibrationJob.organizationId, organization.id),
      )
      .leftJoin(calibrationMethod, eq(service.methodId, calibrationMethod.id))
      .leftJoin(certificateInput, frozenSealJoin)
      .where(
        and(
          matchPortalCertificateParam(certificateParam),
          inArray(calibrationJob.customerId, customerIds),
          // Superseded originals stay reachable (§7.8.8) — flagged below.
          inArray(calibrationJob.status, PORTAL_TERMINAL_CERTIFICATE_STATUSES),
        ),
      )
      .limit(1);

    if (!certificate) {
      throw notFound("certificate_not_found", "Certificado nao encontrado");
    }

    const referenceStandards = await withMatchingPortalStandardDocuments(
      o,
      normalizePortalReferenceStandards(certificate.standardsSnapshot),
    );

    // Hide certificateUrl when the release is held.
    const [gated] = await applyPortalCertificateReleaseGate(
      [certificate],
      labOrganizationIds,
    );
    const releaseStatus = gated?.releaseStatus ?? "RELEASED";
    const lifecycle = (
      await loadCertificateLifecycles(o, [
        { id: certificate.id, supersededById: certificate.supersededById },
      ])
    ).get(certificate.id);

    // The seal is the decision frozen at approval; only a record
    // approved before it was frozen falls back to the rule it was issued
    // under (vigência at EMISSION).
    const { accredited, accreditationNumber } = issuedSealOf({
      frozenSeal: certificate.frozenSeal,
      frozenAccreditationNumber: certificate.frozenAccreditationNumber,
      legacy: {
        lab: {
          accreditationActive: certificate.labAccreditationActive,
          accreditationNumber: certificate.labAccreditationNumber,
          accreditationValidFrom: certificate.labAccreditationValidFrom,
          accreditationValidUntil: certificate.labAccreditationValidUntil,
        },
        methodAccreditedScope:
          certificate.methodSnapshot?.accreditedScope ??
          certificate.serviceMethodAccreditedScope ??
          false,
        scopeOverrideJustification: certificate.scopeOverrideJustification,
        ...(certificate.approvedAt ? { atDate: certificate.approvedAt } : {}),
      },
    });

    const verdict = buildPortalCertificateVerdict({
      results: certificate.results,
      formulas: certificate.methodSnapshot?.formulas,
    });

    // Amendment chain (§7.8.8): links only surface once the neighbour is
    // itself terminal — same gate as the public verification page. The
    // chain carries ids/jobIds only, so a held replacement leaks no
    // download URL through the banner.
    const amendment = await resolvePortalAmendmentInfo(
      {
        id: certificate.id,
        jobId: certificate.jobId,
        status: certificate.status,
        supersedesId: certificate.supersedesId,
        supersededById: certificate.supersededById,
        amendmentNumber: certificate.amendmentNumber,
        amendmentReason: certificate.amendmentReason,
        approvedAt: certificate.approvedAt,
        supersededAt: certificate.supersededAt,
      },
      createPortalAmendmentChainLoader({
        customerIds,
        organizationIds: labOrganizationIds,
      }),
    );

    // Surface where the calibration was performed (frozen at execution).
    const locationSnapshot = certificate.calibrationLocationSnapshot;
    const onSite = {
      executedOnSite: locationSnapshot?.type === "customer_site",
      addressText: locationSnapshot?.addressText?.trim() || null,
    };

    // Held back from the client (and dropped by JSON): the keys set to
    // `undefined` below, so the contract is checked on the object as a whole.
    const body = {
      ...certificate,
      certificateUrl:
        releaseStatus === "PAYMENT_PENDING" ? null : certificate.certificateUrl,
      releaseStatus,
      certificateStatus: lifecycle?.status ?? "ISSUED",
      withdrawnAt: withdrawalOf(lifecycle)?.withdrawnAt.toISOString() ?? null,
      verdict,
      onSite,
      amendment,
      supersedesId: undefined,
      supersededById: undefined,
      amendmentNumber: undefined,
      amendmentReason: undefined,
      supersededAt: undefined,
      standardsSnapshot: undefined,
      calibrationLocationSnapshot: undefined,
      referenceStandards,
      accreditation: {
        accredited,
        number: accredited
          ? normalizeAccreditationNumber(accreditationNumber ?? "")
          : null,
      },
      serviceMethodAccreditedScope: undefined,
      labAccreditationActive: undefined,
      labAccreditationNumber: undefined,
      labAccreditationValidFrom: undefined,
      labAccreditationValidUntil: undefined,
      frozenSeal: undefined,
      frozenAccreditationNumber: undefined,
      // Internal release-gate detail; the customer only sees `accredited`.
      scopeOverrideJustification: undefined,
    };
    return body;
  },
);

mount(
  portalRouter,
  PREFIX,
  portalCertificateEndpoints.download,
  [...requirePortalProtected],
  async (c, { params }) => {
    const session = c.get("session");
    const portalLabScope = await requirePortalLabScope(c);
    const certificateParam = params.id;

    const { customerIds, labOrganizationIds } =
      await resolvePortalAccessibleCustomers({
        userId: session.user.id,
        labScope: portalLabScope,
      });

    if (customerIds.length === 0) {
      throw notFound("certificate_not_found", "Certificado nao encontrado");
    }

    const o = orgSetDb(labOrganizationIds);

    // Get certificate. Superseded originals stay downloadable — auditors
    // need the historical document (§7.8.8 keeps it identified, not gone).
    const [certificate] = await o
      .select({
        id: calibrationJob.id,
        certificateUrl: calibrationJob.certificateUrl,
        jobId: calibrationJob.jobId,
        certificateName: calibrationJob.certificateName,
      })
      .from(calibrationJob)
      .where(
        and(
          matchPortalCertificateParam(certificateParam),
          inArray(calibrationJob.customerId, customerIds),
          inArray(calibrationJob.status, PORTAL_TERMINAL_CERTIFICATE_STATUSES),
        ),
      )
      .limit(1);

    if (!certificate) {
      throw notFound("certificate_not_found", "Certificado nao encontrado");
    }

    // Deny download when the release is held for billing
    // or for payment. Customer-facing copy is provider-neutral.
    const releaseStatuses = await loadPortalReleaseStatuses({
      organizationId: labOrganizationIds,
      calibrationJobIds: [certificate.id],
    });
    const portalReleaseStatus =
      releaseStatuses.get(certificate.id) ?? "RELEASED";
    if (portalReleaseStatus === "PAYMENT_PENDING") {
      throw conflict(
        "certificate_payment_pending",
        "Certificado aguardando confirmação financeira",
      );
    }

    if (!certificate.certificateUrl) {
      throw invalid("certificate_not_ready", "Documento ainda nao disponivel");
    }

    const env = c.env;
    const key = extractKeyFromUrl(certificate.certificateUrl);
    const client = createR2Client(env);
    const filename = `${sanitizeCertificateFilename(certificate.certificateName || `certificado-${certificate.jobId}`)}.pdf`;
    const url = await generatePresignedUrl(client, env.R2_BUCKET_NAME, key, {
      responseContentDisposition: attachmentDisposition(filename),
    });

    return {
      url,
      filename,
    };
  },
);

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
  portalRouter,
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
  portalRouter,
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
  portalRouter,
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

// =========================================================================
// GET /oot-notifications - §7.10 out-of-tolerance notifications addressed
// to this portal customer. Opaque id = the notification's
// ackToken (already the customer's ack credential in the e-mail link).
// The general in-app notification center lives at /api/portal/notifications
// (portal-notifications.ts) — this endpoint is OOT-specific.
// =========================================================================
mount(
  portalRouter,
  PREFIX,
  portalOotNotificationEndpoints.list,
  [...requirePortalProtected],
  async (c) => {
    const portalMember = c.get("member");
    const portalLabScope = await requirePortalLabScope(c);

    const scope = await resolvePortalCustomerScope({
      activeOrgId: portalMember.organizationId,
      labScope: portalLabScope,
    });
    if (!scope || scope.customerIds.length === 0) {
      return { data: [], counts: { total: 0, pending: 0 } };
    }

    const rows = await orgDb(scope.labOrganizationId).transaction((o) =>
      o
        .select({
          token: ootNotification.ackToken,
          ncNumber: nonConformance.ncNumber,
          certificateNumber: ootNotification.certificateNumber,
          affectedScope: ootNotification.affectedScope,
          status: ootNotification.status,
          sentAt: ootNotification.sentAt,
          acknowledgedAt: ootNotification.acknowledgedAt,
          acknowledgedVia: ootNotification.acknowledgedVia,
          createdAt: ootNotification.createdAt,
          assetName: asset.name,
          assetTag: asset.tag,
          customerId: calibrationJob.customerId,
        })
        .from(ootNotification)
        .innerJoin(calibrationJob, eq(ootNotification.jobId, calibrationJob.id))
        .innerJoin(asset, eq(calibrationJob.assetId, asset.id))
        .innerJoin(nonConformance, eq(ootNotification.ncId, nonConformance.id))
        .where(inArray(calibrationJob.customerId, scope.customerIds))
        .orderBy(desc(ootNotification.createdAt))
        .limit(100),
    );

    const data = rows.map((row) => ({
      id: row.token,
      ncNumber: row.ncNumber,
      certificateNumber: row.certificateNumber,
      affectedScope: row.affectedScope,
      status: row.status,
      sentAt: row.sentAt,
      acknowledgedAt: row.acknowledgedAt,
      acknowledgedVia: row.acknowledgedVia,
      createdAt: row.createdAt,
      assetName: row.assetName,
      assetTag: row.assetTag,
      unitName: scope.customerById.get(row.customerId)?.name ?? null,
    }));

    return {
      data,
      counts: {
        total: data.length,
        pending: data.filter((row) => row.acknowledgedAt === null).length,
      },
    };
  },
);

// =========================================================================
// POST /oot-notifications/:token/acknowledge - Registers receipt from the
// authenticated portal (acknowledgedVia portal_link). Idempotent; the WHERE
// re-checks customer scope so a token from another org can never be stamped.
// =========================================================================
mount(
  portalRouter,
  PREFIX,
  portalOotNotificationEndpoints.acknowledge,
  [...requirePortalProtected],
  async (c, { params }) => {
    const portalMember = c.get("member");
    const portalLabScope = await requirePortalLabScope(c);
    const token = params.token;

    const scope = await resolvePortalCustomerScope({
      activeOrgId: portalMember.organizationId,
      labScope: portalLabScope,
    });
    if (!scope || scope.customerIds.length === 0) {
      throw notFound(
        "oot_notification_not_found",
        "Notificação não encontrada",
      );
    }

    const response = await withOrg(
      scope.labOrganizationId,
      requestActor(c),
      async (ctx) => {
        const [notification] = await ctx.o
          .select({
            id: ootNotification.id,
            ncId: ootNotification.ncId,
            organizationId: ootNotification.organizationId,
            acknowledgedAt: ootNotification.acknowledgedAt,
            ncNumber: nonConformance.ncNumber,
          })
          .from(ootNotification)
          .innerJoin(
            calibrationJob,
            eq(ootNotification.jobId, calibrationJob.id),
          )
          .innerJoin(
            nonConformance,
            eq(ootNotification.ncId, nonConformance.id),
          )
          .where(
            and(
              eq(ootNotification.ackToken, token),
              inArray(calibrationJob.customerId, scope.customerIds),
            ),
          )
          .limit(1);

        if (!notification) {
          throw notFound(
            "oot_notification_not_found",
            "Notificação não encontrada",
          );
        }

        if (!notification.acknowledgedAt) {
          const [updated] = await ctx.o
            .update(ootNotification)
            .set({
              status: "ACKNOWLEDGED",
              acknowledgedAt: new Date(),
              acknowledgedVia: "portal_link",
            })
            .where(
              and(
                eq(ootNotification.id, notification.id),
                isNull(ootNotification.acknowledgedAt),
                inArray(
                  ootNotification.status,
                  OOT_NOTIFICATION_MACHINE.allowedFrom("acknowledge"),
                ),
              ),
            )
            .returning();

          // Notified after the commit: the notification reads the row it is about.
          if (updated) {
            ctx.afterCommit(() =>
              notify("OOT_NOTIFICATION_ACKNOWLEDGED", {
                notificationId: notification.id,
                ncId: notification.ncId,
                ncNumber: notification.ncNumber,
                organizationId: notification.organizationId,
              }),
            );
          }
        }

        return {
          message: "Recebimento confirmado",
        } satisfies ServerShape<PortalOotAcknowledgeResponse>;
      },
    );
    return response;
  },
);

mount(
  portalRouter,
  PREFIX,
  portalCertificateEndpoints.referenceStandardDownload,
  [...requirePortalProtected],
  async (c, { params }) => {
    const session = c.get("session");
    const portalLabScope = await requirePortalLabScope(c);
    const certificateParam = params.id;
    const standardId = parseInt(params.standardId);

    if (isNaN(standardId)) {
      throw invalid("invalid_request", "ID invalido");
    }

    const { customerIds, labOrganizationIds } =
      await resolvePortalAccessibleCustomers({
        userId: session.user.id,
        labScope: portalLabScope,
      });

    if (customerIds.length === 0) {
      throw notFound("certificate_not_found", "Certificado nao encontrado");
    }

    const o = orgSetDb(labOrganizationIds);

    const [certificate] = await o
      .select({
        standardsSnapshot: calibrationJob.standardsSnapshot,
      })
      .from(calibrationJob)
      .where(
        and(
          matchPortalCertificateParam(certificateParam),
          inArray(calibrationJob.customerId, customerIds),
          inArray(calibrationJob.status, PORTAL_TERMINAL_CERTIFICATE_STATUSES),
        ),
      )
      .limit(1);

    if (!certificate) {
      throw notFound("certificate_not_found", "Certificado nao encontrado");
    }

    const standard = normalizePortalReferenceStandards(
      certificate.standardsSnapshot,
    ).find((item) => item.id === standardId);

    if (!standard) {
      throw notFound("standard_not_found", "Padrão não encontrado");
    }

    let document = standard.certificateDocument;
    if (!document) {
      const [matchingDocument] = await o
        .select()
        .from(referenceStandardCertificateDocument)
        .where(
          and(
            eq(referenceStandardCertificateDocument.standardId, standardId),
            eq(referenceStandardCertificateDocument.isCurrent, true),
            eq(
              referenceStandardCertificateDocument.certificateNumber,
              standard.certificateNumber,
            ),
            finalizedStandardCertificateDocument(),
          ),
        )
        .orderBy(
          desc(referenceStandardCertificateDocument.isCurrent),
          desc(referenceStandardCertificateDocument.uploadedAt),
        )
        .limit(1);

      document = matchingDocument
        ? portalStandardDocumentResponse(matchingDocument)
        : null;
    }

    if (!document) {
      throw notFound(
        "standard_certificate_not_available",
        "Certificado do padrão não disponível",
      );
    }

    const env = c.env;
    const client = createR2Client(env);
    const url = await generatePresignedUrl(
      client,
      env.R2_BUCKET_NAME,
      document.r2Key,
    );

    return {
      url,
      filename: document.fileName,
    };
  },
);

// =========================================================================
// GET /analytics/fleet - fleet reliability analytics
// =========================================================================
// Aggregates the lab-computed as-found verdicts (never recomputed here —
// ISO/IEC 17025 §7.8.6 / ILAC-G8): OOT rate trend, per-type breakdown and
// worst offenders. Rates use KNOWN cycles only; the UNKNOWN share and the
// LEGAL-regime exclusion are always reported so nothing is overstated.
// =========================================================================
mount(
  portalRouter,
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

// =========================================================================
// GET /assets/:id/drift-series - matched-point as-found margin series
// =========================================================================
// The data drift.ts regresses, exposed for the portal drift chart: per
// positional point, the signed margin toward the 0 tolerance limit over
// time + OLS regression. Degrades honestly: cycles without margins are
// reported in coverage and simply absent from the series.
// =========================================================================
mount(
  portalRouter,
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

mount(
  portalRouter,
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
  portalRouter,
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

function sanitizeCertificateFilename(value: string) {
  const sanitized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return sanitized || "certificado";
}
