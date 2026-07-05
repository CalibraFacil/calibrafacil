/**
 * audit-log-cascade.int.spec.ts — Real-DB integration proof for CMP-07 (#692):
 * the append-only ISO/IEC 17025 audit trail must SURVIVE deletion of the
 * subject entity it documents. Historically each audit-log table's subject FK
 * carried ON DELETE CASCADE, so deleting the subject (or, for the two-FK tables,
 * the organization) silently erased the trail.
 *
 * These are direct-db proofs (no route): insert subject + audit row, delete the
 * subject via the db, assert the audit row persists. The integration harness
 * builds the schema from schema.ts via `drizzle-kit push`, so dropping the FK in
 * schema.ts is exactly what turns these RED→GREEN.
 *
 * Representative coverage (per REQ-CMP-AUD-010b):
 *   - certificateReleaseAuditLog — a DOUBLE-FK table; subject (release) deletion.
 *   - organizationApiKeyAuditLog — a DOUBLE-FK table proven to survive BOTH
 *     cascades: apiKey-subject deletion AND organization deletion.
 *   - personnelCompetenceAuditLog — the user-self-delete risk (competence rows
 *     cascade from user; here the competence subject is deleted directly).
 *   - authorizedSignatoryAuditLog — ISO/IEC 17025 §6.2.6 worst case (who was an
 *     authorized signatory must never vanish without a trace).
 *
 * NOTE (org-cascade of certificateReleaseAuditLog.organization_id): deleting the
 * LAB organization that owns a full certificate-release chain is not feasible in
 * an isolated test because asset/service/calibration_job carry ON DELETE RESTRICT
 * FKs to organization_unit. The organizationId cascade is instead proven on
 * organizationApiKeyAuditLog below (same structural change, same migration).
 */

import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@calibra-facil/db";
import {
  asset,
  assetType,
  authorizedSignatory,
  authorizedSignatoryAuditLog,
  calibrationJob,
  certificateRelease,
  certificateReleaseAuditLog,
  customer,
  organization,
  organizationApiKey,
  organizationApiKeyAuditLog,
  personnelCompetence,
  personnelCompetenceAuditLog,
  service,
} from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";
import { truncateAll } from "../../test/integration/db";
import { seedApiKey, seedOrg } from "../../test/integration/seed";

// ---------------------------------------------------------------------------
// Inline domain seed helpers
// ---------------------------------------------------------------------------

async function seedClientOrg(clientOrgId: string): Promise<void> {
  await db.insert(organization).values({
    id: clientOrgId,
    name: `Client ${clientOrgId}`,
    slug: clientOrgId,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    type: "CLIENT",
    status: "ACTIVE",
  });
}

async function seedCustomer(params: {
  labOrgId: string;
  clientOrgId: string;
}): Promise<number> {
  await seedClientOrg(params.clientOrgId);
  const [row] = await db
    .insert(customer)
    .values({
      name: `Customer of ${params.labOrgId}`,
      labOrganizationId: params.labOrgId,
      authOrganizationId: params.clientOrgId,
    })
    .returning({ id: customer.id });
  if (!row) throw new Error("seedCustomer: insert failed");
  return row.id;
}

async function seedAssetType(slug: string): Promise<number> {
  const [row] = await db
    .insert(assetType)
    .values({ name: `AT ${slug}`, slug, definition: [] })
    .returning({ id: assetType.id });
  if (!row) throw new Error("seedAssetType: insert failed");
  return row.id;
}

async function seedAsset(params: {
  unitId: number;
  customerId: number;
  assetTypeId: number;
  tag: string;
}): Promise<number> {
  const [row] = await db
    .insert(asset)
    .values({
      unitId: params.unitId,
      customerId: params.customerId,
      assetTypeId: params.assetTypeId,
      name: "Instrumento",
      serialNumber: `SN-${params.tag}`,
      tag: params.tag,
    })
    .returning({ id: asset.id });
  if (!row) throw new Error("seedAsset: insert failed");
  return row.id;
}

async function seedService(params: {
  organizationId: string;
  unitId: number;
}): Promise<number> {
  const [row] = await db
    .insert(service)
    .values({
      organizationId: params.organizationId,
      unitId: params.unitId,
      name: `Service ${params.organizationId}`,
      isActive: true,
    })
    .returning({ id: service.id });
  if (!row) throw new Error("seedService: insert failed");
  return row.id;
}

/** Minimal valid MethodSnapshot (required NOT-NULL JSONB on calibration_job). */
function minimalMethodSnapshot(): Record<string, unknown> {
  return {
    methodId: 1,
    methodName: "Test Method",
    methodVersion: 1,
    dataFields: [],
    variableBindings: [],
    formulas: [],
    measurementModels: [],
    validations: [],
    uncertaintyParams: [],
  };
}

