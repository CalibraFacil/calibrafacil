/** @jsxRuntime automatic */
/** @jsxImportSource react */
import {
  ActionButton,
  Badge,
  DetailBox,
  DetailRow,
  EmailCard,
  EmailLayout,
  LinkFallback,
  Paragraph,
  StatusBox,
  Title,
  type EmailBrand,
} from "./components/email-layout";

type VisitVariant =
  | "scheduled"
  | "confirmed"
  | "rescheduled"
  | "reschedule_declined"
  | "cancelled"
  | "reminder";

interface VisitNotificationEmailProps {
  variant: VisitVariant;
  recipientName: string;
  customerName: string;
  scheduledDate: string;
  technicianName?: string;
  addressText?: string;
  labName?: string;
  reason?: string;
  actionUrl: string;
  logoSrc?: string;
  brand?: EmailBrand;
}

const getTypeConfig = (variant: VisitVariant) => {
  switch (variant) {
    case "scheduled":
      return {
        title: "Visita no local agendada",
        previewText: "Uma visita de calibração no local foi agendada para você",
        label: "Agendada",
        badgeVariant: "info" as const,
        statusVariant: "info" as const,
        actionLabel: "Ver detalhes da visita",
      };
    case "confirmed":
      return {
        title: "Visita no local confirmada",
        previewText:
          "Sua visita de calibração no local foi confirmada pelo laboratório",
        label: "Confirmada",
        badgeVariant: "success" as const,
        statusVariant: "success" as const,
        actionLabel: "Acompanhar solicitação",
      };
    case "rescheduled":
      return {
        title: "Visita no local reagendada",
        previewText: "A data da sua visita de calibração no local foi alterada",
        label: "Reagendada",
        badgeVariant: "warning" as const,
        statusVariant: "warning" as const,
        actionLabel: "Ver nova data",
      };
    case "reschedule_declined":
      return {
        title: "Reagendamento não foi possível",
        previewText:
          "O laboratório não pôde reagendar a sua visita de calibração no local",
        label: "Data mantida",
        badgeVariant: "warning" as const,
        statusVariant: "warning" as const,
        actionLabel: "Ver visita no portal",
      };
    case "cancelled":
      return {
        title: "Visita no local cancelada",
        previewText: "Sua visita de calibração no local foi cancelada",
        label: "Cancelada",
        badgeVariant: "error" as const,
        statusVariant: "error" as const,
        actionLabel: "Ver solicitação",
      };
    case "reminder":
      return {
        title: "Lembrete: visita no local",
        previewText:
          "Lembrete — a visita de calibração no local está se aproximando",
        label: "Lembrete",
        badgeVariant: "info" as const,
        statusVariant: "info" as const,
        actionLabel: "Ver detalhes da visita",
      };
  }
};

export function VisitNotificationEmail({
  variant = "confirmed",
  recipientName = "Usuário",
  customerName = "Cliente",
  scheduledDate = "01/01/2026",
  technicianName,
  addressText,
  labName,
  reason,
  actionUrl = "https://calibrafacil.com/portal/requests",
  logoSrc,
  brand,
}: VisitNotificationEmailProps) {
  const config = getTypeConfig(variant);

  const introMessage =
    variant === "scheduled"
      ? `Uma visita de calibração no local foi agendada para o cliente ${customerName}.`
      : variant === "confirmed"
        ? `${labName ?? "O laboratório"} confirmou a visita de calibração no local para ${customerName}.`
        : variant === "rescheduled"
          ? `${labName ?? "O laboratório"} reagendou a visita de calibração no local para ${customerName}.`
          : variant === "reschedule_declined"
            ? `${labName ?? "O laboratório"} não pôde atender à sua solicitação de reagendamento da visita para ${customerName}. A data original está mantida.`
            : variant === "cancelled"
              ? `${labName ?? "O laboratório"} cancelou a visita de calibração no local para ${customerName}.`
              : `Lembrete: a visita de calibração no local para ${customerName} está se aproximando.`;

  return (
    <EmailLayout
      previewText={config.previewText}
      logoSrc={logoSrc}
      brand={brand}
    >
      <EmailCard logoSrc={logoSrc} brand={brand}>
        <Badge variant={config.badgeVariant}>{config.label}</Badge>
        <Title>{config.title}</Title>

        <Paragraph>Olá, {recipientName},</Paragraph>
        <Paragraph>{introMessage}</Paragraph>

        <DetailBox tone={variant === "cancelled" ? "error" : "default"}>
          {labName && <DetailRow label="Laboratório" value={labName} />}
          <DetailRow label="Cliente" value={customerName} />
          {variant !== "cancelled" && (
            <DetailRow label="Data da visita" value={scheduledDate} />
          )}
          {variant === "cancelled" && scheduledDate && (
            <DetailRow label="Data prevista" value={scheduledDate} />
          )}
          {technicianName && (
            <DetailRow label="Técnico responsável" value={technicianName} />
          )}
          {addressText && <DetailRow label="Endereço" value={addressText} />}
          {reason && <DetailRow label="Motivo" value={reason} />}
        </DetailBox>

        <StatusBox variant={config.statusVariant}>
          <strong>Status:</strong> {config.label}
        </StatusBox>

        {variant === "reminder" && (
          <Paragraph>
            Não vai poder receber a visita nesta data? Acesse o portal para
            confirmar presença ou solicitar o reagendamento.
          </Paragraph>
        )}

        <ActionButton href={actionUrl}>{config.actionLabel}</ActionButton>
        <LinkFallback url={actionUrl} />
      </EmailCard>
    </EmailLayout>
  );
}

VisitNotificationEmail.PreviewProps = {
  variant: "confirmed",
  recipientName: "Maria Silva",
  customerName: "ACME Indústria Ltda",
  scheduledDate: "25/06/2026",
  technicianName: "João Técnico",
  addressText: "Rua das Flores, 100 — São Paulo, SP",
  labName: "Lab Metrologia",
  actionUrl: "https://calibrafacil.com/portal/requests/42",
  brand: { name: "Lab Metrologia", isWhiteLabel: true },
} satisfies VisitNotificationEmailProps;

export default VisitNotificationEmail;
