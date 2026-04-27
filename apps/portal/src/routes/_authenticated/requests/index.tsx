import { Link, createFileRoute } from "@tanstack/react-router";
import { type ColumnDef } from "@tanstack/react-table";
import { useQuery } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  Cancel01Icon,
  Notebook01Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { useDeferredValue, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { DataTableColumnHeader } from "@/components/ui/data-table-column-header";
import { Badge } from "@/components/ui/badge";
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

export const Route = createFileRoute("/_authenticated/requests/")({
  component: RequestsPage,
});

type RequestStatus =
  | "PENDING"
  | "UNDER_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "CONVERTED";

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

const statusLabels: Record<RequestStatus, string> = {
  PENDING: "Pendente",
  UNDER_REVIEW: "Em análise",
  APPROVED: "Aprovada",
  REJECTED: "Rejeitada",
  CONVERTED: "Convertida",
};

const statusVariants: Record<
  RequestStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  PENDING: "secondary",
  UNDER_REVIEW: "outline",
  APPROVED: "default",
  REJECTED: "destructive",
  CONVERTED: "outline",
};

function formatDate(date: string | null | undefined) {
  if (!date) return "-";
  return new Date(date).toLocaleDateString("pt-BR");
}

function RequestsPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<RequestStatus | "">("");
  const deferredSearch = useDeferredValue(search.trim());
  const limit = 20;

  const { data, isLoading, error } = useQuery({
    queryKey: ["portal-requests", page, limit, deferredSearch, statusFilter],
    queryFn: async (): Promise<RequestsResponse> => {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
      });

      if (deferredSearch) {
        params.set("query", deferredSearch);
      }

      if (statusFilter) {
        params.set("status", statusFilter);
      }

      const response = await fetch(
        `${getApiBaseUrl()}/api/portal/requests?${params.toString()}`,
        {
          credentials: "include",
        },
      );

      if (!response.ok) {
        let errorMessage = `Falha ao carregar solicitacoes (${response.status})`;
        const jsonResponse = response.clone();

        try {
          const errorBody = (await jsonResponse.json()) as
            | {
                error?: string;
                errors?: Array<{ message?: string }>;
              }
            | undefined;

          errorMessage =
            errorBody?.error ||
            errorBody?.errors
              ?.map((item) => item.message)
              .filter(Boolean)
              .join(", ") ||
            errorMessage;
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

  const columns: Array<ColumnDef<CalibrationRequest>> = useMemo(
    () => [
      {
        accessorKey: "id",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Solicitação" />
        ),
        cell: ({ row }) => (
          <div className="space-y-1">
            <Link
              to="/requests/$id"
              params={{ id: String(row.original.id) }}
              className="font-medium hover:underline"
            >
              Solicitação #{row.original.id}
            </Link>
            <p className="text-xs text-muted-foreground">
              {row.original.itemCount} ativo(s)
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
          <span className="text-muted-foreground">
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
          <span className="text-muted-foreground">
            {formatDate(row.original.requestedDueDate)}
          </span>
        ),
      },
      {
        accessorKey: "observations",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Observações" />
        ),
        cell: ({ row }) => (
          <p className="max-w-[28rem] truncate text-muted-foreground">
            {row.original.observations?.trim() || "Sem observações informadas."}
          </p>
        ),
      },
      {
        accessorKey: "status",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Status" />
        ),
        cell: ({ row }) => (
          <Badge variant={statusVariants[row.original.status]}>
            {statusLabels[row.original.status]}
          </Badge>
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Solicitações de Calibração</CardTitle>
              <CardDescription>
                Acompanhe as solicitações enviadas ao laboratório.
              </CardDescription>
            </div>

            <Button render={<Link to="/requests/new" />}>
              <HugeiconsIcon icon={Add01Icon} className="mr-2 size-4" />
              Nova Solicitação
            </Button>
          </div>
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
                  placeholder="Buscar por número ou observações..."
                  aria-label="Buscar por número ou observações"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  className="pl-9"
                />
              </div>

              <Select
                value={statusFilter || "all"}
                onValueChange={(value) => {
                  setStatusFilter(
                    value === "all" ? "" : (value as RequestStatus),
                  );
                  setPage(1);
                }}
              >
                <SelectTrigger className="w-full sm:w-48">
                  <span>
                    {statusFilter ? statusLabels[statusFilter] : "Status"}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  {Object.entries(statusLabels).map(([value, label]) => (
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

          {error && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-center text-sm text-destructive">
              {error.message}
            </div>
          )}

          {!error &&
            !isLoading &&
            (data?.data.length ?? 0) === 0 && (
              <Empty className="border">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <HugeiconsIcon icon={Notebook01Icon} />
                  </EmptyMedia>
                  <EmptyTitle>Nenhuma solicitação encontrada</EmptyTitle>
                  <EmptyDescription>
                    {deferredSearch || statusFilter
                      ? "Nenhuma solicitação corresponde aos filtros aplicados."
                      : "Envie sua primeira solicitação de calibração para começar."}
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  {deferredSearch || statusFilter ? (
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
                        icon={Add01Icon}
                        className="mr-2 size-4"
                      />
                      Criar Solicitação
                    </Button>
                  )}
                </EmptyContent>
              </Empty>
            )}

          {!error &&
            ((data?.data.length ?? 0) > 0 || isLoading) && (
              <DataTable
                columns={columns}
                data={data?.data ?? []}
                isLoading={isLoading}
                pagination={data?.pagination}
                onPageChange={setPage}
                itemName="solicitações"
              />
            )}
        </CardContent>
      </Card>
    </div>
  );
}
