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
} from "./components/email-layout";

interface EmailConfirmationEmailProps {
  recipientName?: string;
  confirmationUrl: string;
  logoSrc?: string;
}

export function EmailConfirmationEmail({
  recipientName = "usuário",
  confirmationUrl = "https://calibrafacil.com/confirm-email",
  logoSrc,
}: EmailConfirmationEmailProps) {
  return (
    <EmailLayout
      previewText="Confirme seu e-mail no CalibraFácil"
      logoSrc={logoSrc}
    >
      <EmailCard logoSrc={logoSrc}>
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
  confirmationUrl: "https://calibrafacil.com/confirm-email?token=abc",
} satisfies EmailConfirmationEmailProps;

export default EmailConfirmationEmail;
