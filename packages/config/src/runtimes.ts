import { defineReader, defineRuntime, type ConfigIssue } from "./define.ts";
import { authGroup } from "./groups/auth.ts";
import { databaseGroup } from "./groups/database.ts";
import { emailGroup } from "./groups/email.ts";
import { portalGroup, webGroup } from "./groups/frontends.ts";
import { integrationsGroup, signingGroup } from "./groups/integrations.ts";
import { jobsGroup } from "./groups/jobs.ts";
import { localServerGroup } from "./groups/local-server.ts";
import { originsGroup } from "./groups/origins.ts";
import { observabilityGroup, retentionGroup } from "./groups/retention.ts";
import { runtimeGroup } from "./groups/runtime.ts";
import { renderingGroup, storageGroup } from "./groups/storage.ts";

type StorageSettings = {
  readonly accountId: string | undefined;
  readonly endpoint: string | undefined;
};

function storageIssues(storage: StorageSettings): ConfigIssue[] {
  return storage.accountId || storage.endpoint
    ? []
    : [
        {
          variable: "R2_ACCOUNT_ID",
          message:
            "R2_ACCOUNT_ID or R2_ENDPOINT is required (Cloudflare R2 account, or the endpoint of an S3-compatible store)",
        },
      ];
}

/**
 * The API (apps/api): the Bun server, the Vercel functions and the CLI.
 * Production refuses to start without its database, storage, keys and e-mail.
 */
export const apiRuntime = defineRuntime({
  name: "api",
  groups: {
    runtime: runtimeGroup,
    database: databaseGroup,
    origins: originsGroup,
    auth: authGroup,
    email: emailGroup,
    storage: storageGroup,
    rendering: renderingGroup,
    jobs: jobsGroup,
    integrations: integrationsGroup,
    signing: signingGroup,
    retention: retentionGroup,
    observability: observabilityGroup,
  },
  rules: (config, { isProduction }) => {
    if (!isProduction) return [];
    const issues = storageIssues(config.storage);
    // Sign-in is passwordless, so production cannot run without e-mail.
    if (config.email.transport === null) {
      issues.push({
        variable: "SMTP_HOST",
        message:
          "SMTP_HOST or RESEND_API_KEY is required in production: sign-in links are sent by e-mail",
      });
    }
    return issues;
  },
});

/**
 * The background worker (apps/worker): the queue poller, the document-worker
 * drain server and the Vercel Queue consumer. It cannot do any work without
 * its database, storage and keys, so those are required in development too.
 */
export const workerRuntime = defineRuntime({
  name: "worker",
  groups: {
    runtime: runtimeGroup,
    database: databaseGroup,
    origins: originsGroup,
    email: emailGroup,
    storage: storageGroup,
    rendering: renderingGroup,
    jobs: jobsGroup,
    integrations: integrationsGroup,
    signing: signingGroup,
    observability: observabilityGroup,
  },
  alwaysRequired: [
    "DATABASE_URL",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET_NAME",
    "SIGNING_MASTER_KEY",
    "INTEGRATIONS_MASTER_KEY",
  ],
  rules: (config) => storageIssues(config.storage),
});

/** The offline desktop server (apps/local-server). */
export const localServerRuntime = defineRuntime({
  name: "local-server",
  groups: { localServer: localServerGroup },
});

/** The lab app's `VITE_*` settings (build time and container start). */
export const webRuntime = defineRuntime({
  name: "web",
  groups: { web: webGroup },
});

/** The client portal's `VITE_*` settings. */
export const portalRuntime = defineRuntime({
  name: "portal",
  groups: { portal: portalGroup },
});

/** Every runtime, in the order the documentation lists them. */
export const RUNTIME_SPECS = [
  apiRuntime,
  workerRuntime,
  localServerRuntime,
  webRuntime,
  portalRuntime,
] as const;

// ---------------------------------------------------------------------------
// Concern readers, for libraries that several runtimes share. Types only:
// requirements are the runtime loader's job.
// ---------------------------------------------------------------------------

export const readRuntimeConfig = defineReader(runtimeGroup);
export const readDatabaseConfig = defineReader(databaseGroup);
export const readOriginsConfig = defineReader(originsGroup);
export const readAuthConfig = defineReader(authGroup);
export const readEmailConfig = defineReader(emailGroup);
export const readStorageConfig = defineReader(storageGroup);
export const readRenderingConfig = defineReader(renderingGroup);
export const readJobsConfig = defineReader(jobsGroup);
export const readIntegrationsConfig = defineReader(integrationsGroup);
export const readSigningConfig = defineReader(signingGroup);
export const readRetentionConfig = defineReader(retentionGroup);
export const readObservabilityConfig = defineReader(observabilityGroup);
export const readLocalServerSettings = defineReader(localServerGroup);
