/** @jsxImportSource react */
import { EmailLayout, styles, theme } from "./components/email-layout";

type ComplianceAlertType = "asset" | "standard";

export interface ComplianceAlertEmailProps {
  recipientName: string;
  type: ComplianceAlertType;
  itemName: string;
  dueDate: string;
  daysRemaining: number;
  actionUrl: string;
}

const getTypeConfig = (type: ComplianceAlertType) => {
  switch (type) {
    case "asset":
      return {
        title: "Ativo Vencendo Calibracao",
        previewText: "Um ativo esta proximo da data de recalibracao",
        itemLabel: "Instrumento",
        actionLabel: "Ver Ativo",
      };
    case "standard":
      return {
        title: "Padrao de Referencia Vencendo",
        previewText: "Um padrao de referencia esta proximo do vencimento",
        itemLabel: "Padrao de Referencia",
        actionLabel: "Ver Padrao",
      };
  }
};

const getUrgencyStyle = (daysRemaining: number) => {
  if (daysRemaining <= 3) {
    return {
      backgroundColor: theme.colors.errorBg,
      borderColor: theme.colors.errorBorder,
      textColor: theme.colors.errorText,
      label: "Urgente",
    };
  } else if (daysRemaining <= 7) {
    return {
      backgroundColor: theme.colors.warningBg,
      borderColor: theme.colors.warningBorder,
      textColor: theme.colors.warningText,
      label: "Atencao",
    };
  } else {
    return {
      backgroundColor: theme.colors.infoBg,
      borderColor: theme.colors.infoBorder,
      textColor: theme.colors.infoText,
      label: "Lembrete",
    };
  }
};

export function ComplianceAlertEmail({
  recipientName = "Usuario",
  type = "asset",
  itemName = "Instrumento de Teste",
  dueDate = "01/02/2024",
  daysRemaining = 7,
  actionUrl = "#",
}: ComplianceAlertEmailProps) {
  const config = getTypeConfig(type);
  const urgency = getUrgencyStyle(daysRemaining);

  return (
    <EmailLayout
      previewText={`${config.previewText} - ${itemName}`}
      footerNote="Manter os equipamentos e padroes em dia e essencial para a conformidade ISO/IEC 17025:2017."
    >
      <div style={styles.body}>
        {/* Urgency Badge */}
        <div
          style={{
            display: "inline-block",
            backgroundColor: urgency.backgroundColor,
            color: urgency.textColor,
            padding: "8px 16px",
            borderRadius: "20px",
            fontSize: "12px",
            fontWeight: "600",
            textTransform: "uppercase" as const,
            letterSpacing: "0.05em",
            marginBottom: "16px",
          }}
        >
          {urgency.label}
        </div>

        <h1 style={styles.title}>{config.title}</h1>

        <p style={styles.paragraph}>Ola {recipientName},</p>

        <p style={styles.paragraph}>
          {type === "asset"
            ? "Um instrumento sob sua responsabilidade esta proximo da data de recalibracao."
            : "Um padrao de referencia do seu laboratorio esta proximo da data de vencimento."}
        </p>

        {/* Item Details Box */}
        <div
          style={{
            backgroundColor: theme.colors.codeBg,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: "8px",
            padding: "24px",
            marginBottom: "24px",
            textAlign: "left" as const,
          }}
        >
          <div style={{ marginBottom: "16px" }}>
            <span
              style={{
                display: "block",
                fontSize: "12px",
                color: theme.colors.secondaryText,
                fontWeight: "600",
                textTransform: "uppercase" as const,
                letterSpacing: "0.05em",
                marginBottom: "4px",
              }}
            >
              {config.itemLabel}
            </span>
            <span
              style={{
                fontSize: "16px",
                color: theme.colors.primaryText,
                fontWeight: "600",
              }}
            >
              {itemName}
            </span>
          </div>

          <div style={{ marginBottom: "16px" }}>
            <span
              style={{
                display: "block",
                fontSize: "12px",
                color: theme.colors.secondaryText,
                fontWeight: "600",
                textTransform: "uppercase" as const,
                letterSpacing: "0.05em",
                marginBottom: "4px",
              }}
            >
              Data de Vencimento
            </span>
            <span
              style={{
                fontSize: "16px",
                color: theme.colors.primaryText,
                fontWeight: "600",
              }}
            >
              {dueDate}
            </span>
          </div>

          <div>
            <span
              style={{
                display: "block",
                fontSize: "12px",
                color: theme.colors.secondaryText,
                fontWeight: "600",
                textTransform: "uppercase" as const,
                letterSpacing: "0.05em",
                marginBottom: "4px",
              }}
            >
              Dias Restantes
            </span>
            <span
              style={{
                fontSize: "24px",
                color: urgency.textColor,
                fontWeight: "700",
              }}
            >
              {daysRemaining} {daysRemaining === 1 ? "dia" : "dias"}
            </span>
          </div>
        </div>

        {/* Warning Box */}
        <div
          style={{
            backgroundColor: urgency.backgroundColor,
            border: `1px solid ${urgency.borderColor}`,
            borderRadius: "8px",
            padding: "16px",
            marginBottom: "32px",
          }}
        >
          <p
            style={{
              fontSize: "14px",
              color: urgency.textColor,
              margin: "0",
              lineHeight: "1.5",
            }}
          >
            <strong>Lembrete:</strong>{" "}
            {type === "asset"
              ? "Instrumentos com calibracao vencida nao podem ser utilizados em medicoes rastreadas."
              : "Padroes vencidos comprometem a rastreabilidade das calibracoes realizadas."}
          </p>
        </div>

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

export default ComplianceAlertEmail;