async function seedJob(params: {
  organizationId: string;
  unitId: number;
  customerId: number;
  assetId: number;
  serviceId: number;
  createdBy: string;
}): Promise<number> {
  const [row] = await db
    .insert(calibrationJob)
    .values({
      jobId: `CAL-${params.assetId}`,
      organizationId: params.organizationId,
      unitId: params.unitId,
      customerId: params.customerId,
      assetId: params.assetId,
      serviceId: params.serviceId,
      createdBy: params.createdBy,
      status: "APPROVED",
      methodSnapshot: minimalMethodSnapshot(),
    })
    .returning({ id: calibrationJob.id });
  if (!row) throw new Error("seedJob: insert failed");
  return row.id;
}

/** Seed a certificate_release + one certificate_release_audit_log row. */
async function seedCertificateReleaseWithAudit(org: {
  orgId: string;
  userId: string;
  unitId: number;
}): Promise<{ releaseId: number; auditId: number }> {
  const customerId = await seedCustomer({
    labOrgId: org.orgId,
    clientOrgId: `client-${org.orgId}`,
  });
  const assetTypeId = await seedAssetType(`at-${org.orgId}`);
  const assetId = await seedAsset({
    unitId: org.unitId,
    customerId,
    assetTypeId,
    tag: `TAG-${org.orgId}`,
  });
  const serviceId = await seedService({
    organizationId: org.orgId,
    unitId: org.unitId,
  });
  const jobId = await seedJob({
    organizationId: org.orgId,
    unitId: org.unitId,
    customerId,
    assetId,
    serviceId,
    createdBy: org.userId,
  });

  const [release] = await db
    .insert(certificateRelease)
    .values({
      organizationId: org.orgId,
      calibrationJobId: jobId,
      status: "RELEASED",
    })
    .returning({ id: certificateRelease.id });
  if (!release) throw new Error("seedCertificateRelease: insert failed");

  const [auditRow] = await db
    .insert(certificateReleaseAuditLog)
    .values({
      organizationId: org.orgId,
      certificateReleaseId: release.id,
      toStatus: "RELEASED",
      source: "system_reconciliation",
      reason: "trilha de auditoria",
    })
    .returning({ id: certificateReleaseAuditLog.id });
  if (!auditRow) throw new Error("seedCertificateReleaseAudit: insert failed");

  return { releaseId: release.id, auditId: auditRow.id };
}

// ---------------------------------------------------------------------------

