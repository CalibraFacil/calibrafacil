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

export interface PortalDueDigestItem {
  tag: string;
  name: string;
  /** Human status sentence, e.g. "Vencida há 3 dias" / "Vence em 12 dias". */
  statusLabel: string;
  overdue: boolean;
}

export interface PortalDueDigestEmailProps {
  recipientName: string;
  /** "diário" | "semanal" — matches the user's chosen digest frequency. */
  frequencyLabel: string;
  overdueCount: number;
  dueSoonCount: number;
  /** Soonest-due instruments, capped; `moreCount` covers the remainder. */
  items: PortalDueDigestItem[];
  moreCount: number;
  portalUrl: string;
  logoSrc?: string;
  brand?: EmailBrand;
}

function pluralize(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function PortalDueDigestEmail({
  recipientName = "Usuário",
  frequencyLabel = "semanal",
  overdueCount = 1,
  dueSoonCount = 2,
  items = [
    {
      tag: "EQ-1",
      name: "Balança analítica",
      statusLabel: "Vencida há 3 dias",
      overdue: true,
    },
  ],
  moreCount = 0,
  portalUrl = "#",
  logoSrc,
  brand,
}: PortalDueDigestEmailProps) {
  const total = overdueCount + dueSoonCount;
  const summary = [
    overdueCount > 0
      ? `${pluralize(overdueCount, "instrumento está", "instrumentos estão")} com a calibração vencida`
      : null,
    dueSoonCount > 0
      ? `${pluralize(dueSoonCount, "vence", "vencem")} nos próximos 30 dias`
      : null,
  ]
    .filter(Boolean)
    .join(" e ");

  return (
    <EmailLayout
      previewText={`Resumo de calibrações: ${pluralize(total, "instrumento requer", "instrumentos requerem")} atenção`}
      logoSrc={logoSrc}
      brand={brand}
    >
      <EmailCard logoSrc={logoSrc} brand={brand}>
        <Badge variant={overdueCount > 0 ? "error" : "warning"}>
          {overdueCount > 0 ? "Atenção" : "Lembrete"}
        </Badge>
        <Title>Resumo de calibrações</Title>

        <Paragraph>Olá, {recipientName},</Paragraph>
        <Paragraph>
          Este é o seu resumo {frequencyLabel} da frota de instrumentos:{" "}
          {summary}.
        </Paragraph>

        <DetailBox>
          {items.map((item) => (
            <DetailRow
              key={item.tag}
              label={item.tag}
              value={
                <>
                  {item.name}
                  {" · "}
                  <HighlightValue tone={item.overdue ? "error" : "warning"}>
                    {item.statusLabel}
                  </HighlightValue>
                </>
              }
            />
          ))}
          {moreCount > 0 ? (
            <DetailRow
              label="—"
              value={`e mais ${pluralize(moreCount, "instrumento", "instrumentos")}`}
            />
          ) : null}
        </DetailBox>

        <StatusBox variant={overdueCount > 0 ? "error" : "warning"}>
          <strong>Próximo passo:</strong> abra o portal para conferir o
          calendário de vencimentos e solicitar as calibrações.
        </StatusBox>

        <ActionButton href={portalUrl}>Abrir o portal</ActionButton>
        <LinkFallback url={portalUrl} />

        <Paragraph>
          Você recebe este resumo porque ativou o aviso {frequencyLabel} no
          portal. Para deixar de recebê-lo, ajuste suas preferências em
          Configurações &gt; Notificações.
        </Paragraph>
      </EmailCard>
    </EmailLayout>
  );
}

export default PortalDueDigestEmail;
