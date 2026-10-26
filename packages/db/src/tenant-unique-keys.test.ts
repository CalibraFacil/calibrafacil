/**
 * Invariant: a unique key on a tenant table is scoped to the laboratory.
 *
 * A per-lab value (a service-order tag, a quote number, a document number...) that carries a
 * unique index WITHOUT the organization column is unique across every laboratory, so the first
 * order of the year of a second lab collides with the first lab's (P0-4, the class fixed for NC/
 * CAPA by migration 0124 and for the service-order documents by 0125). Every unique index,
 * unique constraint and composite primary key of a tenant table (`classifyTables().tenant`,
 * including the partial indexes of `sql/schema-extras.sql`) must either
 *
 *   1. include the table's organization column, or
 *   2. include a single-column foreign key to a tenant table: the value is unique per parent row
 *      and the parent id is itself a lab-owned row, so the scope is implied (`(document_id,
 *      installment_number)`), or
 *   3. be listed in `GLOBAL_UNIQUE_KEYS` with the reason it is a platform-wide identifier.
 *
 * It only reads drizzle metadata and the extras file: it never touches a database.
 */
import { readFileSync } from "node:fs";
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as schema from "./schema";
import { TENANT_COLUMNS, classifyTables } from "./tenancy";

type UniqueKey = {
  table: string;
  name: string;
  /** `table(column, column)`: the key of GLOBAL_UNIQUE_KEYS. */
  signature: string;
  columns: readonly string[];
};

/**
 * Keys that are platform-wide on purpose, by `table(columns)` signature. Anything else on a
 * tenant table that is not lab-scoped is a bug, not an entry to add here.
 */
const GLOBAL_UNIQUE_KEYS: Readonly<Record<string, string>> = {
  "calibration_job(supersedes_id)":
    "Pointer to the amended job (a global serial id, so one lab's job by construction): at most one amendment per job. Declared without a foreign key today (architecture review 3.2, amendment links).",
  "asset(public_id)":
    "Opaque gen_random_uuid() used in client URLs; unguessable and never derived from a per-lab sequence.",
  "billing_document(public_id)":
    "Opaque gen_random_uuid() used in client URLs; never derived from a per-lab sequence.",
  "service_order(public_id)":
    "Opaque gen_random_uuid() used in portal URLs; never derived from a per-lab sequence.",
  "calibration_job(verification_token)":
    "Random public certificate verification token: a secret, resolved without knowing the lab.",
  "oot_notification(ack_token)":
    "Random acknowledgement token of an e-mail link: a secret, resolved without knowing the lab.",
  "organization_api_key(key_hash)":
    "Hash of a random API key: the key is presented without a lab and selects it.",
  "service_order_public_access_token(token_hash)":
    "Hash of a random public-access token: presented without a lab and selects it.",
  "service_order_public_access_token(code_hash)":
    "Hash of a random short public code: presented without a lab and selects it.",
  "organization_custom_domain(hostname)":
    "A DNS hostname is global by nature; the host selects the lab.",
  "organization_email_domain(hostname)":
    "A sending DNS domain is global by nature; one lab owns it.",
  "sso_provider(provider_id)":
    "Better Auth SSO provider id: the sign-in flow resolves the provider (and so the lab) from it.",
};

function columnNames(columns: readonly unknown[]): string[] {
  return columns.flatMap((column) =>
    typeof column === "object" &&
    column !== null &&
    "name" in column &&
    typeof column.name === "string"
      ? [column.name]
      : [],
  );
}

function signatureOf(table: string, columns: readonly string[]): string {
  return `${table}(${columns.join(",")})`;
}

const tenantTables = new Set(classifyTables().tenant.map((t) => t.name));

/** Columns that are a single-column foreign key to a tenant table, per table. */
function parentScopedColumns(table: string): ReadonlySet<string> {
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue;
    const config = getTableConfig(value);
    if (config.name !== table) continue;
    return new Set(
      config.foreignKeys.flatMap((foreignKey) => {
        const reference = foreignKey.reference();
        const [column] = reference.columns;
        return reference.columns.length === 1 &&
          column &&
          tenantTables.has(getTableConfig(reference.foreignTable).name)
          ? [column.name]
          : [];
      }),
    );
  }
  return new Set();
}

