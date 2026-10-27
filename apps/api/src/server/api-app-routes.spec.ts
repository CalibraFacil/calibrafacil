import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createApiApp } from "../app";

// packages/contracts/src/api-app.ts lists, by hand, the browser-facing raw Hono
// routes the frontends may call (AppType). A route renamed or removed on the
// server and left in that list type-checks on the client and 404s at runtime.
// Roadmap 2 D2: every listed path must be a route the API serves.

function contractPaths(): string[] {
  const source = readFileSync(
    new URL("../../../../packages/contracts/src/api-app.ts", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("type ApiRoutePath =");
  const end = source.indexOf(";", start);
  return Array.from(
    source.slice(start, end).matchAll(/"([^"]+)"/g),
    (match) => match[1] ?? "",
  );
}

describe("api-app.ts route list (roadmap 2 D2)", () => {
  it("lists only routes the API serves", () => {
    const served = new Set(createApiApp().routes.map((route) => route.path));
    const listed = contractPaths();

    expect(listed.length).toBeGreaterThan(100);
    expect(listed.filter((path) => !served.has(path))).toEqual([]);
  });
});
