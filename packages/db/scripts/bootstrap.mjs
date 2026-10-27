// Bring a database to the current schema: `pnpm --dir packages/db db:bootstrap`.
//
//  - New (empty) database: the historical migration chain cannot be replayed
//    from scratch, so the schema is pushed from src/schema.ts, then
//    sql/schema-extras.sql adds what schema.ts cannot express (extensions,
//    partial/expression indexes, CHECK constraints), and every existing
//    migration is recorded as applied. Later migrations then apply normally.
//  - Existing database: pending migrations are applied with `drizzle-kit migrate`.
//
// It runs as the table OWNER: DATABASE_OWNER_URL when set, else DATABASE_URL
// (packages/db/.env is loaded by drizzle.config.ts and here). When the
// application's DATABASE_URL names the login `calibra_app` and differs from the
// owner (the normal role split, DEPLOYMENT.md "Row-level security"), the script
// finally makes sure that role can log in with the password of that URL
// (CREATE/ALTER ROLE, idempotent), so one command prepares the whole database. It
// also sets statement_timeout and idle_in_transaction_session_timeout on that role
// only (ALTER ROLE ... SET): the owner, migrations and sweeps are unaffected.
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
const {
  DATABASE_URL: applicationUrl,
  DATABASE_OWNER_URL: ownerUrl,
  DB_APP_STATEMENT_TIMEOUT_MS: statementTimeoutEnv,
  DB_APP_IDLE_IN_TRANSACTION_TIMEOUT_MS: idleTimeoutEnv,
} = process.env;
const databaseUrl = ownerUrl || applicationUrl;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set (see packages/db/.env.example)");
  process.exit(1);
}

/** The login of the application, when it is calibra_app and not the owner's own URL. */
function applicationLogin() {
  if (!applicationUrl || applicationUrl === databaseUrl) return null;
  const parsed = new URL(applicationUrl);
  if (decodeURIComponent(parsed.username) !== "calibra_app") return null;
  return { password: decodeURIComponent(parsed.password) };
}

// Session timeouts of the application role (milliseconds; 0 turns one off). A
// statement that runs this long is a bug or a runaway query, and a transaction
// left idle holds locks and a connection: the server ends both instead of letting
// them pile up. Override with DB_APP_STATEMENT_TIMEOUT_MS and
// DB_APP_IDLE_IN_TRANSACTION_TIMEOUT_MS (deploy/.env).
const DEFAULT_STATEMENT_TIMEOUT_MS = 120_000;
const DEFAULT_IDLE_IN_TRANSACTION_TIMEOUT_MS = 60_000;

function timeoutFromEnv(name, raw, fallback) {
  raw = raw?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    console.error(`${name} must be a whole number of milliseconds (0 = off).`);
    process.exit(1);
  }
  return value;
}

/** calibra_app exists since migration 0123 (NOLOGIN); the dev and compose stacks log in as it. */
async function ensureApplicationLogin(sql) {
  const login = applicationLogin();
  if (!login) return;
  if (!login.password) {
    console.error(
      "DATABASE_URL names calibra_app without a password; the role cannot be given a login.",
    );
    process.exit(1);
  }
  await sql.unsafe(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'calibra_app') THEN
        CREATE ROLE calibra_app;
      END IF;
    END $$`);
  // Only LOGIN and the password: a CREATEROLE owner that is not a superuser (Neon,
  // RDS, Supabase) may not touch the other attributes, and CREATE ROLE's defaults
  // (NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE) are the safe ones; start-up
  // refuses a superuser or BYPASSRLS application role anyway. The literal is quoted
  // by the server (format %L), never by hand.
  const [{ statement }] = await sql`
    select format('ALTER ROLE calibra_app LOGIN PASSWORD %L', ${login.password}::text) as statement`;
  await sql.unsafe(statement);
  console.log(
    "Role calibra_app: login enabled with the password of DATABASE_URL.",
  );

  const statementTimeout = timeoutFromEnv(
    "DB_APP_STATEMENT_TIMEOUT_MS",
    statementTimeoutEnv,
    DEFAULT_STATEMENT_TIMEOUT_MS,
  );
  const idleTimeout = timeoutFromEnv(
    "DB_APP_IDLE_IN_TRANSACTION_TIMEOUT_MS",
    idleTimeoutEnv,
    DEFAULT_IDLE_IN_TRANSACTION_TIMEOUT_MS,
  );
  // Integers validated above, so interpolating them is safe. Applies to new
  // sessions of the role; the application reconnects on its next start.
  await sql.unsafe(
    `ALTER ROLE calibra_app SET statement_timeout = ${statementTimeout}`,
  );
  await sql.unsafe(
    `ALTER ROLE calibra_app SET idle_in_transaction_session_timeout = ${idleTimeout}`,
  );
  console.log(
    `Role calibra_app: statement_timeout=${statementTimeout} ms, idle_in_transaction_session_timeout=${idleTimeout} ms.`,
  );
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
    const after = postgres(databaseUrl, { max: 1, onnotice: () => {} });
    try {
      await ensureApplicationLogin(after);
    } finally {
      await after.end({ timeout: 5 }).catch(() => {});
    }
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
  await ensureApplicationLogin(sql);
  console.log(
    `Database ready (${journal.entries.length} migrations recorded).`,
  );
} finally {
  await sql.end({ timeout: 5 }).catch(() => {});
}
