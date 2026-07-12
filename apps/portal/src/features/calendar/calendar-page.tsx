import { Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import {
  Add01Icon,
  AlertCircleIcon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Calendar03Icon,
  FlaskConicalIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import {
  ACTION_BUTTON_CLASS,
  Panel,
  PanelHeader,
  SignalTile,
  StaggerGroup,
  StaggerItem,
  type SignalTone,
} from "@/components/instrument-panel";
import { StatusPill, TONE } from "@/components/status-pill";
import { getInstrumentStatus } from "@/lib/calibration-status";
import { formatDateLong } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useCalendarDues, type CalendarDueAsset } from "./queries";
import { usePortalUnits } from "@/features/fleet/queries";
import { PortalVisitsPanel } from "@/features/visits/visits-panel";
import { dayKey, groupDuesByDay, parseMonthParam, toMonthParam } from "./lib";

const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

const MONTH_TITLE = new Intl.DateTimeFormat("pt-BR", {
  month: "long",
  year: "numeric",
});

const TONE_RANK: Record<SignalTone, number> = {
  critical: 4,
  warning: 3,
  info: 2,
  ok: 1,
  neutral: 0,
};

/** The most urgent signal among a day's dues colors that day's marker. */
function worstTone(dues: Array<CalendarDueAsset>): SignalTone {
  let tone: SignalTone = "ok";
  for (const due of dues) {
    const status = getInstrumentStatus(due);
    if (TONE_RANK[status.tone] > TONE_RANK[tone]) tone = status.tone;
  }
  return tone;
}

export function CalendarPage({
  month,
  onMonthChange,
}: {
  month?: string;
  onMonthChange: (value?: string) => void;
}) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [unitId, setUnitId] = useState<number | null>(null);

  const unitsQuery = usePortalUnits();
  const units = unitsQuery.data?.units ?? [];
  const showUnitFilter = units.length > 1;

  const monthStart = parseMonthParam(month) ?? startOfMonth(new Date());
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const gridEnd = endOfWeek(endOfMonth(monthStart), { weekStartsOn: 0 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  // Fetch the visible grid padded by a day on each side so timezone shifts
  // between the stored timestamp and the local bucket never drop an entry.
  const from = format(addDays(gridStart, -1), "yyyy-MM-dd");
  const to = format(addDays(gridEnd, 1), "yyyy-MM-dd");
  const { data, isLoading, error } = useCalendarDues(
    from,
    to,
    unitId ?? undefined,
  );

  const duesByDay = groupDuesByDay(data?.data ?? []);
  const monthDues = (data?.data ?? []).filter((due) =>
    isSameMonth(new Date(due.nextCalibrationDate), monthStart),
  );
  const monthOverdue = monthDues.filter(
    (due) => getInstrumentStatus(due).status === "OVERDUE",
  ).length;
  const monthInLab = monthDues.filter((due) => due.inLab).length;

  // Default the selection to today when looking at the current month; month
  // navigation clears any explicit selection.
  const effectiveSelected =
    selectedDay ??
    (isSameMonth(monthStart, new Date()) ? dayKey(new Date()) : null);
  const selectedDues = effectiveSelected
    ? (duesByDay.get(effectiveSelected) ?? [])
    : [];
  const selectedDate = effectiveSelected
    ? new Date(`${effectiveSelected}T12:00:00`)
    : null;

  function goToMonth(value: Date) {
    setSelectedDay(null);
    const sameAsCurrent = isSameMonth(value, new Date());
    onMonthChange(sameAsCurrent ? undefined : toMonthParam(value));
  }

  const monthTitle = MONTH_TITLE.format(monthStart);

  return (
    <div className="portal-shell space-y-6">
      <PageHeader
        eyebrow="Agenda"
        title="Calendário de calibrações"
        description="Vencimentos dos seus instrumentos no mês — planeje as próximas calibrações."
        actions={
          <Button render={<Link to="/requests/new" />}>
            <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
            Solicitar calibração
          </Button>
        }
      />

      <StaggerGroup className="grid gap-3 sm:grid-cols-3">
        <StaggerItem>
          <SignalTile
            icon={Calendar03Icon}
            label="Vencimentos no mês"
            value={isLoading ? "—" : monthDues.length}
            hint={monthTitle}
            tone={monthDues.length > 0 ? "info" : "neutral"}
          />
        </StaggerItem>
        <StaggerItem>
          <SignalTile
            icon={AlertCircleIcon}
            label="Vencidas"
            value={isLoading ? "—" : monthOverdue}
            hint="neste mês"
            tone={monthOverdue > 0 ? "critical" : "ok"}
          />
        </StaggerItem>
        <StaggerItem>
          <SignalTile
            icon={FlaskConicalIcon}
            label="No laboratório"
            value={isLoading ? "—" : monthInLab}
            hint="em atendimento"
            tone={monthInLab > 0 ? "info" : "neutral"}
          />
        </StaggerItem>
      </StaggerGroup>

      {showUnitFilter ? (
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-sm">Unidade:</span>
          <select
            aria-label="Filtrar por unidade"
            value={unitId ?? ""}
            onChange={(event) =>
              setUnitId(event.target.value ? Number(event.target.value) : null)
            }
            className="border-border bg-background h-9 rounded-md border px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <option value="">Todas as unidades</option>
            {units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <Panel className="p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-semibold capitalize tracking-tight">
              {monthTitle}
            </h2>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => goToMonth(addMonths(monthStart, -1))}
                aria-label="Mês anterior"
                className={ACTION_BUTTON_CLASS}
              >
                <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => goToMonth(new Date())}
                className={ACTION_BUTTON_CLASS}
              >
                Hoje
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => goToMonth(addMonths(monthStart, 1))}
                aria-label="Próximo mês"
                className={ACTION_BUTTON_CLASS}
              >
                <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} />
              </Button>
            </div>
          </div>

          {error ? (
            <div className="text-destructive py-8 text-center text-sm">
              Erro ao carregar o calendário. Tente novamente.
            </div>
          ) : (
            <>
              <div className="text-muted-foreground mt-4 grid grid-cols-7 gap-1 text-center font-mono text-[11px] uppercase tracking-[0.16em]">
                {WEEKDAYS.map((weekday) => (
                  <div key={weekday}>{weekday}</div>
                ))}
              </div>
              <div className="mt-1 grid grid-cols-7 gap-1">
                {days.map((day) => {
                  const key = dayKey(day);
                  const dues = duesByDay.get(key) ?? [];
                  const inMonth = isSameMonth(day, monthStart);
                  const selected = effectiveSelected === key;
                  const tone = dues.length > 0 ? worstTone(dues) : null;

                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setSelectedDay(key)}
                      aria-pressed={selected}
                      aria-label={`${formatDateLong(day)}${
                        dues.length > 0
                          ? `, ${dues.length} vencimento${dues.length === 1 ? "" : "s"}`
                          : ""
                      }`}
                      className={cn(
                        "flex min-h-16 flex-col items-start gap-1 rounded-lg border border-transparent p-1.5 text-left transition-[background-color,border-color,box-shadow] hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                        !inMonth && "opacity-40",
                        selected && "border-border bg-muted/60",
                      )}
                    >
                      <span
                        className={cn(
                          "font-mono text-xs tabular-nums",
                          isToday(day)
                            ? "bg-primary text-primary-foreground inline-flex size-5 items-center justify-center rounded-full"
                            : "text-muted-foreground",
                        )}
                      >
                        {day.getDate()}
                      </span>
                      {dues.length > 0 && tone ? (
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium",
                            TONE[tone].surface,
                          )}
                        >
                          <span
                            className={cn(
                              "size-1.5 rounded-full",
                              TONE[tone].dot,
                            )}
                          />
                          {dues.length}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </Panel>

        <Panel className="p-5">
          <PanelHeader
            eyebrow="Detalhe"
            title={
              selectedDate ? formatDateLong(selectedDate) : "Selecione um dia"
            }
            description={
              selectedDate
                ? `${selectedDues.length} vencimento${selectedDues.length === 1 ? "" : "s"} neste dia.`
                : "Clique em um dia do calendário para ver os instrumentos."
            }
          />
          <div className="mt-4 space-y-1">
            {selectedDues.map((due) => {
              const status = getInstrumentStatus(due);
              return (
                <Link
                  key={due.id}
                  to="/assets/$id"
                  params={{ id: due.publicId }}
                  className="hover:bg-muted/60 flex items-center justify-between gap-3 rounded-lg p-2 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{due.name}</p>
                    <p className="text-muted-foreground truncate font-mono text-xs tabular-nums">
                      {due.tag} · {due.assetTypeName}
                    </p>
                  </div>
                  <StatusPill
                    tone={status.tone}
                    size="sm"
                    pulse={status.tone === "critical"}
                  >
                    {status.label}
                  </StatusPill>
                </Link>
              );
            })}
            {selectedDate && selectedDues.length === 0 ? (
              <div className="bg-muted/45 text-muted-foreground rounded-xl p-4 text-sm shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)]">
                Nenhum vencimento neste dia.
              </div>
            ) : null}
          </div>
          {/* One-click recall for everything due on the selected day */}
          {selectedDues.length > 0 ? (
            <Button
              className={cn("mt-4 w-full", ACTION_BUTTON_CLASS)}
              render={
                <Link
                  to="/requests/new"
                  search={{ assetIds: selectedDues.map((due) => due.id) }}
                />
              }
            >
              <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
              Solicitar calibração ({selectedDues.length})
            </Button>
          ) : null}
        </Panel>
      </div>

      <PortalVisitsPanel />
    </div>
  );
}
