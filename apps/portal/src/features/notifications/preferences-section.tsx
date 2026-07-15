import { HugeiconsIcon } from "@hugeicons/react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Panel, PanelHeader } from "@/components/instrument-panel";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  PREFERENCE_GROUPS,
  getNotificationTypeMeta,
  type PortalNotificationType,
} from "./lib";
import {
  useNotificationPreferences,
  useUpdateNotificationPreferences,
  type NotificationChannels,
  type UpdatePreferencesInput,
} from "./queries";

/**
 * Notification preferences section of the unified /settings page: a flat
 * channel panel (global e-mail switch + digest segmented control) and a
 * per-event matrix (Evento | No app | E-mail), deliberately without
 * collapsibles. Also the landing spot of e-mail unsubscribe links
 * (/settings/notifications redirects here).
 */

const DIGEST_OPTIONS: Array<{
  value: "NONE" | "DAILY" | "WEEKLY";
  label: string;
  description: string;
}> = [
  {
    value: "NONE",
    label: "Desativado",
    description: "Nenhum resumo por e-mail.",
  },
  {
    value: "DAILY",
    label: "Diário",
    description: "Todos os dias pela manhã.",
  },
  {
    value: "WEEKLY",
    label: "Semanal",
    description: "Às segundas-feiras.",
  },
];

const DEFAULT_CHANNELS: NotificationChannels = { inApp: true, email: true };

export function NotificationPreferencesSection() {
  const preferencesQuery = useNotificationPreferences();
  const updateMutation = useUpdateNotificationPreferences();

  const saved = preferencesQuery.data;

  function save(input: UpdatePreferencesInput) {
    updateMutation.mutate(input, {
      onError: () => {
        toast.error("Não foi possível salvar — tente novamente.");
      },
    });
  }

  if (preferencesQuery.isLoading) {
    return (
      <div className="space-y-6">
        <Panel className="space-y-4 p-5">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </Panel>
        <Panel className="space-y-3 p-5">
          <Skeleton className="h-5 w-40" />
          {[0, 1, 2, 3, 4].map((index) => (
            <Skeleton key={index} className="h-9 w-full" />
          ))}
        </Panel>
      </div>
    );
  }

  if (preferencesQuery.isError || !saved) {
    return (
      <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-md border p-4 text-sm">
        Erro ao carregar suas preferências. Recarregue a página.
      </div>
    );
  }

  const emailEnabled = saved.emailEnabled;
  const digest =
    DIGEST_OPTIONS.find((option) => option.value === saved.digestFrequency) ??
    DIGEST_OPTIONS[0];

  function channelsFor(type: PortalNotificationType): NotificationChannels {
    return saved?.preferences[type] ?? DEFAULT_CHANNELS;
  }

  function toggleType(
    type: PortalNotificationType,
    channel: keyof NotificationChannels,
  ) {
    const current = channelsFor(type);
    save({
      preferences: {
        [type]: { ...current, [channel]: !current[channel] },
      },
    });
  }

  return (
    <div className="space-y-6">
      <Panel className="p-5">
        <PanelHeader
          title="Canais"
          description="Como o laboratório fala com você fora do portal."
        />
        <div className="divide-foreground/10 mt-4 divide-y">
          <div className="flex items-center justify-between gap-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">Notificações por e-mail</p>
              <p className="text-muted-foreground text-xs">
                Desative para pausar todos os e-mails de notificação e o resumo
                de vencimentos.
              </p>
            </div>
            <Switch
              checked={emailEnabled}
              onCheckedChange={(checked) => save({ emailEnabled: checked })}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">Resumo de vencimentos</p>
              <p className="text-muted-foreground text-xs">
                Instrumentos vencidos ou a vencer nos próximos 30 dias.{" "}
                {digest.description}
              </p>
            </div>
            <div className="border-border bg-muted/40 inline-flex shrink-0 rounded-lg border p-0.5">
              {DIGEST_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  disabled={!emailEnabled && option.value !== "NONE"}
                  onClick={() => save({ digestFrequency: option.value })}
                  className={cn(
                    "h-7 rounded-md px-2.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                    saved.digestFrequency === option.value
                      ? "bg-background text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Panel>

      <Panel className="p-5">
        <PanelHeader
          title="Por evento"
          description="Escolha onde receber cada tipo de atualização."
        />
        {!emailEnabled ? (
          <p className="text-muted-foreground mt-3 text-xs">
            E-mails estão desativados. A coluna E-mail volta a valer quando você
            reativar o canal acima.
          </p>
        ) : null}
        <div className="mt-4 space-y-5">
          <div className="text-muted-foreground grid grid-cols-[minmax(0,1fr)_4rem_4rem] gap-3 font-mono text-[11px] uppercase tracking-[0.16em]">
            <span>Evento</span>
            <span className="text-center">No app</span>
            <span className="text-center">E-mail</span>
          </div>
          {PREFERENCE_GROUPS.map((group) => (
            <section key={group.label}>
              <h3 className="text-muted-foreground font-mono text-[11px] font-medium uppercase tracking-[0.16em]">
                {group.label}
              </h3>
              <div className="divide-foreground/10 divide-y">
                {group.types.map((type) => {
                  const meta = getNotificationTypeMeta(type);
                  const channels = channelsFor(type);
                  return (
                    <div
                      key={type}
                      className="grid grid-cols-[minmax(0,1fr)_4rem_4rem] items-center gap-3 py-2.5"
                    >
                      <div className="flex min-w-0 items-start gap-2.5 pr-2">
                        <HugeiconsIcon
                          icon={meta.icon}
                          className="text-muted-foreground mt-0.5 size-4 shrink-0"
                          strokeWidth={2}
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{meta.label}</p>
                          <p className="text-muted-foreground text-xs">
                            {meta.description}
                          </p>
                        </div>
                      </div>
                      <div className="flex justify-center">
                        <Switch
                          size="sm"
                          checked={channels.inApp}
                          onCheckedChange={() => toggleType(type, "inApp")}
                        />
                      </div>
                      <div className="flex justify-center">
                        <Switch
                          size="sm"
                          checked={channels.email && emailEnabled}
                          disabled={!emailEnabled}
                          onCheckedChange={() => toggleType(type, "email")}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </Panel>
    </div>
  );
}
