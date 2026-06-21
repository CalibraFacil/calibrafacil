/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { ServiceOrderEmailLayout } from "./service-order-email-layout";
import type { EmailBrand } from "./components/email-layout";
import {
  EmailCard,
  Title,
  Paragraph,
  DetailBox,
  DetailRow,
} from "./components/email-layout";

export interface OrcamentoRecusadoEmailProps {
  /** White-label brand for the sending lab. */
  brand?: EmailBrand;
  /** OS number, e.g. "OS-2026-042". */
  serviceOrderNumber: string;
  /** Customer name. */
  customerName: string;
  /**
   * REQ-SOEMAIL-032: Rejection reason — rendered when present; omitted when
   * null or undefined.
   */
  rejectionReason?: string | null;
}

/**
 * "Orçamento Recusado" customer-facing email (REQ-SOEMAIL-032).
 *
 * Sent when a quote is rejected — either manually (rejectServiceOrderQuoteManually)
 * or via the portal (rejectServiceOrderQuoteByPortalUser).
 * References the OS number and the rejectionReason when present.
 */
export function OrcamentoRecusadoEmail({
  brand,
  serviceOrderNumber,
  customerName,
  rejectionReason,
}: OrcamentoRecusadoEmailProps) {
  const labName = brand?.name ?? "CalibraFácil";
  const previewText = `Orçamento ${serviceOrderNumber} não aprovado — ${labName}`;

  return (
    <ServiceOrderEmailLayout previewText={previewText} brand={brand}>
      <EmailCard brand={brand}>
        <Title>Orçamento não aprovado</Title>
        <Paragraph>
          Olá, {customerName}! Informamos que o orçamento da ordem de serviço{" "}
          {serviceOrderNumber} não foi aprovado.
        </Paragraph>

        <DetailBox>
          <DetailRow label="Número da OS" value={serviceOrderNumber} />
          {rejectionReason ? (
            <DetailRow label="Motivo" value={rejectionReason} />
          ) : null}
        </DetailBox>

        <Paragraph>
          Entre em contato com {labName} caso tenha dúvidas ou deseje revisar o
          orçamento.
        </Paragraph>
      </EmailCard>
    </ServiceOrderEmailLayout>
  );
}
