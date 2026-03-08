import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { getApiBaseUrl } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/requests/$id")({
  component: RequestDetailPage,
});

type RequestStatus =
  | "PENDING"
  | "UNDER_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "CONVERTED";

type RequestItem = {
  id: number;
  assetId: number;
  assetName: string;
  assetTag: string;
  assetSerialNumber: string;
  assetManufacturer: string | null;
  assetModel: string | null;
  assetTypeName: string | null;
  convertedJobId: number | null;
  convertedJobCode: string | null;
  convertedJobStatus: string | null;
  convertedServiceName: string | null;
};

type RequestDetail = {
  id: number;
  status: RequestStatus;
  observations: string | null;
  requestedDueDate: string | null;
  submittedAt: string;
  reviewedAt: string | null;
  approvedAt: string | null;
  convertedAt: string | null;
  customerName: string;
  items: Array<RequestItem>;
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

function RequestDetailPage() {
  const { id } = Route.useParams();

  const { data, isLoading, error } = useQuery({
    queryKey: ["portal-request-detail", id],
    queryFn: async (): Promise<RequestDetail> => {
      const response = await fetch(
        `${getApiBaseUrl()}/api/portal/requests/${id}`,
        {
          credentials: "include",
        },
      );

      if (!response.ok) {
        throw new Error("Falha ao carregar solicitação");
      }

      return response.json();
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Spinner className="size-8" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-destructive">
          Erro ao carregar solicitação.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Solicitação #{data.id}
          </h1>
          <p className="text-sm text-muted-foreground">
            Enviada em {formatDate(data.submittedAt)}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${statusClasses[data.status]}`}
          >
            {statusLabels[data.status]}
          </span>
          <Button variant="outline" render={<Link to="/requests/new" />}>
            Nova Solicitação
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Resumo</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div>
            <div className="text-sm text-muted-foreground">Cliente</div>
            <div className="font-medium">{data.customerName}</div>
          </div>
          <div>
            <div className="text-sm text-muted-foreground">
              Prazo solicitado
            </div>
            <div className="font-medium">
              {formatDate(data.requestedDueDate)}
            </div>
          </div>
          <div className="sm:col-span-2">
            <div className="text-sm text-muted-foreground">Observações</div>
            <div className="font-medium">
              {data.observations?.trim() || "Sem observações informadas."}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ativos solicitados</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {data.items.map((item) => (
            <div key={item.id} className="rounded-lg border p-4">
              <div className="font-medium">
                {item.assetName}{" "}
                <span className="text-muted-foreground">({item.assetTag})</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Série {item.assetSerialNumber}
                {item.assetManufacturer && ` · ${item.assetManufacturer}`}
                {item.assetTypeName && ` · ${item.assetTypeName}`}
              </p>
              {item.convertedJobCode && (
                <p className="mt-2 text-sm text-muted-foreground">
                  Convertida na OS {item.convertedJobCode}
                  {item.convertedServiceName &&
                    ` · ${item.convertedServiceName}`}
                </p>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
