import {
  createRatchet,
  isTestFile,
  normalizedFilename,
  type Baseline,
  type RuleContext,
  type RuleModule,
} from "../lib/rule-support.ts";

// Environment variables are read in ONE place, packages/config: one Zod schema
// per runtime declares every variable's type, default, whether production
// requires it and what it does, and each process validates it when it starts.
// A raw `process.env.X` (or `Bun.env.X`) read elsewhere is a setting the schema
// does not know: it surfaces misconfiguration at first use, deep in a request,
// and never reaches the generated .env.example.
//
// Read the typed configuration instead: `loadApiConfig()` / `loadWorkerConfig()`
// at start-up, or a concern reader (`readDatabaseConfig()`, `readJobsConfig()`,
// ...) in a library several runtimes share. `rawEnv()` and `setProcessEnv()`
// from @calibra-facil/config are the sanctioned escape hatches.
//
// Allowed inside packages/config and in tests/test support. The remaining
// sites are grandfathered as exact per-file counts (LEGACY_BASELINE, the same
// ratchet as the other calibra rules): a file may never gain one, and a
// migrated site should lower its file's count in the same change.

const ALLOWED_PATTERN =
  /(^|\/)(packages\/config\/|(test|tests|e2e|e2e-stack)\/|vitest\.[^/]*$|playwright[^/]*$)/;

const LEGACY_BASELINE: Baseline = new Map<string, number>([
  ["apps/api/scripts/build-vercel-deployment.mjs", 1],
  ["apps/api/src/cli/create-lab.ts", 1],
  ["apps/api/src/cli/init.ts", 2],
  ["apps/api/src/cli/seed-demo/api.ts", 3],
  ["apps/api/src/cli/seed-demo.ts", 3],
  ["apps/api/src/modules/jobs/helpers.ts", 1],
  ["apps/api/src/routes/email-domains.ts", 1],
  ["apps/api/src/routes/invitations.ts", 2],
  ["apps/api/src/routes/lab-setup.ts", 2],
  ["apps/api/src/routes/profile-media.ts", 1],
  ["apps/api/src/routes/public-signup.ts", 1],
  ["apps/api/src/routes/sso.ts", 4],
  ["apps/api/src/routes/webhooks.ts", 1],
  ["apps/desktop/src/main/local-server-manager.ts", 17],
  ["apps/desktop/src/main/main.ts", 6],
  ["apps/desktop/src/main/updater.ts", 2],
  ["apps/docs/lib/site.ts", 2],
  ["apps/portal/scripts/check-bundle-size.mjs", 5],
  ["apps/site/scripts/build-docs.mjs", 1],
  ["apps/web/scripts/check-bundle-size.mjs", 7],
  ["apps/web/scripts/render-og.mjs", 1],
  ["packages/auth/src/auth.ts", 3],
  ["packages/db/scripts/audit-method-dimensions.mjs", 2],
  ["packages/db/scripts/backfill-as-found-verdicts.mjs", 2],
  ["packages/db/scripts/backfill-mass-composition-profile.mjs", 2],
  ["packages/db/scripts/bootstrap.mjs", 2],
  ["packages/db/scripts/migrate-p12-encryption.mjs", 2],
  ["packages/db/scripts/seed-dev-lab.ts", 1],
  ["packages/db/scripts/strip-metrology-data-composition-profiles.mjs", 2],
  ["packages/shared/src/storage-endpoint.ts", 1],
  ["scripts/bench-api.mjs", 10],
  ["scripts/build-desktop-artifact.mjs", 1],
  ["scripts/ci-local.mjs", 1],
  ["scripts/dev-runner.mjs", 1],
  ["scripts/dev-setup.mjs", 3],
  ["scripts/smoke-desktop-electron.mjs", 2],
  ["scripts/smoke-desktop-local-server.mjs", 1],
  ["scripts/smoke-desktop-packaged-offline.mjs", 6],
  ["scripts/static-server.ts", 4],
  ["scripts/typecheck.mjs", 3],
  ["scripts/vercel-ignore-build.mjs", 2],
]);

const MESSAGE =
  "Do not read the environment directly. Add the variable to the schema in packages/config and read it through loadApiConfig()/loadWorkerConfig() or a concern reader (readDatabaseConfig(), readJobsConfig(), ...).";

type UnknownRecord = Record<string, unknown>;

function toRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" ? Object(value) : null;
}

function nameOf(node: unknown): string | null {
  const record = toRecord(node);
  if (!record) return null;
  if (record.type === "Identifier" && typeof record.name === "string") {
    return record.name;
  }
  if (record.type === "Literal" && typeof record.value === "string") {
    return record.value;
  }
  return null;
}

/** `process.env` / `process["env"]` / `Bun.env`. */
function isEnvAccess(node: unknown): boolean {
  const member = toRecord(node);
  if (!member || member.type !== "MemberExpression") return false;
  const object = toRecord(member.object);
  if (object?.type !== "Identifier") return false;
  const owner = object.name;
  if (owner !== "process" && owner !== "Bun") return false;
  // `process.env` has a plain identifier key; `process["env"]` a string literal.
  const key =
    member.computed === true
      ? nameOf(member.property) !== null &&
        toRecord(member.property)?.type === "Literal"
        ? nameOf(member.property)
        : null
      : nameOf(member.property);
  return key === "env";
}

const rule: RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow reading process.env / Bun.env outside packages/config; read the typed configuration instead.",
    },
  },
  create(context: RuleContext) {
    const filename = normalizedFilename(context);
    if (ALLOWED_PATTERN.test(filename) || isTestFile(filename)) return {};

    const ratchet = createRatchet(LEGACY_BASELINE, filename);
    return {
      MemberExpression(node: unknown) {
        if (!isEnvAccess(node)) return;
        if (!ratchet.exceeds()) return;
        context.report({ node, message: MESSAGE });
      },
    };
  },
};

export default rule;
