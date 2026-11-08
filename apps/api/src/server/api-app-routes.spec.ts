import { describe, expect, it } from "vitest";
import {
  ENDPOINT_GROUPS,
  PORTAL_ENDPOINT_GROUPS,
  endpointLabel,
} from "@calibra-facil/contracts";
import { createApiApp } from "../app";

// A route renamed or removed on the server while its endpoint definition stays
// type-checks on the client and 404s at runtime: every definition must be served,
// at its method and path.

describe("endpoint definitions", () => {
  it("are all served, at their method and path", () => {
    const served = new Set(
      createApiApp().routes.map((route) => `${route.method} ${route.path}`),
    );
    // The portal's endpoints are declared apart from the lab's (the lab SDK and
    // the desktop never call them) but are served by the same app.
    const defined = [
      ...Object.values(ENDPOINT_GROUPS),
      ...Object.values(PORTAL_ENDPOINT_GROUPS),
    ].flatMap((group) => Object.values(group).map((def) => endpointLabel(def)));

    expect(defined.length).toBeGreaterThan(0);
    expect(defined.filter((label) => !served.has(label))).toEqual([]);
  });

  it("serve no template leftover (GET /hello answered a greeting nobody calls)", () => {
    const served = createApiApp().routes.map(
      (route) => `${route.method} ${route.path}`,
    );
    expect(served).not.toContain("GET /hello");
  });
});
