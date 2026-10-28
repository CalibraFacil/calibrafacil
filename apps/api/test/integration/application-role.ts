import { getDb, getSystemDb } from "@calibra-facil/db";
import { assertHarnessWorkerDb } from "./guard";

// The API as it runs after the role split (docs/operations/row-level-security.md):
// `DATABASE_URL` is a session of `calibra_app` (bound by the `tenant_isolation`
// policies) and `DATABASE_OWNER_URL` is the table owner, which only the named
// system path (`systemDb` / `getSystemDb()`) uses. A spec seeds and asserts as the
// owner (the harness) and runs the code under test inside `asApplicationRole`.
//
// The environment is read lazily by `@calibra-facil/db` (`getDb()` keys its pool
// on it), so flipping it re-points `db` at a new `calibra_app` pool and
// `systemDb` at the owner pool, with no change to the modules under test. Code
// that captured a pool BEFORE the flip (a long-lived singleton) is not re-pointed:
// build what you test inside `work`.

function applicationRoleUrl(ownerUrl: string): string {
  const url = new URL(ownerUrl);
  url.searchParams.set("options", "-c role=calibra_app");
  return url.toString();
}

/** A closer for the postgres.js client behind a Drizzle instance. */
function closerOf(database: object): () => Promise<void> {
  const client: unknown = Reflect.get(database, "$client");
  const end: unknown =
    client && typeof client === "object" ? Reflect.get(client, "end") : null;
  if (typeof end !== "function") return async () => undefined;
  return async () => {
    await Reflect.apply(end, client, [{ timeout: 5 }]);
  };
}

/**
 * Runs `work` with the application connection as `calibra_app` and the system
 * path as the owner (`DATABASE_OWNER_URL`), then restores the owner environment
 * and closes the pools it replaced, so a spec that flips many times does not
 * accumulate connections.
 */
export async function asApplicationRole<T>(work: () => Promise<T>): Promise<T> {
  const ownerUrl = process.env.DATABASE_URL;
  if (!ownerUrl) throw new Error("DATABASE_URL is not set");
  // Same last line of defence as truncateAll(): only a per-worker harness database.
  assertHarnessWorkerDb(ownerUrl);
  const previous = {
    owner: process.env.DATABASE_OWNER_URL,
    mode: process.env.DATABASE_RLS_MODE,
  };
  const closeOwnerPool = closerOf(getDb());
  process.env.DATABASE_URL = applicationRoleUrl(ownerUrl);
  process.env.DATABASE_OWNER_URL = ownerUrl;
  process.env.DATABASE_RLS_MODE = "enforced";
  const closeApplicationPool = closerOf(getDb());
  // Open the system path's owner pool (the owner URL, not this role).
  getSystemDb();
  try {
    return await work();
  } finally {
    process.env.DATABASE_URL = ownerUrl;
    if (previous.owner === undefined) delete process.env.DATABASE_OWNER_URL;
    else process.env.DATABASE_OWNER_URL = previous.owner;
    if (previous.mode === undefined) delete process.env.DATABASE_RLS_MODE;
    else process.env.DATABASE_RLS_MODE = previous.mode;
    await closeApplicationPool();
    await closeOwnerPool();
  }
}
