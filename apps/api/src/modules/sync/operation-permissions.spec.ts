import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SYNC_COMMAND_OPERATIONS } from "@calibra-facil/contracts";
import type { RoleName } from "@calibra-facil/auth/access";
import {
  SYNC_OPERATION_PERMISSIONS,
  authorizeSyncOperation,
  memberForEventUnit,
} from "./operation-permissions";

type Operation = keyof typeof SYNC_OPERATION_PERMISSIONS;

const OPERATIONS = Object.keys(SYNC_OPERATION_PERMISSIONS).filter(
  (key): key is Operation => key in SYNC_OPERATION_PERMISSIONS,
);

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
const MANAGER_ROLES: readonly RoleName[] = ["owner", "admin"];

/**
 * Who the ONLINE routes let through, written out by hand from the role
 * definitions (packages/auth/src/access.ts): independent of the table, so a
 * table entry that drifts (or a role that gains a right) turns this red.
 */
const EXPECTED_ALLOWED: Record<Operation, readonly RoleName[]> = {
  create_local_job_draft: FIELD_ROLES,
  create_local_asset: FIELD_ROLES,
  update_local_asset: FIELD_ROLES,
  create_local_customer: FIELD_ROLES,
  update_local_customer: FIELD_ROLES,
  update_local_customer_compliance: FIELD_ROLES,
  save_local_execution: FIELD_ROLES,
  submit_local_execution: FIELD_ROLES,
  create_local_service_order_intake: ["owner", "admin", "operator", "member"],
  create_local_non_conformance: ["owner", "admin", "technician"],
  create_local_service_order_quote_draft: MANAGER_ROLES,
  save_local_service_order_execution_notes: FIELD_ROLES,
  create_local_service_order_delivery_document_draft: MANAGER_ROLES,
  create_local_attachment: FIELD_ROLES,
  create_local_certificate_draft: FIELD_ROLES,
  generate_local_certificate_pdf: MANAGER_ROLES,
};

describe("REQ-SYNC-RBAC-1: the push permission table", () => {
  it("covers exactly the operations of the push protocol", () => {
    expect(OPERATIONS.toSorted()).toEqual(SYNC_COMMAND_OPERATIONS.toSorted());
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

  it("a unit role elevates only on unit-scoped resources, as the online guard does", () => {
    // service_order is unit-scoped: a unit_admin operator may quote.
    expect(
      authorizeSyncOperation(
        { role: "operator", unitRole: "unit_admin" },
        "create_local_service_order_quote_draft",
      ).allowed,
    ).toBe(true);
    // client is not: the member role alone decides.
    expect(
      authorizeSyncOperation(
        { role: "member", unitRole: "unit_admin" },
        "create_local_customer",
      ).allowed,
    ).toBe(false);
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
// `.<method>("<path>", ...withLabPermission({...}))`.
const ROUTE_FILES: Record<string, string> = {
  "/api/jobs": "../../routes/jobs.ts",
  "/api/assets": "../../routes/assets.ts",
  "/api/customers": "../../routes/customers.ts",
  "/api/service-orders": "../../routes/service-orders.ts",
  "/api/non-conformances": "../../routes/non-conformances.ts",
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
    const [method, route] =
      SYNC_OPERATION_PERMISSIONS[op].onlineRoute.split(" ");
    const prefix = Object.keys(ROUTE_FILES).find((p) => route?.startsWith(p));
    return method && route && prefix ? [{ op, method, route, prefix }] : [];
  });

  it("derives every operation from a route file except the two with no route of their own", () => {
    // The attachment event follows the attachment endpoints' permission and the
    // legacy certificate-draft marker the push's former gate: neither is a
    // `withLabPermission` literal in a route file.
    expect(derived.map(({ op }) => op).toSorted()).toEqual(
      OPERATIONS.filter(
        (op) =>
          op !== "create_local_attachment" &&
          op !== "create_local_certificate_draft",
      ).toSorted(),
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
      const pattern = new RegExp(
        `\\.${method.toLowerCase()}\\(\\s*"${escaped}",\\s*\\.\\.\\.withLabPermission\\((\\{[^}]*\\})\\)`,
      );
      const found = pattern.exec(source);
      expect(found, `${method} ${route} not found in ${file}`).not.toBeNull();
      expect(squash(found?.[1] ?? "")).toBe(
        describeTable(SYNC_OPERATION_PERMISSIONS[op].permission),
      );
    },
  );
});
