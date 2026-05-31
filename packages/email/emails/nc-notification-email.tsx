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

type NCNotificationType = "created" | "escalated";

export interface NCNotificationEmailProps {
  recipientName: string;
  type: NCNotificationType;
  ncNumber: string;
  ncType?: "work" | "equipment" | "documentation";
  description?: string;
  capaNumber?: string;
  actorName?: string;
  actionUrl: string;
  logoSrc?: string;
  brand?: EmailBrand;
}

const getTypeConfig = (type: NCNotificationType) => {
  switch (type) {
    case "created":
      return {
        title: "Nova não conformidade",
        statusLabel: "Registrada",
        statusVariant: "warning" as const,
        previewText: "Uma não conformidade foi registrada",
        actionLabel: "Ver NC",
      };
    case "escalated":
      return {
        title: "NC escalada para CAPA",
        statusLabel: "Escalada",
        statusVariant: "info" as const,
        previewText: "Uma não conformidade foi escalada para CAPA",
        actionLabel: "Ver CAPA",
      };
  }
};

const getNCTypeLabel = (ncType: string | undefined): string => {
  switch (ncType) {
    case "work":
      return "Trabalho";
    case "equipment":
      return "Equipamento";
    case "documentation":
      return "Documentação";
    default:
      return "";
  }
};

export function NCNotificationEmail({
  recipientName = "Usuário",
  type = "created",
  ncNumber = "NC-2024-0001",
  ncType,
  description,
  capaNumber,
  actorName,
  actionUrl = "#",
  logoSrc,
  brand,
}: NCNotificationEmailProps) {
  const config = getTypeConfig(type);
  const ncTypeLabel = getNCTypeLabel(ncType);

  return (
    <EmailLayout
      previewText={`${config.previewText} - ${ncNumber}`}
      logoSrc={logoSrc}
      brand={brand}
    >
      <EmailCard logoSrc={logoSrc} brand={brand}>
        <Badge variant={config.statusVariant}>Qualidade</Badge>
        <Title>{config.title}</Title>

        <Paragraph>Olá, {recipientName},</Paragraph>
        <Paragraph>
          {type === "created"
            ? `Uma nova não conformidade foi registrada${actorName ? ` por ${actorName}` : ""}.`
            : `A não conformidade ${ncNumber} foi escalada para uma ação corretiva (CAPA)${actorName ? ` por ${actorName}` : ""}.`}
        </Paragraph>

        <DetailBox tone={type === "created" ? "warning" : "info"}>
          <DetailRow
            label="Não conformidade"
            value={
              <HighlightValue tone={config.statusVariant}>
                {ncNumber}
              </HighlightValue>
            }
          />
          {ncTypeLabel && <DetailRow label="Tipo" value={ncTypeLabel} />}
        </DetailBox>

        {type === "escalated" && capaNumber && (
          <DetailBox tone="info">
            <DetailRow
              label="CAPA criada"
              value={<HighlightValue>{capaNumber}</HighlightValue>}
            />
          </DetailBox>
        )}

        {description && (
          <DetailBox>
            <DetailRow
              label="Descrição"
              value={
                description.length > 200
                  ? `${description.slice(0, 200)}...`
                  : description
              }
            />
          </DetailBox>
        )}

        <StatusBox variant={config.statusVariant}>
          <strong>Status:</strong> {config.statusLabel}
        </StatusBox>

        <ActionButton href={actionUrl}>{config.actionLabel}</ActionButton>
        <LinkFallback url={actionUrl} />
      </EmailCard>
    </EmailLayout>
  );
}

export default NCNotificationEmail;
