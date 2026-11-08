import {
  buildAssetDetail,
  buildAssetRecord,
  buildCustomerDetail,
  buildCustomerRecord,
  buildCustomersListResponse,
  buildDashboardStats,
  buildContaAzulAppSaveResponse,
  buildContaAzulAppSummary,
  buildContaAzulCatalogResponse,
  buildContaAzulPollResult,
  buildContaAzulScheduleResponse,
  buildIntegrationDriftQueueResponse,
  buildIntegrationRunItemsResponse,
  buildIntegrationsResponse,
  buildSyncPreviewResponse,
  buildNonConformanceRecord,
  buildServiceOrderCreateResponse,
  buildServiceOrderDetail,
  buildJobDetail,
  buildJobMutationResponse,
  buildStandard,
  buildOrganizationGovernanceActivityData,
  buildOrganizationGovernanceMembersData,
  buildOrganizationUnit,
  buildOrganizationUnitsData,
} from "@calibra-facil/contracts/fixtures";
import { describe, expect, it } from "vitest";

import {
  createCloudApiClient,
  createDesktopApiClient,
  createDesktopHybridApiClient,
  getDesktopDataPolicyUnavailableMessage,
  isDesktopRuntime,
} from "./index";
import type { CreateServiceOrderInput, JobExecutionPayload } from "./index";

function testWindow(value: unknown): Window {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- tests construct the browser surface needed by desktop runtime detection.
  return value as Window;
}

function testPayload<T>(value: unknown): T {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- tests intentionally exercise partial command payload transport.
  return value as T;
}

function formDataBody(init: RequestInit | undefined): FormData {
  if (init?.body instanceof FormData) {
    return init.body;
  }

  throw new Error("Expected FormData body");
}

describe("client runtime data policy registry", () => {
  it("keeps policy-specific unavailable messages centralized", () => {
    expect(getDesktopDataPolicyUnavailableMessage("cloud-only")).toContain(
      "API da nuvem",
    );
    expect(getDesktopDataPolicyUnavailableMessage("local-only")).toContain(
      "runtime local",
    );
  });
});

describe("desktop runtime detection", () => {
  it("detects the Electron renderer even before the preload bridge is available", () => {
    expect(
      isDesktopRuntime(
        testWindow({
          navigator: {
            userAgent:
              "Mozilla/5.0 CalibraFacil Chrome/142.0.0.0 Electron/39.8.10",
          },
        }),
      ),
    ).toBe(true);
  });

  it("detects the preload bridge when it is available", () => {
    expect(
      isDesktopRuntime(
        testWindow({
          calibraBridge: {},
          navigator: { userAgent: "Mozilla/5.0 Chrome/142.0.0.0" },
        }),
      ),
    ).toBe(true);
  });
});

describe("dashboard units runtime adapter", () => {
  it("returns null when the cloud units endpoint denies access", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);
      return new Response(null, { status: 403 });
    };
    const client = createCloudApiClient({
      baseUrl: "https://api.example.test",
      fetch: fetchMock,
    });

    await expect(client.units.getDashboardUnits()).resolves.toBeNull();
    expect(String(fetchCalls[0]?.[0])).toBe(
      "https://api.example.test/api/units",
    );
  });

  it("maps desktop local session units into the dashboard units shape", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);
      return Response.json({
        data: {
          serverTime: "2026-05-09T12:00:00.000Z",
          user: {
            id: "user-1",
            name: "Ana",
            email: "ana@example.test",
          },
          organization: {
            id: "org-1",
            type: "laboratory",
          },
          activeUnits: [
            {
              id: 10,
              name: "Laboratorio Central",
              role: "unit_admin",
            },
            {
              id: 20,
              name: "Unidade Norte",
              role: "technician",
            },
          ],
          permissions: {
            role: "member",
            unitRole: "unit_admin",
            activeUnitId: 10,
            accessibleUnitIds: [10, 20],
            canAccessAllUnits: true,
          },
          featureFlags: {
            offlineApprovals: false,
            offlineCertificatePublication: false,
          },
          syncCursor: "cursor-1",
          publishedMethods: [],
          assetTypes: [],
          customers: [],
          assets: [],
          services: [],
          standards: [],
          environmentalLimits: [],
          jobs: [],
          serviceOrders: [],
        },
      });
    };
    const client = createDesktopApiClient({
      baseUrl: "http://127.0.0.1:4317",
      tokenProvider: () => "local-token",
      fetch: fetchMock,
    });

    await expect(client.units.getDashboardUnits()).resolves.toMatchObject({
      activeUnitId: 10,
      activeUnitName: "Laboratorio Central",
      selectedUnitScope: "unit",
      canAccessAllUnits: true,
      data: [
        {
          id: 10,
          name: "Laboratorio Central",
          slug: "laboratorio-central",
          role: "unit_admin",
        },
        {
          id: 20,
          name: "Unidade Norte",
          slug: "unidade-norte",
          role: "technician",
        },
      ],
      scopeSummary: {
        activeUnitId: 10,
        activeUnitName: "Laboratorio Central",
        effectiveRole: "unit_admin",
        effectiveRoleLabel: "Admin. da unidade",
      },
    });

    expect(String(fetchCalls[0]?.[0])).toBe(
      "http://127.0.0.1:4317/api/local/session",
    );
    expect(new Headers(fetchCalls[0]?.[1]?.headers).get("authorization")).toBe(
      "Bearer local-token",
    );
  });
});

describe("unit governance runtime adapter", () => {
  it("routes unit governance operations through the cloud API", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);
      const url = String(input);

      if (url.endsWith("/admin/units") && init?.method === "POST") {
        return Response.json(
          buildOrganizationUnit({ id: 11, name: "Central" }),
          {
            status: 201,
          },
        );
      }

      if (url.endsWith("/admin/units/10")) {
        return Response.json(
          buildOrganizationUnit({ id: 10, name: "Central atualizada" }),
        );
      }

      if (url.endsWith("/assignments") || url.endsWith("/role")) {
        return Response.json({ success: true });
      }

      if (url.endsWith("/admin/members")) {
        return Response.json(buildOrganizationGovernanceMembersData());
      }

      if (url.endsWith("/admin/activity")) {
        return Response.json(buildOrganizationGovernanceActivityData());
      }

      return Response.json(buildOrganizationUnitsData());
    };
    const client = createCloudApiClient({
      baseUrl: "https://api.example.test",
      fetch: fetchMock,
    });

    await expect(client.units.listAdminUnits()).resolves.toMatchObject({
      data: [{ name: "Matriz" }],
    });
    await expect(client.units.listAdminMembers()).resolves.toMatchObject({
      data: [{ id: "member-1" }],
    });
    await expect(client.units.listAdminActivity()).resolves.toMatchObject({
      data: [{ action: "unit.created" }],
    });
    await expect(
      client.units.createAdminUnit({ body: { name: "Central" } }),
    ).resolves.toMatchObject({ id: 11 });
    await expect(
      client.units.updateAdminUnit({
        params: { id: 10 },
        body: { name: "Central atualizada" },
      }),
    ).resolves.toMatchObject({ name: "Central atualizada" });
    await expect(
      client.units.updateMemberAssignments({
        params: { memberId: "member-1" },
        body: { assignments: [{ unitId: 10, role: "technician" }] },
      }),
    ).resolves.toEqual({ success: true });
    await expect(
      client.units.updateMemberRole({
        params: { memberId: "member-1" },
        body: { role: "admin" },
      }),
    ).resolves.toEqual({ success: true });

    expect(fetchCalls.map(([input]) => String(input))).toEqual([
      "https://api.example.test/api/units/admin/units",
      "https://api.example.test/api/units/admin/members",
      "https://api.example.test/api/units/admin/activity",
      "https://api.example.test/api/units/admin/units",
      "https://api.example.test/api/units/admin/units/10",
      "https://api.example.test/api/units/admin/members/member-1/assignments",
      "https://api.example.test/api/units/admin/members/member-1/role",
    ]);
  });

  it("keeps unit governance mutations cloud-only in the desktop adapter", async () => {
    const client = createDesktopApiClient({
      baseUrl: "http://127.0.0.1:4317",
      fetch: async () => {
        throw new Error("fetch should not be called");
      },
    });

    await expect(client.units.listAdminUnits()).resolves.toMatchObject({
      data: [],
      viewer: { canViewGovernance: false },
    });
    await expect(
      client.units.createAdminUnit({ body: { name: "Central" } }),
    ).rejects.toThrow("Governança de unidades requer a API web/nuvem");
  });
});

describe("access runtime adapter", () => {
  it("routes finance access through the cloud API", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);
      return Response.json({
        canReadFinancial: true,
        canManageFinancial: true,
        canExportFinancial: true,
        role: "owner",
      });
    };
    const client = createCloudApiClient({
      baseUrl: "https://api.example.test",
      fetch: fetchMock,
    });

    await expect(client.access.getFinanceAccess()).resolves.toMatchObject({
      role: "owner",
      canReadFinancial: true,
    });
    expect(fetchCalls.map(([input]) => String(input))).toEqual([
      "https://api.example.test/api/finance/access",
    ]);
  });

  it("returns a desktop-local finance access fallback without calling fetch", async () => {
    const fetchMock: typeof fetch = async () => {
      throw new Error("fetch should not be called");
    };
    const client = createDesktopApiClient({
      baseUrl: "http://127.0.0.1:4317",
      fetch: fetchMock,
    });

    await expect(client.access.getFinanceAccess()).resolves.toMatchObject({
      role: "desktop",
      canReadFinancial: false,
    });
  });
});

describe("sessions runtime adapter", () => {
  it("revokes sessions through the cloud API", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);
      return Response.json({ status: true });
    };
    const client = createCloudApiClient({
      baseUrl: "https://api.example.test",
      fetch: fetchMock,
    });

    await expect(
      client.sessions.revoke({ body: { sessionId: "session-1" } }),
    ).resolves.toEqual({
      status: true,
    });
    expect(String(fetchCalls[0]?.[0])).toBe(
      "https://api.example.test/api/sessions/revoke",
    );
    expect(fetchCalls[0]?.[1]?.method).toBe("POST");
    expect(JSON.parse(String(fetchCalls[0]?.[1]?.body))).toEqual({
      sessionId: "session-1",
    });
  });

  it("keeps session revocation cloud-only in the desktop adapter", async () => {
    const client = createDesktopApiClient({
      baseUrl: "http://127.0.0.1:4317",
      fetch: async () => {
        throw new Error("fetch should not be called");
      },
    });

    await expect(
      client.sessions.revoke({ body: { sessionId: "session-1" } }),
    ).rejects.toThrow("Gerenciamento de sessoes requer a API web/nuvem");
  });
});

describe("public invitations runtime adapter", () => {
  it("requests invitation setup links through the cloud API", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);
      return Response.json({ setupLinkRequested: true, userCreated: false });
    };
    const client = createCloudApiClient({
      baseUrl: "https://api.example.test",
      fetch: fetchMock,
    });

    await expect(
      client.publicInvitations.requestSetupLink({ params: { id: "invite-1" } }),
    ).resolves.toEqual({
      setupLinkRequested: true,
      userCreated: false,
    });
    expect(fetchCalls.map(([input]) => String(input))).toEqual([
      "https://api.example.test/api/invitations/invite-1/request-setup-link",
    ]);
    expect(fetchCalls[0]?.[1]?.method).toBe("POST");
  });
});

