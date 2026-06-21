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

export interface ServiceOrderCreatedEmailProps {
  /** White-label brand for the sending lab. */
  brand?: EmailBrand;
  /** OS number, e.g. "OS-2024-001". */
  serviceOrderNumber: string;
  /** Customer name. */
  customerName: string;
  /** Asset manufacturer / brand (nullable). */
  assetManufacturer?: string | null;
  /** Asset model (nullable). */
  assetModel?: string | null;
  /** Asset serial number (nullable). */
  assetSerialNumber?: string | null;
  /** Intake (entrada) date, pre-formatted as a pt-BR string, e.g. "19/06/2026". */
  intakeDate: string;
  /** The claimed defect / problem description. */
  claimedDefect: string;
}

/**
 * "Nova OS" customer-facing email (REQ-SOEMAIL-011).
 *
 * Sent immediately after a service order is created. Shows the OS number,
 * asset brand/model/serial, intake date, and claimed defect.
 */
export function ServiceOrderCreatedEmail({
  brand,
  serviceOrderNumber,
  customerName,
  assetManufacturer,
  assetModel,
  assetSerialNumber,
  intakeDate,
  claimedDefect,
}: ServiceOrderCreatedEmailProps) {
  const labName = brand?.name ?? "CalibraFácil";

  // Build a concise asset description for the preview text
  const assetParts = [assetManufacturer, assetModel].filter(Boolean).join(" ");
  const previewText = `Nova OS ${serviceOrderNumber} recebida — ${assetParts || "equipamento"}.`;

  return (
    <ServiceOrderEmailLayout previewText={previewText} brand={brand}>
      <EmailCard brand={brand}>
        <Title>Ordem de Serviço recebida</Title>
        <Paragraph>
          Olá, {customerName}! {labName} registrou a entrada do seu equipamento.
          Confira os detalhes abaixo.
        </Paragraph>

        <DetailBox>
          <DetailRow label="Número da OS" value={serviceOrderNumber} />
          <DetailRow label="Data de entrada" value={intakeDate} />
          {(assetManufacturer ?? assetModel) ? (
            <DetailRow
              label="Equipamento"
              value={[assetManufacturer, assetModel].filter(Boolean).join(" ")}
            />
          ) : null}
          {assetSerialNumber ? (
            <DetailRow label="Número de série" value={assetSerialNumber} />
          ) : null}
          <DetailRow label="Defeito relatado" value={claimedDefect} />
        </DetailBox>

        <Paragraph>
          Em breve entraremos em contato com o diagnóstico e orçamento.
        </Paragraph>
      </EmailCard>
    </ServiceOrderEmailLayout>
  );
}

ServiceOrderCreatedEmail.PreviewProps = {
  serviceOrderNumber: "OS-2026-042",
  customerName: "Maria Silva",
  assetManufacturer: "Mettler Toledo",
  assetModel: "XS204",
  assetSerialNumber: "B812345678",
  intakeDate: "19/06/2026",
  claimedDefect: "Balança apresenta leitura instável e não zera.",
} satisfies ServiceOrderCreatedEmailProps;

export default ServiceOrderCreatedEmail;
