/**
 * methods.int.spec.ts — Real-DB + real-RBAC integration tests for the
 * GUM method definition draft → review → publish workflow (ISO/IEC 17025
 * §7.2 Method Validation + §8.4 Control of Records).
 *
 * ONLY the better-auth session is mocked (see test/integration/setup.ts).
 * requireLabAuth → requireOrganization → withLabPermission + requireRole
 * all run for real against the seeded Postgres.
 *
 * Proven properties (oracle):
 *   REQ-METH-001  [HIGH RISK] Tenant isolation: org A cannot GET or transition
 *                 org B's method → 404; org B's method unchanged; GET / returns
 *                 only org A's methods with a definite count.
 *   REQ-METH-002  [HIGH RISK] State machine: technical-review PENDING_APPROVAL
 *                 as admin → 200 + TECHNICAL_REVIEWED + technicalReviewedBy set
 *                 (DB-verified); technical-review DRAFT → 400; quality-approve
 *                 TECHNICAL_REVIEWED (distinct owner) → 200 + PUBLISHED
 *                 (DB-verified); quality-approve non-TECHNICAL_REVIEWED → 400;
 *                 PUT PUBLISHED → 400 (immutable); new-version PUBLISHED → 201
 *                 + new DRAFT v2.
 *   REQ-METH-003  [HIGH RISK] FOUR-EYES by identity: quality-approve as the
 *                 same user who technically reviewed → 400 "usuarios diferentes";
 *                 method stays TECHNICAL_REVIEWED (DB-verified); quality-approve
 *                 as a distinct owner → 200 + PUBLISHED.
 *   REQ-METH-004  [HIGH RISK] RBAC: technical-review as non-admin
 *                 (technician/owner) → 403; quality-approve as non-owner
 *                 (admin) → 403.
 *   REQ-METH-005  Unauthenticated technical-review / quality-approve → 401.
 *
 * IDENTITY-SEPARATION: methods.ts is the SECOND surface (after jobs.ts) with
 * identity-based four-eyes enforcement. The reviewer≠approver guard at
 * lines 2122 and 2381 is correct behaviour — not a bug — and is exercised by
 * REQ-METH-003.
 *
 * ESCALATIONS: none — all oracle behaviours match the stated spec.
 *
 * COMPILATION NOTE: quality-approve and publish re-compile the method with
 * requirePublishable:true (needs ≥1 passing preview scenario). Tests drive the
 * happy path by passing sampleData in the request body so the handler builds an
 * ad-hoc preview scenario from it. The method has no formulas and no acceptance
 * criteria, so the scenario passes trivially (no errors). This approach was
 * chosen over seeding a full publicationEvidence blob to keep seeds minimal and
 * the test self-contained.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { methodsRouter } from "./methods";
import { db } from "@calibra-facil/db";
import {
  assetType,
  calibrationMethod,
  methodAuditLog,
  user,
  member,
  type MethodInputField,
  type MethodFormula,
} from "@calibra-facil/db/schema";
import { and, eq } from "drizzle-orm";
import { loginAs, logout } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";

// ---------------------------------------------------------------------------
// No notifications or background-jobs imports in methods.ts — no mocks needed.
// ---------------------------------------------------------------------------

const JSON_HEADERS = { "content-type": "application/json" };

// ---------------------------------------------------------------------------
// Domain seed helpers
// ---------------------------------------------------------------------------

/**
 * Minimal dataFields for a compilable method (one number input, no formulas).
 * The engine accepts this and preview scenarios pass trivially (no errors).
 *
 * `unit` and `defaultValue` are spelled out here only to keep the fixture
 * realistic. They used to be mandatory: `methodInputToDefinitionInput` writes
 * absent optional fields as an explicit `undefined`
 * (`unit: typeof record.unit === "string" ? record.unit : undefined`), and
 * `assertSafeUnknown` rejected any key holding `undefined`, so a fixture without
 * them 500'd. `assertSafeUnknown` now treats such a key as absent — the same as
 * the identical payload arriving as JSON.
 */
const MINIMAL_DATA_FIELDS = [
  {
    key: "x",
    type: "number",
    label: "Leitura X",
    required: true,
    unit: "mm",
    defaultValue: 0.0,
  },
] as const;

/**
 * Insert a calibration_method row at any status and with any technicalReviewedBy,
 * bypassing the POST / handler's initial-status lock and compile gate.
 *
 * SEED NOTES:
 * - description: "" (not null) and a seeded assetTypeId keep these rows close to
 *   real ones. Both used to be load-bearing: the draft mappers map null→undefined
 *   and `assertSafeUnknown` rejected keys holding `undefined`, so a null
 *   description or assetTypeId 500'd on every compiling transition. That is fixed
 *   in `packages/method-definition/src/safety.ts`.
 */
