// Bring a database to the current schema: `pnpm --dir packages/db db:bootstrap`.
//
//  - New (empty) database: the historical migration chain cannot be replayed
//    from scratch, so the schema is pushed from src/schema.ts, then
//    sql/schema-extras.sql adds what schema.ts cannot express (extensions,
//    partial/expression indexes, CHECK constraints), and every existing
//    migration is recorded as applied. Later migrations then apply normally.
//  - Existing database: pending migrations are applied with `drizzle-kit migrate`.
//
// Reads DATABASE_URL (packages/db/.env is loaded by drizzle.config.ts and here).
// Runs under Node or Bun; drizzle-kit runs under whichever started this script,
// so it also works in the Bun-only API image.
import "dotenv/config";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const packageDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set (see packages/db/.env.example)");
  process.exit(1);
}

// drizzle-kit's CLI entry point (its package exports only the library).
const drizzleKitBin = path.join(
  path.dirname(createRequire(import.meta.url).resolve("drizzle-kit")),
  "bin.cjs",
);
function drizzleKit(args) {
  execFileSync(process.execPath, [drizzleKitBin, ...args], {
    cwd: packageDir,
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
}

const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });

try {
  const [{ count }] = await sql`
    select count(*)::int as count
    from information_schema.tables
    where table_schema = 'public'
  `;

  if (count > 0) {
    console.log("Existing database: applying pending migrations.");
    await sql.end();
    drizzleKit(["migrate"]);
    process.exit(0);
  }

  console.log("Empty database: pushing the schema from src/schema.ts.");
  drizzleKit(["push", "--force"]);

  console.log("Applying sql/schema-extras.sql.");
  await sql.unsafe(
    readFileSync(path.join(packageDir, "sql/schema-extras.sql"), "utf8"),
  );

  console.log("Recording existing migrations as applied.");
  const journal = JSON.parse(
    readFileSync(path.join(packageDir, "drizzle/meta/_journal.json"), "utf8"),
  );
  await sql`create schema if not exists drizzle`;
  await sql`
    create table if not exists drizzle.__drizzle_migrations (
      id serial primary key,
      hash text not null,
      created_at bigint
    )
  `;
  for (const entry of journal.entries) {
    const contents = readFileSync(
      path.join(packageDir, "drizzle", `${entry.tag}.sql`),
      "utf8",
    );
    const hash = createHash("sha256").update(contents).digest("hex");
    await sql`
      insert into drizzle.__drizzle_migrations (hash, created_at)
      values (${hash}, ${entry.when})
    `;
  }
  console.log(
    `Database ready (${journal.entries.length} migrations recorded).`,
  );
} finally {
  await sql.end({ timeout: 5 }).catch(() => {});
}
