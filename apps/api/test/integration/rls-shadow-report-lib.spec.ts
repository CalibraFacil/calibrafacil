import { describe, expect, it } from "vitest";
import {
  buildSpecRows,
  groupTable,
  layerOf,
  matchesGroup,
  normalizeStatement,
  normalizeTestName,
  parseViolations,
  pathGroupOf,
  requestPathOf,
  sortedGroups,
  sourceModuleFromStack,
  summarizeGroups,
  UNATTRIBUTED,
  type SpecResults,
} from "./rls-shadow-report-lib";

const ROOT = "/repo/";

describe("request paths", () => {
  it("reads the pathname of a string, URL or Request-like", () => {
    expect(requestPathOf("/api/assets?x=1")).toBe("/api/assets");
    expect(requestPathOf(new URL("http://localhost/api/jobs/1"))).toBe(
      "/api/jobs/1",
    );
    expect(requestPathOf({ url: "http://localhost/api/customers" })).toBe(
      "/api/customers",
    );
    expect(requestPathOf(42)).toBe("(unknown)");
  });

  it("groups by the first two segments under /api", () => {
    expect(pathGroupOf("/api/assets/42/history")).toBe("/api/assets");
    expect(pathGroupOf("/api/portal")).toBe("/api/portal");
    expect(pathGroupOf("/health/live")).toBe("/health");
    expect(pathGroupOf("/")).toBe("/");
  });
});

describe("sourceModuleFromStack", () => {
  const frame = (file: string) => `    at fn (${ROOT}${file}:10:5)`;

  it("skips drizzle, packages/db, the org-bound wrapper and the harness", () => {
    const stack = [
      "Error",
      frame("apps/api/test/integration/rls-shadow-mode.ts"),
      frame(
        "node_modules/.pnpm/drizzle-orm@1/node_modules/drizzle-orm/pg-core/db.js",
      ),
      frame("packages/db/src/for-org.ts"),
      frame("apps/api/src/lib/org-db.ts"),
      frame("apps/api/src/routes/assets.ts"),
      frame("apps/api/src/app.ts"),
    ].join("\n");
    expect(sourceModuleFromStack(stack, ROOT)).toBe(
      "apps/api/src/routes/assets.ts",
    );
  });

  it("understands file:// frames and returns null with no application frame", () => {
    expect(
      sourceModuleFromStack(
        `Error\n    at file://${ROOT}apps/api/src/lib/x.ts:3:1`,
        ROOT,
      ),
    ).toBe("apps/api/src/lib/x.ts");
    expect(
      sourceModuleFromStack(
        `Error\n${frame("apps/api/src/routes/a.spec.ts")}`,
        ROOT,
      ),
    ).toBeNull();
  });
});

describe("matchesGroup", () => {
  it("matches everything without prefixes and by prefix with or without src/", () => {
    expect(matchesGroup("src/routes/jobs.int.spec.ts", [])).toBe(true);
    expect(matchesGroup("src/routes/jobs.int.spec.ts", ["routes/jobs"])).toBe(
      true,
    );
    expect(
      matchesGroup("src/routes/jobs.int.spec.ts", ["src/routes/portal"]),
    ).toBe(false);
    expect(matchesGroup("src/modules/sync/a.int.spec.ts", ["modules"])).toBe(
      true,
    );
  });
});

const line = (entry: Record<string, unknown>) => JSON.stringify(entry);
const toRelative = (file: string) => file.replace("/api/", "");

describe("parseViolations", () => {
  it("de-duplicates by spec, module, path group and statement, counting runs and tests", () => {
    const text = [
      line({
        type: "no-organization",
        file: "/api/src/routes/a.int.spec.ts",
        test: "t1",
        statement: "select  *\n from asset",
        source: "apps/api/src/routes/assets.ts",
        path: "/api/assets/1",
      }),
      line({
        type: "no-organization",
        file: "/api/src/routes/a.int.spec.ts",
        test: "t2",
        statement: "select * from asset",
        source: "apps/api/src/routes/assets.ts",
        path: "/api/assets/2",
      }),
      line({
        type: "no-organization",
        file: "/api/src/routes/a.int.spec.ts",
        test: "t2",
        statement: "select * from asset",
      }),
      line({ type: "other", file: "/api/x", statement: "x" }),
      "not json",
      "",
    ].join("\n");
    expect(parseViolations(text, toRelative)).toEqual([
      {
        file: "src/routes/a.int.spec.ts",
        statement: "select * from asset",
        count: 2,
        tests: ["t1", "t2"],
        module: "apps/api/src/routes/assets.ts",
        pathGroup: "/api/assets",
      },
      {
        file: "src/routes/a.int.spec.ts",
        statement: "select * from asset",
        count: 1,
        tests: ["t2"],
        module: UNATTRIBUTED,
        pathGroup: "(unknown)",
      },
    ]);
  });
});

