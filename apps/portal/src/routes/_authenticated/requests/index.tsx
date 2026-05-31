import { Link, createFileRoute } from "@tanstack/react-router";
import { type ColumnDef } from "@tanstack/react-table";
import { useQuery } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  Alert02Icon,
  Cancel01Icon,
  DashboardSquare01Icon,
  Notebook01Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { useDeferredValue, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { DataTableColumnHeader } from "@/components/ui/data-table-column-header";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { PageHeader } from "@/components/page-header";
import {
  Panel,
  SignalTile,
  StaggerGroup,
  StaggerItem,
  type SignalTone,
} from "@/components/instrument-panel";
import { StatusPill } from "@/components/status-pill";
import { useOverview } from "@/features/dashboard/queries";
import { cn, getApiBaseUrl } from "@/lib/utils";
import { formatDate, pluralize } from "@/lib/format";
import {
  REQUEST_STATUS,
  getRequestStatus,
  normalizeRequestStatus,
  type RequestStatus,
} from "@/lib/status-labels";

type RequestsSearch = {
  status?: RequestStatus;
};

export const Route = createFileRoute("/_authenticated/requests/")({
  validateSearch: (search: Record<string, unknown>): RequestsSearch => {
    const status = search.status;
    if (typeof status !== "string" || !(status in REQUEST_STATUS)) {
      return {};
    }
    return { status: normalizeRequestStatus(status) };
  },
  component: RequestsPage,
});

type CalibrationRequest = {
  id: number;
  status: RequestStatus;
  observations: string | null;
  requestedDueDate: string | null;
  submittedAt: string;
  reviewedAt: string | null;
  approvedAt: string | null;
  convertedAt: string | null;
  customerName: string;
  itemCount: number;
};

type RequestsResponse = {
  data: Array<CalibrationRequest>;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

function getPortalErrorMessage(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const errorBody = Object.fromEntries(Object.entries(payload));
  if (typeof errorBody.error === "string") return errorBody.error;
  if (!Array.isArray(errorBody.errors)) return null;

  return errorBody.errors
    .flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const message = Object.fromEntries(Object.entries(item)).message;
      return typeof message === "string" ? [message] : [];
    })
    .join(", ");
}

