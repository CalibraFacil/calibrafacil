/** @jsxRuntime automatic */
/** @jsxImportSource react */
import {
  ServiceOrderEmailLayout,
  ServiceOrderStatusBadge,
  ServiceOrderStatusRow,
} from "./service-order-email-layout";
import type { EmailBrand } from "./components/email-layout";
import {
  EmailCard,
  Title,
  Paragraph,
  DetailBox,
  DetailRow,
} from "./components/email-layout";

export interface ServiceOrderClosedEmailProps {
  /** White-label brand for the sending lab. */
  brand?: EmailBrand;
  /** OS number, e.g. "OS-2026-042". */
  serviceOrderNumber: string;
  /** Customer name. */
  customerName: string;
}

/**
 * "OS Encerrada" customer-facing email (REQ-SOEMAIL-053).
 *
 * Sent when the service order is `closed`.
 * Informs the customer that the service order has been formally closed/encerrada.
 */
export function ServiceOrderClosedEmail({
  brand,
  serviceOrderNumber,
  customerName,
}: ServiceOrderClosedEmailProps) {
  const labName = brand?.name ?? "CalibraFácil";
  const previewText = `OS ${serviceOrderNumber} — ordem de serviço encerrada.`;

  return (
    <ServiceOrderEmailLayout previewText={previewText} brand={brand}>
      <EmailCard brand={brand}>
        <ServiceOrderStatusBadge status="closed">
          OS encerrada
        </ServiceOrderStatusBadge>
        <Title>Ordem de serviço encerrada</Title>
        <Paragraph>
          Olá, {customerName}! A ordem de serviço {serviceOrderNumber} foi
          formalmente encerrada por {labName}.
        </Paragraph>

        <DetailBox>
          <DetailRow label="Número da OS" value={serviceOrderNumber} />
          <ServiceOrderStatusRow status="closed" />
        </DetailBox>

        <Paragraph>
          Obrigado por escolher {labName}. Estamos à disposição para atendê-lo
          em futuras necessidades.
        </Paragraph>
      </EmailCard>
    </ServiceOrderEmailLayout>
  );
}

ServiceOrderClosedEmail.PreviewProps = {
  serviceOrderNumber: "OS-2026-042",
  customerName: "Maria Silva",
} satisfies ServiceOrderClosedEmailProps;

export default ServiceOrderClosedEmail;
