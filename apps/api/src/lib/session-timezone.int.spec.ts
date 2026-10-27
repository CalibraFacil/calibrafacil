/**
 * session-timezone.int.spec.ts — roadmap 2 C5: every connection the application
 * opens runs in UTC, even when the database (or the role) has another default,
 * because the clients send TimeZone=UTC as a startup parameter, which takes
 * precedence over those defaults.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import { createRoleDatabase } from "@calibra-facil/db/role-connection";

function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return url;
}

async function currentDatabase(): Promise<string> {
  const rows: unknown = await db.execute(
    sql`select current_database() as name`,
  );
  const first = Array.isArray(rows) ? rows[0] : undefined;
  const name =
    typeof first === "object" && first !== null
      ? Reflect.get(first, "name")
      : undefined;
  if (typeof name !== "string") throw new Error("no database name");
  return name;
}

describe("session TimeZone (roadmap 2 C5)", () => {
  let name = "";

  beforeAll(async () => {
    name = await currentDatabase();
    // A database default other than UTC: a new session would start in it.
    await db.execute(
      sql.raw(`alter database "${name}" set timezone = 'America/Sao_Paulo'`),
    );
  });

  afterAll(async () => {
    await db.execute(sql.raw(`alter database "${name}" reset timezone`));
  });

  it("a new application connection is in UTC despite the database default", async () => {
    const app = createRoleDatabase(databaseUrl(), { max: 1 });
    try {
      const rows: unknown = await app.db.execute(
        sql`select current_setting('TimeZone') as tz`,
      );
      const first = Array.isArray(rows) ? rows[0] : undefined;
      expect(
        typeof first === "object" && first !== null
          ? Reflect.get(first, "tz")
          : undefined,
      ).toBe("UTC");
    } finally {
      await app.close();
    }
  });
});
