import { beforeEach, describe, expect, it, vi } from "vitest";
import { signaturesRouter } from "./signatures";
import { db } from "@calibra-facil/db";
import { memberVisualSignature, member, user } from "@calibra-facil/db/schema";
import { and, eq } from "drizzle-orm";
import { loginAs, logout } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";

// Real-DB + real-RBAC integration tests for the signaturesRouter.
// Only the better-auth session is mocked (see test/integration/setup.ts).
// withLabPermission -> requireLabAuth -> requireOrganization -> requirePermission
// all run for real against the seeded Postgres. R2 storage calls are stubbed so
// no network / cloud storage is needed -- the real DB upsert/delete and org/member
// guards still run against the real schema.
//
// RBAC surface (packages/auth/src/access.ts):
//   POST /my-signature   -- calibration:["read"] -- all lab roles
//   GET  /my-signature   -- calibration:["read"] -- all lab roles
//   DELETE /my-signature -- calibration:["read"] -- all lab roles
//   GET  /member/:memberId -- calibration:["approve"] -- admin/owner ONLY
//     technician, operator, member -> 403
//
// Proven properties:
//   REQ-VSIG-001  Owner upload persists scoped to (member, org) -- DB-verified dims
//   REQ-VSIG-002  Cross-org guard on GET /member/:memberId -> 404 (no cross-tenant leak)
//   REQ-VSIG-003  RBAC on GET /member/:memberId: technician->403; admin->200
//   REQ-VSIG-004  Upload validation: non-PNG -> 400, no DB row inserted
//   REQ-VSIG-005  Unauthenticated GET /my-signature -> 401

// ---------------------------------------------------------------------------
// Stub the R2 storage surface -- no real S3/R2 in the test environment.
// memberSignatureKey from @calibra-facil/shared/storage-keys is pure (no I/O)
// and is NOT mocked -- the real key derivation runs.
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
// PNG buffer helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal binary buffer whose IHDR declares the given width/height.
 * The handler only reads bytes 0-3 (PNG magic) and bytes 16-23 (IHDR dims)
 * via getPngDimensions; it does not fully decode. A 25-byte stub is enough.
 *
 * Layout:
 *   [0-7]   PNG magic: 0x89 0x50 0x4e 0x47 0x0d 0x0a 0x1a 0x0a
 *   [8-15]  IHDR chunk length + type ("IHDR")
 *   [16-19] width  (big-endian uint32)
 *   [20-23] height (big-endian uint32)
 *   [24]    padding byte
 */
function makePngBuffer(width: number, height: number): Buffer {
  const buf = Buffer.alloc(25);
  // PNG magic
  buf[0] = 0x89;
  buf[1] = 0x50;
  buf[2] = 0x4e;
  buf[3] = 0x47;
  buf[4] = 0x0d;
  buf[5] = 0x0a;
  buf[6] = 0x1a;
  buf[7] = 0x0a;
  // IHDR chunk length
  buf[8] = 0x00;
  buf[9] = 0x00;
  buf[10] = 0x00;
  buf[11] = 0x0d;
  // "IHDR"
  buf[12] = 0x49;
  buf[13] = 0x48;
  buf[14] = 0x44;
  buf[15] = 0x52;
  // width big-endian
  buf.writeUInt32BE(width, 16);
  // height big-endian
  buf.writeUInt32BE(height, 20);
  return buf;
}

/** Build a multipart FormData body with file field "signature". */
function makePngFormData(buf: Buffer, contentType = "image/png"): FormData {
  const form = new FormData();
  const file = new File([buf], "sig.png", { type: contentType });
  form.append("signature", file);
  return form;
}

// ---------------------------------------------------------------------------
// Domain seed helpers (inline; do not modify shared seed.ts)
// ---------------------------------------------------------------------------

/**
 * Insert an extra user + member row inside an existing org.
 * Returns the new memberId (needed for /member/:memberId target).
 */
