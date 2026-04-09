/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { EmailLayout, StatusBox, styles, theme } from "./components/email-layout";

type NotificationVariant = "default" | "success" | "warning" | "error" | "info";

interface NotificationEmailProps {
  recipientName: string;
  title: string;
  message: string;
  actionUrl?: string;
  actionLabel?: string;
  footer?: string;
  variant?: NotificationVariant;
}

export function NotificationEmail({
  recipientName = "Usuario",
  title = "Notificacao do CalibraFacil",
  message = "Voce tem uma nova notificacao.",
  actionUrl,
  actionLabel = "Ver Detalhes",
  footer,
  variant = "default",
}: NotificationEmailProps) {
  const previewText = title;

  return (
    <EmailLayout previewText={previewText} footerNote={footer}>
      <div style={styles.body}>
        <h1 style={styles.title}>{title}</h1>

        <p style={styles.paragraph}>Ola {recipientName},</p>

        {variant !== "default" ? (
          <StatusBox variant={variant}>
            {message}
          </StatusBox>
        ) : (
          <p style={styles.paragraph}>{message}</p>
        )}

        {actionUrl && (
          <>
            <a href={actionUrl} style={styles.button}>
              {actionLabel}
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

export default NotificationEmail;
