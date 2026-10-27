import { describe, expect, it } from "vitest";
import { ConfigError } from "@calibra-facil/config";
import {
  assertRlsStartup,
  readRlsRoleFacts,
  rlsOwnerUrlProblem,
  rlsStartupProblem,
  sessionTimeZoneProblem,
  rlsSystemRoleProblem,
  type RlsRoleFacts,
} from "./rls-startup";

// The decision table of the start-up check. The same four cases against a real
// Postgres (owner, BYPASSRLS, a calibra_app member in shadow mode, enforced mode)
// are in apps/api/src/lib/rls-startup.int.spec.ts.

const OWNER: RlsRoleFacts = {
  role: "calibra_owner",
  timeZone: "UTC",
  isSuperuser: false,
  bypassesRls: false,
  rlsEnabled: true,
  subjectToRls: false,
  ownsSomeRlsTable: true,
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
  ownsSomeRlsTable: false,
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

  it("REQ-RLS-2: enforced mode (the default) accepts that role", () => {
    expect(rlsStartupProblem(APP_MEMBER, "enforced")).toBeNull();
  });

  it("REQ-RLS-2 [HIGH RISK]: enforced mode refuses a role that owns (or can become the owner of) only SOME tenant table, though the others bind it", () => {
    const partial = { ...APP_MEMBER, role: "partial", ownsSomeRlsTable: true };
    const problem = rlsStartupProblem(partial, "enforced");
    expect(problem).toContain('"partial"');
    expect(problem).toContain("DATABASE_URL");
    expect(problem).toContain("SET ROLE");
  });

  it("REQ-RLS-2 [HIGH RISK]: enforced mode refuses an application connection RLS does not bind (owner, superuser, BYPASSRLS), naming DATABASE_URL, shadow mode and DEPLOYMENT.md", () => {
    for (const facts of [OWNER, SUPERUSER, BYPASS]) {
      const problem = rlsStartupProblem(facts, "enforced");
      expect(problem).toContain(`"${facts.role}"`);
      expect(problem).toContain("DATABASE_URL");
      expect(problem).toContain("DATABASE_RLS_MODE=shadow");
      expect(problem).toContain("DEPLOYMENT.md");
    }
  });

  it("REQ-RLS-2: before migration 0123 (no table has RLS enabled) the check passes in either mode", () => {
    const before = { ...APP_MEMBER, rlsEnabled: false, subjectToRls: false };
    expect(rlsStartupProblem(before, "shadow")).toBeNull();
    expect(rlsStartupProblem(before, "enforced")).toBeNull();
  });
});

describe("rlsSystemRoleProblem", () => {
  it("REQ-RLS-2 [HIGH RISK]: enforced mode refuses an owner URL whose role RLS binds", () => {
    const problem = rlsSystemRoleProblem("enforced", APP_MEMBER);
    expect(problem).toContain('"calibra_api"');
    expect(problem).toContain("system path");
  });

  it("REQ-RLS-2: enforced mode accepts an owner, a superuser and a BYPASSRLS role on the system path", () => {
    for (const facts of [OWNER, SUPERUSER, BYPASS]) {
      expect(rlsSystemRoleProblem("enforced", facts)).toBeNull();
    }
  });

  it("REQ-RLS-2: shadow mode has no system-path requirement (it is the application connection)", () => {
    expect(rlsSystemRoleProblem("shadow", APP_MEMBER)).toBeNull();
  });
});

