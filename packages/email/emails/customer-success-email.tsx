/** @jsxRuntime automatic */
/** @jsxImportSource react */
import {
  ActionButton,
  Badge,
  EmailCard,
  EmailLayout,
  LinkFallback,
  Paragraph,
  StatusBox,
  Title,
  type EmailBrand,
} from "./components/email-layout";

export type CustomerSuccessEmailType =
  | "CUSTOMER_SUCCESS_WORKFLOW_BLOCKED"
  | "CUSTOMER_SUCCESS_GO_LIVE_AT_RISK"
  | "CUSTOMER_SUCCESS_NEXT_ACTION_OVERDUE"
  | "CUSTOMER_SUCCESS_SLA_DUE_SOON"
  | "CUSTOMER_SUCCESS_SLA_BREACHED"
  | "CUSTOMER_SUCCESS_ESCALATION_REQUIRED";

interface CustomerSuccessEmailProps {
  recipientName: string;
  type: CustomerSuccessEmailType;
  title: string;
  message: string;
  actionUrl?: string;
  logoSrc?: string;
  brand?: EmailBrand;
}

const getTypeConfig = (type: CustomerSuccessEmailType) => {
  switch (type) {
    case "CUSTOMER_SUCCESS_WORKFLOW_BLOCKED":
      return { label: "Bloqueio", variant: "error" as const };
    case "CUSTOMER_SUCCESS_GO_LIVE_AT_RISK":
      return { label: "Risco", variant: "warning" as const };
    case "CUSTOMER_SUCCESS_NEXT_ACTION_OVERDUE":
      return { label: "Ação atrasada", variant: "warning" as const };
    case "CUSTOMER_SUCCESS_SLA_DUE_SOON":
      return { label: "SLA próximo", variant: "info" as const };
    case "CUSTOMER_SUCCESS_SLA_BREACHED":
      return { label: "SLA vencido", variant: "error" as const };
    case "CUSTOMER_SUCCESS_ESCALATION_REQUIRED":
      return { label: "Escalação", variant: "error" as const };
  }
};

export function CustomerSuccessEmail({
  recipientName = "Usuário",
  type = "CUSTOMER_SUCCESS_GO_LIVE_AT_RISK",
  title = "Go-live em risco",
  message = "O go-live do laboratório entrou em estado de risco e exige acompanhamento prioritário.",
  actionUrl,
  logoSrc,
  brand,
}: CustomerSuccessEmailProps) {
  const config = getTypeConfig(type);

  return (
    <EmailLayout previewText={title} logoSrc={logoSrc} brand={brand}>
      <EmailCard logoSrc={logoSrc} brand={brand}>
        <Badge variant={config.variant}>{config.label}</Badge>
        <Title>{title}</Title>

        <Paragraph>Olá, {recipientName},</Paragraph>
        <Paragraph>{message}</Paragraph>

        <StatusBox variant={config.variant}>
          <strong>Customer Success:</strong> acompanhe o fluxo no painel para
          manter o atendimento em dia.
        </StatusBox>

        {actionUrl && (
          <>
            <ActionButton href={actionUrl}>Abrir Customer Success</ActionButton>
            <LinkFallback url={actionUrl} />
          </>
        )}
      </EmailCard>
    </EmailLayout>
  );
}

CustomerSuccessEmail.PreviewProps = {
  recipientName: "Ana",
  type: "CUSTOMER_SUCCESS_GO_LIVE_AT_RISK",
  title: "Go-live em risco",
  message:
    "O go-live do laboratório entrou em estado de risco e exige acompanhamento prioritário.",
  actionUrl: "https://app.example.com/dashboard/customer-success",
} satisfies CustomerSuccessEmailProps;

export default CustomerSuccessEmail;
