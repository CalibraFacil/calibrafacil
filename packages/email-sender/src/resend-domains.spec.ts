import { beforeEach, describe, expect, it, vi } from "vitest";

const domainsMock = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  verify: vi.fn(),
}));

vi.mock("resend", () => ({
  Resend: vi.fn(function MockResend(this: Record<string, unknown>) {
    this.domains = domainsMock;
  }),
}));

import {
  classifyResendErrorName,
  getResendDomain,
  listResendDomains,
  validateResendApiKey,
  verifyResendDomain,
} from "./resend-domains";

beforeEach(() => {
  domainsMock.list.mockReset();
  domainsMock.get.mockReset();
  domainsMock.verify.mockReset();
});

describe("classifyResendErrorName", () => {
  it("maps dead-credential codes to invalid_key", () => {
    for (const name of [
      "invalid_api_key",
      "missing_api_key",
      "restricted_api_key",
      "invalid_access",
    ]) {
      expect(classifyResendErrorName(name)).toBe("invalid_key");
    }
  });

  it("maps quota exhaustion (free-tier caps) to quota_exhausted", () => {
    expect(classifyResendErrorName("daily_quota_exceeded")).toBe(
      "quota_exhausted",
    );
    expect(classifyResendErrorName("monthly_quota_exceeded")).toBe(
      "quota_exhausted",
    );
  });

  it("keeps per-second throttling separate from quota exhaustion", () => {
    expect(classifyResendErrorName("rate_limit_exceeded")).toBe("rate_limited");
  });

  it("maps sender/domain rejections to sender_config", () => {
    for (const name of [
      "invalid_from_address",
      "validation_error",
      "not_found",
    ]) {
      expect(classifyResendErrorName(name)).toBe("sender_config");
    }
  });

  it("defaults unknown codes to transient (retry-later, never fallback)", () => {
    expect(classifyResendErrorName("internal_server_error")).toBe("transient");
    expect(classifyResendErrorName("application_error")).toBe("transient");
    expect(classifyResendErrorName("something_new")).toBe("transient");
  });
});

describe("listResendDomains", () => {
  it("returns the account's domains", async () => {
    domainsMock.list.mockResolvedValue({
      data: {
        data: [
          { id: "d1", name: "mail.lab.com.br", status: "verified" },
          { id: "d2", name: "news.lab.com.br", status: "pending" },
        ],
      },
      error: null,
    });

    const result = await listResendDomains("re_key");
    expect(result).toEqual({
      ok: true,
      data: [
        { id: "d1", name: "mail.lab.com.br", status: "verified" },
        { id: "d2", name: "news.lab.com.br", status: "pending" },
      ],
    });
  });

  it("classifies an API error", async () => {
    domainsMock.list.mockResolvedValue({
      data: null,
      error: { name: "invalid_api_key", message: "API key is invalid" },
    });

    const result = await listResendDomains("re_key");
    expect(result).toEqual({
      ok: false,
      errorName: "invalid_api_key",
      message: "API key is invalid",
      failureClass: "invalid_key",
    });
  });

  it("normalizes a thrown transport error to transient", async () => {
    domainsMock.list.mockRejectedValue(new Error("fetch failed"));

    const result = await listResendDomains("re_key");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failureClass).toBe("transient");
    }
  });
});

describe("getResendDomain", () => {
  it("returns status and DNS records as plain records", async () => {
    domainsMock.get.mockResolvedValue({
      data: {
        id: "d1",
        name: "mail.lab.com.br",
        status: "verified",
        records: [
          {
            record: "DKIM",
            name: "resend._domainkey",
            type: "TXT",
            value: "k=...",
          },
        ],
      },
      error: null,
    });

    const result = await getResendDomain("re_key", "d1");
    expect(result).toEqual({
      ok: true,
      data: {
        id: "d1",
        name: "mail.lab.com.br",
        status: "verified",
        records: [
          {
            record: "DKIM",
            name: "resend._domainkey",
            type: "TXT",
            value: "k=...",
          },
        ],
      },
    });
  });
});

describe("verifyResendDomain", () => {
  it("acks a verification trigger", async () => {
    domainsMock.verify.mockResolvedValue({ data: { id: "d1" }, error: null });
    const result = await verifyResendDomain("re_key", "d1");
    expect(result).toEqual({ ok: true, data: { id: "d1" } });
  });
});

describe("validateResendApiKey", () => {
  it("accepts a key that can list domains", async () => {
    domainsMock.list.mockResolvedValue({
      data: {
        data: [{ id: "d1", name: "mail.lab.com.br", status: "verified" }],
      },
      error: null,
    });

    const result = await validateResendApiKey("re_key");
    expect(result.valid).toBe(true);
  });

  it("rejects a key Resend rejects, with the failure class", async () => {
    domainsMock.list.mockResolvedValue({
      data: null,
      error: {
        name: "restricted_api_key",
        message: "insufficient permissions",
      },
    });

    const result = await validateResendApiKey("re_key");
    expect(result).toEqual({
      valid: false,
      failureClass: "invalid_key",
      message: "insufficient permissions",
    });
  });
});
