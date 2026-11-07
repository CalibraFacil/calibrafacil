/** @jsxRuntime automatic */
/** @jsxImportSource react */
import type { ReactNode } from "react";
import {
  SERVICE_ORDER_STATUS,
  type ServiceOrderStatus,
} from "@calibra-facil/shared/service-orders";
import type { SignalTone } from "@calibra-facil/shared/status-vocabulary";
import {
  Badge,
  DetailRow,
  EmailLayout,
  type EmailBrand,
} from "./components/email-layout";

const BADGE_VARIANT_BY_TONE = {
  ok: "success",
  critical: "error",
  warning: "warning",
  info: "info",
  neutral: "info",
} as const satisfies Record<
  SignalTone,
  "success" | "error" | "warning" | "info"
>;

/** The pill above the headline: the e-mail's own wording, painted by the status's tone. */
export function ServiceOrderStatusBadge({
  status,
  children,
}: {
  status: ServiceOrderStatus;
  children: ReactNode;
}) {
  return (
    <Badge variant={BADGE_VARIANT_BY_TONE[SERVICE_ORDER_STATUS.tone(status)]}>
      {children}
    </Badge>
  );
}

/** The "Status" row of the detail box: the label every other screen shows. */
export function ServiceOrderStatusRow({
  status,
}: {
  status: ServiceOrderStatus;
}) {
  return (
    <DetailRow label="Status" value={SERVICE_ORDER_STATUS.label(status)} />
  );
}

export interface ServiceOrderEmailLayoutProps {
  /** Text shown in the email client preview (pre-header). */
  previewText: string;
  /**
   * White-label brand resolved via getLabEmailBrand(serviceOrder.organizationId).
   * When present and isWhiteLabel=true, the lab company header (name, address,
   * CNPJ, phone, website, logo) is shown and Calibra Fácil platform branding
   * is suppressed per REQ-SOEMAIL-006.
   */
  brand?: EmailBrand;
  /** Optional footer note (shown below the card). */
  footerNote?: string;
  children: ReactNode;
}

/**
 * Shared layout for all customer-facing service-order transactional emails.
 *
 * REQ-SOEMAIL-006: renders the company header from EmailBrand (name, address,
 * CNPJ, phone, website, logo). When EmailBrand.isWhiteLabel is set, the
 * Calibra Fácil platform branding is suppressed — EmailLayout already
 * implements this via brand.isWhiteLabel; this component is a thin domain
 * wrapper that expresses the service-order intent clearly for callers (B–G).
 */
export function ServiceOrderEmailLayout({
  previewText,
  brand,
  footerNote,
  children,
}: ServiceOrderEmailLayoutProps) {
  return (
    <EmailLayout
      previewText={previewText}
      brand={brand}
      footerNote={footerNote}
    >
      {children}
    </EmailLayout>
  );
}

export type { EmailBrand };
