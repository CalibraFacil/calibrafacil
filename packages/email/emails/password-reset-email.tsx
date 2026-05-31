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

interface PasswordResetEmailProps {
  recipientName?: string;
  resetUrl: string;
  logoSrc?: string;
  brand?: EmailBrand;
}

export function PasswordResetEmail({
  recipientName = "usuário",
  resetUrl = "https://calibrafacil.com/reset-password",
  logoSrc,
  brand,
}: PasswordResetEmailProps) {
  return (
    <EmailLayout
      previewText="Defina sua senha no CalibraFácil"
      logoSrc={logoSrc}
      brand={brand}
    >
      <EmailCard logoSrc={logoSrc} brand={brand}>
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