describe("assertRlsStartup", () => {
  const row = (facts: RlsRoleFacts) => ({
    role: facts.role,
    time_zone: facts.timeZone,
    is_superuser: facts.isSuperuser,
    bypasses_rls: facts.bypassesRls,
    rls_enabled: facts.rlsEnabled,
    subject_to_rls: facts.subjectToRls,
    owns_some_rls_table: facts.ownsSomeRlsTable,
  });

  it("REQ-RLS-2: shadow mode in production warns loudly (and still starts); enforced mode and non-production stay quiet", async () => {
    const executor = executorReturning(row(OWNER));
    const warnings: string[] = [];
    const warn = (message: string) => warnings.push(message);
    await assertRlsStartup({
      executor,
      mode: "shadow",
      production: true,
      warn,
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("DATABASE_RLS_MODE=shadow in production");
    expect(warnings[0]).toContain("DEPLOYMENT.md");
    await assertRlsStartup({
      executor,
      mode: "shadow",
      production: false,
      warn,
    });
    await assertRlsStartup({
      executor: executorReturning(row(APP_MEMBER)),
      systemExecutor: executorReturning(row(OWNER)),
      mode: "enforced",
      ownerUrl: "postgres://owner@localhost/db",
      production: true,
      warn,
    });
    expect(warnings).toHaveLength(1);
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

  it("REQ-RLS-2 [HIGH RISK]: throws a ConfigError on DATABASE_RLS_MODE for a calibra_app member in shadow mode, resolves in enforced mode with the owner on the system path", async () => {
    const executor = executorReturning(row(APP_MEMBER));
    const systemExecutor = executorReturning(row(OWNER));
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
      assertRlsStartup({
        executor,
        systemExecutor,
        mode: "enforced",
        ownerUrl: "postgres://owner@localhost/db",
      }),
    ).resolves.toEqual(APP_MEMBER);
  });

  it("Q40 [HIGH RISK]: enforced mode without DATABASE_OWNER_URL refuses to start, naming the variable, before any query", async () => {
    let queries = 0;
    const executor = {
      execute: async () => {
        queries += 1;
        return [row(APP_MEMBER)];
      },
    };
    for (const ownerUrl of [undefined, ""]) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- two cases.
      const refused = await assertRlsStartup({
        executor,
        mode: "enforced",
        ownerUrl,
      }).then(
        () => null,
        (error: unknown) => error,
      );
      expect(refused).toBeInstanceOf(ConfigError);
      if (!(refused instanceof ConfigError)) throw new Error("not refused");
      expect(refused.issues.map((issue) => issue.variable)).toEqual([
        "DATABASE_OWNER_URL",
      ]);
      expect(refused.message).toContain("DATABASE_RLS_MODE=enforced");
    }
    expect(queries).toBe(0);
  });

  it("Q40: shadow mode does not need DATABASE_OWNER_URL, and an owner URL satisfies enforced mode", () => {
    expect(rlsOwnerUrlProblem("shadow", undefined)).toBeNull();
    expect(rlsOwnerUrlProblem("enforced", "postgres://owner@h/db")).toBeNull();
    expect(rlsOwnerUrlProblem("enforced", undefined)).toContain(
      "DATABASE_OWNER_URL",
    );
  });

  it("REQ-RLS-2 [HIGH RISK]: enforced mode throws a ConfigError on DATABASE_URL when the application connects as the owner, and on DATABASE_OWNER_URL when that role is one RLS binds", async () => {
    const ownerUrl = "postgres://owner@localhost/db";
    const asOwner = await assertRlsStartup({
      executor: executorReturning(row(OWNER)),
      systemExecutor: executorReturning(row(OWNER)),
      mode: "enforced",
      ownerUrl,
    }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(asOwner).toBeInstanceOf(ConfigError);
    if (!(asOwner instanceof ConfigError)) throw new Error("not refused");
    expect(asOwner.issues.map((issue) => issue.variable)).toEqual([
      "DATABASE_URL",
    ]);

    const boundSystem = await assertRlsStartup({
      executor: executorReturning(row(APP_MEMBER)),
      systemExecutor: executorReturning(row(APP_MEMBER)),
      mode: "enforced",
      ownerUrl,
    }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(boundSystem).toBeInstanceOf(ConfigError);
    if (!(boundSystem instanceof ConfigError)) throw new Error("not refused");
    expect(boundSystem.issues.map((issue) => issue.variable)).toEqual([
      "DATABASE_OWNER_URL",
    ]);
  });

  it("REQ-RLS-2: reads a driver that answers { rows } as well as a bare array", async () => {
    const facts = await readRlsRoleFacts({
      execute: async () => ({ rows: [row(BYPASS)] }),
    });
    expect(facts).toEqual(BYPASS);
  });
});

describe("session TimeZone (roadmap 2 C5)", () => {
  it("accepts UTC and refuses any other zone, naming DATABASE_URL", async () => {
    expect(sessionTimeZoneProblem("UTC")).toBeNull();
    expect(sessionTimeZoneProblem("Etc/UTC")).toBeNull();
    expect(sessionTimeZoneProblem("America/Sao_Paulo")).toContain(
      "America/Sao_Paulo",
    );

    const refused = await assertRlsStartup({
      executor: executorReturning({
        role: OWNER.role,
        time_zone: "America/Sao_Paulo",
        is_superuser: false,
        bypasses_rls: false,
        rls_enabled: true,
        subject_to_rls: false,
        owns_some_rls_table: true,
      }),
      mode: "shadow",
    }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(refused).toBeInstanceOf(ConfigError);
    if (!(refused instanceof ConfigError)) throw new Error("not refused");
    expect(refused.issues.map((issue) => issue.variable)).toEqual([
      "DATABASE_URL",
    ]);
  });
});
