import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendMailMock = vi.hoisted(() => vi.fn());
const createTransportMock = vi.hoisted(() => vi.fn());
const resendSendMock = vi.hoisted(() => vi.fn());

vi.mock("nodemailer", () => ({
  createTransport: createTransportMock,
}));

vi.mock("resend", () => ({
  Resend: vi.fn(function MockResend(this: Record<string, unknown>) {
    this.emails = { send: resendSendMock };
  }),
}));

import {
  isPlatformEmailConfigured,
  isRetryableSmtpError,
  resolvePlatformEmailTransport,
  sendPlatformEmail,
  toSmtpMessage,
} from "./transport";

beforeEach(() => {
  sendMailMock.mockReset().mockResolvedValue({ messageId: "<id@local>" });
  createTransportMock.mockReset().mockReturnValue({ sendMail: sendMailMock });
  resendSendMock.mockReset();
  for (const name of [
    "EMAIL_TRANSPORT",
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_SECURE",
    "SMTP_USER",
    "SMTP_PASSWORD",
    "RESEND_API_KEY",
  ]) {
    vi.stubEnv(name, "");
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolvePlatformEmailTransport", () => {
  it("is null when nothing is configured", () => {
    expect(resolvePlatformEmailTransport({})).toBeNull();
    expect(isPlatformEmailConfigured({})).toBe(false);
  });

  it("picks SMTP when SMTP_HOST is set, with STARTTLS on 587 by default", () => {
    expect(
      resolvePlatformEmailTransport({
        SMTP_HOST: "mail.lab.example",
        SMTP_USER: "app",
        SMTP_PASSWORD: "secret",
      }),
    ).toEqual({
      kind: "smtp",
      host: "mail.lab.example",
      port: 587,
      secure: false,
      user: "app",
      password: "secret",
    });
  });

  it("defaults to port 465 for implicit TLS", () => {
    expect(
      resolvePlatformEmailTransport({ SMTP_HOST: "h", SMTP_SECURE: "true" }),
    ).toMatchObject({ kind: "smtp", port: 465, secure: true });
  });

  it("picks Resend when only RESEND_API_KEY is set", () => {
    expect(resolvePlatformEmailTransport({ RESEND_API_KEY: "re_x" })).toEqual({
      kind: "resend",
      apiKey: "re_x",
    });
  });

  it("prefers SMTP when both are set, unless EMAIL_TRANSPORT says otherwise", () => {
    const env = { SMTP_HOST: "h", RESEND_API_KEY: "re_x" };
    expect(resolvePlatformEmailTransport(env)?.kind).toBe("smtp");
    expect(
      resolvePlatformEmailTransport({ ...env, EMAIL_TRANSPORT: "Resend" })
        ?.kind,
    ).toBe("resend");
  });

  it("rejects unknown or incomplete explicit transports", () => {
    expect(() =>
      resolvePlatformEmailTransport({ EMAIL_TRANSPORT: "smpt" }),
    ).toThrow(/EMAIL_TRANSPORT/);
    expect(() =>
      resolvePlatformEmailTransport({ EMAIL_TRANSPORT: "smtp" }),
    ).toThrow(/SMTP_HOST/);
    expect(() =>
      resolvePlatformEmailTransport({ SMTP_HOST: "h", SMTP_PORT: "abc" }),
    ).toThrow(/SMTP_PORT/);
    expect(isPlatformEmailConfigured({ EMAIL_TRANSPORT: "smpt" })).toBe(false);
  });
});

describe("isRetryableSmtpError", () => {
  it("retries connection trouble and 4xx replies only", () => {
    expect(isRetryableSmtpError({ code: "ECONNECTION" })).toBe(true);
    expect(isRetryableSmtpError({ responseCode: 421 })).toBe(true);
    expect(isRetryableSmtpError({ responseCode: 550 })).toBe(false);
    expect(isRetryableSmtpError({ code: "EAUTH", responseCode: 535 })).toBe(
      false,
    );
    expect(isRetryableSmtpError({ code: "EENVELOPE" })).toBe(false);
  });
});

describe("toSmtpMessage", () => {
  it("derives the plain-text part and decodes base64 attachments", async () => {
    const message = await toSmtpMessage({
      from: "Lab <noreply@lab.example>",
      to: ["a@x.example", "b@x.example"],
      replyTo: "suporte@lab.example",
      subject: "Certificado",
      html: "<p>Seu certificado <strong>está pronto</strong>.</p>",
      headers: { "List-Unsubscribe": "<https://x.example/u>" },
      attachments: [
        {
          filename: "cert.pdf",
          content: Buffer.from("%PDF").toString("base64"),
        },
      ],
    });

    expect(message).toMatchObject({
      from: "Lab <noreply@lab.example>",
      to: ["a@x.example", "b@x.example"],
      replyTo: "suporte@lab.example",
      subject: "Certificado",
      headers: { "List-Unsubscribe": "<https://x.example/u>" },
    });
    expect(message.text).toContain("Seu certificado");
    expect(message.attachments).toEqual([
      expect.objectContaining({
        filename: "cert.pdf",
        content: Buffer.from("%PDF"),
      }),
    ]);
  });
});

describe("sendPlatformEmail", () => {
  it("sends over SMTP when SMTP_HOST is set", async () => {
    vi.stubEnv("SMTP_HOST", "localhost");
    vi.stubEnv("SMTP_PORT", "1025");

    const result = await sendPlatformEmail({
      from: "noreply@lab.example",
      to: "a@x.example",
      subject: "Oi",
      html: "<p>Oi</p>",
    });

    expect(result).toEqual({ ok: true, emailId: "<id@local>" });
    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({ host: "localhost", port: 1025, secure: false }),
    );
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: "a@x.example", subject: "Oi" }),
    );
    expect(resendSendMock).not.toHaveBeenCalled();
  });

  it("reports SMTP rejections with a retry hint", async () => {
    vi.stubEnv("SMTP_HOST", "localhost");
    sendMailMock.mockRejectedValueOnce(
      Object.assign(new Error("Mailbox unavailable"), { responseCode: 550 }),
    );

    await expect(
      sendPlatformEmail({ from: "f@x", to: "t@x", subject: "s", html: "h" }),
    ).resolves.toEqual({
      ok: false,
      retryable: false,
      error: "Mailbox unavailable",
    });
  });

  it("sends through Resend when only RESEND_API_KEY is set", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_x");
    resendSendMock.mockResolvedValueOnce({ data: { id: "em_1" }, error: null });

    await expect(
      sendPlatformEmail({ from: "f@x", to: "t@x", subject: "s", html: "h" }),
    ).resolves.toEqual({ ok: true, emailId: "em_1" });
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("fails without retry when nothing is configured", async () => {
    await expect(
      sendPlatformEmail({ from: "f@x", to: "t@x", subject: "s", html: "h" }),
    ).resolves.toMatchObject({ ok: false, retryable: false });
  });
});
