import { HugeiconsIcon } from "@hugeicons/react";
import {
  CheckmarkCircle01Icon,
  InboxIcon,
  Notification03Icon,
} from "@hugeicons/core-free-icons";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { PageHeader } from "@/components/page-header";
import {
  BlueprintField,
  BlueprintGrid,
  Panel,
  SignalTile,
  StaggerGroup,
  StaggerItem,
} from "@/components/instrument-panel";
import { StatusPill } from "@/components/status-pill";
import { formatDateTime } from "@/lib/format";
import { getOotNotificationStatus } from "@/lib/status-labels";
import {
  useAcknowledgeOotNotification,
  useOotNotifications,
  type OotNotification,
} from "./queries";

const ACK_VIA_LABEL: Record<string, string> = {
  email_link: "link do e-mail",
  portal_link: "portal",
  manual: "registro manual",
};

export function OutOfTolerancePage() {
  const { data, isLoading, error } = useOotNotifications();

  const notifications = data?.data ?? [];
  const total = data?.counts.total ?? 0;
  const pending = data?.counts.pending ?? 0;

  return (
    <div className="portal-shell space-y-6">
      <div className="space-y-2">
        <PageHeader
          eyebrow="Qualidade"
          title="Fora de tolerância"
          description="Notificações de resultados fora de tolerância (ISO/IEC 17025 §7.10)."
        />
        <p className="text-muted-foreground max-w-2xl text-sm text-pretty">
          A confirmação registra apenas o recebimento da notificação.
        </p>
      </div>

      <StaggerGroup className="grid gap-3 sm:grid-cols-2">
        <StaggerItem>
          <SignalTile
            icon={InboxIcon}
            label="Total"
            value={isLoading ? "—" : total}
            hint={total === 1 ? "notificação" : "notificações"}
            tone="neutral"
          />
        </StaggerItem>
        <StaggerItem>
          <SignalTile
            icon={Notification03Icon}
            label="Aguardando confirmação"
            value={isLoading ? "—" : pending}
            hint={pending > 0 ? "confirme o recebimento" : "tudo confirmado"}
            tone={pending > 0 ? "warning" : "ok"}
          />
        </StaggerItem>
      </StaggerGroup>

      {error ? (
        <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-md border p-4 text-sm">
          {error instanceof Error
            ? error.message
            : "Erro ao carregar as notificações."}
        </div>
      ) : isLoading ? (
        <Panel className="p-5">
          <p className="text-muted-foreground text-sm">
            Carregando notificações…
          </p>
        </Panel>
      ) : notifications.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={InboxIcon} />
            </EmptyMedia>
            <EmptyTitle>Nenhuma notificação.</EmptyTitle>
            <EmptyDescription>
              As comunicações de qualidade enviadas pelo laboratório aparecerão
              aqui.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <StaggerGroup className="space-y-3">
          {notifications.map((notification) => (
            <StaggerItem key={notification.id}>
              <NotificationCard notification={notification} />
            </StaggerItem>
          ))}
        </StaggerGroup>
      )}
    </div>
  );
}

function NotificationCard({ notification }: { notification: OotNotification }) {
  const acknowledge = useAcknowledgeOotNotification();
  const status = getOotNotificationStatus(notification.status);
  const isAcknowledged = notification.status === "ACKNOWLEDGED";
  const viaLabel = notification.acknowledgedVia
    ? ACK_VIA_LABEL[notification.acknowledgedVia]
    : null;
  const hasUnit = Boolean(notification.unitName);
  const hasScope = Boolean(notification.affectedScope);

  return (
    <Panel className="space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-sm font-semibold">
            {notification.ncNumber}
          </p>
          <p className="text-muted-foreground text-xs">
            Notificação de resultado fora de tolerância
          </p>
        </div>
        <StatusPill tone={status.tone} pulse={notification.status === "SENT"}>
          {status.label}
        </StatusPill>
      </div>

      <BlueprintGrid className="grid-cols-1 sm:grid-cols-2">
        <BlueprintField label="Instrumento">
          {notification.assetName ?? "—"}
          {notification.assetTag ? (
            <span className="text-muted-foreground">
              {" "}
              · {notification.assetTag}
            </span>
          ) : null}
        </BlueprintField>
        <BlueprintField label="Certificado" mono>
          {notification.certificateNumber ?? "—"}
        </BlueprintField>
        {hasUnit ? (
          <BlueprintField
            label="Unidade"
            className={hasScope ? undefined : "sm:col-span-2"}
          >
            {notification.unitName}
          </BlueprintField>
        ) : null}
        {hasScope ? (
          <BlueprintField
            label="Escopo afetado"
            className={hasUnit ? undefined : "sm:col-span-2"}
          >
            {notification.affectedScope}
          </BlueprintField>
        ) : null}
      </BlueprintGrid>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="text-muted-foreground space-y-0.5 text-xs">
          {notification.sentAt ? (
            <p>Enviada em {formatDateTime(notification.sentAt)}</p>
          ) : (
            <p>Registrada em {formatDateTime(notification.createdAt)}</p>
          )}
          {isAcknowledged ? (
            <p>
              Confirmada em {formatDateTime(notification.acknowledgedAt)}
              {viaLabel ? ` (via ${viaLabel})` : ""}
            </p>
          ) : null}
        </div>
        {!isAcknowledged ? (
          <Button
            size="sm"
            disabled={acknowledge.isPending}
            onClick={() => {
              acknowledge.mutate(notification.id, {
                onSuccess: () => {
                  toast.success(
                    "Recebimento confirmado. Recomendamos avaliar o impacto nas medições realizadas.",
                  );
                },
                onError: (mutationError) => {
                  toast.error(mutationError.message);
                },
              });
            }}
          >
            <HugeiconsIcon icon={CheckmarkCircle01Icon} strokeWidth={2} />
            {acknowledge.isPending ? "Confirmando…" : "Confirmar recebimento"}
          </Button>
        ) : null}
      </div>
    </Panel>
  );
}
