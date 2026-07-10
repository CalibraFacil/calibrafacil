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

export interface OotNotificationEmailProps {
  recipientName: string;
  labName: string;
  ncNumber: string;
  instrumentDescription: string;
  certificateNumber?: string;
  ackUrl: string;
  logoSrc?: string;
  brand?: EmailBrand;
}

export function OotNotificationEmail({
  recipientName = "Cliente",
  labName = "Laboratório",
  ncNumber = "NC-2026-0001",
  instrumentDescription = "Instrumento de medição",
  certificateNumber,
  ackUrl = "#",
  logoSrc,
  brand,
}: OotNotificationEmailProps) {
  return (
    <EmailLayout
      previewText={`Notificação de resultado fora de tolerância - ${ncNumber}`}
      logoSrc={logoSrc}
      brand={brand}
    >
      <EmailCard logoSrc={logoSrc} brand={brand}>
        <Badge variant="warning">ISO/IEC 17025</Badge>
        <Title>Notificação de resultado fora de tolerância</Title>

        <Paragraph>Olá, {recipientName},</Paragraph>
        <Paragraph>
          Durante a calibração do instrumento identificado abaixo, a condição
          &quot;como encontrado&quot; (as found) apresentou resultado fora da
          tolerância especificada. Em atendimento à ABNT NBR ISO/IEC 17025, item
          7.10, o laboratório {labName} comunica formalmente esta ocorrência
          para que você possa avaliar o impacto sobre as medições realizadas
          desde a última calibração válida. Segue anexa a notificação formal em
          PDF.
        </Paragraph>

        <DetailBox tone="warning">
          <DetailRow
            label="Não conformidade"
            value={<HighlightValue tone="warning">{ncNumber}</HighlightValue>}
          />
          <DetailRow label="Instrumento" value={instrumentDescription} />
          {certificateNumber && (
            <DetailRow label="Certificado" value={certificateNumber} />
          )}
        </DetailBox>

        <StatusBox variant="warning">
          <strong>Recomendação:</strong> avalie as medições que possam ter sido
          afetadas no período e, em caso de dúvidas, entre em contato com o
          laboratório para suporte na análise de impacto.
        </StatusBox>

        <ActionButton href={ackUrl}>Confirmar recebimento</ActionButton>
        <LinkFallback url={ackUrl} />

        <Paragraph>
          A confirmação registra apenas o recebimento desta notificação e não
          implica qualquer avaliação ou aceite quanto ao impacto nos resultados
          de medição.
        </Paragraph>
      </EmailCard>
    </EmailLayout>
  );
}

OotNotificationEmail.PreviewProps = {
  recipientName: "Ana",
  labName: "Metrologia Precisa Ltda.",
  ncNumber: "NC-2026-0042",
  instrumentDescription: "Paquímetro digital 0–150 mm (TAG PQ-014)",
  certificateNumber: "CERT-2026-0318",
  ackUrl: "https://calibrafacil.com/ack/oot/exemplo",
} satisfies OotNotificationEmailProps;

export default OotNotificationEmail;
