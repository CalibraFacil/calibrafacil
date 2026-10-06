import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const emailsSendMock = vi.hoisted(() => vi.fn());
const resendCtorMock = vi.hoisted(() => vi.fn());

vi.mock("resend", () => ({
  Resend: vi.fn(function MockResend(
    this: Record<string, unknown>,
    apiKey: string,
  ) {
    resendCtorMock(apiKey);
    this.emails = { send: emailsSendMock };
  }),
}));

const getLabEmailCredentialMock = vi.hoisted(() => vi.fn());
const markLabEmailKeyFailureMock = vi.hoisted(() => vi.fn());

vi.mock("./sender", () => ({
  getLabEmailCredential: getLabEmailCredentialMock,
  markLabEmailKeyFailure: markLabEmailKeyFailureMock,
}));

import { formatLabFromHeader, sendEmailWithLabSender } from "./send";

const CREDENTIAL = {
  apiKey: "re_lab_key",
  fromAddress: "os@mail.lab.com.br",
  hostname: "mail.lab.com.br",
};

function buildPayloadSpy() {
  return vi.fn((sender: { fromAddress: string } | null) => ({
    from: sender
      ? `Lab <${sender.fromAddress}>`
      : "Calibra Fácil <noreply@calibrafacil.com>",
    to: "cliente@empresa.com.br",
    subject: "OS 123",
    html: sender ? "<p>lab</p>" : "<p>platform</p>",
  }));
}

