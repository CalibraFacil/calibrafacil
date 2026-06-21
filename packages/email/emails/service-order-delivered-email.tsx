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

export interface ServiceOrderDeliveredEmailProps {
  /** White-label brand for the sending lab. */
  brand?: EmailBrand;
  /** OS number, e.g. "OS-2026-042". */
  serviceOrderNumber: string;
  /** Customer name. */
  customerName: string;
}

/**
 * "OS Entregue" customer-facing email (REQ-SOEMAIL-052).
 *
 * Sent when the service order is `delivered`.
 * Acts as a delivery receipt confirming the OS was delivered to the customer.
 */
export function ServiceOrderDeliveredEmail({
  brand,
  serviceOrderNumber,
  customerName,
}: ServiceOrderDeliveredEmailProps) {
  const labName = brand?.name ?? "CalibraFácil";
  const previewText = `OS ${serviceOrderNumber} — equipamento entregue.`;

  return (
    <ServiceOrderEmailLayout previewText={previewText} brand={brand}>
      <EmailCard brand={brand}>
        <Badge variant="success">Equipamento entregue</Badge>
        <Title>Confirmação de entrega</Title>
        <Paragraph>
          Olá, {customerName}! Confirmamos que o equipamento da ordem de serviço{" "}
          {serviceOrderNumber} foi entregue com sucesso. Este é o seu comprovante
          de entrega.
        </Paragraph>

        <DetailBox>
          <DetailRow label="Número da OS" value={serviceOrderNumber} />
          <DetailRow label="Status" value="Entregue" />
        </DetailBox>

        <Paragraph>
          Agradecemos pela confiança em {labName}. Se precisar de qualquer
          assistência adicional, não hesite em nos contatar.
        </Paragraph>
      </EmailCard>
    </ServiceOrderEmailLayout>
  );
}

ServiceOrderDeliveredEmail.PreviewProps = {
  serviceOrderNumber: "OS-2026-042",
  customerName: "Maria Silva",
} satisfies ServiceOrderDeliveredEmailProps;

export default ServiceOrderDeliveredEmail;
