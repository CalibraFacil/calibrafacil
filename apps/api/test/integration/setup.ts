import { execSync } from "node:child_process";
import { beforeEach, inject, vi } from "vitest";
import { assertEphemeralTestDb } from "./guard";

// Per-worker setup for the integration tier. Runs before any test file in this
// worker process. Each worker gets its OWN copy of the schema (calibra_w<id>)
// cloned from the template built by global-setup.ts, so test files run in
// PARALLEL without sharing or clobbering each other's data.
//
// Sequence inside each worker (forks pool):
//   1) VITEST_POOL_ID is set by vitest before this file is imported.
//   2) We derive a stable per-worker db name from VITEST_POOL_ID.
//   3) We DROP + CREATE the per-worker db from the template (idempotent so a
//      re-run of the same worker slot starts fresh).
//   4) We point process.env.DATABASE_URL at the per-worker db — the real `db`
//      Proxy reads it lazily on first access, so no change to packages/db.
//   5) We install ONE global mock of the better-auth lab session — the ONLY
//      thing we fake. requireLabAuth -> requireOrganization -> requirePermission
//      and the unit-scope resolver all run for real against the seeded DB.
//
// Guard: assertEphemeralTestDb is called on the per-worker URL to ensure we
// never accidentally point this suite at a non-local host.

// ─────────────────────────────────────────────────────────────────────────────
// Step 1-4: create per-worker database
// ─────────────────────────────────────────────────────────────────────────────

const baseUrl = inject("testDbBaseUrl");
const template = inject("testDbTemplate");

// VITEST_POOL_ID is set to a stable integer (1..maxForks) for the lifetime of
// this worker process by vitest before setupFiles are imported. Falls back to
// "0" in any environment where the variable is absent.
const poolId = process.env.VITEST_POOL_ID ?? "0";
const workerDbName = `calibra_w${poolId}`;
const workerUrl = `${baseUrl}/${workerDbName}`;

// Guard: refuse to operate against a remote/Neon host even if env is wrong.
assertEphemeralTestDb(workerUrl);

/** Build PG env vars for psql from a postgres:// URL (no db name in URL). */
function pgEnvFromBaseUrl(rawBaseUrl: string): Record<string, string> {
  const u = new URL(`${rawBaseUrl}/postgres`);
  return {
    PGHOST: u.hostname,
    PGPORT: u.port || "5432",
    PGUSER: decodeURIComponent(u.username || "postgres"),
    PGPASSWORD: decodeURIComponent(u.password || ""),
  };
}

const pgEnv = { ...process.env, ...pgEnvFromBaseUrl(baseUrl) };

// DROP (idempotent: previous run may have left the db) then CREATE from template.
// CREATE DATABASE cannot run inside a transaction; psql executes each -c command
// as a separate statement outside any implicit transaction, satisfying PG's
// requirement. We use PG env vars to avoid shell-quoting issues with passwords.
execSync(
  `psql -d postgres -c "DROP DATABASE IF EXISTS ${workerDbName}" -c "CREATE DATABASE ${workerDbName} TEMPLATE ${template}"`,
  { env: pgEnv, stdio: "inherit" },
);

// Point the real db Proxy at this worker's database.
process.env.DATABASE_URL = workerUrl;

// ─────────────────────────────────────────────────────────────────────────────
// Step 5: mock better-auth sessions
// ─────────────────────────────────────────────────────────────────────────────

const { getSessionMock, backofficeGetSessionMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  backofficeGetSessionMock: vi.fn(),
}));

vi.mock("@calibra-facil/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@calibra-facil/auth")>();
  return {
    ...actual,
    createLabAuth: () => ({ api: { getSession: getSessionMock } }),
    // Backoffice routes use a SEPARATE Better-Auth instance (platform/operator,
    // not a lab member). Mock its getSession too; the real requireBackofficeAccess
    // / requirePlatformAdmin run against the mocked session's user.role.
    createBackofficeAuth: () => ({
      api: { getSession: backofficeGetSessionMock },
    }),
  };
});

export type TestSession = {
  user: {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    role: string | null;
    banned: boolean;
    createdAt: Date;
    updatedAt: Date;
  };
  session: {
    id: string;
    userId: string;
    activeOrganizationId: string;
    expiresAt: Date;
    createdAt: Date;
    updatedAt: Date;
    token: string;
    impersonatedBy: string | null;
  };
};

/** Build the SessionData shape requireLabAuth expects for a seeded user/org. */
export function sessionFor(params: {
  userId: string;
  organizationId: string;
}): TestSession {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    user: {
      id: params.userId,
      name: "Test User",
      email: `${params.userId}@lab.test`,
      emailVerified: true,
      role: null,
      banned: false,
      createdAt: now,
      updatedAt: now,
    },
    session: {
      id: `sess-${params.userId}`,
      userId: params.userId,
      activeOrganizationId: params.organizationId,
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
      createdAt: now,
      updatedAt: now,
      token: `tok-${params.userId}`,
      impersonatedBy: null,
    },
  };
}

/** Authenticate subsequent requests as the given seeded user/org. */
export function loginAs(params: { userId: string; organizationId: string }) {
  getSessionMock.mockResolvedValue(sessionFor(params));
}

/** Make the next request unauthenticated (getSession -> null -> 401). */
export function logout() {
  getSessionMock.mockResolvedValue(null);
}

/**
 * Build a backoffice (platform) SessionData. `role` is the raw platform-role
 * string parsed by parsePlatformRoles (e.g. "platform_admin", "platform_operator",
 * "user", or a comma-separated set). Backoffice auth does not require an org, but
 * we reuse the valid SessionData shape so requireSessionData passes.
 */
export function sessionForBackoffice(params: {
  userId: string;
  role: string;
}): TestSession {
  const base = sessionFor({
    userId: params.userId,
    organizationId: "platform",
  });
  return { ...base, user: { ...base.user, role: params.role } };
}

/** Authenticate subsequent backoffice requests as the given platform user. */
export function loginAsBackoffice(params: { userId: string; role: string }) {
  backofficeGetSessionMock.mockResolvedValue(sessionForBackoffice(params));
}

/** Make the next backoffice request unauthenticated (401). */
export function logoutBackoffice() {
  backofficeGetSessionMock.mockResolvedValue(null);
}

beforeEach(() => {
  getSessionMock.mockReset();
  backofficeGetSessionMock.mockReset();
});
