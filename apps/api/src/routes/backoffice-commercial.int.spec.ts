import { beforeEach, describe, expect, it } from "vitest";
import { backofficeRouter } from "./backoffice";
import { db } from "@calibra-facil/db";
import { organization } from "@calibra-facil/db/schema";
import {
  loginAsBackoffice,
  logoutBackoffice,
} from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";

// Real-DB + real-RBAC integration tests for the backoffice COMMERCIAL router.
//
// ── Mounting (production parity) ─────────────────────────────────────────────
// `backofficeCommercialRouter` (./backoffice-commercial.ts) defines its routes
// with NO middleware of its own. In production it is mounted as a child of the
// real `backofficeRouter`:
//
//   apps/api/src/server/route-mounts.ts:124   .route("/api/backoffice", backofficeRouter)
//   apps/api/src/routes/backoffice.ts:794      .use("*", requireBackofficeAuthSession)   // ALL routes
//   apps/api/src/routes/backoffice.ts:894      .use("*", requireBackofficeAccess)        // routes AFTER this line
//   apps/api/src/routes/backoffice.ts:1502     .route("/commercial", backofficeCommercialRouter)
//
// Because `/commercial` is mounted AFTER both `.use("*", …)` guards, every
// `/commercial/*` request first passes through requireBackofficeAuthSession
// (401 when no session) and then requireBackofficeAccess (403 "Backoffice access
// required" for non-platform roles). We therefore import the REAL parent
// `backofficeRouter` and hit `/commercial/...` — replicating the exact
// production guard stack, NOT a synthetic ungated mount.
//
// ── Cut line for THIS router ─────────────────────────────────────────────────
// The gate under test is the PLATFORM-ROLE gate (user < operator < admin), not
// tenant isolation — backoffice is intentionally cross-org. Crucially, the
// commercial routes carry NO requirePlatformAdmin: every commercial route is
// access-only (requireBackofficeAccess), so a platform_operator IS admitted and
// only role "user" / unauthenticated is refused. canAccessBackoffice() returns
// true for BOTH platform_admin and platform_operator
// (packages/auth/src/access.ts:1034).
//
// Auth model: backoffice uses a SEPARATE Better-Auth instance. The harness mocks
// ONLY `createBackofficeAuth().api.getSession`; every guard runs for real:
//
//   requireBackofficeAuthSession  → 401 when no session
//   requireBackofficeAccess       → 403 "Backoffice access required" for role "user"
//
// Proven properties (EARS):
//   REQ-BC-001  Unauthenticated → 401
//   REQ-BC-002  Session role "user" (no backoffice access) → 403 "Backoffice access required"  [HIGH RISK]
//   REQ-BC-003  Commercial routes are access-only (NO requirePlatformAdmin):
//                 role "platform_operator" → 200 (admitted)
//                 role "platform_admin"    → 200 (admitted) and NOT 403
//                                                                                 [HIGH RISK]
//   REQ-BC-004  Cross-org by design: GET /commercial/organizations returns ALL
//               seeded LAB orgs (≥2 orgs, both appear) — no tenant scope applied
//   happy-path  A representative read returns the documented shape

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PLATFORM_ADMIN_USER = "bc-platform-admin-user";
const PLATFORM_OPERATOR_USER = "bc-platform-operator-user";
const PLATFORM_PLAIN_USER = "bc-platform-plain-user";

/**
 * Seed two minimal LAB organizations. GET /commercial/organizations filters
 * ONLY by `type = "LAB"` with NO org/tenant scope, so two orgs is enough to
 * prove the cross-org view.
 */
async function seedTwoLabOrgs(): Promise<{ orgAId: string; orgBId: string }> {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const orgAId = "bc-org-alpha";
  const orgBId = "bc-org-beta";

  await db.insert(organization).values([
    {
      id: orgAId,
      name: "Comercial Lab Alpha",
      slug: orgAId,
      createdAt: now,
      type: "LAB",
      status: "ACTIVE",
      cnpj: "11222333000181",
      email: "alpha@lab.test",
      phone: "+55 11 0000-0001",
    },
    {
      id: orgBId,
      name: "Comercial Lab Beta",
      slug: orgBId,
      createdAt: now,
      type: "LAB",
      status: "ACTIVE",
      cnpj: "44555666000172",
      email: "beta@lab.test",
      phone: "+55 11 0000-0002",
    },
  ]);

  return { orgAId, orgBId };
}

/**
 * Extract the `data` array from a `{ data: [...] }` envelope without an `as`
 * assertion (banned by oxlint consistent-type-assertions). Uses `in`-narrowing.
 */
function envelopeData(body: unknown): unknown[] {
  if (
    typeof body === "object" &&
    body !== null &&
    "data" in body &&
    Array.isArray(body.data)
  ) {
    return body.data;
  }
  throw new Error("expected response body shape { data: [...] }");
}

/** Pull string `id`s out of a `{ data: [{ id }, ...] }` envelope (no `as`). */
function envelopeIds(body: unknown): string[] {
  return envelopeData(body).flatMap((row) =>
    typeof row === "object" &&
    row !== null &&
    "id" in row &&
    typeof row.id === "string"
      ? [row.id]
      : [],
  );
}

