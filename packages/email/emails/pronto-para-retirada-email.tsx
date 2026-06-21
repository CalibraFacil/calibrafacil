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

export interface ProntoParaRetiradaEmailProps {
  /** White-label brand for the sending lab. */
  brand?: EmailBrand;
  /** OS number, e.g. "OS-2026-042". */
  serviceOrderNumber: string;
  /** Customer name. */
  customerName: string;
}

/**
 * "Pronto para Retirada" customer-facing email (REQ-SOEMAIL-051).
 *
 * Sent when the service order enters `ready_for_pickup` status.
 * Informs the customer that the equipment is ready to be picked up.
 */
export function ProntoParaRetiradaEmail({
  brand,
  serviceOrderNumber,
  customerName,
}: ProntoParaRetiradaEmailProps) {
  const labName = brand?.name ?? "CalibraFácil";
  const previewText = `OS ${serviceOrderNumber} — pronto para retirada.`;

  return (
    <ServiceOrderEmailLayout previewText={previewText} brand={brand}>
      <EmailCard brand={brand}>
        <Badge variant="success">Pronto para retirada</Badge>
        <Title>Seu equipamento está pronto para retirada</Title>
        <Paragraph>
          Olá, {customerName}! O serviço da sua ordem de serviço{" "}
          {serviceOrderNumber} foi concluído e o equipamento está pronto para
          retirada em {labName}.
        </Paragraph>

        <DetailBox>
          <DetailRow label="Número da OS" value={serviceOrderNumber} />
          <DetailRow label="Status" value="Pronto para retirada" />
        </DetailBox>

        <Paragraph>
          Por favor, entre em contato com {labName} para combinar a retirada do
          equipamento. Obrigado pela confiança!
        </Paragraph>
      </EmailCard>
    </ServiceOrderEmailLayout>
  );
}
