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

interface AssetOotEmailProps {
  recipientName: string;
  assetTag: string;
  assetName?: string;
  jobId: string;
  portalUrl: string;
  logoSrc?: string;
  brand?: EmailBrand;
}

/**
 * Customer-facing alert (#740 Track B): the customer's own instrument was
 * reproved in the as-found ("como recebido") condition. The impact assessment
 * is the CUSTOMER'S obligation (ISO 9001:2015 §7.1.5.2) — the copy frames the
 * portal as the workspace for recording it, never as the lab assuming it.
 */
export function AssetOotEmail({
  recipientName = "Usuário",
  assetTag = "EQ-0001",
  assetName,
  jobId = "CAL-2024-0001",
  portalUrl = "https://app.example.com/portal",
  logoSrc,
  brand,
}: AssetOotEmailProps) {
  const previewText = `Ação requerida: equipamento ${assetTag} reprovado na condição como recebido`;
  return (
    <EmailLayout previewText={previewText} logoSrc={logoSrc} brand={brand}>
      <EmailCard logoSrc={logoSrc} brand={brand}>
        <Eyebrow>Ação requerida</Eyebrow>
        <Title>Equipamento reprovado na condição "como recebido"</Title>
        <Paragraph>Olá, {recipientName},</Paragraph>
        <Paragraph>
          O equipamento abaixo foi reprovado na condição "como recebido" durante
          a calibração, conforme a regra de decisão aplicada pelo laboratório no
          certificado.
        </Paragraph>
        <DetailBox>
          <DetailRow
            label="Equipamento"
            value={<HighlightValue>{assetTag}</HighlightValue>}
          />
          {assetName && <DetailRow label="Descrição" value={assetName} />}
          <DetailRow label="Calibração" value={jobId} />
        </DetailBox>
        <StatusBox variant="warning">
          Recomendamos avaliar se a validade de resultados de medição anteriores
          foi afetada e tomar as ações apropriadas. Registre a avaliação de
          impacto no Portal do Cliente.
        </StatusBox>
        <ActionButton href={portalUrl}>Avaliar impacto no portal</ActionButton>
        <LinkFallback url={portalUrl} />
      </EmailCard>
    </EmailLayout>
  );
}

export default AssetOotEmail;