/** Pull string `name`s out of a `{ data: [{ name }, ...] }` envelope (no `as`). */
function envelopeNames(body: unknown): string[] {
  return envelopeData(body).flatMap((row) =>
    typeof row === "object" &&
    row !== null &&
    "name" in row &&
    typeof row.name === "string"
      ? [row.name]
      : [],
  );
}

/** Pull the keys of the first envelope row (no `as`). */
function firstRowKeys(body: unknown): string[] {
  const [first] = envelopeData(body);
  if (typeof first === "object" && first !== null) {
    return Object.keys(first);
  }
  throw new Error("expected at least one row object in the envelope");
}

// Every commercial request travels through the REAL backofficeRouter (parent),
// so the real requireBackofficeAuthSession + requireBackofficeAccess fire.
const COMMERCIAL_ORGS_PATH = "/commercial/organizations";

describe("backofficeCommercialRouter — real DB + real platform-role guards (via real parent mount)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // =========================================================================
  // REQ-BC-001: Unauthenticated → 401
  // =========================================================================
  it("REQ-BC-001: unauthenticated request to GET /commercial/organizations → 401", async () => {
    logoutBackoffice();

    const res = await backofficeRouter.request(COMMERCIAL_ORGS_PATH);

    expect(res.status).toBe(401);
    // Regression guard: removing `.use("*", requireBackofficeAuthSession)` on the
    // parent would let this through (200) — the assertion then fails RED, proving
    // the auth gate is what produces the 401 on the commercial child route.
  });

  // =========================================================================
  // REQ-BC-002 [HIGH RISK]: role "user" → 403 "Backoffice access required"
  // =========================================================================
  it("REQ-BC-002: platform session role 'user' (no backoffice access) → 403 'Backoffice access required'", async () => {
    // role "user" is the default Better-Auth role — NOT platform_operator/admin,
    // so canAccessBackoffice() returns false in requireBackofficeAccess.
    loginAsBackoffice({ userId: PLATFORM_PLAIN_USER, role: "user" });

    const res = await backofficeRouter.request(COMMERCIAL_ORGS_PATH);

    expect(res.status).toBe(403);
    const body: unknown = await res.json();
    // The parent backoffice router's onError serializes HTTPException as { error }.
    expect(body).toMatchObject({ error: "Backoffice access required" });
    // Regression guard: removing the parent `.use("*", requireBackofficeAccess)`
    // (mounted BEFORE /commercial) would admit role "user" (200) — RED.
  });

  // =========================================================================
  // REQ-BC-003 [HIGH RISK]: commercial routes are ACCESS-ONLY (no platform-admin)
  //   operator → admitted (200); admin → admitted (200), NOT 403
  // =========================================================================
  it("REQ-BC-003a: platform_operator on an access-only commercial route → 200 (admitted)", async () => {
    // No commercial route carries requirePlatformAdmin, so the operator (which
    // clears requireBackofficeAccess) must be admitted — the contrast with the
    // role-"user" 403 in REQ-BC-002 proves the user < operator distinction.
    loginAsBackoffice({
      userId: PLATFORM_OPERATOR_USER,
      role: "platform_operator",
    });

    const res = await backofficeRouter.request(COMMERCIAL_ORGS_PATH);

    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    expect(Array.isArray(envelopeData(body))).toBe(true);
  });

  it("REQ-BC-003b: platform_admin on the same access-only commercial route → 200, NOT 403", async () => {
    loginAsBackoffice({
      userId: PLATFORM_ADMIN_USER,
      role: "platform_admin",
    });

    const res = await backofficeRouter.request(COMMERCIAL_ORGS_PATH);

    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    expect(Array.isArray(envelopeData(body))).toBe(true);
  });

  // =========================================================================
  // REQ-BC-004: Cross-org view — both seeded LAB orgs appear (no tenant scope)
  // =========================================================================
  it("REQ-BC-004: GET /commercial/organizations returns ALL seeded LAB organizations (cross-tenant by design)", async () => {
    const { orgAId, orgBId } = await seedTwoLabOrgs();

    loginAsBackoffice({
      userId: PLATFORM_ADMIN_USER,
      role: "platform_admin",
    });

    const res = await backofficeRouter.request(COMMERCIAL_ORGS_PATH);

    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    expect(Array.isArray(envelopeData(body))).toBe(true);

    const ids = envelopeIds(body);
    // Both orgs are visible — no tenant scope applied (cross-org by design).
    expect(ids).toContain(orgAId);
    expect(ids).toContain(orgBId);

    const names = envelopeNames(body);
    expect(names).toContain("Comercial Lab Alpha");
    expect(names).toContain("Comercial Lab Beta");
  });

  // =========================================================================
  // happy-path: representative read returns the documented shape
  // =========================================================================
  it("happy-path: GET /commercial/organizations returns the documented row shape", async () => {
    await seedTwoLabOrgs();

    loginAsBackoffice({
      userId: PLATFORM_OPERATOR_USER,
      role: "platform_operator",
    });

    const res = await backofficeRouter.request(COMMERCIAL_ORGS_PATH);

    expect(res.status).toBe(200);
    const body: unknown = await res.json();

    // The handler selects exactly { id, name, slug, cnpj, email, phone }.
    const keys = firstRowKeys(body);
    expect(keys.toSorted()).toEqual(
      ["cnpj", "email", "id", "name", "phone", "slug"].toSorted(),
    );
  });
});
