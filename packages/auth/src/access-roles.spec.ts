/**
 * CUT-LINE / HIGH-RISK: Role Hierarchy and Access Partition
 *
 * Mini-spec: specs/coverage-risk/02-role-hierarchy-and-access-partition.md
 *
 * These tests assert the tenant/role partitioning oracle.  IF the production
 * code ever disagrees with a value here, a test will fail.  Do NOT relax or
 * remove an assertion to silence a failure — escalate to a human.
 *
 * The spec file is test-only.  `access.ts` MUST NOT be modified.
 */

import { describe, expect, it } from "vitest";
import {
  type RoleName,
  DEFAULT_ROLE,
  INTERNAL_ROLES,
  PORTAL_ACCESS_ROLES,
  ROLE_HIERARCHY,
  getRoleLevel,
  hasEqualOrHigherRole,
  isPortalAccessRole,
  isPortalManageableMemberRole,
  isPortalVisibleMemberRole,
} from "./access.js";

// ---------------------------------------------------------------------------
// Oracle constants used throughout
// ---------------------------------------------------------------------------

const ORACLE_HIERARCHY: RoleName[] = [
  "client_user",
  "member",
  "operator",
  "technician",
  "admin",
  "owner",
];

const ORACLE_INTERNAL_ROLES: RoleName[] = [
  "member",
  "operator",
  "technician",
  "admin",
  "owner",
];

// ---------------------------------------------------------------------------
// REQ-ROLE-001: getRoleLevel returns each role's index in ROLE_HIERARCHY
// ---------------------------------------------------------------------------

// REQ-ROLE-001: getRoleLevel SHALL return each role's index in ROLE_HIERARCHY
// (client_user=0 … owner=5), asserted for every role.
describe("REQ-ROLE-001: getRoleLevel returns correct hierarchy index for every role", () => {
  const expected: Array<[RoleName, number]> = [
    ["client_user", 0],
    ["member", 1],
    ["operator", 2],
    ["technician", 3],
    ["admin", 4],
    ["owner", 5],
  ];

  for (const [role, level] of expected) {
    it(`getRoleLevel("${role}") === ${level}`, () => {
      expect(getRoleLevel(role)).toBe(level);
    });
  }

  it("ROLE_HIERARCHY matches oracle order exactly", () => {
    expect(ROLE_HIERARCHY).toStrictEqual(ORACLE_HIERARCHY);
  });
});

// ---------------------------------------------------------------------------
// REQ-ROLE-002: hasEqualOrHigherRole comparisons
// ---------------------------------------------------------------------------

// REQ-ROLE-002 [HIGH RISK]: hasEqualOrHigherRole(a,b) SHALL return true iff
// a's hierarchy level >= b's.
describe("REQ-ROLE-002: hasEqualOrHigherRole comparisons", () => {
  it("owner >= admin → true", () => {
    expect(hasEqualOrHigherRole("owner", "admin")).toBe(true);
  });

  it("operator >= admin → false", () => {
    expect(hasEqualOrHigherRole("operator", "admin")).toBe(false);
  });

  it("admin >= admin → true (equal roles)", () => {
    expect(hasEqualOrHigherRole("admin", "admin")).toBe(true);
  });

  it("member >= technician → false", () => {
    expect(hasEqualOrHigherRole("member", "technician")).toBe(false);
  });

  it("technician >= member → true", () => {
    expect(hasEqualOrHigherRole("technician", "member")).toBe(true);
  });

  it("client_user >= member → false", () => {
    expect(hasEqualOrHigherRole("client_user", "member")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// REQ-ROLE-003: INTERNAL_ROLES excludes client_user; PORTAL_ACCESS_ROLES = [client_user]
// ---------------------------------------------------------------------------

// REQ-ROLE-003 [HIGH RISK]: client_user must be OUT of INTERNAL_ROLES and be
// the ONLY member of PORTAL_ACCESS_ROLES.
describe("REQ-ROLE-003: INTERNAL_ROLES and PORTAL_ACCESS_ROLES partition", () => {
  it("INTERNAL_ROLES matches oracle (no client_user)", () => {
    expect([...INTERNAL_ROLES]).toStrictEqual(ORACLE_INTERNAL_ROLES);
  });

  it("client_user is NOT in INTERNAL_ROLES", () => {
    expect(INTERNAL_ROLES).not.toContain("client_user");
  });

  it("PORTAL_ACCESS_ROLES contains exactly [client_user]", () => {
    expect([...PORTAL_ACCESS_ROLES]).toStrictEqual(["client_user"]);
  });

  it("no internal role appears in PORTAL_ACCESS_ROLES", () => {
    for (const role of ORACLE_INTERNAL_ROLES) {
      expect([...PORTAL_ACCESS_ROLES]).not.toContain(role);
    }
  });
});

// ---------------------------------------------------------------------------
// REQ-ROLE-004: portal predicate functions — true for client_user, false for all others
// ---------------------------------------------------------------------------

// REQ-ROLE-004 [HIGH RISK]: isPortalAccessRole / isPortalVisibleMemberRole /
// isPortalManageableMemberRole SHALL return true for "client_user" and false for
// every internal role and unknown strings.
describe("REQ-ROLE-004: portal access role predicates", () => {
  const portalPredicates = [
    {
      name: "isPortalAccessRole",
      fn: isPortalAccessRole,
    },
    {
      name: "isPortalVisibleMemberRole",
      fn: isPortalVisibleMemberRole,
    },
    {
      name: "isPortalManageableMemberRole",
      fn: isPortalManageableMemberRole,
    },
  ] satisfies Array<{ name: string; fn: (r: string) => boolean }>;

  for (const { name, fn } of portalPredicates) {
    it(`${name}("client_user") === true`, () => {
      expect(fn("client_user")).toBe(true);
    });

    for (const role of ORACLE_INTERNAL_ROLES) {
      it(`${name}("${role}") === false`, () => {
        expect(fn(role)).toBe(false);
      });
    }

    it(`${name}("unknown_role") === false`, () => {
      expect(fn("unknown_role")).toBe(false);
    });

    it(`${name}("") === false`, () => {
      expect(fn("")).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------
// DEFAULT_ROLE constant
// ---------------------------------------------------------------------------

describe("DEFAULT_ROLE oracle value", () => {
  it('DEFAULT_ROLE === "member"', () => {
    expect(DEFAULT_ROLE).toBe("member");
  });
});
