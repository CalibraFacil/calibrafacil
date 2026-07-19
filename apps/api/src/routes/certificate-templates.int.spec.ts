import { beforeEach, describe, expect, it } from "vitest";
import { certificateTemplatesRouter } from "./certificate-templates";
import { db } from "@calibra-facil/db";
import {
  certificateTemplate,
  certificateTemplateVersion,
  subscription,
} from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";
import { loginAs, logout } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";

// Real-DB + real-RBAC integration test for certificateTemplatesRouter.
// Only the better-auth session is mocked (test/integration/setup.ts).
// requireLabProtected -> requireOrganization -> requireOrgType("LAB") +
// requirePermission + requireFeature all run for real against the seeded Postgres.
//
// Covered:
//   REQ-CTMPL-001  GET /  tenant isolation — only authed org's templates returned
//   REQ-CTMPL-002  Cross-tenant GET /:id/versions/:versionId -> 404, no data leak
//   REQ-CTMPL-003  POST /  as member -> 403 (RBAC: organization:update denied)
//   REQ-CTMPL-004  POST /  as admin without custom_templates plan -> 403 (requireFeature gate)
//   REQ-CTMPL-005  POST /  as admin with PROFESSIONAL plan -> 201, row persisted in org scope
//   REQ-CTMPL-006  PUT /:id as member -> 403 (RBAC gate fires before business logic)
//   REQ-CTMPL-007  Unauthenticated request -> 401
//
// Deferred (noted):
//   /:id/versions/upload-xlsx  — requires real multipart .xlsx payload + R2 env vars
//   /:id/versions/:versionId/validate — requires R2 download (xlsxR2Key must exist in R2)
//   /:id/versions/:versionId/publish  — requires RENDERED preview row + R2
//   /:id/versions/:versionId/analyze   — requires R2 download
//   /:id/duplicate (authorized 201 path) — deferred; 403 gate covered by REQ-CTMPL-006 pattern

const JSON_HEADERS = { "content-type": "application/json" };

// ---------------------------------------------------------------------------
// Inline domain seed helpers — NOT in shared seed.ts to keep makers conflict-free.
// ---------------------------------------------------------------------------

/**
 * Seed a certificate_template row directly (bypassing the POST endpoint so
 * we can test reads + RBAC gates without needing the custom_templates entitlement).
 */
async function seedCertificateTemplate(params: {
  organizationId: string;
  createdBy: string;
  name: string;
  slug?: string;
}): Promise<number> {
  const slug =
    params.slug ??
    params.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 50);
  const [row] = await db
    .insert(certificateTemplate)
    .values({
      organizationId: params.organizationId,
      name: params.name,
      slug,
      isDefault: false,
      createdBy: params.createdBy,
    })
    .returning({ id: certificateTemplate.id });
  if (!row) throw new Error("seedCertificateTemplate: insert failed");
  return row.id;
}

/**
 * Seed a certificate_template_version row in DRAFT status.
 * xlsxR2Key / bindingManifest are set to placeholder values;
 * the router scopes by organizationId in the DB query — it does NOT
 * validate R2 existence at read time for the GET /:id/versions/:versionId route.
 */
async function seedTemplateVersion(params: {
  organizationId: string;
  templateId: number;
  createdBy: string;
  version?: number;
}): Promise<number> {
  const [row] = await db
    .insert(certificateTemplateVersion)
    .values({
      organizationId: params.organizationId,
      templateId: params.templateId,
      version: params.version ?? 1,
      status: "DRAFT",
      xlsxR2Key: `certificate-templates/xlsx/${params.organizationId}/${params.templateId}/v1-placeholder.xlsx`,
      xlsxSha256:
        "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899",
      bindingManifest: {
        schemaVersion: "calibrafacil.certificateXlsxBinding.v1",
        requiredFields: [],
        governedFields: [],
        scalarBindings: [],
        imageBindings: [],
        tableBindings: [],
        renderPolicy: {
          formulas: "preserve",
          macros: "reject",
          externalLinks: "reject",
          converter: "gotenberg-libreoffice",
        },
      },
      bindingManifestSha256:
        "0000000000000000000000000000000000000000000000000000000000000000",
      renderPolicy: {
        formulas: "preserve",
        macros: "reject",
        externalLinks: "reject",
        converter: "gotenberg-libreoffice",
      },
      createdBy: params.createdBy,
    })
    .returning({ id: certificateTemplateVersion.id });
  if (!row) throw new Error("seedTemplateVersion: insert failed");
  return row.id;
}

/**
 * Seed an ACTIVE PROFESSIONAL subscription so requireFeature("custom_templates")
 * passes. PROFESSIONAL includes custom_templates; FREE does not.
 */
async function seedProfessionalSubscription(
  organizationId: string,
): Promise<void> {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const nextYear = new Date("2027-01-01T00:00:00.000Z");
  await db.insert(subscription).values({
    organizationId,
    planId: "PROFESSIONAL",
    status: "ACTIVE",
    renewalMode: "NONE",
    currentPeriodStart: now,
    currentPeriodEnd: nextYear,
  });
}

// ---------------------------------------------------------------------------

