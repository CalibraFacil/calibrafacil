import { describe, expect, it } from "vitest";
import { ConfigError } from "@calibra-facil/config";
import {
  assertRlsStartup,
  readRlsRoleFacts,
  rlsStartupProblem,
  type RlsRoleFacts,
} from "./rls-startup";

// The decision table of the start-up check. The same four cases against a real
// Postgres (owner, BYPASSRLS, a calibra_app member in shadow mode, enforced mode)
// are in apps/api/src/lib/rls-startup.int.spec.ts.

const OWNER: RlsRoleFacts = {
  role: "calibra_owner",
  isSuperuser: false,
  bypassesRls: false,
  rlsEnabled: true,
  subjectToRls: false,
};
const SUPERUSER: RlsRoleFacts = {
  ...OWNER,
  role: "postgres",
  isSuperuser: true,
};
const BYPASS: RlsRoleFacts = {
  ...OWNER,
  role: "calibra_bypass",
  bypassesRls: true,
};
const APP_MEMBER: RlsRoleFacts = {
  ...OWNER,
  role: "calibra_api",
  subjectToRls: true,
};

function executorReturning(row: Record<string, unknown>) {
  return { execute: async () => [row] };
}

describe("rlsStartupProblem", () => {
  it("REQ-RLS-2: shadow mode accepts the table owner, a superuser and a BYPASSRLS role", () => {
    expect(rlsStartupProblem(OWNER, "shadow")).toBeNull();
    expect(rlsStartupProblem(SUPERUSER, "shadow")).toBeNull();
    expect(rlsStartupProblem(BYPASS, "shadow")).toBeNull();
  });

  it("REQ-RLS-2 [HIGH RISK]: shadow mode refuses a role that RLS binds, and names the role, the mode variable and DEPLOYMENT.md", () => {
    const problem = rlsStartupProblem(APP_MEMBER, "shadow");
    expect(problem).toContain('"calibra_api"');
    expect(problem).toContain("subject to row-level security");
    expect(problem).toContain("DATABASE_RLS_MODE=enforced");
    expect(problem).toContain("DEPLOYMENT.md");
  });

  it("REQ-RLS-2: enforced mode (after the role split) accepts that role", () => {
    expect(rlsStartupProblem(APP_MEMBER, "enforced")).toBeNull();
  });

  it("REQ-RLS-2: before migration 0123 (no table has RLS enabled) the check passes in either mode", () => {
    const before = { ...APP_MEMBER, rlsEnabled: false, subjectToRls: false };
    expect(rlsStartupProblem(before, "shadow")).toBeNull();
    expect(rlsStartupProblem(before, "enforced")).toBeNull();
  });
});

describe("assertRlsStartup", () => {
  const row = (facts: RlsRoleFacts) => ({
    role: facts.role,
    is_superuser: facts.isSuperuser,
    bypasses_rls: facts.bypassesRls,
    rls_enabled: facts.rlsEnabled,
    subject_to_rls: facts.subjectToRls,
  });

  it("REQ-RLS-2: reads the facts with one query and resolves for an owner", async () => {
    let queries = 0;
    const executor = {
      execute: async () => {
        queries += 1;
        return [row(OWNER)];
      },
    };
    await expect(
      assertRlsStartup({ executor, mode: "shadow" }),
    ).resolves.toEqual(OWNER);
    expect(queries).toBe(1);
  });

  it("REQ-RLS-2 [HIGH RISK]: throws a ConfigError on DATABASE_RLS_MODE for a calibra_app member in shadow mode, resolves in enforced mode", async () => {
    const executor = executorReturning(row(APP_MEMBER));
    const refused = await assertRlsStartup({ executor, mode: "shadow" }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(refused).toBeInstanceOf(ConfigError);
    if (!(refused instanceof ConfigError)) throw new Error("not refused");
    expect(refused.issues.map((issue) => issue.variable)).toEqual([
      "DATABASE_RLS_MODE",
    ]);
    await expect(
      assertRlsStartup({ executor, mode: "enforced" }),
    ).resolves.toEqual(APP_MEMBER);
  });

  it("REQ-RLS-2: reads a driver that answers { rows } as well as a bare array", async () => {
    const facts = await readRlsRoleFacts({
      execute: async () => ({ rows: [row(BYPASS)] }),
    });
    expect(facts).toEqual(BYPASS);
  });
});