function schemaUniqueKeys(): UniqueKey[] {
  const keys: UniqueKey[] = [];
  const add = (table: string, name: string, columns: readonly string[]) =>
    keys.push({ table, name, signature: signatureOf(table, columns), columns });
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue;
    const config = getTableConfig(value);
    if (!tenantTables.has(config.name)) continue;
    for (const index of config.indexes) {
      if (index.config.unique) {
        add(
          config.name,
          index.config.name ?? "?",
          columnNames(index.config.columns),
        );
      }
    }
    for (const unique of config.uniqueConstraints) {
      add(config.name, unique.name ?? "?", columnNames(unique.columns));
    }
    for (const column of config.columns) {
      if (column.isUnique) {
        add(config.name, column.uniqueName ?? "?", [column.name]);
      }
    }
    for (const primaryKey of config.primaryKeys) {
      add(config.name, "primary key", columnNames(primaryKey.columns));
    }
  }
  return keys;
}

/** `CREATE UNIQUE INDEX` statements of schema-extras.sql (partial / NULLS NOT DISTINCT indexes). */
function extrasUniqueKeys(): UniqueKey[] {
  const sqlText = readFileSync(
    new URL("../sql/schema-extras.sql", import.meta.url),
    "utf8",
  );
  return [
    ...sqlText.matchAll(
      /CREATE UNIQUE INDEX(?: IF NOT EXISTS)?\s+(\w+)\s+ON\s+(?:public\.)?(\w+)\s+USING btree\s*\(([^)]*)\)/g,
    ),
  ].flatMap(([, name, table, columnList]) =>
    name && table && columnList
      ? [
          {
            table,
            name,
            columns: columnList.split(",").map((column) => column.trim()),
            signature: signatureOf(
              table,
              columnList.split(",").map((column) => column.trim()),
            ),
          },
        ]
      : [],
  );
}

function isLabScoped(key: UniqueKey): boolean {
  if (key.columns.some((column) => TENANT_COLUMNS.includes(column))) {
    return true;
  }
  const parents = parentScopedColumns(key.table);
  return key.columns.some((column) => parents.has(column));
}

/** Unique keys that are neither lab-scoped nor allowlisted. */
function violations(keys: readonly UniqueKey[]): string[] {
  return keys
    .filter(
      (key) =>
        !isLabScoped(key) && GLOBAL_UNIQUE_KEYS[key.signature] === undefined,
    )
    .map((key) => `${key.table}.${key.name} ${key.signature}`);
}

describe("every unique key on a tenant table is scoped to the laboratory", () => {
  it("finds the keys it is meant to police", () => {
    const signatures = new Set(schemaUniqueKeys().map((key) => key.signature));
    expect(signatures.has("service_order(organization_id,number)")).toBe(false);
    expect(
      [...signatures].some((signature) =>
        signature.startsWith("service_order_tag("),
      ),
    ).toBe(true);
    expect(extrasUniqueKeys().length).toBeGreaterThan(0);
  });

  it("schema.ts: no unique index or constraint is global to every lab", () => {
    expect(
      violations(schemaUniqueKeys()),
      "add the organization column to the key (migration + schema.ts + schema-extras.sql); allowlist only a genuinely platform-wide identifier",
    ).toEqual([]);
  });

  it("schema-extras.sql: no unique index is global to every lab", () => {
    expect(violations(extrasUniqueKeys())).toEqual([]);
  });

  it("the allowlist has no stale or pointless entry", () => {
    const keys = [...schemaUniqueKeys(), ...extrasUniqueKeys()];
    for (const signature of Object.keys(GLOBAL_UNIQUE_KEYS)) {
      const matching = keys.filter((key) => key.signature === signature);
      expect(
        matching.length,
        `${signature} is not a unique key`,
      ).toBeGreaterThan(0);
      for (const key of matching) {
        expect(
          isLabScoped(key),
          `${signature} is lab-scoped: drop it from the allowlist`,
        ).toBe(false);
      }
    }
  });
});
