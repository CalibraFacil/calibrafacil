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

export interface WarrantyReturnEmailProps {
  /** White-label brand for the sending lab. */
  brand?: EmailBrand;
  /** OS number, e.g. "OS-2026-042". */
  serviceOrderNumber: string;
  /** Customer name. */
  customerName: string;
}

/**
 * "Garantia Retorno" customer-facing email (REQ-SOEMAIL-062).
 *
 * Sent when the service order enters `warranty_return` status.
 * Informs the customer that the OS entered the warranty return process.
 */
export function WarrantyReturnEmail({
  brand,
  serviceOrderNumber,
  customerName,
}: WarrantyReturnEmailProps) {
  const labName = brand?.name ?? "CalibraFácil";
  const previewText = `OS ${serviceOrderNumber} — retorno em garantia.`;

  return (
    <ServiceOrderEmailLayout previewText={previewText} brand={brand}>
      <EmailCard brand={brand}>
        <Badge variant="warning">Retorno em garantia</Badge>
        <Title>Ordem de serviço em retorno de garantia</Title>
        <Paragraph>
          Olá, {customerName}! Informamos que a ordem de serviço{" "}
          {serviceOrderNumber} entrou no processo de retorno em garantia em{" "}
          {labName}.
        </Paragraph>

        <DetailBox>
          <DetailRow label="Número da OS" value={serviceOrderNumber} />
          <DetailRow label="Status" value="Retorno em garantia" />
        </DetailBox>

        <Paragraph>
          Nossa equipe irá avaliar o equipamento e entrar em contato com você em
          breve. Se tiver dúvidas, entre em contato com {labName}.
        </Paragraph>
      </EmailCard>
    </ServiceOrderEmailLayout>
  );
}

WarrantyReturnEmail.PreviewProps = {
  serviceOrderNumber: "OS-2026-042",
  customerName: "Maria Silva",
} satisfies WarrantyReturnEmailProps;

export default WarrantyReturnEmail;
