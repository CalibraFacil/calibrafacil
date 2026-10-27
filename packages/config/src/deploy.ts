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
    title: "Signing key rotation and trust store (optional)",
    intro: [
      "SIGNING_MASTER_KEY (below) is the key encryption key that protects the",
      "laboratories' signing certificates. To rotate it, give the new key a new id,",
      "keep the old one in SIGNING_MASTER_KEY_PREVIOUS and run",
      "reencrypt-signing-credentials (see DEPLOYMENT.md, Signing certificate custody).",
    ],
    variables: [
      { name: "SIGNING_MASTER_KEY_ID", example: example.commented("k1") },
      {
        name: "SIGNING_MASTER_KEY_PREVIOUS",
        example: example.commented("k1:<base64 key>"),
      },
      {
        name: "SIGNING_TRUST_STORE_FILE",
        example: example.commented(""),
      },
    ],
  },
  {
    title: "Outbound requests to customer-configured URLs (optional)",
    intro: [
      "Webhooks and the generic HTTP ERP integration call URLs a laboratory",
      "configures. They are refused when the host resolves to a private address",
      "(see DEPLOYMENT.md). List a host here only to reach, say, an ERP on your LAN.",
    ],
    variables: [
      {
        name: "OUTBOUND_ALLOW_PRIVATE_HOSTS",
        example: example.commented("erp.lan,10.20.0.0/24"),
      },
      {
        name: "OUTBOUND_ALLOW_INSECURE_HTTP",
        example: example.commented("false"),
      },
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
      {
        name: "TRUSTED_PROXY_HOPS",
        description:
          "Reverse proxies in front of the API that append the client's address to X-Forwarded-For (1: the Caddy of this setup; 2 with a load balancer in front of it).",
        example: example.commented("1"),
      },
    ],
  },
  {
    title: "Logs and memory limits (optional)",
    intro: [
      "Every service rotates its container logs and is capped in memory, so one",
      "runaway process cannot take the whole machine down. The defaults suit a",
      "laboratory on a 4 GB server (limits are ceilings, not reservations: the",
      "sum may exceed the RAM). Raise a limit if `docker compose ps` shows a",
      "service restarting with exit code 137 (killed for memory).",
    ],
    variables: [
      {
        name: "LOG_MAX_SIZE",
        description: "Largest container log file before Docker rotates it.",
        example: example.commented("10m"),
      },
      {
        name: "LOG_MAX_FILE",
        description: "Rotated log files kept per container.",
        example: example.commented("5"),
      },
      {
        name: "MEM_LIMIT_API",
        description: "Memory limit of the API.",
        example: example.commented("1g"),
      },
      {
        name: "MEM_LIMIT_WORKER",
        description:
          "Memory limit of the background worker (certificate signing and PDF handling).",
        example: example.commented("1g"),
      },
      {
        name: "MEM_LIMIT_INIT",
        description:
          "Memory limit of the one-shot `init` (schema and migrations).",
        example: example.commented("1g"),
      },
      {
        name: "MEM_LIMIT_WEB",
        description: "Memory limit of the lab app's static server.",
        example: example.commented("192m"),
      },
      {
        name: "MEM_LIMIT_PORTAL",
        description: "Memory limit of the client portal's static server.",
        example: example.commented("192m"),
      },
      {
        name: "MEM_LIMIT_POSTGRES",
        description:
          "Memory limit of PostgreSQL. Do not set it below what shared_buffers and your connections need: an out-of-memory kill of the database is the worst outcome here.",
        example: example.commented("1g"),
      },
      {
        name: "MEM_LIMIT_S3",
        description: "Memory limit of the bundled object store.",
        example: example.commented("512m"),
      },
      {
        name: "MEM_LIMIT_GOTENBERG",
        description:
          "Memory limit of the PDF renderer (Chromium and LibreOffice), the heaviest service.",
        example: example.commented("1536m"),
      },
      {
        name: "MEM_LIMIT_CADDY",
        description: "Memory limit of the HTTPS proxy.",
        example: example.commented("256m"),
      },
      {
        name: "MEM_LIMIT_MAILPIT",
        description: "Memory limit of the optional test inbox.",
        example: example.commented("128m"),
      },
      {
        name: "MEM_LIMIT_BACKUP",
        description: "Memory limit of the optional backup service.",
        example: example.commented("256m"),
      },
    ],
  },
  {
    title: "Database timeouts of the application role (optional)",
    intro: [
      "`init` sets these on the calibra_app role only (ALTER ROLE ... SET), so a",
      "runaway statement or a forgotten open transaction is ended by the server.",
      "The owner role, migrations and the system sweeps are not affected. 0 turns",
      "a timeout off. They apply to new connections: restart the API and worker.",
    ],
    variables: [
      {
        name: "DB_APP_STATEMENT_TIMEOUT_MS",
        description:
          "statement_timeout of calibra_app, in milliseconds. Default 120000 (2 minutes).",
        example: example.commented("120000"),
      },
      {
        name: "DB_APP_IDLE_IN_TRANSACTION_TIMEOUT_MS",
        description:
          "idle_in_transaction_session_timeout of calibra_app, in milliseconds. Default 60000 (1 minute).",
        example: example.commented("60000"),
      },
    ],
  },
  {
    title: "Backups (optional, COMPOSE_PROFILES=backup)",
    intro: [
      "A daily pg_dump plus a mirror of the object-store buckets, kept in BACKUP_DIR",
      "on this machine. Copy them off the machine too (BACKUP_OFFSITE_*, or your own",
      "tool). Read docs/operations/backup-restore.md before relying on them; test a",
      "restore. The master keys in .env are NOT part of the backup: keep .env safe",
      "separately.",
    ],
    variables: [
      {
        name: "COMPOSE_PROFILES",
        description:
          "Compose profiles to start: `backup` (scheduled backups), `mailpit` (test inbox). Comma-separated.",
        example: example.commented("backup"),
      },
      {
        name: "BACKUP_DIR",
        description:
          "Where the backup service writes (host path, relative to deploy/). Contains personal data: keep it private.",
        example: example.commented("./backups"),
      },
      {
        name: "BACKUP_SCHEDULE",
        description: "Time of the daily backup, HH:MM in UTC.",
        example: example.commented("02:30"),
      },
      {
        name: "BACKUP_ON_START",
        description:
          "`true` also takes a backup shortly after the service starts (so every `docker compose up` leaves a fresh one).",
        example: example.commented("true"),
      },
      {
        name: "BACKUP_RETENTION_DAYS",
        description: "Days to keep database dumps.",
        example: example.commented("14"),
      },
      {
        name: "BACKUP_KEEP_MIN",
        description:
          "Newest dumps that are never deleted, however old (a stopped service must not empty the folder).",
        example: example.commented("3"),
      },
      {
        name: "BACKUP_AGE_RECIPIENT",
        description:
          "age public key(s), comma-separated: dumps are encrypted to them (age-keygen makes the pair; keep the private key OFF this machine). Empty: dumps are not encrypted.",
        example: example.commented("age1..."),
      },
      {
        name: "BACKUP_FILES",
        description:
          "`false` skips the mirror of the object-store buckets (certificate PDFs, uploads).",
        example: example.commented("true"),
      },
      {
        name: "BACKUP_OFFSITE_URI",
        description:
          "s3://bucket/prefix of an off-site copy of BACKUP_DIR (any S3-compatible store). Empty: no off-site copy.",
        example: example.commented("s3://my-backups/calibra"),
      },
      {
        name: "BACKUP_OFFSITE_ENDPOINT",
        description:
          "Endpoint of the off-site store; empty for AWS S3 (e.g. https://<account>.r2.cloudflarestorage.com for R2).",
        example: example.commented(""),
      },
      {
        name: "BACKUP_OFFSITE_REGION",
        description:
          "Region of the off-site store (default us-east-1; auto for R2).",
        example: example.commented(""),
      },
      {
        name: "BACKUP_OFFSITE_ACCESS_KEY_ID",
        description: "Access key of the off-site store (write-only is enough).",
        example: example.commented(""),
      },
      {
        name: "BACKUP_OFFSITE_SECRET_ACCESS_KEY",
        description: "Secret key of the off-site store.",
        example: example.commented(""),
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
        description:
          "Password of the bundled PostgreSQL's owner role (migrations, the system path).",
        example: example.generated(),
      },
      {
        name: "CALIBRA_APP_PASSWORD",
        description:
          "Password of calibra_app, the role the API and worker connect as (row-level security binds it). `init` creates the login and sets this password on every start.",
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
