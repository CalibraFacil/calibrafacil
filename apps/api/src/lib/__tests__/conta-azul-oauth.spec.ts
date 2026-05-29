import { describe, expect, it } from "vitest";
import {
  buildContaAzulAuthorizationUrl,
  buildContaAzulRefreshFailurePolicy,
  ContaAzulOAuthError,
  exchangeContaAzulAuthorizationCode,
  getContaAzulOAuthConfig,
  isContaAzulInvalidGrantError,
  parseContaAzulTokenBundle,
  refreshContaAzulAccessToken,
  serializeContaAzulTokenBundle,
  verifyContaAzulOAuthState,
} from "../conta-azul-oauth";
import type { ContaAzulOAuthConfig } from "../conta-azul-oauth";

const config: ContaAzulOAuthConfig = {
  clientId: "client-id",
  clientSecret: "client-secret",
  redirectUri:
    "https://api.example.com/api/integrations/conta-azul/oauth/callback",
  stateSecret: "state-secret",
};

const invalidGrantFetch: typeof fetch = async () =>
  Response.json(
    {
      error: "invalid_grant",
      error_description: "Refresh token has been revoked",
    },
    { status: 400 },
  );

describe("Conta Azul OAuth helpers", () => {
  it("builds an authorization URL with signed state bound to org/user/session", async () => {
    const now = new Date("2026-05-24T00:00:00.000Z");
    const result = await buildContaAzulAuthorizationUrl({
      config,
      organizationId: "org-1",
      userId: "user-1",
      sessionId: "session-1",
      returnTo: "/dashboard/settings/integrations",
      now,
    });
    const url = new URL(result.url);

    expect(url.origin + url.pathname).toBe("https://auth.contaazul.com/login");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUri);
    expect(url.searchParams.get("scope")).toBe(
      "openid profile aws.cognito.signin.user.admin",
    );

    await expect(
      verifyContaAzulOAuthState({
        state: result.state,
        stateSecret: config.stateSecret,
        now: new Date("2026-05-24T00:03:00.000Z"),
      }),
    ).resolves.toMatchObject({
      organizationId: "org-1",
      userId: "user-1",
      sessionId: "session-1",
      returnTo: "/dashboard/settings/integrations",
    });

    await expect(
      verifyContaAzulOAuthState({
        state: result.state,
        stateSecret: config.stateSecret,
        expectedOrganizationId: "org-1",
        expectedUserId: "user-1",
        expectedSessionId: "session-1",
        now: new Date("2026-05-24T00:03:00.000Z"),
      }),
    ).resolves.toMatchObject({
      organizationId: "org-1",
      userId: "user-1",
      sessionId: "session-1",
      returnTo: "/dashboard/settings/integrations",
    });
  });

  it("rejects tampered, mismatched, and expired state", async () => {
    const state = (
      await buildContaAzulAuthorizationUrl({
        config,
        organizationId: "org-1",
        userId: "user-1",
        sessionId: "session-1",
        now: new Date("2026-05-24T00:00:00.000Z"),
      })
    ).state;

    await expect(
      verifyContaAzulOAuthState({
        state: `${state}tampered`,
        stateSecret: config.stateSecret,
        expectedOrganizationId: "org-1",
        expectedUserId: "user-1",
        expectedSessionId: "session-1",
        now: new Date("2026-05-24T00:01:00.000Z"),
      }),
    ).rejects.toThrow("Estado OAuth inválido");

    await expect(
      verifyContaAzulOAuthState({
        state,
        stateSecret: config.stateSecret,
        expectedOrganizationId: "org-2",
        expectedUserId: "user-1",
        expectedSessionId: "session-1",
        now: new Date("2026-05-24T00:01:00.000Z"),
      }),
    ).rejects.toThrow("Estado OAuth não corresponde à sessão atual");

    await expect(
      verifyContaAzulOAuthState({
        state,
        stateSecret: config.stateSecret,
        expectedOrganizationId: "org-1",
        expectedUserId: "user-1",
        expectedSessionId: "session-1",
        now: new Date("2026-05-24T00:11:00.000Z"),
      }),
    ).rejects.toThrow("Estado OAuth expirado");
  });

  it("exchanges authorization codes with the documented token request shape", async () => {
    const requests: Array<{
      url: string;
      method: string | undefined;
      authorization: string | null;
      contentType: string | null;
      body: string;
    }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      requests.push({
        url: String(input),
        method: init?.method,
        authorization: headers.get("authorization"),
        contentType: headers.get("content-type"),
        body: String(init?.body),
      });
      return Response.json({
        access_token: "access-1",
        refresh_token: "refresh-1",
        expires_in: 3600,
        token_type: "Bearer",
      });
    };

    await expect(
      exchangeContaAzulAuthorizationCode(config, {
        code: "code-1",
        fetchImpl,
        now: new Date("2026-05-24T00:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      tokenType: "Bearer",
      expiresAt: "2026-05-24T01:00:00.000Z",
    });
    expect(requests).toEqual([
      {
        url: "https://auth.contaazul.com/oauth2/token",
        method: "POST",
        authorization: `Basic ${btoa("client-id:client-secret")}`,
        contentType: "application/x-www-form-urlencoded",
        body: `code=code-1&grant_type=authorization_code&redirect_uri=${encodeURIComponent(
          config.redirectUri,
        )}`,
      },
    ]);
  });

  it("refreshes access tokens and preserves the rotated refresh token", async () => {
    const requests: string[] = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      requests.push(String(init?.body));
      return Response.json({
        access_token: "access-2",
        refresh_token: "refresh-2",
        expires_in: 1800,
        token_type: "Bearer",
      });
    };

    await expect(
      refreshContaAzulAccessToken(config, {
        refreshToken: "refresh-1",
        fetchImpl,
        now: new Date("2026-05-24T00:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      accessToken: "access-2",
      refreshToken: "refresh-2",
      expiresAt: "2026-05-24T00:30:00.000Z",
    });
    expect(requests).toEqual([
      "refresh_token=refresh-1&grant_type=refresh_token",
    ]);
  });

  it("surfaces invalid refresh grants for reconnect handling", async () => {
    await expect(
      refreshContaAzulAccessToken(config, {
        refreshToken: "refresh-1",
        fetchImpl: invalidGrantFetch,
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: "invalid_grant",
    });

    try {
      await refreshContaAzulAccessToken(config, {
        refreshToken: "refresh-1",
        fetchImpl: invalidGrantFetch,
      });
      throw new Error("expected refresh to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ContaAzulOAuthError);
      expect(isContaAzulInvalidGrantError(error)).toBe(true);
    }
  });

  it("classifies refresh failures as action-required reconnect states", () => {
    expect(
      buildContaAzulRefreshFailurePolicy(
        new ContaAzulOAuthError({
          status: 400,
          code: "invalid_grant",
          description: "refresh-token-secret revoked",
        }),
      ),
    ).toEqual({
      status: "ACTION_REQUIRED",
      message:
        "Conta Azul revogou ou expirou o refresh token. Reconecte a integração.",
      reason: "invalid_grant",
    });

    expect(
      buildContaAzulRefreshFailurePolicy(
        new Error("upstream leaked token refresh-token-secret"),
      ),
    ).toEqual({
      status: "ACTION_REQUIRED",
      message:
        "Falha ao renovar token OAuth da Conta Azul. Reconecte a integração.",
      reason: "refresh_failed",
    });
  });

  it("serializes token bundles for encrypted storage without losing rotation data", () => {
    const serialized = serializeContaAzulTokenBundle({
      accessToken: "access-1",
      refreshToken: "refresh-2",
      tokenType: "Bearer",
      expiresIn: 3600,
      expiresAt: "2026-05-24T01:00:00.000Z",
      scopes: ["openid", "profile"],
    });

    expect(parseContaAzulTokenBundle(serialized)).toEqual({
      accessToken: "access-1",
      refreshToken: "refresh-2",
      tokenType: "Bearer",
      expiresIn: 3600,
      expiresAt: "2026-05-24T01:00:00.000Z",
      scopes: ["openid", "profile"],
    });
    expect(() => parseContaAzulTokenBundle("{}")).toThrow(
      "Credenciais OAuth da Conta Azul inválidas",
    );
  });

  it("requires Conta Azul OAuth environment configuration", () => {
    expect(() => getContaAzulOAuthConfig({})).toThrow(
      "CONTA_AZUL_CLIENT_ID não configurado",
    );
    expect(() =>
      getContaAzulOAuthConfig({
        CONTA_AZUL_CLIENT_ID: "client-id",
        CONTA_AZUL_CLIENT_SECRET: "client-secret",
        CONTA_AZUL_OAUTH_REDIRECT_URI: config.redirectUri,
        INTEGRATIONS_MASTER_KEY: "state-secret",
      }),
    ).not.toThrow();
  });
});
