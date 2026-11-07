import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ENDPOINT_GROUPS,
  endpointLabel,
  SYNC_COMMAND_OPERATIONS,
  SYNC_OPERATIONS,
  type SyncCommandOperation,
} from "@calibra-facil/contracts";
import type { RoleName } from "@calibra-facil/auth/access";
import {
  authorizeSyncOperation,
  memberForEventUnit,
  syncOperationPermission,
} from "./operation-permissions";

type Operation = SyncCommandOperation;

const OPERATIONS: readonly Operation[] = SYNC_COMMAND_OPERATIONS;

const ROLES: readonly RoleName[] = [
  "owner",
  "admin",
  "technician",
  "operator",
  "member",
  // `client_user` is the portal role of CLIENT organizations, which the push
  // route refuses (requireOrgType("LAB")) before any event is looked at.
];

const FIELD_ROLES: readonly RoleName[] = [
  "owner",
  "admin",
  "technician",
  "operator",
];

/**
 * Who the ONLINE routes let through, written out by hand from the role
 * definitions (packages/auth/src/access.ts): independent of the table, so a
 * table entry that drifts (or a role that gains a right) turns this red.
 */
const EXPECTED_ALLOWED: Record<Operation, readonly RoleName[]> = {
  create_local_asset: FIELD_ROLES,
  save_local_execution: FIELD_ROLES,
  submit_local_execution: FIELD_ROLES,
  create_local_service_order_intake: ["owner", "admin", "operator", "member"],
  create_local_attachment: FIELD_ROLES,
};

describe("REQ-SYNC-RBAC-1: the push permission table", () => {
  it("covers exactly the operations of the push protocol", () => {
    expect(Object.keys(SYNC_OPERATIONS).toSorted()).toEqual(
      SYNC_COMMAND_OPERATIONS.toSorted(),
    );
    for (const op of OPERATIONS) {
      // Resource and action names are checked against the access-control statements.
      expect(syncOperationPermission(op)).toEqual(
        SYNC_OPERATIONS[op].permission,
      );
    }
    expect(Object.keys(EXPECTED_ALLOWED).toSorted()).toEqual(
      SYNC_COMMAND_OPERATIONS.toSorted(),
    );
  });

  it.each(OPERATIONS)("%s: each role gets the online route's answer", (op) => {
    for (const role of ROLES) {
      const decision = authorizeSyncOperation({ role, unitRole: null }, op);
      expect(decision.allowed, `${op} as ${role}`).toBe(
        EXPECTED_ALLOWED[op].includes(role),
      );
      if (!decision.allowed) {
        expect(decision.code).toBe("SYNC_PERMISSION_DENIED");
        expect(decision.reason).toContain(op);
      }
    }
  });

  it("a unit role elevates the member role, as the online guard does", () => {
    const allowed = (
      role: RoleName,
      unitRole: "unit_admin" | null,
      op: Operation,
    ) => authorizeSyncOperation({ role, unitRole }, op).allowed;
    // A technician may not open an intake alone, a unit_admin technician may.
    expect(
      allowed("technician", null, "create_local_service_order_intake"),
    ).toBe(false);
    expect(
      allowed("technician", "unit_admin", "create_local_service_order_intake"),
    ).toBe(true);
    // A plain member may not create an instrument; as unit_admin of the event's unit they may.
    expect(allowed("member", null, "create_local_asset")).toBe(false);
    expect(allowed("member", "unit_admin", "create_local_asset")).toBe(true);
  });
});

