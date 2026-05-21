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

interface PasswordResetEmailProps {
  recipientName?: string;
  resetUrl: string;
  logoSrc?: string;
}

export function PasswordResetEmail({
  recipientName = "usuário",
  resetUrl = "https://calibrafacil.com/reset-password",
  logoSrc,
}: PasswordResetEmailProps) {
  return (
    <EmailLayout previewText="Defina sua senha no CalibraFácil" logoSrc={logoSrc}>
      <EmailCard logoSrc={logoSrc}>
        <Title>Defina sua senha</Title>

        <Paragraph>Olá, {recipientName},</Paragraph>
        <Paragraph>
          Recebemos uma solicitação para definir ou redefinir a sua senha no
          CalibraFácil.
        </Paragraph>

        <ActionButton href={resetUrl}>Definir senha</ActionButton>
        <LinkFallback url={resetUrl} />

        <StatusBox variant="info">
          Se você não esperava este email, pode ignorar esta mensagem.
        </StatusBox>
      </EmailCard>
    </EmailLayout>
  );
}

PasswordResetEmail.PreviewProps = {
  recipientName: "Ana",
  resetUrl: "https://calibrafacil.com/reset-password?token=abc",
} satisfies PasswordResetEmailProps;

export default PasswordResetEmail;
