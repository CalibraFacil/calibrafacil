import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { portalDomainsRouter } from "./portal-domains";
import { db } from "@calibra-facil/db";
import {
  organizationCustomDomain,
  subscription,
} from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";
import { loginAs, logout } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";

// Real-DB + real-RBAC integration tests for portalDomainsRouter.
//
// Despite the "portal" name this is a LAB router: a lab admin manages its OWN
// portal's custom domain. Only the better-auth lab session is mocked
// (test/integration/setup.ts). The full guard chain runs for real against the
// seeded Postgres:
//
//   GET  /         requireLabProtected + requireOrgType("LAB")
//                  (= requireLabAuth + requireOrganization + requireOrgType)
//   POST /         withLabPermission({ organization: ["update"] })
//                  + requireRole(["admin","owner"]) + requireFeature("custom_domain")
//   POST /verify   same as POST /
//   DELETE /       withLabPermission({ organization: ["update"] })
//                  + requireRole(["admin","owner"])   (NO requireFeature)
//
// The data model is ONE custom domain per org: organization_custom_domain has a
// unique index on organization_id (org_custom_domain_org_uidx) and the route
// resolves every record through getOrganizationCustomDomain(member.organizationId),
// whose WHERE is eq(organizationCustomDomain.organizationId, organizationId).
// That single org-scope filter is therefore the sole tenant-isolation discriminator
// for BOTH read and mutate paths (there is no per-id route param to address another
// org's row directly).
//
// Covered:
//   REQ-PD-001 [HIGH RISK]  GET / read isolation — org A sees only its own domain
//   REQ-PD-002 [HIGH RISK]  manage gate — member -> 403; admin -> success + persisted
//   REQ-PD-003 [HIGH RISK]  cross-tenant mutate — org A's DELETE never touches org B's row
//   REQ-PD-004              GET / unauthenticated -> 401
//   PD happy-path           add (POST) -> list (GET) round-trip persists
//
// Network note: GET / calls fetchTxtAnswers() (live Cloudflare DNS) only when a
// record exists. We stub globalThis.fetch to keep the read tests hermetic and
// deterministic — no production code path is altered, only the outbound DNS call.

const JSON_HEADERS = { "content-type": "application/json" };

/**
 * Seed an organization_custom_domain row directly for an org. Returns the id.
 * NOT modifying the shared seed.ts. hostname is globally unique, so callers pass
 * distinct hostnames per org.
 */
async function seedDomain(params: {
  organizationId: string;
  createdBy: string;
  hostname: string;
}): Promise<string> {
  const id = `dom-${params.organizationId}`;
  await db.insert(organizationCustomDomain).values({
    id,
    organizationId: params.organizationId,
    hostname: params.hostname,
    verificationToken: `tok-${params.organizationId}`,
    createdBy: params.createdBy,
  });
  return id;
}

