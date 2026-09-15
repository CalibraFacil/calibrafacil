// Safety guard for the real-DB integration tier (worker).
//
// Cloned VERBATIM from apps/api/test/integration/guard.ts — it is data-layer
// agnostic. This tier TRUNCATEs every public table between tests, so it must
// ONLY ever point at an ephemeral/local Postgres (the per-run Docker container,
// or a disposable CI service container). On 2026-06-22 a broken Docker setup led
// a run to fall back to the dev DATABASE_URL from packages/db/.env and TRUNCATE
// the shared Neon DEV database. This guard makes that impossible: it refuses any
// non-local host, and ALWAYS refuses a Neon host, no matter what.
//
// Wired into the three places that can touch a database destructively:
//   - global-setup.ts  (before `drizzle-kit push`)
//   - setup.ts         (before setting process.env.DATABASE_URL per worker)
//   - db.ts            (inside truncateAll, the last line of defense)

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", ""]);

/**
 * Throw unless `rawUrl` points at a local/ephemeral Postgres. A Neon host is
 * rejected unconditionally; any other non-local host requires the explicit
 * opt-in `CF_INT_ALLOW_REMOTE_DB=1` (only for a disposable CI service container).
 * Returns the url unchanged so callers can write `x = assertEphemeralTestDb(x)`.
 */
export function assertEphemeralTestDb(rawUrl: string | undefined): string {
  if (!rawUrl) {
    throw new Error(
      "[int-guard] DATABASE_URL is not set for the integration tier — refusing to run.",
    );
  }

  let host: string;
  try {
    host = new URL(rawUrl).hostname;
  } catch {
    throw new Error(
      "[int-guard] DATABASE_URL is not a valid URL — refusing to run.",
    );
  }

  if (host.endsWith("neon.tech")) {
    throw new Error(
      `[int-guard] REFUSING to run the TRUNCATE-based integration suite against a Neon host (${host}). ` +
        "This tier wipes every table; it must only target the ephemeral Docker Postgres. " +
        "If Docker is broken, fix Docker — never point this suite at a real database.",
    );
  }

  const allowRemote = process.env.CF_INT_ALLOW_REMOTE_DB === "1";
  if (!LOCAL_HOSTS.has(host) && !allowRemote) {
    throw new Error(
      `[int-guard] REFUSING to run the integration suite against non-local host "${host}". ` +
        "Set CF_INT_ALLOW_REMOTE_DB=1 only for a disposable CI service-container Postgres.",
    );
  }

  return rawUrl;
}
