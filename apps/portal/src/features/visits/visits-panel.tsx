import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Calendar03Icon,
  CheckmarkCircle01Icon,
  Location01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { toast } from "sonner";

import {
  ACTION_BUTTON_CLASS,
  Panel,
  PanelHeader,
  type SignalTone,
} from "@/components/instrument-panel";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatDateLong } from "@/lib/format";
import {
  formatPortalVisitAddress,
  isVisitActionable,
  PORTAL_VISIT_STATUS_LABELS,
  PREFERRED_PERIOD_LABELS,
  useConfirmVisitPresence,
  usePortalVisits,
  useRequestVisitReschedule,
  type PortalVisit,
  type PortalVisitReschedulePeriod,
  type PortalVisitStatus,
} from "./queries";

const VISIT_TONE: Record<PortalVisitStatus, SignalTone> = {
  PROPOSED: "warning",
  CONFIRMED: "info",
  IN_PROGRESS: "info",
  COMPLETED: "ok",
  CANCELLED: "neutral",
};

function scheduledLabel(scheduledAt: string | null): string {
  if (!scheduledAt) return "Data a confirmar";
  return formatDateLong(new Date(scheduledAt));
}

type WindowDraft = {
  date: string;
  period: PortalVisitReschedulePeriod;
};

const EMPTY_WINDOW: WindowDraft = { date: "", period: "ANY" };
const MAX_WINDOWS = 3;

/**
 * #739: structured "this date doesn't work" request — reason + up to 3
 * preferred windows. Does not move the visit; the lab resolves it.
 */
