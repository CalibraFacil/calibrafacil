import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { db } from "@calibra-facil/db";
import {
  member,
  organization,
  customer,
  calibrationJob,
  asset,
  assetType,
  service,
  referenceStandardCertificateDocument,
} from "@calibra-facil/db/schema";
import { PORTAL_ACCESS_ROLES } from "@calibra-facil/auth/access";
import {
  eq,
  and,
  inArray,
  desc,
  like,
  not,
  count,
  isNull,
  ilike,
  or,
  sql,
} from "drizzle-orm";
import { ListAssetsQuerySchema } from "@calibra-facil/schemas";
import {
  requirePortalAuth,
  requirePermission,
  requirePortalProtected,
  type AuthVariables,
} from "../middleware/permission";
import {
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
      // Query member table joined with organization
      // Filter by user ID, organization type CLIENT, and external portal roles
      const clientOrganizations = await db
        .select({
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
          logo: organization.logo,
          type: organization.type,
          createdAt: organization.createdAt,
          memberRole: member.role,
        })
        .from(member)
        .innerJoin(organization, eq(member.organizationId, organization.id))
        .leftJoin(customer, eq(customer.authOrganizationId, organization.id))
        .where(
          and(
            eq(member.userId, session.user.id),
            eq(organization.type, "CLIENT"),
            inArray(member.role, PORTAL_ACCESS_ROLES),
            portalLabScope.labOrganizationId
              ? eq(customer.labOrganizationId, portalLabScope.labOrganizationId)
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
  // GET /assets - List assets for active portal organization
  // =========================================================================
  .get(
    "/assets",
    ...requirePortalProtected,
    requirePermission({ equipment: ["read"] }),
    zValidator("query", ListAssetsQuerySchema),
    async (c) => {
      const member = c.get("member");
      const portalLabScope = await getPortalLabScope(c);
      if (portalLabScope.blocked) {
        return c.json({ error: "Acesso nao permitido neste dominio" }, 403);
      }

      try {
        const { page, limit, query } = c.req.valid("query");
        const offset = (page - 1) * limit;

        const [linkedCustomer] = await db
          .select({
            id: customer.id,
            labOrganizationId: customer.labOrganizationId,
          })
          .from(customer)
          .where(eq(customer.authOrganizationId, member.organizationId))
          .limit(1);

        if (!linkedCustomer) {
          return c.json({
            data: [],
            pagination: { page, limit, total: 0, totalPages: 0 },
          });
        }

        if (
          portalLabScope.labOrganizationId &&
          linkedCustomer.labOrganizationId !== portalLabScope.labOrganizationId
        ) {
          return c.json({ error: "Acesso nao permitido neste dominio" }, 403);
        }

        const whereCondition = and(
          eq(asset.customerId, linkedCustomer.id),
          eq(asset.status, "ACTIVE"),
          isNull(asset.deletedAt),
          query
            ? or(
                ilike(asset.name, `%${query}%`),
                ilike(asset.tag, `%${query}%`),
                ilike(asset.serialNumber, `%${query}%`),
                ilike(asset.manufacturer, `%${query}%`),
                ilike(asset.model, `%${query}%`),
              )
            : undefined,
        );

        const [countResult] = await db
          .select({ total: count() })
          .from(asset)
          .where(whereCondition);

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
            comments: asset.comments,
            createdAt: asset.createdAt,
            updatedAt: asset.updatedAt,
          })
          .from(asset)
          .innerJoin(customer, eq(asset.customerId, customer.id))
          .leftJoin(assetType, eq(asset.assetTypeId, assetType.id))
          .where(whereCondition)
          .orderBy(asset.tag)
          .limit(limit)
          .offset(offset);

        return c.json({
          data: assets.map((assetItem) => ({
            ...assetItem,
            specifications:
              denormalizeAssetSpecificationsForResponse({
                specifications: assetItem.specifications,
                definition: assetItem.assetTypeDefinition,
                baseMeasurementUnit: assetItem.baseMeasurementUnit,
              }) ?? null,
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
        const [linkedCustomer] = await db
          .select({
            id: customer.id,
            labOrganizationId: customer.labOrganizationId,
          })
          .from(customer)
          .where(eq(customer.authOrganizationId, portalMember.organizationId))
          .limit(1);

        if (!linkedCustomer) {
          return c.json({ error: "Ativo nao encontrado" }, 404);
        }

        if (
          portalLabScope.labOrganizationId &&
          linkedCustomer.labOrganizationId !== portalLabScope.labOrganizationId
        ) {
          return c.json({ error: "Acesso nao permitido neste dominio" }, 403);
        }

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
              eq(asset.customerId, linkedCustomer.id),
              isNull(asset.deletedAt),
            ),
          )
          .limit(1);

        if (!assetDetails) {
          return c.json({ error: "Ativo nao encontrado" }, 404);
        }

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
          .where(
            and(
              eq(calibrationJob.assetId, assetDetails.id),
              eq(calibrationJob.customerId, linkedCustomer.id),
              eq(calibrationJob.status, "APPROVED"),
            ),
          )
          .orderBy(desc(calibrationJob.approvedAt))
          .limit(5);

        // Phase 2 slice 1: hide certificateUrl for held releases.
        const certificates = await applyPortalCertificateReleaseGate(
          certificatesRaw,
          linkedCustomer.labOrganizationId,
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
          },
        });
      } catch (error) {
        console.error("Error fetching portal asset:", error);
        return c.json({ error: "Erro ao buscar ativo" }, 500);
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

      // Get user's CLIENT organization IDs
      const userOrgs = await db
        .select({ orgId: member.organizationId })
        .from(member)
        .innerJoin(organization, eq(member.organizationId, organization.id))
        .where(
          and(
            eq(member.userId, session.user.id),
            eq(organization.type, "CLIENT"),
            inArray(member.role, PORTAL_ACCESS_ROLES),
          ),
        );

      if (userOrgs.length === 0) {
        return c.json({
          data: [],
          pagination: { page, limit, total: 0, totalPages: 0 },
        });
      }

      const orgIds = userOrgs.map((o) => o.orgId);

      // Get customers for these organizations
      const customers = await db
        .select({ id: customer.id })
        .from(customer)
        .where(
          and(
            inArray(customer.authOrganizationId, orgIds),
            portalLabScope.labOrganizationId
              ? eq(customer.labOrganizationId, portalLabScope.labOrganizationId)
              : undefined,
          ),
        );

      if (customers.length === 0) {
        return c.json({
          data: [],
          pagination: { page, limit, total: 0, totalPages: 0 },
        });
      }

      const customerIds = customers.map((cust) => cust.id);
      const approvedAtPortalDate = sql`(${calibrationJob.approvedAt} AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date`;

      const whereCondition = and(
        inArray(calibrationJob.customerId, customerIds),
        eq(calibrationJob.status, "APPROVED"),
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
    const id = parseInt(c.req.param("id"));

    if (isNaN(id)) {
      return c.json({ error: "ID invalido" }, 400);
    }

    try {
      // Get user's CLIENT organization IDs
      const userOrgs = await db
        .select({ orgId: member.organizationId })
        .from(member)
        .innerJoin(organization, eq(member.organizationId, organization.id))
        .where(
          and(
            eq(member.userId, session.user.id),
            eq(organization.type, "CLIENT"),
            inArray(member.role, PORTAL_ACCESS_ROLES),
          ),
        );

      if (userOrgs.length === 0) {
        return c.json({ error: "Certificado nao encontrado" }, 404);
      }

      const orgIds = userOrgs.map((o) => o.orgId);

      // Get customers for these organizations
      const customers = await db
        .select({ id: customer.id })
        .from(customer)
        .where(
          and(
            inArray(customer.authOrganizationId, orgIds),
            portalLabScope.labOrganizationId
              ? eq(customer.labOrganizationId, portalLabScope.labOrganizationId)
              : undefined,
          ),
        );

      if (customers.length === 0) {
        return c.json({ error: "Certificado nao encontrado" }, 404);
      }

      const customerIds = customers.map((cust) => cust.id);

      // Get certificate with all details
      const [certificate] = await db
        .select({
          id: calibrationJob.id,
          jobId: calibrationJob.jobId,
          status: calibrationJob.status,
          performedAt: calibrationJob.performedAt,
          approvedAt: calibrationJob.approvedAt,
          certificateUrl: calibrationJob.certificateUrl,
          verificationToken: calibrationJob.verificationToken,
          methodSnapshot: calibrationJob.methodSnapshot,
          standardsSnapshot: calibrationJob.standardsSnapshot,
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
        })
        .from(calibrationJob)
        .innerJoin(asset, eq(calibrationJob.assetId, asset.id))
        .innerJoin(service, eq(calibrationJob.serviceId, service.id))
        .innerJoin(
          organization,
          eq(calibrationJob.organizationId, organization.id),
        )
        .where(
          and(
            eq(calibrationJob.id, id),
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

      return c.json({
        ...certificate,
        certificateUrl:
          releaseStatus === "PAYMENT_PENDING"
            ? null
            : certificate.certificateUrl,
        releaseStatus,
        standardsSnapshot: undefined,
        referenceStandards,
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
    const id = parseInt(c.req.param("id"));

    if (isNaN(id)) {
      return c.json({ error: "ID invalido" }, 400);
    }

    try {
      // Get user's CLIENT organization IDs
      const userOrgs = await db
        .select({ orgId: member.organizationId })
        .from(member)
        .innerJoin(organization, eq(member.organizationId, organization.id))
        .where(
          and(
            eq(member.userId, session.user.id),
            eq(organization.type, "CLIENT"),
            inArray(member.role, PORTAL_ACCESS_ROLES),
          ),
        );

      if (userOrgs.length === 0) {
        return c.json({ error: "Certificado nao encontrado" }, 404);
      }

      const orgIds = userOrgs.map((o) => o.orgId);

      // Get customers for these organizations
      const customers = await db
        .select({ id: customer.id })
        .from(customer)
        .where(
          and(
            inArray(customer.authOrganizationId, orgIds),
            portalLabScope.labOrganizationId
              ? eq(customer.labOrganizationId, portalLabScope.labOrganizationId)
              : undefined,
          ),
        );

      if (customers.length === 0) {
        return c.json({ error: "Certificado nao encontrado" }, 404);
      }

      const customerIds = customers.map((cust) => cust.id);

      // Get certificate
      const [certificate] = await db
        .select({
          certificateUrl: calibrationJob.certificateUrl,
          jobId: calibrationJob.jobId,
          certificateName: calibrationJob.certificateName,
        })
        .from(calibrationJob)
        .where(
          and(
            eq(calibrationJob.id, id),
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
        calibrationJobIds: [id],
      });
      const portalReleaseStatus = releaseStatuses.get(id) ?? "RELEASED";
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
      const url = await generatePresignedUrl(client, env.R2_BUCKET_NAME, key);

      return c.json({
        url,
        filename: `${sanitizeCertificateFilename(certificate.certificateName || `certificado-${certificate.jobId}`)}.pdf`,
      });
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
      const id = parseInt(c.req.param("id"));
      const standardId = parseInt(c.req.param("standardId"));

      if (isNaN(id) || isNaN(standardId)) {
        return c.json({ error: "ID invalido" }, 400);
      }

      try {
        const userOrgs = await db
          .select({ orgId: member.organizationId })
          .from(member)
          .innerJoin(organization, eq(member.organizationId, organization.id))
          .where(
            and(
              eq(member.userId, session.user.id),
              eq(organization.type, "CLIENT"),
              inArray(member.role, PORTAL_ACCESS_ROLES),
            ),
          );

        if (userOrgs.length === 0) {
          return c.json({ error: "Certificado nao encontrado" }, 404);
        }

        const customers = await db
          .select({ id: customer.id })
          .from(customer)
          .where(
            and(
              inArray(
                customer.authOrganizationId,
                userOrgs.map((org) => org.orgId),
              ),
              portalLabScope.labOrganizationId
                ? eq(
                    customer.labOrganizationId,
                    portalLabScope.labOrganizationId,
                  )
                : undefined,
            ),
          );

        if (customers.length === 0) {
          return c.json({ error: "Certificado nao encontrado" }, 404);
        }

        const [certificate] = await db
          .select({
            standardsSnapshot: calibrationJob.standardsSnapshot,
          })
          .from(calibrationJob)
          .where(
            and(
              eq(calibrationJob.id, id),
              inArray(
                calibrationJob.customerId,
                customers.map((cust) => cust.id),
              ),
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
