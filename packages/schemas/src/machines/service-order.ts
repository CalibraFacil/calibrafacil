// service_order.status as data. Every writer names a command; the database
// guard (calibra_service_order_status_guard) is generated from this table.
//
//   create        apps/api/src/domains/service-orders/service-order-workflow.ts (counter intake →
//                   awaiting_tech_evaluation, warranty intake → warranty_return);
//                   `opened` is the column default, kept for rows created
//                   without a status
//   set_status    the manual status change of PATCH /service-orders/:id
//                   (service-order.commands.ts `updateServiceOrder`): the
//                   declared lifecycle graph, step by step
//   evaluate      service-order.evaluations.ts `createServiceOrderEvaluation`:
//                   the evaluation decides the next stage from the intake stages
//   start_repair  service-order.execution.ts (cloud start), the desktop
//                   execution save and its sync apply: quote_approved → repair
//   finish_repair service-order.execution.ts: the execution decides whether a
//                   calibration follows
//   send_quote    service-order.quotes.ts: an order not yet on the bench waits
//                   on the customer; on the bench it keeps its stage (mid-job
//                   re-quote, `isServiceOrderWorkInProgressStatus`)
//   approve_quote / reject_quote
//                 service-order.quotes.ts (manual) and service-order.tokens.ts
//                   (public link, portal): only an order waiting on the decision
//                   advances (`isServiceOrderDecidingQuoteStatus`)
//   deliver, close, cancel
//                 service-order.commands.ts
//   reopen        service-order.commands.ts: a closed or canceled order goes back
//                   to the stage it left (read from its closure/cancel event), or
//                   to awaiting_tech_evaluation when none was recorded
import {
  SERVICE_ORDER_STATUSES,
  type ServiceOrderStatus,
} from "@calibra-facil/shared";
import { defineStateMachine, type Transition } from "../state-machine";

const SERVICE_ORDER_COMMANDS = [
  "create",
  "set_status",
  "evaluate",
  "start_repair",
  "finish_repair",
  "send_quote",
  "approve_quote",
  "reject_quote",
  "deliver",
  "close",
  "cancel",
  "reopen",
] as const;
export type ServiceOrderCommand = (typeof SERVICE_ORDER_COMMANDS)[number];

type Row = Transition<ServiceOrderStatus, ServiceOrderCommand>;

/** The lifecycle graph the manual status change walks (one step at a time). */
const STATUS_GRAPH: Record<ServiceOrderStatus, ServiceOrderStatus[]> = {
  opened: ["awaiting_tech_evaluation", "canceled"],
  awaiting_tech_evaluation: ["under_evaluation", "canceled"],
  under_evaluation: [
    "awaiting_quote_approval",
    "awaiting_calibration",
    "awaiting_final_review",
    "ready_for_pickup",
    "canceled",
  ],
  awaiting_quote_approval: ["quote_approved", "quote_rejected", "canceled"],
  quote_approved: ["repair_in_progress", "awaiting_calibration"],
  quote_rejected: ["ready_for_pickup", "canceled"],
  repair_in_progress: ["awaiting_calibration", "awaiting_final_review"],
  awaiting_calibration: ["calibration_in_progress", "awaiting_final_review"],
  calibration_in_progress: ["awaiting_final_review"],
  awaiting_final_review: ["ready_for_pickup"],
  ready_for_pickup: ["delivered"],
  delivered: ["closed"],
  closed: [],
  canceled: [],
  warranty_return: ["awaiting_tech_evaluation", "under_evaluation", "canceled"],
};

/** Stages before the technical evaluation: where an evaluation may be recorded. */
const SERVICE_ORDER_EVALUABLE_STATUSES = [
  "opened",
  "awaiting_tech_evaluation",
  "under_evaluation",
  "warranty_return",
] as const satisfies readonly ServiceOrderStatus[];

/** Where an evaluation sends the order (quote needed / calibration / nothing to do). */
const SERVICE_ORDER_EVALUATION_OUTCOMES = [
  "awaiting_quote_approval",
  "awaiting_calibration",
  "ready_for_pickup",
] as const satisfies readonly ServiceOrderStatus[];

/** On the bench: a quote sent from here does not rewind the order. */
const SERVICE_ORDER_WORK_IN_PROGRESS_STATUSES = [
  "repair_in_progress",
  "awaiting_calibration",
  "calibration_in_progress",
  "awaiting_final_review",
] as const satisfies readonly ServiceOrderStatus[];

const FINAL: readonly ServiceOrderStatus[] = ["closed", "canceled"];

