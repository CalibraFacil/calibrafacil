import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classifyTables, GLOBAL_TABLES } from "./tenancy";
import {
  APPEND_ONLY_APP_ROLE_TABLES,
  APP_ROLE,
  POLICY_NAME,
  RLS_LOCK_TIMEOUT_SQL,
  RLS_MIGRATION_GUARD_SQL,
  RLS_ROLE_SQL,
  RLS_SQL_BEGIN,
  RLS_SQL_END,
  appRoleRevokeSql,
  rlsSqlBlock,
  rlsTables,
} from "./rls-sql";

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const MIGRATIONS_DIR = new URL("../drizzle/", import.meta.url);
const MIGRATION = "0123_rls_shadow_mode.sql";

/** The block between the generated markers of `text`, markers included. */
function blockOf(text: string): string | null {
  const begin = text.indexOf(RLS_SQL_BEGIN);
  if (begin === -1) return null;
  const end = text.indexOf(RLS_SQL_END, begin);
  if (end === -1) return null;
  return text.slice(begin, end + RLS_SQL_END.length);
}

/** Tables that `ENABLE ROW LEVEL SECURITY` in a block, in order. */
function enabledTables(block: string): string[] {
  return Array.from(
    block.matchAll(
      /^ALTER TABLE public\."([^"]+)" ENABLE ROW LEVEL SECURITY;$/gm,
    ),
    (match) => match[1] ?? "",
  );
}

/** Tables that get the tenant_isolation policy in a block. */
function policiedTables(block: string): string[] {
  return Array.from(
    block.matchAll(/^CREATE POLICY tenant_isolation ON public\."([^"]+)"/gm),
    (match) => match[1] ?? "",
  );
}

