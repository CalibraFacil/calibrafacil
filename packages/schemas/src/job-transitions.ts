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
//   execute          apps/api/src/routes/jobs.ts:2137,2242,2288 (save worksheet:
//                      DRAFT -> IN_PROGRESS, otherwise the status is kept)
//                    apps/api/src/routes/sync.ts:2618 (desktop save, same rule)
//                    packages/local-db/src/execution.ts:245,252-257 (offline save)
//   record_results   apps/api/src/routes/public-api-v2.ts:3641,3657 (public API
//                      results: always lands in IN_PROGRESS, REJECTED included -
//                      kept as its own command because the cloud/desktop save
//                      keeps a REJECTED job REJECTED)
//   submit           apps/api/src/routes/jobs.ts:1768,1961
//                    apps/api/src/routes/public-api-v2.ts:3753,3791
//                    apps/api/src/routes/sync.ts:2618,2640
//                    packages/local-db/src/execution.ts:245,253
//   reject           apps/api/src/routes/jobs.ts:2563,2578,2587
//                    apps/api/src/routes/public-api-v2.ts:4059,4075,4084
//   approve          apps/api/src/modules/jobs/approve-job.ts:274,385
//                      (REVIEW only: a REJECTED job must be resubmitted first)
//   complete_render  apps/worker/src/index.ts:488-489,529,1809,1959 (the render
//                      worker: GENERATING_PDF -> APPROVED; SUPERSEDED keeps its
//                      status while the watermarked PDF is regenerated)
//   fail_render      apps/worker/src/index.ts:727,732 (setJobError)
//                    packages/db/src/queue-render-recovery.ts:80,90 (backstop)
//   revert_approval  apps/api/src/modules/jobs/approve-job.ts:532,549 (dispatch
//                      failed after the approval: back to the status approved from)
//   cancel           apps/api/src/modules/jobs/job-status-transitions.ts
//                    apps/api/src/routes/jobs.ts:2747,2761,2766
//                    apps/api/src/routes/public-api-v2.ts:4160,4177,4182
//                    apps/api/src/routes/visits.ts:736,753,758
//   amend            apps/api/src/routes/jobs.ts:2838,2912,2921
//   edit             apps/api/src/routes/jobs.ts:1370,1483 (technician / due date)
//                    apps/api/src/routes/public-api-v2.ts:3486,3539
//   assign           apps/api/src/routes/jobs.ts:1556,1692 (technician)
//
// The pre-existing rules are kept exactly, including two that read as
// accidents (assign is accepted for CANCELED and GENERATING_PDF jobs; the
// public API results route moves a REJECTED job to IN_PROGRESS). Changing
// them is a product decision made here, in one place, with the tests beside it.

import type { JobStatus } from "./index";

export const JOB_COMMANDS = [
  "create",
  "execute",
  "record_results",
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

  { from: "DRAFT", command: "record_results", to: "IN_PROGRESS" },
  { from: "IN_PROGRESS", command: "record_results", to: "IN_PROGRESS" },
  { from: "REJECTED", command: "record_results", to: "IN_PROGRESS" },

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
  { from: "GENERATING_PDF", command: "assign", to: "GENERATING_PDF" },
  { from: "CANCELED", command: "assign", to: "CANCELED" },
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