describe("REQ-SYNC-RBAC-5: the unit role is the one of the event's unit", () => {
  const member = {
    role: "member" as const,
    activeUnitId: 1,
    accessibleUnits: [
      { id: 1, name: "Alfa", slug: "alfa", role: "technician" as const },
      { id: 2, name: "Matriz", slug: "matriz", role: "member" as const },
    ],
  };

  it("takes the role from the event's unit, not from the active one", () => {
    expect(memberForEventUnit(member, { unitId: 1 })).toEqual({
      role: "member",
      unitRole: "technician",
    });
    expect(memberForEventUnit(member, { unitId: 2 })).toEqual({
      role: "member",
      unitRole: "member",
    });
  });

  it("follows the unit the apply uses when the event names none: payload unit, then active unit", () => {
    expect(
      memberForEventUnit(member, { unitId: null, payload: { unitId: 2 } }),
    ).toMatchObject({ unitRole: "member" });
    expect(memberForEventUnit(member, { unitId: null })).toMatchObject({
      unitRole: "technician",
    });
  });

  it("gives no unit role in a unit the member has no assignment in", () => {
    expect(memberForEventUnit(member, { unitId: 99 }).unitRole).toBeNull();
    expect(
      memberForEventUnit({ ...member, activeUnitId: null }, { unitId: null })
        .unitRole,
    ).toBeNull();
  });
});

// The online route an operation was derived from still asks for the same
// permission: reads the route source and finds
// `.<method>("<path>", ...withLabPermission({...}))`, or, for a domain converted
// to endpoint definitions, `mount(router, prefix, <group>.<name>, withLabPermission({...}), ...)` (the guard may lead an array of middleware: `[...withLabPermission({...}), zValidator("param", ...)]`).
const ROUTE_FILES: Record<string, string> = {
  "/api/jobs": "../jobs/routes/jobs.ts",
  "/api/assets": "../../routes/assets.ts",
  "/api/service-orders": "../service-orders/routes/service-orders.ts",
};

function squash(text: string) {
  return text.replace(/\s+/g, "").replace(/,([}\]])/g, "$1");
}

function describeTable(permission: object) {
  return `{${Object.entries(permission)
    .map(
      ([resource, actions]) =>
        `${resource}:[${(Array.isArray(actions) ? actions : []).map((action) => JSON.stringify(action)).join(",")}]`,
    )
    .join(",")}}`;
}

describe("REQ-SYNC-RBAC-2: the table follows the online routes", () => {
  const derived = OPERATIONS.flatMap((op) => {
    const [method, route] = SYNC_OPERATIONS[op].onlineRoute.split(" ");
    const prefix = Object.keys(ROUTE_FILES).find((p) => route?.startsWith(p));
    return method && route && prefix ? [{ op, method, route, prefix }] : [];
  });

  it("derives every operation from a route file except the attachment event", () => {
    // The attachment event follows the attachment endpoints' permission, not a
    // `withLabPermission` literal in a route file.
    expect(derived.map(({ op }) => op).toSorted()).toEqual(
      OPERATIONS.filter((op) => op !== "create_local_attachment").toSorted(),
    );
  });

  it.each(derived)(
    "$op follows $method $route",
    ({ op, method, route, prefix }) => {
      const file = ROUTE_FILES[prefix];
      if (!file) throw new Error(`no route file for ${prefix}`);
      const source = readFileSync(
        fileURLToPath(new URL(file, import.meta.url)),
        "utf8",
      );
      const path = route.slice(prefix.length) || "/";
      const escaped = path.replace(/[/:.]/g, (ch) => `\\${ch}`);
      const defined = Object.values(ENDPOINT_GROUPS)
        .flatMap((group) => Object.entries(group))
        .find(
          ([, def]) =>
            endpointLabel(def) === `${method.toUpperCase()} ${route}`,
        );
      const pattern = defined
        ? new RegExp(
            `Endpoints\\.${defined[0]},\\s*(?:\\[\\s*\\.\\.\\.)?withLabPermission\\((\\{[^}]*\\})\\)`,
          )
        : new RegExp(
            `\\.${method.toLowerCase()}\\(\\s*"${escaped}",\\s*\\.\\.\\.withLabPermission\\((\\{[^}]*\\})\\)`,
          );
      const found = pattern.exec(source);
      expect(found, `${method} ${route} not found in ${file}`).not.toBeNull();
      expect(squash(found?.[1] ?? "")).toBe(
        describeTable(SYNC_OPERATIONS[op].permission),
      );
    },
  );
});