describe("certificateTemplatesRouter — real DB + real middleware", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // REQ-CTMPL-001: GET / tenant isolation — only the authenticated org's templates
  it("REQ-CTMPL-001: GET / returns only the authenticated org's templates (tenant isolation)", async () => {
    const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
    const orgB = await seedOrg({ orgId: "org-b", role: "admin" });

    await seedCertificateTemplate({
      organizationId: orgA.orgId,
      createdBy: orgA.userId,
      name: "Template Alpha",
      slug: "template-alpha",
    });
    await seedCertificateTemplate({
      organizationId: orgA.orgId,
      createdBy: orgA.userId,
      name: "Template Beta",
      slug: "template-beta",
    });
    await seedCertificateTemplate({
      organizationId: orgB.orgId,
      createdBy: orgB.userId,
      name: "Template Bravo",
      slug: "template-bravo",
    });

    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    const res = await certificateTemplatesRouter.request("/", {
      headers: JSON_HEADERS,
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    const items = body.items;
    expect(Array.isArray(items)).toBe(true);

    const names = items.map((t: { name: string }) => t.name);
    // Org A's templates appear
    expect(names).toContain("Template Alpha");
    expect(names).toContain("Template Beta");
    // Org B's template must NOT appear
    expect(names).not.toContain("Template Bravo");
    // Exactly 2 — definite count asserts no leakage
    expect(items).toHaveLength(2);
  });

  // REQ-CTMPL-002: Cross-tenant GET /:id/versions/:versionId — no data leak
  it("REQ-CTMPL-002: GET /:id/versions/:versionId for another org's version returns 404 — no cross-tenant read", async () => {
    const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
    const orgB = await seedOrg({ orgId: "org-b", role: "admin" });

    const bTemplateId = await seedCertificateTemplate({
      organizationId: orgB.orgId,
      createdBy: orgB.userId,
      name: "Secret Org B Template",
      slug: "secret-org-b",
    });
    const bVersionId = await seedTemplateVersion({
      organizationId: orgB.orgId,
      templateId: bTemplateId,
      createdBy: orgB.userId,
    });

    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });

    const res = await certificateTemplatesRouter.request(
      `/${bTemplateId}/versions/${bVersionId}`,
      { headers: JSON_HEADERS },
    );

    // Handler scopes by organizationId -> org B's version resolves to null -> 404
    expect(res.status).toBe(404);
    const body = await res.json();
    // No org B data must leak through
    expect(body).not.toHaveProperty("xlsxR2Key");
    expect(body).not.toHaveProperty("bindingManifest");
  });

  // REQ-CTMPL-003: POST / as member -> 403 (RBAC: organization:update absent for member role)
  it("REQ-CTMPL-003: POST / as member -> 403 (RBAC: withLabPermission({organization:[update]}) denied)", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "member" });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const res = await certificateTemplatesRouter.request("/", {
      method: "POST",
      headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
      body: JSON.stringify({ name: "Blocked Template" }),
    });

    expect(res.status).toBe(403);
  });

  // REQ-CTMPL-004: POST / as admin without custom_templates plan -> 403 (requireFeature gate)
  it("REQ-CTMPL-004: POST / as admin without custom_templates plan -> 403 (requireFeature blocks FREE plan)", async () => {
    // No subscription seeded -> FREE plan -> no custom_templates entitlement
    const org = await seedOrg({ orgId: "org-a", role: "admin" });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const res = await certificateTemplatesRouter.request("/", {
      method: "POST",
      headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
      body: JSON.stringify({ name: "Needs Pro Plan" }),
    });

    // requireFeature("custom_templates") fires -> 403 (feature not in FREE plan)
    expect(res.status).toBe(403);
  });

  // REQ-CTMPL-005: POST / as admin with PROFESSIONAL plan -> 201, row persisted in org scope
  it("REQ-CTMPL-005: POST / as admin with PROFESSIONAL plan -> 201, template row scoped to org", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "admin" });
    await seedProfessionalSubscription(org.orgId);

    loginAs({ userId: org.userId, organizationId: org.orgId });

    const res = await certificateTemplatesRouter.request("/", {
      method: "POST",
      headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
      body: JSON.stringify({ name: "Meu Template Pro" }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.item).toBeDefined();
    expect(body.item.name).toBe("Meu Template Pro");
    expect(body.item.organizationId).toBe(org.orgId);

    // Verify the row is in the DB scoped to the correct org
    const [row] = await db
      .select({
        organizationId: certificateTemplate.organizationId,
        name: certificateTemplate.name,
      })
      .from(certificateTemplate)
      .where(eq(certificateTemplate.id, body.item.id));

    expect(row?.organizationId).toBe(org.orgId);
    expect(row?.name).toBe("Meu Template Pro");
  });

  // REQ-CTMPL-006: PUT /:id as member -> 403 (RBAC gate fires before business logic)
  it("REQ-CTMPL-006: PUT /:id as member -> 403 (insufficient role for template rename)", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "member" });

    const templateId = await seedCertificateTemplate({
      organizationId: org.orgId,
      createdBy: org.userId,
      name: "Original Name",
      slug: "original-name",
    });

    loginAs({ userId: org.userId, organizationId: org.orgId });

    const res = await certificateTemplatesRouter.request(`/${templateId}`, {
      method: "PUT",
      headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
      body: JSON.stringify({ name: "Should Not Update" }),
    });

    expect(res.status).toBe(403);

    // Verify the DB row was NOT mutated
    const [row] = await db
      .select({ name: certificateTemplate.name })
      .from(certificateTemplate)
      .where(eq(certificateTemplate.id, templateId));
    expect(row?.name).toBe("Original Name");
  });

  // REQ-CTMPL-007: Unauthenticated -> 401
  it("REQ-CTMPL-007: unauthenticated request -> 401", async () => {
    logout();
    const res = await certificateTemplatesRouter.request("/", {
      headers: JSON_HEADERS,
    });
    expect(res.status).toBe(401);
  });
});
