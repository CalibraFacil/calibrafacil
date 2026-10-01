/** @jsxRuntime automatic */
/** @jsxImportSource react */
import {
  ActionButton,
  Badge,
  DetailBox,
  DetailRow,
  EmailCard,
  EmailLayout,
  HighlightValue,
  LinkFallback,
  Paragraph,
  StatusBox,
  Title,
  type EmailBrand,
} from "./components/email-layout";

interface CertificateAmendedEmailProps {
  recipientName: string;
  originalJobId: string;
  amendedJobId: string;
  assetName?: string;
  customerName?: string;
  reason: string;
  actionUrl: string;
  logoSrc?: string;
  brand?: EmailBrand;
}

export function CertificateAmendedEmail({
  recipientName = "Usuário",
  originalJobId = "CAL-2024-0001",
  amendedJobId = "CAL-2024-0001-R1",
  assetName,
  customerName,
  reason = "Correção de dados do certificado",
  actionUrl = "https://app.example.com/portal/certificates",
  logoSrc,
  brand,
}: CertificateAmendedEmailProps) {
  return (
    <EmailLayout
      previewText={`Certificado ${originalJobId} retificado`}
      logoSrc={logoSrc}
      brand={brand}
    >
      <EmailCard logoSrc={logoSrc} brand={brand}>
        <Badge variant="warning">Retificado</Badge>
        <Title>Certificado retificado</Title>

        <Paragraph>Olá, {recipientName},</Paragraph>
        <Paragraph>
          Um certificado de calibração foi retificado. A versão anterior foi
          substituída pela nova emissão abaixo.
        </Paragraph>

        <DetailBox>
          <DetailRow label="Certificado anterior" value={originalJobId} />
          <DetailRow
            label="Novo certificado"
            value={
              <HighlightValue tone="warning">{amendedJobId}</HighlightValue>
            }
          />
          {assetName && <DetailRow label="Instrumento" value={assetName} />}
          {customerName && <DetailRow label="Cliente" value={customerName} />}
          <DetailRow label="Motivo" value={reason} />
        </DetailBox>

        <StatusBox variant="warning">
          Use a versão retificada como referência a partir de agora.
        </StatusBox>

        <ActionButton href={actionUrl}>Ver certificado</ActionButton>
        <LinkFallback url={actionUrl} />
      </EmailCard>
    </EmailLayout>
  );
}

CertificateAmendedEmail.PreviewProps = {
  recipientName: "Ana",
  originalJobId: "CAL-2026-0012",
  amendedJobId: "CAL-2026-0012-R1",
  assetName: "Balança analítica",
  customerName: "ACME Laboratórios",
  reason: "Correção da identificação do instrumento.",
  // Deep link to the superseded certificate's detail page (#744).
  actionUrl: "https://portal.example.com/certificates/CAL-2026-0012",
} satisfies CertificateAmendedEmailProps;

export default CertificateAmendedEmail;