async function seedExtraMember(params: {
  orgId: string;
  userId: string;
  role?: "owner" | "admin" | "technician" | "operator" | "member";
}): Promise<string> {
  const memberId = `member-${params.orgId}-${params.userId}`;
  const now = new Date("2026-01-01T00:00:00.000Z");
  await db.insert(user).values({
    id: params.userId,
    name: `Extra User ${params.userId}`,
    email: `${params.userId}@lab.test`,
  });
  await db.insert(member).values({
    id: memberId,
    organizationId: params.orgId,
    userId: params.userId,
    role: params.role ?? "technician",
    createdAt: now,
  });
  return memberId;
}

/**
 * Insert a memberVisualSignature row directly (bypasses the upload route).
 * Used to pre-seed state for GET / cross-org / RBAC tests.
 */
async function seedSignature(params: {
  memberId: string;
  organizationId: string;
  width?: number;
  height?: number;
}): Promise<void> {
  await db.insert(memberVisualSignature).values({
    memberId: params.memberId,
    organizationId: params.organizationId,
    r2Key: `signatures/${params.organizationId}/${params.memberId}.png`,
    contentType: "image/png",
    width: params.width ?? 200,
    height: params.height ?? 100,
    fileSize: 1024,
  });
}

// ---------------------------------------------------------------------------

const unitHeader = (unitId: number): Record<string, string> => ({
  "x-active-unit-id": String(unitId),
});

// ---------------------------------------------------------------------------