function results(entries: Record<string, string>): SpecResults {
  return {
    tests: new Map(
      Object.entries(entries).map(([name, status]) => [
        name,
        { status, messages: status === "passed" ? [] : ["row-level security"] },
      ]),
    ),
    suiteFailure: false,
  };
}

describe("buildSpecRows and summarizeGroups", () => {
  const statements = parseViolations(
    [
      line({
        type: "no-organization",
        file: "/api/src/a.int.spec.ts",
        test: "breaks",
        statement: "select 1 from asset",
        source: "m1.ts",
        path: "/api/assets",
      }),
      line({
        type: "no-organization",
        file: "/api/src/a.int.spec.ts",
        test: "survives",
        statement: "select 1 from asset",
        source: "m1.ts",
        path: "/api/assets",
      }),
      line({
        type: "no-organization",
        file: "/api/src/a.int.spec.ts",
        test: "breaks",
        statement: "select 2 from job",
        source: "m2.ts",
        path: "/api/jobs",
      }),
    ].join("\n"),
    toRelative,
  );
  const rows = buildSpecRows(
    ["src/a.int.spec.ts", "src/b.int.spec.ts"],
    new Map([
      [
        "src/a.int.spec.ts",
        results({ breaks: "passed", survives: "passed", ownerRed: "failed" }),
      ],
    ]),
    new Map([
      [
        "src/a.int.spec.ts",
        results({ breaks: "failed", survives: "passed", ownerRed: "failed" }),
      ],
    ]),
    statements,
  );

  it("counts owner failures apart from tests broken under RLS", () => {
    expect(rows[0]).toMatchObject({
      file: "src/a.int.spec.ts",
      total: 3,
      ownerFailing: 1,
      appBroken: 1,
      unscopedStatements: 2,
      unscopedExecutions: 3,
    });
    expect(rows[0]?.broken).toEqual([
      { name: "breaks", reason: "write refused by WITH CHECK" },
    ]);
    expect(rows[1]).toMatchObject({ total: 0, appBroken: 0 });
  });

  it("summarizes distinct statements, runs and tests broken per group", () => {
    const byModule = summarizeGroups(statements, rows, (entry) => entry.module);
    expect(byModule).toEqual({
      "m1.ts": { distinctStatements: 1, runs: 2, testsBroken: 1 },
      "m2.ts": { distinctStatements: 1, runs: 1, testsBroken: 1 },
    });
    const byPath = summarizeGroups(
      statements,
      rows,
      (entry) => entry.pathGroup,
    );
    expect(sortedGroups(byPath).map(([group]) => group)).toEqual([
      "/api/assets",
      "/api/jobs",
    ]);
  });

  it("renders a markdown table sorted by distinct statements", () => {
    const table = groupTable(
      {
        small: { distinctStatements: 1, runs: 9, testsBroken: 0 },
        big: { distinctStatements: 5, runs: 1, testsBroken: 2 },
      },
      "module",
    );
    expect(table.split("\n")).toEqual([
      "| module | distinct statements | runs | tests broken |",
      "| --- | ---: | ---: | ---: |",
      "| `big` | 5 | 1 | 2 |",
      "| `small` | 1 | 9 | 0 |",
    ]);
  });
});

describe("layerOf and normalizeTestName", () => {
  it("names the layer of a module", () => {
    expect(layerOf("apps/api/src/routes/assets.ts")).toBe("routes");
    expect(layerOf("apps/api/src/lib/units.ts")).toBe("lib");
    expect(layerOf("apps/api/src/modules/jobs/service.ts")).toBe(
      "modules/jobs",
    );
    expect(layerOf("apps/api/src/app.ts")).toBe("(root)");
    expect(layerOf("packages/jobs-core/src/x.ts")).toBe("packages/jobs-core");
    expect(layerOf(UNATTRIBUTED)).toBe(UNATTRIBUTED);
  });

  it("matches the harness's `a > b` with vitest's `a b`", () => {
    expect(normalizeTestName("suite > nested > test")).toBe(
      "suite nested test",
    );
  });
});

describe("normalizeStatement", () => {
  it("collapses whitespace", () => {
    expect(normalizeStatement("  a \n b\t c ")).toBe("a b c");
  });
});
