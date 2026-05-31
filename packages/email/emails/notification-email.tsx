/** @jsxRuntime automatic */
/** @jsxImportSource react */
import {
  ActionButton,
  EmailCard,
  EmailLayout,
  Eyebrow,
  LinkFallback,
  Paragraph,
  StatusBox,
  Title,
  type EmailBrand,
} from "./components/email-layout";

type NotificationVariant = "default" | "success" | "warning" | "error" | "info";

interface NotificationEmailProps {
  recipientName: string;
  title: string;
  message: string;
  actionUrl?: string;
  actionLabel?: string;
  footer?: string;
  variant?: NotificationVariant;
  logoSrc?: string;
  brand?: EmailBrand;
}

export function NotificationEmail({
  recipientName = "Usuário",
  title = "Notificação do CalibraFácil",
  message = "Você tem uma nova notificação.",
  actionUrl,
  actionLabel = "Ver detalhes",
  footer,
  variant = "default",
  logoSrc,
  brand,
}: NotificationEmailProps) {
  return (
    <EmailLayout
      previewText={title}
      footerNote={footer}
      logoSrc={logoSrc}
      brand={brand}
    >
      <EmailCard logoSrc={logoSrc} brand={brand}>
        <Eyebrow>Atualização</Eyebrow>
        <Title>{title}</Title>

        <Paragraph>Olá, {recipientName},</Paragraph>

        {variant !== "default" ? (
          <StatusBox variant={variant}>{message}</StatusBox>
        ) : (
          <Paragraph>{message}</Paragraph>
        )}

        {actionUrl && (
          <>
            <ActionButton href={actionUrl}>{actionLabel}</ActionButton>
            <LinkFallback url={actionUrl} />
          </>
        )}
      </EmailCard>
    </EmailLayout>
  );
}

export default NotificationEmail;
