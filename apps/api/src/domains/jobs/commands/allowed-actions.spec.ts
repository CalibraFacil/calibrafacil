import { describe, expect, it } from "vitest";
import { allowedJobActions } from "./allowed-actions";

const admin = { role: "admin" as const, unitRole: null };
const technician = { role: "technician" as const, unitRole: null };

describe("allowedJobActions (roadmap 2 F1)", () => {
  it("in REVIEW an admin may approve, reject, cancel and assign; not amend or withdraw", () => {
    const actions = allowedJobActions({
      status: "REVIEW",
      member: admin,
      selfApprovalBlocked: false,
      certificateStatus: null,
      amendmentInProgress: false,
    });
    expect(actions.approve).toEqual({ allowed: true });
    expect(actions.reject).toEqual({ allowed: true });
    expect(actions.cancel).toEqual({ allowed: true });
    expect(actions.assign).toEqual({ allowed: true });
    expect(actions.amend).toEqual({ allowed: false, reason: "status" });
    expect(actions.withdraw).toEqual({ allowed: false, reason: "status" });
  });

  it("separation of duties: the approver who did the work may reject but not approve", () => {
    const actions = allowedJobActions({
      status: "REVIEW",
      member: admin,
      selfApprovalBlocked: true,
      certificateStatus: null,
      amendmentInProgress: false,
    });
    expect(actions.approve).toEqual({
      allowed: false,
      reason: "self_approval",
    });
    expect(actions.reject).toEqual({ allowed: true });
  });

  it("a technician may neither approve nor amend (role)", () => {
    const actions = allowedJobActions({
      status: "REVIEW",
      member: technician,
      selfApprovalBlocked: false,
      certificateStatus: null,
      amendmentInProgress: false,
    });
    expect(actions.approve).toEqual({ allowed: false, reason: "permission" });
    expect(actions.amend).toEqual({ allowed: false, reason: "permission" });
  });

  it("an issued certificate may be amended once and withdrawn; a withdrawn one neither", () => {
    const issued = allowedJobActions({
      status: "APPROVED",
      member: admin,
      selfApprovalBlocked: false,
      certificateStatus: "ISSUED",
      amendmentInProgress: false,
    });
    expect(issued.amend).toEqual({ allowed: true });
    expect(issued.withdraw).toEqual({ allowed: true });
    expect(issued.approve).toEqual({ allowed: false, reason: "status" });

    const amending = allowedJobActions({
      status: "APPROVED",
      member: admin,
      selfApprovalBlocked: false,
      certificateStatus: "ISSUED",
      amendmentInProgress: true,
    });
    expect(amending.amend).toEqual({
      allowed: false,
      reason: "amendment_in_progress",
    });

    const withdrawn = allowedJobActions({
      status: "APPROVED",
      member: admin,
      selfApprovalBlocked: false,
      certificateStatus: "WITHDRAWN",
      amendmentInProgress: false,
    });
    expect(withdrawn.amend).toEqual({
      allowed: false,
      reason: "certificate_withdrawn",
    });
    expect(withdrawn.withdraw).toEqual({
      allowed: false,
      reason: "certificate_withdrawn",
    });
  });
});
