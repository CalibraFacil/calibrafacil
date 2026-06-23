import { beforeEach, inject, vi } from "vitest";

// Per-worker setup for the integration tier. Runs before any test file, so:
//  1) point the real `db` at the test Postgres (Proxy reads DATABASE_URL lazily),
//  2) install ONE global mock of the better-auth lab session — the ONLY thing we
//     fake. requireLabAuth -> requireOrganization -> requirePermission and the
//     unit-scope resolver all run for real against the seeded DB.
process.env.DATABASE_URL = inject("testDatabaseUrl");

const { getSessionMock } = vi.hoisted(() => ({ getSessionMock: vi.fn() }));

vi.mock("@calibra-facil/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@calibra-facil/auth")>();
  return {
    ...actual,
    createLabAuth: () => ({ api: { getSession: getSessionMock } }),
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

beforeEach(() => {
  getSessionMock.mockReset();
});
