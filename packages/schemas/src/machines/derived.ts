// Statuses DERIVED from data by one pure function, as data. The function decides
// the value; the machine states which values exist and which moves the
// derivation may make, so the database guard refuses anything else.
import { CERTIFICATE_RELEASE_STATUSES } from "@calibra-facil/shared";
import { defineStatusVocabulary } from "@calibra-facil/shared/status-vocabulary";
import { defineStateMachine, type Transition } from "../state-machine";

function moves<S extends string, C extends string>(
  from: readonly S[],
  command: C,
  to: readonly S[],
): Transition<S, C>[] {
  return from.flatMap((f) => to.map((t) => ({ from: f, command, to: t })));
}

// proficiency_test.overall_status (ISO/IEC 17025 §7.7.2 inter-laboratory
// comparison): `overallStatusFromResults` in routes/proficiency-tests.ts.
//   create          POST / : pending (no results yet)
//   record_results  POST /:id/results: the worst point verdict; recording again
//                     replaces the results and re-derives
export const PT_OVERALL_STATUSES = [
  "pending",
  "satisfactory",
  "questionable",
  "unsatisfactory",
] as const;
export type PtOverallStatus = (typeof PT_OVERALL_STATUSES)[number];

export const PT_OVERALL_STATUS = defineStatusVocabulary(PT_OVERALL_STATUSES, {
  pending: { label: "Pendente", tone: "neutral" },
  satisfactory: { label: "Satisfatório", tone: "ok" },
  questionable: { label: "Questionável", tone: "warning" },
  unsatisfactory: { label: "Insatisfatório", tone: "critical" },
});

const PT_RESULTS = ["satisfactory", "questionable", "unsatisfactory"] as const;

export const PT_OVERALL_MACHINE = defineStateMachine({
  name: "proficiency test",
  states: PT_OVERALL_STATUSES,
  commands: ["create", "record_results"],
  transitions: [
    { from: null, command: "create", to: "pending" },
    ...moves(PT_OVERALL_STATUSES, "record_results", PT_RESULTS),
  ],
});

// control_chart.status (§7.7.1 monitoring): `evaluateChart` in
// packages/interval-analysis (Western Electric rules over the readings).
//   create     routes/spc.ts POST /
//   recompute  routes/spc.ts (readings added or removed, limits edited,
//                recalculate) and the nightly sweep (packages/jobs-core
//                spc-recompute.ts): any status to any status
export const SPC_STATUSES = [
  "insufficient_data",
  "in_control",
  "trending",
  "out_of_control",
] as const;
export type SpcStatus = (typeof SPC_STATUSES)[number];

export const SPC_STATUS = defineStatusVocabulary(SPC_STATUSES, {
  insufficient_data: { label: "Dados insuficientes", tone: "neutral" },
  in_control: { label: "Sob controle", tone: "ok" },
  trending: { label: "Tendência", tone: "warning" },
  out_of_control: { label: "Fora de controle", tone: "critical" },
});

export const SPC_MACHINE = defineStateMachine({
  name: "control chart",
  states: SPC_STATUSES,
  commands: ["create", "recompute"],
  transitions: [
    { from: null, command: "create", to: "insufficient_data" },
    ...moves(SPC_STATUSES, "recompute", SPC_STATUSES),
  ],
});

// certificate_release.status: whether a customer may download an issued
// certificate, `evaluateReleaseStatus` in apps/api/src/lib/certificate-release.ts
// (the release policy against the job's billing and payments).
//   create               the first evaluation of an approved job
//   evaluate             every re-evaluation (billing or payment changed): the
//                          policy's answer, which may also withdraw a release
//                          (an invoice voided after it released the certificate)
//   release_by_exception a manager's release regardless of payment; sticky,
//                          the evaluation never leaves it
const POLICY_OUTCOMES = [
  "HELD_FOR_BILLING",
  "HELD_FOR_PAYMENT",
  "RELEASED",
] as const;

export const CERTIFICATE_RELEASE_MACHINE = defineStateMachine({
  name: "certificate release",
  states: CERTIFICATE_RELEASE_STATUSES,
  commands: ["create", "evaluate", "release_by_exception"],
  transitions: [
    ...CERTIFICATE_RELEASE_STATUSES.map((to) => ({
      from: null,
      command: "create" as const,
      to,
    })),
    ...moves(POLICY_OUTCOMES, "evaluate", POLICY_OUTCOMES),
    {
      from: "RELEASED_BY_EXCEPTION",
      command: "evaluate",
      to: "RELEASED_BY_EXCEPTION",
    },
    ...moves(CERTIFICATE_RELEASE_STATUSES, "release_by_exception", [
      "RELEASED_BY_EXCEPTION",
    ] as const),
  ],
});
