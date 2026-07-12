import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { db } from "@calibra-facil/db";
import {
  member,
  user,
  organization,
  customer,
  customerGroup,
  calibrationJob,
  calibrationMethod,
  calibrationRequest,
  calibrationRequestItem,
  serviceOrder,
  asset,
  assetAuditLog,
  assetType,
  service,
  referenceStandardCertificateDocument,
  notificationPreference,
  nonConformance,
  ootNotification,
  portalExportJob,
  assetOotEvent,
  assetOotImpactAssessment,
  assetOotAuditLog,
} from "@calibra-facil/db/schema";
import { notifyOotAcknowledged } from "@calibra-facil/notifications";
import { enqueueBackgroundJob } from "../lib/background-jobs";
import { DEFAULT_PREFERENCES } from "../lib/notification-defaults";
import { PORTAL_ACCESS_ROLES } from "@calibra-facil/auth/access";
import {
  eq,
  ne,
  and,
  inArray,
  notInArray,
  exists,
  asc,
  desc,
  like,
  not,
  count,
  isNull,
  isNotNull,
  lt,
  lte,
  gt,
  gte,
  ilike,
  or,
  sql,
} from "drizzle-orm";
import {
  ListAssetsQuerySchema,
  SetCalibrationIntervalSchema,
  FleetAnalyticsQuerySchema,
  RecordOotImpactAssessmentSchema,
} from "@calibra-facil/schemas";
import {
  normalizeAccreditationNumber,
  shouldRenderAccreditationSeal,
} from "@calibra-facil/shared";

// Mirrors the portal frontend's DUE_SOON window (apps/portal calibration-status).
// An instrument is "due soon" within this many days of its next calibration.
const DUE_SOON_DAYS = 30;

// Portal-local extension of the shared asset query. Adds an optional
// calibration-status filter so the command center can deep-link the equipment
// list to "overdue" / "due soon" without touching the shared schema or web,
// plus server-side sorting (pagination is server-side, so sort must be too).
const PortalListAssetsQuerySchema = ListAssetsQuerySchema.extend({
  dueStatus: z
    .enum(["overdue", "due_soon", "scheduled", "unscheduled", "in_lab"])
    .optional(),
  sortBy: z
    .enum(["tag", "name", "nextCalibrationDate", "lastCalibrationDate"])
    .default("tag"),
  sortDir: z.enum(["asc", "desc"]).default("asc"),
  // Exact-id lookup used by the self-service recall flow to resolve the
  // preselected instruments. Comma-separated, bounded; still combined with
  // the customer scope below, so foreign ids simply drop out.
  ids: z
    .string()
    .regex(/^\d+(,\d+)*$/)
    .optional()
    .transform((value) => {
      if (!value) return undefined;
      const ids = value.split(",").map((id) => Number.parseInt(id, 10));
      return ids.slice(0, 50);
    }),
  // Group cockpit: narrow the consolidated view to one unit (= branch customer
  // id). Ignored in single mode (only that customer is ever in scope).
  unitId: z.coerce.number().int().positive().optional(),
});

type DueStatus = z.infer<typeof PortalListAssetsQuerySchema>["dueStatus"];

// Upcoming-dues calendar: a bounded date window of instruments coming due.
// The frontend asks for the visible month grid padded by a day on each side,
// so the cap just guards against unbounded scans.
const CALENDAR_MAX_RANGE_DAYS = 100;

const PortalCalendarQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  // Group cockpit: narrow to one unit (= branch customer id). Ignored in single mode.
  unitId: z.coerce.number().int().positive().optional(),
});

// Opt-in due-calibration digest email. The frequency lives on the user's
// notification_preference row (the portal-digest cron is its first consumer);
// the portal exposes only this one field.
const PortalNotificationPreferencesSchema = z.object({
  digestFrequency: z.enum(["NONE", "DAILY", "WEEKLY"]),
});

// Audit pack (#738): bulk export of released certificates + fleet status for
// customer audits. Hard cap so a single request can never fan out into an
// unbounded ZIP; the worker re-checks the same cap at generation time.
const AUDIT_PACK_MAX_CERTIFICATES = 500;
const AUDIT_PACK_EXPIRY_DAYS = 7;

const PortalAuditPackRequestSchema = z
  .object({
    dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    // Group cockpit: narrow to one unit (= branch customer id). Ignored in
    // single mode (only that customer is ever in scope).
    unitId: z.number().int().positive().optional(),
    include: z.object({
      certificates: z.boolean(),
      fleetReport: z.boolean(),
      verificationIndex: z.boolean(),
    }),
  })
  .refine((value) => value.dateFrom <= value.dateTo, {
    message: "Período inválido",
  })
  .refine(
    (value) =>
      value.include.certificates ||
      value.include.fleetReport ||
      value.include.verificationIndex,
    { message: "Selecione ao menos um conteúdo para o pacote" },
  );

// The portal routes assets by the opaque `publicId` (uuid) so URLs never
// expose the enumerable serial id; plain numeric params stay accepted so
// pre-existing links and integrations keep working. Resolves to the internal
// serial id or null when the param matches nothing. Scope checks still happen
// downstream — this only translates the identifier.
async function resolvePortalAssetIdParam(
  param: string,
): Promise<number | null> {
  if (/^\d+$/.test(param)) {
    const id = Number.parseInt(param, 10);
    return Number.isNaN(id) ? null : id;
  }
  const [row] = await db
    .select({ id: asset.id })
    .from(asset)
    .where(eq(asset.publicId, param))
    .limit(1);
  return row?.id ?? null;
}

// An instrument is "in lab" while it has an open calibration job or an open
// service order — i.e. it is physically at the laboratory right now. Open job
// statuses are every non-terminal JobStatus; open service orders mirror the
// /overview "inProgress" definition (anything not yet returned to the client).
function assetInLabSql() {
  const openJob = db
    .select({ one: sql`1` })
    .from(calibrationJob)
    .where(
      and(
        eq(calibrationJob.assetId, asset.id),
        inArray(calibrationJob.status, [
          "DRAFT",
          "IN_PROGRESS",
          "REVIEW",
          "GENERATING_PDF",
        ]),
      ),
    );
  const openServiceOrder = db
    .select({ one: sql`1` })
    .from(serviceOrder)
    .where(
      and(
        eq(serviceOrder.assetId, asset.id),
        notInArray(serviceOrder.status, ["delivered", "closed", "canceled"]),
      ),
    );

  return sql<boolean>`(${exists(openJob)} or ${exists(openServiceOrder)})`;
}

function buildDueStatusCondition(dueStatus: DueStatus) {
  if (!dueStatus) return undefined;
  const now = new Date();
  const soon = new Date(now);
  soon.setDate(soon.getDate() + DUE_SOON_DAYS);

  switch (dueStatus) {
    case "overdue":
      return lt(asset.nextCalibrationDate, now);
    case "due_soon":
      return and(
        gte(asset.nextCalibrationDate, now),
        lte(asset.nextCalibrationDate, soon),
      );
    case "scheduled":
      return gt(asset.nextCalibrationDate, soon);
    case "unscheduled":
      return isNull(asset.nextCalibrationDate);
    case "in_lab":
      return assetInLabSql();
  }
}

function emptyOverview() {
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
} from "../middleware/permission";
import {
  attachmentDisposition,
  createR2Client,
  generatePresignedUrl,
  extractKeyFromUrl,
  type R2Env,
} from "../lib/storage";
import { denormalizeAssetSpecificationsForResponse } from "../lib/asset-measurement";
import { resolveLabOrganizationIdByPortalHostname } from "../lib/portal-domains";
import {
  applyPortalCertificateReleaseGate,
  loadPortalReleaseStatuses,
} from "../lib/portal-certificate-release-gate";
import { buildPortalCertificateVerdict } from "../lib/portal-certificate-verdict";
import {
  decidePortalIntervalWrite,
  deriveNextCalibrationDate,
} from "../lib/portal-asset-interval";
import { buildIntervalInsight } from "../lib/interval-insight";
import {
  buildAssetDriftSeries,
  buildFleetReliabilitySummary,
} from "../lib/portal-fleet-reliability";
import { renderIntervalReportHtml } from "@calibra-facil/documents";
import { DEFAULT_INTERVAL_CONFIG } from "@calibra-facil/interval-analysis";
import {
  applyUnitFilter,
  resolvePortalAccessibleCustomerIds,
  resolvePortalCustomerScope,
} from "../lib/portal-customer-scope";

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

