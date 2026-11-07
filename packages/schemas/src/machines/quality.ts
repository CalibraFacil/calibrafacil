// The quality system's records as data (ISO/IEC 17025 §7.10 nonconforming
// work, §8.7 corrective action).
import { defineStatusVocabulary } from "@calibra-facil/shared/status-vocabulary";
import { defineStateMachine } from "../state-machine";

// corrective_action.status
//   create     apps/api/src/lib/corrective-actions.ts (manual, NC escalation,
//                SPC escalation, an unsatisfactory PT round)
//   edit       routes/capa.ts PUT /:id: any open CAPA, status kept
//   investigate  the same PUT, when a root cause is recorded on an OPEN CAPA
//   implement  routes/capa.ts POST /:id/implement (repeatable while implementing)
//   verify     routes/capa.ts POST /:id/verify: the effectiveness check, by an
//                independent verifier (Q50). Effective → VERIFICATION; not
//                effective → back to IMPLEMENTATION (the previous implementation
//                stays in the audit log)
//   close      routes/capa.ts POST /:id/close
export const CORRECTIVE_ACTION_STATUSES = [
  "OPEN",
  "INVESTIGATION",
  "IMPLEMENTATION",
  "VERIFICATION",
  "CLOSED",
] as const;
export type CorrectiveActionStatus =
  (typeof CORRECTIVE_ACTION_STATUSES)[number];

export const CORRECTIVE_ACTION_STATUS = defineStatusVocabulary(
  CORRECTIVE_ACTION_STATUSES,
  {
    OPEN: { label: "Aberta", tone: "critical" },
    INVESTIGATION: { label: "Em investigação", tone: "warning" },
    IMPLEMENTATION: { label: "Implementação", tone: "info" },
    VERIFICATION: { label: "Verificação", tone: "info" },
    CLOSED: { label: "Fechada", tone: "ok" },
  },
);

export const CORRECTIVE_ACTION_MACHINE = defineStateMachine({
  name: "corrective action",
  states: CORRECTIVE_ACTION_STATUSES,
  commands: ["create", "edit", "investigate", "implement", "verify", "close"],
  transitions: [
    { from: null, command: "create", to: "OPEN" },
    { from: "OPEN", command: "edit", to: "OPEN" },
    { from: "INVESTIGATION", command: "edit", to: "INVESTIGATION" },
    { from: "IMPLEMENTATION", command: "edit", to: "IMPLEMENTATION" },
    { from: "VERIFICATION", command: "edit", to: "VERIFICATION" },
    { from: "OPEN", command: "investigate", to: "INVESTIGATION" },
    { from: "OPEN", command: "implement", to: "IMPLEMENTATION" },
    { from: "INVESTIGATION", command: "implement", to: "IMPLEMENTATION" },
    { from: "IMPLEMENTATION", command: "implement", to: "IMPLEMENTATION" },
    // Effective: ready to close. Not effective: the actions go back to
    // implementation for a new cycle (§8.7.1 e; decision Q61); a CAPA is never
    // closed on a failed effectiveness check.
    { from: "IMPLEMENTATION", command: "verify", to: "VERIFICATION" },
    { from: "IMPLEMENTATION", command: "verify", to: "IMPLEMENTATION" },
    { from: "VERIFICATION", command: "close", to: "CLOSED" },
  ],
});

// non_conformance.status (lower-case values, as stored)
//   create        apps/api/src/lib/non-conformances.ts (manual, OOT flag,
//                   as-found verdict, standard recall)
//   set_disposition  routes/non-conformances.ts POST /:id/disposition
//                   (repeatable until resolved)
//   resolve       routes/non-conformances.ts POST /:id/resolve: needs a
//                   disposition
export const NON_CONFORMANCE_STATUSES = [
  "open",
  "under_review",
  "resolved",
] as const;
export type NonConformanceStatus = (typeof NON_CONFORMANCE_STATUSES)[number];

export const NON_CONFORMANCE_STATUS = defineStatusVocabulary(
  NON_CONFORMANCE_STATUSES,
  {
    open: { label: "Aberta", tone: "critical" },
    under_review: { label: "Em análise", tone: "warning" },
    resolved: { label: "Resolvida", tone: "ok" },
  },
);

export const NON_CONFORMANCE_MACHINE = defineStateMachine({
  name: "nonconformance",
  states: NON_CONFORMANCE_STATUSES,
  commands: ["create", "set_disposition", "resolve"],
  transitions: [
    { from: null, command: "create", to: "open" },
    { from: "open", command: "set_disposition", to: "under_review" },
    { from: "under_review", command: "set_disposition", to: "under_review" },
    { from: "open", command: "resolve", to: "resolved" },
    { from: "under_review", command: "resolve", to: "resolved" },
  ],
});