function rows(): Row[] {
  const table: Row[] = [
    { from: null, command: "create", to: "opened" },
    { from: null, command: "create", to: "awaiting_tech_evaluation" },
    { from: null, command: "create", to: "warranty_return" },
  ];

  for (const from of SERVICE_ORDER_STATUSES) {
    for (const to of STATUS_GRAPH[from]) {
      table.push({ from, command: "set_status", to });
    }
  }

  for (const from of SERVICE_ORDER_EVALUABLE_STATUSES) {
    for (const to of SERVICE_ORDER_EVALUATION_OUTCOMES) {
      table.push({ from, command: "evaluate", to });
    }
  }

  table.push(
    {
      from: "quote_approved",
      command: "start_repair",
      to: "repair_in_progress",
    },
    {
      from: "repair_in_progress",
      command: "start_repair",
      to: "repair_in_progress",
    },
    {
      from: "repair_in_progress",
      command: "finish_repair",
      to: "awaiting_calibration",
    },
    {
      from: "repair_in_progress",
      command: "finish_repair",
      to: "awaiting_final_review",
    },
    // A repeated finish (retry, double submit) keeps the stage it reached, or
    // moves on to the final review when the calibration is no longer needed.
    {
      from: "awaiting_calibration",
      command: "finish_repair",
      to: "awaiting_calibration",
    },
    {
      from: "awaiting_calibration",
      command: "finish_repair",
      to: "awaiting_final_review",
    },
    {
      from: "calibration_in_progress",
      command: "finish_repair",
      to: "awaiting_final_review",
    },
    {
      from: "awaiting_final_review",
      command: "finish_repair",
      to: "awaiting_final_review",
    },
  );

  for (const from of SERVICE_ORDER_STATUSES) {
    if (FINAL.includes(from)) continue;
    const onBench = SERVICE_ORDER_WORK_IN_PROGRESS_STATUSES.some(
      (status) => status === from,
    );
    table.push({
      from,
      command: "send_quote",
      to: onBench ? from : "awaiting_quote_approval",
    });
  }

  table.push(
    {
      from: "awaiting_quote_approval",
      command: "approve_quote",
      to: "quote_approved",
    },
    {
      from: "awaiting_quote_approval",
      command: "reject_quote",
      to: "quote_rejected",
    },
    { from: "ready_for_pickup", command: "deliver", to: "delivered" },
    { from: "delivered", command: "close", to: "closed" },
  );

  for (const from of SERVICE_ORDER_STATUSES) {
    if (STATUS_GRAPH[from].includes("canceled")) {
      table.push({ from, command: "cancel", to: "canceled" });
    }
  }

  // Reopen returns to the stage the order left: closed is reached only from
  // delivered, canceled from the stages `cancel` leaves. awaiting_tech_evaluation
  // is the fallback when no closure/cancel event recorded the stage.
  table.push(
    { from: "closed", command: "reopen", to: "delivered" },
    { from: "closed", command: "reopen", to: "awaiting_tech_evaluation" },
  );
  for (const from of SERVICE_ORDER_STATUSES) {
    if (STATUS_GRAPH[from].includes("canceled")) {
      table.push({ from: "canceled", command: "reopen", to: from });
    }
  }
  if (!STATUS_GRAPH.awaiting_tech_evaluation.includes("canceled")) {
    table.push({
      from: "canceled",
      command: "reopen",
      to: "awaiting_tech_evaluation",
    });
  }

  return table;
}

export const SERVICE_ORDER_MACHINE = defineStateMachine({
  name: "service order",
  states: SERVICE_ORDER_STATUSES,
  commands: SERVICE_ORDER_COMMANDS,
  transitions: rows(),
});

/** One step of the manual status change (the declared lifecycle graph). */
export function canSetServiceOrderStatus(
  from: ServiceOrderStatus,
  to: ServiceOrderStatus,
): boolean {
  return SERVICE_ORDER_MACHINE.canTransition(from, "set_status", to);
}

/**
 * True only while the order is genuinely waiting on a quote decision: approving
 * or rejecting a quote advances the order only from here. Anywhere else the
 * decision is late or out-of-band (a mid-job re-quote answered while the
 * instrument is on the bench, a public link answered after delivery) and moving
 * the status would rewind real progress; the quote's own status still records
 * the customer's answer.
 */
export function isServiceOrderDecidingQuoteStatus(
  status: ServiceOrderStatus,
): boolean {
  return SERVICE_ORDER_MACHINE.canTransition(status, "approve_quote");
}

export function isServiceOrderWorkInProgressStatus(
  status: ServiceOrderStatus,
): boolean {
  return SERVICE_ORDER_WORK_IN_PROGRESS_STATUSES.some((s) => s === status);
}
