import { afterEach, describe, expect, it } from "vitest";
import { verifyWebhookSourceIp, verifyWebhookToken } from "../webhooks";

const originalToken = process.env.ASAAS_WEBHOOK_TOKEN;
const originalAllowedIps = process.env.ASAAS_WEBHOOK_ALLOWED_IPS;

afterEach(() => {
  if (originalToken) {
    process.env.ASAAS_WEBHOOK_TOKEN = originalToken;
  } else {
    delete process.env.ASAAS_WEBHOOK_TOKEN;
  }
  if (originalAllowedIps) {
    process.env.ASAAS_WEBHOOK_ALLOWED_IPS = originalAllowedIps;
  } else {
    delete process.env.ASAAS_WEBHOOK_ALLOWED_IPS;
  }
});

describe("verifyWebhookToken", () => {
  it("fails closed when ASAAS_WEBHOOK_TOKEN is not configured", () => {
    delete process.env.ASAAS_WEBHOOK_TOKEN;
    const req = new Request("https://example.com/api/webhooks/asaas", {
      method: "POST",
      headers: { "asaas-access-token": "anything" },
    });

    expect(verifyWebhookToken(req)).toBe(false);
  });

  it("returns false when request token is missing", () => {
    process.env.ASAAS_WEBHOOK_TOKEN = "secret-token";
    const req = new Request("https://example.com/api/webhooks/asaas", {
      method: "POST",
    });

    expect(verifyWebhookToken(req)).toBe(false);
  });

  it("returns true when token matches", () => {
    process.env.ASAAS_WEBHOOK_TOKEN = "secret-token";
    const req = new Request("https://example.com/api/webhooks/asaas", {
      method: "POST",
      headers: { "asaas-access-token": "secret-token" },
    });

    expect(verifyWebhookToken(req)).toBe(true);
  });

  it("returns false when token does not match", () => {
    process.env.ASAAS_WEBHOOK_TOKEN = "secret-token";
    const req = new Request("https://example.com/api/webhooks/asaas", {
      method: "POST",
      headers: { "asaas-access-token": "different-token" },
    });

    expect(verifyWebhookToken(req)).toBe(false);
  });
});

// #641 (SEC-06): Asaas offers NO per-payload HMAC (docs.asaas.com, 2026-07 —
// static per-webhook asaas-access-token only), so the second factor is a
// source-IP allowlist against Asaas's published webhook IPs. Env-driven and
// opt-in: unset preserves current behavior (list has changed before; a stale
// hardcoded list would silently kill payment activation).
describe("verifyWebhookSourceIp (#641)", () => {
  function requestFromIp(ip: string | null): Request {
    return new Request("https://example.com/api/webhooks/asaas", {
      method: "POST",
      headers: ip ? { "x-real-ip": ip } : {},
    });
  }

  it("REQ-SEC-ASA-IP-001: allowlist set + non-listed source IP -> rejected", async () => {
    process.env.ASAAS_WEBHOOK_ALLOWED_IPS =
      "52.67.12.206,18.230.8.159,54.94.136.112,54.94.183.101";
    expect(await verifyWebhookSourceIp(requestFromIp("203.0.113.7"))).toBe(
      false,
    );
  });

  it("allowlist set + listed source IP -> accepted (whitespace tolerated)", async () => {
    process.env.ASAAS_WEBHOOK_ALLOWED_IPS =
      " 52.67.12.206 , 18.230.8.159 ,54.94.136.112";
    expect(await verifyWebhookSourceIp(requestFromIp("18.230.8.159"))).toBe(
      true,
    );
  });

  it("allowlist set + NO source-ip header -> rejected (fail closed once enforcing)", async () => {
    process.env.ASAAS_WEBHOOK_ALLOWED_IPS = "52.67.12.206";
    expect(await verifyWebhookSourceIp(requestFromIp(null))).toBe(false);
  });

  it("REQ-SEC-ASA-IP-002: env unset/blank -> skip (pre-#641 behavior preserved)", async () => {
    delete process.env.ASAAS_WEBHOOK_ALLOWED_IPS;
    expect(await verifyWebhookSourceIp(requestFromIp("203.0.113.7"))).toBe(
      true,
    );
    process.env.ASAAS_WEBHOOK_ALLOWED_IPS = "  ";
    expect(await verifyWebhookSourceIp(requestFromIp("203.0.113.7"))).toBe(
      true,
    );
  });

  it("falls back to the first x-forwarded-for hop when x-real-ip is absent", async () => {
    process.env.ASAAS_WEBHOOK_ALLOWED_IPS = "54.94.136.112";
    const req = new Request("https://example.com/api/webhooks/asaas", {
      method: "POST",
      headers: { "x-forwarded-for": "54.94.136.112, 10.0.0.1" },
    });
    expect(await verifyWebhookSourceIp(req)).toBe(true);
    const bad = new Request("https://example.com/api/webhooks/asaas", {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.7, 54.94.136.112" },
    });
    expect(await verifyWebhookSourceIp(bad)).toBe(false);
  });
});