function finalizedStandardCertificateDocumentCondition() {
  return not(like(referenceStandardCertificateDocument.r2Key, "pending/%"));
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

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
    r2Key.startsWith("pending/") ||
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
      finalizedStandardCertificateDocumentCondition(),
    ),
  );

  const documents = await db
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

function getPortalHostOrigin(c: {
  req: { header: (name: string) => string | undefined };
}) {
  return c.req.header("origin") ?? c.req.header("referer") ?? null;
}

function isDefaultPortalHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();

  if (
    process.env.NODE_ENV !== "production" &&
    normalized === "dev-portal.calibrafacil.com"
  ) {
    return true;
  }

  return (
    normalized === "portal.calibrafacil.com" ||
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "[::1]" ||
    normalized.startsWith("10.") ||
    normalized.startsWith("192.168.")
  );
}

type PortalLabScope = {
  labOrganizationId: string | null;
  blocked: boolean;
};

async function getPortalLabScope(c: {
  req: { header: (name: string) => string | undefined };
}): Promise<PortalLabScope> {
  const origin = getPortalHostOrigin(c);
  if (!origin) return { labOrganizationId: null, blocked: true };

  try {
    const url = new URL(origin);
    const hostname = url.hostname.toLowerCase();
    const labOrganizationId =
      await resolveLabOrganizationIdByPortalHostname(hostname);

    if (labOrganizationId) {
      return { labOrganizationId, blocked: false };
    }

    return {
      labOrganizationId: null,
      blocked: !isDefaultPortalHostname(hostname),
    };
  } catch {
    return { labOrganizationId: null, blocked: true };
  }
}

/**
 * Portal routes - endpoints specific to the client portal.
 * These routes handle client-facing functionality.
 * Uses Portal auth (portal_session cookie) for authentication.
 */
