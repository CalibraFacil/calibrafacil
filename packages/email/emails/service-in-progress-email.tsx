/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { SERVICE_ORDER_STATUS } from "@calibra-facil/shared/service-orders";
import {
  ServiceOrderEmailLayout,
  ServiceOrderStatusBadge,
} from "./service-order-email-layout";
import type { EmailBrand } from "./components/email-layout";
import {
  EmailCard,
  Title,
  Paragraph,
  DetailBox,
  DetailRow,
} from "./components/email-layout";

export type ServiceInProgressStage =
  | "awaiting_calibration"
  | "calibration_in_progress";

const STAGE_MESSAGES: Record<ServiceInProgressStage, string> = {
  awaiting_calibration:
    "O serviço técnico foi concluído e o equipamento aguarda o processo de calibração.",
  calibration_in_progress:
    "O equipamento está sendo submetido ao processo de calibração pela equipe especializada.",
};

export interface ServiceInProgressEmailProps {
  /** White-label brand for the sending lab. */
  brand?: EmailBrand;
  /** OS number, e.g. "OS-2026-042". */
  serviceOrderNumber: string;
  /** Customer name. */
  customerName: string;
  /**
   * The current stage (awaiting_calibration or calibration_in_progress).
   * Determines the status label and body message.
   */
  stage: ServiceInProgressStage;
}

/**
 * "Serviço em Andamento" customer-facing email (REQ-SOEMAIL-042).
 *
 * Sent when the service order enters `awaiting_calibration` or
 * `calibration_in_progress` status. A single template handles both stages;
 * the `stage` prop determines the status-specific phrase shown.
 */
export function ServiceInProgressEmail({
  brand,
  serviceOrderNumber,
  customerName,
  stage,
}: ServiceInProgressEmailProps) {
  const labName = brand?.name ?? "CalibraFácil";
  const stageLabel = SERVICE_ORDER_STATUS.label(stage);
  const stageMessage = STAGE_MESSAGES[stage];
  const previewText = `OS ${serviceOrderNumber} — ${stageLabel.toLowerCase()}.`;

  return (
    <ServiceOrderEmailLayout previewText={previewText} brand={brand}>
      <EmailCard brand={brand}>
        <ServiceOrderStatusBadge status={stage}>
          Atualização do serviço
        </ServiceOrderStatusBadge>
        <Title>Atualização: {stageLabel}</Title>
        <Paragraph>
          Olá, {customerName}! {labName} tem uma atualização sobre a sua ordem
          de serviço.
        </Paragraph>

        <DetailBox>
          <DetailRow label="Número da OS" value={serviceOrderNumber} />
          <DetailRow label="Etapa atual" value={stageLabel} />
        </DetailBox>

        <Paragraph>{stageMessage}</Paragraph>

        <Paragraph>
          Informaremos você quando houver mais novidades. Obrigado pela
          paciência e pela confiança em {labName}!
        </Paragraph>
      </EmailCard>
    </ServiceOrderEmailLayout>
  );
}

ServiceInProgressEmail.PreviewProps = {
  serviceOrderNumber: "OS-2026-042",
  customerName: "Maria Silva",
  stage: "calibration_in_progress",
} satisfies ServiceInProgressEmailProps;

export default ServiceInProgressEmail;
