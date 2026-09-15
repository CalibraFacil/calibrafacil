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
  Badge,
} from "./components/email-layout";

export interface FinalReviewEmailProps {
  /** White-label brand for the sending lab. */
  brand?: EmailBrand;
  /** OS number, e.g. "OS-2026-042". */
  serviceOrderNumber: string;
  /** Customer name. */
  customerName: string;
}

/**
 * "Em Revisão Final" customer-facing email (REQ-SOEMAIL-054).
 *
 * Sent when the service order enters `awaiting_final_review` status.
 * Informs the customer that the service is in its final review phase.
 */
export function FinalReviewEmail({
  brand,
  serviceOrderNumber,
  customerName,
}: FinalReviewEmailProps) {
  const labName = brand?.name ?? "CalibraFácil";
  const previewText = `OS ${serviceOrderNumber} — em revisão final.`;

  return (
    <ServiceOrderEmailLayout previewText={previewText} brand={brand}>
      <EmailCard brand={brand}>
        <Badge variant="info">Em revisão final</Badge>
        <Title>Serviço em revisão final</Title>
        <Paragraph>
          Olá, {customerName}! O serviço da ordem de serviço{" "}
          {serviceOrderNumber} está passando pela etapa de revisão final em{" "}
          {labName}.
        </Paragraph>

        <DetailBox>
          <DetailRow label="Número da OS" value={serviceOrderNumber} />
          <DetailRow label="Status" value="Em revisão final" />
        </DetailBox>

        <Paragraph>
          Estamos quase concluindo! Em breve você será notificado sobre a
          disponibilidade do equipamento. Obrigado pela paciência e pela
          confiança em {labName}!
        </Paragraph>
      </EmailCard>
    </ServiceOrderEmailLayout>
  );
}

FinalReviewEmail.PreviewProps = {
  serviceOrderNumber: "OS-2026-042",
  customerName: "Maria Silva",
} satisfies FinalReviewEmailProps;

export default FinalReviewEmail;
