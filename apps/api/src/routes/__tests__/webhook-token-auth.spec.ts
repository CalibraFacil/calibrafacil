import { afterEach, describe, expect, it } from "vitest";
import { verifyWebhookToken } from "../webhooks";

const originalToken = process.env.ASAAS_WEBHOOK_TOKEN;

afterEach(() => {
  if (originalToken) {
    process.env.ASAAS_WEBHOOK_TOKEN = originalToken;
  } else {
    delete process.env.ASAAS_WEBHOOK_TOKEN;
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