describe("lab setup runtime adapter", () => {
  it("loads ready setup metadata through the cloud API", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);
      return Response.json({
        status: "ready",
        email: "owner@lab.test",
        organizationName: "Lab Acreditado",
        organizationSlug: "lab-acreditado",
        expiresAt: "2030-01-01T00:00:00.000Z",
        passkeyPreferred: true,
        fallbackMethods: ["magic_link", "email_otp"],
      });
    };
    const client = createCloudApiClient({
      baseUrl: "https://api.example.test",
      fetch: fetchMock,
    });

    await expect(
      client.labSetup.get({ params: { token: "setup-token" } }),
    ).resolves.toEqual({
      status: "ready",
      email: "owner@lab.test",
      organizationName: "Lab Acreditado",
      organizationSlug: "lab-acreditado",
      expiresAt: "2030-01-01T00:00:00.000Z",
      passkeyPreferred: true,
      fallbackMethods: ["magic_link", "email_otp"],
    });
    expect(fetchCalls.map(([input]) => String(input))).toEqual([
      "https://api.example.test/api/lab-setup/setup-token",
    ]);
    expect(fetchCalls[0]?.[1]?.method).toBe("GET");
  });

  it("preserves rejected setup-token status payloads for the claim UI", async () => {
    const fetchMock: typeof fetch = async () =>
      Response.json(
        {
          status: "expired",
          passkeyPreferred: true,
          fallbackMethods: ["magic_link", "email_otp"],
        },
        { status: 410 },
      );
    const client = createCloudApiClient({
      baseUrl: "https://api.example.test",
      fetch: fetchMock,
    });

    await expect(
      client.labSetup.get({ params: { token: "expired-token" } }),
    ).resolves.toEqual({
      status: "expired",
      passkeyPreferred: true,
      fallbackMethods: ["magic_link", "email_otp"],
    });
  });
});

describe("sso runtime adapter", () => {
  it("starts SSO through the cloud API", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);
      return Response.json({
        url: "https://idp.example.test/login",
        redirect: true,
      });
    };
    const client = createCloudApiClient({
      baseUrl: "https://api.example.test",
      fetch: fetchMock,
    });

    await expect(
      client.sso.start({
        body: {
          organizationSlug: "laboratorio-central",
          email: "ana@example.test",
          redirectPath: "/dashboard",
        },
      }),
    ).resolves.toEqual({
      url: "https://idp.example.test/login",
      redirect: true,
    });
    expect(fetchCalls.map(([input]) => String(input))).toEqual([
      "https://api.example.test/api/sso/start",
    ]);
    expect(fetchCalls[0]?.[1]?.method).toBe("POST");
  });

  it("routes SSO provider management through the cloud API", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const provider = {
      id: "provider-row-1",
      providerId: "okta",
      issuer: "https://idp.example.test",
      domain: "https://example.test",
      domainHost: "example.test",
      domainVerified: false,
      organizationId: "org-1",
      type: "oidc",
      redirectURI: "https://api.example.test/api/auth/callback/okta",
      oidcConfig: {
        discoveryEndpoint:
          "https://idp.example.test/.well-known/openid-configuration",
        authorizationEndpoint: null,
        tokenEndpoint: null,
        userInfoEndpoint: null,
        jwksEndpoint: null,
        scopes: ["openid", "email", "profile"],
        pkce: true,
        clientIdLastFour: "1234",
        tokenEndpointAuthentication: null,
      },
    };
    const verificationRecord = {
      type: "TXT" as const,
      host: "_calibrafacil-sso.example.test",
      value: "verify-token",
    };
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);
      const url = String(input);

      if (url.endsWith("/request-domain-verification")) {
        return Response.json({ verificationRecord });
      }

      if (url.endsWith("/verify-domain")) {
        return Response.json({
          provider: { ...provider, domainVerified: true },
        });
      }

      if (init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }

      if (init?.method === "POST") {
        return Response.json({ provider, verificationRecord }, { status: 201 });
      }

      return Response.json({
        provider,
        access: {
          role: "owner",
          canCreate: true,
          canManage: true,
          canDelete: true,
        },
        billing: {
          planId: "enterprise",
          planName: "Enterprise",
          status: "active",
          hasSso: true,
        },
      });
    };
    const client = createCloudApiClient({
      baseUrl: "https://api.example.test",
      fetch: fetchMock,
    });

    await expect(client.sso.getProviders()).resolves.toMatchObject({
      provider: { providerId: "okta" },
      billing: { hasSso: true },
    });
    await expect(
      client.sso.createProvider({
        body: {
          providerId: "okta",
          issuer: "https://idp.example.test",
          domain: "example.test",
          clientId: "client-id",
          clientSecret: "client-secret",
          scopes: ["openid", "email", "profile"],
        },
      }),
    ).resolves.toMatchObject({
      provider: { providerId: "okta" },
      verificationRecord,
    });
    await expect(
      client.sso.requestDomainVerification({ params: { providerId: "okta" } }),
    ).resolves.toEqual({ verificationRecord });
    await expect(
      client.sso.verifyDomain({ params: { providerId: "okta" } }),
    ).resolves.toMatchObject({
      provider: { domainVerified: true },
    });
    await expect(
      client.sso.deleteProvider({ params: { providerId: "okta" } }),
    ).resolves.toBeUndefined();

    expect(fetchCalls.map(([input]) => String(input))).toEqual([
      "https://api.example.test/api/sso/providers",
      "https://api.example.test/api/sso/providers",
      "https://api.example.test/api/sso/providers/okta/request-domain-verification",
      "https://api.example.test/api/sso/providers/okta/verify-domain",
      "https://api.example.test/api/sso/providers/okta",
    ]);
  });

  it("keeps SSO cloud-only in the desktop adapter", async () => {
    const fetchMock: typeof fetch = async () => {
      throw new Error("fetch should not be called");
    };
    const client = createDesktopApiClient({
      baseUrl: "http://127.0.0.1:4317",
      fetch: fetchMock,
    });

    await expect(
      client.sso.start({ body: { organizationSlug: "laboratorio-central" } }),
    ).rejects.toThrow("Login SSO requer a API web/nuvem");
    await expect(client.sso.getProviders()).resolves.toMatchObject({
      provider: null,
    });
    await expect(
      client.sso.createProvider({
        body: {
          providerId: "okta",
          issuer: "https://idp.example.test",
          domain: "example.test",
          clientId: "client-id",
          clientSecret: "client-secret",
        },
      }),
    ).rejects.toThrow("Configuração SSO requer a API web/nuvem");
  });
});

describe("api keys runtime adapter", () => {
  it("routes API key management through the cloud API", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const key = {
      id: "key-1",
      name: "Automation",
      keyPrefix: "cf_live_1234",
      scopes: ["customers:read", "jobs:write"],
      lastUsedAt: null,
      expiresAt: "2027-05-09T12:00:00.000Z",
      allowedIps: null,
      createdAt: "2026-05-09T12:00:00.000Z",
      revokedAt: null,
    };
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);
      const url = String(input);

      if (url.endsWith("/rotate")) {
        return Response.json({
          secret: "cf_live_rotated",
          key: { ...key, keyPrefix: "cf_live_5678" },
        });
      }

      if (url.endsWith("/revoke")) {
        return Response.json({ success: true });
      }

      if (init?.method === "POST") {
        return Response.json(
          {
            secret: "cf_live_secret",
            key,
          },
          { status: 201 },
        );
      }

      return Response.json({ data: [key] });
    };
    const client = createCloudApiClient({
      baseUrl: "https://api.example.test",
      fetch: fetchMock,
    });

    await expect(client.apiKeys.list()).resolves.toMatchObject({
      data: [{ id: "key-1", keyPrefix: "cf_live_1234" }],
    });
    await expect(
      client.apiKeys.create({
        body: {
          name: "Automation",
          scopes: ["customers:read", "jobs:write"],
        },
      }),
    ).resolves.toMatchObject({
      secret: "cf_live_secret",
      key: { id: "key-1" },
    });
    await expect(
      client.apiKeys.rotate({ params: { id: "key-1" } }),
    ).resolves.toMatchObject({
      secret: "cf_live_rotated",
      key: { keyPrefix: "cf_live_5678" },
    });
    await expect(
      client.apiKeys.revoke({ params: { id: "key-1" } }),
    ).resolves.toEqual({
      success: true,
    });

    expect(fetchCalls.map(([input]) => String(input))).toEqual([
      "https://api.example.test/api/api-keys",
      "https://api.example.test/api/api-keys",
      "https://api.example.test/api/api-keys/key-1/rotate",
      "https://api.example.test/api/api-keys/key-1/revoke",
    ]);
  });

  it("keeps API key mutations cloud-only in the desktop adapter", async () => {
    const fetchMock: typeof fetch = async () => {
      throw new Error("fetch should not be called");
    };
    const client = createDesktopApiClient({
      baseUrl: "http://127.0.0.1:4317",
      fetch: fetchMock,
    });

    await expect(client.apiKeys.list()).resolves.toEqual({ data: [] });
    await expect(
      client.apiKeys.create({ body: { name: "Automation" } }),
    ).rejects.toThrow("API keys requer a API web/nuvem");
    await expect(
      client.apiKeys.rotate({ params: { id: "key-1" } }),
    ).rejects.toThrow("API keys requer a API web/nuvem");
    await expect(
      client.apiKeys.revoke({ params: { id: "key-1" } }),
    ).rejects.toThrow("API keys requer a API web/nuvem");
  });
});

/** A stored method row, as the workflow endpoints answer it. */
function storedMethod(overrides: Record<string, unknown> = {}) {
  return {
    id: 12,
    name: "Massa",
    description: null,
    version: 1,
    status: "DRAFT",
    assetTypeId: null,
    dataFields: [],
    variableBindings: [],
    formulas: [],
    measurementModels: [],
    validations: [],
    uncertaintyParams: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    publishedAt: null,
    parentId: null,
    ...overrides,
  };
}

describe("methods runtime adapter", () => {
  it("routes Method Builder actions through the cloud methods facade", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);
      const url = new URL(String(input));

      if (url.pathname === "/api/methods/compile") {
        return Response.json({
          ok: true,
          diagnostics: [],
          fingerprint: "fp-1",
          normalizedFormulas: [{ outputKey: "erro", expression: "a-b" }],
        });
      }

      if (url.pathname === "/api/methods/preview") {
        return Response.json({
          ok: true,
          diagnostics: [],
          fingerprint: "fp-1",
          results: { erro: 0.1 },
        });
      }

      if (url.pathname === "/api/methods/12/publish") {
        return Response.json(storedMethod({ status: "PUBLISHED" }));
      }

      if (url.pathname === "/api/methods/12/request-approval") {
        return Response.json(storedMethod({ status: "TECHNICAL_REVIEW" }));
      }

      throw new Error(`Unexpected request: ${url.toString()}`);
    };
    const client = createCloudApiClient({
      baseUrl: "https://api.example.test",
      fetch: fetchMock,
    });

    await expect(
      client.methods.compileDraft({ body: { draft: { name: "Massa" } } }),
    ).resolves.toMatchObject({ fingerprint: "fp-1" });
    await expect(
      client.methods.previewDraft({
        body: { draft: { name: "Massa" }, sampleData: { leitura: 10 } },
      }),
    ).resolves.toMatchObject({ results: { erro: 0.1 } });
    await expect(
      client.methods.publishDraft({
        params: { id: 12 },
        body: {
          sampleData: { leitura: 10 },
          reasonForChange: "Publicação inicial",
        },
      }),
    ).resolves.toMatchObject({ status: "PUBLISHED" });
    await expect(
      client.methods.requestApproval({
        params: { id: 12 },
        body: { sampleData: { leitura: 10 } },
      }),
    ).resolves.toMatchObject({ status: "TECHNICAL_REVIEW" });

    expect(fetchCalls.map(([input]) => String(input))).toEqual([
      "https://api.example.test/api/methods/compile",
      "https://api.example.test/api/methods/preview",
      "https://api.example.test/api/methods/12/publish",
      "https://api.example.test/api/methods/12/request-approval",
    ]);
    expect(JSON.parse(String(fetchCalls[0]?.[1]?.body))).toEqual({
      draft: { name: "Massa" },
    });
    expect(JSON.parse(String(fetchCalls[2]?.[1]?.body))).toEqual({
      sampleData: { leitura: 10 },
      reasonForChange: "Publicação inicial",
    });
  });

  it("returns method diagnostics responses from validation failures", async () => {
    const client = createCloudApiClient({
      baseUrl: "https://api.example.test",
      fetch: async () =>
        Response.json(
          {
            ok: false,
            diagnostics: [{ message: "Fórmula inválida" }],
            fingerprint: null,
            normalizedFormulas: [],
            compiledMethod: null,
          },
          { status: 422 },
        ),
    });

    await expect(
      client.methods.compileDraft({ body: { draft: { name: "Massa" } } }),
    ).resolves.toMatchObject({
      ok: false,
      diagnostics: [{ message: "Fórmula inválida" }],
    });
  });

  it("rejects method status mutations with diagnostics failures", async () => {
    const client = createCloudApiClient({
      baseUrl: "https://api.example.test",
      fetch: async () =>
        Response.json(
          { diagnostics: [{ message: "Amostra inválida" }] },
          { status: 422 },
        ),
    });

    await expect(
      client.methods.publishDraft({
        params: { id: 12 },
        body: {
          sampleData: { leitura: 10 },
          reasonForChange: "Publicação inicial",
        },
      }),
    ).rejects.toMatchObject({
      status: 422,
      payload: { diagnostics: [{ message: "Amostra inválida" }] },
    });
    await expect(
      client.methods.requestApproval({
        params: { id: 12 },
        body: { sampleData: { leitura: 10 } },
      }),
    ).rejects.toMatchObject({
      status: 422,
      payload: { diagnostics: [{ message: "Amostra inválida" }] },
    });
  });
});

