import { beforeEach, describe, expect, it } from "vitest";
import { internalCustomerSuccessRouter } from "./internal-customer-success";
import { db } from "@calibra-facil/db";
import { organization } from "@calibra-facil/db/schema";
import {
  loginAsBackoffice,
  logoutBackoffice,
} from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";

// Real-DB + real-RBAC integration tests for the INTERNAL CUSTOMER-SUCCESS router.
//
// Auth model: this is a BACKOFFICE router (platform operators / admins), NOT a
// lab router. Its guards are mounted on the router itself:
//
//   internal-customer-success.ts:469
//     .use("*", requireBackofficeAuthSession, requireBackofficeAccess)
//
//   requireBackofficeAuthSession  -> 401 when no backoffice session
//   requireBackofficeAccess       -> 403 "Backoffice access required" for role "user"
//
// IMPORTANT — gate inventory for THIS router (verified by reading the source):
//   * EVERY route is behind requireBackofficeAccess ONLY.
//   * There is NO requirePlatformAdmin anywhere in internal-customer-success.ts
//     (grep: 0 matches). So a "platform_operator" is ADMITTED on every route,
//     and the operator<admin distinction is NOT exercised here — the access-only
//     gate (user < operator) is.
//
// Cut-line invariant under test: the PLATFORM-ROLE gate (user vs. backoffice
// roles), NOT tenant isolation. Backoffice is INTENTIONALLY cross-org, so
// REQ-ICS-004 asserts the opposite of a lab router: both seeded orgs appear.
//
// The harness mocks ONLY createBackofficeAuth().api.getSession (see
// test/integration/setup.ts); requireBackofficeAuthSession / requireBackofficeAccess
// and every DB query run for real against the seeded Postgres.
//
// Proven properties:
//   REQ-ICS-001  Unauthenticated                                  -> 401
//   REQ-ICS-002  Authenticated, role "user" (no backoffice access) -> 403 "Backoffice access required"
//   REQ-ICS-003  Access-only router: role "platform_operator"      -> 2xx (admitted; NOT 403)
//                 and role "platform_admin" -> 2xx (admitted). No requirePlatformAdmin route exists.
//   REQ-ICS-004  Cross-org view: GET /organizations returns BOTH seeded LAB orgs (cross-tenant by design)
//   happy-path   GET /access returns { allowed: true }; GET /organizations returns { data: [...] }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PLATFORM_ADMIN_USER = "ics-platform-admin-user";
const PLATFORM_OPERATOR_USER = "ics-platform-operator-user";
const PLATFORM_PLAIN_USER = "ics-platform-plain-user";

/**
 * Seed two minimal LAB organizations. The /organizations list filters on
 * type = "LAB" with NO org-scope, so two LAB orgs are enough to prove the
 * cross-tenant-by-design property.
 */
async function seedTwoLabOrgs(): Promise<{ orgAId: string; orgBId: string }> {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const orgAId = "ics-org-alpha";
  const orgBId = "ics-org-beta";

  await db.insert(organization).values([
    {
      id: orgAId,
      name: "Lab Alpha CS",
      slug: orgAId,
      createdAt: now,
      type: "LAB",
      status: "ACTIVE",
    },
    {
      id: orgBId,
      name: "Lab Beta CS",
      slug: orgBId,
      createdAt: now,
      type: "LAB",
      status: "ACTIVE",
    },
  ]);

  return { orgAId, orgBId };
}

/**
 * Read the error message regardless of how the framework serialized the
 * HTTPException. This router has NO custom onError, so a thrown HTTPException
 * surfaces via Hono's default getResponse() (the message in the response body).
 * We read the raw text and also try to pick out a JSON { error } shape — either
 * way the message must appear. No `as` assertion (banned by oxlint).
 */
async function errorMessage(res: Response): Promise<string> {
  const text = await res.clone().text();
  try {
    const parsed: unknown = JSON.parse(text);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "error" in parsed &&
      typeof parsed.error === "string"
    ) {
      return parsed.error;
    }
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "message" in parsed &&
      typeof parsed.message === "string"
    ) {
      return parsed.message;
    }
  } catch {
    // not JSON — fall through to the raw text body
  }
  return text;
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

