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
import { Section, Text } from "@react-email/components";
import { formatMoney } from "@calibra-facil/shared";

export interface OrcamentoAprovadoEmailProps {
  /** White-label brand for the sending lab. */
  brand?: EmailBrand;
  /** OS number, e.g. "OS-2026-042". */
  serviceOrderNumber: string;
  /** Customer name. */
  customerName: string;
  /**
   * REQ-SOEMAIL-031: The approved total from serviceOrder.totalApprovedCents.
   * Rendered in BRL from integer cents — no recomputation.
   */
  totalApprovedCents: number;
}

/**
 * "Orçamento Aprovado" customer-facing email (REQ-SOEMAIL-031).
 *
 * Sent when a quote is approved — either manually (approveServiceOrderQuoteManually)
 * or via the portal (approveServiceOrderQuoteByPortalUser).
 * Displays the approved total (totalApprovedCents) formatted as BRL.
 */
export function OrcamentoAprovadoEmail({
  brand,
  serviceOrderNumber,
  customerName,
  totalApprovedCents,
}: OrcamentoAprovadoEmailProps) {
  const labName = brand?.name ?? "CalibraFácil";
  const totalBrl = formatMoney(totalApprovedCents);
  const previewText = `Orçamento ${serviceOrderNumber} aprovado — Total: ${totalBrl}`;

  return (
    <ServiceOrderEmailLayout previewText={previewText} brand={brand}>
      <EmailCard brand={brand}>
        <Title>Orçamento aprovado</Title>
        <Paragraph>
          Olá, {customerName}! O orçamento da ordem de serviço{" "}
          {serviceOrderNumber} foi aprovado. {labName} dará início ao serviço em
          breve.
        </Paragraph>

        <DetailBox>
          <DetailRow label="Número da OS" value={serviceOrderNumber} />
          <DetailRow label="Total aprovado" value={totalBrl} />
        </DetailBox>

        <Section className="mb-6 rounded-[10px] bg-bg px-5 py-5 text-left shadow-sm">
          <Text className="m-0 mb-1 font-sans text-[11px] font-bold uppercase leading-[1.5] tracking-[0.08em] text-fg-3">
            Total aprovado
          </Text>
          <Text className="m-0 font-mono text-[24px] font-bold leading-[1.2] tracking-[0.02em] text-brand tabular-nums">
            {totalBrl}
          </Text>
        </Section>

        <Paragraph>
          Entraremos em contato quando o serviço for concluído. Obrigado pela
          confiança!
        </Paragraph>
      </EmailCard>
    </ServiceOrderEmailLayout>
  );
}
