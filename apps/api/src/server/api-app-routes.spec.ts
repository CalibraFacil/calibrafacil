import { describe, expect, it } from "vitest";
import { ENDPOINT_GROUPS, endpointLabel } from "@calibra-facil/contracts";
import { createApiApp } from "../app";

// A route renamed or removed on the server while its endpoint definition stays
// type-checks on the client and 404s at runtime: every definition must be served,
// at its method and path.

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
