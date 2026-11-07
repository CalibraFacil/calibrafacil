import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ENDPOINT_GROUPS, endpointLabel } from "@calibra-facil/contracts";
import { createApiApp } from "../app";

// The browser-facing raw Hono routes the frontends may call (AppType) come from
// two places: the endpoint definitions of the converted domains
// (`packages/contracts/src/endpoints`) and, until every domain is converted, a
// hand list in packages/contracts/src/api-app.ts. A route renamed or removed on
// the server and left in either type-checks on the client and 404s at runtime.
// Roadmap 2 D2: every listed path must be a route the API serves.

function contractPaths(): string[] {
  const source = readFileSync(
    new URL("../../../../packages/contracts/src/api-app.ts", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("type HandListedRoutePath =");
  const end = source.indexOf(";", start);
  return Array.from(
    source.slice(start, end).matchAll(/"([^"]+)"/g),
    (match) => match[1] ?? "",
  );
}

describe("endpoint definitions", () => {
  it("are all served, at their method and path", () => {
    const served = new Set(
      createApiApp().routes.map((route) => `${route.method} ${route.path}`),
    );
    const defined = Object.values(ENDPOINT_GROUPS).flatMap((group) =>
      Object.values(group).map((def) => endpointLabel(def)),
    );

    expect(defined.length).toBeGreaterThan(0);
    expect(defined.filter((label) => !served.has(label))).toEqual([]);
  });
});

describe("api-app.ts hand route list (roadmap 2 D2)", () => {
  it("lists only routes the API serves", () => {
    const served = new Set(createApiApp().routes.map((route) => route.path));
    const listed = contractPaths();

    expect(listed.length).toBeGreaterThan(50);
    expect(listed.filter((path) => !served.has(path))).toEqual([]);
  });
});
