/** @jsxImportSource react */
import { EmailLayout, styles, theme } from "./components/email-layout";

type PaymentNotificationType = "received" | "failed";

export interface PaymentNotificationEmailProps {
  recipientName: string;
  type: PaymentNotificationType;
  amount?: string;
  description?: string;
  actionUrl?: string;
}

const getTypeConfig = (type: PaymentNotificationType) => {
  switch (type) {
    case "received":
      return {
        title: "Pagamento Confirmado",
        previewText: "Seu pagamento foi recebido com sucesso",
        statusIcon: "checkmark" as const,
        statusColor: theme.colors.successText,
        statusBg: theme.colors.successBg,
        statusBorder: theme.colors.successBorder,
        message: "Recebemos e confirmamos seu pagamento.",
        actionLabel: "Ver Detalhes",
      };
    case "failed":
      return {
        title: "Pagamento Nao Processado",
        previewText: "Houve um problema com seu pagamento",
        statusIcon: "error" as const,
        statusColor: theme.colors.errorText,
        statusBg: theme.colors.errorBg,
        statusBorder: theme.colors.errorBorder,
        message:
          "Infelizmente nao foi possivel processar seu pagamento. Por favor, verifique os dados ou tente novamente.",
        actionLabel: "Tentar Novamente",
      };
  }
};

export function PaymentNotificationEmail({
  recipientName = "Usuario",
  type = "received",
  amount,
  description,
  actionUrl,
}: PaymentNotificationEmailProps) {
  const config = getTypeConfig(type);

  return (
    <EmailLayout previewText={config.previewText}>
      <div style={styles.body}>
        {/* Status Icon Circle */}
        <div
          style={{
            width: "64px",
            height: "64px",
            backgroundColor: config.statusBg,
            borderRadius: "50%",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: "24px",
          }}
        >
          <span style={{ fontSize: "32px" }}>
            {config.statusIcon === "checkmark" ? "\u2713" : "\u2717"}
          </span>
        </div>

        <h1 style={styles.title}>{config.title}</h1>

        <p style={styles.paragraph}>Ola {recipientName},</p>

        <p style={styles.paragraph}>{config.message}</p>

        {/* Payment Details Box (if amount provided) */}
        {amount && (
          <div
            style={{
              backgroundColor: theme.colors.codeBg,
              border: `1px solid ${theme.colors.border}`,
              borderRadius: "8px",
              padding: "24px",
              marginBottom: "24px",
            }}
          >
            <span
              style={{
                display: "block",
                fontSize: "12px",
                color: theme.colors.secondaryText,
                fontWeight: "600",
                textTransform: "uppercase" as const,
                letterSpacing: "0.05em",
                marginBottom: "8px",
              }}
            >
              Valor
            </span>
            <span
              style={{
                fontSize: "28px",
                color:
                  type === "received"
                    ? theme.colors.successText
                    : theme.colors.primaryText,
                fontWeight: "700",
              }}
            >
              {amount}
            </span>
            {description && (
              <p
                style={{
                  fontSize: "14px",
                  color: theme.colors.secondaryText,
                  margin: "12px 0 0",
                }}
              >
                {description}
              </p>
            )}
          </div>
        )}

        {/* Status Box */}
        <div
          style={{
            backgroundColor: config.statusBg,
            border: `1px solid ${config.statusBorder}`,
            borderRadius: "8px",
            padding: "16px",
            marginBottom: "32px",
          }}
        >
          <p
            style={{
              fontSize: "14px",
              color: config.statusColor,
              margin: "0",
              lineHeight: "1.5",
            }}
          >
            {type === "received" ? (
              <>
                <strong>Confirmado!</strong> O pagamento foi registrado em nosso
                sistema.
              </>
            ) : (
              <>
                <strong>Atencao:</strong> Se o problema persistir, entre em
                contato com nosso suporte.
              </>
            )}
          </p>
        </div>

        {/* Action Button */}
        {actionUrl && (
          <>
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
              Caso o botao nao funcione, copie e cole o link abaixo no
              navegador:
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
          </>
        )}
      </div>
    </EmailLayout>
  );
}

export default PaymentNotificationEmail;
