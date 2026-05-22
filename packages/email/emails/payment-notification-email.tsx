/** @jsxRuntime automatic */
/** @jsxImportSource react */
import {
  ActionButton,
  DetailBox,
  DetailRow,
  EmailCard,
  EmailLayout,
  Eyebrow,
  HighlightValue,
  LinkFallback,
  Paragraph,
  StatusBox,
  Title,
} from "./components/email-layout";

type PaymentNotificationType = "received" | "failed";

export interface PaymentNotificationEmailProps {
  recipientName: string;
  type: PaymentNotificationType;
  amount?: string;
  description?: string;
  actionUrl?: string;
  logoSrc?: string;
}

const getTypeConfig = (type: PaymentNotificationType) => {
  switch (type) {
    case "received":
      return {
        title: "Pagamento confirmado",
        previewText: "Seu pagamento foi recebido com sucesso",
        message: "Recebemos e confirmamos seu pagamento.",
        actionLabel: "Ver detalhes",
        statusVariant: "success" as const,
      };
    case "failed":
      return {
        title: "Pagamento não processado",
        previewText: "Houve um problema com seu pagamento",
        message:
          "Não foi possível processar seu pagamento. Verifique os dados ou tente novamente.",
        actionLabel: "Tentar novamente",
        statusVariant: "error" as const,
      };
  }
};

export function PaymentNotificationEmail({
  recipientName = "Usuário",
  type = "received",
  amount,
  description,
  actionUrl,
  logoSrc,
}: PaymentNotificationEmailProps) {
  const config = getTypeConfig(type);

  return (
    <EmailLayout previewText={config.previewText} logoSrc={logoSrc}>
      <EmailCard logoSrc={logoSrc}>
        <Eyebrow>Financeiro</Eyebrow>
        <Title>{config.title}</Title>

        <Paragraph>Olá, {recipientName},</Paragraph>
        <Paragraph>{config.message}</Paragraph>

        {amount && (
          <DetailBox>
            <DetailRow
              label="Valor"
              value={
                <HighlightValue tone={type === "received" ? "success" : "info"}>
                  {amount}
                </HighlightValue>
              }
            />
            {description && <DetailRow label="Descrição" value={description} />}
          </DetailBox>
        )}

        <StatusBox variant={config.statusVariant}>
          {type === "received" ? (
            <>
              <strong>Confirmado:</strong> o pagamento foi registrado em nosso
              sistema.
            </>
          ) : (
            <>
              <strong>Atenção:</strong> se o problema persistir, entre em
              contato com nosso suporte.
            </>
          )}
        </StatusBox>

        {actionUrl && (
          <>
            <ActionButton href={actionUrl}>{config.actionLabel}</ActionButton>
            <LinkFallback url={actionUrl} />
          </>
        )}
      </EmailCard>
    </EmailLayout>
  );
}

export default PaymentNotificationEmail;
