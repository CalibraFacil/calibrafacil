import { beforeEach, describe, expect, it } from "vitest";
import { standardsRouter } from "./standards";
import { db } from "@calibra-facil/db";
import {
  referenceStandard,
  referenceStandardAuditLog,
} from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";
import { loginAs, logout } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg, seedStandard } from "../../test/integration/seed";

// Real-DB + real-RBAC integration test for the standardsRouter.
// Only the better-auth session is mocked (see test/integration/setup.ts).
// requireLabAuth -> requireOrganization -> withLabPermission and
// buildUnitScopeCondition all run for real against the seeded Postgres.

const JSON_HEADERS = { "content-type": "application/json" };

const VALID_STANDARD_PAYLOAD = {
  name: "Balança Padrão",
  kind: "generic_scalar",
  serialNumber: "SN-9999",
  certificateNumber: "RBC-2026-001",
  calibratedBy: "INMETRO",
  calibrationDate: "2026-01-01",
  nextCalibrationDate: "2027-01-01",
  referenceValue: 1000.0,
  uncertainty: 0.01,
  uncertaintyUnit: "g",
  coverageFactor: 2.0,
  distribution: "normal",
  status: "ACTIVE",
} as const;

describe("standardsRouter — real DB + real middleware", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // REQ-STD-001: Tenant isolation — GET list returns ONLY the authenticated org's rows
  it("REQ-STD-001: GET / returns only the authenticated org's standards (tenant isolation)", async () => {
    const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
    const orgB = await seedOrg({ orgId: "org-b", role: "admin" });

    await seedStandard({
      organizationId: orgA.orgId,
      unitId: orgA.unitId,
      createdBy: orgA.userId,
      name: "Standard A",
    });
    await seedStandard({
      organizationId: orgB.orgId,
      unitId: orgB.unitId,
      createdBy: orgB.userId,
      name: "Standard B",
    });

    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    const res = await standardsRouter.request("/", { headers: JSON_HEADERS });

    expect(res.status).toBe(200);
    const body = await res.json();
    const names = body.data.map((s: { name: string }) => s.name);
    expect(names).toContain("Standard A");
    expect(names).not.toContain("Standard B");
    expect(body.pagination.total).toBe(1);
  });

  // REQ-STD-002: Cross-tenant GET /:id — another org's standard id returns no data
  it("REQ-STD-002: GET /:id of another org's standard is denied, returns no data (no cross-tenant read)", async () => {
    const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
    const orgB = await seedOrg({ orgId: "org-b", role: "admin" });

    const bStandardId = await seedStandard({
      organizationId: orgB.orgId,
      unitId: orgB.unitId,
      createdBy: orgB.userId,
      name: "Secret Standard B",
    });

    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    // Use the numeric id directly — resolveStandardRouteId will scope by org,
    // so it returns null for a foreign id -> 404.
    const res = await standardsRouter.request(`/${bStandardId}`, {
      headers: JSON_HEADERS,
    });

    // resolveStandardRouteId scopes by org+unit; the foreign id resolves to
    // null -> 404. The security property: no Standard B data ever crosses the
    // tenant boundary.
    expect(res.status).toBe(404);
    const body = await res.json();
    // Body must not expose the other tenant's name or organizationId.
    expect(body).not.toHaveProperty("name");
    expect(body).not.toHaveProperty("organizationId");
    expect(body).not.toHaveProperty("serialNumber");
  });

  // REQ-STD-003a: RBAC gate — role=member (insufficient) -> 403 on POST /
  it("REQ-STD-003a: POST / as role=member -> 403 (RBAC: standard:create denied)", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "member" });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const res = await standardsRouter.request("/", {
      method: "POST",
      headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
      body: JSON.stringify(VALID_STANDARD_PAYLOAD),
    });

    expect(res.status).toBe(403);
  });

  // REQ-STD-003b: RBAC gate — role=operator (insufficient for standard:create) -> 403
  it("REQ-STD-003b: POST / as role=operator -> 403 (RBAC: standard:create denied)", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "operator" });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const res = await standardsRouter.request("/", {
      method: "POST",
      headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
      body: JSON.stringify(VALID_STANDARD_PAYLOAD),
    });

    expect(res.status).toBe(403);
  });

  // REQ-STD-004: Authorized create — role=admin, 201, persists row scoped to org+unit + audit log
  it("REQ-STD-004: POST / as admin (with active unit) -> 201, persists standard + audit log scoped to org+unit", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "admin" });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const res = await standardsRouter.request("/", {
      method: "POST",
      headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
      body: JSON.stringify(VALID_STANDARD_PAYLOAD),
    });

    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.name).toBe("Balança Padrão");
    expect(created.organizationId).toBe(org.orgId);
    expect(created.unitId).toBe(org.unitId);

    // Verify audit log was written
    const audit = await db
      .select()
      .from(referenceStandardAuditLog)
      .where(eq(referenceStandardAuditLog.standardId, created.id));
    expect(audit).toHaveLength(1);
    expect(audit[0]?.action).toBe("create");
    expect(audit[0]?.performedBy).toBe(org.userId);
  });

  // REQ-C2-2: who calibrated the standard, as evidence for the traceability sentence
  describe("REQ-C2-2: the calibration provider's accreditation is recorded on the standard", () => {
    const ACCREDITED = {
      ...VALID_STANDARD_PAYLOAD,
      calibratedBy: "Laboratório RBC",
      calibrationProviderAccreditationNumber: "CAL 0123",
      calibrationProviderMraRecognized: true,
    };

    async function create(org: { unitId: number }, body: unknown) {
      return standardsRouter.request("/", {
        method: "POST",
        headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
        body: JSON.stringify(body),
      });
    }

    it("POST / stores the number and the MRA flag; the default is NOT recognised", async () => {
      const org = await seedOrg({ orgId: "org-a", role: "admin" });
      loginAs({ userId: org.userId, organizationId: org.orgId });

      const plain = await create(org, VALID_STANDARD_PAYLOAD);
      expect(plain.status).toBe(201);
      expect(await plain.json()).toMatchObject({
        calibrationProviderAccreditationNumber: null,
        calibrationProviderMraRecognized: false,
      });

      const accredited = await create(org, {
        ...ACCREDITED,
        serialNumber: "SN-2",
      });
      expect(accredited.status).toBe(201);
      expect(await accredited.json()).toMatchObject({
        calibrationProviderAccreditationNumber: "CAL 0123",
        calibrationProviderMraRecognized: true,
      });
    });

    it("POST / refuses the MRA flag without an accreditation number (400)", async () => {
      const org = await seedOrg({ orgId: "org-a", role: "admin" });
      loginAs({ userId: org.userId, organizationId: org.orgId });
      const res = await create(org, {
        ...VALID_STANDARD_PAYLOAD,
        calibrationProviderMraRecognized: true,
      });
      expect(res.status).toBe(400);
    });

    it("PUT /:id naming ANOTHER provider without its facts resets them (never carries the old accreditation over); naming the same one keeps them; the change is audited", async () => {
      const org = await seedOrg({ orgId: "org-a", role: "admin" });
      loginAs({ userId: org.userId, organizationId: org.orgId });
      const created: { id: number } = await (
        await create(org, ACCREDITED)
      ).json();
      const put = (body: unknown) =>
        standardsRouter.request(`/${created.id}`, {
          method: "PUT",
          headers: {
            ...JSON_HEADERS,
            "x-active-unit-id": String(org.unitId),
          },
          body: JSON.stringify(body),
        });
      const read = async () => {
        const [row] = await db
          .select({
            number: referenceStandard.calibrationProviderAccreditationNumber,
            mra: referenceStandard.calibrationProviderMraRecognized,
          })
          .from(referenceStandard)
          .where(eq(referenceStandard.id, created.id));
        return row;
      };

      expect((await put({ calibratedBy: "laboratório rbc" })).status).toBe(200);
      expect(await read()).toEqual({ number: "CAL 0123", mra: true });

      expect((await put({ calibratedBy: "Outro Laboratório" })).status).toBe(
        200,
      );
      expect(await read()).toEqual({ number: null, mra: false });

      const audit = await db
        .select()
        .from(referenceStandardAuditLog)
        .where(eq(referenceStandardAuditLog.standardId, created.id));
      const resetEntry = audit.find(
        (row) =>
          row.action === "update" &&
          JSON.stringify(row.changes).includes(
            "calibrationProviderMraRecognized",
          ),
      );
      expect(resetEntry).toBeDefined();

      // Explicit facts with the new provider are stored.
      expect(
        (
          await put({
            calibrationProviderAccreditationNumber: "CAL 0456",
            calibrationProviderMraRecognized: true,
          })
        ).status,
      ).toBe(200);
      expect(await read()).toEqual({ number: "CAL 0456", mra: true });

      // The flag cannot be set while clearing the number.
      expect(
        (await put({ calibrationProviderAccreditationNumber: null })).status,
      ).toBe(400);
      expect(await read()).toEqual({ number: "CAL 0456", mra: true });
    });

    it("POST /:id/renew from another provider re-attests: without its facts the standard is no longer verified", async () => {
      const org = await seedOrg({ orgId: "org-a", role: "admin" });
      loginAs({ userId: org.userId, organizationId: org.orgId });
      const created: { id: number } = await (
        await create(org, ACCREDITED)
      ).json();
      const renew = await standardsRouter.request(`/${created.id}/renew`, {
        method: "POST",
        headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
        body: JSON.stringify({
          certificateNumber: "RBC-2027-001",
          calibratedBy: "Outro Laboratório",
          calibrationDate: "2027-01-02",
          nextCalibrationDate: "2028-01-02",
          referenceValue: 1000,
          uncertainty: 0.01,
          uncertaintyUnit: "g",
          reason: "Renovação anual",
        }),
      });
      expect(renew.status).toBe(200);
      const [row] = await db
        .select({
          number: referenceStandard.calibrationProviderAccreditationNumber,
          mra: referenceStandard.calibrationProviderMraRecognized,
        })
        .from(referenceStandard)
        .where(eq(referenceStandard.id, created.id));
      expect(row).toEqual({ number: null, mra: false });
    });
  });

  // REQ-STD-005: Unit-scope filtering — member scoped to unit A excludes unit-B rows
  it("REQ-STD-005: GET / unit-scope — admin with active-unit-id header sees only own unit's standards", async () => {
    const orgA = await seedOrg({ orgId: "org-a", role: "admin" });

    // Seed a second unit for the same org
    const { organizationUnit } = await import("@calibra-facil/db/schema");
    const [unitB] = await db
      .insert(organizationUnit)
      .values({
        organizationId: orgA.orgId,
        name: "Unidade B",
        slug: "unidade-b",
        status: "ACTIVE",
        isDefault: false,
        createdBy: orgA.userId,
      })
      .returning({ id: organizationUnit.id });

    if (!unitB) throw new Error("failed to create unit B");

    await seedStandard({
      organizationId: orgA.orgId,
      unitId: orgA.unitId,
      createdBy: orgA.userId,
      name: "Standard Unit A",
    });
    await seedStandard({
      organizationId: orgA.orgId,
      unitId: unitB.id,
      createdBy: orgA.userId,
      name: "Standard Unit B",
    });

    // Login and scope to unit A only
    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    const res = await standardsRouter.request("/", {
      headers: {
        ...JSON_HEADERS,
        "x-active-unit-id": String(orgA.unitId),
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    const names = body.data.map((s: { name: string }) => s.name);
    expect(names).toContain("Standard Unit A");
    expect(names).not.toContain("Standard Unit B");
  });

  // REQ-STD-006: Unauthenticated -> 401
  it("REQ-STD-006: GET / unauthenticated -> 401", async () => {
    logout();
    const res = await standardsRouter.request("/", { headers: JSON_HEADERS });
    expect(res.status).toBe(401);
  });

  // REQ-STD-007: DELETE /:id as member -> 403 (standard:delete denied)
  it("REQ-STD-007: DELETE /:id as role=member -> 403 (RBAC: standard:delete denied)", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "member" });
    const standardId = await seedStandard({
      organizationId: org.orgId,
      unitId: org.unitId,
      createdBy: org.userId,
    });

    loginAs({ userId: org.userId, organizationId: org.orgId });
    const res = await standardsRouter.request(`/${standardId}`, {
      method: "DELETE",
      headers: JSON_HEADERS,
    });

    expect(res.status).toBe(403);
  });

  // REQ-STD-008: DELETE /:id as admin -> 200 (soft delete, scoped)
  it("REQ-STD-008: DELETE /:id as admin -> 200, soft-deletes and audit-logs", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "admin" });
    const standardId = await seedStandard({
      organizationId: org.orgId,
      unitId: org.unitId,
      createdBy: org.userId,
    });

    loginAs({ userId: org.userId, organizationId: org.orgId });
    const res = await standardsRouter.request(`/${standardId}`, {
      method: "DELETE",
      headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
    });

    expect(res.status).toBe(200);

    // Verify soft-delete: row must have deletedAt set
    const [row] = await db
      .select({
        deletedAt: referenceStandard.deletedAt,
        status: referenceStandard.status,
      })
      .from(referenceStandard)
      .where(eq(referenceStandard.id, standardId));
    expect(row?.deletedAt).not.toBeNull();
    expect(row?.status).toBe("INACTIVE");

    // Verify audit log
    const audit = await db
      .select()
      .from(referenceStandardAuditLog)
      .where(eq(referenceStandardAuditLog.standardId, standardId));
    const deleteEntry = audit.find((a) => a.action === "delete");
    expect(deleteEntry).toBeDefined();
    expect(deleteEntry?.performedBy).toBe(org.userId);
  });

  // REQ-STD-009: Cross-tenant DELETE — cannot delete another org's standard
  it("REQ-STD-009: DELETE /:id of another org's standard -> 404 (no cross-tenant delete)", async () => {
    const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
    const orgB = await seedOrg({ orgId: "org-b", role: "admin" });

    const bStandardId = await seedStandard({
      organizationId: orgB.orgId,
      unitId: orgB.unitId,
      createdBy: orgB.userId,
    });

    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    const res = await standardsRouter.request(`/${bStandardId}`, {
      method: "DELETE",
      headers: { ...JSON_HEADERS, "x-active-unit-id": String(orgA.unitId) },
    });

    // resolveStandardRouteId scopes by org, so the id is not found -> 404
    expect(res.status).toBe(404);

    // Verify the other org's standard was NOT deleted
    const [row] = await db
      .select({ deletedAt: referenceStandard.deletedAt })
      .from(referenceStandard)
      .where(eq(referenceStandard.id, bStandardId));
    expect(row?.deletedAt).toBeNull();
  });
});
