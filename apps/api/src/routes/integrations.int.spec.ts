import { beforeEach, describe, expect, it } from "vitest";
import { integrationsRouter } from "./integrations";
import { decryptIntegrationSecret } from "../lib/integrations";
import { db } from "@calibra-facil/db";
import {
  organizationIntegration,
  integrationConnection,
} from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";
import { loginAs, logout } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";
import { normalizeGenericFinancialErpConfig } from "@calibra-facil/shared";

// Real-DB + real-RBAC integration tests for integrationsRouter.
// Only the better-auth session is mocked (test/integration/setup.ts).
// requireLabProtected -> requireOrganization -> requireOrgType("LAB") +
// requireRole(["admin","owner"])
// all run for real against the seeded Postgres.
//
// Covered:
//   REQ-INTG-001  GET /  tenant isolation — only authed org's integrations returned (definite count)
//   REQ-INTG-002  Cross-tenant GET /:id/events -> 404, no data leak (no creds/tokens)
//   REQ-INTG-003  POST /  as role=member -> 403 (RBAC: admin/owner only)
//   REQ-INTG-005  POST /  as admin -> 201, row persisted in org scope
//   REQ-INTG-006  GET /  unauthenticated -> 401
//
// Deferred/avoided (noted):
//   POST /conta-azul/oauth/start   — calls external Conta Azul OAuth server
//   GET  /conta-azul/oauth/callback — calls external Conta Azul token exchange
//   POST /:id/conta-azul/refresh   — calls external Conta Azul OAuth refresh
//   POST /:id/conta-azul/disconnect — DB-only but requires seeded conta_azul connection (OAuth token encrypt); skipped for simplicity
//   GET  /:id/conta-azul/catalog/* — calls external Conta Azul API via listContaAzulCatalog
//   POST /:id/sync                 — enqueues background job (external queue)
//   POST /:id/conta-azul/poll/*    — calls external Conta Azul API
//   PUT  /:id                      — requires an existing generic_http integration; covered via POST path

const JSON_HEADERS = { "content-type": "application/json" };

// Minimal INTEGRATIONS_MASTER_KEY env to satisfy encryptIntegrationSecret when
// the POST / handler runs. The key must be base64-encoded and decode to exactly
// 32 bytes (AES-256). `Buffer.alloc(32).toString("base64")` gives 44-char base64
// of 32 null bytes — valid for test use only, never a production credential.
const TEST_ENV = {
  INTEGRATIONS_MASTER_KEY: Buffer.alloc(32).toString("base64"),
};

// ---------------------------------------------------------------------------
// Inline domain seed helpers — NOT modifying shared seed.ts.
// ---------------------------------------------------------------------------

/**
 * Build a minimal GenericFinancialErpConnectionConfig using the real normalizer
 * so the seeded config is always schema-valid.
 */
function buildTestConfig() {
  return normalizeGenericFinancialErpConfig({
    baseUrl: "https://erp.example.com",
  });
}

/**
 * Seed an organizationIntegration + integrationConnection row directly so tests
 * that read integrations can verify isolation without needing the POST / endpoint
 * or INTEGRATIONS_MASTER_KEY encryption.
 */
async function seedIntegration(params: {
  organizationId: string;
  createdBy: string;
  name?: string;
}): Promise<string> {
  const integrationId = `int-${params.organizationId}-${Date.now()}`;
  const connectionId = `conn-${integrationId}`;

  await db.insert(organizationIntegration).values({
    id: integrationId,
    organizationId: params.organizationId,
    type: "financial_erp",
    provider: "generic_http",
    name: params.name ?? "Test ERP",
    status: "ACTIVE",
    createdBy: params.createdBy,
    updatedBy: params.createdBy,
  });

  await db.insert(integrationConnection).values({
    id: connectionId,
    integrationId,
    organizationId: params.organizationId,
    credentialType: "bearer",
    config: buildTestConfig(),
    // Dummy encrypted values — tests that read integrations never decrypt.
    encryptedSecret: "dummy-encrypted",
    secretIv: "dummy-iv",
    createdBy: params.createdBy,
    updatedBy: params.createdBy,
  });

  return integrationId;
}

// ---------------------------------------------------------------------------

