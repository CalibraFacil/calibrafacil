import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  ArrowRight01Icon,
  Calendar03Icon,
  CheckmarkCircle02Icon,
  File01Icon,
  Notebook01Icon,
  Wrench01Icon,
} from "@hugeicons/core-free-icons";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getApiBaseUrl } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/")({
  component: PortalHome,
});

type RequestStatus =
  | "PENDING"
  | "UNDER_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "CONVERTED";

type DashboardAsset = {
  id: number;
  name: string;
  tag: string;
  nextCalibrationDate: string | null;
};

type DashboardRequest = {
  id: number;
  status: RequestStatus;
  submittedAt: string;
  requestedDueDate: string | null;
  itemCount: number;
};

type DashboardCertificate = {
  id: number;
  jobId: string;
  approvedAt: string | null;
  certificateUrl: string | null;
  assetName: string;
  assetTag: string;
};

type PaginatedResponse<T> = {
  data: Array<T>;
  pagination: {
    total: number;
  };
};

type PortalDashboardData = {
  assets: PaginatedResponse<DashboardAsset>;
  requests: PaginatedResponse<DashboardRequest>;
  certificates: PaginatedResponse<DashboardCertificate>;
};

const requestStatusLabels: Record<RequestStatus, string> = {
  PENDING: "Pendente",
  UNDER_REVIEW: "Em análise",
  APPROVED: "Aprovada",
  REJECTED: "Rejeitada",
  CONVERTED: "Convertida",
};

const requestStatusVariants: Record<
  RequestStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  PENDING: "secondary",
  UNDER_REVIEW: "outline",
  APPROVED: "default",
  REJECTED: "destructive",
  CONVERTED: "outline",
};

