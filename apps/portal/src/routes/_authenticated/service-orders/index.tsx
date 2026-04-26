import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";

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
import { getApiBaseUrl } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/service-orders/")({
  component: ServiceOrdersPage,
});

type PortalServiceOrder = {
  id: number;
  serviceOrderNumber: string;
  status: string;
  openedAt: string;
  claimedDefect: string | null;
  assetSnapshot?: {
    assetName?: string | null;
    manufacturer?: string | null;
    model?: string | null;
    serialNumber?: string | null;
    patrimonyNumber?: string | null;
  } | null;
  quotes?: Array<{
    id: number;
    status: string;
    totalCents: number;
  }>;
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

const statusLabels: Record<string, string> = {
  opened: "Aberta",
  awaiting_tech_evaluation: "Aguardando avaliação",
  under_evaluation: "Em avaliação",
  awaiting_quote_approval: "Aguardando aprovação",
  quote_approved: "Orçamento aprovado",
  quote_rejected: "Orçamento recusado",
  repair_in_progress: "Em reparo",
  awaiting_calibration: "Aguardando calibração",
  calibration_in_progress: "Em calibração",
  awaiting_final_review: "Revisão final",
  ready_for_pickup: "Aguardando retirada",
  delivered: "Entregue",
  closed: "Encerrada",
  canceled: "Cancelada",
};

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("pt-BR");
}

function formatMoney(cents: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format((cents ?? 0) / 100);
}

function ServiceOrdersPage() {
  const [page, setPage] = useState(1);
  const limit = 20;

  const { data, isLoading, error } = useQuery({
    queryKey: ["portal-service-orders", page, limit],
    queryFn: async (): Promise<ServiceOrdersResponse> => {
      const response = await fetch(
        `${getApiBaseUrl()}/api/portal/service-orders?page=${page}&limit=${limit}`,
        { credentials: "include" },
      );

      if (!response.ok) {
        throw new Error("Falha ao carregar ordens de serviço.");
      }

      const result = (await response.json()) as {
        data: ServiceOrdersResponse["data"];
        pagination: ServiceOrdersResponse["pagination"];
      };
      return result;
    },
  });

  const columns: Array<ColumnDef<PortalServiceOrder>> = useMemo(
    () => [
      {
        accessorKey: "serviceOrderNumber",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="OS" />
        ),
        cell: ({ row }) => (
          <div className="space-y-1">
            <Link
              to="/service-orders/$id"
              params={{ id: String(row.original.id) }}
              className="font-medium hover:underline"
            >
              {row.original.serviceOrderNumber}
            </Link>
            <p className="text-xs text-muted-foreground">
              {formatDate(row.original.openedAt)}
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
          const snapshot = row.original.assetSnapshot;
          return (
            <div>
              <p className="font-medium">
                {snapshot?.assetName || "Instrumento recebido"}
              </p>
              <p className="text-xs text-muted-foreground">
                {[snapshot?.manufacturer, snapshot?.model, snapshot?.serialNumber]
                  .filter(Boolean)
                  .join(" | ") || "Identificação não informada"}
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
          <span className="inline-flex rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium">
            {statusLabels[row.original.status] ?? row.original.status}
          </span>
        ),
      },
      {
        accessorKey: "claimedDefect",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Defeito reclamado" />
        ),
        cell: ({ row }) => (
          <p className="max-w-[26rem] truncate text-muted-foreground">
            {row.original.claimedDefect || "-"}
          </p>
        ),
      },
      {
        id: "quote",
        header: "Orçamento",
        cell: ({ row }) => {
          const quote = row.original.quotes?.[0];
          if (!quote) return <span className="text-muted-foreground">-</span>;
          return (
            <span className="text-muted-foreground">
              {formatMoney(quote.totalCents)}
            </span>
          );
        },
      },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Ordens de Serviço</CardTitle>
          <CardDescription>
            Acompanhe instrumentos recebidos, orçamentos e documentos.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
              {error instanceof Error ? error.message : "Erro ao carregar OS."}
            </div>
          ) : !isLoading && (data?.data.length ?? 0) === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-10 text-center">
              <p className="text-sm text-muted-foreground">
                Nenhuma ordem de serviço encontrada.
              </p>
              <Button variant="outline" render={<Link to="/requests/new" />}>
                Solicitar calibração
              </Button>
            </div>
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
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