describe("internalCustomerSuccessRouter — real DB + real backoffice guards", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // =========================================================================
  // REQ-ICS-001: Unauthenticated -> 401
  // =========================================================================
  it("REQ-ICS-001: unauthenticated request to GET /organizations -> 401", async () => {
    // No backoffice session: requireBackofficeAuthSession throws 401.
    logoutBackoffice();

    const res = await internalCustomerSuccessRouter.request("/organizations");

    expect(res.status).toBe(401);
    // Regression guard: removing requireBackofficeAuthSession from the .use("*")
    // chain would let the request reach the handler (200) — this assertion fails.
  });

  it("REQ-ICS-001: unauthenticated request to GET /access -> 401", async () => {
    logoutBackoffice();

    const res = await internalCustomerSuccessRouter.request("/access");

    expect(res.status).toBe(401);
  });

  // =========================================================================
  // REQ-ICS-002 [HIGH RISK]: role "user" (no backoffice access) -> 403
  // =========================================================================
  it("REQ-ICS-002: platform user with role 'user' (no backoffice access) -> 403 'Backoffice access required'", async () => {
    // role "user" is the default platform role — canAccessBackoffice() is false,
    // so requireBackofficeAccess throws 403 "Backoffice access required".
    loginAsBackoffice({ userId: PLATFORM_PLAIN_USER, role: "user" });

    const res = await internalCustomerSuccessRouter.request("/organizations");

    expect(res.status).toBe(403);
    expect(await errorMessage(res)).toBe("Backoffice access required");
    // Regression guard: relaxing/removing requireBackofficeAccess would admit
    // role "user" (200) — both the status and message assertions fail.
  });

  it("REQ-ICS-002: role 'user' is also refused on GET /access -> 403", async () => {
    loginAsBackoffice({ userId: PLATFORM_PLAIN_USER, role: "user" });

    const res = await internalCustomerSuccessRouter.request("/access");

    expect(res.status).toBe(403);
    expect(await errorMessage(res)).toBe("Backoffice access required");
  });

  // =========================================================================
  // REQ-ICS-003 [HIGH RISK]: access-only router — operator AND admin admitted.
  // No route here is requirePlatformAdmin-gated, so there is NO operator<admin
  // refusal to assert; instead we prove operator is ADMITTED (the access gate
  // is user < operator), which is the gate this router actually enforces.
  // =========================================================================
  it("REQ-ICS-003a: platform_operator on access-only GET /access -> 200 (admitted)", async () => {
    loginAsBackoffice({
      userId: PLATFORM_OPERATOR_USER,
      role: "platform_operator",
    });

    const res = await internalCustomerSuccessRouter.request("/access");

    // Admitted: not 401 (session present) and not 403 (operator has backoffice access).
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ allowed: true });
  });

  it("REQ-ICS-003b: platform_admin on access-only GET /access -> 200 (admitted)", async () => {
    loginAsBackoffice({
      userId: PLATFORM_ADMIN_USER,
      role: "platform_admin",
    });

    const res = await internalCustomerSuccessRouter.request("/access");

    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ allowed: true });
  });

  it("REQ-ICS-003c: platform_operator is admitted on GET /organizations too (no requirePlatformAdmin) -> 200", async () => {
    // Contrast with REQ-ICS-002 (role "user" -> 403): an operator clears the
    // access gate on the same route, proving the distinction user < operator.
    await seedTwoLabOrgs();
    loginAsBackoffice({
      userId: PLATFORM_OPERATOR_USER,
      role: "platform_operator",
    });

    const res = await internalCustomerSuccessRouter.request("/organizations");

    expect(res.status).toBe(200);
  });

  // =========================================================================
  // REQ-ICS-004: Cross-org view — both seeded LAB orgs appear (cross-tenant by design)
  // =========================================================================
  it("REQ-ICS-004: GET /organizations returns ALL seeded LAB organizations (cross-tenant by design)", async () => {
    const { orgAId, orgBId } = await seedTwoLabOrgs();

    // A backoffice operator (admitted) sees every LAB org — NO org-scoping is
    // applied. This is the opposite of a lab router and is intentional.
    loginAsBackoffice({
      userId: PLATFORM_OPERATOR_USER,
      role: "platform_operator",
    });

    const res = await internalCustomerSuccessRouter.request("/organizations");

    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    expect(Array.isArray(envelopeData(body))).toBe(true);

    const ids = envelopeIds(body);
    // Both orgs visible — no tenant scope. Two distinct orgs proves cross-tenant.
    expect(ids).toContain(orgAId);
    expect(ids).toContain(orgBId);

    const names = envelopeNames(body);
    expect(names).toContain("Lab Alpha CS");
    expect(names).toContain("Lab Beta CS");
  });

  // =========================================================================
  // happy-path: representative read returns the expected shape
  // =========================================================================
  it("happy-path: GET /organizations as platform_admin returns a { data: [...] } envelope with org fields", async () => {
    const { orgAId } = await seedTwoLabOrgs();

    loginAsBackoffice({
      userId: PLATFORM_ADMIN_USER,
      role: "platform_admin",
    });

    const res = await internalCustomerSuccessRouter.request("/organizations");

    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    const rows = envelopeData(body);
    expect(rows.length).toBeGreaterThanOrEqual(2);

    // Representative row carries the expected backoffice shape: id, name, slug,
    // a plan summary, and a derived profile/operationalSummary.
    const alpha = rows.find(
      (row) =>
        typeof row === "object" &&
        row !== null &&
        "id" in row &&
        row.id === orgAId,
    );
    expect(alpha).toBeDefined();
    expect(alpha).toMatchObject({
      id: orgAId,
      name: "Lab Alpha CS",
      slug: orgAId,
      type: "LAB",
    });
    expect(alpha).toHaveProperty("plan");
    expect(alpha).toHaveProperty("profile");
    expect(alpha).toHaveProperty("operationalSummary");
  });
});
