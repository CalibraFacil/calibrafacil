/**
 * Platform e-mail transport.
 *
 * Every e-mail the platform sends in its own name (sign-in links, invitations,
 * notifications, digests) leaves through one transport chosen from the
 * environment:
 *
 *  - `smtp`: any SMTP server (SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER,
 *    SMTP_PASSWORD). Self-hosted installs point it at their own mail server or
 *    relay; development points it at Mailpit.
 *  - `resend`: the Resend HTTP API (RESEND_API_KEY; RESEND_BASE_URL points the
 *    SDK at a compatible endpoint).
 *
 * EMAIL_TRANSPORT picks one explicitly. Unset, SMTP wins when SMTP_HOST is set
 * and Resend when RESEND_API_KEY is. Lab-owned sender domains (#584) are a
 * Resend feature: those messages always go through the Resend API (send.ts).
 */

import { render, toPlainText } from "@react-email/render";
import {
  createTransport,
  type SendMailOptions,
  type Transporter,
} from "nodemailer";
import { Resend, type CreateEmailOptions } from "resend";
import { classifyResendErrorName } from "./resend-domains";

type Env = Record<string, string | undefined>;

export type PlatformEmailTransport =
  | { kind: "resend"; apiKey: string }
  | {
      kind: "smtp";
      host: string;
      port: number;
      /** Implicit TLS (port 465). Otherwise STARTTLS when the server offers it. */
      secure: boolean;
      user?: string;
      password?: string;
    };

export type EmailDeliveryResult =
  | { ok: true; emailId?: string }
  | { ok: false; retryable: boolean; error: string };

function readEnv(env: Env, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

/**
 * The configured platform transport, or null when e-mail is not configured.
 * Throws when EMAIL_TRANSPORT names an unknown transport or one whose settings
 * are missing, so a typo fails at boot instead of silently dropping mail.
 */
export function resolvePlatformEmailTransport(
  env: Env = process.env,
): PlatformEmailTransport | null {
  const explicit = readEnv(env, "EMAIL_TRANSPORT")?.toLowerCase();
  if (explicit && explicit !== "smtp" && explicit !== "resend") {
    throw new Error(
      `EMAIL_TRANSPORT must be "smtp" or "resend", got "${explicit}"`,
    );
  }

  const host = readEnv(env, "SMTP_HOST");
  const apiKey = readEnv(env, "RESEND_API_KEY");
  const kind = explicit ?? (host ? "smtp" : apiKey ? "resend" : undefined);

  if (kind === "smtp") {
    if (!host) throw new Error("EMAIL_TRANSPORT=smtp requires SMTP_HOST");
    const secure = readEnv(env, "SMTP_SECURE")?.toLowerCase() === "true";
    const port = Number(readEnv(env, "SMTP_PORT") ?? (secure ? 465 : 587));
    if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
      throw new Error(`SMTP_PORT must be a port number, got "${port}"`);
    }
    return {
      kind,
      host,
      port,
      secure,
      user: readEnv(env, "SMTP_USER"),
      password: readEnv(env, "SMTP_PASSWORD"),
    };
  }

  if (kind === "resend") {
    if (!apiKey) {
      throw new Error("EMAIL_TRANSPORT=resend requires RESEND_API_KEY");
    }
    return { kind, apiKey };
  }

  return null;
}

let loggedConfigError = false;

/**
 * Whether the platform can send e-mail. A misconfigured transport counts as
 * not configured (logged once) so callers degrade to in-app only; production
 * boot validates the transport with {@link resolvePlatformEmailTransport}.
 */
export function isPlatformEmailConfigured(env: Env = process.env): boolean {
  try {
    return resolvePlatformEmailTransport(env) !== null;
  } catch (error) {
    if (!loggedConfigError) {
      loggedConfigError = true;
      console.error("[Email] Transport misconfigured:", error);
    }
    return false;
  }
}

/** From-header for platform e-mail: RESEND_FROM_EMAIL, then EMAIL_FROM. */
export function getPlatformFromEmail(
  env: Env = process.env,
): string | undefined {
  return readEnv(env, "RESEND_FROM_EMAIL") ?? readEnv(env, "EMAIL_FROM");
}

