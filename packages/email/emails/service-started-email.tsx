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

export interface ServiceStartedEmailProps {
  /** White-label brand for the sending lab. */
  brand?: EmailBrand;
  /** OS number, e.g. "OS-2026-042". */
  serviceOrderNumber: string;
  /** Customer name. */
  customerName: string;
}

/**
 * "Serviço Iniciado" customer-facing email (REQ-SOEMAIL-041).
 *
 * Sent when the service order enters `repair_in_progress` status.
 * Informs the customer that the lab has started working on the equipment.
 */
export function ServiceStartedEmail({
  brand,
  serviceOrderNumber,
  customerName,
}: ServiceStartedEmailProps) {
  const labName = brand?.name ?? "CalibraFácil";
  const previewText = `OS ${serviceOrderNumber} — serviço iniciado pelo laboratório.`;

  return (
    <ServiceOrderEmailLayout previewText={previewText} brand={brand}>
      <EmailCard brand={brand}>
        <Badge variant="info">Serviço iniciado</Badge>
        <Title>Serviço em andamento</Title>
        <Paragraph>
          Olá, {customerName}! {labName} iniciou a execução do serviço na sua
          ordem de serviço. Nossa equipe técnica está trabalhando no seu
          equipamento.
        </Paragraph>

        <DetailBox>
          <DetailRow label="Número da OS" value={serviceOrderNumber} />
          <DetailRow label="Status" value="Serviço iniciado" />
        </DetailBox>

        <Paragraph>
          Entraremos em contato quando o serviço for concluído. Obrigado pela
          confiança em {labName}!
        </Paragraph>
      </EmailCard>
    </ServiceOrderEmailLayout>
  );
}

ServiceStartedEmail.PreviewProps = {
  serviceOrderNumber: "OS-2026-042",
  customerName: "Maria Silva",
} satisfies ServiceStartedEmailProps;

export default ServiceStartedEmail;
