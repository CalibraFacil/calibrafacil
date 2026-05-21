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

interface PortalMagicLinkEmailProps {
  recipientName?: string;
  magicLinkUrl: string;
  logoSrc?: string;
}

export function PortalMagicLinkEmail({
  recipientName = "usuário",
  magicLinkUrl = "https://calibrafacil.com/portal/sign-in",
  logoSrc,
}: PortalMagicLinkEmailProps) {
  return (
    <EmailLayout previewText="Acesse o Portal CalibraFácil" logoSrc={logoSrc}>
      <EmailCard logoSrc={logoSrc}>
        <Title>Acesse o Portal CalibraFácil</Title>

        <Paragraph>Olá, {recipientName},</Paragraph>
        <Paragraph>Use o link abaixo para entrar no portal do cliente.</Paragraph>

        <ActionButton href={magicLinkUrl}>Entrar no portal</ActionButton>
        <LinkFallback url={magicLinkUrl} />

        <StatusBox variant="info">
          Este link expira em poucos minutos. Se você não solicitou acesso, pode
          ignorar esta mensagem.
        </StatusBox>
      </EmailCard>
    </EmailLayout>
  );
}

PortalMagicLinkEmail.PreviewProps = {
  recipientName: "Ana",
  magicLinkUrl: "https://calibrafacil.com/portal/sign-in?token=abc",
} satisfies PortalMagicLinkEmailProps;

export default PortalMagicLinkEmail;
