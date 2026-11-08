/**
 * CUT-LINE / HIGH-RISK: Calibration Approval State Machine
 *
 * Mini-spec: specs/coverage-risk/01-calibration-approval-state-machine.md
 *
 * These tests assert the ISO 17025 separation-of-duties oracle.  IF the
 * production code ever disagrees with a value here, a test will fail.  Do NOT
 * relax or remove an assertion to silence a failure — escalate to a human.
 *
 * `canPerformCalibrationAction` is derived from the job status machine
 * (`@calibra-facil/schemas/job-transitions`) and the role definitions, not from
 * a table of its own; the oracle below is written by hand on purpose, so a
 * change to either source that moves a cell fails here.
 */

import { describe, expect, it } from "vitest";
import type { JobStatus } from "@calibra-facil/schemas";
import {
  type CalibrationAction,
  type RoleName,
  CALIBRATION_APPROVER_ROLES,
  CALIBRATION_EXECUTOR_ROLES,
  canPerformCalibrationAction,
  roleIsOneOf,
  rolesAllowedTo,
} from "./access.js";

// ---------------------------------------------------------------------------
// Canonical sets (keep in sync with the oracle in the mini-spec)
// ---------------------------------------------------------------------------

const ALL_ROLES: RoleName[] = [
  "client_user",
  "member",
  "operator",
  "technician",
  "admin",
  "owner",
];

const ALL_STATES: JobStatus[] = [
  "DRAFT",
  "IN_PROGRESS",
  "REVIEW",
  "GENERATING_PDF",
  "RENDER_FAILED",
  "APPROVED",
  "REJECTED",
  "CANCELED",
  "SUPERSEDED",
];

const ALL_ACTIONS: CalibrationAction[] = [
  "edit",
  "delete",
  "submit",
  "approve",
  "reject",
];

// ---------------------------------------------------------------------------
// REQ-CAL-011: the (role, status, action) oracle
// ---------------------------------------------------------------------------

// REQ-CAL-011 [HIGH RISK]: For the statuses a person works a job in, the actions
// each role may perform SHALL equal the oracle.  Any change to a single cell
// fails this test.
describe("REQ-CAL-011: allowed actions match the oracle", () => {
  const ORACLE: Record<
    "DRAFT" | "REVIEW" | "REJECTED",
    Record<RoleName, CalibrationAction[]>
  > = {
    DRAFT: {
      owner: ["edit", "delete", "submit"],
      admin: ["edit", "delete", "submit"],
      technician: ["edit", "delete", "submit"],
      operator: ["edit", "submit"],
      member: [],
      client_user: [],
    },
    // Only the review decision and a cancellation: the worksheet is not
    // editable in review (the job machine has no `execute` from REVIEW).
    REVIEW: {
      owner: ["delete", "approve", "reject"],
      admin: ["delete", "approve", "reject"],
      technician: ["delete"],
      operator: [],
      member: [],
      client_user: [],
    },
    REJECTED: {
      owner: ["edit", "delete", "submit"],
      admin: ["edit", "delete", "submit"],
      technician: ["edit", "delete", "submit"],
      operator: ["edit", "submit"],
      member: [],
      client_user: [],
    },
  };

  for (const [status, byRole] of Object.entries(ORACLE)) {
    for (const [role, expected] of Object.entries(byRole)) {
      it(`status=${status} role=${role}`, () => {
        expect(
          ALL_ACTIONS.filter((action) =>
            canPerformCalibrationAction(
              roleOf(role),
              jobStatusOf(status),
              action,
            ),
          ),
        ).toStrictEqual(expected);
      });
    }
  }

  it("approve and reject are held by admin and owner only", () => {
    expect(rolesAllowedTo("approve")).toStrictEqual(["admin", "owner"]);
    expect(rolesAllowedTo("reject")).toStrictEqual(["admin", "owner"]);
  });

  it("the shared approver and executor role lists are the roles that hold the permission", () => {
    expect([...CALIBRATION_APPROVER_ROLES].sort()).toStrictEqual([
      "admin",
      "owner",
    ]);
    // Who can do the work of a calibration, never the read-only staff role or the portal.
    expect([...CALIBRATION_EXECUTOR_ROLES].sort()).toStrictEqual([
      "admin",
      "operator",
      "owner",
      "technician",
    ]);
    expect(roleIsOneOf("owner", CALIBRATION_APPROVER_ROLES)).toBe(true);
    expect(roleIsOneOf("technician", CALIBRATION_APPROVER_ROLES)).toBe(false);
    expect(roleIsOneOf("not-a-role", CALIBRATION_EXECUTOR_ROLES)).toBe(false);
  });
});

