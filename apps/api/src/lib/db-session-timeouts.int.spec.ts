/**
 * db-session-timeouts.int.spec.ts: the application connections carry server-side
 * limits (roadmap 2 D4, review 3.2), so a runaway statement or a transaction left
 * open cannot hold a connection of the pool indefinitely.
 *
 *   REQ-D4-3  statement_timeout and idle_in_transaction_session_timeout are set
 *             on the DATABASE_URL session (defaults: 60 s each)
 */
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@calibra-facil/db";

describe("application session timeouts (roadmap 2 D4)", () => {
  it("REQ-D4-3: the application session has statement and idle-in-transaction timeouts", async () => {
    const result = await db.execute(sql`
      select
        current_setting('statement_timeout') as statement_timeout,
        current_setting('idle_in_transaction_session_timeout') as idle_timeout
    `);
    const rows = Array.isArray(result) ? result : result.rows;
    expect(rows[0]).toEqual({
      statement_timeout: "1min",
      idle_timeout: "1min",
    });
  });
});
