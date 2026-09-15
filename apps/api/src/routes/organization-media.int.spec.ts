import { beforeEach, describe, expect, it, vi } from "vitest";
import { organizationMediaRouter } from "./organization-media";
import { db } from "@calibra-facil/db";
import { organization } from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";
import { loginAs, logout } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";

// Real-DB + real-RBAC integration tests for the organizationMediaRouter.
// Only the better-auth lab session is mocked (see test/integration/setup.ts).
// The full guard chain runs for real against the seeded Postgres:
//   withLabPermission({ organization: ["update"] })
//     = requireLabAuth -> requireOrganization -> requireOrgType("LAB")
//       -> requirePermission({ organization: ["update"] })
//   then requireRole(["admin", "owner"])
//
// WHERE THE TENANT BOUNDARY LIVES
// -------------------------------
// Org media is the org's logo, stored in the `organization.logo` text column.
// Both POST and DELETE scope every read/write with
//   eq(organization.id, member.organizationId)
// and `member.organizationId` is derived (by requireOrganization) from the
// session's activeOrganizationId. So an org-A session can ONLY ever touch
// org-A's row -- organizationId is the sole discriminator. The security
// property (org A cannot read / replace / delete org B's logo) is enforced by
// that DB org-scope, NOT by R2. The R2 surface is therefore stubbed to no-ops
// (see vi.mock below): no network / cloud storage is needed, while the real DB
// reads/writes and the org/role/permission guards all still run.
//
// RBAC surface (better-auth org default AC + packages/auth/src/access.ts):
//   organization:["update"] is granted ONLY to admin & owner (adminAc/ownerAc).
//   member / operator / technician inherit memberAc, which has NO `organization`
//   statement -> they fail requirePermission with 403 BEFORE the requireRole gate.
//
// Proven properties:
//   REQ-OM-001  Tenant isolation: an org-A upload/delete only mutates org-A's
//               logo; org-B's seeded logo (sole-discriminator leak row) is never
//               read or affected.
//   REQ-OM-002  Manage gate: member/operator (no organization:update) -> 403 on
//               upload & delete; admin -> success + DB-persisted.
//   REQ-OM-003  Unauthenticated upload -> 401 (requireLabAuth fires first).
//   REQ-OM-004  Happy path: upload -> delete round-trip persists/clears the
//               org-scoped logo metadata.

// ---------------------------------------------------------------------------
// Stub the R2 storage surface -- no real S3/R2 in the test environment.
// The pure key/url helpers from @calibra-facil/shared/storage-keys
// (organizationLogoKey, buildOrganizationLogoUrl, getLogoKeyFromUrl,
// decodeLogoAssetKey) are NOT mocked -- the real key derivation runs.
// ---------------------------------------------------------------------------
vi.mock("../lib/storage", () => ({
  createR2Client: () => ({}),
  uploadToR2: () => Promise.resolve(),
  deleteFromR2: () => Promise.resolve(),
  generatePresignedUrl: () => Promise.resolve("https://r2.test/signed"),
  resolveBucketName: () => "media-test",
  resolveReadBucketName: () => Promise.resolve("media-test"),
}));

// ---------------------------------------------------------------------------
// Multipart helper: a tiny PNG-typed file for the logo field.
// The handler only validates content-type + size, never decodes pixels.
// ---------------------------------------------------------------------------
function makeLogoFormData(contentType = "image/png", bytes = 64): FormData {
  const form = new FormData();
  const file = new File([new Uint8Array(bytes)], "logo.png", {
    type: contentType,
  });
  form.append("logo", file);
  return form;
}

const unitHeader = (unitId: number): Record<string, string> => ({
  "x-active-unit-id": String(unitId),
});

/** Read the persisted `logo` column for an org. */
async function readLogo(orgId: string): Promise<string | null> {
  const [row] = await db
    .select({ logo: organization.logo })
    .from(organization)
    .where(eq(organization.id, orgId))
    .limit(1);
  return row?.logo ?? null;
}

/** Directly set an org's logo (bypassing the route) to seed leak/round-trip state. */
async function setLogo(orgId: string, value: string | null): Promise<void> {
  await db
    .update(organization)
    .set({ logo: value })
    .where(eq(organization.id, orgId));
}

