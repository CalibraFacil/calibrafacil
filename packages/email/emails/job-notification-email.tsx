/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { EmailLayout, StatusBox, styles, theme } from "./components/email-layout";

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
}

const getTypeConfig = (type: JobNotificationType) => {
  switch (type) {
    case "submitted":
      return {
        title: "Calibracao Aguardando Revisao",
        statusLabel: "Aguardando Revisao",
        statusVariant: "warning" as const,
        previewText: "Uma calibracao foi submetida para revisao",
      };
    case "approved":
      return {
        title: "Calibracao Aprovada",
        statusLabel: "Aprovada",
        statusVariant: "success" as const,
        previewText: "Sua calibracao foi aprovada",
      };
    case "rejected":
      return {
        title: "Calibracao Rejeitada",
        statusLabel: "Rejeitada",
        statusVariant: "error" as const,
        previewText: "Sua calibracao foi rejeitada",
      };
    case "assigned":
      return {
        title: "Nova Calibracao Atribuida",
        statusLabel: "Atribuida",
        statusVariant: "info" as const,
        previewText: "Uma nova calibracao foi atribuida a voce",
      };
    case "overdue":
      return {
        title: "Calibracao Atrasada",
        statusLabel: "Atrasada",
        statusVariant: "error" as const,
        previewText: "Uma calibracao esta atrasada",
      };
  }
};

export function JobNotificationEmail({
  recipientName = "Usuario",
  type = "submitted",
  jobId = "OS-2024-0001",
  message = "Uma atualizacao foi feita na sua ordem de servico.",
  actorName,
  reason,
  actionUrl = "#",
}: JobNotificationEmailProps) {
  const config = getTypeConfig(type);

  return (
    <EmailLayout previewText={`${config.previewText} - ${jobId}`}>
      <div style={styles.body}>
        <h1 style={styles.title}>{config.title}</h1>

        <p style={styles.paragraph}>Ola {recipientName},</p>

        <p style={styles.paragraph}>{message}</p>

        {/* Job ID Highlight Box */}
        <div style={styles.highlightBox}>
          <span style={styles.highlightLabel}>Ordem de Servico</span>
          <div style={styles.highlightValue}>{jobId}</div>
        </div>

        {/* Status indicator */}
        <StatusBox variant={config.statusVariant}>
          <strong>Status:</strong> {config.statusLabel}
          {actorName && (
            <>
              {" "}
              - por <strong>{actorName}</strong>
            </>
          )}
        </StatusBox>

        {/* Rejection reason if provided */}
        {type === "rejected" && reason && (
          <div
            style={{
              backgroundColor: theme.colors.errorBg,
              border: `1px solid ${theme.colors.errorBorder}`,
              borderRadius: "8px",
              padding: "16px",
              marginBottom: "24px",
              textAlign: "left" as const,
            }}
          >
            <p
              style={{
                fontSize: "12px",
                color: theme.colors.errorText,
                fontWeight: "600",
                textTransform: "uppercase" as const,
                letterSpacing: "0.05em",
                margin: "0 0 8px",
              }}
            >
              Motivo da Rejeicao
            </p>
            <p
              style={{
                fontSize: "14px",
                color: theme.colors.errorText,
                margin: "0",
                lineHeight: "1.5",
              }}
            >
              {reason}
            </p>
          </div>
        )}

        {/* Action Button */}
        <a href={actionUrl} style={styles.button}>
          Ver Detalhes
        </a>

        <p
          style={{
            ...styles.paragraph,
            marginTop: "24px",
            marginBottom: "0",
            fontSize: "13px",
          }}
        >
          Caso o botao nao funcione, copie e cole o link abaixo no navegador:
        </p>
        <p
          style={{
            fontSize: "11px",
            color: "#94a3b8",
            wordBreak: "break-all" as const,
            margin: "8px 0 0",
          }}
        >
          {actionUrl}
        </p>
      </div>
    </EmailLayout>
  );
}

export default JobNotificationEmail;
