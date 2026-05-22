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

type CompetenceNotificationType =
  | "expiring"
  | "expired"
  | "requested"
  | "approved";

export interface CompetenceNotificationEmailProps {
  recipientName: string;
  type: CompetenceNotificationType;
  subjectName: string;
  scopeDescription: string;
  dueDate?: string;
  daysRemaining?: number;
  actorName?: string;
  actionUrl: string;
  logoSrc?: string;
  brand?: EmailBrand;
}

const getTypeConfig = (type: CompetenceNotificationType) => {
  switch (type) {
    case "expiring":
      return {
        title: "Competência vencendo",
        previewText: "Uma competência está próxima do vencimento",
        badge: "Atenção",
        variant: "warning" as const,
        actionLabel: "Revisar competência",
      };
    case "expired":
      return {
        title: "Competência expirada",
        previewText: "Uma competência expirou",
        badge: "Urgente",
        variant: "error" as const,
        actionLabel: "Revisar competência",
      };
    case "requested":
      return {
        title: "Nova solicitação de competência",
        previewText: "Uma qualificação foi solicitada",
        badge: "Solicitação",
        variant: "info" as const,
        actionLabel: "Avaliar solicitação",
      };
    case "approved":
      return {
        title: "Competência aprovada",
        previewText: "Sua qualificação foi aprovada",
        badge: "Aprovada",
        variant: "success" as const,
        actionLabel: "Ver competência",
      };
  }
};

export function CompetenceNotificationEmail({
  recipientName = "Usuário",
  type = "expiring",
  subjectName = "Profissional",
  scopeDescription = "Escopo de competência",
  dueDate,
  daysRemaining,
  actorName,
  actionUrl = "#",
  logoSrc,
  brand,
}: CompetenceNotificationEmailProps) {
  const config = getTypeConfig(type);

  return (
    <EmailLayout
      previewText={config.previewText}
      logoSrc={logoSrc}
      brand={brand}
    >
      <EmailCard logoSrc={logoSrc} brand={brand}>
        <Badge variant={config.variant}>{config.badge}</Badge>
        <Title>{config.title}</Title>

        <Paragraph>Olá, {recipientName},</Paragraph>
        <Paragraph>
          {type === "approved"
            ? `${actorName ?? "Um gestor"} aprovou a qualificação para ${scopeDescription}.`
            : type === "requested"
              ? `${actorName ?? "Um usuário"} solicitou qualificação para ${subjectName}.`
              : `A competência de ${subjectName} precisa de atenção.`}
        </Paragraph>

        <DetailBox tone={config.variant}>
          <DetailRow label="Profissional" value={subjectName} />
          <DetailRow label="Escopo" value={scopeDescription} />
          {dueDate && <DetailRow label="Data de vencimento" value={dueDate} />}
          {typeof daysRemaining === "number" && (
            <DetailRow
              label="Prazo"
              value={
                <HighlightValue tone={config.variant}>
                  {daysRemaining} {daysRemaining === 1 ? "dia" : "dias"}
                </HighlightValue>
              }
            />
          )}
        </DetailBox>

        <StatusBox variant={config.variant}>
          {type === "expired" ? (
            <>
              <strong>Ação necessária:</strong> revise o escopo antes de novas
              atribuições.
            </>
          ) : (
            <>
              <strong>Status:</strong> {config.badge}
            </>
          )}
        </StatusBox>

        <ActionButton href={actionUrl}>{config.actionLabel}</ActionButton>
        <LinkFallback url={actionUrl} />
      </EmailCard>
    </EmailLayout>
  );
}

CompetenceNotificationEmail.PreviewProps = {
  recipientName: "Ana",
  type: "expiring",
  subjectName: "Carlos Pereira",
  scopeDescription: "Calibração dimensional",
  dueDate: "21/06/2026",
  daysRemaining: 30,
  actionUrl: "https://calibrafacil.com/dashboard/personnel/123",
} satisfies CompetenceNotificationEmailProps;

export default CompetenceNotificationEmail;
