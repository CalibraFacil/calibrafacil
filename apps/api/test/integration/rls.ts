import { afterEach } from "vitest";
import {
  createRoleDatabase,
  type RoleDatabase,
} from "@calibra-facil/db/role-connection";
import { assertHarnessWorkerDb } from "./guard";

// Shadow tier of row-level security (roadmap P2-3). The test Postgres user is a
// superuser, which no policy binds; a connection that starts with
// `role = calibra_app` is an ordinary role subject to the grants and the
// `tenant_isolation` policies of migration 0121. Seed with the global `db` (the
// owner: every row visible and writable), exercise with `openAppRoleDb()`.

const open: RoleDatabase[] = [];

/**
 * A single-connection pool on this worker's database whose sessions run as
 * `calibra_app`. Closed automatically after the test. One connection, so that a
 * leak of a transaction-local setting to the next transaction on a pooled
 * connection would be observed, not dodged.
 */
export function openAppRoleDb(): RoleDatabase {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  // Same last line of defence as truncateAll(): only a per-worker harness database.
  assertHarnessWorkerDb(url);
  const database = createRoleDatabase(url, { role: "calibra_app", max: 1 });
  open.push(database);
  return database;
}

afterEach(async () => {
  const closing = open.splice(0).map((database) => database.close());
  await Promise.all(closing);
});

/** The SQLSTATE of a rejected promise (walks `cause`: Drizzle wraps the driver error). */
export async function sqlStateOf(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    let current: unknown = error;
    for (let depth = 0; depth < 5 && current !== undefined; depth += 1) {
      if (typeof current === "object" && current !== null) {
        const code: unknown = Reflect.get(current, "code");
        if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
        current = Reflect.get(current, "cause");
      } else {
        break;
      }
    }
    throw error;
  }
  return "no error";
}
