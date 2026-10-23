// A second connection pool whose sessions run as another database role, for the
// tests and the shadow report of row-level security (roadmap P2-3): the test
// superuser is exempt from every policy, so the policies are only exercised by a
// session that has switched to `calibra_app`. Nothing in the application imports
// this; the API still connects as the owner until the owner performs the role
// split (DEPLOYMENT.md, "Row-level security").
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";
import { APP_ROLE } from "./rls-sql";

export type RoleDatabase = {
  db: ReturnType<typeof drizzle<typeof schema>>;
  /** Closes the pool. */
  close: () => Promise<void>;
};

/**
 * Pool whose every connection starts with `role = <role>` (the `options`
 * startup parameter, `-c role=...`, the same as `PGOPTIONS`): each statement of
 * the pool is subject to the role's grants and policies. `max` defaults to 1 so a
 * test is deterministic about which connection holds a transaction-local setting.
 */
export function createRoleDatabase(
  connectionString: string,
  options: {
    /** Role to switch to; `null` keeps the login role (the owner / superuser). */
    role?: string | null;
    max?: number;
    /** Receives the message of every NOTICE/WARNING the server sends. */
    onNotice?: (message: string) => void;
    /** Receives every statement the pool executes (drizzle's logger hook). */
    onQuery?: (query: string) => void;
  } = {},
): RoleDatabase {
  const role = options.role === undefined ? APP_ROLE : options.role;
  const onNotice = options.onNotice;
  const onQuery = options.onQuery;
  const client = postgres(connectionString, {
    max: options.max ?? 1,
    fetch_types: false,
    onnotice: (notice) => {
      if (onNotice && typeof notice.message === "string") {
        onNotice(notice.message);
      }
    },
    ...(role === null ? {} : { connection: { options: `-c role=${role}` } }),
  });
  return {
    db: drizzle(client, {
      schema,
      ...(onQuery
        ? {
            logger: {
              logQuery(query: string) {
                onQuery(query);
              },
            },
          }
        : {}),
    }),
    close: () => client.end({ timeout: 5 }),
  };
}
