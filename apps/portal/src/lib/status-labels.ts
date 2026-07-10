import { statusToneToSignal, type StatusTone } from "@/lib/calibration-status";
import type { SignalTone } from "@/components/instrument-panel";

/**
 * Centralized pt-BR labels + tones for the two workflow status enums the portal
 * shows. Keeping these here (instead of re-declaring maps on every page) keeps
 * the status language consistent everywhere.
 *
 * The lookup tables stay authored in the pill vocabulary (`StatusTone`) so the
 * UX intent reads clearly — "warning = ball in the customer's court", "danger =
 * something went wrong". The public getters then bridge each tone into a
 * `SignalTone` (the tile/panel vocabulary) via `statusToneToSignal`, so callers
 * get the canonical tone going forward without reinventing any status logic.
 */

export type RequestStatus =
  | "PENDING"
  | "UNDER_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "CONVERTED";

export const REQUEST_STATUS: Record<
  RequestStatus,
  { label: string; tone: StatusTone }
> = {
  PENDING: { label: "Pendente", tone: "info" },
  UNDER_REVIEW: { label: "Em análise", tone: "warning" },
  APPROVED: { label: "Aprovada", tone: "success" },
  REJECTED: { label: "Recusada", tone: "danger" },
  CONVERTED: { label: "Convertida", tone: "muted" },
};

export function normalizeRequestStatus(status: string): RequestStatus {
  switch (status) {
    case "PENDING":
    case "UNDER_REVIEW":
    case "APPROVED":
    case "REJECTED":
    case "CONVERTED":
      return status;
    default:
      return "PENDING";
  }
}

export function getRequestStatus(status: string): {
  label: string;
  tone: SignalTone;
} {
  const { label, tone } = REQUEST_STATUS[normalizeRequestStatus(status)];
  return { label, tone: statusToneToSignal(tone) };
}

/**
 * Service orders have 15 statuses. Tone reflects what it means *for the
 * customer*: warning when the ball is in their court, danger when something
 * went wrong, success when done/ready, info while the lab works on it.
 */
const SERVICE_ORDER_STATUS: Record<
  string,
  { label: string; tone: StatusTone }
> = {
  opened: { label: "Aberta", tone: "info" },
  awaiting_tech_evaluation: { label: "Aguardando avaliação", tone: "info" },
  under_evaluation: { label: "Em avaliação", tone: "info" },
  awaiting_quote_approval: {
    label: "Aguardando sua aprovação",
    tone: "warning",
  },
  quote_approved: { label: "Orçamento aprovado", tone: "success" },
  quote_rejected: { label: "Orçamento recusado", tone: "danger" },
  repair_in_progress: { label: "Em reparo", tone: "info" },
  awaiting_calibration: { label: "Aguardando calibração", tone: "info" },
  calibration_in_progress: {
    label: "Calibração em andamento",
    tone: "info",
  },
  awaiting_final_review: { label: "Aguardando revisão", tone: "info" },
  ready_for_pickup: { label: "Pronta para retirada", tone: "success" },
  delivered: { label: "Entregue", tone: "muted" },
  closed: { label: "Encerrada", tone: "muted" },
  canceled: { label: "Cancelada", tone: "danger" },
  warranty_return: { label: "Retorno em garantia", tone: "warning" },
};

export function getServiceOrderStatus(status: string): {
  label: string;
  tone: SignalTone;
} {
  const { label, tone } = SERVICE_ORDER_STATUS[status] ?? {
    label: "Em andamento",
    tone: "info",
  };
  return { label, tone: statusToneToSignal(tone) };
}

/**
 * ISO/IEC 17025 §7.10 out-of-tolerance notifications, read from the customer's
 * perspective: SENT means the ball is in their court (confirm receipt →
 * warning), ACKNOWLEDGED means done (success), and the lab-internal pre-send
 * stages (PENDING/GENERATED) are neutral processing.
 */
const OOT_NOTIFICATION_STATUS: Record<
  string,
  { label: string; tone: StatusTone }
> = {
  PENDING: { label: "Em processamento", tone: "muted" },
  GENERATED: { label: "Em processamento", tone: "muted" },
  SENT: { label: "Aguardando confirmação", tone: "warning" },
  ACKNOWLEDGED: { label: "Recebimento confirmado", tone: "success" },
};

export function getOotNotificationStatus(status: string): {
  label: string;
  tone: SignalTone;
} {
  const { label, tone } = OOT_NOTIFICATION_STATUS[status] ?? {
    label: "Em processamento",
    tone: "muted",
  };
  return { label, tone: statusToneToSignal(tone) };
}