describe("non-conformances runtime adapter", () => {
  it("creates NCs through the cloud API facade", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);
      return Response.json(
        buildNonConformanceRecord({ id: 10, ncNumber: "NC-2026-001" }),
      );
    };
    const client = createCloudApiClient({
      baseUrl: "https://api.example.test",
      fetch: fetchMock,
    });

    await expect(
      client.nonConformances.create({
        body: {
          type: "work",
          description: "Leitura fora da faixa esperada",
          detectedAt: "2026-05-20T12:00:00.000Z",
          jobId: 42,
        },
      }),
    ).resolves.toMatchObject({ id: 10, ncNumber: "NC-2026-001" });

    expect(String(fetchCalls[0]?.[0])).toBe("https://api.example.test/api/nc");
    expect(fetchCalls[0]?.[1]?.method).toBe("POST");
    expect(JSON.parse(String(fetchCalls[0]?.[1]?.body))).toEqual({
      type: "work",
      description: "Leitura fora da faixa esperada",
      detectedAt: "2026-05-20T12:00:00.000Z",
      jobId: 42,
    });
  });

  it("throws API errors from NC creation", async () => {
    const client = createCloudApiClient({
      baseUrl: "https://api.example.test",
      fetch: async () =>
        Response.json({ error: "Descrição inválida" }, { status: 400 }),
    });

    await expect(
      client.nonConformances.create({
        body: {
          type: "work",
          description: "Leitura fora da faixa esperada",
          detectedAt: "2026-05-20T12:00:00.000Z",
        },
      }),
    ).rejects.toThrow("Descrição inválida");
  });
});

describe("entity labels runtime adapter", () => {
  it("loads NC, CAPA, and competence labels through the cloud API", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);
      const url = String(input);

      if (url.endsWith("/api/nc/10/label")) {
        return Response.json({ id: 10, label: "NC-2026-001" });
      }

      if (url.endsWith("/api/capa/20/label")) {
        return Response.json({ id: 20, label: "CAPA-2026-001" });
      }

      return Response.json({ id: 30, label: "Ana Silva" });
    };
    const client = createCloudApiClient({
      baseUrl: "https://api.example.test",
      fetch: fetchMock,
    });

    await expect(
      client.entityLabels.getNonConformance({ params: { id: 10 } }),
    ).resolves.toBe("NC-2026-001");
    await expect(
      client.entityLabels.getCapa({ params: { id: 20 } }),
    ).resolves.toBe("CAPA-2026-001");
    await expect(
      client.entityLabels.getCompetence({ params: { id: 30 } }),
    ).resolves.toBe("Ana Silva");

    expect(fetchCalls.map(([input]) => String(input))).toEqual([
      "https://api.example.test/api/nc/10/label",
      "https://api.example.test/api/capa/20/label",
      "https://api.example.test/api/competences/30/label",
    ]);
  });

  it("returns null for missing cloud labels and desktop labels", async () => {
    const cloudClient = createCloudApiClient({
      baseUrl: "https://api.example.test",
      fetch: async () => new Response(null, { status: 404 }),
    });
    const desktopClient = createDesktopApiClient({
      baseUrl: "http://127.0.0.1:4317",
      fetch: async () => {
        throw new Error("fetch should not be called");
      },
    });

    await expect(
      cloudClient.entityLabels.getCapa({ params: { id: 404 } }),
    ).resolves.toBeNull();
    await expect(
      desktopClient.entityLabels.getNonConformance({ params: { id: 10 } }),
    ).resolves.toBeNull();
    await expect(
      desktopClient.entityLabels.getCapa({ params: { id: 20 } }),
    ).resolves.toBeNull();
    await expect(
      desktopClient.entityLabels.getCompetence({ params: { id: 30 } }),
    ).resolves.toBeNull();
  });
});