// standard_recall.status: the customer-notification campaign for a reference
// standard found out of tolerance (§7.10).
//   create  apps/api/src/domains/jobs/oot/oot-notifications.ts `ensureStandardRecall` (a
//             draft per standard; a new OOT after a SENT recall starts a fresh
//             campaign)
//   send    routes/standards.ts POST /:id/recall/send: the approval and the
//             reviewed window are stamped, then the notifications are created
const STANDARD_RECALL_STATUSES = ["DRAFT", "SENT"] as const;
export type StandardRecallStatus = (typeof STANDARD_RECALL_STATUSES)[number];

export const STANDARD_RECALL_STATUS = defineStatusVocabulary(
  STANDARD_RECALL_STATUSES,
  {
    DRAFT: { label: "Rascunho", tone: "neutral" },
    SENT: { label: "Enviado", tone: "ok" },
  },
);

export const STANDARD_RECALL_MACHINE = defineStateMachine({
  name: "standard recall",
  states: STANDARD_RECALL_STATUSES,
  commands: ["create", "send"],
  transitions: [
    { from: null, command: "create", to: "DRAFT" },
    { from: "DRAFT", command: "send", to: "SENT" },
  ],
});

// oot_notification.status: one customer's notification of a recall.
//   create       apps/api/src/domains/jobs/oot/oot-notifications.ts (one per recall and job)
//   generate     packages/jobs-core/src/oot-notifications.ts: the letter PDF
//                  (re-rendering keeps the status it reached)
//   send         apps/api/src/domains/jobs/oot/oot-email-drain.ts: e-mailed
//   acknowledge  the e-mailed link (lib/oot-acknowledgement.ts), the portal
//                  (routes/portal.ts) and a manual registration
//                  (routes/non-conformances.ts); first acknowledgement wins
//                  (Q34), from any state before it
export const OOT_NOTIFICATION_STATUSES = [
  "PENDING",
  "GENERATED",
  "SENT",
  "ACKNOWLEDGED",
] as const;
export type OotNotificationStatus = (typeof OOT_NOTIFICATION_STATUSES)[number];

export const OOT_NOTIFICATION_STATUS = defineStatusVocabulary(
  OOT_NOTIFICATION_STATUSES,
  {
    PENDING: { label: "Pendente", tone: "neutral" },
    GENERATED: { label: "Gerada", tone: "info" },
    SENT: { label: "Enviada", tone: "warning" },
    ACKNOWLEDGED: { label: "Confirmada", tone: "ok" },
  },
);

export const OOT_NOTIFICATION_MACHINE = defineStateMachine({
  name: "out-of-tolerance notification",
  states: OOT_NOTIFICATION_STATUSES,
  commands: ["create", "generate", "send", "acknowledge"],
  transitions: [
    { from: null, command: "create", to: "PENDING" },
    { from: "PENDING", command: "generate", to: "GENERATED" },
    { from: "GENERATED", command: "generate", to: "GENERATED" },
    { from: "SENT", command: "generate", to: "SENT" },
    { from: "ACKNOWLEDGED", command: "generate", to: "ACKNOWLEDGED" },
    { from: "GENERATED", command: "send", to: "SENT" },
    { from: "SENT", command: "send", to: "SENT" },
    { from: "PENDING", command: "acknowledge", to: "ACKNOWLEDGED" },
    { from: "GENERATED", command: "acknowledge", to: "ACKNOWLEDGED" },
    { from: "SENT", command: "acknowledge", to: "ACKNOWLEDGED" },
  ],
});

// asset_oot_event.status: a customer's instrument found out of tolerance as
// found; the customer records its impact assessment in the portal.
//   create  apps/api/src/domains/jobs/oot/asset-oot-events.ts (non-conforming as-found)
//   assess  routes/portal.ts POST /fleet/oot-events/:id/assessment (one per event)
export const ASSET_OOT_EVENT_STATUSES = ["OPEN", "ASSESSED"] as const;
export type AssetOotEventStatus = (typeof ASSET_OOT_EVENT_STATUSES)[number];

export const ASSET_OOT_EVENT_STATUS = defineStatusVocabulary(
  ASSET_OOT_EVENT_STATUSES,
  {
    OPEN: { label: "Pendente", tone: "warning" },
    ASSESSED: { label: "Avaliado", tone: "ok" },
  },
);

export const ASSET_OOT_EVENT_MACHINE = defineStateMachine({
  name: "asset out-of-tolerance event",
  states: ASSET_OOT_EVENT_STATUSES,
  commands: ["create", "assess"],
  transitions: [
    { from: null, command: "create", to: "OPEN" },
    { from: "OPEN", command: "assess", to: "ASSESSED" },
  ],
});
