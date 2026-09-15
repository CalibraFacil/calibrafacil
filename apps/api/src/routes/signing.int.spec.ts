/**
 * signing.int.spec.ts — Real-DB + real-RBAC integration tests for the
 * signingRouter (ICP-Brasil A1 certificate credential custody).
 *
 * Cut-line class: HIGH-SENSITIVITY (ICP-Brasil A1 credential-custody surface;
 * MP 2.200-2 / DOC-ICP-15.03 — NIT-DICLA-083 was a mis-citation, see #646).
 * Only the better-auth session is mocked (test/integration/setup.ts).
 * requireLabProtected → requireOrganization → requireOrgType("LAB") →
 * requireUnitOperationalSettingsManager + resolveAccessibleUnitContext
 * all run for real against the seeded Postgres.
 *
 * Coverage:
 *   REQ-SCERT-001 [HIGH RISK]  Secrets never leak in GET /certificates + GET /:id
 *   REQ-SCERT-002 [HIGH RISK]  Encrypted at rest on upload (POST /certificates)
 *   REQ-SCERT-003 [HIGH RISK]  Tenant + unit isolation (404, no data leak, DB-verified)
 *   REQ-SCERT-004 [HIGH RISK]  RBAC custody gate (technician → 403, admin → 200)
 *   REQ-SCERT-005              State guards (set-default on revoked → 400; double-revoke → 400;
 *                               active DELETE → 200 + DB-verified)
 *   REQ-SCERT-006              Unauthenticated GET /certificates → 401
 *
 * NOTE on vi.mock: @calibra-facil/signing is mocked at module scope (required by
 * Vitest's hoisting rules). encryptPassword, encryptBinary, decryptPassword,
 * decryptBinary, and SigningError are delegated to vi.importActual so the
 * real AES-256-GCM encryption is exercised. Only getCertificateInfo is replaced
 * with a spy so REQ-SCERT-002 can inject a valid future-dated cert without a real
 * PKCS#12 file. For all other tests the spy is NOT called (they seed cert rows
 * directly or use routes that don't parse P12), so hoisting is harmless.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock MUST appear before any imports that cause the mocked module to load.
// getCertificateInfo is replaced with a spy; all crypto helpers are real.
vi.mock("@calibra-facil/signing", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@calibra-facil/signing")>();
  // getCertificateInfoSpy is an untyped spy so REQ-SCERT-002 can inject any
  // return value without forge-typed stubs (no `as` assertion needed).
  // Default: vi.fn() returns undefined, causing the handler to throw — which is
  // fine since the only test that exercises POST /certificates (REQ-SCERT-002)
  // always calls mockReturnValueOnce before the request.
  const getCertificateInfoSpy = vi.fn();
  return {
    ...actual,
    getCertificateInfo: getCertificateInfoSpy,
  };
});

import { signingRouter } from "./signing";
import { db } from "@calibra-facil/db";
import {
  organizationSigningCertificate,
  organizationUnit,
} from "@calibra-facil/db/schema";
import { eq, and } from "drizzle-orm";
import { loginAs, logout } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";
import {
  getCertificateInfo,
  decryptPassword,
  decryptBinary,
} from "@calibra-facil/signing";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const JSON_HEADERS = { "content-type": "application/json" };

/**
 * AES-256 master key for test use only.
 * Buffer.alloc(32) == 32 null bytes, base64-encoded to 44 chars.
 * Never use in production.
 */
const TEST_MASTER_KEY = Buffer.alloc(32).toString("base64");

const TEST_ENV = {
  SIGNING_MASTER_KEY: TEST_MASTER_KEY,
};

// Sentinel values used to detect secret leakage in REQ-SCERT-001.
const SENTINEL_P12 = "SENTINEL_P12";
const SENTINEL_PW = "SENTINEL_PW";
const SENTINEL_IV = "SENTINEL_IV";

// ---------------------------------------------------------------------------
// Inline seed helpers
// ---------------------------------------------------------------------------

