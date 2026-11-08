import { describe, expect, it } from "vitest";
import {
  ENDPOINT_GROUPS,
  endpointLabel,
  PORTAL_ENDPOINT_GROUPS,
} from "@calibra-facil/contracts";
import { isPermissionCheck } from "./permission-check";

describe("isPermissionCheck", () => {
  it("accepts resources and actions of the access statements", () => {
    expect(isPermissionCheck({ client: ["read"] })).toBe(true);
    expect(isPermissionCheck({ client: ["read", "update"] })).toBe(true);
    expect(isPermissionCheck({})).toBe(true);
  });

  it("refuses an unknown resource, an unknown action, or a malformed value", () => {
    expect(isPermissionCheck({ nothing: ["read"] })).toBe(false);
    expect(isPermissionCheck({ client: ["fly"] })).toBe(false);
    expect(isPermissionCheck({ client: "read" })).toBe(false);
    expect(isPermissionCheck({ client: [1] })).toBe(false);
    expect(isPermissionCheck(null)).toBe(false);
    expect(isPermissionCheck("client")).toBe(false);
  });
});

describe("endpoint definitions: the permission names the access statements", () => {
  const defs = [
    ...Object.values(ENDPOINT_GROUPS),
    ...Object.values(PORTAL_ENDPOINT_GROUPS),
  ].flatMap((group) => Object.values(group));

  it("every definition with a permission holds known resources and actions", () => {
    const bad = defs
      .filter(
        (def) =>
          def.permission !== undefined && !isPermissionCheck(def.permission),
      )
      .map((def) => endpointLabel(def));
    expect(bad).toEqual([]);
  });
});
