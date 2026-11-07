// calibration_request.status as data: a customer's request for calibration
// (portal, public API), reviewed by the lab and converted into jobs.
//   create   apps/api/src/domains/portal/routes/portal-requests.ts, public-api-v2/requests-write.ts
//   edit     public-api-v2/requests-write.ts PATCH (observations, due date)
//   review   domains/visits/routes/calibration-requests.ts POST /:id/review (internal notes)
//   approve  domains/visits/routes/calibration-requests.ts POST /:id/approve
//   reject   domains/visits/routes/calibration-requests.ts POST /:id/reject, and the public
//              API cancel (DELETE), which records a rejection
//   convert  domains/visits/routes/calibration-requests.ts POST /:id/convert (jobs created)
import { defineStatusVocabulary } from "@calibra-facil/shared/status-vocabulary";
import { defineStateMachine } from "../state-machine";

export const CALIBRATION_REQUEST_STATUSES = [
  "PENDING",
  "UNDER_REVIEW",
  "APPROVED",
  "REJECTED",
  "CONVERTED",
] as const;
export type CalibrationRequestStatus =
  (typeof CALIBRATION_REQUEST_STATUSES)[number];

export const CALIBRATION_REQUEST_STATUS = defineStatusVocabulary(
  CALIBRATION_REQUEST_STATUSES,
  {
    PENDING: { label: "Pendente", tone: "info" },
    UNDER_REVIEW: { label: "Em análise", tone: "warning" },
    APPROVED: { label: "Aprovada", tone: "ok" },
    REJECTED: { label: "Recusada", tone: "critical" },
    CONVERTED: { label: "Convertida", tone: "neutral" },
  },
);

/** Not yet decided: the laboratory still has to review it. */
export const OPEN_CALIBRATION_REQUEST_STATUSES = [
  "PENDING",
  "UNDER_REVIEW",
] as const satisfies readonly CalibrationRequestStatus[];

/** Awaiting conversion into jobs: neither rejected nor converted yet. */
export const AWAITING_CONVERSION_CALIBRATION_REQUEST_STATUSES = [
  ...OPEN_CALIBRATION_REQUEST_STATUSES,
  "APPROVED",
] as const satisfies readonly CalibrationRequestStatus[];

export const CALIBRATION_REQUEST_MACHINE = defineStateMachine({
  name: "calibration request",
  states: CALIBRATION_REQUEST_STATUSES,
  commands: ["create", "edit", "review", "approve", "reject", "convert"],
  transitions: [
    { from: null, command: "create", to: "PENDING" },
    { from: "PENDING", command: "edit", to: "PENDING" },
    { from: "UNDER_REVIEW", command: "edit", to: "UNDER_REVIEW" },
    { from: "PENDING", command: "review", to: "UNDER_REVIEW" },
    { from: "UNDER_REVIEW", command: "review", to: "UNDER_REVIEW" },
    { from: "PENDING", command: "approve", to: "APPROVED" },
    { from: "UNDER_REVIEW", command: "approve", to: "APPROVED" },
    { from: "PENDING", command: "reject", to: "REJECTED" },
    { from: "UNDER_REVIEW", command: "reject", to: "REJECTED" },
    { from: "APPROVED", command: "reject", to: "REJECTED" },
    { from: "APPROVED", command: "convert", to: "CONVERTED" },
  ],
});
