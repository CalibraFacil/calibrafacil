/** @jsxRuntime automatic */
/** @jsxImportSource react */
import {
  ActionButton,
  EmailCard,
  EmailLayout,
  LinkFallback,
  Paragraph,
  StatusBox,
  Title,
  type EmailBrand,
} from "./components/email-layout";

interface EmailConfirmationEmailProps {
  recipientName?: string;
  confirmationUrl: string;
  logoSrc?: string;
  brand?: EmailBrand;
}

export function EmailConfirmationEmail({
  recipientName = "usuário",
  confirmationUrl = "https://app.example.com/confirm-email",
  logoSrc,
  brand,
}: EmailConfirmationEmailProps) {
  return (
    <EmailLayout
      previewText="Confirme seu e-mail no CalibraFácil"
      logoSrc={logoSrc}
      brand={brand}
    >
      <EmailCard logoSrc={logoSrc} brand={brand}>
        <Title>Confirme seu e-mail</Title>

        <Paragraph>Olá, {recipientName},</Paragraph>
        <Paragraph>
          Para finalizar seu acesso ao CalibraFácil, confirme que este endereço
          de e-mail pertence a você.
        </Paragraph>

        <ActionButton href={confirmationUrl}>Confirmar e-mail</ActionButton>
        <LinkFallback url={confirmationUrl} />

        <StatusBox variant="info">
          Se você não criou uma conta, pode ignorar esta mensagem.
        </StatusBox>
      </EmailCard>
    </EmailLayout>
  );
}

EmailConfirmationEmail.PreviewProps = {
  recipientName: "Ana",
  confirmationUrl: "https://app.example.com/confirm-email?token=abc",
} satisfies EmailConfirmationEmailProps;

export default EmailConfirmationEmail;
