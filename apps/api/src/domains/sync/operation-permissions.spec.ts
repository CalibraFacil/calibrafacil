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
  SYNC_ATTACHMENT_PERMISSION,
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
// permission: the route is an endpoint definition (`onlineRoute` names it by
// "METHOD /path"), its permission is the definition's `permission` field, which
// `mount` applies as `withLabPermission` -- so this compares data with data.
const ENDPOINT_DEFINITIONS = Object.values(ENDPOINT_GROUPS).flatMap((group) =>
  Object.values(group),
);

function definitionOf(onlineRoute: string) {
  return ENDPOINT_DEFINITIONS.find((def) => endpointLabel(def) === onlineRoute);
}

describe("REQ-SYNC-RBAC-2: the table follows the online routes", () => {
  // The attachment event follows the attachment endpoints (`/api/sync/attachments/*`),
  // plain routes that take the table's own entry (SYNC_ATTACHMENT_PERMISSION).
  const fromDefinition = OPERATIONS.filter(
    (op) => op !== "create_local_attachment",
  );

  it("names a mounted endpoint definition as the online route of every operation but the attachment event", () => {
    for (const op of fromDefinition) {
      const { onlineRoute } = SYNC_OPERATIONS[op];
      expect(definitionOf(onlineRoute), `${op}: ${onlineRoute}`).toBeDefined();
    }
  });

  it.each(fromDefinition)("%s has the permission of its online route", (op) => {
    const { onlineRoute, permission } = SYNC_OPERATIONS[op];
    const definition = definitionOf(onlineRoute);
    expect(definition?.permission, `${op}: ${onlineRoute}`).toBeDefined();
    expect(definition?.permission).toEqual(permission);
  });

  it("create_local_attachment: the attachment endpoints use the table's permission", () => {
    expect(SYNC_ATTACHMENT_PERMISSION).toEqual(
      SYNC_OPERATIONS.create_local_attachment.permission,
    );
  });
});
