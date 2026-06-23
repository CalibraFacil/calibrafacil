import { beforeEach, inject, vi } from "vitest";
import { assertEphemeralTestDb } from "./guard";

// Per-worker setup for the integration tier. Runs before any test file, so:
//  1) point the real `db` at the test Postgres (Proxy reads DATABASE_URL lazily),
//  2) install ONE global mock of the better-auth lab session — the ONLY thing we
//     fake. requireLabAuth -> requireOrganization -> requirePermission and the
//     unit-scope resolver all run for real against the seeded DB.
// The guard refuses any remote/Neon host so this TRUNCATE-based tier can never
// wipe a real database (see the 2026-06-22 dev-DB incident).
process.env.DATABASE_URL = assertEphemeralTestDb(inject("testDatabaseUrl"));

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
