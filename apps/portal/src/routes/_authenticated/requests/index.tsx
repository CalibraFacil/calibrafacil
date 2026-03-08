import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useDeferredValue, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  Notebook01Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
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

const statusClasses: Record<RequestStatus, string> = {
  PENDING: "bg-amber-100 text-amber-800",
  UNDER_REVIEW: "bg-blue-100 text-blue-800",
  APPROVED: "bg-emerald-100 text-emerald-800",
  REJECTED: "bg-rose-100 text-rose-800",
  CONVERTED: "bg-violet-100 text-violet-800",
};

function formatDate(date: string | null | undefined) {
  if (!date) return "-";
  return new Date(date).toLocaleDateString("pt-BR");
}

function RequestsPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const limit = 20;

  useEffect(() => {
    setPage(1);
  }, [deferredSearch]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["portal-requests", page, limit, deferredSearch],
    queryFn: async (): Promise<RequestsResponse> => {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
      });

      if (deferredSearch) {
        params.set("query", deferredSearch);
      }

      const response = await fetch(
        `${getApiBaseUrl()}/api/portal/requests?${params.toString()}`,
        {
          credentials: "include",
        },
      );

      if (!response.ok) {
        throw new Error("Falha ao carregar solicitacoes");
      }

      return response.json();
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Solicitações de Calibração
          </h1>
          <p className="text-sm text-muted-foreground">
            Acompanhe as solicitações enviadas ao laboratório.
          </p>
        </div>

        <Button render={<Link to="/requests/new" />}>
          <HugeiconsIcon icon={Add01Icon} className="mr-2 size-4" />
          Nova Solicitação
        </Button>
      </div>

      <div className="relative w-full sm:max-w-sm">
        <HugeiconsIcon
          icon={Search01Icon}
          className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          placeholder="Buscar por número ou observações..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-10">
          <Spinner className="size-8" />
        </div>
      )}

      {error && (
        <Card>
          <CardContent className="py-6 text-center text-destructive">
            Erro ao carregar solicitações.
          </CardContent>
        </Card>
      )}

      {!isLoading && !error && (data?.data.length ?? 0) === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-primary/10">
              <HugeiconsIcon
                icon={Notebook01Icon}
                className="size-6 text-primary"
              />
            </div>
            <div>
              <h2 className="font-medium">Nenhuma solicitação encontrada</h2>
              <p className="text-sm text-muted-foreground">
                {deferredSearch
                  ? "Tente ajustar os termos da busca."
                  : "Envie sua primeira solicitação de calibração para começar."}
              </p>
            </div>
            {!deferredSearch && (
              <Button render={<Link to="/requests/new" />}>
                Criar Solicitação
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {!isLoading && !error && (data?.data.length ?? 0) > 0 && (
        <div className="space-y-4">
          {data?.data.map((request) => (
            <Card
              key={request.id}
              className="cursor-pointer transition-colors hover:bg-muted/30"
              onClick={() =>
                navigate({
                  to: "/requests/$id",
                  params: { id: String(request.id) },
                })
              }
            >
              <CardContent className="flex flex-col gap-4 py-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">
                        Solicitação #{request.id}
                      </span>
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${statusClasses[request.status]}`}
                      >
                        {statusLabels[request.status]}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {request.itemCount} ativo(s) · Enviada em{" "}
                      {formatDate(request.submittedAt)}
                    </p>
                  </div>

                  <div className="text-sm text-muted-foreground">
                    Prazo solicitado: {formatDate(request.requestedDueDate)}
                  </div>
                </div>

                <p className="text-sm text-muted-foreground">
                  {request.observations?.trim()
                    ? request.observations
                    : "Sem observações informadas."}
                </p>
              </CardContent>
            </Card>
          ))}

          {data && data.pagination.totalPages > 1 && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                Página {data.pagination.page} de {data.pagination.totalPages}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setPage((currentPage) => Math.max(1, currentPage - 1))
                  }
                  disabled={page === 1}
                >
                  Anterior
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setPage((currentPage) =>
                      Math.min(data.pagination.totalPages, currentPage + 1),
                    )
                  }
                  disabled={page === data.pagination.totalPages}
                >
                  Próxima
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
