import { inject } from "vitest";
import { assertEphemeralTestDb } from "./guard";

// Per-worker setup for the worker integration tier. Runs before any test file.
// Unlike the api tier, the worker has NO auth: there is nothing to mock. We only
// point the real `db` (drizzle, used for seeding) at the test Postgres — the
// Proxy reads DATABASE_URL lazily — and the worker handlers' own raw `pg.Client`
// reads the same DATABASE_URL. The guard refuses any remote/Neon host so this
// TRUNCATE-based tier can never wipe a real database (see the 2026-06-22 dev-DB
// incident).
process.env.DATABASE_URL = assertEphemeralTestDb(inject("testDatabaseUrl"));
