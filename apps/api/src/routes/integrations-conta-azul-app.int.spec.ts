import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import {
  integrationConnection,
  integrationOAuthApp,
  organizationEventLog,
  organizationIntegration,
  session,
} from "@calibra-facil/db/schema";
import { decryptPassword } from "@calibra-facil/signing";
import { normalizeContaAzulConnectionConfig } from "@calibra-facil/shared";

import { integrationsRouter } from "./integrations";
import { loginAs, logout } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";

// Real-DB + real-RBAC tests for the bring-your-own Conta Azul application:
// a laboratory saves its own Client ID/Secret, and the OAuth flow, the token
// exchange and the token endpoint all use it. Only better-auth's getSession and
// the calls to Conta Azul's token endpoint (global fetch) are stubbed.
//
//   REQ-CAZAPP-001  GET without an application: nothing configured, callback URL derived from API_URL
//   REQ-CAZAPP-002  member role -> 403 on read and write (admin/owner only)
//   REQ-CAZAPP-003  PUT with a pair Conta Azul rejects -> 422, nothing stored
//   REQ-CAZAPP-004  PUT accepted -> stored encrypted, summary shows only the last 4, audit event, no secret in the response
//   REQ-CAZAPP-005  tenant isolation: another laboratory does not see or use the application
//   REQ-CAZAPP-006  OAuth start without any application -> 409 conta_azul_app_missing
//   REQ-CAZAPP-007  server env app is the fallback; a laboratory's own takes precedence
//   REQ-CAZAPP-008  start + callback: the code is redeemed with the laboratory's own credentials
//   REQ-CAZAPP-009  DELETE removes it; connecting asks for an application again
//   REQ-CAZAPP-010  a new Client ID while connected requires reconnecting; a rotated secret does not

const JSON_HEADERS = { "content-type": "application/json" };
const MASTER_KEY = Buffer.alloc(32, 7).toString("base64");
const ENV = {
  INTEGRATIONS_MASTER_KEY: MASTER_KEY,
  API_URL: "https://lab.example.com",
  APP_URL: "https://lab.example.com",
};
const CALLBACK_URL =
  "https://lab.example.com/api/integrations/conta-azul/oauth/callback";
const CREDENTIALS = {
  clientId: "lab-client-id",
  clientSecret: "lab-client-secret-9f3a",
};

type TokenRequest = { authorization: string | null; body: URLSearchParams };

/** Stub Conta Azul's token endpoint with one answer; record what it receives. */
function stubTokenEndpoint(status: number, body: unknown) {
  const requests: TokenRequest[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    if (url !== "https://auth.contaazul.com/oauth2/token") {
      throw new Error(`unexpected request to ${url}`);
    }
    requests.push({
      authorization: new Headers(init?.headers).get("authorization"),
      body: new URLSearchParams(String(init?.body)),
    });
    return Response.json(body, { status });
  });
  return requests;
}

async function saveApp(credentials = CREDENTIALS) {
  stubTokenEndpoint(400, { error: "invalid_grant" });
  const res = await integrationsRouter.request(
    "/conta-azul/app",
    {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify(credentials),
    },
    ENV,
  );
  vi.restoreAllMocks();
  return res;
}

/** A Conta Azul connection made earlier, with dummy encrypted tokens. */
async function seedContaAzulConnection(params: {
  organizationId: string;
  userId: string;
}) {
  const integrationId = `caz-${params.organizationId}`;
  await db.insert(organizationIntegration).values({
    id: integrationId,
    organizationId: params.organizationId,
    type: "financial_erp",
    provider: "conta_azul",
    name: "Conta Azul",
    status: "ACTIVE",
    createdBy: params.userId,
  });
  await db.insert(integrationConnection).values({
    id: `conn-${integrationId}`,
    integrationId,
    organizationId: params.organizationId,
    credentialType: "oauth2",
    config: normalizeContaAzulConnectionConfig({}),
    encryptedSecret: "dummy-encrypted",
    secretIv: "dummy-iv",
    createdBy: params.userId,
  });
  return integrationId;
}

async function integrationStatus(integrationId: string) {
  const [row] = await db
    .select({
      status: organizationIntegration.status,
      lastValidationError: organizationIntegration.lastValidationError,
    })
    .from(organizationIntegration)
    .where(eq(organizationIntegration.id, integrationId));
  return row;
}

async function readApp(env: Record<string, string> = ENV) {
  const res = await integrationsRouter.request(
    "/conta-azul/app",
    { headers: JSON_HEADERS },
    env,
  );
  // Refusals from the RBAC middleware are plain text.
  const text = await res.text();
  return { status: res.status, body: res.ok ? JSON.parse(text) : text };
}