describe("desktop hybrid runtime adapter", () => {
  it("uses cloud APIs for shared parity data before local bootstrap and local APIs for desktop-only data", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);
      const url = new URL(String(input));

      if (
        url.origin === "https://api.example.test" &&
        url.pathname === "/api/standards"
      ) {
        return Response.json({
          data: [
            buildStandard({
              id: 1,
              name: "Peso padrao 20 kg",
              serialNumber: "STD-20KG",
              certificateNumber: "CERT-1",
              nextCalibrationDate: "2026-12-31T00:00:00.000Z",
              status: "ACTIVE",
              isExpired: false,
            }),
          ],
          pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
        });
      }

      if (
        url.origin === "http://127.0.0.1:4317" &&
        url.pathname === "/api/local/session"
      ) {
        return Response.json({
          data: {
            serverTime: "2026-05-09T12:00:00.000Z",
            user: { id: "user-1", name: "Ana", email: "ana@example.test" },
            organization: { id: "org-1", type: "laboratory" },
            activeUnits: [],
            permissions: {
              role: "admin",
              unitRole: null,
              activeUnitId: null,
              accessibleUnitIds: [],
              canAccessAllUnits: false,
            },
            featureFlags: {
              offlineApprovals: false,
              offlineCertificatePublication: false,
            },
            syncCursor: null,
            publishedMethods: [],
            assetTypes: [],
            customers: [],
            assets: [],
            services: [],
            standards: [],
            environmentalLimits: [],
            jobs: [],
            serviceOrders: [],
          },
        });
      }

      if (
        url.origin === "http://127.0.0.1:4317" &&
        url.pathname === "/api/attachments"
      ) {
        return Response.json({ data: [] });
      }

      throw new Error(`Unexpected request: ${url.toString()}`);
    };
    const client = createDesktopHybridApiClient({
      cloud: {
        baseUrl: "https://api.example.test",
        activeUnitProvider: () => "10",
        fetch: fetchMock,
      },
      local: {
        baseUrl: "http://127.0.0.1:4317",
        tokenProvider: () => "local-token",
        fetch: fetchMock,
      },
    });

    await expect(
      client.standards.list({ query: { page: 1, limit: 20 } }),
    ).resolves.toMatchObject({
      data: [{ name: "Peso padrao 20 kg" }],
    });
    await expect(client.sync.getSession()).resolves.toMatchObject({
      data: { user: { id: "user-1" } },
    });
    await expect(client.attachments.list()).resolves.toEqual({ data: [] });

    expect(fetchCalls.map(([input]) => String(input))).toEqual([
      "http://127.0.0.1:4317/api/local/session",
      "https://api.example.test/api/standards?page=1&limit=20",
      "http://127.0.0.1:4317/api/attachments",
    ]);
    expect(fetchCalls[1]?.[1]?.credentials).toBe("include");
    expect(
      new Headers(fetchCalls[1]?.[1]?.headers).get("x-active-unit-id"),
    ).toBe("10");
    expect(new Headers(fetchCalls[0]?.[1]?.headers).get("authorization")).toBe(
      "Bearer local-token",
    );
  });

  it("REQ-P01-3: the desktop client has no local certificate-draft surface (certificates are issued online only)", () => {
    const client = createDesktopApiClient({
      baseUrl: "http://127.0.0.1:4317",
      tokenProvider: () => "local-token",
      fetch: async () => Response.json({}),
    });
    const hybrid = createDesktopHybridApiClient({
      cloud: {
        baseUrl: "https://api.example.test",
        fetch: async () => Response.json({}),
      },
      local: {
        baseUrl: "http://127.0.0.1:4317",
        tokenProvider: () => "local-token",
        fetch: async () => Response.json({}),
      },
    });

    expect(Object.keys(client.jobs)).not.toContain("createCertificateDraft");
    expect(Object.keys(hybrid.jobs)).not.toContain("createCertificateDraft");
  });

  it("keeps slash-bearing job identifiers in one API route segment", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);
      const path = new URL(String(input)).pathname;
      // The local server answers the jobs endpoint contract.
      return Response.json(
        path.endsWith("/execute") || path.endsWith("/submit")
          ? buildJobMutationResponse()
          : buildJobDetail(),
      );
    };
    const client = createDesktopApiClient({
      baseUrl: "http://127.0.0.1:4317",
      tokenProvider: () => "local-token",
      fetch: fetchMock,
    });

    await client.jobs.get({ params: { id: "R-0001/2026" } });
    await client.jobs.get({ params: { id: "R-0001%2F2026" } });
    await client.jobs.saveExecution({
      params: { id: "R-0001/2026" },
      body: testPayload<JobExecutionPayload>({
        status: "draft",
        measurements: [],
      }),
    });
    await client.jobs.submitExecution({
      params: { id: "R-0001%2F2026" },
      body: testPayload<JobExecutionPayload>({
        status: "submitted",
        measurements: [],
      }),
    });

    expect(fetchCalls.map(([input]) => String(input))).toEqual([
      "http://127.0.0.1:4317/api/jobs/R-0001%252F2026",
      "http://127.0.0.1:4317/api/jobs/R-0001%252F2026",
      "http://127.0.0.1:4317/api/jobs/R-0001%252F2026/execute",
      "http://127.0.0.1:4317/api/jobs/R-0001%252F2026/submit",
    ]);
  });

  it("routes supported offline command methods to the local outbox API", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);
      const url = new URL(String(input));

      if (url.origin !== "http://127.0.0.1:4317") {
        throw new Error(`Unexpected cloud request: ${url.toString()}`);
      }

      if (url.pathname === "/api/assets") {
        return Response.json(buildAssetRecord(), { status: 201 });
      }
      // The service-order intake answers the endpoint contract.
      if (url.pathname === "/api/service-orders") {
        return Response.json(buildServiceOrderCreateResponse());
      }
      // The field-capture saves answer the jobs endpoint contract.
      if (url.pathname.startsWith("/api/jobs/")) {
        return Response.json(buildJobMutationResponse());
      }

      return Response.json({ ok: true, data: { id: "local-1" } });
    };
    const client = createDesktopHybridApiClient({
      cloud: {
        baseUrl: "https://api.example.test",
        fetch: fetchMock,
      },
      local: {
        baseUrl: "http://127.0.0.1:4317",
        tokenProvider: () => "local-token",
        fetch: fetchMock,
      },
    });

    await client.assets.create({
      body: {
        customerId: 1,
        assetTypeId: 2,
        name: "Ativo local",
        tag: "TAG-1",
        serialNumber: "SN-1",
        manufacturer: "Fabricante",
        model: "Modelo",
      },
    });
    await client.jobs.saveExecution({
      params: { id: "job-1" },
      body: testPayload<JobExecutionPayload>({
        status: "draft",
        measurements: [],
      }),
    });
    await client.jobs.submitExecution({
      params: { id: "job-1" },
      body: testPayload<JobExecutionPayload>({
        status: "submitted",
        measurements: [],
      }),
    });
    await client.serviceOrders.create({
      body: testPayload<CreateServiceOrderInput>({
        customerId: 1,
        priority: "normal",
        intakeType: "dropoff",
        items: [],
      }),
    });

    expect(fetchCalls.map(([input]) => String(input))).toEqual([
      "http://127.0.0.1:4317/api/assets",
      "http://127.0.0.1:4317/api/jobs/job-1/execute",
      "http://127.0.0.1:4317/api/jobs/job-1/submit",
      "http://127.0.0.1:4317/api/service-orders",
    ]);
    expect(fetchCalls.map(([, init]) => init?.method)).toEqual([
      "POST",
      "POST",
      "POST",
      "POST",
    ]);
  });

  it("Q13: methods outside field capture and intake never reach the local server", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);
      const url = new URL(String(input));

      if (url.origin !== "https://api.example.test") {
        throw new Error(`Unexpected local request: ${url.toString()}`);
      }

      // The customers client parses its answers with the endpoint contract.
      if (url.pathname === "/api/customers") {
        return init?.method === "POST"
          ? Response.json({ ...buildCustomerRecord(), invitationId: null })
          : Response.json(buildCustomersListResponse());
      }
      if (url.pathname === "/api/customers/1") {
        return Response.json(buildCustomerRecord());
      }
      if (url.pathname === "/api/dashboard/stats") {
        return Response.json(buildDashboardStats());
      }
      if (url.pathname === "/api/assets/1") {
        return Response.json(buildAssetRecord());
      }
      if (url.pathname === "/api/services") {
        return Response.json({
          data: [],
          pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
        });
      }

      return Response.json({ ok: true, data: { id: "cloud-1" } });
    };
    const client = createDesktopHybridApiClient({
      cloud: {
        baseUrl: "https://api.example.test",
        fetch: fetchMock,
      },
      local: {
        baseUrl: "http://127.0.0.1:4317",
        tokenProvider: () => "local-token",
        fetch: fetchMock,
      },
    });

    await client.customers.create({
      body: {
        name: "Cliente",
        email: "cliente@example.test",
        phone: "555",
        taxId: "123",
      },
    });
    await client.customers.update({
      params: { id: 1 },
      body: { name: "Cliente atualizado" },
    });
    await client.assets.update({
      params: { id: 1 },
      body: { name: "Ativo atualizado" },
    });
    await client.serviceOrders.createQuote({
      params: { id: "service-order-1" },
      body: { items: [] },
    });
    await client.serviceOrders.saveExecution({
      params: { id: "service-order-1" },
      body: { servicePerformed: "Execução", result: "repaired" },
    });
    await client.dashboard.getStats();
    await client.services.list({ query: { page: 1, limit: 20 } });

    expect(
      fetchCalls.every(
        ([input]) =>
          new URL(String(input)).origin === "https://api.example.test",
      ),
    ).toBe(true);
    expect(fetchCalls).toHaveLength(7);
  });

  it("routes approved desktop parity reads to the cloud until local bootstrap completes", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);
      const url = new URL(String(input));

      if (
        url.origin === "http://127.0.0.1:4317" &&
        url.pathname === "/api/local/session"
      ) {
        return Response.json({
          data: {
            serverTime: "2026-05-09T12:00:00.000Z",
            user: { id: "user-1", name: "Ana", email: "ana@example.test" },
            organization: { id: "org-1", type: "laboratory" },
            activeUnits: [],
            permissions: {
              role: "admin",
              unitRole: null,
              activeUnitId: null,
              accessibleUnitIds: [],
              canAccessAllUnits: false,
            },
            featureFlags: {
              offlineApprovals: false,
              offlineCertificatePublication: false,
            },
            syncCursor: null,
            publishedMethods: [],
            assetTypes: [],
            customers: [],
            assets: [],
            services: [],
            standards: [],
            environmentalLimits: [],
            jobs: [],
            serviceOrders: [],
          },
        });
      }

      if (url.origin !== "https://api.example.test") {
        throw new Error(`Unexpected request: ${url.toString()}`);
      }

      return Response.json({
        data: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
        limits: [],
        unit: { unitId: 10, unitName: "Central" },
        source: null,
      });
    };
    const client = createDesktopHybridApiClient({
      cloud: {
        baseUrl: "https://api.example.test",
        fetch: fetchMock,
      },
      local: {
        baseUrl: "http://127.0.0.1:4317",
        tokenProvider: () => "local-token",
        fetch: fetchMock,
      },
    });

    await client.customers.list({ query: { page: 1, limit: 20 } });
    await client.assets.list({ query: { page: 1, limit: 20 } });
    await client.assetTypes.list();
    await client.methods.list({ query: { page: 1, limit: 20 } });
    await client.standards.list({ query: { page: 1, limit: 20 } });
    await client.environmentalLimits.list();
    await client.jobs.list({ query: { page: 1, limit: 20 } });
    await client.serviceOrders.list({ query: { page: 1, limit: 20 } });

    expect(fetchCalls.map(([input]) => String(input))).toEqual([
      "http://127.0.0.1:4317/api/local/session",
      "https://api.example.test/api/customers?page=1&limit=20",
      "https://api.example.test/api/assets?page=1&limit=20",
      "https://api.example.test/api/asset-types",
      "https://api.example.test/api/methods?page=1&limit=20",
      "https://api.example.test/api/standards?page=1&limit=20",
      "https://api.example.test/api/environmental-limits",
      "https://api.example.test/api/jobs?page=1&limit=20",
      "https://api.example.test/api/service-orders?page=1&limit=20",
    ]);
  });

  it("routes all approved operational reads to local cache after bootstrap", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);
      const url = new URL(String(input));

      if (
        url.origin === "http://127.0.0.1:4317" &&
        url.pathname === "/api/local/session"
      ) {
        return Response.json({
          data: {
            serverTime: "2026-05-09T12:00:00.000Z",
            user: { id: "user-1", name: "Ana", email: "ana@example.test" },
            organization: { id: "org-1", type: "laboratory" },
            activeUnits: [
              { id: 10, name: "Laboratorio Central", role: "admin" },
            ],
            permissions: {
              role: "admin",
              unitRole: null,
              activeUnitId: 10,
              accessibleUnitIds: [10],
              canAccessAllUnits: false,
            },
            featureFlags: {
              offlineApprovals: false,
              offlineCertificatePublication: false,
            },
            syncCursor: "cursor-1",
            publishedMethods: [],
            assetTypes: [],
            customers: [],
            assets: [],
            services: [],
            standards: [],
            environmentalLimits: [],
            jobs: [],
            serviceOrders: [],
          },
        });
      }

      if (
        url.origin === "http://127.0.0.1:4317" &&
        url.pathname === "/api/local/sync/retry"
      ) {
        return Response.json({ ok: true });
      }

      if (url.origin !== "http://127.0.0.1:4317") {
        throw new Error(`Unexpected cloud request: ${url.toString()}`);
      }

      if (url.pathname === "/api/service-orders/service-order-1") {
        return Response.json({ data: buildServiceOrderDetail() });
      }
      if (url.pathname === "/api/customers/1") {
        return Response.json(buildCustomerDetail());
      }
      if (url.pathname === "/api/methods/1") {
        return Response.json({
          ...storedMethod({ id: 1 }),
          assetTypeName: null,
          methodEngine: null,
          compiledMethod: null,
          publicationEvidence: null,
        });
      }
      if (url.pathname === "/api/assets/1") {
        return Response.json(buildAssetDetail());
      }
      if (url.pathname === "/api/standards/1") {
        return Response.json(buildStandard());
      }
      if (url.pathname === "/api/jobs/job-1") {
        return Response.json(buildJobDetail());
      }

      return Response.json({
        id: url.pathname.split("/").at(-1),
        data: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
        limits: null,
        source: null,
      });
    };
    const client = createDesktopHybridApiClient({
      cloud: {
        baseUrl: "https://api.example.test",
        fetch: fetchMock,
      },
      local: {
        baseUrl: "http://127.0.0.1:4317",
        tokenProvider: () => "local-token",
        fetch: fetchMock,
      },
    });

    await client.customers.list({ query: { page: 1, limit: 20 } });
    await client.customers.get({ params: { id: 1 } });
    await client.assets.list({ query: { page: 1, limit: 20 } });
    await client.assets.get({ params: { id: 1 } });
    await client.assetTypes.list();
    await client.methods.list({ query: { page: 1, limit: 20 } });
    await client.methods.get({ params: { id: 1 } });
    await client.standards.list({ query: { page: 1, limit: 20 } });
    await client.standards.get({ params: { id: 1 } });
    await client.environmentalLimits.list();
    await client.jobs.list({ query: { page: 1, limit: 20 } });
    await client.jobs.get({ params: { id: "job-1" } });
    await client.standards.list({ query: { status: "ACTIVE", limit: 100 } });
    await client.environmentalLimits.effective({
      params: { assetTypeId: 1 },
      query: { unitId: "10" },
    });
    await client.serviceOrders.list({ query: { page: 1, limit: 20 } });
    await client.serviceOrders.get({ params: { id: "service-order-1" } });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchCalls.map(([input]) => String(input))).toEqual([
      "http://127.0.0.1:4317/api/local/session",
      "http://127.0.0.1:4317/api/customers?page=1&limit=20",
      "http://127.0.0.1:4317/api/local/sync/retry",
      "http://127.0.0.1:4317/api/customers/1",
      "http://127.0.0.1:4317/api/assets?page=1&limit=20",
      "http://127.0.0.1:4317/api/assets/1",
      "http://127.0.0.1:4317/api/asset-types",
      "http://127.0.0.1:4317/api/methods?page=1&limit=20",
      "http://127.0.0.1:4317/api/methods/1",
      "http://127.0.0.1:4317/api/standards?page=1&limit=20",
      "http://127.0.0.1:4317/api/standards/1",
      "http://127.0.0.1:4317/api/jobs?page=1&limit=20",
      "http://127.0.0.1:4317/api/jobs/job-1",
      "http://127.0.0.1:4317/api/standards?status=ACTIVE&limit=100",
      "http://127.0.0.1:4317/api/environmental-limits/effective/1?unitId=10",
      "http://127.0.0.1:4317/api/service-orders?page=1&limit=20",
      "http://127.0.0.1:4317/api/service-orders/service-order-1",
    ]);
  });

  it("uses bootstrapped local cache first for approved operational reads", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);
      const url = new URL(String(input));

      if (
        url.origin === "http://127.0.0.1:4317" &&
        url.pathname === "/api/local/session"
      ) {
        return Response.json({
          data: {
            serverTime: "2026-05-09T12:00:00.000Z",
            user: { id: "user-1", name: "Ana", email: "ana@example.test" },
            organization: { id: "org-1", type: "laboratory" },
            activeUnits: [],
            permissions: {
              role: "admin",
              unitRole: null,
              activeUnitId: null,
              accessibleUnitIds: [],
              canAccessAllUnits: false,
            },
            featureFlags: {
              offlineApprovals: false,
              offlineCertificatePublication: false,
            },
            syncCursor: "cursor-1",
            publishedMethods: [],
            assetTypes: [],
            customers: [],
            assets: [],
            services: [],
            standards: [],
            environmentalLimits: [],
            jobs: [],
            serviceOrders: [],
          },
        });
      }

      if (
        url.origin === "http://127.0.0.1:4317" &&
        url.pathname === "/api/standards"
      ) {
        return Response.json({
          data: [
            buildStandard({
              id: 2,
              name: "Peso local 10 kg",
              serialNumber: "STD-10KG",
              certificateNumber: "CERT-LOCAL",
              nextCalibrationDate: "2026-12-31",
              status: "ACTIVE",
              isExpired: false,
            }),
          ],
          pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
        });
      }

      if (
        url.origin === "http://127.0.0.1:4317" &&
        url.pathname === "/api/local/sync/retry"
      ) {
        return Response.json({ ok: true });
      }

      throw new Error(`Unexpected request: ${url.toString()}`);
    };
    const client = createDesktopHybridApiClient({
      cloud: {
        baseUrl: "https://api.example.test",
        fetch: fetchMock,
      },
      local: {
        baseUrl: "http://127.0.0.1:4317",
        tokenProvider: () => "local-token",
        fetch: fetchMock,
      },
    });

    await expect(
      client.standards.list({ query: { page: 1, limit: 20 } }),
    ).resolves.toMatchObject({
      data: [{ name: "Peso local 10 kg" }],
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchCalls.map(([input]) => String(input))).toEqual([
      "http://127.0.0.1:4317/api/local/session",
      "http://127.0.0.1:4317/api/standards?page=1&limit=20",
      "http://127.0.0.1:4317/api/local/sync/retry",
    ]);
  });

  it("does not use local reads before a completed bootstrap cursor exists", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const cloudError = new TypeError("fetch failed");
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);
      const url = new URL(String(input));

      if (
        url.origin === "https://api.example.test" &&
        url.pathname === "/api/standards"
      ) {
        throw cloudError;
      }

      if (
        url.origin === "http://127.0.0.1:4317" &&
        url.pathname === "/api/local/session"
      ) {
        return Response.json({
          data: {
            serverTime: "2026-05-09T12:00:00.000Z",
            user: { id: "user-1", name: "Ana", email: "ana@example.test" },
            organization: { id: "org-1", type: "laboratory" },
            activeUnits: [],
            permissions: {
              role: "admin",
              unitRole: null,
              activeUnitId: null,
              accessibleUnitIds: [],
              canAccessAllUnits: false,
            },
            featureFlags: {
              offlineApprovals: false,
              offlineCertificatePublication: false,
            },
            syncCursor: null,
            publishedMethods: [],
            assetTypes: [],
            customers: [],
            assets: [],
            services: [],
            standards: [],
            environmentalLimits: [],
            jobs: [],
            serviceOrders: [],
          },
        });
      }

      throw new Error(`Unexpected request: ${url.toString()}`);
    };
    const client = createDesktopHybridApiClient({
      cloud: {
        baseUrl: "https://api.example.test",
        fetch: fetchMock,
      },
      local: {
        baseUrl: "http://127.0.0.1:4317",
        tokenProvider: () => "local-token",
        fetch: fetchMock,
      },
    });

    await expect(
      client.standards.list({ query: { page: 1, limit: 20 } }),
    ).rejects.toThrow("cache local");

    expect(fetchCalls.map(([input]) => String(input))).toEqual([
      "http://127.0.0.1:4317/api/local/session",
      "https://api.example.test/api/standards?page=1&limit=20",
    ]);
  });

  it("does not use local fallback for cloud authorization failures", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);
      const url = new URL(String(input));

      if (
        url.origin === "http://127.0.0.1:4317" &&
        url.pathname === "/api/local/session"
      ) {
        return Response.json({
          data: {
            serverTime: "2026-05-09T12:00:00.000Z",
            user: { id: "user-1", name: "Ana", email: "ana@example.test" },
            organization: { id: "org-1", type: "laboratory" },
            activeUnits: [],
            permissions: {
              role: "admin",
              unitRole: null,
              activeUnitId: null,
              accessibleUnitIds: [],
              canAccessAllUnits: false,
            },
            featureFlags: {
              offlineApprovals: false,
              offlineCertificatePublication: false,
            },
            syncCursor: null,
            publishedMethods: [],
            assetTypes: [],
            customers: [],
            assets: [],
            services: [],
            standards: [],
            environmentalLimits: [],
            jobs: [],
            serviceOrders: [],
          },
        });
      }

      if (
        url.origin === "https://api.example.test" &&
        url.pathname === "/api/standards"
      ) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }

      throw new Error(`Unexpected request: ${url.toString()}`);
    };
    const client = createDesktopHybridApiClient({
      cloud: {
        baseUrl: "https://api.example.test",
        fetch: fetchMock,
      },
      local: {
        baseUrl: "http://127.0.0.1:4317",
        tokenProvider: () => "local-token",
        fetch: fetchMock,
      },
    });

    await expect(
      client.standards.list({ query: { page: 1, limit: 20 } }),
    ).rejects.toThrow("Unauthorized");

    expect(fetchCalls.map(([input]) => String(input))).toEqual([
      "http://127.0.0.1:4317/api/local/session",
      "https://api.example.test/api/standards?page=1&limit=20",
    ]);
  });
});

