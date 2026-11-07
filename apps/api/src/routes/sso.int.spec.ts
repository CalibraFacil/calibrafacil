import { beforeEach, describe, expect, it } from "vitest";
import { ssoRouter } from "./sso";
import { db } from "@calibra-facil/db";
import { ssoProvider } from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";
import { loginAs, logout } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";

// Real-DB + real-RBAC integration tests for the ssoRouter (SAML/OIDC SSO).
// Only the better-auth lab session is mocked (see test/integration/setup.ts):
//   createLabAuth() => ({ api: { getSession } })
// requireLabAuth -> requireOrganization -> requireOrgType("LAB") ->
// requirePermission({ organization: ["update"] }) -> requireRole(...) and the
// org-scoped DB lookups all run for real against the seeded Postgres.
//
// REACHABILITY SPLIT (see the report for the full inventory):
//
//   CONFIG MANAGEMENT (org-scoped + RBAC-gated) — the real tenant/RBAC boundary.
//     - GET    /providers                                  FULLY reachable
//       (no Better-Auth call; reads the org's own provider straight from the DB)
//     - POST   /providers                                  guards + 409 reachable
//     - POST   /providers/:id/request-domain-verification  guards + tenant 404 reachable
//     - POST   /providers/:id/verify-domain                guards + tenant 404 reachable
//     - DELETE /providers/:id                              guards + tenant 404 reachable
//     For the mutating routes the actual Better-Auth call (registerSSOProvider,
//     requestDomainVerification, verifyDomain, deleteSSOProvider) is the FIRST
//     mocked-away surface — see the per-test notes. Everything BEFORE it (the
//     RBAC chain and the org-scoped lookups) runs for real and
//     is what we assert.
//
//   HANDSHAKE — POST /start (the SSO sign-in / IdP redirect). FLAGGED unreachable:
//     it ends in auth.api.signInSSO (Better-Auth -> the org's IdP), which the
//     getSession-only mock removes; a real assertion would need a live/mock IdP
//     and a signed OIDC assertion. We DO cover every DB-observable early reject
//     that fires BEFORE signInSSO (unknown org 404, no-provider 404,
//     domain-unverified 403) — see REQ-SSO-004 — and flag the
//     redirect itself.

const JSON_HEADERS = { "content-type": "application/json" };

// ---------------------------------------------------------------------------
// Inline seed helpers (NOT modifying shared seed.ts per the harness convention)
// ---------------------------------------------------------------------------

/**
 * Seed an sso_provider row scoped to an org. The route cannot create one (the
 * Better-Auth registerSSOProvider call is mocked away), so isolation tests seed
 * the row directly. Returns the providerId.
 */
async function seedProvider(params: {
  organizationId: string;
  userId: string;
  providerId: string;
  issuer?: string;
  domainVerified?: boolean;
}): Promise<string> {
  await db.insert(ssoProvider).values({
    id: `ssop-${params.providerId}`,
    issuer: params.issuer ?? `https://idp.${params.providerId}.example.com`,
    oidcConfig: JSON.stringify({
      clientId: "client-1234567890",
      pkce: true,
      scopes: ["openid", "email", "profile"],
    }),
    userId: params.userId,
    providerId: params.providerId,
    organizationId: params.organizationId,
    domain: `https://${params.providerId}.example.com`,
    domainVerified: params.domainVerified ?? false,
  });
  return params.providerId;
}

const VALID_CREATE_BODY = {
  providerId: "acme-oidc",
  issuer: "https://login.acme.example.com",
  domain: "acme.example.com",
  clientId: "client-id-123",
  clientSecret: "client-secret-456",
};