async function seedMethod(params: {
  orgId: string;
  createdBy: string;
  status: "DRAFT" | "PENDING_APPROVAL" | "TECHNICAL_REVIEWED" | "PUBLISHED";
  technicalReviewedBy?: string | null;
  version?: number;
  nameSuffix?: string;
  assetTypeId?: number | null;
  // DOM-10: allow seeding a method with an ALREADY-STORED dimensional
  // incoherence directly (bypassing POST/PUT), so the request-approval,
  // quality-approve and publish gates can be exercised on a pre-existing bad
  // row — the scenario those routes must catch that POST/PUT structurally
  // cannot (they only ever see net-new/edited shapes, never a row that was
  // incoherent before the gate existed).
  dataFields?: MethodInputField[];
  formulas?: MethodFormula[];
}): Promise<number> {
  const name = `Método Teste ${params.nameSuffix ?? params.orgId}`;
  const [row] = await db
    .insert(calibrationMethod)
    .values({
      organizationId: params.orgId,
      assetTypeId: params.assetTypeId ?? null,
      name,
      description: "",
      version: params.version ?? 1,
      status: params.status,
      dataFields: params.dataFields ?? MINIMAL_DATA_FIELDS,
      formulas: params.formulas ?? [],
      validations: [],
      accreditedScope: false,
      createdBy: params.createdBy,
      technicalReviewedBy: params.technicalReviewedBy ?? null,
      // compiledMethod / methodFingerprint intentionally null for DRAFT/PENDING seeds;
      // the handler sets them on transitions that compile.
    })
    .returning({ id: calibrationMethod.id });
  if (!row) throw new Error("seedMethod: insert failed");
  return row.id;
}

/**
 * Seed a minimal org in one call.
 */
async function seedOrgWithPro(params: {
  orgId: string;
  userId: string;
  role?: "owner" | "admin" | "technician" | "operator" | "member";
}) {
  const org = await seedOrg({
    orgId: params.orgId,
    userId: params.userId,
    role: params.role ?? "admin",
  });
  return org;
}

/**
 * Insert an extra user + member for an existing org.
 */
async function seedExtraMember(params: {
  userId: string;
  orgId: string;
  role: "owner" | "admin" | "technician" | "operator" | "member";
}): Promise<void> {
  await db.insert(user).values({
    id: params.userId,
    name: `User ${params.userId}`,
    email: `${params.userId}@lab.test`,
  });
  await db.insert(member).values({
    id: `member-${params.userId}`,
    organizationId: params.orgId,
    userId: params.userId,
    role: params.role,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  });
}

/**
 * Seed a minimal asset type row and return its id.
 *
 * Linking a method to a real asset type makes `methodRecordToDraft` emit
 * assetTypeId as a string ("1"). This used to be required for any test reaching
 * quality-approve compilation, because a null assetTypeId mapped to `undefined`
 * and `assertSafeUnknown` rejected it with
 * "draft.assetTypeId has unsupported type undefined" — no longer the case.
 */
async function seedAssetType(): Promise<number> {
  const [row] = await db
    .insert(assetType)
    .values({
      name: "Instrumento de Teste",
      slug: "instrumento-teste",
      definition: [],
    })
    .returning({ id: assetType.id });
  if (!row) throw new Error("seedAssetType: insert failed");
  return row.id;
}

// ---------------------------------------------------------------------------

