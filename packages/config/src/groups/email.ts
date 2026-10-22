import {
  choice,
  defineGroup,
  example,
  flag,
  integer,
  text,
  url,
} from "../define.ts";

/** The transport platform e-mail leaves through, resolved from the settings. */
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

export const emailGroup = defineGroup({
  name: "email",
  title: "E-mail",
  intro: [
    "Sign-in links, invitations and notifications go out over SMTP or through the",
    "Resend API. Locally SMTP points at Mailpit from docker-compose.yml: read every",
    "message at http://localhost:8025. In production, point SMTP_* at your mail",
    "server, or remove them and set RESEND_API_KEY.",
  ],
  vars: {
    transportName: choice({
      env: "EMAIL_TRANSPORT",
      description:
        "Picks the transport explicitly; only needed when both SMTP_HOST and RESEND_API_KEY are set (SMTP wins otherwise).",
      values: ["smtp", "resend"],
      example: example.commented("smtp"),
    }),
    smtpHost: text({
      env: "SMTP_HOST",
      description: "SMTP server host. Leave empty to use Resend.",
      example: example.active("localhost"),
    }),
    smtpPort: integer({
      env: "SMTP_PORT",
      description: "SMTP port (default 587, or 465 with SMTP_SECURE=true).",
      min: 1,
      max: 65_535,
      example: example.active("1025"),
    }),
    smtpSecure: flag({
      env: "SMTP_SECURE",
      description:
        "Implicit TLS (port 465); otherwise STARTTLS when the server offers it.",
      default: false,
      example: example.commented("true"),
    }),
    smtpUser: text({
      env: "SMTP_USER",
      description: "SMTP user name.",
      example: example.commented(""),
    }),
    smtpPassword: text({
      env: "SMTP_PASSWORD",
      description: "SMTP password.",
      secret: true,
      example: example.commented(""),
    }),
    resendApiKey: text({
      env: "RESEND_API_KEY",
      description:
        "Resend API key: the platform sender when SMTP_HOST is empty, and the fallback for lab sender domains.",
      secret: true,
      example: example.commented(""),
    }),
    resendFromEmail: text({
      env: "RESEND_FROM_EMAIL",
      description:
        "Sender of platform e-mail; takes precedence over EMAIL_FROM.",
      hidden: true,
    }),
    emailFrom: text({
      env: "EMAIL_FROM",
      description:
        'Sender of platform e-mail, e.g. "Laboratório <calibra@example.com>".',
      example: example.active('"Calibra Fácil <noreply@example.com>"'),
    }),
    emailLogoUrl: url({
      env: "EMAIL_LOGO_URL",
      description:
        "Logo shown in e-mail headers (default: the app's own logo).",
    }),
    resendWebhookSecret: text({
      env: "RESEND_WEBHOOK_SECRET",
      description:
        "Signing secret of the Resend delivery webhook (bounces and complaints).",
      secret: true,
    }),
    domainMasterKey: text({
      env: "EMAIL_DOMAIN_MASTER_KEY",
      description:
        "256-bit base64 key encrypting lab-owned Resend API keys at rest. Without it the e-mail-domain settings refuse key intake and every send uses the platform sender. Never reuse another key.",
      secret: true,
      base64Key: true,
      example: example.generated(),
    }),
  },
  derive: (values, ctx) => {
    const explicit = values.transportName;
    const host = values.smtpHost;
    const apiKey = values.resendApiKey;
    const kind = explicit ?? (host ? "smtp" : apiKey ? "resend" : undefined);

    let transport: PlatformEmailTransport | null = null;
    if (kind === "smtp") {
      if (host) {
        const secure = values.smtpSecure;
        transport = {
          kind,
          host,
          port: values.smtpPort ?? (secure ? 465 : 587),
          secure,
          user: values.smtpUser,
          password: values.smtpPassword,
        };
      } else {
        ctx.issue("SMTP_HOST", "is required when EMAIL_TRANSPORT=smtp");
      }
    } else if (kind === "resend") {
      if (apiKey) {
        transport = { kind, apiKey };
      } else {
        ctx.issue("RESEND_API_KEY", "is required when EMAIL_TRANSPORT=resend");
      }
    }

    return {
      /** The platform transport, or null when e-mail is not configured. */
      transport,
      /** From-header of platform e-mail: RESEND_FROM_EMAIL, then EMAIL_FROM. */
      fromEmail: values.resendFromEmail ?? values.emailFrom,
    };
  },
});
