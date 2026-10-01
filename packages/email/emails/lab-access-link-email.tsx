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

interface LabAccessLinkEmailProps {
  recipientName?: string;
  accessUrl: string;
  organizationName?: string;
  logoSrc?: string;
  brand?: EmailBrand;
}

export function LabAccessLinkEmail({
  recipientName = "usuário",
  accessUrl = "https://app.example.com/claim-account",
  organizationName = "seu laboratório",
  logoSrc,
  brand,
}: LabAccessLinkEmailProps) {
  return (
    <EmailLayout
      previewText="Configure seu acesso ao CalibraFácil"
      logoSrc={logoSrc}
      brand={brand}
    >
      <EmailCard logoSrc={logoSrc} brand={brand}>
        <Title>Configure seu acesso</Title>

        <Paragraph>Olá, {recipientName},</Paragraph>
        <Paragraph>
          Use o link abaixo para reivindicar seu acesso a {organizationName} no
          CalibraFácil.
        </Paragraph>

        <ActionButton href={accessUrl}>Configurar acesso</ActionButton>
        <LinkFallback url={accessUrl} />

        <StatusBox variant="info">
          Este link expira em poucos dias. Se você não esperava este convite,
          pode ignorar esta mensagem.
        </StatusBox>
      </EmailCard>
    </EmailLayout>
  );
}

LabAccessLinkEmail.PreviewProps = {
  recipientName: "Ana",
  organizationName: "Laboratório Exemplo",
  accessUrl: "https://app.example.com/claim-account?token=abc",
} satisfies LabAccessLinkEmailProps;

export default LabAccessLinkEmail;