describe("environmental limits runtime adapter", () => {
  it("routes environmental settings through the cloud API", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const limit = {
      id: 15,
      unitId: 10,
      assetTypeId: null,
      assetTypeName: null,
      temperatureMin: 18,
      temperatureMax: 24,
      humidityMin: 40,
      humidityMax: 60,
      pressureMin: null,
      pressureMax: null,
      createdAt: "2026-01-12T12:00:00.000Z",
      updatedAt: "2026-01-12T12:00:00.000Z",
    };
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);

      if (init?.method === "PUT") {
        return Response.json({
          message: "Limites ambientais atualizados",
          data: limit,
          unit: { unitId: 10, unitName: "Central" },
        });
      }

      if (init?.method === "DELETE") {
        return Response.json({ message: "Limites removidos" });
      }

      return Response.json({
        limits: [limit],
        unit: { unitId: 10, unitName: "Central" },
      });
    };
    const client = createCloudApiClient({
      baseUrl: "https://api.example.test",
      fetch: fetchMock,
    });

    await expect(client.environmentalLimits.list()).resolves.toMatchObject({
      limits: [{ id: 15, temperatureMin: 18 }],
    });
    await expect(
      client.environmentalLimits.save({
        body: {
          assetTypeId: null,
          temperatureMin: 18,
          temperatureMax: 24,
          humidityMin: 40,
          humidityMax: 60,
          pressureMin: null,
          pressureMax: null,
        },
      }),
    ).resolves.toMatchObject({
      message: "Limites ambientais atualizados",
      data: { id: 15 },
    });
    await expect(
      client.environmentalLimits.delete({ params: { id: 15 } }),
    ).resolves.toEqual({
      message: "Limites removidos",
    });

    expect(fetchCalls.map(([input]) => String(input))).toEqual([
      "https://api.example.test/api/environmental-limits",
      "https://api.example.test/api/environmental-limits",
      "https://api.example.test/api/environmental-limits/15",
    ]);
  });

  it("reads desktop environmental limits from the local session", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);
      return Response.json({
        data: {
          serverTime: "2026-05-09T12:00:00.000Z",
          user: { id: "user-1", name: "Ana", email: "ana@example.test" },
          organization: { id: "org-1", type: "laboratory" },
          activeUnits: [{ id: 10, name: "Central", role: "unit_admin" }],
          permissions: {
            role: "member",
            unitRole: "unit_admin",
            activeUnitId: 10,
            accessibleUnitIds: [10],
            canAccessAllUnits: false,
          },
          featureFlags: {
            offlineApprovals: false,
            offlineCertificatePublication: false,
          },
          syncCursor: "cursor-1",
          publishedMethods: [],
          assetTypes: [],
          customers: [],
          assets: [],
          services: [],
          standards: [],
          environmentalLimits: [
            {
              id: 15,
              unitId: 10,
              assetTypeId: null,
              temperatureMin: 18,
              temperatureMax: 24,
            },
          ],
          jobs: [],
          serviceOrders: [],
        },
      });
    };
    const client = createDesktopApiClient({
      baseUrl: "http://127.0.0.1:4317",
      tokenProvider: () => "local-token",
      fetch: fetchMock,
    });

    await expect(client.environmentalLimits.list()).resolves.toMatchObject({
      limits: [{ id: 15, unitId: 10, temperatureMax: 24 }],
      unit: { unitId: 10, unitName: "Central" },
    });
    await expect(
      client.environmentalLimits.save({
        body: {
          assetTypeId: null,
          temperatureMin: null,
          temperatureMax: null,
          humidityMin: null,
          humidityMax: null,
          pressureMin: null,
          pressureMax: null,
        },
      }),
    ).rejects.toThrow("Limites ambientais requer a API web/nuvem");
    expect(String(fetchCalls[0]?.[0])).toBe(
      "http://127.0.0.1:4317/api/local/session",
    );
  });

  it("shares desktop local session reads across adapters", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);
      return Response.json({
        data: {
          serverTime: "2026-05-09T12:00:00.000Z",
          user: { id: "user-1", name: "Ana", email: "ana@example.test" },
          organization: { id: "org-1", type: "laboratory" },
          activeUnits: [{ id: 10, name: "Central", role: "unit_admin" }],
          permissions: {
            role: "member",
            unitRole: "unit_admin",
            activeUnitId: 10,
            accessibleUnitIds: [10],
            canAccessAllUnits: false,
          },
          featureFlags: {
            offlineApprovals: false,
            offlineCertificatePublication: false,
          },
          syncCursor: "cursor-1",
          publishedMethods: [],
          assetTypes: [],
          customers: [],
          assets: [],
          services: [],
          standards: [],
          environmentalLimits: [],
          jobs: [],
          serviceOrders: [],
        },
      });
    };
    const client = createDesktopApiClient({
      baseUrl: "http://127.0.0.1:4317",
      tokenProvider: () => "local-token",
      fetch: fetchMock,
    });

    await Promise.all([
      client.sync.getSession(),
      client.units.getDashboardUnits(),
      client.environmentalLimits.list(),
    ]);

    expect(fetchCalls.map(([input]) => String(input))).toEqual([
      "http://127.0.0.1:4317/api/local/session",
    ]);
  });
});

