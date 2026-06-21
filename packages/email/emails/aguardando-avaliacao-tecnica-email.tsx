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

export interface AguardandoAvaliacaoTecnicaEmailProps {
  /** White-label brand for the sending lab. */
  brand?: EmailBrand;
  /** OS number, e.g. "OS-2026-042". */
  serviceOrderNumber: string;
  /** Customer name. */
  customerName: string;
}

/**
 * "Aguardando Avaliação Técnica" customer-facing email (REQ-SOEMAIL-043).
 *
 * Sent when the service order enters `awaiting_tech_evaluation` status.
 * Informs the customer that the equipment is queued for technical evaluation.
 */
export function AguardandoAvaliacaoTecnicaEmail({
  brand,
  serviceOrderNumber,
  customerName,
}: AguardandoAvaliacaoTecnicaEmailProps) {
  const labName = brand?.name ?? "CalibraFácil";
  const previewText = `OS ${serviceOrderNumber} — aguardando avaliação técnica.`;

  return (
    <ServiceOrderEmailLayout previewText={previewText} brand={brand}>
      <EmailCard brand={brand}>
        <Badge variant="warning">Aguardando avaliação</Badge>
        <Title>Equipamento aguarda avaliação técnica</Title>
        <Paragraph>
          Olá, {customerName}! Seu equipamento na ordem de serviço{" "}
          {serviceOrderNumber} está aguardando avaliação técnica pela equipe
          especializada de {labName}.
        </Paragraph>

        <DetailBox>
          <DetailRow label="Número da OS" value={serviceOrderNumber} />
          <DetailRow label="Status" value="Aguardando avaliação técnica" />
        </DetailBox>

        <Paragraph>
          Em breve nossa equipe técnica realizará a avaliação e informaremos você
          sobre os próximos passos. Obrigado pela paciência!
        </Paragraph>
      </EmailCard>
    </ServiceOrderEmailLayout>
  );
}
