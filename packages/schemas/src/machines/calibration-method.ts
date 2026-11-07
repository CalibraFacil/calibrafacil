// calibration_method.status as data: a method version's review and publication
// (ISO/IEC 17025 §7.2.2: methods validated and authorized before use).
//   create            apps/api/src/routes/methods.ts POST / , POST /import, and
//                       POST /:id/new-version (a new DRAFT row)
//   edit              PUT /:id: only a draft is edited
//   request_approval  POST /:id/request-approval: compiled, frozen for review
//   technical_review  POST /:id/technical-review (admin)
//   publish           POST /:id/quality-approve and POST /:id/publish (owner;
//                       the reviewer must not be the approver)
//   supersede         the same two routes: the version published before under
//                       the same name is archived
//   return_to_draft   POST /:id/return-to-draft, with a reason
//   archive           POST /:id/archive
import { defineStateMachine } from "../state-machine";

export const METHOD_STATUSES = [
  "DRAFT",
  "PENDING_APPROVAL",
  "TECHNICAL_REVIEWED",
  "PUBLISHED",
  "ARCHIVED",
] as const;
export type MethodStatus = (typeof METHOD_STATUSES)[number];

export const METHOD_MACHINE = defineStateMachine({
  name: "calibration method",
  states: METHOD_STATUSES,
  commands: [
    "create",
    "edit",
    "request_approval",
    "technical_review",
    "publish",
    "supersede",
    "return_to_draft",
    "archive",
  ],
  transitions: [
    { from: null, command: "create", to: "DRAFT" },
    { from: "DRAFT", command: "edit", to: "DRAFT" },
    { from: "DRAFT", command: "request_approval", to: "PENDING_APPROVAL" },
    {
      from: "PENDING_APPROVAL",
      command: "technical_review",
      to: "TECHNICAL_REVIEWED",
    },
    { from: "TECHNICAL_REVIEWED", command: "publish", to: "PUBLISHED" },
    { from: "PUBLISHED", command: "supersede", to: "ARCHIVED" },
    { from: "PENDING_APPROVAL", command: "return_to_draft", to: "DRAFT" },
    { from: "TECHNICAL_REVIEWED", command: "return_to_draft", to: "DRAFT" },
    { from: "PUBLISHED", command: "archive", to: "ARCHIVED" },
  ],
});

/** Only a draft may be deleted (it was never reviewed nor used). */
export function isMethodDraft(status: string): boolean {
  return METHOD_MACHINE.canTransition(status, "edit");
}