describe("integrations runtime adapter", () => {
  it("reads, saves and removes the laboratory's Conta Azul application", async () => {
    const calls: Array<{ method: string; url: string; body: unknown }> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      const method = init?.method ?? "GET";
      const body =
        typeof init?.body === "string" ? JSON.parse(init.body) : null;
      calls.push({ method, url: String(input), body });

      if (method === "PUT" && body?.clientSecret === "wrong-secret") {
        return Response.json(
          {
            error: "O Conta Azul recusou este Client ID e Client Secret.",
            check: "rejected",
          },
          { status: 422 },
        );
      }
      if (method === "PUT")
        return Response.json(buildContaAzulAppSaveResponse());
      return Response.json(
        buildContaAzulAppSummary(
          method === "DELETE"
            ? { source: null, clientId: null, clientSecretLast4: null }
            : {},
        ),
      );
    };
    const client = createCloudApiClient({
      baseUrl: "https://api.example.test",
      fetch: fetchMock,
    });

    await expect(client.integrations.getContaAzulApp()).resolves.toEqual(
      buildContaAzulAppSummary(),
    );
    await expect(
      client.integrations.saveContaAzulApp({
        body: { clientId: "client-id", clientSecret: "client-secret" },
      }),
    ).resolves.toEqual(buildContaAzulAppSaveResponse());
    await expect(
      client.integrations.saveContaAzulApp({
        body: { clientId: "client-id", clientSecret: "wrong-secret" },
      }),
    ).rejects.toThrow("O Conta Azul recusou este Client ID e Client Secret.");
    await expect(
      client.integrations.removeContaAzulApp(),
    ).resolves.toMatchObject({ source: null });

    expect(calls.map((call) => [call.method, call.url])).toEqual([
      ["GET", "https://api.example.test/api/integrations/conta-azul/app"],
      ["PUT", "https://api.example.test/api/integrations/conta-azul/app"],
      ["PUT", "https://api.example.test/api/integrations/conta-azul/app"],
      ["DELETE", "https://api.example.test/api/integrations/conta-azul/app"],
    ]);
    expect(calls[1]?.body).toEqual({
      clientId: "client-id",
      clientSecret: "client-secret",
    });
  });

  it("routes integration operations through the cloud API", async () => {
    const calls: Array<{ method: string; url: string; body: unknown }> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      const path = url.pathname.replace("/api/integrations", "");
      const method = init?.method ?? "GET";
      const body =
        typeof init?.body === "string" ? JSON.parse(init.body) : null;
      calls.push({ method, url: `${url.pathname}${url.search}`, body });

      if (path === "/conta-azul/oauth/start") {
        return Response.json({
          authorizationUrl: "https://auth.example.test/oauth",
          expiresInSeconds: 600,
        });
      }
      if (path.includes("/conta-azul/catalog/")) {
        return Response.json(buildContaAzulCatalogResponse());
      }
      if (/\/conta-azul\/poll(-[a-z]+)?$/.test(path)) {
        return Response.json(buildContaAzulPollResult());
      }
      if (path.endsWith("/conta-azul/link-mdfe")) {
        return Response.json({ remoteEntityId: "MDFE-345345" });
      }
      if (path.endsWith("/conta-azul/schedule")) {
        return Response.json(buildContaAzulScheduleResponse());
      }
      if (path.endsWith("/conta-azul/refresh")) {
        return Response.json({
          success: true,
          accessTokenExpiresAt: "2026-02-01T12:00:00.000Z",
        });
      }
      if (
        path.endsWith("/conta-azul/disconnect") ||
        path.endsWith("/validate")
      ) {
        return Response.json({ success: true });
      }
      if (path.endsWith("/sync/preview")) {
        return Response.json(buildSyncPreviewResponse());
      }
      if (path.endsWith("/runs/run-1/items")) {
        return Response.json(buildIntegrationRunItemsResponse());
      }
      if (path.endsWith("/runs/run-1/retry")) {
        return Response.json({
          success: true,
          queued: true,
          runId: "run-2",
          status: "PENDING",
        });
      }
      if (path.endsWith("/sync")) {
        return Response.json({
          success: true,
          queued: true,
          runId: "run-2",
          status: "PENDING",
          warnings: [],
        });
      }
      if (path === "/drift") {
        return Response.json(buildIntegrationDriftQueueResponse());
      }
      if (path.startsWith("/drift/")) {
        return Response.json({ data: { ok: true } });
      }
      return Response.json(buildIntegrationsResponse(), {
        status: method === "POST" && path === "" ? 201 : 200,
      });
    };
    const client = createCloudApiClient({
      baseUrl: "https://api.example.test",
      fetch: fetchMock,
    });
    const id = "integration-1";

    await expect(client.integrations.list()).resolves.toEqual(
      buildIntegrationsResponse(),
    );
    await expect(
      client.integrations.create({
        body: {
          name: "ERP financeiro",
          baseUrl: "https://erp.example.test",
          authToken: "token-12345678",
        },
      }),
    ).resolves.toEqual(buildIntegrationsResponse());
    await expect(
      client.integrations.startContaAzulOAuth({
        body: { returnTo: "/dashboard/settings/integrations" },
      }),
    ).resolves.toMatchObject({
      authorizationUrl: "https://auth.example.test/oauth",
    });
    await expect(
      client.integrations.validate({ params: { id } }),
    ).resolves.toEqual({ success: true });
    await expect(
      client.integrations.update({ params: { id }, body: { mappings: {} } }),
    ).resolves.toEqual(buildIntegrationsResponse());
    await expect(
      client.integrations.updateContaAzulConfig({
        params: { id },
        body: { defaultFinancialAccountId: "account-1" },
      }),
    ).resolves.toEqual(buildIntegrationsResponse());
    for (const catalog of [
      "accounts",
      "balances",
      "categories",
      "cost-centers",
      "product-categories",
      "product-cest",
      "products",
      "product-ncm",
      "product-units",
      "product-ecommerce-categories",
      "product-ecommerce-brands",
      "services",
      "sellers",
      "dre-categories",
      "transfers",
    ] as const) {
      await expect(
        client.integrations.listContaAzulCatalog({ params: { id, catalog } }),
      ).resolves.toEqual(buildContaAzulCatalogResponse());
    }
    const poll = buildContaAzulPollResult();
    await expect(
      client.integrations.pollContaAzul({
        params: { id },
        body: { limit: 100 },
      }),
    ).resolves.toEqual(poll);
    await expect(
      client.integrations.pollContaAzulFiscal({
        params: { id },
        body: { limit: 100 },
      }),
    ).resolves.toEqual(poll);
    await expect(
      client.integrations.linkContaAzulInvoicesToMdfe({
        params: { id },
        body: {
          externalId: "mdfe:1",
          fiscalDocumentAccessKeys: [
            "42250323643586000108550010000001151606401726",
          ],
          mdfeIdentifier: "MDFE-345345",
          status: "ENCERRADO",
        },
      }),
    ).resolves.toMatchObject({ remoteEntityId: "MDFE-345345" });
    await expect(
      client.integrations.pollContaAzulPayables({
        params: { id },
        body: { limit: 100 },
      }),
    ).resolves.toEqual(poll);
    await expect(
      client.integrations.pollContaAzulProtocols({
        params: { id },
        body: { limit: 100 },
      }),
    ).resolves.toEqual(poll);
    await expect(
      client.integrations.pollContaAzulDrift({
        params: { id },
        body: { limit: 100 },
      }),
    ).resolves.toEqual(poll);
    await expect(
      client.integrations.getContaAzulSchedule({ params: { id } }),
    ).resolves.toEqual(buildContaAzulScheduleResponse());
    await expect(
      client.integrations.refreshContaAzul({ params: { id } }),
    ).resolves.toMatchObject({ success: true });
    await expect(
      client.integrations.disconnectContaAzul({ params: { id } }),
    ).resolves.toEqual({ success: true });
    await expect(
      client.integrations.toggle({ params: { id }, body: { enabled: false } }),
    ).resolves.toEqual(buildIntegrationsResponse());
    await expect(
      client.integrations.previewSync({
        params: { id },
        body: { target: "customer" },
      }),
    ).resolves.toEqual(buildSyncPreviewResponse());
    await expect(
      client.integrations.sync({
        params: { id },
        body: { target: "customer" },
      }),
    ).resolves.toMatchObject({ queued: true });
    await expect(
      client.integrations.schedule({
        params: { id },
        body: { target: "customer", mode: "manual_only" },
      }),
    ).resolves.toEqual(buildIntegrationsResponse());
    await expect(
      client.integrations.listRunItems({ params: { id, runId: "run-1" } }),
    ).resolves.toEqual(buildIntegrationRunItemsResponse());
    await expect(
      client.integrations.retryRun({ params: { id, runId: "run-1" } }),
    ).resolves.toMatchObject({ queued: true });
    await expect(
      client.integrations.listDrift({ query: { target: "customer" } }),
    ).resolves.toEqual(buildIntegrationDriftQueueResponse());
    await expect(
      client.integrations.acknowledgeDrift({
        params: { linkId: "link-1" },
        body: { reason: "Registro removido de propósito" },
      }),
    ).resolves.toEqual({ data: { ok: true } });

    const requests = calls.map((call) => `${call.method} ${call.url}`);
    expect(requests.slice(0, 6)).toEqual([
      "GET /api/integrations",
      "POST /api/integrations",
      "POST /api/integrations/conta-azul/oauth/start",
      "POST /api/integrations/integration-1/validate",
      "PUT /api/integrations/integration-1",
      "PUT /api/integrations/integration-1/conta-azul/config",
    ]);
    expect(requests).toContain(
      "GET /api/integrations/integration-1/conta-azul/catalog/cost-centers",
    );
    expect(requests).toContain(
      "GET /api/integrations/integration-1/conta-azul/catalog/product-ecommerce-brands",
    );
    expect(requests.slice(21)).toEqual([
      "POST /api/integrations/integration-1/conta-azul/poll",
      "POST /api/integrations/integration-1/conta-azul/poll-fiscal",
      "POST /api/integrations/integration-1/conta-azul/link-mdfe",
      "POST /api/integrations/integration-1/conta-azul/poll-payables",
      "POST /api/integrations/integration-1/conta-azul/poll-protocols",
      "POST /api/integrations/integration-1/conta-azul/poll-drift",
      "GET /api/integrations/integration-1/conta-azul/schedule",
      "POST /api/integrations/integration-1/conta-azul/refresh",
      "POST /api/integrations/integration-1/conta-azul/disconnect",
      "POST /api/integrations/integration-1/toggle",
      "POST /api/integrations/integration-1/sync/preview",
      "POST /api/integrations/integration-1/sync",
      "POST /api/integrations/integration-1/schedule",
      "GET /api/integrations/integration-1/runs/run-1/items",
      "POST /api/integrations/integration-1/runs/run-1/retry",
      "GET /api/integrations/drift?target=customer",
      "POST /api/integrations/drift/link-1/acknowledge",
    ]);
  });

  it("refuses a body that is not the contract's", async () => {
    const client = createCloudApiClient({
      baseUrl: "https://api.example.test",
      fetch: async () => Response.json({ source: "organization" }),
    });

    await expect(client.integrations.getContaAzulApp()).rejects.toThrow();
  });

  it("keeps integration mutations cloud-only in the desktop adapter", async () => {
    const client = createDesktopApiClient({
      baseUrl: "http://127.0.0.1:4317",
      fetch: async () => {
        throw new Error("fetch should not be called");
      },
    });
    const params = { id: "integration-1" };
    const message = "Integrações requer a API web/nuvem";

    await expect(client.integrations.list()).resolves.toEqual({ data: [] });
    await expect(
      client.integrations.create({
        body: {
          name: "ERP financeiro",
          baseUrl: "https://erp.example.test",
          authToken: "token-12345678",
        },
      }),
    ).rejects.toThrow(message);
    await expect(
      client.integrations.startContaAzulOAuth({ body: {} }),
    ).rejects.toThrow(message);
    await expect(
      client.integrations.updateContaAzulConfig({ params, body: {} }),
    ).rejects.toThrow(message);
    await expect(
      client.integrations.listContaAzulCatalog({
        params: { ...params, catalog: "accounts" },
      }),
    ).rejects.toThrow(message);
    await expect(
      client.integrations.pollContaAzul({ params, body: {} }),
    ).rejects.toThrow(message);
    await expect(
      client.integrations.getContaAzulSchedule({ params }),
    ).rejects.toThrow(message);
    await expect(
      client.integrations.refreshContaAzul({ params }),
    ).rejects.toThrow(message);
    await expect(
      client.integrations.disconnectContaAzul({ params }),
    ).rejects.toThrow(message);
    await expect(
      client.integrations.listRunItems({
        params: { ...params, runId: "run-1" },
      }),
    ).rejects.toThrow(message);
  });
});

