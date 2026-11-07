import { describe, expect, it, vi } from "vitest";

// The public API v2 route table (method, path and the middleware chain, in
// registration order) is pinned: a dropped, reordered or re-guarded route turns
// this red. Scope guards and validators are closures, so the two factories are
// mocked to return functions named after their arguments; every other middleware
// keeps its real function name. Handler bodies are not pinned: what a handler
// does is the integration specs' job.
const { named } = vi.hoisted(() => ({
  named: <T extends (...args: never[]) => unknown>(fn: T, name: string) =>
    Object.defineProperty(fn, "name", { value: name }),
}));

vi.mock("../middleware/api-key-auth", () => ({
  requireApiKeyAuth: named(async () => undefined, "requireApiKeyAuth"),
  requireApiScope: (scope: string) =>
    named(async () => undefined, `requireApiScope(${scope})`),
}));

function schemaKeys(schema: unknown) {
  if (typeof schema !== "object" || schema === null) return "";
  if (!("shape" in schema)) return "";
  const { shape } = schema;
  if (typeof shape !== "object" || shape === null) return "";
  return Object.keys(shape).join("|");
}

vi.mock("@hono/zod-validator", () => ({
  zValidator: (target: string, schema: unknown) =>
    named(async () => undefined, `zValidator(${target}:${schemaKeys(schema)})`),
}));

function describeRoutes(
  label: string,
  routes: readonly {
    method: string;
    path: string;
    handler: (...args: never[]) => unknown;
  }[],
) {
  return routes.map(({ method, path, handler }) => {
    return `${label} ${method} ${path} ${handler.name || "<anonymous>"}`;
  });
}

describe("public API v2 route table", () => {
  it(
    "REQ-SPLIT-2 keeps every route and its middleware chain in order",
    { timeout: 60_000 },
    async () => {
      const { publicApiV2Router, publicApiV2DocsRouter } =
        await import("./public-api-v2");

      const table = [
        ...describeRoutes("v2", publicApiV2Router.routes),
        ...describeRoutes("docs", publicApiV2DocsRouter.routes),
      ].join("\n");

      await expect(`${table}\n`).toMatchFileSnapshot(
        "./__snapshots__/public-api-v2.route-table.txt",
      );
    },
  );

  it("REQ-SPLIT-2 guards every v2 route behind API-key auth first", async () => {
    const { publicApiV2Router } = await import("./public-api-v2");

    expect(publicApiV2Router.routes[0]).toMatchObject({
      method: "ALL",
      path: "/*",
    });
    expect(publicApiV2Router.routes[0]?.handler.name).toBe("requireApiKeyAuth");
  });
});
