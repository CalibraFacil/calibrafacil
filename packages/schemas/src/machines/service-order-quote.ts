// service_order_quote.status as data.
//
//   create   service-order.quotes.ts `createServiceOrderQuote`, the desktop
//              quote sync (apply-service-order-documents.ts): a draft
//   edit     service-order.quotes.ts update / items: only a draft is editable
//   send     service-order.quotes.ts `sendServiceOrderQuote`
//   approve  manual approval (service-order.quotes.ts), the public link
//              (service-order.tokens.ts) and the portal
//   reject   the same three paths
//
// A revised quote is a new row; the earlier quote's public links are revoked
// (`revokedReason: "superseded"` on the token), its status stays the decision
// it received. `expired`, `canceled` and `superseded` were declared once but no
// code ever wrote them, so they are not states of this machine.
import { SERVICE_ORDER_QUOTE_STATUSES } from "@calibra-facil/shared";
import { defineStateMachine } from "../state-machine";

const SERVICE_ORDER_QUOTE_COMMANDS = [
  "create",
  "edit",
  "send",
  "approve",
  "reject",
] as const;

export const SERVICE_ORDER_QUOTE_MACHINE = defineStateMachine({
  name: "service order quote",
  states: SERVICE_ORDER_QUOTE_STATUSES,
  commands: SERVICE_ORDER_QUOTE_COMMANDS,
  transitions: [
    { from: null, command: "create", to: "draft" },
    { from: "draft", command: "edit", to: "draft" },
    { from: "draft", command: "send", to: "sent" },
    { from: "sent", command: "approve", to: "approved" },
    { from: "sent", command: "reject", to: "rejected" },
  ],
});

export function canEditServiceOrderQuote(status: string): boolean {
  return SERVICE_ORDER_QUOTE_MACHINE.canTransition(status, "edit");
}

export function canApproveServiceOrderQuote(status: string): boolean {
  return SERVICE_ORDER_QUOTE_MACHINE.canTransition(status, "approve");
}
