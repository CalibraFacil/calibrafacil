import { describe, expect, it } from "vitest";
import {
  PORTAL_ACCESS_ROLES,
  PORTAL_MANAGEABLE_MEMBER_ROLES,
  PORTAL_VISIBLE_MEMBER_ROLES,
  isPortalAccessRole,
  isPortalManageableMemberRole,
  isPortalVisibleMemberRole,
} from "@calibra-facil/auth/access";

describe("Portal role boundaries", () => {
  it("includes only external roles for portal access", () => {
    expect(PORTAL_ACCESS_ROLES).toContain("client_user");
    expect(PORTAL_ACCESS_ROLES).not.toContain("owner");
    expect(PORTAL_ACCESS_ROLES).not.toContain("admin");
    expect(PORTAL_ACCESS_ROLES).not.toContain("operator");
    expect(PORTAL_ACCESS_ROLES).not.toContain("technician");
    expect(PORTAL_ACCESS_ROLES).not.toContain("member");
  });

  it("keeps visible customer portal members restricted to external roles", () => {
    expect(PORTAL_VISIBLE_MEMBER_ROLES).toContain("client_user");
    expect(PORTAL_VISIBLE_MEMBER_ROLES).not.toContain("owner");
  });

  it("keeps manageable customer portal members restricted to external roles", () => {
    expect(PORTAL_MANAGEABLE_MEMBER_ROLES).toContain("client_user");
    expect(PORTAL_MANAGEABLE_MEMBER_ROLES).not.toContain("owner");
  });

  it("helper predicates match the boundary rules", () => {
    expect(isPortalAccessRole("client_user")).toBe(true);
    expect(isPortalVisibleMemberRole("client_user")).toBe(true);
    expect(isPortalManageableMemberRole("client_user")).toBe(true);

    expect(isPortalAccessRole("owner")).toBe(false);
    expect(isPortalAccessRole("operator")).toBe(false);
    expect(isPortalVisibleMemberRole("admin")).toBe(false);
    expect(isPortalManageableMemberRole("technician")).toBe(false);
  });
});