describe("organizationMediaRouter -- real DB + real RBAC middleware", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // =========================================================================
  // REQ-OM-001 [HIGH RISK]: tenant isolation
  // org A's upload/delete must touch ONLY org A's logo; org B's logo (the sole
  // discriminator -- a seeded leak row) must be neither read nor mutated.
  // =========================================================================
  it("REQ-OM-001: org-A admin upload + delete never reads or affects org-B's logo (organizationId is the sole discriminator)", async () => {
    const orgA = await seedOrg({ orgId: "org-om-001a", role: "admin" });
    const orgB = await seedOrg({ orgId: "org-om-001b", role: "admin" });

    // Org B's logo is the sole-discriminator leak row.
    const ORG_B_LOGO = "https://orgB.example/secret-logo.png";
    await setLogo(orgB.orgId, ORG_B_LOGO);

    // --- Org A uploads its own logo ---
    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    const uploadRes = await organizationMediaRouter.request("/logo", {
      method: "POST",
      headers: unitHeader(orgA.unitId),
      body: makeLogoFormData(),
    });
    expect(uploadRes.status).toBe(200);

    const uploadBody = await uploadRes.json();
    // The returned URL must belong to org A's proxy path, never org B's.
    expect(typeof uploadBody.logoUrl).toBe("string");
    expect(uploadBody.logoUrl).not.toBe(ORG_B_LOGO);

    // Org A's row got the new logo; org B's leak row is untouched.
    const orgALogoAfterUpload = await readLogo(orgA.orgId);
    expect(orgALogoAfterUpload).toBe(uploadBody.logoUrl);
    expect(orgALogoAfterUpload).not.toBe(ORG_B_LOGO);
    expect(await readLogo(orgB.orgId)).toBe(ORG_B_LOGO);

    // --- Org A deletes its own logo ---
    const deleteRes = await organizationMediaRouter.request("/logo", {
      method: "DELETE",
      headers: unitHeader(orgA.unitId),
    });
    expect(deleteRes.status).toBe(200);
    const deleteBody = await deleteRes.json();
    expect(deleteBody.logoUrl).toBeNull();

    // Org A's logo cleared; org B's leak row STILL untouched.
    // (If the org filter were dropped, org B's row would be cleared here.)
    expect(await readLogo(orgA.orgId)).toBeNull();
    expect(await readLogo(orgB.orgId)).toBe(ORG_B_LOGO);
  });

  // =========================================================================
  // REQ-OM-002 [HIGH RISK]: the manage gate (organization:update via admin/owner)
  // member & operator lack organization:update -> 403 on both upload and delete;
  // admin succeeds and the change is DB-persisted. The 403/200 split on the
  // SAME route proves the permission gate is what's blocking (not the handler).
  // =========================================================================
  it("REQ-OM-002: member & operator (no organization:update) -> 403 on upload & delete; admin -> 200 + persisted", async () => {
    // --- member: no organization statement at all -> 403 ---
    const memberOrg = await seedOrg({ orgId: "org-om-002m", role: "member" });
    loginAs({ userId: memberOrg.userId, organizationId: memberOrg.orgId });

    const memberUpload = await organizationMediaRouter.request("/logo", {
      method: "POST",
      headers: unitHeader(memberOrg.unitId),
      body: makeLogoFormData(),
    });
    expect(memberUpload.status).toBe(403);

    const memberDelete = await organizationMediaRouter.request("/logo", {
      method: "DELETE",
      headers: unitHeader(memberOrg.unitId),
    });
    expect(memberDelete.status).toBe(403);

    // member must not have persisted anything.
    expect(await readLogo(memberOrg.orgId)).toBeNull();

    // --- operator: has many permissions but NOT organization:update -> 403 ---
    const opOrg = await seedOrg({ orgId: "org-om-002o", role: "operator" });
    loginAs({ userId: opOrg.userId, organizationId: opOrg.orgId });

    const opUpload = await organizationMediaRouter.request("/logo", {
      method: "POST",
      headers: unitHeader(opOrg.unitId),
      body: makeLogoFormData(),
    });
    expect(opUpload.status).toBe(403);
    expect(await readLogo(opOrg.orgId)).toBeNull();

    // --- admin: organization:update granted -> 200 + persisted ---
    const adminOrg = await seedOrg({ orgId: "org-om-002a", role: "admin" });
    loginAs({ userId: adminOrg.userId, organizationId: adminOrg.orgId });

    const adminUpload = await organizationMediaRouter.request("/logo", {
      method: "POST",
      headers: unitHeader(adminOrg.unitId),
      body: makeLogoFormData(),
    });
    expect(adminUpload.status).toBe(200);
    const adminBody = await adminUpload.json();
    expect(typeof adminBody.logoUrl).toBe("string");
    // DB-persisted under the admin's own org.
    expect(await readLogo(adminOrg.orgId)).toBe(adminBody.logoUrl);
  });

  // =========================================================================
  // REQ-OM-003: unauthenticated upload -> 401 (requireLabAuth fires first)
  // =========================================================================
  it("REQ-OM-003: POST /logo without authentication -> 401", async () => {
    logout();
    const res = await organizationMediaRouter.request("/logo", {
      method: "POST",
      body: makeLogoFormData(),
    });
    expect(res.status).toBe(401);
  });

  // =========================================================================
  // REQ-OM-004: happy-path round-trip -- upload then delete persists/clears the
  // org-scoped logo metadata (storage stubbed).
  // =========================================================================
  it("REQ-OM-004: admin upload -> read-back -> delete round-trip persists then clears the org-scoped logo", async () => {
    const org = await seedOrg({ orgId: "org-om-004", role: "owner" });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    // Pre-existing logo (so the upload also exercises the previous-key cleanup
    // branch); storage delete is stubbed.
    await setLogo(
      org.orgId,
      "http://localhost/api/organization-media/logo/" +
        Buffer.from("organization-logos/old/key", "utf8").toString("base64url"),
    );

    // Upload
    const uploadRes = await organizationMediaRouter.request("/logo", {
      method: "POST",
      headers: unitHeader(org.unitId),
      body: makeLogoFormData("image/webp"),
    });
    expect(uploadRes.status).toBe(200);
    const uploadBody = await uploadRes.json();
    expect(typeof uploadBody.logoUrl).toBe("string");
    expect(uploadBody.logoUrl).toContain("/api/organization-media/logo/");

    // Read-back: the persisted column equals the returned URL.
    const persisted = await readLogo(org.orgId);
    expect(persisted).toBe(uploadBody.logoUrl);

    // Delete clears it.
    const deleteRes = await organizationMediaRouter.request("/logo", {
      method: "DELETE",
      headers: unitHeader(org.unitId),
    });
    expect(deleteRes.status).toBe(200);
    expect((await deleteRes.json()).logoUrl).toBeNull();
    expect(await readLogo(org.orgId)).toBeNull();
  });
});
