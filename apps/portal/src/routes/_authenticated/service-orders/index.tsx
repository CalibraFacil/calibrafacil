import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Cancel01Icon,
  ClipboardIcon,
  PlusSignIcon,
  Search01Icon,
} from "@hugeicons/core-free-icons";

import { Button } from "@calibra-facil/ui/button";
import { StatusBadge } from "@calibra-facil/ui/status-badge";
import {
  SERVICE_ORDER_STATUS,
  type ServiceOrderStatus,
} from "@calibra-facil/shared/service-orders";
import { Card, CardContent } from "@calibra-facil/ui/card";
import { PageHeader } from "@/components/page-header";
import { DataTable } from "@calibra-facil/ui/data-table";
import { DataTableColumnHeader } from "@calibra-facil/ui/data-table-column-header";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@calibra-facil/ui/empty";
import { Input } from "@calibra-facil/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@calibra-facil/ui/select";
import { portalServiceOrdersResponseSchema } from "@calibra-facil/contracts";
import { fetchPortalJson } from "@/lib/api-fetch";
import { keepPreviousDataInScope } from "@/lib/keep-previous-page";
import { usePortalQueryKey } from "@/lib/portal-org-context";
import { formatInstant } from "@calibra-facil/shared/format";

export const Route = createFileRoute("/_authenticated/service-orders/")({
  component: ServiceOrdersPage,
});

type PortalServiceOrder = {
  id: number;
  publicId: string;
  serviceOrderNumber: string;
  status: ServiceOrderStatus;
  statusLabel: string;
  openedAt: string;
  readyAt: string | null;
  assetName: string;
  assetSerialNumber: string | null;
};

type ServiceOrdersResponse = {
  data: Array<PortalServiceOrder>;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

// Module-level so the header/cell renderers are stable component types
// instead of being re-created on every render of the page.
const columns: Array<ColumnDef<PortalServiceOrder>> = [
  {
    accessorKey: "serviceOrderNumber",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="OS" />
    ),
    cell: ({ row }) => (
      <div className="space-y-1">
        <Link
          to="/service-orders/$id"
          params={{ id: row.original.publicId }}
          className="font-medium hover:underline"
        >
          {row.original.serviceOrderNumber}
        </Link>
        <p className="text-xs text-muted-foreground">
          Entrada em {formatInstant(row.original.openedAt, "date")}
        </p>
      </div>
    ),
  },
  {
    accessorKey: "assetSnapshot.assetName",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Instrumento" />
    ),
    cell: ({ row }) => {
      return (
        <div>
          <p className="font-medium">{row.original.assetName}</p>
          <p className="text-xs text-muted-foreground">
            {row.original.assetSerialNumber
              ? `Série: ${row.original.assetSerialNumber}`
              : "Série não informada"}
          </p>
        </div>
      );
    },
  },
  {
    accessorKey: "status",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Status" />
    ),
    cell: ({ row }) => (
      <StatusBadge tone={SERVICE_ORDER_STATUS.tone(row.original.status)}>
        {SERVICE_ORDER_STATUS.label(row.original.status)}
      </StatusBadge>
    ),
  },
  {
    accessorKey: "readyAt",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Pronta em" />
    ),
    cell: ({ row }) => (
      <span className="text-muted-foreground tabular-nums">
        {formatInstant(row.original.readyAt, "date")}
      </span>
    ),
  },
];

function ServiceOrdersPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ServiceOrderStatus | "">("");
  const limit = 20;

  const key = usePortalQueryKey();
  const { data, isLoading, error } = useQuery({
    queryKey: key("portal-service-orders", page, limit, search, statusFilter),
    queryFn: async (): Promise<ServiceOrdersResponse> => {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
      });

      if (search) {
        params.set("query", search);
      }

      if (statusFilter) {
        params.set("status", statusFilter);
      }

      return fetchPortalJson(
        `/api/portal/service-orders?${params.toString()}`,
        portalServiceOrdersResponseSchema,
        { errorMessage: "Falha ao carregar ordens de serviço." },
      );
    },
    placeholderData: keepPreviousDataInScope(key("portal-service-orders")),
  });

  return (
    <div className="portal-shell space-y-6">
      <PageHeader
        title="Ordens de serviço"
        description="Acompanhe instrumentos recebidos, orçamentos e documentos."
      />
      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap">
              <div className="relative min-w-50 flex-1 sm:max-w-sm">
                <HugeiconsIcon
                  icon={Search01Icon}
                  className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  placeholder="Buscar por OS, instrumento ou série..."
                  aria-label="Buscar por OS, instrumento ou série"
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
                  setStatusFilter(SERVICE_ORDER_STATUS.parse(value) ?? "");
                  setPage(1);
                }}
              >
                <SelectTrigger
                  aria-label="Filtrar por status"
                  className="w-full sm:w-56"
                >
                  <span>
                    {statusFilter
                      ? SERVICE_ORDER_STATUS.label(statusFilter)
                      : "Status"}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  {SERVICE_ORDER_STATUS.options.map(({ value, label }) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {(search || statusFilter) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearch("");
                    setStatusFilter("");
                    setPage(1);
                  }}
                  className="h-9"
                >
                  <HugeiconsIcon icon={Cancel01Icon} className="mr-2 size-4" />
                  Limpar filtros
                </Button>
              )}
            </div>
          </div>

          {error ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
              {error instanceof Error ? error.message : "Erro ao carregar OS."}
            </div>
          ) : !isLoading && (data?.data.length ?? 0) === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <HugeiconsIcon icon={ClipboardIcon} />
                </EmptyMedia>
                <EmptyTitle>Nenhuma ordem de serviço encontrada</EmptyTitle>
                <EmptyDescription>
                  {search || statusFilter
                    ? "Nenhuma OS corresponde aos filtros aplicados."
                    : "As ordens de serviço abertas pelo laboratório aparecerão aqui."}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                {search || statusFilter ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSearch("");
                      setStatusFilter("");
                      setPage(1);
                    }}
                  >
                    Limpar filtros
                  </Button>
                ) : (
                  <Button render={<Link to="/requests/new" />}>
                    <HugeiconsIcon
                      icon={PlusSignIcon}
                      className="mr-2 size-4"
                    />
                    Solicitar calibração
                  </Button>
                )}
              </EmptyContent>
            </Empty>
          ) : (
            <DataTable
              columns={columns}
              data={data?.data ?? []}
              isLoading={isLoading}
              pagination={{
                page,
                limit,
                total: data?.pagination.total ?? 0,
                totalPages: data?.pagination.totalPages ?? 1,
              }}
              onPageChange={setPage}
              itemName="ordens de serviço"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