export const portalRouter = new Hono<{
  Variables: AuthVariables;
  Bindings: R2Env;
}>()
  // =========================================================================
  // GET /branding - Public white-label identity for the active portal host
  // =========================================================================
  // Unauthenticated on purpose: the sign-in page needs the lab's name + logo
  // before a session exists. Resolved from the request Origin via the custom
  // domain (getPortalLabScope). Degrades to nulls on the default portal host
  // or an unrecognized domain, so the SPA falls back to CalibraFácil branding.
  // =========================================================================
  .get("/branding", async (c) => {
    const portalLabScope = await getPortalLabScope(c);
    if (!portalLabScope.labOrganizationId) {
      return c.json({ name: null, logo: null });
    }

    const [labOrganization] = await db
      .select({ name: organization.name, logo: organization.logo })
      .from(organization)
      .where(eq(organization.id, portalLabScope.labOrganizationId))
      .limit(1);

    return c.json({
      name: labOrganization?.name ?? null,
      logo: labOrganization?.logo ?? null,
    });
  })

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
  .get("/organizations", requirePortalAuth, async (c) => {
    const session = c.get("session");
    const portalLabScope = await getPortalLabScope(c);
    if (portalLabScope.blocked) {
      return c.json({ error: "Acesso nao permitido neste dominio" }, 403);
    }

    try {
      // A CLIENT org the user belongs to is either a branch customer's org or a
      // customer-group org (the consolidated "rede" view). Left-join both so a
      // group org — which has no `customer` row — is not dropped, and tag each
      // with `kind` to drive the switcher label ("unit" vs "group · consolidado").
      const clientOrganizations = await db
        .select({
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
          logo: organization.logo,
          type: organization.type,
          createdAt: organization.createdAt,
          memberRole: member.role,
          kind: sql<
            "unit" | "group"
          >`case when ${customerGroup.id} is not null then 'group' else 'unit' end`,
        })
        .from(member)
        .innerJoin(organization, eq(member.organizationId, organization.id))
        .leftJoin(customer, eq(customer.authOrganizationId, organization.id))
        .leftJoin(
          customerGroup,
          eq(customerGroup.authOrganizationId, organization.id),
        )
        .where(
          and(
            eq(member.userId, session.user.id),
            eq(organization.type, "CLIENT"),
            inArray(member.role, PORTAL_ACCESS_ROLES),
            portalLabScope.labOrganizationId
              ? or(
                  eq(
                    customer.labOrganizationId,
                    portalLabScope.labOrganizationId,
                  ),
                  eq(
                    customerGroup.labOrganizationId,
                    portalLabScope.labOrganizationId,
                  ),
                )
              : undefined,
          ),
        );

      return c.json(clientOrganizations);
    } catch (error) {
      console.error("Error listing portal organizations:", error);
      return c.json({ error: "Erro ao listar organizações" }, 500);
    }
  })

  // =========================================================================
  // GET /overview - Command-center aggregation for the active portal org
  // =========================================================================
  // One round-trip that powers the dashboard with accurate, fleet-wide numbers
  // (not guessed from the first page of a list). Scoped to the active org's
  // linked customer, exactly like /assets.
  // =========================================================================
  .get("/overview", ...requirePortalProtected, async (c) => {
    const member = c.get("member");
    const portalLabScope = await getPortalLabScope(c);
    if (portalLabScope.blocked) {
      return c.json({ error: "Acesso nao permitido neste dominio" }, 403);
    }

    try {
      // Resolve the active org to a single branch customer or, for a group org,
      // the whole set of branch customers (consolidated cockpit).
      const scope = await resolvePortalCustomerScope({
        activeOrgId: member.organizationId,
        labScope: portalLabScope.labOrganizationId,
      });

      if (!scope || scope.customerIds.length === 0) {
        return c.json(emptyOverview());
      }
      const { customerIds } = scope;

      // Compare against the DB clock in UTC. Binding raw JS Date objects inside
      // a sql`` template fails under postgres.js (it can't encode a bare Date),
      // so we derive both bounds from now() in SQL instead.
      const nowUtc = sql`(now() at time zone 'utc')`;
      const soonUtc = sql`((now() at time zone 'utc') + interval '${sql.raw(String(DUE_SOON_DAYS))} days')`;

      const equipmentWhere = and(
        inArray(asset.customerId, customerIds),
        eq(asset.status, "ACTIVE"),
        isNull(asset.deletedAt),
      );
      // Group mode aggregates requests across branches whose authOrg differs
      // from the active (group) org, so scope by customerId alone.
      const requestWhere = inArray(calibrationRequest.customerId, customerIds);
      const certificateWhere = and(
        inArray(calibrationJob.customerId, customerIds),
        eq(calibrationJob.status, "APPROVED"),
      );
      const serviceOrderWhere = inArray(serviceOrder.customerId, customerIds);

      const [
        equipmentCounts,
        equipmentAttention,
        certificateCounts,
        recentCertificatesRaw,
        requestCounts,
        recentRequests,
        serviceOrderCounts,
        awaitingQuoteOrders,
        recentServiceOrders,
      ] = await Promise.all([
        db
          .select({
            total: sql<number>`cast(count(*) as int)`,
            overdue: sql<number>`cast(count(*) filter (where ${asset.nextCalibrationDate} < ${nowUtc}) as int)`,
            dueSoon: sql<number>`cast(count(*) filter (where ${asset.nextCalibrationDate} >= ${nowUtc} and ${asset.nextCalibrationDate} <= ${soonUtc}) as int)`,
            scheduled: sql<number>`cast(count(*) filter (where ${asset.nextCalibrationDate} > ${soonUtc}) as int)`,
            unscheduled: sql<number>`cast(count(*) filter (where ${asset.nextCalibrationDate} is null) as int)`,
            inLab: sql<number>`cast(count(*) filter (where ${assetInLabSql()}) as int)`,
          })
          .from(asset)
          .where(equipmentWhere),
        db
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
        db
          .select({ available: sql<number>`cast(count(*) as int)` })
          .from(calibrationJob)
          .where(certificateWhere),
        db
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
        db
          .select({
            total: sql<number>`cast(count(*) as int)`,
            open: sql<number>`cast(count(*) filter (where ${calibrationRequest.status} in ('PENDING','UNDER_REVIEW')) as int)`,
            rejected: sql<number>`cast(count(*) filter (where ${calibrationRequest.status} = 'REJECTED') as int)`,
          })
          .from(calibrationRequest)
          .where(requestWhere),
        db
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
        db
          .select({
            total: sql<number>`cast(count(*) as int)`,
            inProgress: sql<number>`cast(count(*) filter (where ${serviceOrder.status} not in ('delivered','closed','canceled')) as int)`,
            awaitingQuoteApproval: sql<number>`cast(count(*) filter (where ${serviceOrder.status} = 'awaiting_quote_approval') as int)`,
            readyForPickup: sql<number>`cast(count(*) filter (where ${serviceOrder.status} = 'ready_for_pickup') as int)`,
          })
          .from(serviceOrder)
          .where(serviceOrderWhere),
        db
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
        db
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

      const equipment = equipmentCounts[0] ?? {
        total: 0,
        overdue: 0,
        dueSoon: 0,
        scheduled: 0,
        unscheduled: 0,
        inLab: 0,
      };
      const requests = requestCounts[0] ?? { total: 0, open: 0, rejected: 0 };
      const orders = serviceOrderCounts[0] ?? {
        total: 0,
        inProgress: 0,
        awaitingQuoteApproval: 0,
        readyForPickup: 0,
      };

      return c.json({
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
      });
    } catch (error) {
      console.error("Error building portal overview:", error);
      return c.json({ error: "Erro ao carregar o painel" }, 500);
    }
  })

  // =========================================================================
  // GET /assets - List assets for active portal organization
  // =========================================================================
  .get(
    "/assets",
    ...requirePortalProtected,
    requirePermission({ equipment: ["read"] }),
    zValidator("query", PortalListAssetsQuerySchema),
    async (c) => {
      const member = c.get("member");
      const portalLabScope = await getPortalLabScope(c);
      if (portalLabScope.blocked) {
        return c.json({ error: "Acesso nao permitido neste dominio" }, 403);
      }

      try {
        const { page, limit, query, dueStatus, sortBy, sortDir, ids, unitId } =
          c.req.valid("query");
        const offset = (page - 1) * limit;

        const scope = await resolvePortalCustomerScope({
          activeOrgId: member.organizationId,
          labScope: portalLabScope.labOrganizationId,
        });

        if (!scope) {
          return c.json({
            data: [],
            pagination: { page, limit, total: 0, totalPages: 0 },
          });
        }

        const customerIds = applyUnitFilter(scope, unitId);
        if (customerIds.length === 0) {
          return c.json({
            data: [],
            pagination: { page, limit, total: 0, totalPages: 0 },
          });
        }

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
          buildDueStatusCondition(dueStatus),
        );

        const [countResult] = await db
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

        const assets = await db
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
            inLab: assetInLabSql(),
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
          const lastCertificates = await db
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

        return c.json({
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
        });
      } catch (error) {
        console.error("Error listing portal assets:", error);
        return c.json({ error: "Erro ao listar ativos" }, 500);
      }
    },
  )

  // =========================================================================
  // GET /assets/:id - Get single asset details for active portal organization
  // =========================================================================
  .get(
    "/assets/:id",
    ...requirePortalProtected,
    requirePermission({ equipment: ["read"] }),
    async (c) => {
      const portalMember = c.get("member");
      const portalLabScope = await getPortalLabScope(c);
      if (portalLabScope.blocked) {
        return c.json({ error: "Acesso nao permitido neste dominio" }, 403);
      }
      const id = await resolvePortalAssetIdParam(c.req.param("id"));
      if (id === null) {
        return c.json({ error: "Ativo nao encontrado" }, 404);
      }

      try {
        const scope = await resolvePortalCustomerScope({
          activeOrgId: portalMember.organizationId,
          labScope: portalLabScope.labOrganizationId,
        });

        if (!scope || scope.customerIds.length === 0) {
          return c.json({ error: "Ativo nao encontrado" }, 404);
        }
        const { customerIds } = scope;

        const [assetDetails] = await db
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
            // Track 1 — customer-owned calibration interval (§7.8.4.3 + ILAC-G24): the
            // periodicity the customer sets/owns in the portal (for EVERY regime).
            calibrationIntervalMonths: asset.calibrationIntervalMonths,
            intervalSetBy: asset.intervalSetBy,
            // Track 2 — legal-metrology regime + the regulation-fixed verification
            // periodicity (independent of Track 1; lab-recorded, read-only for the customer).
            metrologyRegime: asset.metrologyRegime,
            regulatedInterval: asset.regulatedInterval,
            nextLegalVerificationDate: asset.nextLegalVerificationDate,
            inLab: assetInLabSql(),
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
          return c.json({ error: "Ativo nao encontrado" }, 404);
        }

        const assetCertificateWhere = and(
          eq(calibrationJob.assetId, assetDetails.id),
          inArray(calibrationJob.customerId, customerIds),
          eq(calibrationJob.status, "APPROVED"),
        );

        const [certificateCountResult] = await db
          .select({ total: count() })
          .from(calibrationJob)
          .where(assetCertificateWhere);

        const certificatesRaw = await db
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

        // Phase 2 slice 1: hide certificateUrl for held releases.
        const certificates = await applyPortalCertificateReleaseGate(
          certificatesRaw,
          scope.labOrganizationId,
        );

        return c.json({
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
        });
      } catch (error) {
        console.error("Error fetching portal asset:", error);
        return c.json({ error: "Erro ao buscar ativo" }, 500);
      }
    },
  )

  // =========================================================================
  // GET /calendar - Instruments coming due inside a date window
  // =========================================================================
  // Powers the portal's upcoming-dues calendar. Same customer scoping as
  // /assets; the window is inclusive of both bounds and capped so a client
  // can't request an unbounded scan.
  // =========================================================================
  .get(
    "/calendar",
    ...requirePortalProtected,
    requirePermission({ equipment: ["read"] }),
    zValidator("query", PortalCalendarQuerySchema),
    async (c) => {
      const member = c.get("member");
      const portalLabScope = await getPortalLabScope(c);
      if (portalLabScope.blocked) {
        return c.json({ error: "Acesso nao permitido neste dominio" }, 403);
      }

      const { from, to, unitId } = c.req.valid("query");
      const fromDate = new Date(`${from}T00:00:00.000Z`);
      const toExclusive = new Date(`${to}T00:00:00.000Z`);
      toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);

      const rangeDays =
        (toExclusive.getTime() - fromDate.getTime()) / 86_400_000;
      if (
        Number.isNaN(fromDate.getTime()) ||
        Number.isNaN(toExclusive.getTime()) ||
        rangeDays <= 0 ||
        rangeDays > CALENDAR_MAX_RANGE_DAYS
      ) {
        return c.json({ error: "Periodo invalido" }, 400);
      }

      try {
        const scope = await resolvePortalCustomerScope({
          activeOrgId: member.organizationId,
          labScope: portalLabScope.labOrganizationId,
        });

        if (!scope) {
          return c.json({ data: [] });
        }
        const customerIds = applyUnitFilter(scope, unitId);
        if (customerIds.length === 0) {
          return c.json({ data: [] });
        }

        const dues = await db
          .select({
            id: asset.id,
            publicId: asset.publicId,
            name: asset.name,
            tag: asset.tag,
            assetTypeName: sql<string>`coalesce(${assetType.name}, 'Sem tipo')`,
            nextCalibrationDate: asset.nextCalibrationDate,
            inLab: assetInLabSql(),
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

        return c.json({ data: dues });
      } catch (error) {
        console.error("Error building portal calendar:", error);
        return c.json({ error: "Erro ao carregar o calendário" }, 500);
      }
    },
  )

  // =========================================================================
  // GET /units - Units (branch customers) in the active scope
  // =========================================================================
  // Powers the group cockpit's unit filter. Single mode returns the one
  // customer; group mode returns every branch. The portal shows the filter
  // only when more than one unit is present.
  // =========================================================================
  .get("/units", ...requirePortalProtected, async (c) => {
    const member = c.get("member");
    const portalLabScope = await getPortalLabScope(c);
    if (portalLabScope.blocked) {
      return c.json({ error: "Acesso nao permitido neste dominio" }, 403);
    }

    try {
      const scope = await resolvePortalCustomerScope({
        activeOrgId: member.organizationId,
        labScope: portalLabScope.labOrganizationId,
      });

      if (!scope) {
        return c.json({ units: [] });
      }

      const units = [...scope.customerById.values()]
        .map((unit) => ({ id: unit.id, name: unit.name }))
        .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));

      return c.json({ mode: scope.mode, units });
    } catch (error) {
      console.error("Error listing portal units:", error);
      return c.json({ error: "Erro ao listar unidades" }, 500);
    }
  })

  // =========================================================================
  // GET /units/summary - Per-unit calibration status breakdown (group KPIs)
  // =========================================================================
  // For the network manager: each unit (branch) with its overdue / due-soon /
  // total active-instrument counts, worst-first. Single mode returns one row;
  // the portal shows the breakdown only in group mode.
  // =========================================================================
  .get("/units/summary", ...requirePortalProtected, async (c) => {
    const member = c.get("member");
    const portalLabScope = await getPortalLabScope(c);
    if (portalLabScope.blocked) {
      return c.json({ error: "Acesso nao permitido neste dominio" }, 403);
    }

    try {
      const scope = await resolvePortalCustomerScope({
        activeOrgId: member.organizationId,
        labScope: portalLabScope.labOrganizationId,
      });

      if (!scope || scope.customerIds.length === 0) {
        return c.json({ units: [] });
      }

      const nowUtc = sql`(now() at time zone 'utc')`;
      const soonUtc = sql`((now() at time zone 'utc') + interval '${sql.raw(String(DUE_SOON_DAYS))} days')`;

      const rows = await db
        .select({
          customerId: asset.customerId,
          total: sql<number>`cast(count(*) as int)`,
          overdue: sql<number>`cast(count(*) filter (where ${asset.nextCalibrationDate} < ${nowUtc}) as int)`,
          dueSoon: sql<number>`cast(count(*) filter (where ${asset.nextCalibrationDate} >= ${nowUtc} and ${asset.nextCalibrationDate} <= ${soonUtc}) as int)`,
        })
        .from(asset)
        .where(
          and(
            inArray(asset.customerId, scope.customerIds),
            eq(asset.status, "ACTIVE"),
            isNull(asset.deletedAt),
          ),
        )
        .groupBy(asset.customerId);

      const byId = new Map(rows.map((row) => [row.customerId, row]));
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

      return c.json({ mode: scope.mode, units });
    } catch (error) {
      console.error("Error building portal unit summary:", error);
      return c.json({ error: "Erro ao carregar o resumo por unidade" }, 500);
    }
  })

  // =========================================================================
  // GET /notification-preferences - Digest opt-in for the portal user
  // =========================================================================
  .get("/notification-preferences", ...requirePortalProtected, async (c) => {
    const session = c.get("session");
    const portalLabScope = await getPortalLabScope(c);
    if (portalLabScope.blocked) {
      return c.json({ error: "Acesso nao permitido neste dominio" }, 403);
    }

    try {
      const [prefs] = await db
        .select({
          digestFrequency: notificationPreference.digestFrequency,
        })
        .from(notificationPreference)
        .where(eq(notificationPreference.userId, session.user.id))
        .limit(1);

      return c.json({ digestFrequency: prefs?.digestFrequency ?? "NONE" });
    } catch (error) {
      console.error("Error reading portal notification preferences:", error);
      return c.json({ error: "Erro ao carregar preferências" }, 500);
    }
  })

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
  .get(
    "/assets/:id/interval-insight",
    ...requirePortalProtected,
    requirePermission({ equipment: ["read"] }),
    async (c) => {
      const portalMember = c.get("member");
      const portalLabScope = await getPortalLabScope(c);
      if (portalLabScope.blocked) {
        return c.json({ error: "Acesso nao permitido neste dominio" }, 403);
      }

      const id = await resolvePortalAssetIdParam(c.req.param("id"));
      if (id === null) {
        return c.json({ error: "Ativo nao encontrado" }, 404);
      }

      try {
        const scope = await resolvePortalCustomerScope({
          activeOrgId: portalMember.organizationId,
          labScope: portalLabScope.labOrganizationId,
        });
        if (!scope || scope.customerIds.length === 0) {
          return c.json({ error: "Ativo nao encontrado" }, 404);
        }
        const { customerIds } = scope;

        const [existing] = await db
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
          return c.json({ error: "Ativo nao encontrado" }, 404);
        }

        const rows = await db
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
            ? await db
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
        return c.json(insight);
      } catch (error) {
        console.error("Error building interval insight:", error);
        return c.json(
          { error: "Erro ao calcular periodicidade sugerida" },
          500,
        );
      }
    },
  )

  // =========================================================================
  // GET /assets/:id/interval-insight/report - printable HTML report (Phase E2)
  // =========================================================================
  // Self-contained, print-optimized HTML of the reliability analysis the customer
  // can save as a PDF. Explicitly NOT a calibration certificate (§7.8.4.3 disclaimer);
  // never rendered through the certificate path. Tenant-scoped, read-only.
  // =========================================================================
  .get(
    "/assets/:id/interval-insight/report",
    ...requirePortalProtected,
    requirePermission({ equipment: ["read"] }),
    async (c) => {
      const portalMember = c.get("member");
      const portalLabScope = await getPortalLabScope(c);
      if (portalLabScope.blocked) {
        return c.json({ error: "Acesso nao permitido neste dominio" }, 403);
      }
      const id = await resolvePortalAssetIdParam(c.req.param("id"));
      if (id === null) {
        return c.json({ error: "Ativo nao encontrado" }, 404);
      }

      try {
        const scope = await resolvePortalCustomerScope({
          activeOrgId: portalMember.organizationId,
          labScope: portalLabScope.labOrganizationId,
        });
        if (!scope || scope.customerIds.length === 0) {
          return c.json({ error: "Ativo nao encontrado" }, 404);
        }
        const { customerIds } = scope;

        const [existing] = await db
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
          return c.json({ error: "Ativo nao encontrado" }, 404);
        }

        const rows = await db
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
            ? await db
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
      } catch (error) {
        console.error("Error rendering interval report:", error);
        return c.json({ error: "Erro ao gerar o relatório" }, 500);
      }
    },
  )

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
  .put(
    "/assets/:id/interval",
    ...requirePortalProtected,
    requirePermission({ equipment: ["update"] }),
    zValidator("json", SetCalibrationIntervalSchema),
    async (c) => {
      const session = c.get("session");
      const portalMember = c.get("member");
      const portalLabScope = await getPortalLabScope(c);
      if (portalLabScope.blocked) {
        return c.json({ error: "Acesso nao permitido neste dominio" }, 403);
      }

      const id = await resolvePortalAssetIdParam(c.req.param("id"));
      if (id === null) {
        return c.json({ error: "Ativo nao encontrado" }, 404);
      }

      const { intervalMonths, rationale, source } = c.req.valid("json");
      // REQ-ENGINE-APPLY-001: applying an engine suggestion records `engine_applied`.
      const intervalSetBy =
        source === "engine" ? "engine_applied" : "customer_confirmed";

      try {
        const scope = await resolvePortalCustomerScope({
          activeOrgId: portalMember.organizationId,
          labScope: portalLabScope.labOrganizationId,
        });
        const scopedCustomerIds = scope?.customerIds ?? [];

        const [existing] = await db
          .select({
            id: asset.id,
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
          return c.json({ error: "Ativo nao encontrado" }, decision.status);
        }

        // `decision.allowed` guarantees a row matched; narrow explicitly for TS.
        if (!existing) {
          return c.json({ error: "Ativo nao encontrado" }, 404);
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

        await db
          .update(asset)
          .set({
            calibrationIntervalMonths: intervalMonths,
            intervalSetBy,
            intervalSetByUserId: session.user.id,
            intervalSetAt: new Date(),
            intervalRationale: rationale,
            nextCalibrationDate,
          })
          // Defense-in-depth (SEC-08): the portal tenant boundary is the customer
          // (asset has no organizationId; org is derived via unit). Repeat the
          // exact scope `decidePortalIntervalWrite` already proved — the asset's
          // customer must be in the caller's in-scope set — so the UPDATE stays
          // customer-scoped even if that guard is refactored away.
          .where(
            and(eq(asset.id, id), inArray(asset.customerId, scopedCustomerIds)),
          );

        await db.insert(assetAuditLog).values({
          assetId: id,
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
          performedBy: session.user.id,
          ipAddress:
            c.req.header("x-forwarded-for") ??
            c.req.header("x-real-ip") ??
            null,
          reason: rationale,
        });

        return c.json({
          id,
          calibrationIntervalMonths: intervalMonths,
          nextCalibrationDate,
          intervalSetBy,
        });
      } catch (error) {
        console.error("Error setting calibration interval:", error);
        return c.json({ error: "Erro ao salvar periodicidade" }, 500);
      }
    },
  )

  .put(
    "/notification-preferences",
    ...requirePortalProtected,
    zValidator("json", PortalNotificationPreferencesSchema),
    async (c) => {
      const session = c.get("session");
      const portalLabScope = await getPortalLabScope(c);
      if (portalLabScope.blocked) {
        return c.json({ error: "Acesso nao permitido neste dominio" }, 403);
      }

      const { digestFrequency } = c.req.valid("json");

      try {
        await db
          .insert(notificationPreference)
          .values({
            userId: session.user.id,
            preferences: DEFAULT_PREFERENCES,
            digestFrequency,
          })
          .onConflictDoUpdate({
            target: notificationPreference.userId,
            set: { digestFrequency },
          });

        return c.json({ digestFrequency });
      } catch (error) {
        console.error("Error saving portal notification preferences:", error);
        return c.json({ error: "Erro ao salvar preferências" }, 500);
      }
    },
  )

  // =========================================================================
  // GET /certificates - List certificates for portal user
  // =========================================================================
  // Returns approved calibration jobs (certificates) for the authenticated
  // portal user's organizations.
  // =========================================================================
  .get("/certificates", ...requirePortalProtected, async (c) => {
    const session = c.get("session");
    const portalLabScope = await getPortalLabScope(c);
    if (portalLabScope.blocked) {
      return c.json({ error: "Acesso nao permitido neste dominio" }, 403);
    }

    try {
      // Parse pagination params
      const page = Math.max(1, parseInt(c.req.query("page") || "1"));
      const limit = Math.min(
        100,
        Math.max(1, parseInt(c.req.query("limit") || "20")),
      );
      const offset = (page - 1) * limit;
      const query = c.req.query("query")?.trim();
      const dateFrom = c.req.query("dateFrom");
      const dateTo = c.req.query("dateTo");

      // Per-instrument archive: scope the certificate list to one asset.
      // Tenant safety is unchanged — the customerIds condition below still
      // applies, so a foreign assetId just yields an empty page.
      const assetIdParam = c.req.query("assetId")?.trim();
      const assetId = assetIdParam
        ? Number.parseInt(assetIdParam, 10)
        : undefined;
      if (assetIdParam && Number.isNaN(assetId)) {
        return c.json({ error: "ID invalido" }, 400);
      }

      // All customers this user can access (direct branch orgs + group orgs).
      const customerIds = await resolvePortalAccessibleCustomerIds({
        userId: session.user.id,
        labScope: portalLabScope.labOrganizationId,
      });

      if (customerIds.length === 0) {
        return c.json({
          data: [],
          pagination: { page, limit, total: 0, totalPages: 0 },
        });
      }

      const approvedAtPortalDate = sql`(${calibrationJob.approvedAt} AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date`;

      const whereCondition = and(
        inArray(calibrationJob.customerId, customerIds),
        eq(calibrationJob.status, "APPROVED"),
        assetId !== undefined ? eq(calibrationJob.assetId, assetId) : undefined,
        query
          ? or(
              ilike(calibrationJob.jobId, `%${query}%`),
              ilike(calibrationJob.certificateName, `%${query}%`),
              ilike(asset.name, `%${query}%`),
              ilike(asset.tag, `%${query}%`),
              ilike(asset.serialNumber, `%${query}%`),
              ilike(asset.manufacturer, `%${query}%`),
              ilike(service.name, `%${query}%`),
            )
          : undefined,
        dateFrom ? sql`${approvedAtPortalDate} >= ${dateFrom}` : undefined,
        dateTo ? sql`${approvedAtPortalDate} <= ${dateTo}` : undefined,
      );

      // Count total certificates
      const [totalResult] = await db
        .select({ count: count() })
        .from(calibrationJob)
        .innerJoin(asset, eq(calibrationJob.assetId, asset.id))
        .innerJoin(service, eq(calibrationJob.serviceId, service.id))
        .where(whereCondition);

      const total = totalResult?.count ?? 0;

      // Get certificates with pagination
      const certificatesRaw = await db
        .select({
          id: calibrationJob.id,
          jobId: calibrationJob.jobId,
          certificateName: calibrationJob.certificateName,
          status: calibrationJob.status,
          performedAt: calibrationJob.performedAt,
          approvedAt: calibrationJob.approvedAt,
          certificateUrl: calibrationJob.certificateUrl,
          verificationToken: calibrationJob.verificationToken,
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

      // Phase 2 slice 1: hide certificateUrl for held releases.
      const certificates = await applyPortalCertificateReleaseGate(
        certificatesRaw,
        portalLabScope.labOrganizationId,
      );

      return c.json({
        data: certificates,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      console.error("Error listing portal certificates:", error);
      return c.json({ error: "Erro ao listar certificados" }, 500);
    }
  })

  // =========================================================================
  // GET /certificates/:id - Get single certificate details
  // =========================================================================
  .get("/certificates/:id", ...requirePortalProtected, async (c) => {
    const session = c.get("session");
    const portalLabScope = await getPortalLabScope(c);
    if (portalLabScope.blocked) {
      return c.json({ error: "Acesso nao permitido neste dominio" }, 403);
    }
    const certificateParam = c.req.param("id");

    try {
      const customerIds = await resolvePortalAccessibleCustomerIds({
        userId: session.user.id,
        labScope: portalLabScope.labOrganizationId,
      });

      if (customerIds.length === 0) {
        return c.json({ error: "Certificado nao encontrado" }, 404);
      }

      // Get certificate with all details
      const [certificate] = await db
        .select({
          id: calibrationJob.id,
          jobId: calibrationJob.jobId,
          status: calibrationJob.status,
          performedAt: calibrationJob.performedAt,
          approvedAt: calibrationJob.approvedAt,
          dueDate: calibrationJob.dueDate,
          certificateUrl: calibrationJob.certificateUrl,
          verificationToken: calibrationJob.verificationToken,
          methodSnapshot: calibrationJob.methodSnapshot,
          standardsSnapshot: calibrationJob.standardsSnapshot,
          calibrationLocationSnapshot:
            calibrationJob.calibrationLocationSnapshot,
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
          serviceMethodAccreditedScope: calibrationMethod.accreditedScope,
          labAccreditationActive: organization.accreditationActive,
          labAccreditationNumber: organization.accreditationNumber,
          labAccreditationValidFrom: organization.accreditationValidFrom,
          labAccreditationValidUntil: organization.accreditationValidUntil,
        })
        .from(calibrationJob)
        .innerJoin(asset, eq(calibrationJob.assetId, asset.id))
        .innerJoin(service, eq(calibrationJob.serviceId, service.id))
        .innerJoin(
          organization,
          eq(calibrationJob.organizationId, organization.id),
        )
        .leftJoin(calibrationMethod, eq(service.methodId, calibrationMethod.id))
        .where(
          and(
            matchPortalCertificateParam(certificateParam),
            inArray(calibrationJob.customerId, customerIds),
            eq(calibrationJob.status, "APPROVED"),
          ),
        )
        .limit(1);

      if (!certificate) {
        return c.json({ error: "Certificado nao encontrado" }, 404);
      }

      const referenceStandards = await withMatchingPortalStandardDocuments(
        normalizePortalReferenceStandards(certificate.standardsSnapshot),
      );

      // Phase 2 slice 1: hide certificateUrl when the release is held.
      const [gated] = await applyPortalCertificateReleaseGate(
        [certificate],
        portalLabScope.labOrganizationId,
      );
      const releaseStatus = gated?.releaseStatus ?? "RELEASED";

      // #647: vigência evaluated at the certificate's EMISSION date.
      const accredited = shouldRenderAccreditationSeal({
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
        ...(certificate.approvedAt ? { atDate: certificate.approvedAt } : {}),
      });

      const verdict = buildPortalCertificateVerdict({
        results: certificate.results,
        formulas: certificate.methodSnapshot?.formulas,
      });

      // Surface where the calibration was performed (frozen at execution).
      const locationSnapshot = certificate.calibrationLocationSnapshot;
      const onSite = {
        executedOnSite: locationSnapshot?.type === "customer_site",
        addressText: locationSnapshot?.addressText?.trim() || null,
      };

      return c.json({
        ...certificate,
        certificateUrl:
          releaseStatus === "PAYMENT_PENDING"
            ? null
            : certificate.certificateUrl,
        releaseStatus,
        verdict,
        onSite,
        standardsSnapshot: undefined,
        calibrationLocationSnapshot: undefined,
        referenceStandards,
        accreditation: {
          accredited,
          number: accredited
            ? normalizeAccreditationNumber(
                certificate.labAccreditationNumber ?? "",
              )
            : null,
        },
        serviceMethodAccreditedScope: undefined,
        labAccreditationActive: undefined,
        labAccreditationNumber: undefined,
        labAccreditationValidFrom: undefined,
        labAccreditationValidUntil: undefined,
      });
    } catch (error) {
      console.error("Error fetching portal certificate:", error);
      return c.json({ error: "Erro ao buscar certificado" }, 500);
    }
  })

  // =========================================================================
  // GET /certificates/:id/download - Get download URL for certificate
  // =========================================================================
  .get("/certificates/:id/download", ...requirePortalProtected, async (c) => {
    const session = c.get("session");
    const portalLabScope = await getPortalLabScope(c);
    if (portalLabScope.blocked) {
      return c.json({ error: "Acesso nao permitido neste dominio" }, 403);
    }
    const certificateParam = c.req.param("id");

    try {
      const customerIds = await resolvePortalAccessibleCustomerIds({
        userId: session.user.id,
        labScope: portalLabScope.labOrganizationId,
      });

      if (customerIds.length === 0) {
        return c.json({ error: "Certificado nao encontrado" }, 404);
      }

      // Get certificate
      const [certificate] = await db
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
            eq(calibrationJob.status, "APPROVED"),
          ),
        )
        .limit(1);

      if (!certificate) {
        return c.json({ error: "Certificado nao encontrado" }, 404);
      }

      // Phase 2 slice 1: deny download when the release is held for billing
      // or for payment. Customer-facing copy is provider-neutral.
      const releaseStatuses = await loadPortalReleaseStatuses({
        organizationId: portalLabScope.labOrganizationId,
        calibrationJobIds: [certificate.id],
      });
      const portalReleaseStatus =
        releaseStatuses.get(certificate.id) ?? "RELEASED";
      if (portalReleaseStatus === "PAYMENT_PENDING") {
        return c.json(
          { error: "Certificado aguardando confirmação financeira" },
          409,
        );
      }

      if (!certificate.certificateUrl) {
        return c.json({ error: "Documento ainda nao disponivel" }, 400);
      }

      const env = c.env;
      const key = extractKeyFromUrl(certificate.certificateUrl);
      const client = createR2Client(env);
      const filename = `${sanitizeCertificateFilename(certificate.certificateName || `certificado-${certificate.jobId}`)}.pdf`;
      const url = await generatePresignedUrl(client, env.R2_BUCKET_NAME, key, {
        responseContentDisposition: attachmentDisposition(filename),
      });

      return c.json({ url, filename });
    } catch (error) {
      console.error("Error generating certificate download URL:", error);
      return c.json({ error: "Erro ao gerar link de download" }, 500);
    }
  })

  // =========================================================================
  // POST /audit-packs - Request an audit pack (async bulk export, #738)
  // =========================================================================
  // Enqueues an AUDIT_PACK background job that builds a ZIP with every
  // RELEASED certificate in the period + a fleet-status report + a
  // verification-links index. The certificate release gate is applied here
  // (fail fast on an empty/oversized selection) AND again inside the worker
  // at generation time, since release statuses can change in between.
  // =========================================================================
  .post(
    "/audit-packs",
    ...requirePortalProtected,
    requirePermission({ certificate: ["read"] }),
    zValidator("json", PortalAuditPackRequestSchema),
    async (c) => {
      const session = c.get("session");
      const portalMember = c.get("member");
      const portalLabScope = await getPortalLabScope(c);
      if (portalLabScope.blocked) {
        return c.json({ error: "Acesso nao permitido neste dominio" }, 403);
      }
      const body = c.req.valid("json");

      try {
        const scope = await resolvePortalCustomerScope({
          activeOrgId: portalMember.organizationId,
          labScope: portalLabScope.labOrganizationId,
        });
        if (!scope || scope.customerIds.length === 0) {
          return c.json({ error: "Nenhum cliente vinculado" }, 400);
        }

        const customerIds = applyUnitFilter(scope, body.unitId);
        if (customerIds.length === 0) {
          return c.json({ error: "Unidade inválida" }, 400);
        }

        // Candidate set: latest (non-superseded) approved certificates whose
        // approval date falls in the requested window. Same timezone
        // semantics as the /certificates list.
        const approvedAtPortalDate = sql`(${calibrationJob.approvedAt} AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date`;
        const candidates = await db
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
          .limit(AUDIT_PACK_MAX_CERTIFICATES + 1);

        if (candidates.length > AUDIT_PACK_MAX_CERTIFICATES) {
          return c.json(
            {
              error: `O período selecionado tem mais de ${AUDIT_PACK_MAX_CERTIFICATES} certificados. Reduza o período e gere pacotes menores.`,
            },
            400,
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
          return c.json(
            {
              error: "Nenhum certificado disponível no período selecionado.",
            },
            400,
          );
        }

        const [exportRow] = await db
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

        if (!exportRow) {
          return c.json({ error: "Erro ao solicitar o pacote" }, 500);
        }

        await enqueueBackgroundJob(
          {
            type: "AUDIT_PACK",
            exportId: exportRow.id,
            userId: session.user.id,
          },
          { idempotencyKey: `audit-pack-${exportRow.id}` },
        );

        return c.json({ id: exportRow.id, status: "PENDING" }, 201);
      } catch (error) {
        console.error("Error requesting portal audit pack:", error);
        return c.json({ error: "Erro ao solicitar o pacote" }, 500);
      }
    },
  )

  // =========================================================================
  // GET /audit-packs - List audit packs requested by the active portal org
  // =========================================================================
  .get("/audit-packs", ...requirePortalProtected, async (c) => {
    const portalMember = c.get("member");
    const portalLabScope = await getPortalLabScope(c);
    if (portalLabScope.blocked) {
      return c.json({ error: "Acesso nao permitido neste dominio" }, 403);
    }

    try {
      const scope = await resolvePortalCustomerScope({
        activeOrgId: portalMember.organizationId,
        labScope: portalLabScope.labOrganizationId,
      });
      if (!scope) {
        return c.json({ data: [] });
      }

      const rows = await db
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
          and(
            eq(portalExportJob.authOrganizationId, portalMember.organizationId),
            eq(portalExportJob.labOrganizationId, scope.labOrganizationId),
          ),
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

      return c.json({ data });
    } catch (error) {
      console.error("Error listing portal audit packs:", error);
      return c.json({ error: "Erro ao listar pacotes de auditoria" }, 500);
    }
  })

  // =========================================================================
  // GET /audit-packs/:id/download - Presigned download URL for a ready pack
  // =========================================================================
  .get("/audit-packs/:id/download", ...requirePortalProtected, async (c) => {
    const portalMember = c.get("member");
    const portalLabScope = await getPortalLabScope(c);
    if (portalLabScope.blocked) {
      return c.json({ error: "Acesso nao permitido neste dominio" }, 403);
    }
    const id = Number.parseInt(c.req.param("id"), 10);
    if (Number.isNaN(id)) {
      return c.json({ error: "ID invalido" }, 400);
    }

    try {
      const [row] = await db
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
            portalLabScope.labOrganizationId
              ? eq(
                  portalExportJob.labOrganizationId,
                  portalLabScope.labOrganizationId,
                )
              : undefined,
          ),
        )
        .limit(1);

      if (!row) {
        return c.json({ error: "Pacote nao encontrado" }, 404);
      }
      if (row.status !== "COMPLETED" || !row.r2Key) {
        return c.json({ error: "Pacote ainda nao disponivel" }, 400);
      }
      if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
        return c.json(
          { error: "Pacote expirado. Gere um novo pacote de auditoria." },
          410,
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
          return c.json(
            {
              error:
                "Um ou mais certificados deste pacote aguardam confirmação financeira. Gere um novo pacote.",
            },
            409,
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

      return c.json({ url, filename });
    } catch (error) {
      console.error("Error generating audit pack download URL:", error);
      return c.json({ error: "Erro ao gerar link de download" }, 500);
    }
  })

  // =========================================================================
  // GET /notifications - §7.10 out-of-tolerance notifications addressed to
  // this portal customer (#426 Phase 2). Opaque id = the notification's
  // ackToken (already the customer's ack credential in the e-mail link).
  // =========================================================================
  .get("/notifications", ...requirePortalProtected, async (c) => {
    const portalMember = c.get("member");
    const portalLabScope = await getPortalLabScope(c);
    if (portalLabScope.blocked) {
      return c.json({ error: "Acesso nao permitido neste dominio" }, 403);
    }

    try {
      const scope = await resolvePortalCustomerScope({
        activeOrgId: portalMember.organizationId,
        labScope: portalLabScope.labOrganizationId,
      });
      if (!scope || scope.customerIds.length === 0) {
        return c.json({ data: [], counts: { total: 0, pending: 0 } });
      }

      const rows = await db
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
        .where(
          and(
            eq(ootNotification.organizationId, scope.labOrganizationId),
            inArray(calibrationJob.customerId, scope.customerIds),
          ),
        )
        .orderBy(desc(ootNotification.createdAt))
        .limit(100);

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

      return c.json({
        data,
        counts: {
          total: data.length,
          pending: data.filter((row) => row.acknowledgedAt === null).length,
        },
      });
    } catch (error) {
      console.error("Error listing portal OOT notifications:", error);
      return c.json({ error: "Erro ao listar notificações" }, 500);
    }
  })

  // =========================================================================
  // POST /notifications/:token/acknowledge - Registers receipt from the
  // authenticated portal (acknowledgedVia portal_link). Idempotent; the WHERE
  // re-checks customer scope so a token from another org can never be stamped.
  // =========================================================================
  .post(
    "/notifications/:token/acknowledge",
    ...requirePortalProtected,
    async (c) => {
      const portalMember = c.get("member");
      const portalLabScope = await getPortalLabScope(c);
      if (portalLabScope.blocked) {
        return c.json({ error: "Acesso nao permitido neste dominio" }, 403);
      }
      const token = c.req.param("token");

      try {
        const scope = await resolvePortalCustomerScope({
          activeOrgId: portalMember.organizationId,
          labScope: portalLabScope.labOrganizationId,
        });
        if (!scope || scope.customerIds.length === 0) {
          return c.json({ error: "Notificação não encontrada" }, 404);
        }

        const [notification] = await db
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
              eq(ootNotification.organizationId, scope.labOrganizationId),
              inArray(calibrationJob.customerId, scope.customerIds),
            ),
          )
          .limit(1);

        if (!notification) {
          return c.json({ error: "Notificação não encontrada" }, 404);
        }

        if (!notification.acknowledgedAt) {
          const [updated] = await db
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
              ),
            )
            .returning();

          if (updated) {
            notifyOotAcknowledged(
              notification.id,
              notification.ncId,
              notification.ncNumber,
              notification.organizationId,
            ).catch((err) =>
              console.error(
                "[Portal] Failed to notify OOT acknowledgement:",
                err,
              ),
            );
          }
        }

        return c.json({ message: "Recebimento confirmado" });
      } catch (error) {
        console.error("Error acknowledging portal OOT notification:", error);
        return c.json({ error: "Erro ao confirmar recebimento" }, 500);
      }
    },
  )

  // =========================================================================
  // GET /certificates/:id/reference-standards/:standardId/certificate/download
  // =========================================================================
  .get(
    "/certificates/:id/reference-standards/:standardId/certificate/download",
    ...requirePortalProtected,
    async (c) => {
      const session = c.get("session");
      const portalLabScope = await getPortalLabScope(c);
      if (portalLabScope.blocked) {
        return c.json({ error: "Acesso nao permitido neste dominio" }, 403);
      }
      const certificateParam = c.req.param("id");
      const standardId = parseInt(c.req.param("standardId"));

      if (isNaN(standardId)) {
        return c.json({ error: "ID invalido" }, 400);
      }

      try {
        const customerIds = await resolvePortalAccessibleCustomerIds({
          userId: session.user.id,
          labScope: portalLabScope.labOrganizationId,
        });

        if (customerIds.length === 0) {
          return c.json({ error: "Certificado nao encontrado" }, 404);
        }

        const [certificate] = await db
          .select({
            standardsSnapshot: calibrationJob.standardsSnapshot,
          })
          .from(calibrationJob)
          .where(
            and(
              matchPortalCertificateParam(certificateParam),
              inArray(calibrationJob.customerId, customerIds),
              eq(calibrationJob.status, "APPROVED"),
            ),
          )
          .limit(1);

        if (!certificate) {
          return c.json({ error: "Certificado nao encontrado" }, 404);
        }

        const standard = normalizePortalReferenceStandards(
          certificate.standardsSnapshot,
        ).find((item) => item.id === standardId);

        if (!standard) {
          return c.json({ error: "Padrão não encontrado" }, 404);
        }

        let document = standard.certificateDocument;
        if (!document) {
          const [matchingDocument] = await db
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
                finalizedStandardCertificateDocumentCondition(),
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
          return c.json({ error: "Certificado do padrão não disponível" }, 404);
        }

        const env = c.env;
        const client = createR2Client(env);
        const url = await generatePresignedUrl(
          client,
          env.R2_BUCKET_NAME,
          document.r2Key,
        );

        return c.json({ url, filename: document.fileName });
      } catch (error) {
        console.error("Error generating standard certificate URL:", error);
        return c.json({ error: "Erro ao gerar link de download" }, 500);
      }
    },
  )

  // =========================================================================
  // GET /analytics/fleet - fleet reliability analytics (#740 Track A)
  // =========================================================================
  // Aggregates the lab-computed as-found verdicts (never recomputed here —
  // ISO/IEC 17025 §7.8.6 / ILAC-G8): OOT rate trend, per-type breakdown and
  // worst offenders. Rates use KNOWN cycles only; the UNKNOWN share and the
  // LEGAL-regime exclusion are always reported so nothing is overstated.
  // =========================================================================
  .get(
    "/analytics/fleet",
    ...requirePortalProtected,
    requirePermission({ equipment: ["read"] }),
    zValidator("query", FleetAnalyticsQuerySchema),
    async (c) => {
      const portalMember = c.get("member");
      const portalLabScope = await getPortalLabScope(c);
      if (portalLabScope.blocked) {
        return c.json({ error: "Acesso nao permitido neste dominio" }, 403);
      }
      const { periodMonths, bucket, assetTypeId, unitId } =
        c.req.valid("query");

      try {
        const scope = await resolvePortalCustomerScope({
          activeOrgId: portalMember.organizationId,
          labScope: portalLabScope.labOrganizationId,
        });
        if (!scope || scope.customerIds.length === 0) {
          return c.json({ error: "Cliente nao encontrado" }, 404);
        }
        const customerIds = applyUnitFilter(scope, unitId);
        if (customerIds.length === 0) {
          return c.json({ error: "Unidade nao encontrada" }, 404);
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

        const rows = await db
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
          .where(and(...conditions));

        const summary = buildFleetReliabilitySummary(rows, { bucket });

        return c.json({
          mode: scope.mode,
          period: {
            from: from.toISOString(),
            to: to.toISOString(),
            bucket,
          },
          ...summary,
          attribution:
            "Pareceres de conformidade conforme a regra de decisão aplicada pelo laboratório em cada certificado; o portal reproduz os pareceres sem reavaliação.",
        });
      } catch (error) {
        console.error("Error building fleet analytics:", error);
        return c.json({ error: "Erro ao calcular indicadores da frota" }, 500);
      }
    },
  )

  // =========================================================================
  // GET /assets/:id/drift-series - matched-point as-found margin series (#740)
  // =========================================================================
  // The data drift.ts regresses, exposed for the portal drift chart: per
  // positional point, the signed margin toward the 0 tolerance limit over
  // time + OLS regression. Degrades honestly: cycles without margins are
  // reported in coverage and simply absent from the series.
  // =========================================================================
  .get(
    "/assets/:id/drift-series",
    ...requirePortalProtected,
    requirePermission({ equipment: ["read"] }),
    async (c) => {
      const portalMember = c.get("member");
      const portalLabScope = await getPortalLabScope(c);
      if (portalLabScope.blocked) {
        return c.json({ error: "Acesso nao permitido neste dominio" }, 403);
      }
      const id = await resolvePortalAssetIdParam(c.req.param("id"));
      if (id === null) {
        return c.json({ error: "Ativo nao encontrado" }, 404);
      }

      try {
        const scope = await resolvePortalCustomerScope({
          activeOrgId: portalMember.organizationId,
          labScope: portalLabScope.labOrganizationId,
        });
        if (!scope || scope.customerIds.length === 0) {
          return c.json({ error: "Ativo nao encontrado" }, 404);
        }

        const [existing] = await db
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
          return c.json({ error: "Ativo nao encontrado" }, 404);
        }

        const rows = await db
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

        return c.json({
          assetId: id,
          ...buildAssetDriftSeries(rows),
          attribution:
            "Margens conforme os resultados “como recebido” do certificado; parecer de conformidade do laboratório, reproduzido sem reavaliação.",
        });
      } catch (error) {
        console.error("Error building drift series:", error);
        return c.json({ error: "Erro ao montar série de deriva" }, 500);
      }
    },
  )

  // =========================================================================
  // GET /oot-events - customer's out-of-tolerance events (#740 Track B)
  // =========================================================================
  .get(
    "/oot-events",
    ...requirePortalProtected,
    requirePermission({ equipment: ["read"] }),
    zValidator(
      "query",
      z.object({
        status: z.enum(["OPEN", "ASSESSED"]).optional(),
        unitId: z.coerce.number().int().positive().optional(),
      }),
    ),
    async (c) => {
      const portalMember = c.get("member");
      const portalLabScope = await getPortalLabScope(c);
      if (portalLabScope.blocked) {
        return c.json({ error: "Acesso nao permitido neste dominio" }, 403);
      }
      const { status, unitId } = c.req.valid("query");

      try {
        const scope = await resolvePortalCustomerScope({
          activeOrgId: portalMember.organizationId,
          labScope: portalLabScope.labOrganizationId,
        });
        if (!scope || scope.customerIds.length === 0) {
          return c.json({ data: [] });
        }
        const customerIds = applyUnitFilter(scope, unitId);
        if (customerIds.length === 0) {
          return c.json({ data: [] });
        }

        const conditions = [inArray(assetOotEvent.customerId, customerIds)];
        if (status) {
          conditions.push(eq(assetOotEvent.status, status));
        }

        const events = await db
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
            assessmentCustomerNotified:
              assetOotImpactAssessment.customerNotified,
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
          .orderBy(desc(assetOotEvent.detectedAt));

        return c.json({ data: events });
      } catch (error) {
        console.error("Error listing OOT events:", error);
        return c.json({ error: "Erro ao listar eventos" }, 500);
      }
    },
  )

  // =========================================================================
  // POST /oot-events/:id/assessment - record the customer's impact assessment
  // =========================================================================
  // ISO 9001:2015 §7.1.5.2 / IATF 16949 §7.1.5.2.1. The record is the
  // CUSTOMER'S own audit evidence — append-only with actor/ip/user-agent.
  // =========================================================================
  .post(
    "/oot-events/:id/assessment",
    ...requirePortalProtected,
    requirePermission({ equipment: ["update"] }),
    zValidator("json", RecordOotImpactAssessmentSchema),
    async (c) => {
      const portalMember = c.get("member");
      const session = c.get("session");
      const portalLabScope = await getPortalLabScope(c);
      if (portalLabScope.blocked) {
        return c.json({ error: "Acesso nao permitido neste dominio" }, 403);
      }
      const id = Number.parseInt(c.req.param("id"), 10);
      if (Number.isNaN(id)) {
        return c.json({ error: "ID invalido" }, 400);
      }
      const input = c.req.valid("json");

      try {
        const scope = await resolvePortalCustomerScope({
          activeOrgId: portalMember.organizationId,
          labScope: portalLabScope.labOrganizationId,
        });
        if (!scope || scope.customerIds.length === 0) {
          return c.json({ error: "Evento nao encontrado" }, 404);
        }

        const [event] = await db
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
          return c.json({ error: "Evento nao encontrado" }, 404);
        }

        const [existingAssessment] = await db
          .select({ id: assetOotImpactAssessment.id })
          .from(assetOotImpactAssessment)
          .where(eq(assetOotImpactAssessment.eventId, id))
          .limit(1);
        if (existingAssessment) {
          return c.json(
            { error: "Avaliação de impacto já registrada para este evento" },
            400,
          );
        }

        const ipAddress =
          c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip") ?? null;
        const userAgent = c.req.header("user-agent") ?? null;

        const [assessment] = await db
          .insert(assetOotImpactAssessment)
          .values({
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
            ipAddress,
            userAgent,
          })
          .returning();

        await db
          .update(assetOotEvent)
          .set({ status: "ASSESSED" })
          .where(
            and(
              eq(assetOotEvent.id, id),
              inArray(assetOotEvent.customerId, scope.customerIds),
            ),
          );

        await db.insert(assetOotAuditLog).values({
          eventId: id,
          action: "assess",
          changes: {
            decision: input.decision,
            affectedPeriodStart: input.affectedPeriodStart ?? null,
            affectedPeriodEnd: input.affectedPeriodEnd ?? null,
            suspectProductShipped: input.suspectProductShipped ?? null,
            customerNotified: input.customerNotified ?? null,
          },
          performedBy: session.user.id,
          ipAddress,
          userAgent,
        });

        return c.json(
          {
            message: "Avaliação registrada",
            data: { event: { ...event, status: "ASSESSED" }, assessment },
          },
          201,
        );
      } catch (error) {
        console.error("Error recording OOT assessment:", error);
        return c.json({ error: "Erro ao registrar avaliação" }, 500);
      }
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
