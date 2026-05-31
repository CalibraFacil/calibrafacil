/** @jsxRuntime automatic */
/** @jsxImportSource react */
import {
  ActionButton,
  DetailBox,
  DetailRow,
  EmailCard,
  EmailLayout,
  HighlightValue,
  LinkFallback,
  Paragraph,
  StatusBox,
  Title,
  Eyebrow,
  type EmailBrand,
} from "./components/email-layout";

interface CertificateReadyEmailProps {
  recipientName: string;
  jobId: string;
  assetName?: string;
  customerName?: string;
  portalUrl: string;
  logoSrc?: string;
  brand?: EmailBrand;
}

export function CertificateReadyEmail({
  recipientName = "Usuário",
  jobId = "CAL-2024-0001",
  assetName = "Instrumento",
  customerName,
  portalUrl = "https://calibrafacil.com/portal/certificates",
  logoSrc,
  brand,
}: CertificateReadyEmailProps) {
  const previewText = `Certificado de calibração ${jobId} disponível para download`;

  return (
    <EmailLayout previewText={previewText} logoSrc={logoSrc} brand={brand}>
      <EmailCard logoSrc={logoSrc} brand={brand}>
        <Eyebrow>Certificado emitido</Eyebrow>
        <Title>Certificado disponível</Title>

        <Paragraph>Olá, {recipientName},</Paragraph>
        <Paragraph>
          O certificado de calibração está pronto para download no Portal do
          Cliente.
        </Paragraph>

        <DetailBox>
          <DetailRow
            label="Ordem de serviço"
            value={<HighlightValue>{jobId}</HighlightValue>}
          />
          {assetName && <DetailRow label="Instrumento" value={assetName} />}
          {customerName && <DetailRow label="Cliente" value={customerName} />}
        </DetailBox>

        <StatusBox variant="success">
          O certificado está disponível para download no Portal do Cliente.
        </StatusBox>

        <ActionButton href={portalUrl}>Acessar portal</ActionButton>
        <LinkFallback url={portalUrl} />
      </EmailCard>
    </EmailLayout>
  );
}

export default CertificateReadyEmail;