describe("certificate numbering runtime adapter", () => {
  it("loads and updates certificate numbering through the cloud API", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const profile = {
      id: 12,
      name: "Padrao",
      config: {
        labCode: "LAB",
        projectCode: null,
        numberTemplate: "{labCode}-{yyyy}-{seq}",
        certificateNameTemplate: "Certificado {number}",
        sequence: {
          resetScope: "year" as const,
          startAt: 1,
          increment: 1,
          padding: 4,
        },
      },
      createdAt: "2026-05-09T12:00:00.000Z",
      updatedAt: "2026-05-09T12:00:00.000Z",
    };
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);

      if (init?.method === "PUT") {
        return Response.json({
          message: "Perfil de numeracao atualizado",
          profile,
        });
      }

      return Response.json({
        profile,
        example: {
          number: "LAB-2026-0123",
          name: "Certificado LAB-2026-0123",
          sequenceKey: "year:2026",
        },
        supportedTokens: ["{labCode}", "{yyyy}", "{seq}", "{number}"],
      });
    };
    const client = createCloudApiClient({
      baseUrl: "https://api.example.test",
      fetch: fetchMock,
    });

    await expect(
      client.certificateNumbering.getProfile(),
    ).resolves.toMatchObject({
      profile: { id: 12, config: { labCode: "LAB" } },
      example: { number: "LAB-2026-0123" },
    });
    await expect(
      client.certificateNumbering.updateProfile({
        body: { name: "Padrao", config: profile.config },
      }),
    ).resolves.toMatchObject({
      message: "Perfil de numeracao atualizado",
      profile: { id: 12 },
    });

    expect(fetchCalls.map(([input]) => String(input))).toEqual([
      "https://api.example.test/api/certificate-numbering",
      "https://api.example.test/api/certificate-numbering",
    ]);
    expect(fetchCalls[1]?.[1]?.method).toBe("PUT");
  });

  it("exposes a read-only desktop certificate numbering profile", async () => {
    const client = createDesktopApiClient({
      baseUrl: "http://127.0.0.1:4317",
      fetch: async () => {
        throw new Error("fetch should not be called");
      },
    });

    await expect(
      client.certificateNumbering.getProfile(),
    ).resolves.toMatchObject({
      profile: { id: null, config: { labCode: "CAL" } },
      example: { number: "CAL-2026-0123" },
    });
    await expect(
      client.certificateNumbering.updateProfile({
        body: {
          name: "Padrao",
          config: {
            labCode: "LAB",
            projectCode: null,
            numberTemplate: "{labCode}-{yyyy}-{seq}",
            certificateNameTemplate: "Certificado {number}",
            sequence: {
              resetScope: "year",
              startAt: 1,
              increment: 1,
              padding: 4,
            },
          },
        },
      }),
    ).rejects.toThrow("Numeração de certificados requer a API web/nuvem");
  });
});

describe("portal domains runtime adapter", () => {
  it("routes portal domain operations through the cloud API", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const payload = {
      portalBaseUrl: "https://portal.example.test",
      domain: {
        id: "domain-1",
        hostname: "portal.lab.example.test",
        verifiedAt: null,
        activatedAt: null,
        lastVerifiedAt: null,
        isActive: false,
        verification: {
          type: "TXT" as const,
          host: "_calibrafacil.portal.lab.example.test",
          value: "verify-token",
        },
      },
      statusSummary: {
        status: "waiting_dns" as const,
        readiness: "not_ready" as const,
        canActivate: false,
        message: "Aguardando DNS",
        diagnostics: {
          host: "_calibrafacil.portal.lab.example.test",
          expectedValue: "verify-token",
          observedValues: [],
        },
      },
    };
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);

      if (init?.method === "DELETE") {
        return Response.json({ success: true });
      }

      return Response.json(payload);
    };
    const client = createCloudApiClient({
      baseUrl: "https://api.example.test",
      fetch: fetchMock,
    });

    await expect(client.portalDomains.get()).resolves.toMatchObject({
      domain: { hostname: "portal.lab.example.test" },
    });
    await expect(
      client.portalDomains.create({
        body: { hostname: "portal.lab.example.test" },
      }),
    ).resolves.toMatchObject({ domain: { id: "domain-1" } });
    await expect(client.portalDomains.verify()).resolves.toMatchObject({
      statusSummary: { status: "waiting_dns" },
    });
    await expect(client.portalDomains.activate()).resolves.toMatchObject({
      portalBaseUrl: "https://portal.example.test",
    });
    await expect(client.portalDomains.delete()).resolves.toEqual({
      success: true,
    });

    expect(fetchCalls.map(([input]) => String(input))).toEqual([
      "https://api.example.test/api/portal-domains",
      "https://api.example.test/api/portal-domains",
      "https://api.example.test/api/portal-domains/verify",
      "https://api.example.test/api/portal-domains/activate",
      "https://api.example.test/api/portal-domains",
    ]);
  });

  it("keeps portal domain mutations cloud-only in the desktop adapter", async () => {
    const client = createDesktopApiClient({
      baseUrl: "http://127.0.0.1:4317",
      fetch: async () => {
        throw new Error("fetch should not be called");
      },
    });

    await expect(client.portalDomains.get()).resolves.toMatchObject({
      domain: null,
      statusSummary: { status: "not_configured" },
    });
    await expect(
      client.portalDomains.create({
        body: { hostname: "portal.lab.example.test" },
      }),
    ).rejects.toThrow("Domínio do portal requer a API web/nuvem");
    await expect(client.portalDomains.verify()).rejects.toThrow(
      "Domínio do portal requer a API web/nuvem",
    );
    await expect(client.portalDomains.activate()).rejects.toThrow(
      "Domínio do portal requer a API web/nuvem",
    );
    await expect(client.portalDomains.delete()).rejects.toThrow(
      "Domínio do portal requer a API web/nuvem",
    );
  });
});

describe("email domains runtime adapter", () => {
  it("routes email-domain operations through the cloud API", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const payload = {
      domain: {
        id: "emaildom-1",
        mode: "byok" as const,
        hostname: "mail.lab.example.test",
        fromAddress: "os@mail.lab.example.test",
        status: "verified",
        verifiedAt: null,
        lastVerifiedAt: null,
        activatedAt: null,
        isActive: false,
        keyStatus: "ok" as const,
        keyLastError: null,
        apiKeyMasked: "\u2022\u2022\u2022\u20221234",
        dnsRecords: [],
        createdAt: "2026-07-15T00:00:00.000Z",
      },
      statusSummary: {
        status: "verified" as const,
        canActivate: true,
        message: "Pronto para ativar",
        keyHealth: { status: "ok" as const, lastError: null },
      },
    };
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);

      if (init?.method === "DELETE") {
        return Response.json({ success: true });
      }

      return Response.json(payload);
    };
    const client = createCloudApiClient({
      baseUrl: "https://api.example.test",
      fetch: fetchMock,
    });

    await expect(client.emailDomains.get()).resolves.toMatchObject({
      domain: { hostname: "mail.lab.example.test" },
    });
    await expect(
      client.emailDomains.create({
        body: {
          hostname: "mail.lab.example.test",
          fromLocalPart: "os",
        },
      }),
    ).resolves.toMatchObject({ domain: { id: "emaildom-1" } });
    await expect(client.emailDomains.verify()).resolves.toMatchObject({
      statusSummary: { status: "verified" },
    });
    await expect(client.emailDomains.activate()).resolves.toMatchObject({
      statusSummary: { canActivate: true },
    });
    await expect(client.emailDomains.delete()).resolves.toEqual({
      success: true,
    });

    expect(fetchCalls.map(([input]) => String(input))).toEqual([
      "https://api.example.test/api/email-domains",
      "https://api.example.test/api/email-domains",
      "https://api.example.test/api/email-domains/verify",
      "https://api.example.test/api/email-domains/activate",
      "https://api.example.test/api/email-domains",
    ]);
  });

  it("keeps email-domain mutations cloud-only in the desktop adapter", async () => {
    const client = createDesktopApiClient({
      baseUrl: "http://127.0.0.1:4317",
      fetch: async () => {
        throw new Error("fetch should not be called");
      },
    });

    await expect(client.emailDomains.get()).resolves.toMatchObject({
      domain: null,
      statusSummary: { status: "not_configured" },
    });
    await expect(
      client.emailDomains.create({
        body: {
          hostname: "mail.lab.example.test",
          fromLocalPart: "os",
        },
      }),
    ).rejects.toThrow("Domínio de e-mail requer a API web/nuvem");
    await expect(client.emailDomains.verify()).rejects.toThrow(
      "Domínio de e-mail requer a API web/nuvem",
    );
    await expect(client.emailDomains.activate()).rejects.toThrow(
      "Domínio de e-mail requer a API web/nuvem",
    );
    await expect(client.emailDomains.delete()).rejects.toThrow(
      "Domínio de e-mail requer a API web/nuvem",
    );
  });
});

describe("notifications runtime adapter", () => {
  it("forwards unread filtering and pagination to the API", async () => {
    let requestUrl = "";
    const client = createCloudApiClient({
      baseUrl: "https://api.example.test",
      fetch: async (input) => {
        requestUrl = String(input);
        return Response.json({ data: [] });
      },
    });
    await client.notifications.listRecent({
      query: {
        page: 2,
        limit: 15,
        status: "UNREAD",
      },
    });
    const url = new URL(requestUrl);
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.get("limit")).toBe("15");
    expect(url.searchParams.get("status")).toBe("UNREAD");
  });

  it("routes notification operations through the cloud API", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);
      const url = String(input);

      if (url.endsWith("/api/notifications/unread-count")) {
        return Response.json({ count: 3 });
      }

      if (url.includes("/api/notifications?page=1&limit=5")) {
        return Response.json({
          data: [
            {
              id: 1,
              type: "JOB_ASSIGNED",
              priority: "NORMAL",
              status: "UNREAD",
              title: "Job atribuido",
              message: "Um job foi atribuido a voce.",
              actionUrl: "/dashboard/jobs/1",
              createdAt: "2026-05-09T12:00:00.000Z",
            },
          ],
          pagination: {
            page: 1,
            limit: 5,
            total: 1,
            totalPages: 1,
          },
        });
      }

      if (url.endsWith("/api/notifications/mark-read")) {
        return Response.json({
          message: "1 notificacao(oes) marcada(s) como lida(s)",
          updatedIds: [1],
        });
      }

      if (url.endsWith("/api/notifications/preferences")) {
        if (init?.method === "PUT") {
          return Response.json({
            preferences: {
              JOB_ASSIGNED: { inApp: true, email: false },
            },
            emailEnabled: false,
            notifySelfActions: true,
            digestFrequency: "NONE",
          });
        }

        return Response.json({
          preferences: {},
          emailEnabled: true,
          notifySelfActions: false,
          digestFrequency: "NONE",
        });
      }

      return Response.json({
        message: "1 notificacao(oes) marcada(s) como lida(s)",
        count: 1,
      });
    };
    const client = createCloudApiClient({
      baseUrl: "https://api.example.test",
      fetch: fetchMock,
    });

    await expect(client.notifications.getUnreadCount()).resolves.toEqual({
      count: 3,
    });
    await expect(
      client.notifications.listRecent({ query: { page: 1, limit: 5 } }),
    ).resolves.toMatchObject({ data: [{ id: 1, status: "UNREAD" }] });
    await expect(
      client.notifications.markRead({ body: { notificationIds: [1] } }),
    ).resolves.toMatchObject({
      updatedIds: [1],
    });
    await expect(client.notifications.markAllRead()).resolves.toMatchObject({
      count: 1,
    });
    await expect(client.notifications.getPreferences()).resolves.toMatchObject({
      emailEnabled: true,
      digestFrequency: "NONE",
    });
    await expect(
      client.notifications.updatePreferences({
        body: {
          emailEnabled: false,
          notifySelfActions: true,
        },
      }),
    ).resolves.toMatchObject({
      emailEnabled: false,
      notifySelfActions: true,
    });

    expect(fetchCalls.map(([input]) => String(input))).toEqual([
      "https://api.example.test/api/notifications/unread-count",
      "https://api.example.test/api/notifications?page=1&limit=5",
      "https://api.example.test/api/notifications/mark-read",
      "https://api.example.test/api/notifications/mark-all-read",
      "https://api.example.test/api/notifications/preferences",
      "https://api.example.test/api/notifications/preferences",
    ]);
  });

  it("returns empty desktop notifications without calling fetch", async () => {
    const fetchMock: typeof fetch = async () => {
      throw new Error("fetch should not be called");
    };
    const client = createDesktopApiClient({
      baseUrl: "http://127.0.0.1:4317",
      fetch: fetchMock,
    });

    await expect(client.notifications.getUnreadCount()).resolves.toEqual({
      count: 0,
    });
    await expect(client.notifications.listRecent()).resolves.toMatchObject({
      data: [],
      pagination: { total: 0 },
    });
    await expect(
      client.notifications.markRead({ body: { notificationIds: [1] } }),
    ).resolves.toMatchObject({
      updatedIds: [],
    });
    await expect(client.notifications.markAllRead()).resolves.toMatchObject({
      count: 0,
    });
    await expect(client.notifications.getPreferences()).resolves.toMatchObject({
      preferences: {},
      emailEnabled: false,
    });
    await expect(
      client.notifications.updatePreferences({
        body: {
          emailEnabled: true,
        },
      }),
    ).resolves.toMatchObject({
      preferences: {},
      emailEnabled: true,
    });
  });
});