async function sendViaResend(
  apiKey: string,
  payload: CreateEmailOptions,
): Promise<EmailDeliveryResult> {
  try {
    const { data, error } = await new Resend(apiKey).emails.send(payload);
    if (error) {
      const failureClass = classifyResendErrorName(error.name);
      return {
        ok: false,
        retryable:
          failureClass === "transient" || failureClass === "rate_limited",
        error: error.message,
      };
    }
    return { ok: true, emailId: data?.id };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown transport error";
    return { ok: false, retryable: true, error: message };
  }
}

let cachedSmtp: { key: string; transporter: Transporter } | undefined;

function smtpTransporter(
  config: Extract<PlatformEmailTransport, { kind: "smtp" }>,
): Transporter {
  const key = JSON.stringify(config);
  if (cachedSmtp?.key !== key) {
    cachedSmtp = {
      key,
      transporter: createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: config.user
          ? { user: config.user, pass: config.password }
          : undefined,
      }),
    };
  }
  return cachedSmtp.transporter;
}

/** Turns a Resend payload into a nodemailer message. */
export async function toSmtpMessage(
  payload: CreateEmailOptions,
): Promise<SendMailOptions> {
  const html =
    payload.html ?? (payload.react ? await render(payload.react) : undefined);
  return {
    from: payload.from,
    to: payload.to,
    cc: payload.cc,
    bcc: payload.bcc,
    replyTo: payload.replyTo,
    subject: payload.subject,
    html,
    // Resend derives the plain-text part server-side; over SMTP we do it here.
    text: payload.text ?? (html ? toPlainText(html) : undefined),
    headers: payload.headers,
    attachments: payload.attachments?.map((attachment) => ({
      filename: attachment.filename || undefined,
      // Resend takes string content as base64.
      content:
        typeof attachment.content === "string"
          ? Buffer.from(attachment.content, "base64")
          : attachment.content,
      path: attachment.path,
      contentType: attachment.contentType,
      cid: attachment.contentId,
    })),
  };
}

function readField(value: unknown, field: string): unknown {
  return typeof value === "object" && value !== null && field in value
    ? Object.getOwnPropertyDescriptor(value, field)?.value
    : undefined;
}

/**
 * SMTP failures worth retrying: connection trouble and 4xx replies. 5xx
 * replies (rejected sender or recipient), authentication and envelope errors
 * fail the same way on every attempt.
 */
export function isRetryableSmtpError(error: unknown): boolean {
  const responseCode = readField(error, "responseCode");
  if (typeof responseCode === "number") return responseCode < 500;
  const code = readField(error, "code");
  return code !== "EAUTH" && code !== "EENVELOPE" && code !== "EMESSAGE";
}

async function sendViaSmtp(
  config: Extract<PlatformEmailTransport, { kind: "smtp" }>,
  payload: CreateEmailOptions,
): Promise<EmailDeliveryResult> {
  if (payload.template) {
    return {
      ok: false,
      retryable: false,
      error: "Resend-hosted templates cannot be sent over SMTP",
    };
  }
  try {
    const info: unknown = await smtpTransporter(config).sendMail(
      await toSmtpMessage(payload),
    );
    const messageId = readField(info, "messageId");
    return {
      ok: true,
      emailId: typeof messageId === "string" ? messageId : undefined,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown SMTP error";
    return {
      ok: false,
      retryable: isRetryableSmtpError(error),
      error: message,
    };
  }
}

/**
 * Send one message through the platform transport. Never throws: failures
 * come back as `{ ok: false }` with a retry hint.
 */
export async function sendPlatformEmail(
  payload: CreateEmailOptions,
): Promise<EmailDeliveryResult> {
  let transport: PlatformEmailTransport | null;
  try {
    transport = resolvePlatformEmailTransport();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Invalid e-mail transport";
    return { ok: false, retryable: false, error: message };
  }
  if (!transport) {
    return {
      ok: false,
      retryable: false,
      error: "E-mail is not configured (set SMTP_HOST or RESEND_API_KEY)",
    };
  }
  return transport.kind === "smtp"
    ? sendViaSmtp(transport, payload)
    : sendViaResend(transport.apiKey, payload);
}
