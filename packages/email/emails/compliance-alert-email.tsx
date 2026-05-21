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
} from "./components/email-layout";

type ComplianceAlertType = "asset" | "standard" | "standardExpired";

export interface ComplianceAlertEmailProps {
  recipientName: string;
  type: ComplianceAlertType;
  itemName: string;
  dueDate: string;
  daysRemaining: number;
  actionUrl: string;
  logoSrc?: string;
}

const getTypeConfig = (type: ComplianceAlertType) => {
  switch (type) {
    case "asset":
      return {
        title: "Ativo vencendo calibração",
        previewText: "Um ativo está próximo da data de recalibração",
        itemLabel: "Instrumento",
        actionLabel: "Ver ativo",
      };
    case "standard":
      return {
        title: "Padrão de referência vencendo",
        previewText: "Um padrão de referência está próximo do vencimento",
        itemLabel: "Padrão de referência",
        actionLabel: "Ver padrão",
      };
    case "standardExpired":
      return {
        title: "Padrão de referência vencido",
        previewText: "Um padrão de referência venceu",
        itemLabel: "Padrão de referência",
        actionLabel: "Ver padrão",
      };
  }
};

const getUrgency = (daysRemaining: number) => {
  if (daysRemaining <= 3) {
    return { label: "Urgente", variant: "error" as const };
  }

  if (daysRemaining <= 7) {
    return { label: "Atenção", variant: "warning" as const };
  }

  return { label: "Lembrete", variant: "info" as const };
};

export function ComplianceAlertEmail({
  recipientName = "Usuário",
  type = "asset",
  itemName = "Instrumento de Teste",
  dueDate = "01/02/2024",
  daysRemaining = 7,
  actionUrl = "#",
  logoSrc,
}: ComplianceAlertEmailProps) {
  const config = getTypeConfig(type);
  const urgency = getUrgency(daysRemaining);
  const isExpired = type === "standardExpired";
  const daysLabel = isExpired ? Math.abs(daysRemaining) : daysRemaining;

  return (
    <EmailLayout
      previewText={`${config.previewText} - ${itemName}`}
      logoSrc={logoSrc}
    >
      <EmailCard logoSrc={logoSrc}>
        <Badge variant={isExpired ? "error" : urgency.variant}>
          {isExpired ? "Vencido" : urgency.label}
        </Badge>
        <Title>{config.title}</Title>

        <Paragraph>Olá, {recipientName},</Paragraph>
        <Paragraph>
          {type === "asset"
            ? "Um instrumento sob sua responsabilidade está próximo da data de recalibração."
            : isExpired
              ? "Um padrão de referência do seu laboratório passou da data de vencimento."
              : "Um padrão de referência do seu laboratório está próximo da data de vencimento."}
        </Paragraph>

        <DetailBox>
          <DetailRow label={config.itemLabel} value={itemName} />
          <DetailRow label="Data de vencimento" value={dueDate} />
          <DetailRow
            label={isExpired ? "Vencido há" : "Dias restantes"}
            value={
              <HighlightValue tone={isExpired ? "error" : urgency.variant}>
                {daysLabel} {daysLabel === 1 ? "dia" : "dias"}
              </HighlightValue>
            }
          />
        </DetailBox>

        <StatusBox variant={isExpired ? "error" : urgency.variant}>
          <strong>Lembrete:</strong>{" "}
          {type === "asset"
            ? "Confira a programação do instrumento e planeje a próxima calibração."
            : isExpired
              ? "Atualize ou substitua este padrão antes de utilizá-lo em novas calibrações."
              : "Confira a programação do padrão e planeje a próxima calibração."}
        </StatusBox>

        <ActionButton href={actionUrl}>{config.actionLabel}</ActionButton>
        <LinkFallback url={actionUrl} />
      </EmailCard>
    </EmailLayout>
  );
}

export default ComplianceAlertEmail;