describe("Conta Azul application per laboratory — real DB", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("REQ-CAZAPP-001: without an application nothing is configured and the callback URL comes from API_URL", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "admin" });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const { status, body } = await readApp();

    expect(status).toBe(200);
    expect(body).toEqual({
      source: null,
      clientId: null,
      clientSecretLast4: null,
      redirectUri: CALLBACK_URL,
      updatedAt: null,
    });
  });

  it("REQ-CAZAPP-002: a member can neither read nor change the application", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "member" });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    expect((await readApp()).status).toBe(403);
    expect((await saveApp()).status).toBe(403);
    expect(await db.select().from(integrationOAuthApp)).toHaveLength(0);
  });

  it("REQ-CAZAPP-003: a pair Conta Azul rejects is not stored", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "admin" });
    loginAs({ userId: org.userId, organizationId: org.orgId });
    const requests = stubTokenEndpoint(400, { error: "invalid_client" });

    const res = await integrationsRouter.request(
      "/conta-azul/app",
      {
        method: "PUT",
        headers: JSON_HEADERS,
        body: JSON.stringify(CREDENTIALS),
      },
      ENV,
    );

    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ check: "rejected" });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.authorization).toBe(
      `Basic ${btoa("lab-client-id:lab-client-secret-9f3a")}`,
    );
    expect(requests[0]?.body.get("redirect_uri")).toBe(CALLBACK_URL);
    expect(await db.select().from(integrationOAuthApp)).toHaveLength(0);
  });

  it("REQ-CAZAPP-004: an accepted pair is stored encrypted and only its last four characters are shown", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "admin" });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const res = await saveApp({
      clientId: "  lab-client-id ",
      clientSecret: " lab-client-secret-9f3a ",
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("lab-client-secret");
    expect(JSON.parse(text)).toMatchObject({
      check: "accepted",
      app: {
        source: "organization",
        clientId: "lab-client-id",
        clientSecretLast4: "9f3a",
        redirectUri: CALLBACK_URL,
      },
    });

    const [row] = await db.select().from(integrationOAuthApp);
    if (!row) throw new Error("expected the application to be stored");
    expect(row.organizationId).toBe(org.orgId);
    expect(row.provider).toBe("conta_azul");
    expect(row.encryptedClientSecret).not.toContain("lab-client-secret");
    expect(
      decryptPassword(
        row.encryptedClientSecret,
        row.clientSecretIv,
        MASTER_KEY,
      ),
    ).toBe("lab-client-secret-9f3a");

    const events = await db
      .select()
      .from(organizationEventLog)
      .where(
        and(
          eq(organizationEventLog.organizationId, org.orgId),
          eq(organizationEventLog.action, "integration.conta_azul.app_saved"),
        ),
      );
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events[0]?.details)).not.toContain(
      "lab-client-secret",
    );
  });

  it("REQ-CAZAPP-005: another laboratory neither sees nor uses the application", async () => {
    const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
    const orgB = await seedOrg({ orgId: "org-b", role: "admin" });
    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    expect((await saveApp()).status).toBe(200);

    loginAs({ userId: orgB.userId, organizationId: orgB.orgId });
    expect((await readApp()).body).toMatchObject({
      source: null,
      clientId: null,
    });
    const start = await integrationsRouter.request(
      "/conta-azul/oauth/start",
      { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({}) },
      ENV,
    );
    expect(start.status).toBe(409);
  });

  it("REQ-CAZAPP-006: connecting without any application explains what is missing", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "admin" });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const res = await integrationsRouter.request(
      "/conta-azul/oauth/start",
      { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({}) },
      ENV,
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error:
        "Nenhum aplicativo Conta Azul configurado. Cadastre o Client ID e o Client Secret em Configurações → Integrações.",
      code: "conta_azul_app_missing",
    });
  });

  it("REQ-CAZAPP-007: the server's application is the fallback and a laboratory's own takes precedence", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "admin" });
    loginAs({ userId: org.userId, organizationId: org.orgId });
    const serverEnv = {
      ...ENV,
      CONTA_AZUL_CLIENT_ID: "server-client-id",
      CONTA_AZUL_CLIENT_SECRET: "server-client-secret",
    };

    expect((await readApp(serverEnv)).body).toMatchObject({
      source: "server",
      clientId: null,
    });
    const serverStart = await integrationsRouter.request(
      "/conta-azul/oauth/start",
      { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({}) },
      serverEnv,
    );
    const serverUrl = new URL((await serverStart.json()).authorizationUrl);
    expect(serverUrl.searchParams.get("client_id")).toBe("server-client-id");

    expect((await saveApp()).status).toBe(200);
    const ownStart = await integrationsRouter.request(
      "/conta-azul/oauth/start",
      { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({}) },
      serverEnv,
    );
    const ownUrl = new URL((await ownStart.json()).authorizationUrl);
    expect(ownUrl.searchParams.get("client_id")).toBe("lab-client-id");
  });

  it("REQ-CAZAPP-008: the code is redeemed with the laboratory's own credentials", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "admin" });
    loginAs({ userId: org.userId, organizationId: org.orgId });
    await db.insert(session).values({
      id: `sess-${org.userId}`,
      token: `token-${org.userId}`,
      userId: org.userId,
      activeOrganizationId: org.orgId,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    expect((await saveApp()).status).toBe(200);

    const start = await integrationsRouter.request(
      "/conta-azul/oauth/start",
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ returnTo: "/dashboard/settings/integrations" }),
      },
      ENV,
    );
    expect(start.status).toBe(200);
    const authorizationUrl = new URL((await start.json()).authorizationUrl);
    expect(authorizationUrl.searchParams.get("client_id")).toBe(
      "lab-client-id",
    );
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(
      CALLBACK_URL,
    );
    const state = authorizationUrl.searchParams.get("state");
    if (!state) throw new Error("expected a signed state");

    const requests = stubTokenEndpoint(200, {
      access_token: "access-1",
      refresh_token: "refresh-1",
      token_type: "Bearer",
      expires_in: 3600,
    });
    logout();
    const callback = await integrationsRouter.request(
      `/conta-azul/oauth/callback?code=code-1&state=${encodeURIComponent(state)}`,
      {},
      ENV,
    );

    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe(
      "https://lab.example.com/dashboard/settings/integrations",
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]?.authorization).toBe(
      `Basic ${btoa("lab-client-id:lab-client-secret-9f3a")}`,
    );
    expect(requests[0]?.body.get("code")).toBe("code-1");
    expect(requests[0]?.body.get("redirect_uri")).toBe(CALLBACK_URL);

    const integrations = await db
      .select()
      .from(organizationIntegration)
      .where(eq(organizationIntegration.organizationId, org.orgId));
    expect(integrations).toHaveLength(1);
    expect(integrations[0]?.provider).toBe("conta_azul");
    const connections = await db
      .select()
      .from(integrationConnection)
      .where(eq(integrationConnection.organizationId, org.orgId));
    expect(connections).toHaveLength(1);
    expect(connections[0]?.credentialType).toBe("oauth2");
  });

  it("REQ-CAZAPP-009: removing the application makes connecting ask for one again", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "owner" });
    loginAs({ userId: org.userId, organizationId: org.orgId });
    expect((await saveApp()).status).toBe(200);

    const res = await integrationsRouter.request(
      "/conta-azul/app",
      { method: "DELETE", headers: JSON_HEADERS },
      ENV,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ source: null, clientId: null });
    expect(await db.select().from(integrationOAuthApp)).toHaveLength(0);
    const start = await integrationsRouter.request(
      "/conta-azul/oauth/start",
      { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({}) },
      ENV,
    );
    expect(start.status).toBe(409);
  });

  it("REQ-CAZAPP-010: a new Client ID while connected requires reconnecting; a new secret does not", async () => {
    const org = await seedOrg({ orgId: "org-a", role: "admin" });
    loginAs({ userId: org.userId, organizationId: org.orgId });
    expect((await saveApp()).status).toBe(200);
    const integrationId = await seedContaAzulConnection({
      organizationId: org.orgId,
      userId: org.userId,
    });

    expect(
      (
        await saveApp({
          clientId: "lab-client-id",
          clientSecret: "rotated-secret-0001",
        })
      ).status,
    ).toBe(200);
    expect(await integrationStatus(integrationId)).toMatchObject({
      status: "ACTIVE",
    });

    expect(
      (
        await saveApp({
          clientId: "another-client-id",
          clientSecret: "another-secret",
        })
      ).status,
    ).toBe(200);
    expect(await integrationStatus(integrationId)).toEqual({
      status: "ACTION_REQUIRED",
      lastValidationError:
        "O aplicativo Conta Azul mudou. Reconecte a conta para continuar sincronizando.",
    });

    await db
      .update(organizationIntegration)
      .set({ status: "ACTIVE", lastValidationError: null })
      .where(eq(organizationIntegration.id, integrationId));
    const removed = await integrationsRouter.request(
      "/conta-azul/app",
      { method: "DELETE", headers: JSON_HEADERS },
      ENV,
    );
    expect(removed.status).toBe(200);
    expect(await integrationStatus(integrationId)).toMatchObject({
      status: "ACTION_REQUIRED",
    });
  });
});
