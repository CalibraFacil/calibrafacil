/**
 * CUT-LINE / HIGH-RISK: Calibration Approval State Machine
 *
 * Mini-spec: specs/coverage-risk/01-calibration-approval-state-machine.md
 *
 * These tests assert the ISO 17025 separation-of-duties oracle.  IF the
 * production code ever disagrees with a value here, a test will fail.  Do NOT
 * relax or remove an assertion to silence a failure — escalate to a human.
 *
 * The spec file is test-only.  `access.ts` MUST NOT be modified.
 */

import { describe, expect, it } from "vitest";
import {
  type CalibrationAction,
  type CalibrationState,
  type RoleName,
  calibrationWorkflowPermissions,
  canPerformCalibrationAction,
  getAllowedCalibrationActions,
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

const ALL_STATES: CalibrationState[] = [
  "draft",
  "submitted",
  "in_review",
  "approved",
  "rejected",
];

const ALL_ACTIONS: CalibrationAction[] = [
  "edit",
  "delete",
  "submit",
  "approve",
  "reject",
];

// ---------------------------------------------------------------------------
// REQ-CAL-011: calibrationWorkflowPermissions deep-equality guard
// ---------------------------------------------------------------------------

// REQ-CAL-011 [HIGH RISK]: The calibrationWorkflowPermissions object SHALL equal
// the oracle matrix.  Any future edit to a single cell fails this test.
describe("REQ-CAL-011: calibrationWorkflowPermissions matches oracle matrix", () => {
  it("draft row matches oracle", () => {
    expect(calibrationWorkflowPermissions.draft).toStrictEqual({
      canEdit: ["operator", "technician", "admin", "owner"],
      canDelete: ["technician", "admin", "owner"],
      canSubmit: ["operator", "technician", "admin", "owner"],
      canApprove: [],
      canReject: [],
    });
  });

  it("submitted row matches oracle", () => {
    expect(calibrationWorkflowPermissions.submitted).toStrictEqual({
      canEdit: [],
      canDelete: ["admin", "owner"],
      canSubmit: [],
      canApprove: ["admin", "owner"],
      canReject: ["admin", "owner"],
    });
  });

  it("in_review row matches oracle", () => {
    expect(calibrationWorkflowPermissions.in_review).toStrictEqual({
      canEdit: ["admin", "owner"],
      canDelete: [],
      canSubmit: [],
      canApprove: ["admin", "owner"],
      canReject: ["admin", "owner"],
    });
  });

  it("approved row matches oracle (immutable — all empty)", () => {
    expect(calibrationWorkflowPermissions.approved).toStrictEqual({
      canEdit: [],
      canDelete: [],
      canSubmit: [],
      canApprove: [],
      canReject: [],
    });
  });

  it("rejected row matches oracle", () => {
    expect(calibrationWorkflowPermissions.rejected).toStrictEqual({
      canEdit: ["operator", "technician", "admin", "owner"],
      canDelete: ["technician", "admin", "owner"],
      canSubmit: ["operator", "technician", "admin", "owner"],
      canApprove: [],
      canReject: [],
    });
  });
});

// ---------------------------------------------------------------------------
// REQ-CAL-001: approved state is immutable for ALL roles × ALL actions
// ---------------------------------------------------------------------------

// REQ-CAL-001 [HIGH RISK]: WHEN evaluating any action in state `approved`,
// canPerformCalibrationAction SHALL return false for EVERY role and EVERY action.
describe("REQ-CAL-001: approved state is immutable (ISO 17025)", () => {
  for (const role of ALL_ROLES) {
    for (const action of ALL_ACTIONS) {
      it(`role=${role} action=${action} → false`, () => {
        expect(canPerformCalibrationAction(role, "approved", action)).toBe(
          false,
        );
      });
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

// REQ-CAL-004 [HIGH RISK]: If a calibration is `submitted`, edit SHALL return
// false for EVERY role.
describe("REQ-CAL-004: no edits after submission", () => {
  for (const role of ALL_ROLES) {
    it(`role=${role} state=submitted action=edit → false`, () => {
      expect(canPerformCalibrationAction(role, "submitted", "edit")).toBe(
        false,
      );
    });
  }
});

// ---------------------------------------------------------------------------
// REQ-CAL-005: only admin/owner can approve or reject in submitted/in_review
// ---------------------------------------------------------------------------

// REQ-CAL-005 [HIGH RISK]: approve/reject in submitted or in_review SHALL
// return true ONLY for admin and owner, and false for all other roles.
describe("REQ-CAL-005: only admin/owner can approve or reject in submitted or in_review", () => {
  const approvalStates: CalibrationState[] = ["submitted", "in_review"];
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
    expect(canPerformCalibrationAction("technician", "draft", "delete")).toBe(
      true,
    );
  });
  it("admin can delete draft", () => {
    expect(canPerformCalibrationAction("admin", "draft", "delete")).toBe(true);
  });
  it("owner can delete draft", () => {
    expect(canPerformCalibrationAction("owner", "draft", "delete")).toBe(true);
  });
  it("operator cannot delete draft", () => {
    expect(canPerformCalibrationAction("operator", "draft", "delete")).toBe(
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
  const revisableStates: CalibrationState[] = ["draft", "rejected"];
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
    expect(canPerformCalibrationAction("operator", "draft", "edit")).toBe(true);
    expect(canPerformCalibrationAction("operator", "draft", "delete")).toBe(
      false,
    );
  });

  it("draft/technician: edit=true, delete=true, approve=false (distinct lists)", () => {
    expect(canPerformCalibrationAction("technician", "draft", "edit")).toBe(
      true,
    );
    expect(canPerformCalibrationAction("technician", "draft", "delete")).toBe(
      true,
    );
    expect(canPerformCalibrationAction("technician", "draft", "approve")).toBe(
      false,
    );
  });

  it("submitted/admin: edit=false, delete=true, approve=true (all from different lists)", () => {
    expect(canPerformCalibrationAction("admin", "submitted", "edit")).toBe(
      false,
    );
    expect(canPerformCalibrationAction("admin", "submitted", "delete")).toBe(
      true,
    );
    expect(canPerformCalibrationAction("admin", "submitted", "approve")).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// REQ-CAL-009: getAllowedCalibrationActions returns empty array for approved
// ---------------------------------------------------------------------------

// REQ-CAL-009 [HIGH RISK]: getAllowedCalibrationActions(role, "approved") SHALL
// return [] for EVERY role.
describe("REQ-CAL-009: getAllowedCalibrationActions returns [] for approved state", () => {
  for (const role of ALL_ROLES) {
    it(`role=${role} → []`, () => {
      expect(getAllowedCalibrationActions(role, "approved")).toStrictEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// REQ-CAL-010: getAllowedCalibrationActions specific oracle values
// ---------------------------------------------------------------------------

// REQ-CAL-010: Specific oracle outputs for owner/draft and admin/submitted.
describe("REQ-CAL-010: getAllowedCalibrationActions oracle values", () => {
  it('owner + draft → ["edit","delete","submit"]', () => {
    expect(getAllowedCalibrationActions("owner", "draft")).toStrictEqual([
      "edit",
      "delete",
      "submit",
    ]);
  });

  it('admin + submitted → ["delete","approve","reject"]', () => {
    expect(getAllowedCalibrationActions("admin", "submitted")).toStrictEqual([
      "delete",
      "approve",
      "reject",
    ]);
  });
});
