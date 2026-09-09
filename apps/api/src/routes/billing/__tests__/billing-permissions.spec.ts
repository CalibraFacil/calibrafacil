import { describe, expect, it } from "vitest";

import { hasPermissionLocally } from "../../../middleware/permission";

/**
 * The billing access endpoint used to answer `canManageBilling: true` for every
 * member, so an ADMIN saw an enabled purchase button whose every submission the
 * API rejected. These are the two answers it now reports separately.
 */
describe("billing permissions by role", () => {
  it("lets the owner read and change billing", () => {
    expect(hasPermissionLocally("owner", { billing: ["read"] })).toBe(true);
    expect(hasPermissionLocally("owner", { billing: ["update"] })).toBe(true);
  });

  it("lets an admin read billing but not change it", () => {
    expect(hasPermissionLocally("admin", { billing: ["read"] })).toBe(true);
    expect(hasPermissionLocally("admin", { billing: ["update"] })).toBe(false);
  });

  it("keeps a technician out of billing entirely", () => {
    expect(hasPermissionLocally("technician", { billing: ["read"] })).toBe(
      false,
    );
    expect(hasPermissionLocally("technician", { billing: ["update"] })).toBe(
      false,
    );
  });
});
