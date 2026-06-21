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

export interface UnderEvaluationEmailProps {
  /** White-label brand for the sending lab. */
  brand?: EmailBrand;
  /** OS number, e.g. "OS-2026-042". */
  serviceOrderNumber: string;
  /** Customer name. */
  customerName: string;
}

/**
 * "Em Avaliação Técnica" customer-facing email (REQ-SOEMAIL-044).
 *
 * Sent when the service order enters `under_evaluation` status.
 * Informs the customer that the technical evaluation is now in progress.
 */
export function UnderEvaluationEmail({
  brand,
  serviceOrderNumber,
  customerName,
}: UnderEvaluationEmailProps) {
  const labName = brand?.name ?? "CalibraFácil";
  const previewText = `OS ${serviceOrderNumber} — em avaliação técnica.`;

  return (
    <ServiceOrderEmailLayout previewText={previewText} brand={brand}>
      <EmailCard brand={brand}>
        <Badge variant="info">Em avaliação técnica</Badge>
        <Title>Avaliação técnica em andamento</Title>
        <Paragraph>
          Olá, {customerName}! A equipe técnica de {labName} está realizando a
          avaliação do equipamento da ordem de serviço {serviceOrderNumber}.
        </Paragraph>

        <DetailBox>
          <DetailRow label="Número da OS" value={serviceOrderNumber} />
          <DetailRow label="Status" value="Em avaliação técnica" />
        </DetailBox>

        <Paragraph>
          Assim que a avaliação for concluída, informaremos você sobre os
          resultados e os próximos passos. Obrigado pela confiança em {labName}!
        </Paragraph>
      </EmailCard>
    </ServiceOrderEmailLayout>
  );
}

UnderEvaluationEmail.PreviewProps = {
  serviceOrderNumber: "OS-2026-042",
  customerName: "Maria Silva",
} satisfies UnderEvaluationEmailProps;

export default UnderEvaluationEmail;
