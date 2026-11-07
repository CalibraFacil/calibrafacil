// calibration_visit.status and visit_reschedule_request.status as data.
//
// A visit (calibração in loco: one technician trip, many instruments) is moved
// by the lab and, for its progress, by its jobs:
//   create      apps/api/src/routes/calibration-requests.ts (request → visit:
//                 CONFIRMED when the lab scheduled it, else PROPOSED)
//   confirm     routes/visits.ts POST /:id/confirm: a proposed visit is
//                 confirmed; on a confirmed or started visit it only updates the
//                 date / technician (it used to rewind IN_PROGRESS to CONFIRMED)
//   edit        routes/visits.ts reschedule, assign, the reschedule-request
//                 accept: any open visit, status unchanged
//   start       apps/api/src/lib/visits.ts `syncVisitStatusFromJobs`: a job of
//                 the visit left DRAFT
//   settle      the same: every job settled with at least one certificate
//   complete    routes/visits.ts POST /:id/complete (a confirmed or started trip)
//   cancel      routes/visits.ts POST /:id/cancel
import { defineStateMachine } from "../state-machine";

export const VISIT_STATUSES = [
  "PROPOSED",
  "CONFIRMED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];

const VISIT_COMMANDS = [
  "create",
  "confirm",
  "edit",
  "start",
  "settle",
  "complete",
  "cancel",
] as const;

export const VISIT_MACHINE = defineStateMachine({
  name: "calibration visit",
  states: VISIT_STATUSES,
  commands: VISIT_COMMANDS,
  transitions: [
    { from: null, command: "create", to: "PROPOSED" },
    { from: null, command: "create", to: "CONFIRMED" },

    { from: "PROPOSED", command: "confirm", to: "CONFIRMED" },
    { from: "CONFIRMED", command: "confirm", to: "CONFIRMED" },
    { from: "IN_PROGRESS", command: "confirm", to: "IN_PROGRESS" },

    { from: "PROPOSED", command: "edit", to: "PROPOSED" },
    { from: "CONFIRMED", command: "edit", to: "CONFIRMED" },
    { from: "IN_PROGRESS", command: "edit", to: "IN_PROGRESS" },

    { from: "PROPOSED", command: "start", to: "IN_PROGRESS" },
    { from: "CONFIRMED", command: "start", to: "IN_PROGRESS" },

    { from: "PROPOSED", command: "settle", to: "COMPLETED" },
    { from: "CONFIRMED", command: "settle", to: "COMPLETED" },
    { from: "IN_PROGRESS", command: "settle", to: "COMPLETED" },

    { from: "CONFIRMED", command: "complete", to: "COMPLETED" },
    { from: "IN_PROGRESS", command: "complete", to: "COMPLETED" },

    { from: "PROPOSED", command: "cancel", to: "CANCELLED" },
    { from: "CONFIRMED", command: "cancel", to: "CANCELLED" },
    { from: "IN_PROGRESS", command: "cancel", to: "CANCELLED" },
  ],
});

/** Closed for the lab's edits: completed or cancelled. */
export function isVisitTerminal(status: string): boolean {
  return !VISIT_MACHINE.canTransition(status, "edit");
}

// A customer's request to move the visit date (portal). One PENDING request per
// visit (partial unique index); the lab accepts or declines it, and a lab-driven
// date change, a cancellation or a completion supersedes it.
//   create     apps/api/src/routes/portal-visits.ts
//   accept     routes/visits.ts POST /:id/reschedule-requests/:requestId/accept
//   decline    the same, /decline
//   supersede  routes/visits.ts `supersedePendingRescheduleRequests`
const VISIT_RESCHEDULE_REQUEST_STATUSES = [
  "PENDING",
  "ACCEPTED",
  "DECLINED",
  "SUPERSEDED",
] as const;
export type VisitRescheduleRequestStatus =
  (typeof VISIT_RESCHEDULE_REQUEST_STATUSES)[number];

export const VISIT_RESCHEDULE_REQUEST_MACHINE = defineStateMachine({
  name: "visit reschedule request",
  states: VISIT_RESCHEDULE_REQUEST_STATUSES,
  commands: ["create", "accept", "decline", "supersede"],
  transitions: [
    { from: null, command: "create", to: "PENDING" },
    { from: "PENDING", command: "accept", to: "ACCEPTED" },
    { from: "PENDING", command: "decline", to: "DECLINED" },
    { from: "PENDING", command: "supersede", to: "SUPERSEDED" },
  ],
});
