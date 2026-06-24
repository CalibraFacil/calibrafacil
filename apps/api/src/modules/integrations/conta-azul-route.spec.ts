import { describe, expect, it } from "vitest";
import { HTTPException } from "hono/http-exception";
import {
  assertProviderSupportsSyncTarget,
  buildContaAzulOAuthErrorUrl,
  buildContaAzulOAuthReturnUrl,
} from "./conta-azul-route";

describe("assertProviderSupportsSyncTarget", () => {
  it("allows any target for the conta_azul provider", () => {
    expect(() =>
      assertProviderSupportsSyncTarget("conta_azul", "payable"),
    ).not.toThrow();
  });

  it("allows generic HTTP targets for non-conta_azul providers", () => {
    for (const target of [
      "customer",
      "service_order",
      "billing_document",
    ] as const) {
      expect(() =>
        assertProviderSupportsSyncTarget("generic_http", target),
      ).not.toThrow();
    }
  });

  it("rejects conta-azul-only targets for non-conta_azul providers with a 400", () => {
    let thrown: unknown;
    try {
      assertProviderSupportsSyncTarget("generic_http", "payable");
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(HTTPException);
    if (thrown instanceof HTTPException) {
      expect(thrown.status).toBe(400);
      expect(thrown.message).toBe(
        "Alvo payable é suportado apenas pelo provider Conta Azul",
      );
    }
  });
});

describe("buildContaAzulOAuthReturnUrl", () => {
  it("resolves returnTo against the configured APP_URL", () => {
    const url = buildContaAzulOAuthReturnUrl(
      { APP_URL: "https://app.example.com" },
      "/dashboard/foo",
    );
    expect(url).toBe("https://app.example.com/dashboard/foo");
  });

  it("falls back to the integrations settings path when returnTo is null", () => {
    const url = buildContaAzulOAuthReturnUrl(
      { APP_URL: "https://app.example.com" },
      null,
    );
    expect(url).toBe(
      "https://app.example.com/dashboard/settings/integrations",
    );
  });

  it("falls back to localhost:5173 when APP_URL is missing/blank", () => {
    expect(buildContaAzulOAuthReturnUrl({ APP_URL: "   " }, null)).toBe(
      "http://localhost:5173/dashboard/settings/integrations",
    );
    expect(buildContaAzulOAuthReturnUrl({}, null)).toBe(
      "http://localhost:5173/dashboard/settings/integrations",
    );
  });
});

describe("buildContaAzulOAuthErrorUrl", () => {
  it("appends the contaAzulOAuth=error + reason hints to the return URL", () => {
    const url = buildContaAzulOAuthErrorUrl(
      { APP_URL: "https://app.example.com" },
      "/dashboard/foo",
      "invalid_state",
    );
    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://app.example.com");
    expect(parsed.pathname).toBe("/dashboard/foo");
    expect(parsed.searchParams.get("contaAzulOAuth")).toBe("error");
    expect(parsed.searchParams.get("reason")).toBe("invalid_state");
  });

  it("uses the integrations settings fallback + exchange_failed reason", () => {
    const url = buildContaAzulOAuthErrorUrl(
      { APP_URL: "https://app.example.com" },
      null,
      "exchange_failed",
    );
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/dashboard/settings/integrations");
    expect(parsed.searchParams.get("reason")).toBe("exchange_failed");
  });

  it("falls back to localhost:5173 when APP_URL is blank", () => {
    const url = buildContaAzulOAuthErrorUrl({}, null, "invalid_state");
    expect(url.startsWith("http://localhost:5173/")).toBe(true);
  });
});
