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

export type ServicoAndamentoStage =
  | "awaiting_calibration"
  | "calibration_in_progress";

const STAGE_LABELS: Record<ServicoAndamentoStage, string> = {
  awaiting_calibration: "Aguardando calibração",
  calibration_in_progress: "Calibração em andamento",
};

const STAGE_MESSAGES: Record<ServicoAndamentoStage, string> = {
  awaiting_calibration:
    "O serviço técnico foi concluído e o equipamento aguarda o processo de calibração.",
  calibration_in_progress:
    "O equipamento está sendo submetido ao processo de calibração pela equipe especializada.",
};

export interface ServicoAndamentoEmailProps {
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
  stage: ServicoAndamentoStage;
}

/**
 * "Serviço em Andamento" customer-facing email (REQ-SOEMAIL-042).
 *
 * Sent when the service order enters `awaiting_calibration` or
 * `calibration_in_progress` status. A single template handles both stages;
 * the `stage` prop determines the status-specific phrase shown.
 */
export function ServicoAndamentoEmail({
  brand,
  serviceOrderNumber,
  customerName,
  stage,
}: ServicoAndamentoEmailProps) {
  const labName = brand?.name ?? "CalibraFácil";
  const stageLabel = STAGE_LABELS[stage];
  const stageMessage = STAGE_MESSAGES[stage];
  const previewText = `OS ${serviceOrderNumber} — ${stageLabel.toLowerCase()}.`;

  return (
    <ServiceOrderEmailLayout previewText={previewText} brand={brand}>
      <EmailCard brand={brand}>
        <Badge variant="info">Atualização do serviço</Badge>
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
          Informaremos você quando houver mais novidades. Obrigado pela paciência
          e pela confiança em {labName}!
        </Paragraph>
      </EmailCard>
    </ServiceOrderEmailLayout>
  );
}
