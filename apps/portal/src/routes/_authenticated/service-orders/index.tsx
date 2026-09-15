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

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { getApiBaseUrl } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/service-orders/")({
  component: ServiceOrdersPage,
});

type ServiceOrderStatus =
  | "opened"
  | "awaiting_tech_evaluation"
  | "under_evaluation"
  | "awaiting_quote_approval"
  | "quote_approved"
  | "quote_rejected"
  | "repair_in_progress"
  | "awaiting_calibration"
  | "calibration_in_progress"
  | "awaiting_final_review"
  | "ready_for_pickup"
  | "delivered"
  | "closed"
  | "canceled"
  | "warranty_return";

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

const statusLabels: Record<ServiceOrderStatus, string> = {
  opened: "Aberta",
  awaiting_tech_evaluation: "Aguardando avaliação",
  under_evaluation: "Em avaliação",
  awaiting_quote_approval: "Aguardando orçamento",
  quote_approved: "Orçamento aprovado",
  quote_rejected: "Orçamento recusado",
  repair_in_progress: "Em reparo",
  awaiting_calibration: "Aguardando calibração",
  calibration_in_progress: "Calibração em andamento",
  awaiting_final_review: "Aguardando revisão",
  ready_for_pickup: "Aguardando retirada",
  delivered: "Entregue",
  closed: "Encerrada",
  canceled: "Cancelada",
  warranty_return: "Retorno em garantia",
};

const statusVariants: Record<
  ServiceOrderStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  opened: "secondary",
  awaiting_tech_evaluation: "outline",
  under_evaluation: "default",
  awaiting_quote_approval: "outline",
  quote_approved: "default",
  quote_rejected: "destructive",
  repair_in_progress: "default",
  awaiting_calibration: "outline",
  calibration_in_progress: "default",
  awaiting_final_review: "outline",
  ready_for_pickup: "default",
  delivered: "secondary",
  closed: "secondary",
  canceled: "destructive",
  warranty_return: "outline",
};

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("pt-BR");
}

function parseServiceOrderStatusFilter(
  value: string | null,
): ServiceOrderStatus | "" {
  switch (value) {
    case "opened":
    case "awaiting_tech_evaluation":
    case "under_evaluation":
    case "awaiting_quote_approval":
    case "quote_approved":
    case "quote_rejected":
    case "repair_in_progress":
    case "awaiting_calibration":
    case "calibration_in_progress":
    case "awaiting_final_review":
    case "ready_for_pickup":
    case "delivered":
    case "closed":
    case "canceled":
    case "warranty_return":
      return value;
    default:
      return "";
  }
}

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
          Entrada em {formatDate(row.original.openedAt)}
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
      <Badge variant={statusVariants[row.original.status] ?? "secondary"}>
        {row.original.statusLabel ||
          statusLabels[row.original.status] ||
          row.original.status}
      </Badge>
    ),
  },
  {
    accessorKey: "readyAt",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Pronta em" />
    ),
    cell: ({ row }) => (
      <span className="text-muted-foreground tabular-nums">
        {formatDate(row.original.readyAt)}
      </span>
    ),
  },
];

function ServiceOrdersPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ServiceOrderStatus | "">("");
  const limit = 20;

  const { data, isLoading, error } = useQuery({
    queryKey: ["portal-service-orders", page, limit, search, statusFilter],
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

      const response = await fetch(
        `${getApiBaseUrl()}/api/portal/service-orders?${params.toString()}`,
        { credentials: "include" },
      );

      if (!response.ok) {
        throw new Error("Falha ao carregar ordens de serviço.");
      }

      const result: ServiceOrdersResponse = await response.json();
      return result;
    },
  });

  return (
    <div className="portal-shell space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Ordens de Serviço</CardTitle>
          <CardDescription>
            Acompanhe instrumentos recebidos, orçamentos e documentos.
          </CardDescription>
        </CardHeader>
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
                  setStatusFilter(parseServiceOrderStatusFilter(value));
                  setPage(1);
                }}
              >
                <SelectTrigger className="w-full sm:w-56">
                  <span>
                    {statusFilter ? statusLabels[statusFilter] : "Status"}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  {Object.entries(statusLabels).map(([status, label]) => (
                    <SelectItem key={status} value={status}>
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
