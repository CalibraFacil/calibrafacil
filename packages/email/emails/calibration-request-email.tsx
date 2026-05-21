/** @jsxRuntime automatic */
/** @jsxImportSource react */
import {
  ActionButton,
  Badge,
  DetailBox,
  DetailRow,
  EmailCard,
  EmailLayout,
  HighlightValue,
  LinkFallback,
  Paragraph,
  StatusBox,
  Title,
} from "./components/email-layout";

type CalibrationRequestEmailType =
  | "submitted"
  | "underReview"
  | "approved"
  | "rejected"
  | "converted";

interface CalibrationRequestEmailProps {
  recipientName: string;
  type: CalibrationRequestEmailType;
  requestId: number;
  customerName: string;
  labName?: string;
  itemCount: number;
  requestedDueDate?: string;
  actorName?: string;
  reason?: string;
  jobCodes?: string[];
  actionUrl: string;
  logoSrc?: string;
}

const getTypeConfig = (type: CalibrationRequestEmailType) => {
  switch (type) {
    case "submitted":
      return {
        title: "Nova solicitação de calibração",
        previewText: "Uma solicitação de calibração foi enviada",
        label: "Nova solicitação",
        variant: "info" as const,
        actionLabel: "Abrir solicitação",
      };
    case "underReview":
      return {
        title: "Solicitação em análise",
        previewText: "Sua solicitação de calibração está em análise",
        label: "Em análise",
        variant: "info" as const,
        actionLabel: "Acompanhar solicitação",
      };
    case "approved":
      return {
        title: "Solicitação aprovada",
        previewText: "Sua solicitação de calibração foi aprovada",
        label: "Aprovada",
        variant: "success" as const,
        actionLabel: "Acompanhar solicitação",
      };
    case "rejected":
      return {
        title: "Solicitação recusada",
        previewText: "Sua solicitação de calibração foi recusada",
        label: "Recusada",
        variant: "error" as const,
        actionLabel: "Ver detalhes",
      };
    case "converted":
      return {
        title: "Solicitação convertida em OS",
        previewText: "Sua solicitação foi convertida em ordens de serviço",
        label: "Convertida",
        variant: "success" as const,
        actionLabel: "Acompanhar solicitação",
      };
  }
};

export function CalibrationRequestEmail({
  recipientName = "Usuário",
  type = "submitted",
  requestId = 123,
  customerName = "Cliente",
  labName,
  itemCount = 1,
  requestedDueDate,
  actorName,
  reason,
  jobCodes,
  actionUrl = "https://calibrafacil.com/dashboard/requests/123",
  logoSrc,
}: CalibrationRequestEmailProps) {
  const config = getTypeConfig(type);

  return (
    <EmailLayout previewText={config.previewText} logoSrc={logoSrc}>
      <EmailCard logoSrc={logoSrc}>
        <Badge variant={config.variant}>{config.label}</Badge>
        <Title>{config.title}</Title>

        <Paragraph>Olá, {recipientName},</Paragraph>
        <Paragraph>
          {type === "submitted"
            ? `${customerName} enviou uma solicitação de calibração para análise.`
            : type === "converted"
              ? "A solicitação de calibração foi convertida em ordem de serviço."
              : `A solicitação de calibração #${requestId} foi atualizada.`}
        </Paragraph>

        <DetailBox tone={type === "rejected" ? "error" : "default"}>
          {labName && <DetailRow label="Laboratório" value={labName} />}
          <DetailRow label="Cliente" value={customerName} />
          <DetailRow
            label="Solicitação"
            value={
              <HighlightValue tone={config.variant}>
                #{requestId}
              </HighlightValue>
            }
          />
          <DetailRow
            label="Ativos"
            value={`${itemCount} ${itemCount === 1 ? "item" : "itens"}`}
          />
          {requestedDueDate && (
            <DetailRow label="Data solicitada" value={requestedDueDate} />
          )}
          {actorName && <DetailRow label="Atualizado por" value={actorName} />}
          {jobCodes && jobCodes.length > 0 && (
            <DetailRow label="Ordens de serviço" value={jobCodes.join(", ")} />
          )}
          {reason && <DetailRow label="Motivo" value={reason} />}
        </DetailBox>

        <StatusBox variant={config.variant}>
          <strong>Status:</strong> {config.label}
        </StatusBox>

        <ActionButton href={actionUrl}>{config.actionLabel}</ActionButton>
        <LinkFallback url={actionUrl} />
      </EmailCard>
    </EmailLayout>
  );
}

CalibrationRequestEmail.PreviewProps = {
  recipientName: "Ana",
  type: "submitted",
  requestId: 123,
  customerName: "ACME Laboratórios",
  labName: "CalibraFácil Metrologia",
  itemCount: 3,
  requestedDueDate: "21/06/2026",
  actionUrl: "https://calibrafacil.com/dashboard/requests/123",
} satisfies CalibrationRequestEmailProps;

export default CalibrationRequestEmail;