function roleOf(value: string): RoleName {
  const role = ALL_ROLES.find((candidate) => candidate === value);
  if (!role) throw new Error(`not a role: ${value}`);
  return role;
}

function jobStatusOf(value: string): JobStatus {
  const status = ALL_STATES.find((candidate) => candidate === value);
  if (!status) throw new Error(`not a job status: ${value}`);
  return status;
}

// ---------------------------------------------------------------------------
// REQ-CAL-001: approved state is immutable for ALL roles × ALL actions
// ---------------------------------------------------------------------------

// REQ-CAL-001 [HIGH RISK]: WHEN evaluating any action in state `approved`,
// canPerformCalibrationAction SHALL return false for EVERY role and EVERY action.
describe("REQ-CAL-001: approved state is immutable (ISO 17025)", () => {
  const released: JobStatus[] = ["APPROVED", "SUPERSEDED"];
  for (const status of released) {
    for (const role of ALL_ROLES) {
      for (const action of ALL_ACTIONS) {
        it(`status=${status} role=${role} action=${action} → false`, () => {
          expect(canPerformCalibrationAction(role, status, action)).toBe(false);
        });
      }
    }
  }
});

// ---------------------------------------------------------------------------
// REQ-CAL-002: operator and technician SHALL NOT approve or reject in ANY state
// ---------------------------------------------------------------------------

// REQ-CAL-002 [HIGH RISK]: {operator,technician} × {approve,reject} × every
// CalibrationState SHALL always be false (separation of duties).
describe("REQ-CAL-002: operator/technician cannot approve or reject in any state", () => {
  const restricted: RoleName[] = ["operator", "technician"];
  const approvalActions: CalibrationAction[] = ["approve", "reject"];

  for (const role of restricted) {
    for (const action of approvalActions) {
      for (const state of ALL_STATES) {
        it(`role=${role} action=${action} state=${state} → false`, () => {
          expect(canPerformCalibrationAction(role, state, action)).toBe(false);
        });
      }
    }
  }
});

// ---------------------------------------------------------------------------
// REQ-CAL-003: member and client_user cannot perform ANY action in ANY state
// ---------------------------------------------------------------------------

// REQ-CAL-003 [HIGH RISK]: {member,client_user} × every action × every state
// SHALL always return false.
describe("REQ-CAL-003: member and client_user cannot perform any calibration action", () => {
  const nonParticipants: RoleName[] = ["member", "client_user"];

  for (const role of nonParticipants) {
    for (const action of ALL_ACTIONS) {
      for (const state of ALL_STATES) {
        it(`role=${role} action=${action} state=${state} → false`, () => {
          expect(canPerformCalibrationAction(role, state, action)).toBe(false);
        });
      }
    }
  }
});

// ---------------------------------------------------------------------------
// REQ-CAL-004: no role can edit once submitted
// ---------------------------------------------------------------------------

