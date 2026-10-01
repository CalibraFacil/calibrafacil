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

interface AuditPackReadyEmailProps {
  recipientName: string;
  customerName?: string;
  periodLabel?: string;
  certificateCount?: number;
  expiresAtLabel?: string;
  portalUrl: string;
  logoSrc?: string;
  brand?: EmailBrand;
}

export function AuditPackReadyEmail({
  recipientName = "Usuário",
  customerName,
  periodLabel = "últimos 12 meses",
  certificateCount = 0,
  expiresAtLabel,
  portalUrl = "https://app.example.com/portal/certificates",
  logoSrc,
  brand,
}: AuditPackReadyEmailProps) {
  const previewText = `Pacote de auditoria pronto para download`;

  return (
    <EmailLayout previewText={previewText} logoSrc={logoSrc} brand={brand}>
      <EmailCard logoSrc={logoSrc} brand={brand}>
        <Eyebrow>Pacote de auditoria</Eyebrow>
        <Title>Pacote de auditoria disponível</Title>

        <Paragraph>Olá, {recipientName},</Paragraph>
        <Paragraph>
          O pacote de auditoria solicitado foi gerado e está pronto para
          download no Portal do Cliente.
        </Paragraph>

        <DetailBox>
          <DetailRow
            label="Período"
            value={<HighlightValue>{periodLabel}</HighlightValue>}
          />
          {customerName && <DetailRow label="Cliente" value={customerName} />}
          <DetailRow label="Certificados" value={String(certificateCount)} />
          {expiresAtLabel && (
            <DetailRow label="Disponível até" value={expiresAtLabel} />
          )}
        </DetailBox>

        <StatusBox variant="success">
          O arquivo ZIP contém os certificados do período, o relatório de
          situação da frota e o índice com links de verificação.
        </StatusBox>

        <ActionButton href={portalUrl}>Baixar pacote</ActionButton>
        <LinkFallback url={portalUrl} />
      </EmailCard>
    </EmailLayout>
  );
}

export default AuditPackReadyEmail;
