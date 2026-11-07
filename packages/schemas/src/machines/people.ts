// Personnel records as data (ISO/IEC 17025 §6.2: competence, training and
// authorization of personnel).
import { defineStateMachine } from "../state-machine";

// personnel_competence.status: a technician's qualification for an asset type.
//   create             routes/competences.ts POST /
//   assign_training    POST /:id/assign-training (also after a failed evaluation)
//   start_training     POST /:id/start-training
//   complete_training  POST /:id/complete-training
//   evaluate           POST /:id/evaluate: qualified (ACTIVE) or back to training
//   cancel             POST /:id/cancel (before qualification)
//   suspend            POST /:id/suspend
//   renew              POST /:id/renew (an expired or suspended qualification)
//   expire             the nightly sweep (packages/jobs-core
//                        scheduled/steps-people-certificates.ts)
// PUT /:id edits the record's fields and never its status.
export const COMPETENCE_STATUSES = [
  "REQUESTED",
  "TRAINING_ASSIGNED",
  "IN_TRAINING",
  "PENDING_EVALUATION",
  "ACTIVE",
  "SUSPENDED",
  "EXPIRED",
  "CANCELLED",
] as const;
export type CompetenceStatus = (typeof COMPETENCE_STATUSES)[number];

export const COMPETENCE_MACHINE = defineStateMachine({
  name: "personnel competence",
  states: COMPETENCE_STATUSES,
  commands: [
    "create",
    "assign_training",
    "start_training",
    "complete_training",
    "evaluate",
    "cancel",
    "suspend",
    "renew",
    "expire",
  ],
  transitions: [
    { from: null, command: "create", to: "REQUESTED" },
    { from: "REQUESTED", command: "assign_training", to: "TRAINING_ASSIGNED" },
    {
      from: "PENDING_EVALUATION",
      command: "assign_training",
      to: "TRAINING_ASSIGNED",
    },
    { from: "TRAINING_ASSIGNED", command: "start_training", to: "IN_TRAINING" },
    {
      from: "IN_TRAINING",
      command: "complete_training",
      to: "PENDING_EVALUATION",
    },
    { from: "PENDING_EVALUATION", command: "evaluate", to: "ACTIVE" },
    {
      from: "PENDING_EVALUATION",
      command: "evaluate",
      to: "TRAINING_ASSIGNED",
    },
    { from: "REQUESTED", command: "cancel", to: "CANCELLED" },
    { from: "TRAINING_ASSIGNED", command: "cancel", to: "CANCELLED" },
    { from: "IN_TRAINING", command: "cancel", to: "CANCELLED" },
    { from: "PENDING_EVALUATION", command: "cancel", to: "CANCELLED" },
    { from: "ACTIVE", command: "suspend", to: "SUSPENDED" },
    { from: "EXPIRED", command: "renew", to: "ACTIVE" },
    { from: "SUSPENDED", command: "renew", to: "ACTIVE" },
    { from: "ACTIVE", command: "expire", to: "EXPIRED" },
  ],
});

// training_record.status: a training event a person attends.
//   create    routes/training-records.ts POST /
//   set_status  PUT /:id (the form's status picker: any status)
//   complete  POST /:id/complete (from any status; repeating it is a no-op)
export const TRAINING_STATUSES = [
  "planned",
  "in_progress",
  "completed",
  "failed",
] as const;
export type TrainingStatus = (typeof TRAINING_STATUSES)[number];

const TRAINING_SET_STATUS = TRAINING_STATUSES.flatMap((from) =>
  TRAINING_STATUSES.filter((to) => to !== from).map((to) => ({
    from,
    command: "set_status" as const,
    to,
  })),
);

export const TRAINING_MACHINE = defineStateMachine({
  name: "training record",
  states: TRAINING_STATUSES,
  commands: ["create", "set_status", "complete"],
  transitions: [
    { from: null, command: "create", to: "planned" },
    ...TRAINING_SET_STATUS,
    { from: "planned", command: "complete", to: "completed" },
    { from: "in_progress", command: "complete", to: "completed" },
    { from: "failed", command: "complete", to: "completed" },
    { from: "completed", command: "complete", to: "completed" },
  ],
});

// authorized_signatory.status: who may approve (sign) certificates (§6.2.6).
//   create  routes/authorized-signatories.ts POST / (a grant)
//   revoke  routes/authorized-signatories.ts POST /:id/revoke, and the
//             account deletion of the signatory (packages/auth)
// SUSPENDED and EXPIRED were declared once but never written: the expiry of a
// grant is its `expiresAt`, read at approval time. They are not states.
const SIGNATORY_STATUSES = ["ACTIVE", "REVOKED"] as const;
export type SignatoryAuthorizationStatus = (typeof SIGNATORY_STATUSES)[number];

export const SIGNATORY_MACHINE = defineStateMachine({
  name: "authorized signatory",
  states: SIGNATORY_STATUSES,
  commands: ["create", "revoke"],
  transitions: [
    { from: null, command: "create", to: "ACTIVE" },
    { from: "ACTIVE", command: "revoke", to: "REVOKED" },
  ],
});