describe("row-level security SQL, generated from the tenancy classification", () => {
  it("REQ-RLS-1: the generated block enables RLS and creates the policy on exactly the tenant tables", () => {
    const tenant = classifyTables()
      .tenant.map((table) => table.name)
      .sort();
    const block = rlsSqlBlock();
    expect(tenant.length).toBeGreaterThan(100);
    expect([...enabledTables(block)].sort()).toEqual(tenant);
    expect([...policiedTables(block)].sort()).toEqual(tenant);
    expect(rlsTables().map((entry) => entry.table)).toEqual(
      [...tenant].sort((a, b) => a.localeCompare(b)),
    );
  });

  it("REQ-RLS-1: a global table gets no RLS, and RLS is enabled but never forced", () => {
    const block = rlsSqlBlock();
    for (const name of Object.keys(GLOBAL_TABLES)) {
      expect(block, name).not.toContain(`public."${name}"`);
    }
    expect(block).not.toMatch(/FORCE ROW LEVEL SECURITY/i);
    expect(block).not.toMatch(/NO FORCE/i);
  });

  it("REQ-RLS-1: the policy is USING and WITH CHECK on the table's own organization column, for calibra_app only", () => {
    const block = rlsSqlBlock();
    expect(block).toContain(
      `CREATE POLICY ${POLICY_NAME} ON public."asset" AS PERMISSIVE FOR ALL TO ${APP_ROLE}`,
    );
    expect(block).toContain(
      `USING ("lab_organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)`,
    );
    expect(block).toContain(
      `WITH CHECK ("lab_organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)`,
    );
    expect(block).toContain(
      `USING ("organization_id" = NULLIF(current_setting('calibra.organization_id', true), '')::text)`,
    );
    // Every policy has both halves.
    const using = block.match(/^ {2}USING \(/gm) ?? [];
    const check = block.match(/^ {2}WITH CHECK \(/gm) ?? [];
    expect(using).toHaveLength(rlsTables().length);
    expect(check).toHaveLength(rlsTables().length);
    expect(block).not.toMatch(/TO PUBLIC/i);
  });

  it("REQ-RLS-1: sql/schema-extras.sql carries exactly the block and the role the current classification generates", () => {
    const extras = read("../sql/schema-extras.sql");
    expect(blockOf(extras)).toBe(rlsSqlBlock());
    expect(extras).toContain(RLS_ROLE_SQL);
  });

  it("REQ-RLS-1: the newest migration that defines the block carries exactly what the current classification generates", () => {
    const defining = readdirSync(MIGRATIONS_DIR)
      .filter((name) => name.endsWith(".sql"))
      .sort()
      .filter((name) =>
        readFileSync(new URL(name, MIGRATIONS_DIR), "utf8").includes(
          RLS_SQL_BEGIN,
        ),
      );
    expect(
      defining.length,
      "no migration defines the RLS block",
    ).toBeGreaterThan(0);
    const newest = defining.at(-1) ?? "";
    const migration = readFileSync(new URL(newest, MIGRATIONS_DIR), "utf8");
    expect(
      blockOf(migration),
      `${newest} is stale: a tenant table was added or removed, so ship a new migration with the output of \`pnpm --filter @calibra-facil/db gen:rls-sql\` and update sql/schema-extras.sql`,
    ).toBe(rlsSqlBlock());
    expect(migration).toContain(RLS_ROLE_SQL);
  });

  it("REQ-RLS-1: the comparison catches a tenant table that is added or removed (mutation check)", () => {
    const committed = blockOf(read(`../drizzle/${MIGRATION}`));
    expect(committed).not.toBeNull();
    const generated = rlsSqlBlock();
    const withoutAsset = generated.replace(
      /ALTER TABLE public\."asset" ENABLE ROW LEVEL SECURITY;\n/,
      "",
    );
    expect(withoutAsset).not.toBe(generated);
    expect(committed).not.toBe(withoutAsset);
    const withExtra = generated.replace(
      RLS_SQL_END,
      `ALTER TABLE public."new_tenant_table" ENABLE ROW LEVEL SECURITY;\n${RLS_SQL_END}`,
    );
    expect(committed).not.toBe(withExtra);
  });

  it("REQ-RLS-1: the migration says production does not change until the role split, and is journaled after 0120 with a larger timestamp", () => {
    const migration = read(`../drizzle/${MIGRATION}`);
    const header = migration.slice(0, migration.indexOf(RLS_SQL_BEGIN));
    expect(header).toMatch(/not FORCE/i);
    expect(header).toMatch(/owner/i);
    expect(header).toMatch(/no change|does not change|unchanged/i);

    const journal: unknown = JSON.parse(read("../drizzle/meta/_journal.json"));
    const entries =
      typeof journal === "object" && journal !== null && "entries" in journal
        ? journal.entries
        : [];
    if (!Array.isArray(entries)) throw new Error("journal has no entries");
    const tagOf = (entry: unknown) =>
      typeof entry === "object" && entry !== null && "tag" in entry
        ? entry.tag
        : null;
    const whenOf = (entry: unknown) =>
      typeof entry === "object" && entry !== null && "when" in entry
        ? Number(entry.when)
        : Number.NaN;
    const index = entries.findIndex(
      (entry: unknown) => tagOf(entry) === MIGRATION.replace(".sql", ""),
    );
    expect(index, `${MIGRATION} is not journaled`).toBeGreaterThan(0);
    expect(whenOf(entries[index])).toBeGreaterThan(whenOf(entries[index - 1]));
  });

  it("REQ-RLS-2 [HIGH RISK]: the migration starts with the lock timeout, then refuses a role that RLS would bind, before it changes anything", () => {
    const migration = read(`../drizzle/${MIGRATION}`);
    const body = migration
      .split("\n")
      .filter((line) => !line.startsWith("--"))
      .join("\n")
      .trimStart();
    expect(body.startsWith(RLS_LOCK_TIMEOUT_SQL)).toBe(true);
    expect(RLS_LOCK_TIMEOUT_SQL).toBe("SET LOCAL lock_timeout = '5s';");
    expect(migration.indexOf(RLS_MIGRATION_GUARD_SQL)).toBeGreaterThan(
      migration.indexOf(RLS_LOCK_TIMEOUT_SQL),
    );
    expect(migration.indexOf(RLS_MIGRATION_GUARD_SQL)).toBeLessThan(
      migration.indexOf(RLS_ROLE_SQL),
    );
    expect(migration.indexOf(RLS_MIGRATION_GUARD_SQL)).toBeLessThan(
      migration.indexOf(RLS_SQL_BEGIN),
    );
    // Superuser, BYPASSRLS and the owner (through pg_has_role) pass.
    expect(RLS_MIGRATION_GUARD_SQL).toContain("rolsuper");
    expect(RLS_MIGRATION_GUARD_SQL).toContain("rolbypassrls");
    expect(RLS_MIGRATION_GUARD_SQL).toContain("pg_has_role(current_user");
    expect(RLS_MIGRATION_GUARD_SQL).toContain("DEPLOYMENT.md");
    // The seed file for an empty database builds as its owner: no guard there.
    expect(read("../sql/schema-extras.sql")).not.toContain(
      RLS_MIGRATION_GUARD_SQL,
    );
  });

  it("REQ-RLS-2: the header carries the manual pre-check queries; the role creation names the CREATEROLE fix and never skips silently", () => {
    const migration = read(`../drizzle/${MIGRATION}`);
    const header = migration.slice(0, migration.indexOf(RLS_LOCK_TIMEOUT_SQL));
    expect(header).toContain("select current_user");
    expect(header).toContain("rolsuper");
    expect(header).toContain("rolbypassrls");
    expect(header).toContain("tableowner");
    expect(header).toContain("DATABASE_RLS_MODE");
    expect(header).toMatch(/lock timeout/i);
    expect(RLS_ROLE_SQL).toContain("WHEN insufficient_privilege THEN");
    expect(RLS_ROLE_SQL).toContain("CREATE ROLE calibra_app NOLOGIN; once");
    expect(RLS_ROLE_SQL).toContain("IF NOT EXISTS (SELECT 1 FROM pg_roles");
  });
});

describe("append-only evidence tables: the application role cannot UPDATE or DELETE them (roadmap 2 B4a)", () => {
  it("REQ-B4A-4: the revoke statements name exactly the listed tables and revoke only UPDATE and DELETE", () => {
    const sqlText = appRoleRevokeSql();
    expect(APPEND_ONLY_APP_ROLE_TABLES).toContain(
      "organization_compliance_audit_log",
    );
    for (const table of APPEND_ONLY_APP_ROLE_TABLES) {
      expect(sqlText).toContain(
        `REVOKE UPDATE, DELETE ON TABLE public."${table}" FROM ${APP_ROLE};`,
      );
    }
    expect(sqlText.match(/^REVOKE /gm)).toHaveLength(
      APPEND_ONLY_APP_ROLE_TABLES.length,
    );
  });

  it("REQ-B4A-4: every listed table exists, is a tenant table and carries the append-only trigger in schema-extras.sql", () => {
    const tenant = new Set(classifyTables().tenant.map((table) => table.name));
    const extras = read("../sql/schema-extras.sql");
    for (const table of APPEND_ONLY_APP_ROLE_TABLES) {
      expect(tenant.has(table), table).toBe(true);
      expect(extras, table).toContain(
        `CREATE TRIGGER ${table}_append_only\n  BEFORE UPDATE OR DELETE ON public.${table}`,
      );
    }
  });

  it("REQ-B4A-4: schema-extras.sql and the newest migration that repeats RLS_ROLE_SQL revoke AFTER its blanket grant", () => {
    const extras = read("../sql/schema-extras.sql");
    const defining = readdirSync(MIGRATIONS_DIR)
      .filter((name) => name.endsWith(".sql"))
      .sort()
      .filter((name) =>
        readFileSync(new URL(name, MIGRATIONS_DIR), "utf8").includes(
          RLS_ROLE_SQL,
        ),
      );
    const newest = readFileSync(
      new URL(defining.at(-1) ?? "", MIGRATIONS_DIR),
      "utf8",
    );
    for (const text of [extras, newest]) {
      expect(text).toContain(appRoleRevokeSql());
      expect(text.indexOf(appRoleRevokeSql())).toBeGreaterThan(
        text.indexOf(RLS_ROLE_SQL),
      );
    }
  });
});
