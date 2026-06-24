import { beforeEach, describe, expect, it } from "vitest";
import { backofficeRouter } from "./backoffice";
import { db } from "@calibra-facil/db";
import { organization } from "@calibra-facil/db/schema";
import { loginAsBackoffice, logoutBackoffice } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";

// Real-DB + real-RBAC integration tests for the backoffice router.
//
// Auth model: backoffice routes use a SEPARATE Better-Auth instance (platform
// operators / admins, NOT lab sessions).  The harness mocks only
// `createBackofficeAuth().api.getSession`; every guard runs for real:
//
//   requireBackofficeAuthSession  → 401 when no session
//   requireBackofficeAccess       → 403 "Backoffice access required" for role "user"
//   requirePlatformAdmin          → 403 "Platform admin access required" for role
//                                   "platform_operator" (operator < admin)
//
// Cut-line invariant: PLATFORM-ROLE gate (not tenant isolation — backoffice is
// intentionally cross-org).
//
// Proven properties:
//   REQ-BO-001  Unauthenticated         → 401
//   REQ-BO-002  Authenticated, role "user" (no backoffice access) → 403 "Backoffice access required"
//   REQ-BO-003  Platform-admin gate:
//                 role "platform_operator" → 403 "Platform admin access required"
//                 role "platform_admin"    → NOT 403 (200 / success)
//   REQ-BO-004  Platform cross-org view: GET /organizations returns ALL seeded LAB orgs
//   REQ-BO-005  Operator allowed on access-only route: role "platform_operator" → 200

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PLATFORM_ADMIN_USER = "platform-admin-user";
const PLATFORM_OPERATOR_USER = "platform-operator-user";
const PLATFORM_PLAIN_USER = "platform-plain-user";

/**
 * Seed two minimal LAB organizations (no units needed — the backoffice
 * /organizations list uses a LEFT JOIN so empty units are fine).
 */
