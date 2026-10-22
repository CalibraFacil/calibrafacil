// The calibration job state machine (calibration_job.status) as data.
//
// This is the single owner of "which command may run from which status and
// where it lands". Routes, the worker, the queue backstop and the desktop
// local store ask this table instead of keeping their own status sets. It is
// pure: no database, no HTTP framework, so every runtime can import it.
//
//   DRAFT ──execute──▶ IN_PROGRESS ──submit──▶ REVIEW ──approve──▶ GENERATING_PDF
//     │ └──────────────submit──────────────────▶ │  ▲ reject          │ │
//     │                                  REJECTED ◀┘  └─ revert ───────┘ │ render ok
//     │                                     │  ▲ render failed ─────────┘ ▼
//     │                                     └──submit──▶ REVIEW        APPROVED ──amend──▶ SUPERSEDED
//     └─ cancel (DRAFT, IN_PROGRESS, REVIEW, REJECTED) ─▶ CANCELED
//
// Every row below was derived from the code path that performs it (file:line
// at the commit this table was introduced; the pre-checks and the
// compare-and-set WHERE clauses of those paths now read this table):
//
//   create           apps/api/src/lib/jobs.ts:444-457 (new job, status DRAFT)
//                    apps/api/src/routes/jobs.ts:2871,2891 (the amendment clone, DRAFT)
//   execute          apps/api/src/modules/jobs/submit-job.ts (`executeJob`: save
//                      worksheet / record results, for the cloud route, the
//                      public API and the desktop sync apply alike:
//                      DRAFT -> IN_PROGRESS, otherwise the status is kept)
//                    packages/local-db/src/execution.ts:245,252-257 (offline save)
//   submit           apps/api/src/modules/jobs/submit-job.ts (`submitJob`, for
//                      the cloud route, the public API and the desktop sync)
//                    packages/local-db/src/execution.ts:245,253
//   reject           apps/api/src/modules/jobs/reject-job.ts (`rejectJob`, for the
//                      cloud route and the public API)
//   approve          apps/api/src/modules/jobs/approve-job.ts:274,385
//                      (REVIEW only: a REJECTED job must be resubmitted first)
//   complete_render  apps/worker/src/index.ts:488-489,529,1809,1959 (the render
//                      worker: GENERATING_PDF -> APPROVED; SUPERSEDED keeps its
//                      status while the watermarked PDF is regenerated)
//   fail_render      apps/worker/src/index.ts:727,732 (setJobError)
//                    packages/db/src/queue-render-recovery.ts:80,90 (backstop)
//   revert_approval  apps/api/src/modules/jobs/approve-job.ts:532,549 (dispatch
//                      failed after the approval: back to the status approved from)
//   cancel           apps/api/src/modules/jobs/cancel-job.ts (`cancelJob`, for the
//                      cloud route, the public API DELETE and the visit's
//                      remove-job)
//                    apps/api/src/modules/jobs/job-status-transitions.ts
//   amend            apps/api/src/modules/jobs/amend-job.ts (`amendJob`)
//   edit             apps/api/src/modules/jobs/edit-job.ts (`editJob`: technician /
//                      due date, for the cloud PUT and the public PATCH)
//   assign           apps/api/src/modules/jobs/assign-job.ts (`assignJob`: technician,
//                      with the competence gate)
//
// The rules are the ones the code paths had, except where an owner decision
// changed them, in one place and with the tests beside it:
//
//   Q19  assign is allowed only for DRAFT, IN_PROGRESS, REVIEW and REJECTED. It
//        used to be accepted for CANCELED and GENERATING_PDF jobs too, which
//        read as an accident. APPROVED and SUPERSEDED were always refused.
//   Q18  a save keeps a REJECTED job REJECTED (`execute`). The public API
//        results route used to move it to IN_PROGRESS through a separate
//        `record_results` command; that command is gone with the unification.

import type { JobStatus } from "./job-status";

