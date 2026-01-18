import { Hono } from "hono";
import { db } from "@calibra-facil/db";
import {
  member,
  organization,
  customer,
  calibrationJob,
  asset,
  service,
} from "@calibra-facil/db/schema";
import { eq, and, inArray, desc, sql, count } from "drizzle-orm";
import {
  requirePortalAuth,
  type AuthVariables,
} from "../middleware/permission";
import {
  createR2Client,
  generatePresignedUrl,
  extractKeyFromUrl,
  type R2Env,
} from "../lib/storage";

/**
 * Portal routes - endpoints specific to the client portal.
 * These routes handle client-facing functionality.
 * Uses Portal auth (portal_session cookie) for authentication.
 */
export const portalRouter = new Hono<{ Variables: AuthVariables }>()
  // =========================================================================
  // GET /organizations - List CLIENT organizations for the portal
  // =========================================================================
  // Returns only organizations where:
  // 1. The organization type is "CLIENT"
  // 2. The user's role is "client_user" (not "owner" or other lab admin roles)
  //
  // This ensures lab admins (who create CLIENT orgs and become "owner")
  // don't see those orgs in the client portal.
  // =========================================================================
  .get("/organizations", requirePortalAuth, async (c) => {
    const session = c.get("session");

    try {
      // Query member table joined with organization
      // Filter by user ID, organization type CLIENT, and role client_user
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
        .where(
          and(
            eq(member.userId, session.user.id),
            eq(organization.type, "CLIENT"),
            eq(member.role, "client_user"),
          ),
        );

      return c.json(clientOrganizations);
    } catch (error) {
      console.error("Error listing portal organizations:", error);
      return c.json({ error: "Erro ao listar organizações" }, 500);
    }
  })

  // =========================================================================
  // GET /certificates - List certificates for portal user
  // =========================================================================
  // Returns approved calibration jobs (certificates) for the authenticated
  // portal user's organizations.
  // =========================================================================
  .get("/certificates", requirePortalAuth, async (c) => {
    const session = c.get("session");

    try {
      // Parse pagination params
      const page = Math.max(1, parseInt(c.req.query("page") || "1"));
      const limit = Math.min(100, Math.max(1, parseInt(c.req.query("limit") || "20")));
      const offset = (page - 1) * limit;

      // Get user's CLIENT organization IDs
      const userOrgs = await db
        .select({ orgId: member.organizationId })
        .from(member)
        .innerJoin(organization, eq(member.organizationId, organization.id))
        .where(
          and(
            eq(member.userId, session.user.id),
            eq(organization.type, "CLIENT"),
            eq(member.role, "client_user"),
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
        .where(inArray(customer.authOrganizationId, orgIds));

      if (customers.length === 0) {
        return c.json({
          data: [],
          pagination: { page, limit, total: 0, totalPages: 0 },
        });
      }

      const customerIds = customers.map((c) => c.id);

      // Count total certificates
      const [totalResult] = await db
        .select({ count: count() })
        .from(calibrationJob)
        .where(
          and(
            inArray(calibrationJob.customerId, customerIds),
            eq(calibrationJob.status, "APPROVED"),
          ),
        );

      const total = totalResult?.count ?? 0;

      // Get certificates with pagination
      const certificates = await db
        .select({
          id: calibrationJob.id,
          jobId: calibrationJob.jobId,
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
        .innerJoin(organization, eq(calibrationJob.organizationId, organization.id))
        .where(
          and(
            inArray(calibrationJob.customerId, customerIds),
            eq(calibrationJob.status, "APPROVED"),
          ),
        )
        .orderBy(desc(calibrationJob.approvedAt))
        .limit(limit)
        .offset(offset);

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
            eq(member.role, "client_user"),
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
        .where(inArray(customer.authOrganizationId, orgIds));

      if (customers.length === 0) {
        return c.json({ error: "Certificado nao encontrado" }, 404);
      }

      const customerIds = customers.map((c) => c.id);

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
        .innerJoin(organization, eq(calibrationJob.organizationId, organization.id))
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

      return c.json(certificate);
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
            eq(member.role, "client_user"),
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
        .where(inArray(customer.authOrganizationId, orgIds));

      if (customers.length === 0) {
        return c.json({ error: "Certificado nao encontrado" }, 404);
      }

      const customerIds = customers.map((c) => c.id);

      // Get certificate
      const [certificate] = await db
        .select({
          certificateUrl: calibrationJob.certificateUrl,
          jobId: calibrationJob.jobId,
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

      if (!certificate.certificateUrl) {
        return c.json({ error: "Documento ainda nao disponivel" }, 400);
      }

      const env = c.env as R2Env;
      const key = extractKeyFromUrl(certificate.certificateUrl);
      const client = createR2Client(env);
      const url = await generatePresignedUrl(client, env.R2_BUCKET_NAME, key);

      return c.json({
        url,
        filename: `certificado-${certificate.jobId}.pdf`
      });
    } catch (error) {
      console.error("Error generating certificate download URL:", error);
      return c.json({ error: "Erro ao gerar link de download" }, 500);
    }
  });