describe("signaturesRouter -- real DB + real RBAC middleware", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // =========================================================================
  // REQ-VSIG-001: Owner upload persists scoped to (member, org)
  // =========================================================================
  it("REQ-VSIG-001: POST /my-signature as owner -> 200 and persists exactly one memberVisualSignature row scoped to (member, org) with correct dimensions", async () => {
    const org = await seedOrg({ orgId: "org-vsig-001", role: "owner" });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    // Valid PNG: 200x100 -- within [100..800]x[50..400]
    const pngBuf = makePngBuffer(200, 100);
    const form = makePngFormData(pngBuf);

    const res = await signaturesRouter.request("/my-signature", {
      method: "POST",
      headers: unitHeader(org.unitId),
      body: form,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("message");
    expect(body.dimensions).toEqual({ width: 200, height: 100 });

    // DB-verify: exactly one row, keyed (memberId, organizationId), correct dims
    const rows = await db
      .select()
      .from(memberVisualSignature)
      .where(
        and(
          eq(memberVisualSignature.memberId, org.memberId),
          eq(memberVisualSignature.organizationId, org.orgId),
        ),
      );

    expect(rows).toHaveLength(1);
    const row = rows[0];
    if (!row) throw new Error("REQ-VSIG-001: expected persisted row");
    expect(row.memberId).toBe(org.memberId);
    expect(row.organizationId).toBe(org.orgId);
    // Dimensions must match the IHDR we encoded in the buffer
    expect(row.width).toBe(200);
    expect(row.height).toBe(100);
  });

  // =========================================================================
  // REQ-VSIG-002: Cross-org guard on GET /member/:memberId
  // =========================================================================
  it("REQ-VSIG-002: GET /member/:memberId for a memberId belonging to org B -> 404 when called by org A admin; no cross-tenant signature data returned", async () => {
    const orgA = await seedOrg({ orgId: "org-vsig-002a", role: "admin" });
    const orgB = await seedOrg({ orgId: "org-vsig-002b", role: "admin" });

    // Org B's member has a signature in the DB
    await seedSignature({
      memberId: orgB.memberId,
      organizationId: orgB.orgId,
      width: 300,
      height: 150,
    });

    // Org A's admin tries to read org B's member signature by memberId
    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    const res = await signaturesRouter.request(`/member/${orgB.memberId}`, {
      headers: unitHeader(orgA.unitId),
    });

    // The handler verifies target member belongs to the caller's org first.
    // orgB.memberId is not found under orgA -> 404 "Membro nao encontrado".
    expect(res.status).toBe(404);

    const body = await res.json();
    // Must NOT expose any signature URL or hasSignature:true
    expect(body).not.toHaveProperty("url");
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('"hasSignature":true');
    expect(raw).not.toContain("https://r2.test/signed");
  });

  // =========================================================================
  // REQ-VSIG-003: RBAC on GET /member/:memberId
  // =========================================================================
  it("REQ-VSIG-003: GET /member/:memberId -- technician (no calibration:approve) -> 403; same-org admin -> 200 proving the 403 is the RBAC gate", async () => {
    const orgAdmin = await seedOrg({ orgId: "org-vsig-003", role: "admin" });

    const techUserId = "user-vsig-003-tech";
    const techMemberId = await seedExtraMember({
      orgId: orgAdmin.orgId,
      userId: techUserId,
      role: "technician",
    });

    // Pre-seed a signature for the admin member so the admin call returns hasSignature:true
    await seedSignature({
      memberId: orgAdmin.memberId,
      organizationId: orgAdmin.orgId,
      width: 400,
      height: 200,
    });

    // --- technician call: calibration:approve absent -> 403 ---
    loginAs({ userId: techUserId, organizationId: orgAdmin.orgId });
    const techRes = await signaturesRouter.request(
      `/member/${orgAdmin.memberId}`,
      { headers: unitHeader(orgAdmin.unitId) },
    );
    expect(techRes.status).toBe(403);

    // --- admin call: calibration:approve present -> 200 ---
    loginAs({ userId: orgAdmin.userId, organizationId: orgAdmin.orgId });
    const adminRes = await signaturesRouter.request(
      `/member/${orgAdmin.memberId}`,
      { headers: unitHeader(orgAdmin.unitId) },
    );
    expect(adminRes.status).toBe(200);
    const adminBody = await adminRes.json();
    expect(adminBody.hasSignature).toBe(true);
    expect(adminBody.url).toBe("https://r2.test/signed");

    // techMemberId is used to validate seedExtraMember ran correctly
    expect(techMemberId).toBeDefined();
  });

  // =========================================================================
  // REQ-VSIG-004: Upload validation -- non-PNG -> 400, no DB row
  // =========================================================================
  it("REQ-VSIG-004: POST /my-signature with content-type text/plain -> 400 and no memberVisualSignature row persisted", async () => {
    const org = await seedOrg({ orgId: "org-vsig-004", role: "admin" });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    // content-type "text/plain" is not in ALLOWED_CONTENT_TYPES
    const badBuf = Buffer.from("not a png at all");
    const form = makePngFormData(badBuf, "text/plain");

    const res = await signaturesRouter.request("/my-signature", {
      method: "POST",
      headers: unitHeader(org.unitId),
      body: form,
    });

    expect(res.status).toBe(400);

    // DB must have zero rows -- nothing was persisted
    const rows = await db
      .select({ id: memberVisualSignature.id })
      .from(memberVisualSignature)
      .where(
        and(
          eq(memberVisualSignature.memberId, org.memberId),
          eq(memberVisualSignature.organizationId, org.orgId),
        ),
      );
    expect(rows).toHaveLength(0);
  });

  it("REQ-VSIG-004b: POST /my-signature with correct content-type but bad PNG magic -> 400 and no memberVisualSignature row persisted", async () => {
    const org = await seedOrg({ orgId: "org-vsig-004b", role: "admin" });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    // Correct MIME type but first byte wrong -> getPngDimensions -> null -> 400
    const badMagic = Buffer.from("NOTPNG this is junk 1234567890");
    const form = makePngFormData(badMagic, "image/png");

    const res = await signaturesRouter.request("/my-signature", {
      method: "POST",
      headers: unitHeader(org.unitId),
      body: form,
    });

    expect(res.status).toBe(400);

    const rows = await db
      .select({ id: memberVisualSignature.id })
      .from(memberVisualSignature)
      .where(
        and(
          eq(memberVisualSignature.memberId, org.memberId),
          eq(memberVisualSignature.organizationId, org.orgId),
        ),
      );
    expect(rows).toHaveLength(0);
  });

  // =========================================================================
  // REQ-VSIG-005: Unauthenticated GET /my-signature -> 401
  // =========================================================================
  it("REQ-VSIG-005: GET /my-signature without authentication -> 401 (requireLabAuth fires before handler)", async () => {
    logout();
    const res = await signaturesRouter.request("/my-signature");
    expect(res.status).toBe(401);
  });
});
