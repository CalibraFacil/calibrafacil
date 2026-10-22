import { example, type ExampleSpec, type RuntimeName } from "./define";
import { catalogFor } from "./catalog";

/**
 * The variables of the one-server Docker deployment (deploy/compose.yaml).
 *
 * These are the operator-facing settings of `deploy/.env`; compose maps them
 * onto the API, worker and frontend variables (`x-app-env`). A variable that is
 * also an API variable (SMTP_HOST, the secrets, ...) takes its description from
 * the API schema, so the two never disagree.
 */
export interface DeployVariable {
  readonly name: string;
  /** Own description; defaults to the API variable of the same name. */
  readonly description?: string;
  readonly example: ExampleSpec;
}

export interface DeploySection {
  readonly title: string;
  readonly intro?: readonly string[];
  readonly variables: readonly DeployVariable[];
}

/** The image tag; release-please rewrites it, so it follows package.json. */
export const DEPLOY_VERSION_VARIABLE = "CALIBRA_VERSION";

export const DEPLOY_SECTIONS: readonly DeploySection[] = [
  {
    title: "Version",
    intro: ["Image tag on ghcr.io/calibrafacil. Pin it; change it to update."],
    variables: [
      {
        name: DEPLOY_VERSION_VARIABLE,
        description: "Version of the published images.",
        // Replaced by the version in package.json when rendering.
        example: example.active(""),
      },
    ],
  },
  {
    title: "Addresses",
    intro: [
      "Three DNS names pointing at this machine (no trailing slash). With https://",
      "Caddy gets certificates from Let's Encrypt; ports 80 and 443 must be open.",
      "To try it on your own computer, use http://app.localhost,",
      "http://portal.localhost and http://files.localhost.",
    ],
    variables: [
      {
        name: "APP_URL",
        description: "Address of the lab app (and of the API, under /api).",
        example: example.active("https://calibra.example.com"),
      },
      {
        name: "PORTAL_URL",
        description: "Address of the client portal.",
        example: example.active("https://portal.example.com"),
      },
      {
        name: "FILES_URL",
        description:
          "Address file downloads are served from (the object store).",
        example: example.active("https://files.example.com"),
      },
    ],
  },
  {
    title: "E-mail",
    intro: [
      "Sign-in is passwordless, so the app must be able to send e-mail. Use your",
      "provider's SMTP server (Gmail/Google Workspace, Microsoft 365, Amazon SES,",
      "Brevo, Mailgun, your own Postfix...), or set RESEND_API_KEY instead.",
      "",
      "Just trying it out? `./setup.sh --local` sets SMTP_HOST=mailpit,",
      "SMTP_PORT=1025 and COMPOSE_PROFILES=mailpit: every e-mail then lands in a",
      "test inbox at http://localhost:8025 instead of being delivered.",
    ],
    variables: [
      {
        name: "EMAIL_FROM",
        example: example.active('"Calibra Fácil <calibra@example.com>"'),
      },
      { name: "SMTP_HOST", example: example.active("") },
      { name: "SMTP_PORT", example: example.active("587") },
      { name: "SMTP_SECURE", example: example.active("false") },
      { name: "SMTP_USER", example: example.active("") },
      { name: "SMTP_PASSWORD", example: example.active("") },
      { name: "RESEND_API_KEY", example: example.commented("") },
    ],
  },
  {
    title: "Laboratory identity (legal pages)",
    intro: [
      "Whoever runs this instance is the data controller under the LGPD; these",
      "appear on the terms of use and privacy pages.",
    ],
    variables: [
      {
        name: "OPERATOR_LEGAL_NAME",
        description: "Legal name of the operator.",
        example: example.active(""),
      },
      {
        name: "OPERATOR_CNPJ",
        description: "CNPJ of the operator.",
        example: example.active(""),
      },
      {
        name: "OPERATOR_ADDRESS",
        description: "Address of the operator.",
        example: example.active(""),
      },
      {
        name: "OPERATOR_EMAIL",
        description: "Contact e-mail of the operator.",
        example: example.active(""),
      },
    ],
  },
  {
    title: "Certificate time-stamping (optional)",
    intro: [
      "RFC 3161 carimbo do tempo on signed certificates. Leave SIGNING_TSA_URL",
      "empty and certificates are signed without a time-stamp. When it is set,",
      "every certificate is time-stamped and, if the authority cannot be",
      "reached, the certificate is not issued (see DEPLOYMENT.md).",
    ],
    variables: [
      { name: "SIGNING_TSA_URL", example: example.commented("") },
      { name: "SIGNING_TSA_AUTH", example: example.commented("") },
      {
        name: "SIGNING_TSA_ICP_CONFORMANT",
        example: example.commented("false"),
      },
      { name: "SIGNING_TSA_TIMEOUT_MS", example: example.commented("30000") },
    ],
  },
  {
    title: "Optional",
    variables: [
      {
        name: "HTTP_BIND",
        description:
          "Publish Caddy's HTTP port on another address, e.g. 127.0.0.1:8080.",
        example: example.commented("80"),
      },
      {
        name: "HTTPS_BIND",
        description: "Publish Caddy's HTTPS port on another address.",
        example: example.commented("443"),
      },
      {
        name: "MAILPIT_BIND",
        description:
          "Where the optional test inbox (COMPOSE_PROFILES=mailpit) is published.",
        example: example.commented("127.0.0.1:8025"),
      },
    ],
  },
  {
    title: "Secrets (generated by ./setup.sh)",
    intro: [
      "32 random bytes, base64, for the keys. Never change a key once data exists.",
    ],
    variables: [
      {
        name: "POSTGRES_PASSWORD",
        description: "Password of the bundled PostgreSQL.",
        example: example.generated(),
      },
      {
        name: "S3_SECRET_KEY",
        description: "Secret key of the bundled object store.",
        example: example.generated(),
      },
      { name: "BETTER_AUTH_SECRET", example: example.generated() },
      { name: "CRON_SECRET", example: example.generated() },
      { name: "QUOTE_APPROVAL_CODE_PEPPER", example: example.generated() },
      { name: "SIGNING_MASTER_KEY", example: example.generated() },
      { name: "INTEGRATIONS_MASTER_KEY", example: example.generated() },
      { name: "PUBLIC_API_MASTER_KEY", example: example.generated() },
      { name: "EMAIL_DOMAIN_MASTER_KEY", example: example.generated() },
    ],
  },
];

/** The description of a deploy variable: its own, else the API variable's. */
export function deployDescription(variable: DeployVariable): string {
  if (variable.description) return variable.description;
  const runtime: RuntimeName = "api";
  for (const section of catalogFor(runtime)) {
    for (const entry of section.entries) {
      if (entry.meta.env === variable.name) return entry.meta.description;
    }
  }
  throw new Error(
    `Deploy variable ${variable.name} has no description and is not an API variable`,
  );
}