describe("audit-log subject FKs no longer self-delete the trail (CMP-07 #692)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // =========================================================================
  // REQ-CMP-AUD-010b: certificate_release_audit_log (DOUBLE-FK table) survives
  // deletion of its subject (the certificate_release row).
  // =========================================================================
  it(
    "REQ-CMP-AUD-010b: certificateReleaseAuditLog survives deletion of the release subject",
    async () => {
      const org = await seedOrg({ orgId: "org-crel", role: "admin" });
      const { releaseId, auditId } = await seedCertificateReleaseWithAudit(org);

      await db
        .delete(certificateRelease)
        .where(eq(certificateRelease.id, releaseId));

      const gone = await db
        .select()
        .from(certificateRelease)
        .where(eq(certificateRelease.id, releaseId));
      expect(gone).toHaveLength(0);

      const survived = await db
        .select()
        .from(certificateReleaseAuditLog)
        .where(eq(certificateReleaseAuditLog.id, auditId));
      expect(survived).toHaveLength(1);
      expect(survived[0]?.certificateReleaseId).toBe(releaseId);
    },
  );

  // =========================================================================
  // REQ-CMP-AUD-010b: organization_api_key_audit_log (DOUBLE-FK table) survives
  // deletion of its api-key subject.
  // =========================================================================
  it(
    "REQ-CMP-AUD-010b: organizationApiKeyAuditLog survives deletion of the api-key subject",
    async () => {
      const org = await seedOrg({ orgId: "org-apikey-sub", role: "admin" });
      const key = await seedApiKey({
        organizationId: org.orgId,
        createdBy: org.userId,
        scopes: ["customers:write"],
        keyId: "apikey-sub",
      });

      const [auditRow] = await db
        .insert(organizationApiKeyAuditLog)
        .values({
          apiKeyId: key.keyId,
          organizationId: org.orgId,
          action: "revoke",
          performedBy: org.userId,
        })
        .returning({ id: organizationApiKeyAuditLog.id });
      if (!auditRow) throw new Error("seed apiKey audit: insert failed");

      await db
        .delete(organizationApiKey)
        .where(eq(organizationApiKey.id, key.keyId));

      const gone = await db
        .select()
        .from(organizationApiKey)
        .where(eq(organizationApiKey.id, key.keyId));
      expect(gone).toHaveLength(0);

      const survived = await db
        .select()
        .from(organizationApiKeyAuditLog)
        .where(eq(organizationApiKeyAuditLog.id, auditRow.id));
      expect(survived).toHaveLength(1);
      expect(survived[0]?.apiKeyId).toBe(key.keyId);
    },
  );

  // =========================================================================
  // REQ-CMP-AUD-010b: organization_api_key_audit_log survives deletion of the
  // ORGANIZATION — proving the SECOND cascade (organization_id) of a double-FK
  // audit table is also broken. Deleting the org cascades member/unit/api-key;
  // the audit row must remain.
  // =========================================================================
  it(
    "REQ-CMP-AUD-010b: organizationApiKeyAuditLog survives deletion of the organization (2nd FK)",
    async () => {
      const org = await seedOrg({ orgId: "org-apikey-org", role: "admin" });
      const key = await seedApiKey({
        organizationId: org.orgId,
        createdBy: org.userId,
        scopes: ["customers:write"],
        keyId: "apikey-org",
      });

      const [auditRow] = await db
        .insert(organizationApiKeyAuditLog)
        .values({
          apiKeyId: key.keyId,
          organizationId: org.orgId,
          action: "create",
          performedBy: org.userId,
        })
        .returning({ id: organizationApiKeyAuditLog.id });
      if (!auditRow) throw new Error("seed apiKey audit: insert failed");

      await db.delete(organization).where(eq(organization.id, org.orgId));

      const goneOrg = await db
        .select()
        .from(organization)
        .where(eq(organization.id, org.orgId));
      expect(goneOrg).toHaveLength(0);

      const survived = await db
        .select()
        .from(organizationApiKeyAuditLog)
        .where(eq(organizationApiKeyAuditLog.id, auditRow.id));
      expect(survived).toHaveLength(1);
      expect(survived[0]?.organizationId).toBe(org.orgId);
    },
  );

  // =========================================================================
  // REQ-CMP-AUD-010b: personnel_competence_audit_log survives deletion of its
  // competence subject — this is the real user-self-delete risk (competence
  // rows cascade from user; the trail must not vanish with them).
  // =========================================================================
  it(
    "REQ-CMP-AUD-010b: personnelCompetenceAuditLog survives deletion of the competence subject",
    async () => {
      const org = await seedOrg({ orgId: "org-comp", role: "admin" });

      const [pc] = await db
        .insert(personnelCompetence)
        .values({
          organizationId: org.orgId,
          userId: org.userId,
          scopeDescription: "Calibração de massa",
          requestedBy: org.userId,
          createdBy: org.userId,
        })
        .returning({ id: personnelCompetence.id });
      if (!pc) throw new Error("seed personnelCompetence: insert failed");

      const [auditRow] = await db
        .insert(personnelCompetenceAuditLog)
        .values({
          competenceId: pc.id,
          action: "qualify",
          performedBy: org.userId,
        })
        .returning({ id: personnelCompetenceAuditLog.id });
      if (!auditRow) throw new Error("seed competence audit: insert failed");

      await db
        .delete(personnelCompetence)
        .where(eq(personnelCompetence.id, pc.id));

      const gone = await db
        .select()
        .from(personnelCompetence)
        .where(eq(personnelCompetence.id, pc.id));
      expect(gone).toHaveLength(0);

      const survived = await db
        .select()
        .from(personnelCompetenceAuditLog)
        .where(eq(personnelCompetenceAuditLog.id, auditRow.id));
      expect(survived).toHaveLength(1);
      expect(survived[0]?.competenceId).toBe(pc.id);
    },
  );

  // =========================================================================
  // REQ-CMP-AUD-010b: authorized_signatory_audit_log survives deletion of its
  // signatory subject — ISO/IEC 17025 §6.2.6: the record of who was authorized
  // to sign must persist even after the authorization row is removed.
  // =========================================================================
  it(
    "REQ-CMP-AUD-010b: authorizedSignatoryAuditLog survives deletion of the signatory subject",
    async () => {
      const org = await seedOrg({ orgId: "org-sig", role: "admin" });

      const [sig] = await db
        .insert(authorizedSignatory)
        .values({
          organizationId: org.orgId,
          userId: org.userId,
          authorizedBy: org.userId,
        })
        .returning({ id: authorizedSignatory.id });
      if (!sig) throw new Error("seed authorizedSignatory: insert failed");

      const [auditRow] = await db
        .insert(authorizedSignatoryAuditLog)
        .values({
          signatoryId: sig.id,
          action: "authorize",
          performedBy: org.userId,
        })
        .returning({ id: authorizedSignatoryAuditLog.id });
      if (!auditRow) throw new Error("seed signatory audit: insert failed");

      await db
        .delete(authorizedSignatory)
        .where(eq(authorizedSignatory.id, sig.id));

      const gone = await db
        .select()
        .from(authorizedSignatory)
        .where(eq(authorizedSignatory.id, sig.id));
      expect(gone).toHaveLength(0);

      const survived = await db
        .select()
        .from(authorizedSignatoryAuditLog)
        .where(eq(authorizedSignatoryAuditLog.id, auditRow.id));
      expect(survived).toHaveLength(1);
      expect(survived[0]?.signatoryId).toBe(sig.id);
    },
  );
});
