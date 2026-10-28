import { canTransition } from "@calibra-facil/schemas/job-transitions";
import type { JobAction, JobActionVerdict } from "@calibra-facil/contracts";
import {
  getCalibrationAuthorizationRole,
  hasPermissionLocally,
  type MemberData,
} from "../../middleware/permission";
import type { PermissionCheck } from "@calibra-facil/auth/access";

/**
 * What the signed-in member may do with a job right now (roadmap 2 F1, review
 * 3.5), decided by the server with the same rules the commands apply: the
 * status machine (`canTransition`), the RBAC permission of the command's route,
 * separation of duties (B5) and the certificate's lifecycle (B3). The web shows
 * the buttons from it instead of re-deriving the rules; the command still checks
 * everything again when it runs.
 */
const ACTION_PERMISSION: Record<JobAction, PermissionCheck> = {
  approve: { calibration: ["approve"] },
  reject: { calibration: ["reject"] },
  cancel: { calibration: ["delete"] },
  assign: { calibration: ["assign_technician"] },
  amend: { calibration: ["approve"] },
  withdraw: { calibration: ["approve"] },
};

const ADMIN_ONLY: ReadonlySet<JobAction> = new Set(["amend", "withdraw"]);

export type AllowedActionsInput = {
  status: string;
  member: Pick<MemberData, "role" | "unitRole">;
  /** B5: the approver did the work and the laboratory does not allow it. */
  selfApprovalBlocked: boolean;
  /** B3: the issued certificate's lifecycle (null when none was issued). */
  certificateStatus:
    | "ISSUED"
    | "SUPERSEDED"
    | "WITHDRAWN"
    | "REINSTATED"
    | null;
  amendmentInProgress: boolean;
};

export function allowedJobActions(
  input: AllowedActionsInput,
): Record<JobAction, JobActionVerdict> {
  const role = getCalibrationAuthorizationRole(input.member);
  const verdict = (action: JobAction): JobActionVerdict => {
    if (!hasPermissionLocally(role, ACTION_PERMISSION[action])) {
      return { allowed: false, reason: "permission" };
    }
    if (
      ADMIN_ONLY.has(action) &&
      input.member.role !== "admin" &&
      input.member.role !== "owner"
    ) {
      return { allowed: false, reason: "permission" };
    }
    if (action === "withdraw") {
      const issued =
        input.status === "APPROVED" || input.status === "SUPERSEDED";
      if (!issued || input.certificateStatus === null) {
        return { allowed: false, reason: "status" };
      }
      return input.certificateStatus === "WITHDRAWN"
        ? { allowed: false, reason: "certificate_withdrawn" }
        : { allowed: true };
    }
    if (!canTransition(input.status, action)) {
      return { allowed: false, reason: "status" };
    }
    if (action === "approve" && input.selfApprovalBlocked) {
      return { allowed: false, reason: "self_approval" };
    }
    if (action === "amend") {
      if (input.certificateStatus === "WITHDRAWN") {
        return { allowed: false, reason: "certificate_withdrawn" };
      }
      if (input.amendmentInProgress) {
        return { allowed: false, reason: "amendment_in_progress" };
      }
    }
    return { allowed: true };
  };
  return {
    approve: verdict("approve"),
    reject: verdict("reject"),
    cancel: verdict("cancel"),
    assign: verdict("assign"),
    amend: verdict("amend"),
    withdraw: verdict("withdraw"),
  };
}
