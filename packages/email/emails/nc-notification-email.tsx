/** @jsxRuntime automatic */
/** @jsxImportSource react */
import {
  EmailLayout,
  StatusBox,
  styles,
  theme,
} from "./components/email-layout";

type NCNotificationType = "created" | "escalated";

export interface NCNotificationEmailProps {
  recipientName: string;
  type: NCNotificationType;
  ncNumber: string;
  ncType?: "work" | "equipment" | "documentation";
  description?: string;
  capaNumber?: string;
  actorName?: string;
  actionUrl: string;
}

const getTypeConfig = (type: NCNotificationType) => {
  switch (type) {
    case "created":
      return {
        title: "Nova Nao Conformidade",
        statusLabel: "Registrada",
        statusVariant: "warning" as const,
        previewText: "Uma nao conformidade foi registrada",
        actionLabel: "Ver NC",
      };
    case "escalated":
      return {
        title: "NC Escalada para CAPA",
        statusLabel: "Escalada",
        statusVariant: "info" as const,
        previewText: "Uma nao conformidade foi escalada para CAPA",
        actionLabel: "Ver CAPA",
      };
  }
};

const getNCTypeLabel = (ncType: string | undefined): string => {
  switch (ncType) {
    case "work":
      return "Trabalho";
    case "equipment":
      return "Equipamento";
    case "documentation":
      return "Documentacao";
    default:
      return "";
  }
};

export function NCNotificationEmail({
  recipientName = "Usuario",
  type = "created",
  ncNumber = "NC-2024-0001",
  ncType,
  description,
  capaNumber,
  actorName,
  actionUrl = "#",
}: NCNotificationEmailProps) {
  const config = getTypeConfig(type);
  const ncTypeLabel = getNCTypeLabel(ncType);

  return (
    <EmailLayout
      previewText={`${config.previewText} - ${ncNumber}`}
      footerNote="ISO 17025:2017 Clausula 8.7 - Controle de Trabalho Nao Conforme"
    >
      <div style={styles.body}>
        {/* Icon */}
        <div
          style={{
            width: "64px",
            height: "64px",
            backgroundColor:
              type === "created" ? theme.colors.warningBg : theme.colors.infoBg,
            borderRadius: "50%",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: "24px",
          }}
        >
          <span style={{ fontSize: "32px" }}>
            {type === "created" ? "!" : "\u2197"}
          </span>
        </div>

        <h1 style={styles.title}>{config.title}</h1>

        <p style={styles.paragraph}>Ola {recipientName},</p>

        <p style={styles.paragraph}>
          {type === "created"
            ? `Uma nova nao conformidade foi registrada${actorName ? ` por ${actorName}` : ""}.`
            : `A nao conformidade ${ncNumber} foi escalada para uma acao corretiva (CAPA)${actorName ? ` por ${actorName}` : ""}.`}
        </p>

        {/* NC Number Highlight Box */}
        <div style={styles.highlightBox}>
          <span style={styles.highlightLabel}>Nao Conformidade</span>
          <div style={styles.highlightValue}>{ncNumber}</div>
          {ncTypeLabel && (
            <span
              style={{
                display: "inline-block",
                marginTop: "12px",
                padding: "4px 12px",
                backgroundColor: theme.colors.warningBg,
                border: `1px solid ${theme.colors.warningBorder}`,
                borderRadius: "12px",
                fontSize: "12px",
                fontWeight: "600",
                color: theme.colors.warningText,
              }}
            >
              {ncTypeLabel}
            </span>
          )}
        </div>

        {/* CAPA Number for escalated */}
        {type === "escalated" && capaNumber && (
          <div
            style={{
              ...styles.highlightBox,
              backgroundColor: theme.colors.infoBg,
              border: `1px solid ${theme.colors.infoBorder}`,
            }}
          >
            <span
              style={{
                ...styles.highlightLabel,
                color: theme.colors.infoText,
              }}
            >
              CAPA Criada
            </span>
            <div
              style={{
                ...styles.highlightValue,
                color: theme.colors.infoText,
              }}
            >
              {capaNumber}
            </div>
          </div>
        )}

        {/* Description */}
        {description && (
          <div
            style={{
              backgroundColor: theme.colors.codeBg,
              border: `1px solid ${theme.colors.border}`,
              borderRadius: "8px",
              padding: "16px",
              marginBottom: "24px",
              textAlign: "left" as const,
            }}
          >
            <p
              style={{
                fontSize: "12px",
                color: theme.colors.secondaryText,
                fontWeight: "600",
                textTransform: "uppercase" as const,
                letterSpacing: "0.05em",
                margin: "0 0 8px",
              }}
            >
              Descricao
            </p>
            <p
              style={{
                fontSize: "14px",
                color: theme.colors.primaryText,
                margin: "0",
                lineHeight: "1.5",
              }}
            >
              {description.length > 200
                ? `${description.slice(0, 200)}...`
                : description}
            </p>
          </div>
        )}

        {/* Status indicator */}
        <StatusBox variant={config.statusVariant}>
          <strong>Status:</strong> {config.statusLabel}
        </StatusBox>

        {/* Action Button */}
        <a href={actionUrl} style={styles.button}>
          {config.actionLabel}
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

export default NCNotificationEmail;