/**
 * Insert an organization_signing_certificate row directly with sentinel secrets.
 * Used for listing, get-by-id, set-default, revoke, and isolation tests where we
 * do NOT need to exercise the real encryption path.
 */
async function seedSigningCert(params: {
  organizationId: string;
  unitId: number;
  createdBy: string;
  serialNumber?: string;
  isActive?: boolean;
  isDefault?: boolean;
  name?: string;
}): Promise<number> {
  const validFrom = new Date("2026-01-01T00:00:00.000Z");
  const validUntil = new Date("2027-01-01T00:00:00.000Z");

  const [row] = await db
    .insert(organizationSigningCertificate)
    .values({
      organizationId: params.organizationId,
      unitId: params.unitId,
      name: params.name ?? "Certificado de Teste",
      serialNumber: params.serialNumber ?? "SN-A-1",
      issuerCn: "AC Test",
      subjectCn: "LAB A",
      subjectCpfCnpj: "00000000000",
      validFrom,
      validUntil,
      encryptedP12: SENTINEL_P12,
      encryptedPassword: SENTINEL_PW,
      passwordIv: SENTINEL_IV,
      isActive: params.isActive ?? true,
      isDefault: params.isDefault ?? false,
      createdBy: params.createdBy,
    })
    .returning({ id: organizationSigningCertificate.id });

  if (!row) throw new Error("seedSigningCert: insert failed");
  return row.id;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("signingRouter — real DB + real middleware", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // =========================================================================
  // REQ-SCERT-001 [HIGH RISK]: Secrets never leak in list or detail responses
  // =========================================================================

  it("REQ-SCERT-001: GET /certificates MUST NOT include encryptedP12 / encryptedPassword / passwordIv keys or sentinel values", async () => {
    const org = await seedOrg({ orgId: "org-1", role: "admin" });
    const certId = await seedSigningCert({
      organizationId: org.orgId,
      unitId: org.unitId,
      createdBy: org.userId,
    });

    loginAs({ userId: org.userId, organizationId: org.orgId });

    const res = await signingRouter.request("/certificates", {
      headers: {
        ...JSON_HEADERS,
        "x-active-unit-id": String(org.unitId),
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    // The response must contain at least our seeded cert.
    expect(body.certificates).toBeDefined();
    expect(body.certificates.length).toBeGreaterThanOrEqual(1);

    // The created cert's id must appear to prove we found it.
    const cert = body.certificates.find((c: { id: number }) => c.id === certId);
    expect(cert).toBeDefined();

    // Secret keys must be absent from every cert in the response.
    for (const c of body.certificates) {
      expect(c).not.toHaveProperty("encryptedP12");
      expect(c).not.toHaveProperty("encryptedPassword");
      expect(c).not.toHaveProperty("passwordIv");
    }

    // The raw JSON body must not contain any of the sentinel strings.
    const rawJson = JSON.stringify(body);
    expect(rawJson).not.toContain(SENTINEL_P12);
    expect(rawJson).not.toContain(SENTINEL_PW);
    expect(rawJson).not.toContain(SENTINEL_IV);
  });

  it("REQ-SCERT-001: GET /certificates/:id MUST NOT include encryptedP12 / encryptedPassword / passwordIv keys or sentinel values", async () => {
    const org = await seedOrg({ orgId: "org-1", role: "admin" });
    const certId = await seedSigningCert({
      organizationId: org.orgId,
      unitId: org.unitId,
      createdBy: org.userId,
    });

    loginAs({ userId: org.userId, organizationId: org.orgId });

    const res = await signingRouter.request(`/certificates/${certId}`, {
      headers: {
        ...JSON_HEADERS,
        "x-active-unit-id": String(org.unitId),
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    // Secret keys must not appear in the response object.
    expect(body).not.toHaveProperty("encryptedP12");
    expect(body).not.toHaveProperty("encryptedPassword");
    expect(body).not.toHaveProperty("passwordIv");

    // The raw JSON body must not contain any of the sentinel strings.
    const rawJson = JSON.stringify(body);
    expect(rawJson).not.toContain(SENTINEL_P12);
    expect(rawJson).not.toContain(SENTINEL_PW);
    expect(rawJson).not.toContain(SENTINEL_IV);

    // Confirm basic non-secret fields ARE present (proves the cert was found).
    expect(body.id).toBe(certId);
    expect(body.serialNumber).toBe("SN-A-1");
    expect(body.status).toBeDefined();
  });

  // =========================================================================
  // REQ-SCERT-002 [HIGH RISK]: Encrypted at rest on upload
  // =========================================================================

  it("REQ-SCERT-002: POST /certificates stores encryptedPassword !== plaintext, passwordIv non-empty, encryptedP12 !== raw p12 — DB-verified", async () => {
    // getCertificateInfo is an untyped spy from the module-level vi.mock, so
    // mockReturnValueOnce accepts any value — no `as` assertion needed.
    // The handler reads only: serialNumber, issuerCn, subjectCn, subjectCpfCnpj,
    // validFrom, validUntil. Fields certificate/privateKey/chain are not used.
    vi.mocked(getCertificateInfo).mockReturnValueOnce({
      serialNumber: "SN-UPLOAD-001",
      issuerCn: "AC Test CA",
      subjectCn: "Test Lab",
      subjectCpfCnpj: "12345678000195",
      validFrom: new Date("2026-01-01T00:00:00.000Z"),
      // 2 years from now — definitely not expired
      validUntil: new Date("2028-01-01T00:00:00.000Z"),
      certificate: null,
      privateKey: null,
      chain: [],
    });

    const org = await seedOrg({ orgId: "org-1", role: "admin" });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const rawP12 = Buffer.from("dummy-p12-content");
    const plainPassword = "s3cret-pw-test";

    const res = await signingRouter.request(
      "/certificates",
      {
        method: "POST",
        headers: {
          ...JSON_HEADERS,
          "x-active-unit-id": String(org.unitId),
        },
        body: JSON.stringify({
          name: "Certificado Upload Teste",
          p12Base64: rawP12.toString("base64"),
          password: plainPassword,
        }),
      },
      TEST_ENV,
    );

    expect(res.status).toBe(200);
    const body = await res.json();

    // Response must be redacted — no secrets.
    expect(body.certificate).toBeDefined();
    expect(body.certificate).not.toHaveProperty("encryptedP12");
    expect(body.certificate).not.toHaveProperty("encryptedPassword");
    expect(body.certificate).not.toHaveProperty("passwordIv");
    expect(JSON.stringify(body)).not.toContain(plainPassword);

    // DB-verify: the persisted row has ENCRYPTED values, not the raw input.
    const certId = body.certificate.id;
    expect(typeof certId).toBe("number");

    const [row] = await db
      .select({
        encryptedP12: organizationSigningCertificate.encryptedP12,
        encryptedPassword: organizationSigningCertificate.encryptedPassword,
        passwordIv: organizationSigningCertificate.passwordIv,
      })
      .from(organizationSigningCertificate)
      .where(eq(organizationSigningCertificate.id, certId));

    if (!row) throw new Error("REQ-SCERT-002: no row found in DB after insert");

    // Password must NOT be stored as plaintext.
    expect(row.encryptedPassword).not.toBe(plainPassword);
    // IV must be non-empty.
    expect(row.passwordIv.length).toBeGreaterThan(0);
    // P12 must NOT be stored as the raw base64 of the input bytes.
    expect(row.encryptedP12).not.toBe(rawP12.toString("base64"));

    // Round-trip decryption must recover the original password.
    const recovered = decryptPassword(
      row.encryptedPassword,
      row.passwordIv,
      TEST_MASTER_KEY,
    );
    expect(recovered).toBe(plainPassword);

    // Round-trip decryption of the p12 blob must recover the original bytes.
    const recoveredP12 = decryptBinary(row.encryptedP12, TEST_MASTER_KEY);
    expect(recoveredP12.toString("hex")).toBe(rawP12.toString("hex"));
  });

  // =========================================================================
  // REQ-SCERT-003 [HIGH RISK]: Tenant + unit isolation
  // =========================================================================

  it("REQ-SCERT-003: GET /certificates/:id for another org's cert → 404, org B row unchanged", async () => {
    const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
    const orgB = await seedOrg({ orgId: "org-b", role: "admin" });

    const certBId = await seedSigningCert({
      organizationId: orgB.orgId,
      unitId: orgB.unitId,
      createdBy: orgB.userId,
      serialNumber: "SN-B-1",
    });

    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });

    const res = await signingRouter.request(`/certificates/${certBId}`, {
      headers: {
        ...JSON_HEADERS,
        "x-active-unit-id": String(orgA.unitId),
      },
    });

    expect(res.status).toBe(404);

    // Org B's row must be unchanged in the DB.
    const [row] = await db
      .select({ id: organizationSigningCertificate.id })
      .from(organizationSigningCertificate)
      .where(eq(organizationSigningCertificate.id, certBId));
    expect(row?.id).toBe(certBId);
  });

  it("REQ-SCERT-003: POST /certificates/:id/set-default for another org's cert → 404", async () => {
    const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
    const orgB = await seedOrg({ orgId: "org-b", role: "admin" });

    const certBId = await seedSigningCert({
      organizationId: orgB.orgId,
      unitId: orgB.unitId,
      createdBy: orgB.userId,
      serialNumber: "SN-B-2",
    });

    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });

    const res = await signingRouter.request(
      `/certificates/${certBId}/set-default`,
      {
        method: "POST",
        headers: {
          ...JSON_HEADERS,
          "x-active-unit-id": String(orgA.unitId),
        },
      },
    );

    expect(res.status).toBe(404);
  });

  it("REQ-SCERT-003: DELETE /certificates/:id for another org's cert → 404, org B row isActive unchanged (DB-verified)", async () => {
    const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
    const orgB = await seedOrg({ orgId: "org-b", role: "admin" });

    const certBId = await seedSigningCert({
      organizationId: orgB.orgId,
      unitId: orgB.unitId,
      createdBy: orgB.userId,
      serialNumber: "SN-B-3",
      isActive: true,
    });

    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });

    const res = await signingRouter.request(`/certificates/${certBId}`, {
      method: "DELETE",
      headers: {
        ...JSON_HEADERS,
        "x-active-unit-id": String(orgA.unitId),
      },
      body: JSON.stringify({ reason: "cross-tenant attack" }),
    });

    expect(res.status).toBe(404);

    // DB-verify org B's row is still active — revoke must not have happened.
    const [row] = await db
      .select({
        isActive: organizationSigningCertificate.isActive,
        revokedReason: organizationSigningCertificate.revokedReason,
      })
      .from(organizationSigningCertificate)
      .where(eq(organizationSigningCertificate.id, certBId));

    expect(row?.isActive).toBe(true);
    expect(row?.revokedReason).toBeNull();
  });

  it("REQ-SCERT-003: GET /certificates for org A returns ONLY org A's certs — definite count", async () => {
    const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
    const orgB = await seedOrg({ orgId: "org-b", role: "admin" });

    await seedSigningCert({
      organizationId: orgA.orgId,
      unitId: orgA.unitId,
      createdBy: orgA.userId,
      serialNumber: "SN-A-100",
      name: "Cert Alpha",
    });
    await seedSigningCert({
      organizationId: orgB.orgId,
      unitId: orgB.unitId,
      createdBy: orgB.userId,
      serialNumber: "SN-B-100",
      name: "Cert Beta",
    });

    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });

    const res = await signingRouter.request("/certificates", {
      headers: {
        ...JSON_HEADERS,
        "x-active-unit-id": String(orgA.unitId),
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    // Exactly one cert for org A (definite count).
    expect(body.certificates).toHaveLength(1);
    expect(body.certificates[0].name).toBe("Cert Alpha");

    // Org B's cert name must not appear.
    const rawJson = JSON.stringify(body);
    expect(rawJson).not.toContain("Cert Beta");
  });

  // =========================================================================
  // REQ-SCERT-004 [HIGH RISK]: RBAC custody gate
  // =========================================================================

  it("REQ-SCERT-004: GET /certificates as technician → 403 (RBAC custody gate)", async () => {
    const org = await seedOrg({ orgId: "org-1", role: "technician" });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const res = await signingRouter.request("/certificates", {
      headers: {
        ...JSON_HEADERS,
        "x-active-unit-id": String(org.unitId),
      },
    });

    // ESCALATION guard: if this passes with 200, the RBAC gate is missing/broken.
    if (res.status === 200) {
      throw new Error(
        "ESCALATION: REQ-SCERT-004 — technician received 200 from GET /certificates; RBAC custody gate appears broken",
      );
    }

    expect(res.status).toBe(403);
  });

  it("REQ-SCERT-004: GET /certificates as admin → 200 (RBAC custody gate passes for admin)", async () => {
    const org = await seedOrg({ orgId: "org-1", role: "admin" });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const res = await signingRouter.request("/certificates", {
      headers: {
        ...JSON_HEADERS,
        "x-active-unit-id": String(org.unitId),
      },
    });

    expect(res.status).toBe(200);
  });

  it("REQ-SCERT-004: GET /certificates as operator → 403", async () => {
    const org = await seedOrg({ orgId: "org-1", role: "operator" });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const res = await signingRouter.request("/certificates", {
      headers: {
        ...JSON_HEADERS,
        "x-active-unit-id": String(org.unitId),
      },
    });

    if (res.status === 200) {
      throw new Error(
        "ESCALATION: REQ-SCERT-004 — operator received 200 from GET /certificates; RBAC custody gate appears broken",
      );
    }

    expect(res.status).toBe(403);
  });

  it("REQ-SCERT-004: GET /certificates as member → 403", async () => {
    const org = await seedOrg({ orgId: "org-1", role: "member" });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const res = await signingRouter.request("/certificates", {
      headers: {
        ...JSON_HEADERS,
        "x-active-unit-id": String(org.unitId),
      },
    });

    if (res.status === 200) {
      throw new Error(
        "ESCALATION: REQ-SCERT-004 — member received 200 from GET /certificates; RBAC custody gate appears broken",
      );
    }

    expect(res.status).toBe(403);
  });

  // =========================================================================
  // REQ-SCERT-005: State guards
  // =========================================================================

  it("REQ-SCERT-005: POST /certificates/:id/set-default on a REVOKED cert → 400", async () => {
    const org = await seedOrg({ orgId: "org-1", role: "admin" });
    const certId = await seedSigningCert({
      organizationId: org.orgId,
      unitId: org.unitId,
      createdBy: org.userId,
      isActive: false, // already revoked
      isDefault: false,
    });

    loginAs({ userId: org.userId, organizationId: org.orgId });

    const res = await signingRouter.request(
      `/certificates/${certId}/set-default`,
      {
        method: "POST",
        headers: {
          ...JSON_HEADERS,
          "x-active-unit-id": String(org.unitId),
        },
      },
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    // The error message must mention revocation.
    expect(JSON.stringify(body)).toMatch(/revog/i);
  });

  it("REQ-SCERT-005: DELETE /certificates/:id on already-revoked cert → 400", async () => {
    const org = await seedOrg({ orgId: "org-1", role: "admin" });
    const certId = await seedSigningCert({
      organizationId: org.orgId,
      unitId: org.unitId,
      createdBy: org.userId,
      isActive: false, // already revoked
    });

    loginAs({ userId: org.userId, organizationId: org.orgId });

    const res = await signingRouter.request(`/certificates/${certId}`, {
      method: "DELETE",
      headers: {
        ...JSON_HEADERS,
        "x-active-unit-id": String(org.unitId),
      },
      body: JSON.stringify({ reason: "tentativa de dupla revogação" }),
    });

    expect(res.status).toBe(400);
  });

  it("REQ-SCERT-005: DELETE /certificates/:id on active cert → 200, row isActive false + revokedReason set (DB-verified)", async () => {
    const org = await seedOrg({ orgId: "org-1", role: "admin" });
    const certId = await seedSigningCert({
      organizationId: org.orgId,
      unitId: org.unitId,
      createdBy: org.userId,
      isActive: true,
      isDefault: false,
    });

    loginAs({ userId: org.userId, organizationId: org.orgId });

    const res = await signingRouter.request(`/certificates/${certId}`, {
      method: "DELETE",
      headers: {
        ...JSON_HEADERS,
        "x-active-unit-id": String(org.unitId),
      },
      body: JSON.stringify({ reason: "certificado comprometido" }),
    });

    expect(res.status).toBe(200);

    // DB-verify the row is now inactive with the correct reason.
    const [row] = await db
      .select({
        isActive: organizationSigningCertificate.isActive,
        isDefault: organizationSigningCertificate.isDefault,
        revokedAt: organizationSigningCertificate.revokedAt,
        revokedReason: organizationSigningCertificate.revokedReason,
        revokedBy: organizationSigningCertificate.revokedBy,
      })
      .from(organizationSigningCertificate)
      .where(
        and(
          eq(organizationSigningCertificate.id, certId),
          eq(organizationSigningCertificate.organizationId, org.orgId),
        ),
      );

    expect(row?.isActive).toBe(false);
    expect(row?.isDefault).toBe(false);
    expect(row?.revokedAt).not.toBeNull();
    expect(row?.revokedReason).toBe("certificado comprometido");
    expect(row?.revokedBy).toBe(org.userId);
  });

  // =========================================================================
  // REQ-SCERT-006: Unauthenticated access → 401
  // =========================================================================

  it("REQ-SCERT-006: unauthenticated GET /certificates → 401", async () => {
    logout();
    const res = await signingRouter.request("/certificates", {
      headers: {
        ...JSON_HEADERS,
        "x-active-unit-id": "1",
      },
    });
    expect(res.status).toBe(401);
  });

  // =========================================================================
  // #644 (CMP-01): per-unit signing policy — "assinatura obrigatória"
  // =========================================================================

  it("REQ-CMP-SIGN-POL-001: PATCH /policy toggles organization_unit.require_signature (DB + GET round-trip)", async () => {
    const org = await seedOrg({ orgId: "org-pol", role: "admin" });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const patch = await signingRouter.request("/policy", {
      method: "PATCH",
      headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
      body: JSON.stringify({ requireSignature: true }),
    });
    expect(patch.status).toBe(200);
    expect(await patch.json()).toEqual({ requireSignature: true });

    // DB-verified
    const [row] = await db
      .select({ requireSignature: organizationUnit.requireSignature })
      .from(organizationUnit)
      .where(eq(organizationUnit.id, org.unitId));
    expect(row?.requireSignature).toBe(true);

    // Rides along on GET /certificates for the settings page
    const list = await signingRouter.request("/certificates", {
      headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
    });
    expect(list.status).toBe(200);
    const listBody = await list.json();
    expect(listBody.requireSignature).toBe(true);

    // And toggles back off
    const revert = await signingRouter.request("/policy", {
      method: "PATCH",
      headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
      body: JSON.stringify({ requireSignature: false }),
    });
    expect(revert.status).toBe(200);
    expect(await revert.json()).toEqual({ requireSignature: false });
  });

  it("REQ-CMP-SIGN-POL-002 [HIGH RISK]: technician cannot change the signing policy (403), flag unchanged (DB-verified)", async () => {
    const org = await seedOrg({ orgId: "org-pol-rbac", role: "technician" });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const res = await signingRouter.request("/policy", {
      method: "PATCH",
      headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
      body: JSON.stringify({ requireSignature: true }),
    });
    expect(res.status).toBe(403);

    const [row] = await db
      .select({ requireSignature: organizationUnit.requireSignature })
      .from(organizationUnit)
      .where(eq(organizationUnit.id, org.unitId));
    expect(row?.requireSignature).toBe(false);
  });
});