/**
 * Seed an ACTIVE PROFESSIONAL subscription so requireFeature("custom_domain")
 * passes. PROFESSIONAL includes custom_domain; FREE (no subscription) does not.
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

describe("portalDomainsRouter — real DB + real middleware (LAB router)", () => {
  beforeEach(async () => {
    await truncateAll();
    // No TXT record is ever published for the test hostnames; the route would
    // otherwise hit live Cloudflare DNS. Stub to an empty Answer set.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ Answer: [] }))),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // REQ-PD-001 [HIGH RISK]: read isolation. Two orgs each own a domain. Org A's
  // GET must return ONLY org A's domain; org B's hostname is the sole-discriminator
  // leak row and must be ABSENT. The contested filter is the org-scope WHERE in
  // getOrganizationCustomDomain — flipping it (eq -> ne) makes org A's GET return
  // org B's hostname, turning this RED (mutation-proven).
  it("REQ-PD-001: GET / returns only the authenticated org's domain (tenant read isolation)", async () => {
    const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
    const orgB = await seedOrg({ orgId: "org-b", role: "admin" });

    await seedDomain({
      organizationId: orgA.orgId,
      createdBy: orgA.userId,
      hostname: "portal.lab-a.example.com",
    });
    // Leak row: org B's domain. If the org-scope filter is dropped this is what
    // would surface for org A.
    await seedDomain({
      organizationId: orgB.orgId,
      createdBy: orgB.userId,
      hostname: "portal.lab-b.example.com",
    });

    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    const res = await portalDomainsRouter.request("/", {
      headers: JSON_HEADERS,
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    // Org A sees its OWN domain...
    expect(body.domain).not.toBeNull();
    expect(body.domain.hostname).toBe("portal.lab-a.example.com");
    // ...and org B's domain is never exposed across the tenant boundary.
    expect(JSON.stringify(body)).not.toContain("portal.lab-b.example.com");
  });

  // REQ-PD-002 [HIGH RISK]: manage gate.
  // Part A: a role=member is denied add/verify/delete. The mutating routes run
  //   requirePermission({ organization: ["update"] }) (inside withLabPermission)
  //   BEFORE requireRole(["admin","owner"]). member has NO organization:update
  //   permission, so the PERMISSION gate fires first -> 403. (Verified: only
  //   owner/admin authorize organization:update; technician/operator/member do not.)
  //   This is mutation-distinguished below: widening requireRole to include
  //   "member" still yields 403, proving the permission gate is load-bearing.
  // Part B: an admin with the custom_domain entitlement succeeds and the row is
  //   DB-persisted under the org scope.
  it("REQ-PD-002: member is denied add/verify/delete (403); admin succeeds + persists", async () => {
    // --- member is blocked on every mutating route ---
    const memberOrg = await seedOrg({ orgId: "org-m", role: "member" });
    // Entitlement present so the block is RBAC, not the feature gate.
    await seedProfessionalSubscription(memberOrg.orgId);
    loginAs({ userId: memberOrg.userId, organizationId: memberOrg.orgId });

    const addAsMember = await portalDomainsRouter.request("/", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ hostname: "blocked.example.com" }),
    });
    expect(addAsMember.status).toBe(403);

    const verifyAsMember = await portalDomainsRouter.request("/verify", {
      method: "POST",
      headers: JSON_HEADERS,
    });
    expect(verifyAsMember.status).toBe(403);

    const deleteAsMember = await portalDomainsRouter.request("/", {
      method: "DELETE",
      headers: JSON_HEADERS,
    });
    expect(deleteAsMember.status).toBe(403);

    // member must not have created anything.
    const afterMember = await db
      .select()
      .from(organizationCustomDomain)
      .where(eq(organizationCustomDomain.organizationId, memberOrg.orgId));
    expect(afterMember).toHaveLength(0);

    // --- admin with custom_domain entitlement succeeds + persists ---
    const adminOrg = await seedOrg({ orgId: "org-admin", role: "admin" });
    await seedProfessionalSubscription(adminOrg.orgId);
    loginAs({ userId: adminOrg.userId, organizationId: adminOrg.orgId });

    const addAsAdmin = await portalDomainsRouter.request("/", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ hostname: "portal.lab-admin.example.com" }),
    });
    expect(addAsAdmin.status).toBe(201);
    const created = await addAsAdmin.json();
    expect(created.domain.hostname).toBe("portal.lab-admin.example.com");

    const rows = await db
      .select()
      .from(organizationCustomDomain)
      .where(eq(organizationCustomDomain.organizationId, adminOrg.orgId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.hostname).toBe("portal.lab-admin.example.com");
    expect(rows[0]?.organizationId).toBe(adminOrg.orgId);
  });

  // REQ-PD-003 [HIGH RISK]: cross-tenant mutate. The mutating routes have NO
  // per-id param — they always resolve getOrganizationCustomDomain(member.org).
  // Org A (which owns NO domain) issuing DELETE must NOT delete org B's domain:
  // org A's scoped lookup returns null, so DELETE is a no-op and org B's row
  // survives. Flipping the org-scope filter (eq -> ne) would make org A's DELETE
  // resolve and destroy org B's row -> RED (mutation-proven the scope filter
  // gates cross-tenant writes).
  it("REQ-PD-003: org A's DELETE never reaches another org's domain (no cross-tenant write)", async () => {
    const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
    const orgB = await seedOrg({ orgId: "org-b", role: "admin" });

    // Only org B has a domain. Org A is an admin but owns nothing.
    const bDomainId = await seedDomain({
      organizationId: orgB.orgId,
      createdBy: orgB.userId,
      hostname: "portal.lab-b.example.com",
    });

    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    const res = await portalDomainsRouter.request("/", {
      method: "DELETE",
      headers: JSON_HEADERS,
    });

    // Handler resolves org A's (absent) record -> no-op success, no delete.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    // The critical property: org B's domain row STILL EXISTS — org A could not
    // touch it across the tenant boundary.
    const bRows = await db
      .select()
      .from(organizationCustomDomain)
      .where(eq(organizationCustomDomain.id, bDomainId));
    expect(bRows).toHaveLength(1);
    expect(bRows[0]?.hostname).toBe("portal.lab-b.example.com");
  });

  // REQ-PD-004: unauthenticated -> 401 (requireLabAuth fires first).
  it("REQ-PD-004: GET / unauthenticated -> 401", async () => {
    logout();
    const res = await portalDomainsRouter.request("/", {
      headers: JSON_HEADERS,
    });
    expect(res.status).toBe(401);
  });

  // Happy path: add (POST) then list (GET) round-trips and persists for the same
  // admin/org. Proves the create -> read flow end to end through the real guards.
  it("PD happy-path: admin POST then GET returns the persisted domain (round-trip)", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "admin" });
    await seedProfessionalSubscription(org.orgId);
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const add = await portalDomainsRouter.request("/", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ hostname: "portal.roundtrip.example.com" }),
    });
    expect(add.status).toBe(201);

    const list = await portalDomainsRouter.request("/", {
      headers: JSON_HEADERS,
    });
    expect(list.status).toBe(200);
    const body = await list.json();
    expect(body.domain).not.toBeNull();
    expect(body.domain.hostname).toBe("portal.roundtrip.example.com");
  });
});
