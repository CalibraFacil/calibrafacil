import { beforeEach, describe, expect, it, vi } from "vitest";

const domainsMock = vi.hoisted(() => ({
  create: vi.fn(),
  remove: vi.fn(),
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
  createResendDomain,
  deleteResendDomain,
  getResendDomain,
  listResendDomains,
  validateResendApiKey,
  verifyResendDomain,
} from "./resend-domains";

beforeEach(() => {
  domainsMock.create.mockReset();
  domainsMock.remove.mockReset();
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

describe("managed domain provisioning", () => {
  it("creates in São Paulo and preserves the provider DNS records", async () => {
    const data = {
      id: "new-domain",
      name: "mail.lab.com.br",
      status: "not_started",
      records: [
        {
          type: "MX",
          name: "send.mail",
          value: "feedback-smtp.sa-east-1.amazonses.com",
          priority: 10,
        },
      ],
    };
    domainsMock.create.mockResolvedValue({ data, error: null });
    expect(await createResendDomain("re_platform", data.name)).toEqual({
      ok: true,
      data,
    });
    expect(domainsMock.create).toHaveBeenCalledWith({
      name: data.name,
      region: "sa-east-1",
    });
  });
  it("returns provider conflicts without adopting an existing domain", async () => {
    domainsMock.create.mockResolvedValue({
      data: null,
      error: { name: "validation_error", message: "Domain already exists" },
    });
    expect(
      await createResendDomain("re_platform", "mail.lab.com.br"),
    ).toMatchObject({ ok: false, failureClass: "sender_config" });
    expect(domainsMock.list).not.toHaveBeenCalled();
  });
  it("requires a created domain response", async () => {
    domainsMock.create.mockResolvedValue({ data: null, error: null });
    expect(
      await createResendDomain("re_platform", "mail.lab.com.br"),
    ).toMatchObject({ ok: false });
  });
  it("deletes by provider ID and treats an already-removed domain as success", async () => {
    domainsMock.remove
      .mockResolvedValueOnce({ data: { id: "d1", deleted: true }, error: null })
      .mockResolvedValueOnce({
        data: null,
        error: { name: "not_found", message: "Domain not found" },
      });
    expect(await deleteResendDomain("re_platform", "d1")).toEqual({
      ok: true,
      data: { id: "d1" },
    });
    expect(await deleteResendDomain("re_platform", "d1")).toEqual({
      ok: true,
      data: { id: "d1" },
    });
    expect(domainsMock.remove).toHaveBeenCalledWith("d1");
  });
  it("does not mistake permission, transport or empty responses for deletion", async () => {
    domainsMock.remove
      .mockResolvedValueOnce({
        data: null,
        error: { name: "invalid_api_key", message: "Invalid key" },
      })
      .mockRejectedValueOnce(new Error("Offline"))
      .mockResolvedValueOnce({ data: null, error: null });
    expect(await deleteResendDomain("re_platform", "d1")).toMatchObject({
      ok: false,
      failureClass: "invalid_key",
    });
    expect(await deleteResendDomain("re_platform", "d1")).toMatchObject({
      ok: false,
      failureClass: "transient",
    });
    expect(await deleteResendDomain("re_platform", "d1")).toMatchObject({
      ok: false,
      failureClass: "transient",
    });
  });
});