describe("integrationsRouter — real DB + real middleware", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // REQ-INTG-001: GET / tenant isolation — two orgs, each with one integration.
  // Org A user sees ONLY org A's integration; org B's is excluded. Definite count.
  it("REQ-INTG-001: GET / returns only the authenticated org's integrations (tenant isolation)", async () => {
    const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
    const orgB = await seedOrg({ orgId: "org-b", role: "admin" });

    await seedIntegration({
      organizationId: orgA.orgId,
      createdBy: orgA.userId,
      name: "ERP Alpha",
    });
    await seedIntegration({
      organizationId: orgB.orgId,
      createdBy: orgB.userId,
      name: "ERP Beta",
    });

    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    const res = await integrationsRouter.request("/", {
      headers: JSON_HEADERS,
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    // data array must include only org A's integration
    const names = body.data.map((i: { name: string }) => i.name);
    expect(names).toContain("ERP Alpha");
    expect(names).not.toContain("ERP Beta");
    // Definite count: exactly one row returned — no leakage from org B
    expect(body.data).toHaveLength(1);
  });

  // REQ-INTG-002: Cross-tenant GET /:id/events — org A user requesting org B's
  // integration id must receive 404 with no credentials or tokens leaked.
  it("REQ-INTG-002: GET /:id/events for another org's integration returns 404 — no cross-tenant read", async () => {
    const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
    const orgB = await seedOrg({ orgId: "org-b", role: "admin" });

    const bIntegrationId = await seedIntegration({
      organizationId: orgB.orgId,
      createdBy: orgB.userId,
      name: "Secret ERP B",
    });

    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    const res = await integrationsRouter.request(`/${bIntegrationId}/events`, {
      headers: JSON_HEADERS,
    });

    // getIntegrationRecord scopes by org, so org B's id resolves to null for
    // org A -> 404. No credentials, tokens, or integration data returned.
    expect(res.status).toBe(404);
    const body = await res.json();
    // Confirm no secret fields are in the error payload
    expect(body).not.toHaveProperty("encryptedSecret");
    expect(body).not.toHaveProperty("secretIv");
    expect(body).not.toHaveProperty("name");
  });

  // REQ-INTG-003: POST / as role=member -> 403 (requireRole(["admin","owner"]) fires).
  it("REQ-INTG-003: POST / as role=member -> 403 (RBAC: integration create denied for member)", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "member" });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const res = await integrationsRouter.request(
      "/",
      {
        method: "POST",
        headers: { ...JSON_HEADERS },
        body: JSON.stringify({
          name: "Should Not Create",
          baseUrl: "https://erp.example.com",
          authToken: "should-not-reach-handler",
        }),
      },
      TEST_ENV,
    );

    expect(res.status).toBe(403);
  });

  // REQ-INTG-005: POST / as admin -> 201, row persisted.
  // Confirms the RBAC + DB write chain works end-to-end.
  it("REQ-INTG-005: POST / as admin -> 201, integration persisted in org scope", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "admin" });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const res = await integrationsRouter.request(
      "/",
      {
        method: "POST",
        headers: { ...JSON_HEADERS },
        body: JSON.stringify({
          name: "My ERP",
          baseUrl: "https://erp.example.com",
          authToken: "a-valid-auth-token-here",
        }),
      },
      TEST_ENV,
    );

    expect(res.status).toBe(201);
    const body = await res.json();

    // Response body contains the list payload; find the created integration
    const created = body.data.find(
      (i: { name: string }) => i.name === "My ERP",
    );
    expect(created).toBeDefined();
    expect(created.provider).toBe("generic_http");

    // Verify it is persisted in the DB scoped to org A only
    const rows = await db
      .select()
      .from(organizationIntegration)
      .where(eq(organizationIntegration.organizationId, org.orgId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("My ERP");
    expect(rows[0]?.organizationId).toBe(org.orgId);

    // The connection row must be present AND the auth token must be stored
    // ENCRYPTED, never as plaintext: assert the stored ciphertext differs from
    // the plaintext token and that it round-trips back via decryptIntegrationSecret.
    const connRows = await db
      .select({
        encryptedSecret: integrationConnection.encryptedSecret,
        secretIv: integrationConnection.secretIv,
      })
      .from(integrationConnection)
      .where(eq(integrationConnection.organizationId, org.orgId));
    expect(connRows).toHaveLength(1);
    const { encryptedSecret, secretIv } = connRows[0] ?? {};
    if (!encryptedSecret || !secretIv) {
      throw new Error("expected an encrypted secret to be persisted");
    }
    expect(encryptedSecret).not.toBe("a-valid-auth-token-here");
    expect(decryptIntegrationSecret(encryptedSecret, secretIv, TEST_ENV)).toBe(
      "a-valid-auth-token-here",
    );
  });

  // REQ-INTG-006: Unauthenticated GET / -> 401 (requireLabProtected fires).
  it("REQ-INTG-006: GET / unauthenticated -> 401", async () => {
    logout();
    const res = await integrationsRouter.request("/", {
      headers: JSON_HEADERS,
    });
    expect(res.status).toBe(401);
  });
});