function RequestsPage() {
  const { status: initialStatus } = Route.useSearch();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<RequestStatus | "">(
    initialStatus ?? "",
  );
  const deferredSearch = useDeferredValue(search.trim());
  const limit = 20;

  const overview = useOverview();
  const requestStats = overview.data?.requests;

  const { data, isLoading, error } = useQuery({
    queryKey: ["portal-requests", page, limit, deferredSearch, statusFilter],
    queryFn: async (): Promise<RequestsResponse> => {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
      });
      if (deferredSearch) params.set("query", deferredSearch);
      if (statusFilter) params.set("status", statusFilter);

      const response = await fetch(
        `${getApiBaseUrl()}/api/portal/requests?${params.toString()}`,
        { credentials: "include" },
      );

      if (!response.ok) {
        let errorMessage = `Falha ao carregar solicitacoes (${response.status})`;
        const jsonResponse = response.clone();
        try {
          const errorBody: unknown = await jsonResponse.json();
          errorMessage = getPortalErrorMessage(errorBody) || errorMessage;
        } catch {
          try {
            const errorText = await response.text();
            if (errorText.trim()) {
              errorMessage = `${errorText.trim()} (${response.status})`;
            }
          } catch {
            // Ignore parse failures and keep the default message.
          }
        }
        throw new Error(errorMessage);
      }

      return response.json();
    },
  });

  function applyStatusFilter(next: RequestStatus | "") {
    setStatusFilter(next);
    setPage(1);
  }

  function clearFilters() {
    setSearch("");
    setStatusFilter("");
    setPage(1);
  }

  const columns: Array<ColumnDef<CalibrationRequest>> = useMemo(
    () => [
      {
        accessorKey: "id",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Solicitação" />
        ),
        cell: ({ row }) => (
          <div className="space-y-0.5">
            <Link
              to="/requests/$id"
              params={{ id: String(row.original.id) }}
              className="font-medium hover:underline"
            >
              Solicitação{" "}
              <span className="font-mono tabular-nums">#{row.original.id}</span>
            </Link>
            <p className="text-muted-foreground text-xs">
              {pluralize(row.original.itemCount, "ativo", "ativos")}
            </p>
          </div>
        ),
      },
      {
        accessorKey: "submittedAt",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Enviada em" />
        ),
        cell: ({ row }) => (
          <span className="text-muted-foreground font-mono tabular-nums">
            {formatDate(row.original.submittedAt)}
          </span>
        ),
      },
      {
        accessorKey: "requestedDueDate",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Prazo solicitado" />
        ),
        cell: ({ row }) => (
          <span className="text-muted-foreground font-mono tabular-nums">
            {formatDate(row.original.requestedDueDate)}
          </span>
        ),
      },
      {
        accessorKey: "status",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Status" />
        ),
        cell: ({ row }) => {
          const status = getRequestStatus(row.original.status);
          return (
            <StatusPill tone={status.tone} size="sm">
              {status.label}
            </StatusPill>
          );
        },
      },
    ],
    [],
  );

  const hasFilters = Boolean(deferredSearch || statusFilter);

  return (
    <div className="portal-shell space-y-6">
      <PageHeader
        eyebrow="Solicitações"
        title="Solicitações de calibração"
        description="Acompanhe os pedidos enviados ao laboratório, do envio à conversão em certificado."
        actions={
          <Button render={<Link to="/requests/new" />}>
            <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
            Nova solicitação
          </Button>
        }
      />

      {requestStats ? (
        <StaggerGroup className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StaggerItem>
            <SummaryTile
              icon={Notebook01Icon}
              label="Abertas"
              value={requestStats.open}
              tone={requestStats.open > 0 ? "info" : "neutral"}
              active={statusFilter === "PENDING"}
              onClick={() =>
                applyStatusFilter(statusFilter === "PENDING" ? "" : "PENDING")
              }
            />
          </StaggerItem>
          <StaggerItem>
            <SummaryTile
              icon={Alert02Icon}
              label="Recusadas"
              value={requestStats.rejected}
              tone={requestStats.rejected > 0 ? "critical" : "neutral"}
              active={statusFilter === "REJECTED"}
              onClick={() =>
                applyStatusFilter(statusFilter === "REJECTED" ? "" : "REJECTED")
              }
            />
          </StaggerItem>
          <StaggerItem>
            <SummaryTile
              icon={DashboardSquare01Icon}
              label="Total"
              value={requestStats.total}
              tone="neutral"
              active={statusFilter === ""}
              onClick={() => applyStatusFilter("")}
            />
          </StaggerItem>
        </StaggerGroup>
      ) : null}

      <Panel className="space-y-4 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="relative min-w-50 flex-1 sm:max-w-sm">
            <HugeiconsIcon
              icon={Search01Icon}
              className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2"
              strokeWidth={2}
              aria-hidden="true"
            />
            <Input
              placeholder="Buscar por número ou observações..."
              aria-label="Buscar por número ou observações"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              className="pl-9"
            />
          </div>

          <Select
            value={statusFilter || "all"}
            onValueChange={(value) => {
              applyStatusFilter(
                value && value !== "all" ? normalizeRequestStatus(value) : "",
              );
            }}
          >
            <SelectTrigger className="w-full sm:w-48">
              <span>
                {statusFilter ? REQUEST_STATUS[statusFilter].label : "Status"}
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              {Object.entries(REQUEST_STATUS).map(([value, meta]) => (
                <SelectItem key={value} value={value}>
                  {meta.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

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
          <div className="bg-destructive/10 text-destructive rounded-xl p-4 text-center text-sm shadow-[inset_0_0_0_1px_rgba(220,38,38,0.25)]">
            {error.message}
          </div>
        ) : null}

        {!error && !isLoading && (data?.data.length ?? 0) === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HugeiconsIcon icon={Notebook01Icon} />
              </EmptyMedia>
              <EmptyTitle>Nenhuma solicitação encontrada</EmptyTitle>
              <EmptyDescription>
                {hasFilters
                  ? "Nenhuma solicitação corresponde aos filtros aplicados."
                  : "Envie sua primeira solicitação de calibração para começar."}
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              {hasFilters ? (
                <Button variant="outline" onClick={clearFilters}>
                  Limpar filtros
                </Button>
              ) : (
                <Button render={<Link to="/requests/new" />}>
                  <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
                  Criar solicitação
                </Button>
              )}
            </EmptyContent>
          </Empty>
        ) : null}

        {!error && ((data?.data.length ?? 0) > 0 || isLoading) ? (
          <DataTable
            columns={columns}
            data={data?.data ?? []}
            isLoading={isLoading}
            pagination={data?.pagination}
            onPageChange={setPage}
            itemName="solicitações"
          />
        ) : null}
      </Panel>
    </div>
  );
}

function SummaryTile({
  icon,
  label,
  value,
  tone,
  active,
  onClick,
}: {
  icon: Parameters<typeof SignalTile>[0]["icon"];
  label: string;
  value: number;
  tone: SignalTone;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "block w-full rounded-xl text-left transition-[box-shadow,transform] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
        active && "ring-2 ring-ring/60",
      )}
    >
      <SignalTile icon={icon} label={label} value={value} tone={tone} />
    </button>
  );
}
