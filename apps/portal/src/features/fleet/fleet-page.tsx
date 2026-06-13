import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  type OnChangeFn,
  type SortingState,
} from "@tanstack/react-table";
import {
  Add01Icon,
  AlertCircleIcon,
  Cancel01Icon,
  CalendarRemove01Icon,
  CheckmarkCircle01Icon,
  FlaskConicalIcon,
  Search01Icon,
  Time04Icon,
  Wrench01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import {
  Panel,
  SignalTile,
  StaggerGroup,
  StaggerItem,
  type SignalTone,
} from "@/components/instrument-panel";
import { TONE } from "@/components/status-pill";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/format";
import { useOverview } from "@/features/dashboard/queries";
import { type CalibrationFilter } from "@/lib/calibration-status";
import { fleetColumns } from "./columns";
import { useFleetAssets } from "./queries";
import { isFleetSortBy } from "./types";

type IconType = Parameters<typeof HugeiconsIcon>[0]["icon"];

const FILTERS: Array<{
  value: CalibrationFilter | "all";
  label: string;
  tone: SignalTone;
}> = [
  { value: "all", label: "Todas", tone: "neutral" },
  { value: "overdue", label: "Vencidas", tone: "critical" },
  { value: "due_soon", label: "Vencem em breve", tone: "warning" },
  { value: "scheduled", label: "Em dia", tone: "ok" },
  { value: "in_lab", label: "No laboratório", tone: "info" },
  { value: "unscheduled", label: "Sem agenda", tone: "neutral" },
];

/** The compliance vitals strip — each tile sets a `dueStatus` filter. */
const VITALS: Array<{
  filter: CalibrationFilter;
  label: string;
  icon: IconType;
  tone: SignalTone;
  hint: string;
}> = [
  {
    filter: "overdue",
    label: "Vencidas",
    icon: AlertCircleIcon,
    tone: "critical",
    hint: "atenção",
  },
  {
    filter: "due_soon",
    label: "Vencem em breve",
    icon: Time04Icon,
    tone: "warning",
    hint: "30 dias",
  },
  {
    filter: "scheduled",
    label: "Em dia",
    icon: CheckmarkCircle01Icon,
    tone: "ok",
    hint: "agendadas",
  },
  {
    filter: "in_lab",
    label: "No laboratório",
    icon: FlaskConicalIcon,
    tone: "info",
    hint: "em atendimento",
  },
  {
    filter: "unscheduled",
    label: "Sem agenda",
    icon: CalendarRemove01Icon,
    tone: "neutral",
    hint: "sem data",
  },
];

const DEFAULT_SORT: SortingState = [{ id: "tag", desc: false }];

export function FleetPage({
  dueStatus,
  onDueStatusChange,
}: {
  dueStatus?: CalibrationFilter;
  onDueStatusChange: (value?: CalibrationFilter) => void;
}) {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [sorting, setSorting] = useState<SortingState>(DEFAULT_SORT);
  const limit = 20;

  const overviewQuery = useOverview();
  const equipment = overviewQuery.data?.equipment;
  const vitalCounts: Record<CalibrationFilter, number | null> = {
    overdue: equipment?.overdue ?? null,
    due_soon: equipment?.dueSoon ?? null,
    scheduled: equipment?.scheduled ?? null,
    in_lab: equipment?.inLab ?? null,
    unscheduled: equipment?.unscheduled ?? null,
  };

  const primarySort = sorting[0] ?? DEFAULT_SORT[0];
  const sortBy = isFleetSortBy(primarySort.id) ? primarySort.id : "tag";
  const sortDir = primarySort.desc ? "desc" : "asc";

  const { data, isLoading, error, dataUpdatedAt } = useFleetAssets({
    page,
    limit,
    query: search || undefined,
    dueStatus,
    sortBy,
    sortDir,
  });

  const hasFilters = Boolean(search || dueStatus);

  const handleSortingChange: OnChangeFn<SortingState> = (updater) => {
    setPage(1);
    setSorting(updater);
  };

  function selectFilter(value: CalibrationFilter | "all") {
    setPage(1);
    onDueStatusChange(value === "all" ? undefined : value);
  }

  /** A tile click is a soft toggle: pick the filter, or clear it if active. */
  function toggleVital(filter: CalibrationFilter) {
    selectFilter(dueStatus === filter ? "all" : filter);
  }

  function clearFilters() {
    setSearch("");
    setPage(1);
    onDueStatusChange(undefined);
  }

  return (
    <div className="portal-shell space-y-6">
      <PageHeader
        eyebrow="Equipamentos"
        title="Meus equipamentos"
        description="Acompanhe o status de calibração dos seus instrumentos e solicite novas calibrações."
        actions={
          <Button render={<Link to="/requests/new" />}>
            <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
            Solicitar calibração
          </Button>
        }
      />

      {/* Compliance vitals — instrument indicators that double as filters */}
      <StaggerGroup className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {VITALS.map((vital) => {
          const active = dueStatus === vital.filter;
          const count = vitalCounts[vital.filter];
          return (
            <StaggerItem key={vital.filter}>
              <button
                type="button"
                onClick={() => toggleVital(vital.filter)}
                aria-pressed={active}
                className={cn(
                  "block w-full rounded-xl text-left transition-[box-shadow,transform] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                  active && "ring-2 ring-ring/50",
                )}
              >
                <SignalTile
                  icon={vital.icon}
                  label={vital.label}
                  value={count ?? "—"}
                  hint={vital.hint}
                  tone={vital.tone}
                />
              </button>
            </StaggerItem>
          );
        })}
      </StaggerGroup>

      {/* Calibration-status filter chips */}
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((filter) => {
          const active =
            filter.value === "all" ? !dueStatus : filter.value === dueStatus;
          return (
            <button
              key={filter.value}
              type="button"
              onClick={() => selectFilter(filter.value)}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-[background-color,border-color,color,transform] active:scale-[0.96]",
                active
                  ? cn(TONE[filter.tone].surface, "border-transparent")
                  : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {filter.value !== "all" ? (
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    active ? TONE[filter.tone].dot : "bg-muted-foreground/40",
                  )}
                />
              ) : null}
              {filter.label}
            </button>
          );
        })}
      </div>

      <Panel className="space-y-4 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="relative min-w-50 flex-1">
            <HugeiconsIcon
              icon={Search01Icon}
              className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2"
              strokeWidth={2}
            />
            <Input
              placeholder="Buscar por nome, tag, série..."
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              className="pl-9"
            />
          </div>
          {hasFilters ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              className="h-9"
            >
              <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
              Limpar filtros
            </Button>
          ) : null}
        </div>

        {error ? (
          <div className="text-destructive py-8 text-center">
            Erro ao carregar equipamentos. Tente novamente.
          </div>
        ) : null}

        {!isLoading && !error && data?.data?.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HugeiconsIcon icon={Wrench01Icon} />
              </EmptyMedia>
              <EmptyTitle>Nenhum equipamento encontrado</EmptyTitle>
              <EmptyDescription>
                {hasFilters
                  ? "Nenhum equipamento corresponde aos filtros aplicados."
                  : "Quando houver instrumentos vinculados à sua organização, eles aparecerão aqui."}
              </EmptyDescription>
            </EmptyHeader>
            {hasFilters ? (
              <EmptyContent>
                <Button variant="outline" onClick={clearFilters}>
                  Limpar filtros
                </Button>
              </EmptyContent>
            ) : null}
          </Empty>
        ) : null}

        {!isLoading && !error && data?.data && data.data.length > 0 ? (
          <>
            <DataTable
              columns={fleetColumns}
              data={data.data}
              pagination={data.pagination}
              onPageChange={setPage}
              sorting={sorting}
              onSortingChange={handleSortingChange}
              onRowClick={(asset) => {
                void navigate({
                  to: "/assets/$id",
                  params: { id: String(asset.id) },
                });
              }}
              itemName="equipamentos"
            />
            {/* Single source of truth is the lab's job/asset state — say when
                this snapshot of it was taken. */}
            <p className="text-muted-foreground text-right font-mono text-[11px] tabular-nums">
              Dados atualizados em {formatDateTime(new Date(dataUpdatedAt))}
            </p>
          </>
        ) : null}

        {isLoading && !data ? (
          <DataTable columns={fleetColumns} data={[]} isLoading={true} />
        ) : null}
      </Panel>
    </div>
  );
}