describe("methodsRouter — GUM method workflow (ISO/IEC 17025)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // =========================================================================
  // REQ-METH-001: Tenant isolation
  // =========================================================================
  it("REQ-METH-001: org A cannot GET or transition org B's method (→ 404); GET / returns only org A's methods", async () => {
    const orgA = await seedOrgWithPro({ orgId: "org-a", userId: "user-a" });
    const orgB = await seedOrgWithPro({ orgId: "org-b", userId: "user-b" });

    // Seed one DRAFT method in org A
    const methodAId = await seedMethod({
      orgId: "org-a",
      createdBy: orgA.userId,
      status: "DRAFT",
      nameSuffix: "a",
    });

    // Seed one PENDING_APPROVAL method in org B
    const methodBId = await seedMethod({
      orgId: "org-b",
      createdBy: orgB.userId,
      status: "PENDING_APPROVAL",
      nameSuffix: "b",
    });

    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });

    // --- Cross-tenant GET /:id ---
    const getRes = await methodsRouter.request(`/${methodBId}`);
    // resolveMethodRouteId scopes by org → numeric id not found under org A
    expect(getRes.status).toBe(404);

    // --- Cross-tenant transition (technical-review) ---
    const reviewRes = await methodsRouter.request(
      `/${methodBId}/technical-review`,
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({}),
      },
    );
    expect(reviewRes.status).toBe(404);

    // Org B's method is unchanged
    const [orgBRow] = await db
      .select({ status: calibrationMethod.status })
      .from(calibrationMethod)
      .where(eq(calibrationMethod.id, methodBId));
    expect(orgBRow?.status).toBe("PENDING_APPROVAL");

    // --- GET / returns only org A's methods ---
    const listRes = await methodsRouter.request("/");
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    // pagination.total must equal org A's method count (exactly 1)
    expect(listBody.pagination.total).toBe(1);
    expect(listBody.data).toHaveLength(1);
    expect(listBody.data[0].id).toBe(methodAId);
  });

  // =========================================================================
  // REQ-METH-002: State machine
  // =========================================================================
  it("REQ-METH-002-a: technical-review a PENDING_APPROVAL method as admin → 200 + TECHNICAL_REVIEWED + technicalReviewedBy set (DB-verified)", async () => {
    const org = await seedOrgWithPro({ orgId: "org-sm", userId: "user-sm" });

    const methodId = await seedMethod({
      orgId: "org-sm",
      createdBy: org.userId,
      status: "PENDING_APPROVAL",
    });

    loginAs({ userId: org.userId, organizationId: org.orgId });
    const res = await methodsRouter.request(`/${methodId}/technical-review`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("TECHNICAL_REVIEWED");
    expect(body.technicalReviewedBy).toBe(org.userId);

    // DB-verify
    const [dbRow] = await db
      .select({
        status: calibrationMethod.status,
        technicalReviewedBy: calibrationMethod.technicalReviewedBy,
      })
      .from(calibrationMethod)
      .where(eq(calibrationMethod.id, methodId));
    expect(dbRow?.status).toBe("TECHNICAL_REVIEWED");
    expect(dbRow?.technicalReviewedBy).toBe(org.userId);
  });

  it("REQ-METH-002-b: technical-review a DRAFT method → 400 (wrong state)", async () => {
    const org = await seedOrgWithPro({
      orgId: "org-sm2",
      userId: "user-sm2",
    });

    const methodId = await seedMethod({
      orgId: "org-sm2",
      createdBy: org.userId,
      status: "DRAFT",
    });

    loginAs({ userId: org.userId, organizationId: org.orgId });
    const res = await methodsRouter.request(`/${methodId}/technical-review`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });

  it("REQ-METH-002-c: quality-approve a TECHNICAL_REVIEWED method (distinct owner) → 200 + PUBLISHED (DB-verified)", async () => {
    // admin seeds the org; then we need an owner to quality-approve
    const org = await seedOrgWithPro({
      orgId: "org-sm3",
      userId: "user-admin-sm3",
      role: "admin",
    });

    const ownerId = "user-owner-sm3";
    await seedExtraMember({
      userId: ownerId,
      orgId: "org-sm3",
      role: "owner",
    });

    // Seed an asset type so methodRecordToDraft produces assetTypeId:"1" (string)
    // rather than undefined, keeping the seeded row close to a real one.
    const assetTypeId = await seedAssetType();

    // Seed TECHNICAL_REVIEWED by admin (distinct from owner)
    const methodId = await seedMethod({
      orgId: "org-sm3",
      createdBy: org.userId,
      status: "TECHNICAL_REVIEWED",
      technicalReviewedBy: org.userId, // admin reviewed
      assetTypeId,
    });

    // Owner approves (distinct from reviewer)
    loginAs({ userId: ownerId, organizationId: "org-sm3" });
    const res = await methodsRouter.request(`/${methodId}/quality-approve`, {
      method: "POST",
      headers: JSON_HEADERS,
      // sampleData drives the ad-hoc preview scenario; x is the only input field
      body: JSON.stringify({ sampleData: { x: 1.0 } }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("PUBLISHED");

    // DB-verify
    const [dbRow] = await db
      .select({ status: calibrationMethod.status })
      .from(calibrationMethod)
      .where(eq(calibrationMethod.id, methodId));
    expect(dbRow?.status).toBe("PUBLISHED");
  });

  it("REQ-METH-002-d: quality-approve a PENDING_APPROVAL method (not TECHNICAL_REVIEWED) → 400", async () => {
    const org = await seedOrgWithPro({
      orgId: "org-sm4",
      userId: "user-owner-sm4",
      role: "owner",
    });

    const methodId = await seedMethod({
      orgId: "org-sm4",
      createdBy: org.userId,
      status: "PENDING_APPROVAL",
    });

    loginAs({ userId: org.userId, organizationId: org.orgId });
    const res = await methodsRouter.request(`/${methodId}/quality-approve`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ sampleData: { x: 1.0 } }),
    });

    expect(res.status).toBe(400);
  });

  it("REQ-METH-002-e: PUT a PUBLISHED method → 400 (immutable)", async () => {
    const org = await seedOrgWithPro({
      orgId: "org-sm5",
      userId: "user-sm5",
    });

    const publisherId = "user-owner-sm5";
    await seedExtraMember({
      userId: publisherId,
      orgId: "org-sm5",
      role: "owner",
    });

    const methodId = await seedMethod({
      orgId: "org-sm5",
      createdBy: org.userId,
      status: "PUBLISHED",
      technicalReviewedBy: org.userId,
    });

    loginAs({ userId: org.userId, organizationId: org.orgId });
    const res = await methodsRouter.request(`/${methodId}`, {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        name: "Método Teste org-sm5",
        description: "Updated",
        dataFields: MINIMAL_DATA_FIELDS,
        formulas: [],
        validations: [],
        accreditedScope: false,
      }),
    });

    expect(res.status).toBe(400);

    // DB: still PUBLISHED
    const [dbRow] = await db
      .select({ status: calibrationMethod.status })
      .from(calibrationMethod)
      .where(eq(calibrationMethod.id, methodId));
    expect(dbRow?.status).toBe("PUBLISHED");
  });

  it("REQ-METH-002-f: new-version of a PUBLISHED method → 201 + new DRAFT with version 2", async () => {
    const org = await seedOrgWithPro({
      orgId: "org-sm6",
      userId: "user-sm6",
    });

    const methodId = await seedMethod({
      orgId: "org-sm6",
      createdBy: org.userId,
      status: "PUBLISHED",
      version: 1,
      nameSuffix: "sm6",
    });

    loginAs({ userId: org.userId, organizationId: org.orgId });
    const res = await methodsRouter.request(`/${methodId}/new-version`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe("DRAFT");
    expect(body.version).toBe(2);

    // DB-verify: a new DRAFT row with version=2 exists for this org
    const [draftRow] = await db
      .select({
        status: calibrationMethod.status,
        version: calibrationMethod.version,
      })
      .from(calibrationMethod)
      .where(
        and(
          eq(calibrationMethod.organizationId, "org-sm6"),
          eq(calibrationMethod.status, "DRAFT"),
        ),
      );
    expect(draftRow?.status).toBe("DRAFT");
    expect(draftRow?.version).toBe(2);
  });

  // =========================================================================
  // REQ-METH-003: FOUR-EYES by identity (reviewer ≠ approver)
  // =========================================================================
  it("REQ-METH-003: quality-approve as the same user who did technical-review → 400 'usuarios diferentes'; method stays TECHNICAL_REVIEWED; distinct owner → 200 + PUBLISHED", async () => {
    // Seed org with ownerA and ownerB, both role=owner
    // ownerA will have done the technical-review (seeded directly)
    // ownerA self-approve attempt → 400
    // ownerB approve → 200
    const ownerAId = "user-owner-a-fe";
    const ownerBId = "user-owner-b-fe";

    // seedOrg creates the first user as owner
    await seedOrg({ orgId: "org-fe", userId: ownerAId, role: "owner" });
    await seedExtraMember({ userId: ownerBId, orgId: "org-fe", role: "owner" });

    // Seed an asset type so compilation doesn't fail with "assetTypeId undefined".
    const assetTypeId = await seedAssetType();

    // Seed TECHNICAL_REVIEWED with technicalReviewedBy = ownerA
    const methodId = await seedMethod({
      orgId: "org-fe",
      createdBy: ownerAId,
      status: "TECHNICAL_REVIEWED",
      technicalReviewedBy: ownerAId,
      assetTypeId,
    });

    // ownerA tries to quality-approve (self) → 400
    loginAs({ userId: ownerAId, organizationId: "org-fe" });
    const selfApproveRes = await methodsRouter.request(
      `/${methodId}/quality-approve`,
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ sampleData: { x: 1.0 } }),
      },
    );
    expect(selfApproveRes.status).toBe(400);
    const selfApproveBody = await selfApproveRes.json();
    expect(selfApproveBody.error).toContain("usuarios diferentes");

    // DB: method is still TECHNICAL_REVIEWED
    const [afterSelfRow] = await db
      .select({ status: calibrationMethod.status })
      .from(calibrationMethod)
      .where(eq(calibrationMethod.id, methodId));
    expect(afterSelfRow?.status).toBe("TECHNICAL_REVIEWED");

    // ownerB (distinct) quality-approves → 200 + PUBLISHED
    loginAs({ userId: ownerBId, organizationId: "org-fe" });
    const distinctRes = await methodsRouter.request(
      `/${methodId}/quality-approve`,
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ sampleData: { x: 1.0 } }),
      },
    );
    expect(distinctRes.status).toBe(200);
    const distinctBody = await distinctRes.json();
    expect(distinctBody.status).toBe("PUBLISHED");

    // DB-verify
    const [publishedRow] = await db
      .select({ status: calibrationMethod.status })
      .from(calibrationMethod)
      .where(eq(calibrationMethod.id, methodId));
    expect(publishedRow?.status).toBe("PUBLISHED");
  });

  // =========================================================================
  // REQ-METH-006: FOUR-EYES by identity on the SECOND surface — POST /:id/publish
  //
  // methods.ts exposes a `compat` publish endpoint (POST /:id/publish, line ~2335)
  // that is a twin of quality-approve: same TECHNICAL_REVIEWED → PUBLISHED
  // transition, same requireRole(["owner"]) gate, and its OWN identity four-eyes
  // guard at methods.ts:2381 ("Revisao tecnica e publicacao devem ser feitas por
  // usuarios diferentes"). The maker's REQ-METH-003 only exercises the
  // quality-approve guard (line 2122); this REQ covers the distinct /publish code
  // path so deleting the line-2381 guard turns a test RED too.
  //
  // Added during integration (not by the maker) to close the /publish coverage gap.
  // =========================================================================
  it("REQ-METH-006: publish as the same user who did technical-review → 400 'usuarios diferentes'; method stays TECHNICAL_REVIEWED; distinct owner → 200 + PUBLISHED", async () => {
    const ownerAId = "user-owner-a-pub";
    const ownerBId = "user-owner-b-pub";

    // seedOrg creates ownerA as owner; add ownerB as a second owner
    await seedOrg({ orgId: "org-pub", userId: ownerAId, role: "owner" });
    await seedExtraMember({
      userId: ownerBId,
      orgId: "org-pub",
      role: "owner",
    });

    // Asset type so compilation doesn't fail with "assetTypeId undefined".
    const assetTypeId = await seedAssetType();

    // TECHNICAL_REVIEWED with technicalReviewedBy = ownerA.
    const methodId = await seedMethod({
      orgId: "org-pub",
      createdBy: ownerAId,
      status: "TECHNICAL_REVIEWED",
      technicalReviewedBy: ownerAId,
      assetTypeId,
    });

    // ownerA tries to PUBLISH the method they reviewed (self) → 400.
    // Only the identity guard can produce this 400: ownerA holds owner role,
    // the method is genuinely TECHNICAL_REVIEWED, and the feature is enabled —
    // so role/feature/state are all satisfied and identity is the sole blocker.
    loginAs({ userId: ownerAId, organizationId: "org-pub" });
    const selfPublishRes = await methodsRouter.request(`/${methodId}/publish`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ sampleData: { x: 1.0 } }),
    });
    expect(selfPublishRes.status).toBe(400);
    const selfPublishBody = await selfPublishRes.json();
    expect(selfPublishBody.error).toContain("usuarios diferentes");

    // DB: method is still TECHNICAL_REVIEWED (self-publish did not transition it).
    const [afterSelfRow] = await db
      .select({ status: calibrationMethod.status })
      .from(calibrationMethod)
      .where(eq(calibrationMethod.id, methodId));
    expect(afterSelfRow?.status).toBe("TECHNICAL_REVIEWED");

    // ownerB (distinct) publishes → 200 + PUBLISHED.
    loginAs({ userId: ownerBId, organizationId: "org-pub" });
    const distinctRes = await methodsRouter.request(`/${methodId}/publish`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ sampleData: { x: 1.0 } }),
    });
    expect(distinctRes.status).toBe(200);
    const distinctBody = await distinctRes.json();
    expect(distinctBody.status).toBe("PUBLISHED");

    // DB-verify
    const [publishedRow] = await db
      .select({ status: calibrationMethod.status })
      .from(calibrationMethod)
      .where(eq(calibrationMethod.id, methodId));
    expect(publishedRow?.status).toBe("PUBLISHED");
  });

  // =========================================================================
  // REQ-METH-004: RBAC
  // =========================================================================
  it("REQ-METH-004-a: technical-review as technician (non-admin) → 403", async () => {
    const techId = "user-tech-rbac";
    await seedOrg({ orgId: "org-rbac", userId: techId, role: "technician" });

    const methodId = await seedMethod({
      orgId: "org-rbac",
      createdBy: techId,
      status: "PENDING_APPROVAL",
    });

    loginAs({ userId: techId, organizationId: "org-rbac" });
    const res = await methodsRouter.request(`/${methodId}/technical-review`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);
  });

  it("REQ-METH-004-b: technical-review as owner (non-admin) → 403", async () => {
    const ownerId = "user-owner-rbac2";
    await seedOrg({ orgId: "org-rbac2", userId: ownerId, role: "owner" });

    const adminId = "user-admin-rbac2";
    await seedExtraMember({
      userId: adminId,
      orgId: "org-rbac2",
      role: "admin",
    });

    const methodId = await seedMethod({
      orgId: "org-rbac2",
      createdBy: adminId,
      status: "PENDING_APPROVAL",
    });

    // Owner tries to do technical-review (only admin may)
    loginAs({ userId: ownerId, organizationId: "org-rbac2" });
    const res = await methodsRouter.request(`/${methodId}/technical-review`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);
  });

  it("REQ-METH-004-c: quality-approve as admin (non-owner) → 403", async () => {
    const adminId = "user-admin-rbac3";
    await seedOrg({ orgId: "org-rbac3", userId: adminId, role: "admin" });

    const ownerId = "user-owner-rbac3";
    await seedExtraMember({
      userId: ownerId,
      orgId: "org-rbac3",
      role: "owner",
    });

    // TECHNICAL_REVIEWED by owner (distinct from admin who will try to approve)
    const methodId = await seedMethod({
      orgId: "org-rbac3",
      createdBy: adminId,
      status: "TECHNICAL_REVIEWED",
      technicalReviewedBy: ownerId,
    });

    // Admin tries to quality-approve (only owner may)
    loginAs({ userId: adminId, organizationId: "org-rbac3" });
    const res = await methodsRouter.request(`/${methodId}/quality-approve`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ sampleData: { x: 1.0 } }),
    });
    expect(res.status).toBe(403);
  });

  // =========================================================================
  // REQ-METH-005: Unauthenticated
  // =========================================================================
  it("REQ-METH-005: unauthenticated technical-review and quality-approve → 401", async () => {
    // We don't even need a real method — auth check fires before DB access.
    logout();

    const techReviewRes = await methodsRouter.request("/999/technical-review", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({}),
    });
    expect(techReviewRes.status).toBe(401);

    const qaApproveRes = await methodsRouter.request("/999/quality-approve", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({}),
    });
    expect(qaApproveRes.status).toBe(401);
  });

  // =========================================================================
  // REQ-CMP-AUD-002/003 (#649): deleting a DRAFT method must WRITE a 'delete'
  // audit row and that row must SURVIVE the deletion (ISO/IEC 17025 append-only
  // trail). Before the fix there was no delete audit insert at all AND the
  // method_id FK cascaded — the trail had no trace of the deletion.
  // =========================================================================
  it("REQ-CMP-AUD-002: DELETE /:id writes a 'delete' audit row that survives the deletion", async () => {
    const org = await seedOrg({ orgId: "org-aud", role: "admin" });
    const methodId = await seedMethod({
      orgId: org.orgId,
      createdBy: org.userId,
      status: "DRAFT",
      nameSuffix: "auditável",
    });

    loginAs({ userId: org.userId, organizationId: org.orgId });
    const res = await methodsRouter.request(`/${methodId}`, {
      method: "DELETE",
      headers: JSON_HEADERS,
    });
    expect(res.status).toBe(200);

    // The method row is gone…
    const remaining = await db
      .select()
      .from(calibrationMethod)
      .where(eq(calibrationMethod.id, methodId));
    expect(remaining).toHaveLength(0);

    // …but the deletion's audit row persists with enough data to be useful
    // without the original row (REQ-CMP-AUD-003: id + name + actor + timestamp).
    const logs = await db
      .select()
      .from(methodAuditLog)
      .where(
        and(
          eq(methodAuditLog.methodId, methodId),
          eq(methodAuditLog.action, "delete"),
        ),
      );
    expect(logs).toHaveLength(1);
    expect(logs[0]?.performedBy).toBe(org.userId);
    expect(logs[0]?.performedAt).toBeInstanceOf(Date);
    expect(logs[0]?.changes).toMatchObject({
      method: { old: { name: "Método Teste auditável" }, new: null },
    });
  });

  // =========================================================================
  // REQ-DIM-201 [HIGH RISK] / REQ-DIM-202: dimensional publish gate (DOM-10)
  //
  // A method WRITE that (re)defines fields/formulas with a dimensional
  // incoherence (e.g. massa[g] + tensao[V]) must be rejected with the named
  // DIMENSIONAL_ERROR + per-formula diagnostics, and the row must be unchanged.
  // A dimensionally coherent method — including empirical formulas with
  // dimension-bearing constants (Magnus) — writes exactly as before.
  // =========================================================================

  // Typed (not `as const`) so the SAME fixture can be spread into a POST/PUT
  // JSON body AND passed straight to `seedMethod`'s typed dataFields/formulas
  // (for the request-approval/quality-approve/publish deny tests, which need
  // an ALREADY-STORED incoherent row rather than one submitted through
  // POST/PUT).
  const DIMENSIONALLY_BAD_DATA_FIELDS: MethodInputField[] = [
    {
      key: "massa",
      label: "Massa",
      type: "number",
      required: true,
      unit: "g",
      defaultValue: 0.0,
    },
    {
      key: "tensao",
      label: "Tensão",
      type: "number",
      required: true,
      unit: "V",
      defaultValue: 0.0,
    },
  ];
  const DIMENSIONALLY_BAD_FORMULAS: MethodFormula[] = [
    { outputKey: "erro", expression: "massa + tensao", unit: "g" },
  ];
  const DIMENSIONALLY_BAD_FORMULA = {
    dataFields: DIMENSIONALLY_BAD_DATA_FIELDS,
    formulas: DIMENSIONALLY_BAD_FORMULAS,
  };

  // Magnus saturation-vapour-pressure: t[°C] → hPa. The constants are
  // dimension-bearing literals (wildcards unified by context), so a correct
  // empirical formula must NOT be flagged.
  const MAGNUS_METHOD = {
    dataFields: [
      {
        key: "t",
        label: "Temperatura",
        type: "number",
        required: true,
        unit: "°C",
        defaultValue: 20.0,
      },
    ],
    formulas: [
      {
        outputKey: "es",
        expression: "6.112 * exp(17.62 * t / (243.12 + t))",
        unit: "hPa",
      },
    ],
  } as const;

  it("REQ-DIM-201: POST / with massa[g] + tensao[V] → 422 DIMENSIONAL_ERROR; no row persisted", async () => {
    const org = await seedOrgWithPro({
      orgId: "org-dim",
      userId: "user-dim",
    });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const res = await methodsRouter.request("/", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        name: "Método Dimensional Ruim",
        ...DIMENSIONALLY_BAD_FORMULA,
      }),
    });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe("DIMENSIONAL_ERROR");
    expect(Array.isArray(body.diagnostics)).toBe(true);
    expect(body.diagnostics.length).toBeGreaterThan(0);
    expect(body.diagnostics[0].formulaId).toBe("erro");
    expect(typeof body.diagnostics[0].message).toBe("string");
    // The formatted dimensions must appear (mass M vs voltage M·L^2·T^-3·I^-1).
    expect(body.diagnostics[0].message).toContain("M·L^2·T^-3·I^-1");

    // Row NOT persisted.
    const rows = await db
      .select()
      .from(calibrationMethod)
      .where(
        and(
          eq(calibrationMethod.organizationId, org.orgId),
          eq(calibrationMethod.name, "Método Dimensional Ruim"),
        ),
      );
    expect(rows).toHaveLength(0);
  });

  it("REQ-DIM-202: POST / with a Magnus-style empirical formula → 201 (no false positive)", async () => {
    const org = await seedOrgWithPro({
      orgId: "org-magnus",
      userId: "user-magnus",
    });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const res = await methodsRouter.request("/", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: "Método Magnus", ...MAGNUS_METHOD }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe("DRAFT");

    const rows = await db
      .select({ id: calibrationMethod.id })
      .from(calibrationMethod)
      .where(
        and(
          eq(calibrationMethod.organizationId, org.orgId),
          eq(calibrationMethod.name, "Método Magnus"),
        ),
      );
    expect(rows).toHaveLength(1);
  });

  it("REQ-DIM-201: POST /compile surfaces a DIMENSIONAL_ERROR diagnostic (editor affordance) and ok:false", async () => {
    const org = await seedOrgWithPro({
      orgId: "org-dim-compile",
      userId: "user-dim-compile",
    });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    // A fully-shaped MethodDraft (the /compile "already a draft" branch).
    const res = await methodsRouter.request("/compile", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        id: "compile_dim",
        version: 1,
        status: "draft",
        name: "Compile Dimensional",
        inputs: [
          {
            kind: "scalar",
            key: "massa",
            label: "Massa",
            unit: "g",
            required: true,
          },
          {
            kind: "scalar",
            key: "tensao",
            label: "Tensão",
            unit: "V",
            required: true,
          },
        ],
        formulas: [
          {
            key: "erro",
            label: "Erro",
            expression: "massa + tensao",
            outputUnit: "g",
            outputKind: "error",
            required: true,
          },
        ],
        measurementModels: [],
        acceptanceCriteria: [],
        previewScenarios: [],
        metadata: { validationStatus: "pending_revalidation" },
      }),
    });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.ok).toBe(false);
    // The existing compile-preview panel lists these per-formula error entries.
    const dimensional = body.diagnostics.filter(
      (d: { code?: string }) => d.code === "DIMENSIONAL_ERROR",
    );
    expect(dimensional.length).toBeGreaterThan(0);
    expect(dimensional[0].severity).toBe("error");
    expect(dimensional[0].path).toBe("erro");
    expect(dimensional[0].message).toContain("M·L^2·T^-3·I^-1");
  });

  it("REQ-DIM-201: PUT /:id introducing a dimensional incoherence → 422; row unchanged", async () => {
    const org = await seedOrgWithPro({
      orgId: "org-dim-upd",
      userId: "user-dim-upd",
    });
    const methodId = await seedMethod({
      orgId: org.orgId,
      createdBy: org.userId,
      status: "DRAFT",
      nameSuffix: "atualizável",
    });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const res = await methodsRouter.request(`/${methodId}`, {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        name: "Método Teste atualizável",
        ...DIMENSIONALLY_BAD_FORMULA,
      }),
    });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe("DIMENSIONAL_ERROR");
    expect(body.diagnostics[0].formulaId).toBe("erro");

    // Row unchanged: still the seeded MINIMAL_DATA_FIELDS + empty formulas.
    const [row] = await db
      .select({
        dataFields: calibrationMethod.dataFields,
        formulas: calibrationMethod.formulas,
        status: calibrationMethod.status,
      })
      .from(calibrationMethod)
      .where(eq(calibrationMethod.id, methodId));
    expect(row?.status).toBe("DRAFT");
    expect(row?.formulas).toEqual([]);
    expect(row?.dataFields).toEqual(MINIMAL_DATA_FIELDS);
  });

  // =========================================================================
  // REQ-DIM-201 [HIGH RISK] — deny tests for the transition gates
  // (request-approval / quality-approve / publish) against a PRE-EXISTING
  // incoherent method row.
  //
  // The POST/PUT deny tests above can only ever exercise a NET-NEW or
  // freshly-edited shape (they always go through the gated create/update
  // handlers). They CANNOT exercise the scenario where a row was written
  // BEFORE the gate existed (or slipped through some other path) and is later
  // pushed through request-approval / quality-approve / publish — the exact
  // regulatory invariant DOM-10 must hold: a stale incoherent method can never
  // reach PUBLISHED. `seedMethod` here inserts the incoherent
  // massa[g]+tensao[V] row DIRECTLY, bypassing POST/PUT entirely.
  // =========================================================================

  it("REQ-DIM-201: request-approval on a PRE-EXISTING incoherent DRAFT → 422 DIMENSIONAL_ERROR; stays DRAFT", async () => {
    const org = await seedOrgWithPro({
      orgId: "org-dim-ra",
      userId: "user-dim-ra",
    });
    // Link a real asset type so the seeded row matches what POST/PUT would store.
    const assetTypeId = await seedAssetType();
    const methodId = await seedMethod({
      orgId: org.orgId,
      createdBy: org.userId,
      status: "DRAFT",
      nameSuffix: "ra-incoerente",
      assetTypeId,
      dataFields: DIMENSIONALLY_BAD_DATA_FIELDS,
      formulas: DIMENSIONALLY_BAD_FORMULAS,
    });

    loginAs({ userId: org.userId, organizationId: org.orgId });
    const res = await methodsRouter.request(`/${methodId}/request-approval`, {
      method: "POST",
      headers: JSON_HEADERS,
      // sampleData makes the (dimension-blind) engine compile/preview pass,
      // so the DIMENSIONAL gate — not PREVIEW_FAILED — is what's exercised.
      body: JSON.stringify({ sampleData: { massa: 10, tensao: 5 } }),
    });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe("DIMENSIONAL_ERROR");
    expect(body.diagnostics[0].formulaId).toBe("erro");

    const [row] = await db
      .select({ status: calibrationMethod.status })
      .from(calibrationMethod)
      .where(eq(calibrationMethod.id, methodId));
    expect(row?.status).toBe("DRAFT");
  });

  it("REQ-DIM-201: quality-approve on a PRE-EXISTING incoherent TECHNICAL_REVIEWED method → 422; status unchanged", async () => {
    const org = await seedOrgWithPro({
      orgId: "org-dim-qa",
      userId: "user-admin-dim-qa",
      role: "admin",
    });
    const ownerId = "user-owner-dim-qa";
    await seedExtraMember({
      userId: ownerId,
      orgId: "org-dim-qa",
      role: "owner",
    });
    const assetTypeId = await seedAssetType();

    const methodId = await seedMethod({
      orgId: "org-dim-qa",
      createdBy: org.userId,
      status: "TECHNICAL_REVIEWED",
      technicalReviewedBy: org.userId, // admin reviewed; owner approves (four-eyes)
      assetTypeId,
      nameSuffix: "qa-incoerente",
      dataFields: DIMENSIONALLY_BAD_DATA_FIELDS,
      formulas: DIMENSIONALLY_BAD_FORMULAS,
    });

    loginAs({ userId: ownerId, organizationId: "org-dim-qa" });
    const res = await methodsRouter.request(`/${methodId}/quality-approve`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ sampleData: { massa: 10, tensao: 5 } }),
    });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe("DIMENSIONAL_ERROR");
    expect(body.diagnostics[0].formulaId).toBe("erro");

    const [row] = await db
      .select({ status: calibrationMethod.status })
      .from(calibrationMethod)
      .where(eq(calibrationMethod.id, methodId));
    expect(row?.status).toBe("TECHNICAL_REVIEWED");
  });

  it("REQ-DIM-201 [MANDATORY]: POST /:id/publish on a PRE-EXISTING incoherent TECHNICAL_REVIEWED method → 422 DIMENSIONAL_ERROR; status NEVER reaches PUBLISHED", async () => {
    const org = await seedOrgWithPro({
      orgId: "org-dim-pub",
      userId: "user-admin-dim-pub",
      role: "admin",
    });
    const publisherId = "user-owner-dim-pub";
    await seedExtraMember({
      userId: publisherId,
      orgId: "org-dim-pub",
      role: "owner",
    });
    const assetTypeId = await seedAssetType();

    const methodId = await seedMethod({
      orgId: "org-dim-pub",
      createdBy: org.userId,
      status: "TECHNICAL_REVIEWED",
      technicalReviewedBy: org.userId, // admin reviewed; owner publishes (four-eyes)
      assetTypeId,
      nameSuffix: "pub-incoerente",
      dataFields: DIMENSIONALLY_BAD_DATA_FIELDS,
      formulas: DIMENSIONALLY_BAD_FORMULAS,
    });

    loginAs({ userId: publisherId, organizationId: "org-dim-pub" });
    const res = await methodsRouter.request(`/${methodId}/publish`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ sampleData: { massa: 10, tensao: 5 } }),
    });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe("DIMENSIONAL_ERROR");
    expect(body.diagnostics[0].formulaId).toBe("erro");
    expect(body.diagnostics[0].message).toContain("M·L^2·T^-3·I^-1");

    // The regulatory invariant: this method NEVER reaches PUBLISHED.
    const [row] = await db
      .select({
        status: calibrationMethod.status,
        publishedAt: calibrationMethod.publishedAt,
      })
      .from(calibrationMethod)
      .where(eq(calibrationMethod.id, methodId));
    expect(row?.status).toBe("TECHNICAL_REVIEWED");
    expect(row?.status).not.toBe("PUBLISHED");
    expect(row?.publishedAt).toBeNull();
  });

  // =========================================================================
  // REQ-DIM-201 — POST /from-template: DOCUMENTED UNREACHABLE (not a deny test)
  //
  // `FromTemplateSchema` (packages/schemas) accepts ONLY `templateKey`,
  // `assetTypeId`, `name` and the adoption `acknowledgements` — it has NO
  // `dataFields`/`formulas`/`measurementModels` fields, and the handler always
  // builds the new method from `template.productDefinition` (the CURATED
  // registry entry), never from client-supplied field/formula data. There is
  // therefore no payload an attacker/caller can send through THIS route to
  // instantiate a dimensionally-incoherent method — the only way an
  // incoherent method could reach this route is if a REGISTERED TEMPLATE
  // itself were incoherent, and that is exactly what
  // packages/method-templates/src/dimensional-templates.test.ts
  // ("every platform template in the registry produces zero diagnostics")
  // already asserts, over every `TEMPLATE_REGISTRY` entry, on every test run.
  // The from-template gate (dimensionalGateError(def) in methods.ts) is
  // therefore defence-in-depth for a future incoherent template, not something
  // reachable — hence no deny test here.
  // =========================================================================
});
