import type { Env } from "@calibra-facil/jobs-core";
import { makeTestEnv } from "./env";

// Shared by the `*-lab-scope.int.spec.ts` specs: the worker connected as the
// application role `calibra_app`, which the `tenant_isolation` policies bind
// (migration 0123). Every connection a handler opens is a session of that role;
// only the lookups that LEARN which laboratory a message or a sweep belongs to
// use the owner connection (`DATABASE_OWNER_URL`).

/** The same database, as a session of the application role. */
export function applicationRoleUrl(ownerUrl: string): string {
  const url = new URL(ownerUrl);
  url.searchParams.set("options", "-c role=calibra_app");
  return url.toString();
}

export function ownerDatabaseUrl(): string {
  const ownerUrl = process.env.DATABASE_URL;
  if (!ownerUrl) throw new Error("DATABASE_URL is not set");
  return ownerUrl;
}

/** The worker env as `calibra_app`, with the owner connection for the system path unless told not to. */
export function envAsApplicationRole(
  options: { withOwnerUrl?: boolean } & Partial<Env> = {},
): Env {
  const { withOwnerUrl = true, ...overrides } = options;
  const ownerUrl = ownerDatabaseUrl();
  return {
    ...makeTestEnv(overrides),
    DATABASE_URL: applicationRoleUrl(ownerUrl),
    DATABASE_RLS_MODE: "enforced",
    ...(withOwnerUrl ? { DATABASE_OWNER_URL: ownerUrl } : {}),
  };
}

export function toRows(result: unknown): unknown[] {
  if (result && typeof result === "object" && "rows" in result) {
    const inner = Reflect.get(result, "rows");
    return Array.isArray(inner) ? inner : [];
  }
  return Array.isArray(result) ? result : [];
}

export function field(row: unknown, key: string): unknown {
  return row && typeof row === "object" && key in row
    ? Reflect.get(row, key)
    : undefined;
}

export function asString(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}
