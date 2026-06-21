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

export interface ServiceOrderCanceledEmailProps {
  /** White-label brand for the sending lab. */
  brand?: EmailBrand;
  /** OS number, e.g. "OS-2026-042". */
  serviceOrderNumber: string;
  /** Customer name. */
  customerName: string;
}

/**
 * "OS Cancelada" customer-facing email (REQ-SOEMAIL-061).
 *
 * Sent when the service order enters `canceled` status.
 * Informs the customer that the service order has been canceled.
 */
export function ServiceOrderCanceledEmail({
  brand,
  serviceOrderNumber,
  customerName,
}: ServiceOrderCanceledEmailProps) {
  const labName = brand?.name ?? "CalibraFácil";
  const previewText = `OS ${serviceOrderNumber} — ordem de serviço cancelada.`;

  return (
    <ServiceOrderEmailLayout previewText={previewText} brand={brand}>
      <EmailCard brand={brand}>
        <Badge variant="error">OS cancelada</Badge>
        <Title>Ordem de serviço cancelada</Title>
        <Paragraph>
          Olá, {customerName}! Informamos que a ordem de serviço{" "}
          {serviceOrderNumber} foi cancelada por {labName}.
        </Paragraph>

        <DetailBox>
          <DetailRow label="Número da OS" value={serviceOrderNumber} />
          <DetailRow label="Status" value="Cancelada" />
        </DetailBox>

        <Paragraph>
          Se você tiver dúvidas sobre o cancelamento, entre em contato com{" "}
          {labName}. Agradecemos a sua compreensão.
        </Paragraph>
      </EmailCard>
    </ServiceOrderEmailLayout>
  );
}

ServiceOrderCanceledEmail.PreviewProps = {
  serviceOrderNumber: "OS-2026-042",
  customerName: "Maria Silva",
} satisfies ServiceOrderCanceledEmailProps;

export default ServiceOrderCanceledEmail;
