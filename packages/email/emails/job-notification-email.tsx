/** @jsxRuntime automatic */
/** @jsxImportSource react */
import {
  ActionButton,
  DetailBox,
  EmailCard,
  EmailLayout,
  Eyebrow,
  HighlightValue,
  LinkFallback,
  Paragraph,
  StatusBox,
  Title,
  type EmailBrand,
} from "./components/email-layout";

type JobNotificationType =
  | "submitted"
  | "approved"
  | "rejected"
  | "assigned"
  | "overdue";

export interface JobNotificationEmailProps {
  recipientName: string;
  type: JobNotificationType;
  jobId: string;
  message: string;
  actorName?: string;
  reason?: string;
  actionUrl: string;
  logoSrc?: string;
  brand?: EmailBrand;
}

const getTypeConfig = (type: JobNotificationType) => {
  switch (type) {
    case "submitted":
      return {
        title: "Calibração aguardando revisão",
        statusLabel: "Aguardando revisão",
        statusVariant: "warning" as const,
        previewText: "Uma calibração foi submetida para revisão",
      };
    case "approved":
      return {
        title: "Calibração aprovada",
        statusLabel: "Aprovada",
        statusVariant: "success" as const,
        previewText: "Sua calibração foi aprovada",
      };
    case "rejected":
      return {
        title: "Calibração rejeitada",
        statusLabel: "Rejeitada",
        statusVariant: "error" as const,
        previewText: "Sua calibração foi rejeitada",
      };
    case "assigned":
      return {
        title: "Nova calibração atribuída",
        statusLabel: "Atribuída",
        statusVariant: "info" as const,
        previewText: "Uma nova calibração foi atribuída a você",
      };
    case "overdue":
      return {
        title: "Calibração atrasada",
        statusLabel: "Atrasada",
        statusVariant: "error" as const,
        previewText: "Uma calibração está atrasada",
      };
  }
};

export function JobNotificationEmail({
  recipientName = "Usuário",
  type = "submitted",
  jobId = "OS-2024-0001",
  message = "Uma atualização foi feita na sua ordem de serviço.",
  actorName,
  reason,
  actionUrl = "#",
  logoSrc,
  brand,
}: JobNotificationEmailProps) {
  const config = getTypeConfig(type);

  return (
    <EmailLayout
      previewText={`${config.previewText} - ${jobId}`}
      logoSrc={logoSrc}
      brand={brand}
    >
      <EmailCard logoSrc={logoSrc} brand={brand}>
        <Eyebrow>Fluxo operacional</Eyebrow>
        <Title>{config.title}</Title>

        <Paragraph>Olá, {recipientName},</Paragraph>
        <Paragraph>{message}</Paragraph>

        <DetailBox>
          <span className="mb-2 block font-sans text-[11px] font-bold uppercase leading-[1.5] tracking-[0.08em] text-fg-3">
            Ordem de serviço
          </span>
          <HighlightValue>{jobId}</HighlightValue>
        </DetailBox>

        <StatusBox variant={config.statusVariant}>
          <strong>Status:</strong> {config.statusLabel}
          {actorName && (
            <>
              {" "}
              por <strong>{actorName}</strong>
            </>
          )}
        </StatusBox>

        {type === "rejected" && reason && (
          <StatusBox variant="error">
            <strong>Motivo da rejeição:</strong> {reason}
          </StatusBox>
        )}

        <ActionButton href={actionUrl}>Ver detalhes</ActionButton>
        <LinkFallback url={actionUrl} />
      </EmailCard>
    </EmailLayout>
  );
}

export default JobNotificationEmail;