// REQ-CAL-004 [HIGH RISK]: If a calibration is in review, edit SHALL return
// false for EVERY role.
describe("REQ-CAL-004: no edits after submission", () => {
  for (const role of ALL_ROLES) {
    it(`role=${role} status=REVIEW action=edit → false`, () => {
      expect(canPerformCalibrationAction(role, "REVIEW", "edit")).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------
// REQ-CAL-005: only admin/owner can approve or reject a job in review
// ---------------------------------------------------------------------------

// REQ-CAL-005 [HIGH RISK]: approve/reject in REVIEW SHALL return true ONLY for
// admin and owner, and false for all other roles.
describe("REQ-CAL-005: only admin/owner can approve or reject in review", () => {
  const approvalStates: JobStatus[] = ["REVIEW"];
  const approvalActions: CalibrationAction[] = ["approve", "reject"];

  const shouldBeTrue: RoleName[] = ["admin", "owner"];
  const shouldBeFalse = ALL_ROLES.filter((r) => !shouldBeTrue.includes(r));

  for (const state of approvalStates) {
    for (const action of approvalActions) {
      for (const role of shouldBeTrue) {
        it(`role=${role} action=${action} state=${state} → true`, () => {
          expect(canPerformCalibrationAction(role, state, action)).toBe(true);
        });
      }
      for (const role of shouldBeFalse) {
        it(`role=${role} action=${action} state=${state} → false`, () => {
          expect(canPerformCalibrationAction(role, state, action)).toBe(false);
        });
      }
    }
  }
});

// ---------------------------------------------------------------------------
// REQ-CAL-006: draft delete: technician/admin/owner=true, operator=false
// ---------------------------------------------------------------------------

// REQ-CAL-006 [HIGH RISK]: In draft, delete SHALL be true for
// {technician,admin,owner} and false for operator.
describe("REQ-CAL-006: draft delete permissions", () => {
  it("technician can delete draft", () => {
    expect(canPerformCalibrationAction("technician", "DRAFT", "delete")).toBe(
      true,
    );
  });
  it("admin can delete draft", () => {
    expect(canPerformCalibrationAction("admin", "DRAFT", "delete")).toBe(true);
  });
  it("owner can delete draft", () => {
    expect(canPerformCalibrationAction("owner", "DRAFT", "delete")).toBe(true);
  });
  it("operator cannot delete draft", () => {
    expect(canPerformCalibrationAction("operator", "DRAFT", "delete")).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// REQ-CAL-007: draft and rejected allow edit + submit for operator/technician/admin/owner
// ---------------------------------------------------------------------------

// REQ-CAL-007: In draft and rejected, canEdit and canSubmit SHALL be true for
// {operator,technician,admin,owner} — rejected calibrations are revisable.
describe("REQ-CAL-007: draft and rejected are revisable by operator/technician/admin/owner", () => {
  const revisableStates: JobStatus[] = ["DRAFT", "REJECTED"];
  const revisableRoles: RoleName[] = [
    "operator",
    "technician",
    "admin",
    "owner",
  ];
  const revisableActions: CalibrationAction[] = ["edit", "submit"];

  for (const state of revisableStates) {
    for (const role of revisableRoles) {
      for (const action of revisableActions) {
        it(`role=${role} state=${state} action=${action} → true`, () => {
          expect(canPerformCalibrationAction(role, state, action)).toBe(true);
        });
      }
    }
  }
});

// ---------------------------------------------------------------------------
// REQ-CAL-008: canPerformCalibrationAction maps action to the correct list
// ---------------------------------------------------------------------------

// REQ-CAL-008 [HIGH RISK]: Each action maps to its own list — verified by a
// case where two lists differ for the same state/role.
// In draft: operator → edit=true, delete=false (canEdit ≠ canDelete).
describe("REQ-CAL-008: action correctly maps to distinct permission lists", () => {
  it("draft/operator: edit=true (canEdit) but delete=false (canDelete)", () => {
    expect(canPerformCalibrationAction("operator", "DRAFT", "edit")).toBe(true);
    expect(canPerformCalibrationAction("operator", "DRAFT", "delete")).toBe(
      false,
    );
  });

  it("draft/technician: edit=true, delete=true, approve=false (distinct lists)", () => {
    expect(canPerformCalibrationAction("technician", "DRAFT", "edit")).toBe(
      true,
    );
    expect(canPerformCalibrationAction("technician", "DRAFT", "delete")).toBe(
      true,
    );
    expect(canPerformCalibrationAction("technician", "DRAFT", "approve")).toBe(
      false,
    );
  });

  it("REVIEW/admin: edit=false, delete=true, approve=true (distinct)", () => {
    expect(canPerformCalibrationAction("admin", "REVIEW", "edit")).toBe(false);
    expect(canPerformCalibrationAction("admin", "REVIEW", "delete")).toBe(true);
    expect(canPerformCalibrationAction("admin", "REVIEW", "approve")).toBe(
      true,
    );
  });
});