function RescheduleDialog({
  visit,
  open,
  onOpenChange,
}: {
  visit: PortalVisit;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [reason, setReason] = useState("");
  const [windows, setWindows] = useState<Array<WindowDraft>>([EMPTY_WINDOW]);
  const requestReschedule = useRequestVisitReschedule();

  const filledWindows = windows.filter((window) => window.date !== "");
  const canSubmit =
    !requestReschedule.isPending &&
    (filledWindows.length > 0 || reason.trim() !== "");

  function updateWindow(index: number, patch: Partial<WindowDraft>) {
    setWindows((current) =>
      current.map((window, i) =>
        i === index ? { ...window, ...patch } : window,
      ),
    );
  }

  function submit() {
    requestReschedule.mutate(
      {
        visitId: visit.id,
        reason,
        preferredWindows: filledWindows,
      },
      {
        onSuccess: () => {
          onOpenChange(false);
          setReason("");
          setWindows([EMPTY_WINDOW]);
          toast.success(
            "Reagendamento solicitado. O laboratório vai responder em breve.",
          );
        },
        onError: (error) => {
          toast.error(
            error instanceof Error
              ? error.message
              : "Não foi possível solicitar o reagendamento.",
          );
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Solicitar reagendamento</DialogTitle>
          <DialogDescription>
            A visita de {scheduledLabel(visit.scheduledAt)} continua marcada até
            o laboratório aceitar uma nova data. Informe o motivo e até{" "}
            {MAX_WINDOWS} janelas preferidas.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor={`reschedule-reason-${visit.id}`}>
              Motivo (opcional)
            </Label>
            <Textarea
              id={`reschedule-reason-${visit.id}`}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Ex.: a planta estará parada nesta semana…"
            />
          </div>

          <div className="space-y-2">
            <Label>Janelas preferidas</Label>
            {windows.map((window, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  type="date"
                  value={window.date}
                  aria-label={`Data preferida ${index + 1}`}
                  onChange={(event) =>
                    updateWindow(index, { date: event.target.value })
                  }
                  className="w-40"
                />
                <Select
                  value={window.period}
                  onValueChange={(value) => {
                    if (
                      value === "MORNING" ||
                      value === "AFTERNOON" ||
                      value === "ANY"
                    ) {
                      updateWindow(index, { period: value });
                    }
                  }}
                >
                  <SelectTrigger
                    className="flex-1"
                    aria-label={`Período preferido ${index + 1}`}
                  >
                    {PREFERRED_PERIOD_LABELS[window.period]}
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MORNING">Manhã</SelectItem>
                    <SelectItem value="AFTERNOON">Tarde</SelectItem>
                    <SelectItem value="ANY">Qualquer horário</SelectItem>
                  </SelectContent>
                </Select>
                {windows.length > 1 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Remover janela ${index + 1}`}
                    onClick={() =>
                      setWindows((current) =>
                        current.filter((_, i) => i !== index),
                      )
                    }
                  >
                    Remover
                  </Button>
                )}
              </div>
            ))}
            {windows.length < MAX_WINDOWS && (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setWindows((current) => [...current, EMPTY_WINDOW])
                }
              >
                Adicionar janela
              </Button>
            )}
          </div>
        </div>

        <DialogFooter>
          <DialogClose
            render={
              <Button variant="outline" className={ACTION_BUTTON_CLASS} />
            }
          >
            Cancelar
          </DialogClose>
          <Button
            onClick={submit}
            disabled={!canSubmit}
            className={ACTION_BUTTON_CLASS}
          >
            {requestReschedule.isPending
              ? "Enviando…"
              : "Solicitar reagendamento"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Secondary chip: where the customer stands on this visit. */
function AcknowledgementPill({ visit }: { visit: PortalVisit }) {
  if (visit.rescheduleRequest?.status === "PENDING") {
    return (
      <StatusPill tone="warning" size="sm">
        Reagendamento solicitado
      </StatusPill>
    );
  }
  if (visit.customerConfirmedAt) {
    return (
      <StatusPill tone="ok" size="sm">
        Presença confirmada
      </StatusPill>
    );
  }
  if (isVisitActionable(visit)) {
    return (
      <StatusPill tone="neutral" size="sm">
        Aguardando confirmação
      </StatusPill>
    );
  }
  return null;
}

function VisitActions({ visit }: { visit: PortalVisit }) {
  const confirmPresence = useConfirmVisitPresence();
  const [rescheduleOpen, setRescheduleOpen] = useState(false);

  const request = visit.rescheduleRequest;

  if (!isVisitActionable(visit)) {
    return null;
  }

  if (request?.status === "PENDING") {
    return (
      <p className="text-muted-foreground text-xs">
        Aguardando resposta do laboratório sobre o reagendamento
        {request.preferredWindows.length > 0
          ? ` — janelas: ${request.preferredWindows
              .map(
                (window) =>
                  `${formatDate(new Date(`${window.date}T12:00:00`))} (${PREFERRED_PERIOD_LABELS[window.period].toLowerCase()})`,
              )
              .join(", ")}`
          : ""}
        .
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {request?.status === "DECLINED" && (
        <p className="text-muted-foreground w-full text-xs">
          O laboratório manteve a data original
          {request.resolutionNote ? `: ${request.resolutionNote}` : "."}
        </p>
      )}
      {!visit.customerConfirmedAt && (
        <Button
          size="sm"
          className={ACTION_BUTTON_CLASS}
          disabled={confirmPresence.isPending}
          onClick={() =>
            confirmPresence.mutate(visit.id, {
              onSuccess: () => toast.success("Presença confirmada. Obrigado!"),
              onError: (error) =>
                toast.error(
                  error instanceof Error
                    ? error.message
                    : "Não foi possível confirmar a presença.",
                ),
            })
          }
        >
          <HugeiconsIcon icon={CheckmarkCircle01Icon} strokeWidth={2} />
          {confirmPresence.isPending ? "Confirmando…" : "Confirmar presença"}
        </Button>
      )}
      <Button
        variant="outline"
        size="sm"
        className={ACTION_BUTTON_CLASS}
        onClick={() => setRescheduleOpen(true)}
      >
        <HugeiconsIcon icon={Calendar03Icon} strokeWidth={2} />
        Solicitar reagendamento
      </Button>
      <RescheduleDialog
        visit={visit}
        open={rescheduleOpen}
        onOpenChange={setRescheduleOpen}
      />
    </div>
  );
}

function VisitRow({ visit }: { visit: PortalVisit }) {
  const addressText = formatPortalVisitAddress(visit.address);
  const assetLabel =
    visit.assetCount === 1
      ? "1 instrumento"
      : `${visit.assetCount} instrumentos`;

  const body = (
    <>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">
          {scheduledLabel(visit.scheduledAt)}
        </p>
        <p className="text-muted-foreground truncate font-mono text-xs tabular-nums">
          {assetLabel}
          {visit.technicianName ? ` · ${visit.technicianName}` : ""}
          {addressText ? ` · ${addressText}` : ""}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <AcknowledgementPill visit={visit} />
        <StatusPill tone={VISIT_TONE[visit.status]} size="sm">
          {PORTAL_VISIT_STATUS_LABELS[visit.status]}
        </StatusPill>
      </div>
    </>
  );

  const info = visit.sourceRequestId ? (
    <Link
      to="/requests/$id"
      params={{ id: String(visit.sourceRequestId) }}
      className="hover:bg-muted/60 flex items-center justify-between gap-3 rounded-lg p-2 transition-colors"
    >
      {body}
    </Link>
  ) : (
    <div className="flex items-center justify-between gap-3 rounded-lg p-2">
      {body}
    </div>
  );

  return (
    <div className="space-y-1">
      {info}
      <div className="px-2 pb-1 empty:hidden">
        <VisitActions visit={visit} />
      </div>
    </div>
  );
}

/**
 * Customer-facing tracking for on-site (em loco) visits. Renders nothing when
 * the customer has no scheduled visits, so dropoff-only clients see no noise.
 */
export function PortalVisitsPanel() {
  const { data, isLoading } = usePortalVisits();
  const visits = data?.data ?? [];

  if (!isLoading && visits.length === 0) return null;

  return (
    <Panel className="p-5">
      <PanelHeader
        eyebrow="No local"
        title="Próximas visitas"
        description="Visitas de calibração in loco agendadas para você."
      />
      <div className="mt-4 space-y-1">
        {isLoading && visits.length === 0 ? (
          <div className="bg-muted/45 text-muted-foreground flex items-center gap-2 rounded-xl p-4 text-sm shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)]">
            <HugeiconsIcon icon={Location01Icon} strokeWidth={2} />
            Carregando visitas…
          </div>
        ) : (
          visits.map((visit) => <VisitRow key={visit.id} visit={visit} />)
        )}
      </div>
    </Panel>
  );
}