export const JOB_COMMANDS = [
  "create",
  "execute",
  "submit",
  "reject",
  "approve",
  "complete_render",
  "fail_render",
  "revert_approval",
  "cancel",
  "amend",
  "edit",
  "assign",
] as const;

export type JobCommand = (typeof JOB_COMMANDS)[number];

/** `from` is null only for `create`: there is no prior row to read a status from. */
export type JobTransition = {
  readonly from: JobStatus | null;
  readonly command: JobCommand;
  readonly to: JobStatus;
};

export const JOB_TRANSITIONS: readonly JobTransition[] = [
  { from: null, command: "create", to: "DRAFT" },

  { from: "DRAFT", command: "execute", to: "IN_PROGRESS" },
  { from: "IN_PROGRESS", command: "execute", to: "IN_PROGRESS" },
  { from: "REJECTED", command: "execute", to: "REJECTED" },

  { from: "DRAFT", command: "submit", to: "REVIEW" },
  { from: "IN_PROGRESS", command: "submit", to: "REVIEW" },
  { from: "REJECTED", command: "submit", to: "REVIEW" },

  { from: "REVIEW", command: "reject", to: "REJECTED" },

  { from: "REVIEW", command: "approve", to: "GENERATING_PDF" },

  { from: "GENERATING_PDF", command: "complete_render", to: "APPROVED" },
  { from: "SUPERSEDED", command: "complete_render", to: "SUPERSEDED" },

  { from: "GENERATING_PDF", command: "fail_render", to: "REJECTED" },

  { from: "GENERATING_PDF", command: "revert_approval", to: "REVIEW" },

  { from: "DRAFT", command: "cancel", to: "CANCELED" },
  { from: "IN_PROGRESS", command: "cancel", to: "CANCELED" },
  { from: "REVIEW", command: "cancel", to: "CANCELED" },
  { from: "REJECTED", command: "cancel", to: "CANCELED" },

  { from: "APPROVED", command: "amend", to: "SUPERSEDED" },

  { from: "DRAFT", command: "edit", to: "DRAFT" },
  { from: "IN_PROGRESS", command: "edit", to: "IN_PROGRESS" },
  { from: "REVIEW", command: "edit", to: "REVIEW" },
  { from: "REJECTED", command: "edit", to: "REJECTED" },
  { from: "GENERATING_PDF", command: "edit", to: "GENERATING_PDF" },

  { from: "DRAFT", command: "assign", to: "DRAFT" },
  { from: "IN_PROGRESS", command: "assign", to: "IN_PROGRESS" },
  { from: "REVIEW", command: "assign", to: "REVIEW" },
  { from: "REJECTED", command: "assign", to: "REJECTED" },
];

/**
 * The statuses `command` may start from, in table order. This is what a
 * compare-and-set WHERE clause takes (`inArray(calibrationJob.status, ...)`).
 * Empty for `create`, which starts from no status.
 */
export function allowedFrom(command: JobCommand): JobStatus[] {
  const statuses: JobStatus[] = [];
  for (const transition of JOB_TRANSITIONS) {
    if (transition.command === command && transition.from !== null) {
      statuses.push(transition.from);
    }
  }
  return statuses;
}

/**
 * Where `command` lands a job that is in `from` (null for `create`), or null
 * when the command is not legal from that status. `from` is any string so a
 * caller holding a raw database value (the worker, the desktop store) needs no
 * cast; an unknown status is simply illegal.
 */
export function targetOf(
  from: string | null,
  command: JobCommand,
): JobStatus | null {
  for (const transition of JOB_TRANSITIONS) {
    if (transition.command === command && transition.from === from) {
      return transition.to;
    }
  }
  return null;
}

export function canTransition(from: string | null, command: JobCommand) {
  return targetOf(from, command) !== null;
}

/** `targetOf` for a write that has already been checked: throws if it is illegal. */
export function requireTargetOf(
  from: string | null,
  command: JobCommand,
): JobStatus {
  const target = targetOf(from, command);
  if (target === null) {
    throw new Error(
      `Illegal job transition: ${command} from ${from ?? "(no status)"}`,
    );
  }
  return target;
}
