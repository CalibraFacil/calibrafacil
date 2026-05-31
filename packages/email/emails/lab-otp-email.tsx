/** @jsxRuntime automatic */
/** @jsxImportSource react */
import {
  DetailBox,
  EmailCard,
  EmailLayout,
  HighlightValue,
  Paragraph,
  StatusBox,
  Title,
  type EmailBrand,
} from "./components/email-layout";

interface LabOtpEmailProps {
  recipientName?: string;
  otp: string;
  logoSrc?: string;
  brand?: EmailBrand;
}

export function LabOtpEmail({
  recipientName = "usuário",
  otp = "123456",
  logoSrc,
  brand,
}: LabOtpEmailProps) {
  return (
    <EmailLayout
      previewText="Seu código de acesso ao CalibraFácil"
      logoSrc={logoSrc}
      brand={brand}
    >
      <EmailCard logoSrc={logoSrc} brand={brand}>
        <Title>Código de acesso</Title>

        <Paragraph>Olá, {recipientName},</Paragraph>
        <Paragraph>
          Use o código abaixo para entrar no dashboard LAB do CalibraFácil.
        </Paragraph>

        <DetailBox>
          <HighlightValue>{otp}</HighlightValue>
        </DetailBox>

        <StatusBox variant="info">
          Este código expira em poucos minutos. Se você não solicitou acesso,
          pode ignorar esta mensagem.
        </StatusBox>
      </EmailCard>
    </EmailLayout>
  );
}

LabOtpEmail.PreviewProps = {
  recipientName: "Ana",
  otp: "123456",
} satisfies LabOtpEmailProps;

export default LabOtpEmail;