async function seedTwoLabOrgs(): Promise<{ orgAId: string; orgBId: string }> {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const orgAId = "bo-org-alpha";
  const orgBId = "bo-org-beta";

  await db.insert(organization).values([
    {
      id: orgAId,
      name: "Lab Alpha",
      slug: orgAId,
      createdAt: now,
      type: "LAB",
      status: "ACTIVE",
    },
    {
      id: orgBId,
      name: "Lab Beta",
      slug: orgBId,
      createdAt: now,
      type: "LAB",
      status: "ACTIVE",
    },
  ]);

  return { orgAId, orgBId };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

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

describe("backofficeRouter — real DB + real platform-role guards", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // =========================================================================
  // REQ-BO-001: Unauthenticated → 401
  // =========================================================================
  it(
    "REQ-BO-001: unauthenticated request to GET /organizations → 401",
    async () => {
      // Ensure no backoffice session is active (getSession returns null).
      logoutBackoffice();

      const res = await backofficeRouter.request("/organizations");

      expect(res.status).toBe(401);
      // Regression guard: if requireBackofficeAuthSession were removed the status
      // would change — the assertion fails, proving the gate was exercised.
    },
  );

  // =========================================================================
  // REQ-BO-002: Logged-in platform user WITHOUT backoffice access → 403
  // =========================================================================
  it(
    "REQ-BO-002: platform user with role 'user' (no backoffice access) → 403 with 'Backoffice access required'",
    async () => {
      // role "user" is the default Better-Auth role — it is NOT platform_operator
      // or platform_admin, so canAccessBackoffice() returns false.
      loginAsBackoffice({ userId: PLATFORM_PLAIN_USER, role: "user" });

      const res = await backofficeRouter.request("/organizations");

      expect(res.status).toBe(403);
      const body: unknown = await res.json();
      // The backoffice router's onError serializes HTTPException as { error: message }
      expect(body).toMatchObject({ error: "Backoffice access required" });
    },
  );

  // =========================================================================
  // REQ-BO-003: Platform-admin gate (operator < admin)
  // =========================================================================
  it(
    "REQ-BO-003a: platform_operator on a requirePlatformAdmin route → 403 'Platform admin access required'",
    async () => {
      // GET /audit-log sits behind requireBackofficeAccess + requirePlatformAdmin.
      loginAsBackoffice({
        userId: PLATFORM_OPERATOR_USER,
        role: "platform_operator",
      });

      const res = await backofficeRouter.request("/audit-log");

      expect(res.status).toBe(403);
      const body: unknown = await res.json();
      // The backoffice router's onError serializes HTTPException as { error: message }
      expect(body).toMatchObject({ error: "Platform admin access required" });
    },
  );

  it(
    "REQ-BO-003b: platform_admin on the same requirePlatformAdmin route → NOT 403 (passes the gate)",
    async () => {
      loginAsBackoffice({
        userId: PLATFORM_ADMIN_USER,
        role: "platform_admin",
      });

      // GET /audit-log with no rows in the DB returns 200 with an empty list —
      // this is the canonical "gate open" proof.
      const res = await backofficeRouter.request("/audit-log");

      // Must not be 401 or 403 — the platform-admin gate was cleared.
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
      expect(res.status).toBe(200);

      const body: unknown = await res.json();
      // Shape: { data: [...], hasMore: boolean }
      expect(body).toHaveProperty("data");
      expect(Array.isArray(envelopeData(body))).toBe(true);
    },
  );

  // =========================================================================
  // REQ-BO-004: Cross-org view — both seeded LAB orgs appear for platform_admin
  // =========================================================================
  it(
    "REQ-BO-004: GET /organizations as platform_admin returns ALL seeded LAB organizations (cross-tenant by design)",
    async () => {
      const { orgAId, orgBId } = await seedTwoLabOrgs();

      loginAsBackoffice({
        userId: PLATFORM_ADMIN_USER,
        role: "platform_admin",
      });

      const res = await backofficeRouter.request("/organizations");

      expect(res.status).toBe(200);
      const body: unknown = await res.json();
      // Shape: { data: Array<{ id, name, slug, ... }> }
      expect(Array.isArray(envelopeData(body))).toBe(true);

      const ids = envelopeIds(body);
      // Both orgs are visible — no tenant scope applied.
      expect(ids).toContain(orgAId);
      expect(ids).toContain(orgBId);

      // Sanity: the names match what was seeded.
      const names = envelopeNames(body);
      expect(names).toContain("Lab Alpha");
      expect(names).toContain("Lab Beta");
    },
  );

  // =========================================================================
  // REQ-BO-006: A MOVED admin-gated org route keeps its inline
  // requirePlatformAdmin guard after extraction into backofficeOrganizationsRouter.
  // POST /organizations/:id/lifecycle was relocated into the sub-router carrying
  // its own `requirePlatformAdmin`; this pins that the per-route guard survived
  // the structural move (operator refused, admin admitted).
  // =========================================================================
  it(
    "REQ-BO-006a: platform_operator on the moved POST /organizations/:id/lifecycle → 403 'Platform admin access required'",
    async () => {
      const { orgAId } = await seedTwoLabOrgs();

      loginAsBackoffice({
        userId: PLATFORM_OPERATOR_USER,
        role: "platform_operator",
      });

      const res = await backofficeRouter.request(
        `/organizations/${orgAId}/lifecycle`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "suspend", reason: "test" }),
        },
      );

      expect(res.status).toBe(403);
      const body: unknown = await res.json();
      // Parent router's onError serializes the sub-router's HTTPException
      // identically: { error: message }.
      expect(body).toMatchObject({ error: "Platform admin access required" });
    },
  );

  it(
    "REQ-BO-006b: platform_admin on the moved POST /organizations/:id/lifecycle → NOT 403 (passes the admin gate)",
    async () => {
      const { orgAId } = await seedTwoLabOrgs();

      loginAsBackoffice({
        userId: PLATFORM_ADMIN_USER,
        role: "platform_admin",
      });

      const res = await backofficeRouter.request(
        `/organizations/${orgAId}/lifecycle`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "suspend", reason: "test" }),
        },
      );

      // The platform-admin gate is the property under test: a platform_admin must
      // clear BOTH the inherited backoffice-access gate and the moved route's own
      // inline requirePlatformAdmin guard. "Gate open" === the request reaches the
      // handler, i.e. it is neither 401 (auth) nor 403 (a gate refusal). We do not
      // assert the full write succeeds — that would couple this guard-preservation
      // test to unrelated seed completeness (contrast: the operator case above is
      // refused at the gate with a 403 before the handler runs at all).
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    },
  );

  // =========================================================================
  // REQ-BO-007: A MOVED admin-gated USER route keeps its PATH-SCOPED
  // requirePlatformAdmin guard after extraction into backofficeUsersRouter.
  //
  // Unlike /organizations (inline per-route guards), the /users mutating POSTs
  // are gated by PATH-SCOPED `.use("/users/:id/ban", requirePlatformAdmin)` (and
  // siblings) registered just before the handlers. The extraction rebases those
  // to `.use("/:id/ban", …)` inside the sub-router mounted at /users. This pins
  // that the path-scoped admin gate survived the structural move:
  //   - platform_operator → 403 "Platform admin access required"
  //   - platform_admin    → NOT 401/403 (clears the gate; reaches the handler)
  //
  // Mutation-check: deleting the path-scoped `.use("/:id/ban", …)` from the
  // sub-router makes the operator-403 case go RED (operator would no longer be
  // refused), proving the guard — not the handler — is under test.
  // =========================================================================
  it(
    "REQ-BO-007a: platform_operator on the moved POST /users/:id/ban → 403 'Platform admin access required'",
    async () => {
      loginAsBackoffice({
        userId: PLATFORM_OPERATOR_USER,
        role: "platform_operator",
      });

      const res = await backofficeRouter.request("/users/some-user-id/ban", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ banReason: "test" }),
      });

      expect(res.status).toBe(403);
      const body: unknown = await res.json();
      // Parent router's onError serializes the sub-router's HTTPException
      // identically: { error: message }.
      expect(body).toMatchObject({ error: "Platform admin access required" });
    },
  );

  it(
    "REQ-BO-007b: platform_admin on the moved POST /users/:id/ban → NOT 401/403 (passes the path-scoped admin gate)",
    async () => {
      loginAsBackoffice({
        userId: PLATFORM_ADMIN_USER,
        role: "platform_admin",
      });

      const res = await backofficeRouter.request("/users/some-user-id/ban", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ banReason: "test" }),
      });

      // The path-scoped platform-admin gate is the property under test: a
      // platform_admin must clear BOTH the inherited backoffice-access gate and
      // the moved route's path-scoped requirePlatformAdmin guard. "Gate open" ===
      // the request reaches the handler, i.e. neither 401 (auth) nor 403 (a gate
      // refusal). We do not assert the ban succeeds — banUser delegates to the
      // backoffice Better-Auth instance which the harness mocks only for
      // getSession, so the handler may 4xx/5xx on a missing user; that is
      // downstream of (and irrelevant to) the guard we are pinning (contrast: the
      // operator case is refused at the gate with a 403 before the handler runs).
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    },
  );

  // =========================================================================
  // REQ-BO-005: Operator is allowed on requireBackofficeAccess-only routes
  // =========================================================================
  it(
    "REQ-BO-005: platform_operator on a requireBackofficeAccess-only route (GET /vitals) → 200",
    async () => {
      // GET /vitals is behind requireBackofficeAccess only — no requirePlatformAdmin.
      // A platform_operator must be admitted (contrast with REQ-BO-002 where
      // role="user" is refused, proving the distinction user < operator < admin).
      loginAsBackoffice({
        userId: PLATFORM_OPERATOR_USER,
        role: "platform_operator",
      });

      const res = await backofficeRouter.request("/vitals");

      expect(res.status).toBe(200);
      const body: unknown = await res.json();
      // Shape sanity: /vitals returns { subscriptions: {...}, queue: {...} }
      expect(body).toHaveProperty("subscriptions");
      expect(body).toHaveProperty("queue");
    },
  );
});