beforeEach(() => {
  emailsSendMock.mockReset();
  resendCtorMock.mockReset();
  getLabEmailCredentialMock.mockReset();
  markLabEmailKeyFailureMock.mockReset().mockResolvedValue(undefined);
  // The platform sender is the Resend transport, resolved from the environment.
  vi.stubEnv("EMAIL_TRANSPORT", "");
  vi.stubEnv("SMTP_HOST", "");
  vi.stubEnv("RESEND_API_KEY", "re_platform");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("formatLabFromHeader", () => {
  it("builds a first-party From without 'via CalibraFácil'", () => {
    expect(
      formatLabFromHeader("Laboratório Exemplo", "os@mail.laboratorio.example"),
    ).toBe("Laboratório Exemplo <os@mail.laboratorio.example>");
  });

  it("strips header-breaking characters from the display name", () => {
    expect(formatLabFromHeader('Lab\r\n"X"', "a@b.com")).toBe(
      "Lab X <a@b.com>",
    );
  });
});

describe("sendEmailWithLabSender", () => {
  it("sends directly via the platform when no organization is given", async () => {
    emailsSendMock.mockResolvedValue({ data: { id: "e1" }, error: null });
    const buildPayload = buildPayloadSpy();

    const outcome = await sendEmailWithLabSender({
      organizationId: undefined,
      buildPayload,
    });

    expect(outcome).toEqual({
      sent: true,
      emailId: "e1",
      usedLabSender: false,
      fellBack: false,
    });
    expect(getLabEmailCredentialMock).not.toHaveBeenCalled();
    expect(resendCtorMock).toHaveBeenCalledWith("re_platform");
    expect(buildPayload).toHaveBeenCalledWith(null);
  });

  it("sends via the platform when no lab sender resolves (missing/unverified/inactive domain)", async () => {
    getLabEmailCredentialMock.mockResolvedValue(undefined);
    emailsSendMock.mockResolvedValue({ data: { id: "e2" }, error: null });

    const outcome = await sendEmailWithLabSender({
      organizationId: "org-1",
      buildPayload: buildPayloadSpy(),
    });

    expect(outcome).toEqual({
      sent: true,
      emailId: "e2",
      usedLabSender: false,
      fellBack: false,
    });
    expect(resendCtorMock).toHaveBeenCalledWith("re_platform");
  });

  it("sends from the lab domain when the credential resolves", async () => {
    getLabEmailCredentialMock.mockResolvedValue(CREDENTIAL);
    emailsSendMock.mockResolvedValue({ data: { id: "e3" }, error: null });
    const buildPayload = buildPayloadSpy();

    const outcome = await sendEmailWithLabSender({
      organizationId: "org-1",
      buildPayload,
    });

    expect(outcome).toEqual({
      sent: true,
      emailId: "e3",
      usedLabSender: true,
      fellBack: false,
    });
    expect(resendCtorMock).toHaveBeenCalledWith("re_lab_key");
    expect(buildPayload).toHaveBeenCalledWith({
      fromAddress: CREDENTIAL.fromAddress,
      hostname: CREDENTIAL.hostname,
    });
    expect(markLabEmailKeyFailureMock).not.toHaveBeenCalled();
  });

  it("falls back NOW on a revoked key (401/403-class), flipping keyStatus", async () => {
    getLabEmailCredentialMock.mockResolvedValue(CREDENTIAL);
    emailsSendMock
      .mockResolvedValueOnce({
        data: null,
        error: { name: "invalid_api_key", message: "API key is invalid" },
      })
      .mockResolvedValueOnce({ data: { id: "e4" }, error: null });
    const buildPayload = buildPayloadSpy();

    const outcome = await sendEmailWithLabSender({
      organizationId: "org-1",
      buildPayload,
    });

    expect(outcome).toEqual({
      sent: true,
      emailId: "e4",
      usedLabSender: false,
      fellBack: true,
    });
    // Second render is the platform variant (envelope matches the HTML).
    expect(buildPayload).toHaveBeenNthCalledWith(2, null);
    expect(resendCtorMock).toHaveBeenNthCalledWith(1, "re_lab_key");
    expect(resendCtorMock).toHaveBeenNthCalledWith(2, "re_platform");
    expect(markLabEmailKeyFailureMock).toHaveBeenCalledWith(
      "org-1",
      "invalid_key",
      "invalid_api_key: API key is invalid",
    );
  });

  it("falls back NOW on free-tier quota exhaustion (429-class)", async () => {
    getLabEmailCredentialMock.mockResolvedValue(CREDENTIAL);
    emailsSendMock
      .mockResolvedValueOnce({
        data: null,
        error: {
          name: "daily_quota_exceeded",
          message: "Daily quota exceeded",
        },
      })
      .mockResolvedValueOnce({ data: { id: "e5" }, error: null });

    const outcome = await sendEmailWithLabSender({
      organizationId: "org-1",
      buildPayload: buildPayloadSpy(),
    });

    expect(outcome).toEqual({
      sent: true,
      emailId: "e5",
      usedLabSender: false,
      fellBack: true,
    });
    expect(markLabEmailKeyFailureMock).toHaveBeenCalledWith(
      "org-1",
      "quota_exhausted",
      "daily_quota_exceeded: Daily quota exceeded",
    );
  });

  it("falls back NOW on per-second throttling without flipping keyStatus", async () => {
    getLabEmailCredentialMock.mockResolvedValue(CREDENTIAL);
    emailsSendMock
      .mockResolvedValueOnce({
        data: null,
        error: { name: "rate_limit_exceeded", message: "Too many requests" },
      })
      .mockResolvedValueOnce({ data: { id: "e6" }, error: null });

    const outcome = await sendEmailWithLabSender({
      organizationId: "org-1",
      buildPayload: buildPayloadSpy(),
    });

    expect(outcome).toEqual({
      sent: true,
      emailId: "e6",
      usedLabSender: false,
      fellBack: true,
    });
    // rate_limited flips nothing — markLabEmailKeyFailure ignores it, but the
    // send layer shouldn't even report it as a key failure.
    expect(markLabEmailKeyFailureMock).toHaveBeenCalledWith(
      "org-1",
      "rate_limited",
      "rate_limit_exceeded: Too many requests",
    );
  });

  it("reports retry-later on a transient lab failure WITHOUT platform fallback", async () => {
    getLabEmailCredentialMock.mockResolvedValue(CREDENTIAL);
    emailsSendMock.mockResolvedValueOnce({
      data: null,
      error: { name: "internal_server_error", message: "boom" },
    });

    const outcome = await sendEmailWithLabSender({
      organizationId: "org-1",
      buildPayload: buildPayloadSpy(),
    });

    expect(outcome).toEqual({ sent: false, retryable: true, error: "boom" });
    expect(emailsSendMock).toHaveBeenCalledTimes(1);
    expect(markLabEmailKeyFailureMock).not.toHaveBeenCalled();
  });

  it("treats a thrown network error on the lab attempt as retry-later", async () => {
    getLabEmailCredentialMock.mockResolvedValue(CREDENTIAL);
    emailsSendMock.mockRejectedValueOnce(new Error("fetch failed"));

    const outcome = await sendEmailWithLabSender({
      organizationId: "org-1",
      buildPayload: buildPayloadSpy(),
    });

    expect(outcome).toEqual({
      sent: false,
      retryable: true,
      error: "fetch failed",
    });
    expect(emailsSendMock).toHaveBeenCalledTimes(1);
  });

  it("classifies a platform failure as retryable only when transient", async () => {
    getLabEmailCredentialMock.mockResolvedValue(undefined);
    emailsSendMock.mockResolvedValueOnce({
      data: null,
      error: { name: "validation_error", message: "invalid payload" },
    });

    const outcome = await sendEmailWithLabSender({
      organizationId: "org-1",
      buildPayload: buildPayloadSpy(),
    });

    expect(outcome).toEqual({
      sent: false,
      retryable: false,
      error: "invalid payload",
    });
  });
});