describe("signatures runtime adapter", () => {
  it("routes signature operations through the cloud API", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);

      if (init?.method === "POST") {
        return Response.json({
          message: "Assinatura enviada com sucesso",
          dimensions: { width: 400, height: 150 },
        });
      }

      if (init?.method === "DELETE") {
        return Response.json({ message: "Assinatura removida com sucesso" });
      }

      return Response.json({
        hasSignature: true,
        url: "https://files.example.test/signature.png",
        dimensions: { width: 400, height: 150 },
        uploadedAt: "2026-05-09T12:00:00.000Z",
      });
    };
    const client = createCloudApiClient({
      baseUrl: "https://api.example.test",
      activeUnitProvider: () => "10",
      fetch: fetchMock,
    });
    const signatureFile = new Blob(["png"], { type: "image/png" });

    await expect(client.signatures.getMine()).resolves.toMatchObject({
      hasSignature: true,
      url: "https://files.example.test/signature.png",
    });
    await expect(
      client.signatures.uploadMine(signatureFile, {
        fileName: "signature.png",
      }),
    ).resolves.toMatchObject({
      dimensions: { width: 400, height: 150 },
    });
    await expect(client.signatures.deleteMine()).resolves.toMatchObject({
      message: "Assinatura removida com sucesso",
    });

    expect(fetchCalls.map(([input]) => String(input))).toEqual([
      "https://api.example.test/api/signatures/my-signature",
      "https://api.example.test/api/signatures/my-signature",
      "https://api.example.test/api/signatures/my-signature",
    ]);
    expect(
      fetchCalls.map(([, init]) =>
        new Headers(init?.headers).get("x-active-unit-id"),
      ),
    ).toEqual(["10", "10", "10"]);
    expect(fetchCalls[1]?.[1]?.body).toBeInstanceOf(FormData);
    expect(formDataBody(fetchCalls[1]?.[1]).get("signature")).toBeInstanceOf(
      Blob,
    );
  });

  it("keeps visual signatures cloud-only in the desktop adapter", async () => {
    const fetchMock: typeof fetch = async () => {
      throw new Error("fetch should not be called");
    };
    const client = createDesktopApiClient({
      baseUrl: "http://127.0.0.1:4317",
      fetch: fetchMock,
    });

    await expect(client.signatures.getMine()).resolves.toEqual({
      hasSignature: false,
    });
    await expect(
      client.signatures.uploadMine(new Blob(["png"], { type: "image/png" })),
    ).rejects.toThrow("Assinatura visual requer sincronização com a nuvem");
    await expect(client.signatures.deleteMine()).rejects.toThrow(
      "Assinatura visual requer sincronização com a nuvem",
    );
  });
});

describe("profile media runtime adapter", () => {
  it("routes avatar media operations through the cloud API", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);

      if (init?.method === "DELETE") {
        return Response.json({ success: true });
      }

      return Response.json({
        imageUrl: "https://api.example.test/api/profile-media/avatar",
      });
    };
    const client = createCloudApiClient({
      baseUrl: "https://api.example.test",
      activeUnitProvider: () => "20",
      fetch: fetchMock,
    });
    const avatarFile = new Blob(["avatar"], { type: "image/webp" });

    await expect(
      client.profileMedia.uploadAvatar(avatarFile, {
        fileName: "avatar.webp",
      }),
    ).resolves.toEqual({
      imageUrl: "https://api.example.test/api/profile-media/avatar",
    });
    await expect(client.profileMedia.deleteAvatar()).resolves.toEqual({
      success: true,
    });

    expect(fetchCalls.map(([input]) => String(input))).toEqual([
      "https://api.example.test/api/profile-media/avatar",
      "https://api.example.test/api/profile-media/avatar",
    ]);
    expect(
      fetchCalls.map(([, init]) =>
        new Headers(init?.headers).get("x-active-unit-id"),
      ),
    ).toEqual(["20", "20"]);
    expect(fetchCalls[0]?.[1]?.body).toBeInstanceOf(FormData);
    expect(formDataBody(fetchCalls[0]?.[1]).get("avatar")).toBeInstanceOf(Blob);
  });

  it("keeps avatar media cloud-only in the desktop adapter", async () => {
    const fetchMock: typeof fetch = async () => {
      throw new Error("fetch should not be called");
    };
    const client = createDesktopApiClient({
      baseUrl: "http://127.0.0.1:4317",
      fetch: fetchMock,
    });

    await expect(
      client.profileMedia.uploadAvatar(
        new Blob(["avatar"], { type: "image/png" }),
      ),
    ).rejects.toThrow("Avatar requer sincronização com a nuvem");
    await expect(client.profileMedia.deleteAvatar()).rejects.toThrow(
      "Avatar requer sincronização com a nuvem",
    );
  });
});

describe("organization media runtime adapter", () => {
  it("routes organization logo media operations through the cloud API", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);

      if (init?.method === "DELETE") {
        return Response.json({ logoUrl: null });
      }

      return Response.json({
        logoUrl: "https://api.example.test/api/organization-media/logo",
      });
    };
    const client = createCloudApiClient({
      baseUrl: "https://api.example.test",
      activeUnitProvider: () => "20",
      fetch: fetchMock,
    });
    const logoFile = new Blob(["logo"], { type: "image/png" });

    await expect(
      client.organizationMedia.uploadLogo(logoFile, {
        fileName: "logo.png",
      }),
    ).resolves.toEqual({
      logoUrl: "https://api.example.test/api/organization-media/logo",
    });
    await expect(client.organizationMedia.deleteLogo()).resolves.toEqual({
      logoUrl: null,
    });

    expect(fetchCalls.map(([input]) => String(input))).toEqual([
      "https://api.example.test/api/organization-media/logo",
      "https://api.example.test/api/organization-media/logo",
    ]);
    expect(
      fetchCalls.map(([, init]) =>
        new Headers(init?.headers).get("x-active-unit-id"),
      ),
    ).toEqual(["20", "20"]);
    expect(fetchCalls[0]?.[1]?.body).toBeInstanceOf(FormData);
    expect(formDataBody(fetchCalls[0]?.[1]).get("logo")).toBeInstanceOf(Blob);
  });

  it("keeps organization logo media cloud-only in the desktop adapter", async () => {
    const fetchMock: typeof fetch = async () => {
      throw new Error("fetch should not be called");
    };
    const client = createDesktopApiClient({
      baseUrl: "http://127.0.0.1:4317",
      fetch: fetchMock,
    });

    await expect(
      client.organizationMedia.uploadLogo(
        new Blob(["logo"], { type: "image/png" }),
      ),
    ).rejects.toThrow("Logo da organização requer sincronização com a nuvem");
    await expect(client.organizationMedia.deleteLogo()).rejects.toThrow(
      "Logo da organização requer sincronização com a nuvem",
    );
  });
});

describe("signing certificates runtime adapter", () => {
  it("routes signing certificate operations through the cloud API", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      fetchCalls.push([input, init]);
      const url = String(input);

      if (url.endsWith("/set-default")) {
        return Response.json({ message: "Certificado definido como padrão" });
      }

      if (init?.method === "DELETE") {
        return Response.json({
          message: "Certificado revogado com sucesso",
        });
      }

      if (init?.method === "POST") {
        return Response.json({
          message: "Certificado adicionado com sucesso",
          certificate: {
            id: 1,
            unitId: 10,
            name: "Certificado Principal",
            serialNumber: "ABC123",
            issuerCn: "ICP-Brasil",
            subjectCn: "Calibra Facil",
            validFrom: "2026-01-01T00:00:00.000Z",
            validUntil: "2027-01-01T00:00:00.000Z",
            isDefault: true,
          },
        });
      }

      return Response.json({
        certificates: [
          {
            id: 1,
            unitId: 10,
            name: "Certificado Principal",
            serialNumber: "ABC123",
            issuerCn: "ICP-Brasil",
            subjectCn: "Calibra Facil",
            subjectCpfCnpj: null,
            validFrom: "2026-01-01T00:00:00.000Z",
            validUntil: "2027-01-01T00:00:00.000Z",
            isActive: true,
            isDefault: true,
            createdAt: "2026-01-01T00:00:00.000Z",
            createdByName: "Ana",
            revokedAt: null,
            revokedReason: null,
            status: "valid",
          },
        ],
        unit: { unitId: 10, unitName: "Matriz" },
        requireSignature: false,
        unsignedIssuance: { enabled: false, reason: null },
      });
    };
    const client = createCloudApiClient({
      baseUrl: "https://api.example.test",
      fetch: fetchMock,
    });

    await expect(client.signingCertificates.list()).resolves.toMatchObject({
      certificates: [{ id: 1, status: "valid" }],
    });
    await expect(
      client.signingCertificates.upload({
        body: {
          name: "Certificado Principal",
          p12Base64: "base64",
          password: "secret",
          setAsDefault: true,
        },
      }),
    ).resolves.toMatchObject({
      certificate: { id: 1, isDefault: true },
    });
    await expect(
      client.signingCertificates.setDefault({ params: { id: 1 } }),
    ).resolves.toEqual({
      message: "Certificado definido como padrão",
    });
    await expect(
      client.signingCertificates.revoke({
        params: { id: 1 },
        body: { reason: "Rotacao de certificado" },
      }),
    ).resolves.toEqual({
      message: "Certificado revogado com sucesso",
    });

    expect(fetchCalls.map(([input]) => String(input))).toEqual([
      "https://api.example.test/api/signing/certificates",
      "https://api.example.test/api/signing/certificates",
      "https://api.example.test/api/signing/certificates/1/set-default",
      "https://api.example.test/api/signing/certificates/1",
    ]);
  });

  it("keeps signing certificate mutations cloud-only in the desktop adapter", async () => {
    const fetchMock: typeof fetch = async () => {
      throw new Error("fetch should not be called");
    };
    const client = createDesktopApiClient({
      baseUrl: "http://127.0.0.1:4317",
      fetch: fetchMock,
    });

    await expect(client.signingCertificates.list()).resolves.toMatchObject({
      certificates: [],
    });
    await expect(
      client.signingCertificates.upload({
        body: {
          name: "Certificado",
          p12Base64: "base64",
          password: "secret",
          setAsDefault: true,
        },
      }),
    ).rejects.toThrow("Certificado ICP-Brasil requer sincronização");
    await expect(
      client.signingCertificates.setDefault({ params: { id: 1 } }),
    ).rejects.toThrow("Certificado ICP-Brasil requer sincronização");
    await expect(
      client.signingCertificates.revoke({
        params: { id: 1 },
        body: { reason: "Rotacao" },
      }),
    ).rejects.toThrow("Certificado ICP-Brasil requer sincronização");
  });
});
