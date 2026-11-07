// Billing records as data. These lifecycles are written by the lab's routes AND
// by the ERP integration (Conta Azul poll), which mirrors the remote state; the
// tables below are what the code does today, remote mirroring included.
import {
  BILLING_DOCUMENT_EXPORT_STATUSES,
  BILLING_DOCUMENT_STATUSES,
  COMMERCIAL_AGREEMENT_STATUSES,
  RECEIVABLE_INSTALLMENT_STATUSES,
} from "@calibra-facil/shared";
import { defineStateMachine, type Transition } from "../state-machine";

function moves<S extends string, C extends string>(
  from: readonly S[],
  command: C,
  to: readonly S[],
): Transition<S, C>[] {
  return from.flatMap((f) =>
    to.filter((t) => t !== f).map((t) => ({ from: f, command, to: t })),
  );
}

// commercial_agreement.status: a customer's price agreement.
//   create      domains/finance/routes/contracts.ts POST /
//   set_status  PUT /:id (the form's status: any)
//   activate    POST /:id/activate (needs service terms)
//   cancel      POST /:id/cancel
// Validity dates are read at pricing time; nothing moves an agreement to EXPIRED
// on its own (a lab sets it).
export const COMMERCIAL_AGREEMENT_MACHINE = defineStateMachine({
  name: "commercial agreement",
  states: COMMERCIAL_AGREEMENT_STATUSES,
  commands: ["create", "set_status", "activate", "cancel"],
  transitions: [
    { from: null, command: "create", to: "DRAFT" },
    ...moves(
      COMMERCIAL_AGREEMENT_STATUSES,
      "set_status",
      COMMERCIAL_AGREEMENT_STATUSES,
    ),
    ...COMMERCIAL_AGREEMENT_STATUSES.map((from) => ({
      from,
      command: "activate" as const,
      to: "ACTIVE" as const,
    })),
    ...COMMERCIAL_AGREEMENT_STATUSES.map((from) => ({
      from,
      command: "cancel" as const,
      to: "CANCELED" as const,
    })),
  ],
});

// billing_document.status: an invoice / receivable document.
//   create          domains/finance/routes/documents.ts POST / and the service-order
//                     billing (domains/service-orders/service-order-workflow.ts): DRAFT; the
//                     job-batch billing (domains/finance/finance.ts) issues on creation
//   issue           POST /:id/issue, domains/finance/finance.ts
//   record_payment  domains/finance/routes/receipts.ts: the document of a paid
//                     installment (any document but a void one)
//   void            POST /:id/void (any document but a void one)
//   sync_remote     the Conta Azul poll: the status the ERP's installments add
//                     up to, for any document the lab did not void
const DOCUMENT_LIVE = ["DRAFT", "ISSUED", "PAID", "OVERDUE"] as const;
export const BILLING_DOCUMENT_MACHINE = defineStateMachine({
  name: "billing document",
  states: BILLING_DOCUMENT_STATUSES,
  commands: ["create", "issue", "record_payment", "void", "sync_remote"],
  transitions: [
    { from: null, command: "create", to: "DRAFT" },
    { from: null, command: "create", to: "ISSUED" },
    { from: "DRAFT", command: "issue", to: "ISSUED" },
    ...DOCUMENT_LIVE.map((from) => ({
      from,
      command: "record_payment" as const,
      to: "PAID" as const,
    })),
    ...DOCUMENT_LIVE.map((from) => ({
      from,
      command: "void" as const,
      to: "VOID" as const,
    })),
    ...moves(DOCUMENT_LIVE, "sync_remote", [
      "ISSUED",
      "PAID",
      "OVERDUE",
      "VOID",
    ] as const),
    ...(["ISSUED", "PAID", "OVERDUE"] as const).map((from) => ({
      from,
      command: "sync_remote" as const,
      to: from,
    })),
  ],
});

// billing_document.export_status: the push to the lab's ERP (domains/finance/finance.ts).
//   create  NOT_EXPORTED
//   export  a successful push (a re-export keeps EXPORTED)
//   fail    a refused push or an adapter error (retried by exporting again)
export const BILLING_EXPORT_MACHINE = defineStateMachine({
  name: "billing document export",
  states: BILLING_DOCUMENT_EXPORT_STATUSES,
  commands: ["create", "export", "fail"],
  transitions: [
    { from: null, command: "create", to: "NOT_EXPORTED" },
    { from: "NOT_EXPORTED", command: "export", to: "EXPORTED" },
    { from: "FAILED", command: "export", to: "EXPORTED" },
    { from: "EXPORTED", command: "export", to: "EXPORTED" },
    { from: "NOT_EXPORTED", command: "fail", to: "FAILED" },
    { from: "FAILED", command: "fail", to: "FAILED" },
    { from: "EXPORTED", command: "fail", to: "FAILED" },
  ],
});

// receivable_installment.status
//   create       with its document: OPEN
//   pay          domains/finance/routes/receipts.ts (an open or overdue installment)
//   void         POST /documents/:id/void: every installment of the document
//   sync_remote  the Conta Azul poll: the ERP's status, whatever it was
export const RECEIVABLE_INSTALLMENT_MACHINE = defineStateMachine({
  name: "receivable installment",
  states: RECEIVABLE_INSTALLMENT_STATUSES,
  commands: ["create", "pay", "void", "sync_remote"],
  transitions: [
    { from: null, command: "create", to: "OPEN" },
    { from: "OPEN", command: "pay", to: "PAID" },
    { from: "OVERDUE", command: "pay", to: "PAID" },
    { from: "OPEN", command: "void", to: "VOID" },
    { from: "PAID", command: "void", to: "VOID" },
    { from: "OVERDUE", command: "void", to: "VOID" },
    { from: "VOID", command: "void", to: "VOID" },
    ...moves(
      RECEIVABLE_INSTALLMENT_STATUSES,
      "sync_remote",
      RECEIVABLE_INSTALLMENT_STATUSES,
    ),
  ],
});