describe("ssoRouter — real DB + real middleware", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // ===========================================================================
  // REQ-SSO-001 [HIGH RISK]: tenant isolation on the config READ
  // ===========================================================================
  // GET /providers returns ONLY the authed org's provider. Seed org B's provider
  // as the SOLE discriminator (org A has none) and assert it is absent.
  // Guard: withLabPermission({ organization: ["update"] }) + requireRole(["admin","owner"]).
  // Org filter under test: getOrganizationProvider(member.organizationId)
  //   -> where eq(ssoProvider.organizationId, ...).
  it("REQ-SSO-001: GET /providers returns ONLY the authed org's provider (org B's config does not leak)", async () => {
    const orgA = await seedOrg({ orgId: "org-a", role: "owner" });
    const orgB = await seedOrg({ orgId: "org-b", role: "owner" });

    // Org B is the SOLE owner of an SSO provider. Org A has none.
    await seedProvider({
      organizationId: orgB.orgId,
      userId: orgB.userId,
      providerId: "orgb-secret-idp",
      issuer: "https://idp.orgb-secret.example.com",
      domainVerified: true,
    });

    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    const res = await ssoRouter.request("/providers", {
      headers: JSON_HEADERS,
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    // Org A must see NO provider — org B's is the only one in the DB.
    expect(body.provider).toBeNull();
    // The leak discriminator must not appear anywhere in the serialized body.
    expect(JSON.stringify(body)).not.toContain("orgb-secret");
  });

  // Positive companion: org A reading its OWN provider sees it, org-scoped.
  // This is the discriminator that makes REQ-SSO-001 non-trivial: drop the org
  // filter and THIS test still passes but REQ-SSO-001 goes RED (leak).
  it("REQ-SSO-001: GET /providers surfaces the authed org's OWN provider, org-scoped", async () => {
    const orgA = await seedOrg({ orgId: "org-a", role: "owner" });
    const orgB = await seedOrg({ orgId: "org-b", role: "owner" });

    await seedProvider({
      organizationId: orgA.orgId,
      userId: orgA.userId,
      providerId: "orga-idp",
      issuer: "https://idp.orga.example.com",
      domainVerified: true,
    });
    // Noise: org B also has a provider, must not bleed into org A's read.
    await seedProvider({
      organizationId: orgB.orgId,
      userId: orgB.userId,
      providerId: "orgb-idp",
    });

    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    const res = await ssoRouter.request("/providers", {
      headers: JSON_HEADERS,
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.provider).not.toBeNull();
    expect(body.provider.providerId).toBe("orga-idp");
    expect(body.provider.organizationId).toBe(orgA.orgId);
    // org B's provider must NOT be what org A sees.
    expect(body.provider.providerId).not.toBe("orgb-idp");
  });

  // ===========================================================================
  // REQ-SSO-002 [HIGH RISK]: the manage gate (permission vs role)
  // ===========================================================================
  // Two-layer gate on the config routes:
  //   withLabPermission({ organization: ["update"] })  -> member lacks it
  //   requireRole([...])                                -> admin lacks "owner"
  // member -> 403 (permission). admin -> 403 on POST (role narrower than read).
  // owner  -> passes both gates (and reaches the mocked Better-Auth surface).
  it("REQ-SSO-002: GET /providers as role=member -> 403 (organization:update permission denied)", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "member" });

    loginAs({ userId: org.userId, organizationId: org.orgId });
    const res = await ssoRouter.request("/providers", {
      headers: JSON_HEADERS,
    });

    expect(res.status).toBe(403);
  });

  it("REQ-SSO-002: GET /providers as role=admin -> 200 (admin has organization:update + is in requireRole list)", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "admin" });

    loginAs({ userId: org.userId, organizationId: org.orgId });
    const res = await ssoRouter.request("/providers", {
      headers: JSON_HEADERS,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    // admin is NOT owner -> the route reports it cannot manage the provider.
    expect(body.access.role).toBe("admin");
    expect(body.access.canManage).toBe(false);
  });

  it("REQ-SSO-002: POST /providers as role=member -> 403 (organization:update permission denied)", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "member" });

    loginAs({ userId: org.userId, organizationId: org.orgId });
    const res = await ssoRouter.request("/providers", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(VALID_CREATE_BODY),
    });

    expect(res.status).toBe(403);
    // The gate fires BEFORE any provider row could be written.
    const rows = await db
      .select({ id: ssoProvider.id })
      .from(ssoProvider)
      .where(eq(ssoProvider.organizationId, org.orgId));
    expect(rows).toHaveLength(0);
  });

  it("REQ-SSO-002: POST /providers as role=admin -> 403 (requireRole(['owner']) is narrower than the read gate)", async () => {
    // admin HAS organization:update (so it would pass the GET gate) but the
    // mutating routes require role=owner. This is the exact discriminator that
    // separates the permission layer from the role layer.
    const org = await seedOrg({ orgId: "org-a", role: "admin" });

    loginAs({ userId: org.userId, organizationId: org.orgId });
    const res = await ssoRouter.request("/providers", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(VALID_CREATE_BODY),
    });

    expect(res.status).toBe(403);
    const rows = await db
      .select({ id: ssoProvider.id })
      .from(ssoProvider)
      .where(eq(ssoProvider.organizationId, org.orgId));
    expect(rows).toHaveLength(0);
  });

  it("REQ-SSO-002: DELETE /providers/:id as role=member -> 403 (organization:update permission denied)", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "member" });
    const providerId = await seedProvider({
      organizationId: org.orgId,
      userId: org.userId,
      providerId: "deletable-idp",
    });

    loginAs({ userId: org.userId, organizationId: org.orgId });
    const res = await ssoRouter.request(`/providers/${providerId}`, {
      method: "DELETE",
      headers: JSON_HEADERS,
    });

    expect(res.status).toBe(403);
    // The provider row is untouched (gate fired before the delete logic).
    const rows = await db
      .select({ id: ssoProvider.id })
      .from(ssoProvider)
      .where(eq(ssoProvider.providerId, providerId));
    expect(rows).toHaveLength(1);
  });

  // ===========================================================================
  // REQ-SSO-003: unauthenticated -> 401
  // ===========================================================================
  it("REQ-SSO-003: GET /providers unauthenticated -> 401", async () => {
    logout();
    const res = await ssoRouter.request("/providers", {
      headers: JSON_HEADERS,
    });
    expect(res.status).toBe(401);
  });

  it("REQ-SSO-003: POST /providers unauthenticated -> 401", async () => {
    logout();
    const res = await ssoRouter.request("/providers", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(VALID_CREATE_BODY),
    });
    expect(res.status).toBe(401);
  });

  it("REQ-SSO-003: DELETE /providers/:id unauthenticated -> 401", async () => {
    logout();
    const res = await ssoRouter.request("/providers/some-idp", {
      method: "DELETE",
      headers: JSON_HEADERS,
    });
    expect(res.status).toBe(401);
  });

  // ===========================================================================
  // Cross-tenant write isolation on the mutating config routes (404 by scope)
  // ===========================================================================
  // These routes look up the target provider scoped to member.organizationId:
  //   where and(eq(organizationId, member.org), eq(providerId, :id)).
  // A foreign org's provider is therefore NOT FOUND -> 404, BEFORE any
  // Better-Auth call. The owner gate is satisfied so the 404 proves the org
  // scope (not the role gate) is what blocks the cross-tenant write.
  it("REQ-SSO-001: DELETE /providers/:id of another org's provider -> 404 (no cross-tenant delete)", async () => {
    const orgA = await seedOrg({ orgId: "org-a", role: "owner" });
    const orgB = await seedOrg({ orgId: "org-b", role: "owner" });

    const bProviderId = await seedProvider({
      organizationId: orgB.orgId,
      userId: orgB.userId,
      providerId: "orgb-target-idp",
    });

    // org A owner tries to delete org B's provider by id.
    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    const res = await ssoRouter.request(`/providers/${bProviderId}`, {
      method: "DELETE",
      headers: JSON_HEADERS,
    });

    expect(res.status).toBe(404);
    // org B's provider must still exist (not deleted cross-tenant).
    const rows = await db
      .select({ id: ssoProvider.id })
      .from(ssoProvider)
      .where(eq(ssoProvider.providerId, bProviderId));
    expect(rows).toHaveLength(1);
  });

  it("REQ-SSO-001: POST /providers/:id/verify-domain of another org's provider -> 404 (no cross-tenant domain verify)", async () => {
    const orgA = await seedOrg({ orgId: "org-a", role: "owner" });
    const orgB = await seedOrg({ orgId: "org-b", role: "owner" });

    const bProviderId = await seedProvider({
      organizationId: orgB.orgId,
      userId: orgB.userId,
      providerId: "orgb-verify-idp",
    });

    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    const res = await ssoRouter.request(
      `/providers/${bProviderId}/verify-domain`,
      { method: "POST", headers: JSON_HEADERS },
    );

    // Scoped lookup misses -> 404 before reaching auth.api.verifyDomain.
    expect(res.status).toBe(404);
  });

  // POST /providers as owner, when a provider already
  // exists for the org -> 409. This reaches the org-scoped existing-provider
  // guard (getOrganizationProvider) which runs BEFORE the mocked Better-Auth
  // call, so it is a real DB-observable assertion of the one-provider-per-org
  // path.
  it("REQ-SSO-002: POST /providers as owner + existing provider -> 409 (one provider per org)", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "owner" });
    await seedProvider({
      organizationId: org.orgId,
      userId: org.userId,
      providerId: "existing-idp",
    });

    loginAs({ userId: org.userId, organizationId: org.orgId });
    const res = await ssoRouter.request("/providers", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(VALID_CREATE_BODY),
    });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("provedor SSO");
  });

  // ===========================================================================
  // REQ-SSO-004 (handshake): POST /start — DB-observable early rejects ONLY.
  // ===========================================================================
  // FLAG: the SSO sign-in redirect itself (auth.api.signInSSO -> the org's IdP)
  // is UNREACHABLE here. createLabAuth is mocked to expose only getSession, so
  // signInSSO is undefined; and even a wired Better-Auth would need a live/mock
  // OIDC IdP plus a signed assertion to produce the redirect URL. We therefore
  // assert only the early rejects that fire BEFORE signInSSO and flag the rest.

  it("REQ-SSO-004: POST /start for an unknown organizationSlug -> 404 (org lookup, no IdP call)", async () => {
    // /start is NOT RBAC-gated; it takes a slug. Unknown slug -> 404 before
    // any provider/IdP logic.
    const res = await ssoRouter.request("/start", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ organizationSlug: "no-such-lab" }),
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain("Laboratorio");
  });

  it("REQ-SSO-004: POST /start for a known org without an SSO provider -> 404 (provider lookup, no IdP call)", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "owner" });
    // No ssoProvider seeded for this org.

    const res = await ssoRouter.request("/start", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ organizationSlug: org.orgId }),
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain("ainda nao configurou SSO");
  });

  it("REQ-SSO-004: POST /start when the org's SSO domain is unverified -> 403 (domain gate, no IdP call)", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "owner" });
    await seedProvider({
      organizationId: org.orgId,
      userId: org.userId,
      providerId: "unverified-idp",
      domainVerified: false,
    });

    const res = await ssoRouter.request("/start", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ organizationSlug: org.orgId }),
    });

    // domainVerified=false -> 403 BEFORE auth.api.signInSSO.
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("dominio");
  });

  // ===========================================================================
  // happy-path: config READ round-trip persists org-scoped
  // ===========================================================================
  // The CREATE happy-path is NOT reachable (registerSSOProvider is mocked away),
  // so we prove the org-scoped READ round-trip against a directly-seeded row:
  // a verified provider seeded for org A is read back, masked + org-scoped.
  it("happy-path: a seeded verified provider round-trips through GET /providers, org-scoped + secret-masked", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "owner" });
    await seedProvider({
      organizationId: org.orgId,
      userId: org.userId,
      providerId: "round-trip-idp",
      issuer: "https://login.round-trip.example.com",
      domainVerified: true,
    });

    loginAs({ userId: org.userId, organizationId: org.orgId });
    const res = await ssoRouter.request("/providers", {
      headers: JSON_HEADERS,
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.provider).not.toBeNull();
    expect(body.provider.providerId).toBe("round-trip-idp");
    expect(body.provider.organizationId).toBe(org.orgId);
    expect(body.provider.issuer).toBe("https://login.round-trip.example.com");
    expect(body.provider.domainVerified).toBe(true);
    // owner sees the management affordances.
    expect(body.access.canManage).toBe(true);
    expect(body.access.canDelete).toBe(true);
    // The clientId is masked to the last four — the full secret never leaves.
    expect(body.provider.oidcConfig.clientIdLastFour).toBe("7890");
  });
});
