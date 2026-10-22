import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

// REQ-SPLIT-2: the public API v2 router is split by resource, so the route
// table (method, path and the exact middleware chain, in registration order)
// is pinned in a snapshot recorded BEFORE the split. A dropped, reordered or
// re-guarded route, or a changed handler body, turns this red.
//
// Scope guards and validators are closures, so the two factories are mocked to
// return functions named after their arguments; every other middleware keeps
// its real function name. Handler bodies are fingerprinted on their compiled
// source with module-import indirection and whitespace normalised away, so
// moving a helper between files does not change the fingerprint but editing
// the handler does.
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

function fingerprint(handler: (...args: never[]) => unknown) {
  const source = handler
    .toString()
    .replace(/\(0,\s*__(?:vi|vite_ssr)_import_\d+__\.(\w+)\)/g, "$1")
    .replace(/__(?:vi|vite_ssr)_import_\d+__\./g, "")
    .replace(/\s+/g, "");
  return createHash("sha256").update(source).digest("hex").slice(0, 10);
}

function describeRoutes(
  label: string,
  routes: readonly {
    method: string;
    path: string;
    handler: (...args: never[]) => unknown;
  }[],
) {
  return routes.map(({ method, path, handler }) => {
    const name = handler.name;
    const isMock =
      name.startsWith("requireApi") || name.startsWith("zValidator");
    return `${label} ${method} ${path} ${name || "<anonymous>"}${isMock ? "" : ` #${fingerprint(handler)}`}`;
  });
}

describe("public API v2 route table", () => {
  it(
    "REQ-SPLIT-2 keeps every route, middleware and handler in order",
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
