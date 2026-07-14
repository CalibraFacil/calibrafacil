import {
  Alert02Icon,
  Calendar03Icon,
  CancelCircleIcon,
  CheckmarkCircle01Icon,
  File01Icon,
  FolderLibraryIcon,
  Notebook01Icon,
  ToolsIcon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";

import type { SignalTone } from "@/components/instrument-panel";

/**
 * The general in-app notification center (issue #741) — distinct from the
 * §7.10 out-of-tolerance acknowledgment feed in features/out-of-tolerance.
 *
 * The type list mirrors the API's customer-facing whitelist
 * (PORTAL_NOTIFICATION_TYPES in @calibra-facil/schemas): only these types are
 * ever listed for a portal session, and only their channel preferences are
 * editable here.
 */

export const PORTAL_NOTIFICATION_TYPES = [
  "CERTIFICATE_READY",
  "CERTIFICATE_AMENDED",
  "AUDIT_PACK_READY",
  "CALIBRATION_REQUEST_UNDER_REVIEW",
  "CALIBRATION_REQUEST_APPROVED",
  "CALIBRATION_REQUEST_REJECTED",
  "CALIBRATION_REQUEST_CONVERTED",
  "VISIT_CONFIRMED",
  "VISIT_RESCHEDULED",
  "VISIT_CANCELLED",
  "VISIT_REMINDER",
  "VISIT_RESCHEDULE_DECLINED",
  "ASSET_FOUND_OUT_OF_TOLERANCE",
] as const;

export type PortalNotificationType = (typeof PORTAL_NOTIFICATION_TYPES)[number];

type NotificationTypeMeta = {
  icon: IconSvgElement;
  tone: SignalTone;
  /** Short event name for the preferences matrix. */
  label: string;
  /** One-line explanation for the preferences matrix. */
  description: string;
};

const TYPE_META: Record<PortalNotificationType, NotificationTypeMeta> = {
  CERTIFICATE_READY: {
    icon: File01Icon,
    tone: "ok",
    label: "Certificado disponível",
    description: "Um novo certificado de calibração foi liberado.",
  },
  CERTIFICATE_AMENDED: {
    icon: Alert02Icon,
    tone: "warning",
    label: "Certificado retificado",
    description: "Um certificado emitido foi substituído por versão corrigida.",
  },
  AUDIT_PACK_READY: {
    icon: FolderLibraryIcon,
    tone: "info",
    label: "Pacote de auditoria pronto",
    description: "O pacote de certificados solicitado está pronto.",
  },
  CALIBRATION_REQUEST_UNDER_REVIEW: {
    icon: Notebook01Icon,
    tone: "info",
    label: "Solicitação em análise",
    description: "O laboratório começou a analisar sua solicitação.",
  },
  CALIBRATION_REQUEST_APPROVED: {
    icon: CheckmarkCircle01Icon,
    tone: "ok",
    label: "Solicitação aprovada",
    description: "Sua solicitação de calibração foi aprovada.",
  },
  CALIBRATION_REQUEST_REJECTED: {
    icon: CancelCircleIcon,
    tone: "critical",
    label: "Solicitação recusada",
    description: "Sua solicitação de calibração foi recusada.",
  },
  CALIBRATION_REQUEST_CONVERTED: {
    icon: ToolsIcon,
    tone: "ok",
    label: "Solicitação virou ordem de serviço",
    description: "Sua solicitação foi convertida em ordem de serviço.",
  },
  VISIT_CONFIRMED: {
    icon: Calendar03Icon,
    tone: "ok",
    label: "Visita confirmada",
    description: "Uma visita no local foi confirmada com data e técnico.",
  },
  VISIT_RESCHEDULED: {
    icon: Calendar03Icon,
    tone: "warning",
    label: "Visita remarcada",
    description: "A data de uma visita no local foi alterada.",
  },
  VISIT_CANCELLED: {
    icon: CancelCircleIcon,
    tone: "critical",
    label: "Visita cancelada",
    description: "Uma visita no local foi cancelada.",
  },
  VISIT_REMINDER: {
    icon: Calendar03Icon,
    tone: "info",
    label: "Lembrete de visita",
    description: "Uma visita no local está próxima.",
  },
  VISIT_RESCHEDULE_DECLINED: {
    icon: CancelCircleIcon,
    tone: "warning",
    label: "Reagendamento não atendido",
    description:
      "O laboratório não pôde atender sua solicitação de reagendamento.",
  },
  ASSET_FOUND_OUT_OF_TOLERANCE: {
    icon: Alert02Icon,
    tone: "critical",
    label: "Resultado fora de tolerância",
    description: "Um instrumento seu foi encontrado fora de tolerância.",
  },
};

const FALLBACK_META: NotificationTypeMeta = {
  icon: File01Icon,
  tone: "neutral",
  label: "Notificação",
  description: "",
};

const PORTAL_NOTIFICATION_TYPE_SET: ReadonlySet<string> = new Set(
  PORTAL_NOTIFICATION_TYPES,
);

function isPortalNotificationType(
  type: string,
): type is PortalNotificationType {
  return PORTAL_NOTIFICATION_TYPE_SET.has(type);
}

/** Icon + tone + label for a notification type; tolerant of unknown types. */
export function getNotificationTypeMeta(type: string): NotificationTypeMeta {
  return isPortalNotificationType(type) ? TYPE_META[type] : FALLBACK_META;
}

/** Preference matrix groups, in display order. */
export const PREFERENCE_GROUPS: Array<{
  label: string;
  types: Array<PortalNotificationType>;
}> = [
  {
    label: "Certificados",
    types: ["CERTIFICATE_READY", "CERTIFICATE_AMENDED", "AUDIT_PACK_READY"],
  },
  {
    label: "Solicitações",
    types: [
      "CALIBRATION_REQUEST_UNDER_REVIEW",
      "CALIBRATION_REQUEST_APPROVED",
      "CALIBRATION_REQUEST_REJECTED",
      "CALIBRATION_REQUEST_CONVERTED",
    ],
  },
  {
    label: "Visitas",
    types: [
      "VISIT_CONFIRMED",
      "VISIT_RESCHEDULED",
      "VISIT_RESCHEDULE_DECLINED",
      "VISIT_CANCELLED",
      "VISIT_REMINDER",
    ],
  },
  {
    label: "Qualidade",
    types: ["ASSET_FOUND_OUT_OF_TOLERANCE"],
  },
];

export type NormalizedActionUrl =
  | { kind: "internal"; to: string }
  | { kind: "external"; href: string };

/**
 * Notification rows store portal deep links as `/portal/...` paths (the email
 * builder strips the prefix against the portal host — see
 * packages/notifications resolveEmailActionUrl). For in-portal navigation we
 * apply the same normalization: strip the `/portal` prefix and route
 * internally; absolute URLs open externally.
 */
export function normalizeActionUrl(
  actionUrl: string | null | undefined,
): NormalizedActionUrl | null {
  if (!actionUrl) return null;
  if (/^https?:\/\//i.test(actionUrl)) {
    return { kind: "external", href: actionUrl };
  }
  if (actionUrl === "/portal" || actionUrl.startsWith("/portal/")) {
    const path = actionUrl.replace(/^\/portal(?=\/|$)/, "");
    return { kind: "internal", to: path === "" ? "/" : path };
  }
  if (actionUrl.startsWith("/")) {
    return { kind: "internal", to: actionUrl };
  }
  return { kind: "internal", to: `/${actionUrl}` };
}

/** Bell badge label, capped so the pill never grows ("9+"). */
export function formatBadgeCount(count: number): string {
  return count > 9 ? "9+" : String(count);
}
