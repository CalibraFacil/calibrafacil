import { defineReader, defineRuntime, type ConfigIssue } from "./define";
import { authGroup } from "./groups/auth";
import { databaseGroup } from "./groups/database";
import { emailGroup } from "./groups/email";
import { portalGroup, webGroup } from "./groups/frontends";
import {
  integrationsGroup,
  outboundGroup,
  signingGroup,
} from "./groups/integrations";
import { jobsGroup } from "./groups/jobs";
import { localServerGroup } from "./groups/local-server";
import { originsGroup } from "./groups/origins";
import { observabilityGroup, retentionGroup } from "./groups/retention";
import { runtimeGroup } from "./groups/runtime";
import { SYNC_MIN_DESKTOP_VERSION_PATTERN, syncGroup } from "./groups/sync";
import { renderingGroup, storageGroup } from "./groups/storage";

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

type SigningSettings = {
  readonly masterKeyId: string | undefined;
  readonly masterKeyPrevious: string | undefined;
};

const KEK_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const BASE64_KEY = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * The key ring of the signing credentials (envelope encryption, roadmap 2 B4a):
 * a bad id or a malformed previous key would only surface when a certificate has
 * to be signed, so it stops the start instead. The shapes mirror
 * `createSigningKeyring` in @calibra-facil/signing, which is what parses them.
 */
function signingIssues(signing: SigningSettings): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const currentId = signing.masterKeyId ?? "k1";
  if (signing.masterKeyId !== undefined && !KEK_ID.test(signing.masterKeyId)) {
    issues.push({
      variable: "SIGNING_MASTER_KEY_ID",
      message:
        "must be 1-64 letters, digits, `_`, `.` or `-` (it is stored with every sealed credential)",
    });
  }
  const seen = new Set<string>([currentId]);
  for (const raw of (signing.masterKeyPrevious ?? "").split(",")) {
    const entry = raw.trim();
    if (entry === "") continue;
    const separator = entry.indexOf(":");
    const id = separator === -1 ? "" : entry.slice(0, separator).trim();
    const key = separator === -1 ? "" : entry.slice(separator + 1).trim();
    const wellFormed =
      KEK_ID.test(id) && BASE64_KEY.test(key) && atob(key).length === 32;
    if (!wellFormed || seen.has(id)) {
      // Never echo the entry: it holds key material.
      issues.push({
        variable: "SIGNING_MASTER_KEY_PREVIOUS",
        message:
          "must be comma-separated `id:base64key` entries (32 random bytes each) with ids that are unique and differ from SIGNING_MASTER_KEY_ID",
      });
      break;
    }
    seen.add(id);
  }
  return issues;
}

/**
 * The API (apps/api): the Bun server and the CLI.
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
    sync: syncGroup,
    integrations: integrationsGroup,
    outbound: outboundGroup,
    signing: signingGroup,
    retention: retentionGroup,
    observability: observabilityGroup,
  },
  rules: (config, { isProduction }) => {
    const minimum = config.sync.minDesktopVersion;
    const versionIssues: ConfigIssue[] = [
      ...(minimum === undefined ||
      SYNC_MIN_DESKTOP_VERSION_PATTERN.test(minimum)
        ? []
        : [
            {
              variable: "SYNC_MIN_DESKTOP_VERSION",
              message:
                "must be a version such as 1.4.0 (MAJOR.MINOR.PATCH): an unreadable minimum would leave the legacy calibration-record exemption open",
            },
          ]),
      ...signingIssues(config.signing),
    ];
    if (!isProduction) return versionIssues;
    const issues = [...versionIssues, ...storageIssues(config.storage)];
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
 * drain server and the always-on Bun worker. It cannot do any work without
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
    outbound: outboundGroup,
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
  rules: (config) => [
    ...storageIssues(config.storage),
    ...signingIssues(config.signing),
  ],
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
export const readSyncConfig = defineReader(syncGroup);
export const readIntegrationsConfig = defineReader(integrationsGroup);
export const readOutboundConfig = defineReader(outboundGroup);
export const readSigningConfig = defineReader(signingGroup);
export const readRetentionConfig = defineReader(retentionGroup);
export const readObservabilityConfig = defineReader(observabilityGroup);
export const readLocalServerSettings = defineReader(localServerGroup);