function formatDate(date: string | null | undefined): string {
  if (!date) return "-";

  return new Date(date).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

async function fetchPortalDashboard(): Promise<PortalDashboardData> {
  const [assetsResponse, requestsResponse, certificatesResponse] =
    await Promise.all([
      fetch(`${getApiBaseUrl()}/api/portal/assets?page=1&limit=5`, {
        credentials: "include",
      }),
      fetch(`${getApiBaseUrl()}/api/portal/requests?page=1&limit=5`, {
        credentials: "include",
      }),
      fetch(`${getApiBaseUrl()}/api/portal/certificates?page=1&limit=5`, {
        credentials: "include",
      }),
    ]);

  if (!assetsResponse.ok || !requestsResponse.ok || !certificatesResponse.ok) {
    throw new Error("Falha ao carregar resumo do portal");
  }

  const [assets, requests, certificates] = await Promise.all([
    assetsResponse.json() as Promise<PaginatedResponse<DashboardAsset>>,
    requestsResponse.json() as Promise<PaginatedResponse<DashboardRequest>>,
    certificatesResponse.json() as Promise<
      PaginatedResponse<DashboardCertificate>
    >,
  ]);

  return { assets, requests, certificates };
}

function PortalHome() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["portal-dashboard"],
    queryFn: fetchPortalDashboard,
  });

  const pendingRequests =
    data?.requests.data.filter((request) =>
      ["PENDING", "UNDER_REVIEW"].includes(request.status),
    ).length ?? 0;

  const readyCertificates =
    data?.certificates.data.filter((certificate) => certificate.certificateUrl)
      .length ?? 0;

  const nextDueAsset = data?.assets.data
    .filter((asset) => asset.nextCalibrationDate)
    .sort(
      (left, right) =>
        new Date(left.nextCalibrationDate ?? 0).getTime() -
        new Date(right.nextCalibrationDate ?? 0).getTime(),
    )[0];

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Resumo indisponível</CardTitle>
          <CardDescription>
            Não foi possível carregar os dados do portal agora.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button render={<Link to="/requests/new" />}>
            <HugeiconsIcon icon={Add01Icon} className="mr-2 size-4" />
            Nova Solicitação
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-2xl space-y-2">
          <p className="text-sm font-medium text-primary">Portal do Cliente</p>
          <h1 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
            Acompanhe o que precisa de atenção
          </h1>
          <p className="text-pretty text-sm text-muted-foreground">
            Veja solicitações em andamento, certificados recentes e o próximo
            ativo no calendário de calibração.
          </p>
        </div>

        <Button render={<Link to="/requests/new" />} className="sm:mt-1">
          <HugeiconsIcon icon={Add01Icon} className="mr-2 size-4" />
          Nova Solicitação
        </Button>
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard
          icon={Wrench01Icon}
          label="Ativos ativos"
          value={data?.assets.pagination.total}
          description={
            nextDueAsset
              ? `Próxima calibração: ${formatDate(nextDueAsset.nextCalibrationDate)}`
              : "Nenhum vencimento próximo listado"
          }
          isLoading={isLoading}
        />
        <MetricCard
          icon={Notebook01Icon}
          label="Solicitações abertas"
          value={pendingRequests}
          description={`${data?.requests.pagination.total ?? 0} solicitações no histórico`}
          isLoading={isLoading}
        />
        <MetricCard
          icon={File01Icon}
          label="Certificados prontos"
          value={readyCertificates}
          description={`${data?.certificates.pagination.total ?? 0} certificados disponíveis`}
          isLoading={isLoading}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader className="gap-3 sm:flex sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <CardTitle>Últimos certificados</CardTitle>
              <CardDescription>
                Arquivos aprovados recentemente pelo laboratório.
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              render={<Link to="/certificates" />}
            >
              Ver todos
              <HugeiconsIcon icon={ArrowRight01Icon} className="ml-2 size-4" />
            </Button>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <ActivitySkeleton />
            ) : data?.certificates.data.length ? (
              <div className="divide-y">
                {data.certificates.data.map((certificate) => (
                  <Link
                    key={certificate.id}
                    to="/certificates/$id"
                    params={{ id: String(certificate.id) }}
                    className="group flex min-h-16 items-center gap-3 py-3 transition-[background-color] hover:bg-muted/40"
                  >
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <HugeiconsIcon icon={File01Icon} className="size-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {certificate.jobId}
                      </p>
                      <p className="truncate text-sm text-muted-foreground">
                        {certificate.assetName} · {certificate.assetTag}
                      </p>
                    </div>
                    <div className="hidden text-right sm:block">
                      <p className="text-sm tabular-nums">
                        {formatDate(certificate.approvedAt)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {certificate.certificateUrl
                          ? "PDF disponível"
                          : "Gerando PDF"}
                      </p>
                    </div>
                    <HugeiconsIcon
                      icon={ArrowRight01Icon}
                      className="size-4 shrink-0 text-muted-foreground transition-[transform,color] group-hover:translate-x-0.5 group-hover:text-foreground"
                    />
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={File01Icon}
                title="Nenhum certificado ainda"
                description="Quando o laboratório aprovar uma calibração, o certificado aparecerá aqui."
              />
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Solicitações em andamento</CardTitle>
              <CardDescription>
                Pedidos enviados ao laboratório para revisão.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <ActivitySkeleton rows={3} />
              ) : data?.requests.data.length ? (
                <div className="space-y-3">
                  {data.requests.data.slice(0, 3).map((request) => (
                    <Link
                      key={request.id}
                      to="/requests/$id"
                      params={{ id: String(request.id) }}
                      className="flex min-h-14 items-center justify-between gap-3 rounded-lg px-3 py-2 shadow-[0_0_0_1px_rgb(0_0_0/0.08)] transition-[background-color,box-shadow] hover:bg-muted/40 hover:shadow-[0_0_0_1px_rgb(0_0_0/0.12)] dark:shadow-[0_0_0_1px_rgb(255_255_255/0.1)] dark:hover:shadow-[0_0_0_1px_rgb(255_255_255/0.16)]"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          Solicitação #{request.id}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {request.itemCount} ativo(s) ·{" "}
                          {formatDate(request.submittedAt)}
                        </p>
                      </div>
                      <Badge variant={requestStatusVariants[request.status]}>
                        {requestStatusLabels[request.status]}
                      </Badge>
                    </Link>
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={Notebook01Icon}
                  title="Nenhuma solicitação aberta"
                  description="Crie uma solicitação quando precisar calibrar um ou mais ativos."
                />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Próxima calibração</CardTitle>
              <CardDescription>
                Ativo com menor data de vencimento na lista atual.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-5 w-2/3" />
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-9 w-full" />
                </div>
              ) : nextDueAsset ? (
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
                      <HugeiconsIcon icon={Calendar03Icon} className="size-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {nextDueAsset.name}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {nextDueAsset.tag} ·{" "}
                        {formatDate(nextDueAsset.nextCalibrationDate)}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    className="w-full"
                    render={
                      <Link
                        to="/assets/$id"
                        params={{ id: String(nextDueAsset.id) }}
                      />
                    }
                  >
                    Ver ativo
                  </Button>
                </div>
              ) : (
                <div className="flex items-start gap-3 rounded-lg bg-muted/50 p-3">
                  <HugeiconsIcon
                    icon={CheckmarkCircle02Icon}
                    className="mt-0.5 size-5 shrink-0 text-primary"
                  />
                  <p className="text-pretty text-sm text-muted-foreground">
                    Nenhum ativo com data de próxima calibração foi encontrado
                    no resumo atual.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  description,
  isLoading,
}: {
  icon: typeof Wrench01Icon;
  label: string;
  value: number | undefined;
  description: string;
  isLoading: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <CardDescription>{label}</CardDescription>
          {isLoading ? (
            <Skeleton className="h-8 w-16" />
          ) : (
            <CardTitle className="text-3xl font-semibold tabular-nums">
              {value ?? 0}
            </CardTitle>
          )}
        </div>
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <HugeiconsIcon icon={icon} className="size-5" />
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-4 w-4/5" />
        ) : (
          <p className="text-pretty text-sm text-muted-foreground">
            {description}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ActivitySkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex items-center gap-3">
          <Skeleton className="size-10 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({
  icon,
  title,
  description,
}: {
  icon: typeof Wrench01Icon;
  title: string;
  description: string;
}) {
  return (
    <div className="flex min-h-36 flex-col items-center justify-center rounded-lg bg-muted/40 p-6 text-center">
      <div className="mb-3 flex size-10 items-center justify-center rounded-lg bg-background text-muted-foreground shadow-[0_0_0_1px_rgb(0_0_0/0.08)] dark:shadow-[0_0_0_1px_rgb(255_255_255/0.1)]">
        <HugeiconsIcon icon={icon} className="size-5" />
      </div>
      <p className="font-medium">{title}</p>
      <p className="mt-1 max-w-sm text-pretty text-sm text-muted-foreground">
        {description}
      </p>
    </div>
  );
}
