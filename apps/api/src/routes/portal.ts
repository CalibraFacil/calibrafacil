import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { db } from "@calibra-facil/db";
import {
  member,
  organization,
  customer,
  customerGroup,
  calibrationJob,
  calibrationMethod,
  calibrationRequest,
  calibrationRequestItem,
  serviceOrder,
  asset,
  assetType,
  service,
  referenceStandardCertificateDocument,
  notificationPreference,
} from "@calibra-facil/db/schema";
import { DEFAULT_PREFERENCES } from "../lib/notification-defaults";
import { PORTAL_ACCESS_ROLES } from "@calibra-facil/auth/access";
import {
  eq,
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
import { ListAssetsQuerySchema } from "@calibra-facil/schemas";
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
      const id = Number.parseInt(c.req.param("id"), 10);

      if (Number.isNaN(id)) {
        return c.json({ error: "ID invalido" }, 400);
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
  .get("/certificates", requirePortalAuth, async (c) => {
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
  .get("/certificates/:id", requirePortalAuth, async (c) => {
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

      const accredited = shouldRenderAccreditationSeal({
        lab: {
          accreditationActive: certificate.labAccreditationActive,
          accreditationNumber: certificate.labAccreditationNumber,
        },
        methodAccreditedScope:
          certificate.methodSnapshot?.accreditedScope ??
          certificate.serviceMethodAccreditedScope ??
          false,
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
      });
    } catch (error) {
      console.error("Error fetching portal certificate:", error);
      return c.json({ error: "Erro ao buscar certificado" }, 500);
    }
  })

  // =========================================================================
  // GET /certificates/:id/download - Get download URL for certificate
  // =========================================================================
  .get("/certificates/:id/download", requirePortalAuth, async (c) => {
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
  // GET /certificates/:id/reference-standards/:standardId/certificate/download
  // =========================================================================
  .get(
    "/certificates/:id/reference-standards/:standardId/certificate/download",
    requirePortalAuth,
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
