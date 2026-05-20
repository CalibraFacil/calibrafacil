import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft02Icon,
  Calendar03Icon,
  CheckmarkCircle02Icon,
  File01Icon,
  InformationCircleIcon,
  Wrench01Icon,
} from "@hugeicons/core-free-icons";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getApiBaseUrl } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/assets/$id")({
  component: AssetDetailPage,
});

type AssetStatus = "ACTIVE" | "INACTIVE" | "MAINTENANCE" | "SCRAPPED";

type AssetCertificate = {
  id: number;
  jobId: string;
  certificateName: string | null;
  status: string;
  performedAt: string | null;
  approvedAt: string | null;
  certificateUrl: string | null;
  verificationToken: string;
  serviceName: string;
  labName: string;
};

type AssetDetail = {
  id: number;
  customerId: number;
  customerName: string;
  assetTypeId: number;
  assetTypeName: string;
  assetTypeSlug: string;
  name: string;
  manufacturer: string | null;
  model: string | null;
  serialNumber: string;
  tag: string;
  status: AssetStatus;
  specifications: Record<string, unknown> | null;
  lastCalibrationDate: string | null;
  nextCalibrationDate: string | null;
  comments: string | null;
  createdAt: string;
  updatedAt: string;
  certificates: Array<AssetCertificate>;
};

const statusLabels: Record<AssetStatus, string> = {
  ACTIVE: "Ativo",
  INACTIVE: "Inativo",
  MAINTENANCE: "Manutenção",
  SCRAPPED: "Descartado",
};

const statusVariants: Record<
  AssetStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  ACTIVE: "default",
  INACTIVE: "secondary",
  MAINTENANCE: "outline",
  SCRAPPED: "destructive",
};

function formatDate(value: string | null | undefined): string {
  if (!value) return "-";

  return new Date(value).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatSpecificationValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";

  if (Array.isArray(value)) {
    return value.map(formatSpecificationValue).join(", ");
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

const specificationLabels: Record<string, string> = {
  capacity: "Capacidade",
  humidityRangeMax: "Faixa de umidade máx.",
  humidityRangeMin: "Faixa de umidade mín.",
  humidityResolution: "Resolução de umidade",
  immersionDepth: "Profundidade de imersão",
  immersionType: "Tipo de imersão",
  instrumentType: "Tipo",
  jawType: "Tipo de bico",
  linearity: "Linearidade",
  rangeMax: "Faixa máx.",
  rangeMin: "Faixa mín.",
  repeatability: "Repetitividade",
  resolution: "Resolução",
  scaleDivision: "Divisão de escala",
  tempRangeMax: "Faixa de temperatura máx.",
  tempRangeMin: "Faixa de temperatura mín.",
  tempResolution: "Resolução de temperatura",
  weighingRanges: "Faixas de pesagem",
};

function formatSpecificationLabel(key: string): string {
  if (specificationLabels[key]) return specificationLabels[key];

  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (character) => character.toLocaleUpperCase("pt-BR"));
}

function daysUntil(value: string | null | undefined): number | null {
  if (!value) return null;

  const today = new Date();
  const dueDate = new Date(value);
  today.setHours(0, 0, 0, 0);
  dueDate.setHours(0, 0, 0, 0);

  return Math.ceil((dueDate.getTime() - today.getTime()) / 86_400_000);
}

function AssetDetailPage() {
  const { id } = Route.useParams();

  const assetQuery = useQuery({
    queryKey: ["portal-asset", id],
    queryFn: async (): Promise<AssetDetail> => {
      const response = await fetch(
        `${getApiBaseUrl()}/api/portal/assets/${id}`,
        { credentials: "include" },
      );

      if (!response.ok) {
        throw new Error("Falha ao carregar ativo.");
      }

      const result = (await response.json()) as { data: AssetDetail };
      return result.data;
    },
  });

  if (assetQuery.isLoading) {
    return <AssetDetailSkeleton />;
  }

  const asset = assetQuery.data;

  if (assetQuery.error || !asset) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Ativo não encontrado</CardTitle>
          <CardDescription>
            O ativo não está disponível para este acesso.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" render={<Link to="/assets" />}>
            <HugeiconsIcon icon={ArrowLeft02Icon} className="size-4" />
            Voltar
          </Button>
        </CardContent>
      </Card>
    );
  }

  const dueInDays = daysUntil(asset.nextCalibrationDate);
  const dueLabel =
    dueInDays === null
      ? "Sem próxima calibração"
      : dueInDays < 0
        ? `Vencida há ${Math.abs(dueInDays)} dia(s)`
        : dueInDays === 0
          ? "Vence hoje"
          : `Vence em ${dueInDays} dia(s)`;
  const specifications = Object.entries(asset.specifications ?? {});

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <Button variant="ghost" size="sm" render={<Link to="/assets" />}>
            <HugeiconsIcon icon={ArrowLeft02Icon} className="size-4" />
            Voltar
          </Button>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Badge variant={statusVariants[asset.status]}>
              {statusLabels[asset.status]}
            </Badge>
            <Badge variant="secondary">{asset.assetTypeName}</Badge>
          </div>
          <h1 className="mt-3 text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
            {asset.name}
          </h1>
          <p className="mt-2 text-pretty text-sm text-muted-foreground">
            Tag <span className="font-mono tabular-nums">{asset.tag}</span>
            {" · "}Série{" "}
            <span className="font-mono tabular-nums">{asset.serialNumber}</span>
          </p>
        </div>

        <Button render={<Link to="/requests/new" />}>
          <HugeiconsIcon icon={Wrench01Icon} className="size-4" />
          Solicitar calibração
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard
          icon={Calendar03Icon}
          label="Próxima calibração"
          value={formatDate(asset.nextCalibrationDate)}
          detail={dueLabel}
        />
        <MetricCard
          icon={CheckmarkCircle02Icon}
          label="Última calibração"
          value={formatDate(asset.lastCalibrationDate)}
          detail="Data registrada no cadastro"
        />
        <MetricCard
          icon={File01Icon}
          label="Certificados"
          value={String(asset.certificates.length)}
          detail="Últimos documentos aprovados"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Identificação</CardTitle>
              <CardDescription>
                Dados principais do instrumento cadastrado.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Info label="Fabricante" value={asset.manufacturer} />
              <Info label="Modelo" value={asset.model} />
              <Info label="Número de série" value={asset.serialNumber} mono />
              <Info label="Tag" value={asset.tag} mono />
              <Info label="Cliente" value={asset.customerName} />
              <Info label="Atualizado em" value={formatDate(asset.updatedAt)} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Especificações</CardTitle>
              <CardDescription>
                Características técnicas usadas no processo de calibração.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {specifications.length > 0 ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {specifications.map(([key, value]) => (
                    <div
                      key={key}
                      className="rounded-lg bg-muted/60 p-3 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.04)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)]"
                    >
                      <p className="text-xs font-medium uppercase text-muted-foreground">
                        {formatSpecificationLabel(key)}
                      </p>
                      <p className="mt-1 text-sm font-medium tabular-nums">
                        {formatSpecificationValue(value)}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Nenhuma especificação registrada.
                </p>
              )}
            </CardContent>
          </Card>

          {asset.comments && (
            <Card>
              <CardHeader>
                <CardTitle>Observações</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-pretty text-sm leading-6 text-muted-foreground">
                  {asset.comments}
                </p>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Histórico de certificados</CardTitle>
              <CardDescription>
                Últimos certificados aprovados para este ativo.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {asset.certificates.length > 0 ? (
                asset.certificates.map((certificate) => (
                  <Link
                    key={certificate.id}
                    to="/certificates/$id"
                    params={{ id: String(certificate.id) }}
                    className="group flex min-h-16 items-center gap-3 rounded-xl p-3 shadow-[inset_0_0_0_1px_var(--color-border)] transition-[background-color,box-shadow,transform] hover:bg-muted/60 hover:shadow-[inset_0_0_0_1px_var(--color-border),0_8px_24px_rgba(0,0,0,0.06)] active:scale-[0.96] dark:hover:shadow-[inset_0_0_0_1px_var(--color-border),0_8px_24px_rgba(0,0,0,0.18)]"
                  >
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <HugeiconsIcon icon={File01Icon} className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {certificate.jobId}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {certificate.serviceName} ·{" "}
                        <span className="tabular-nums">
                          {formatDate(certificate.approvedAt)}
                        </span>
                      </p>
                    </div>
                  </Link>
                ))
              ) : (
                <div className="rounded-xl bg-muted/60 p-4 text-sm text-muted-foreground">
                  Nenhum certificado aprovado encontrado.
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Resumo operacional</CardTitle>
              <CardDescription>
                Informações rápidas para acompanhamento.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Info label="Tipo" value={asset.assetTypeName} />
              <Info label="Status" value={statusLabels[asset.status]} />
              <Info label="Criado em" value={formatDate(asset.createdAt)} />
              <div className="rounded-xl bg-muted/60 p-4">
                <div className="flex items-start gap-3">
                  <HugeiconsIcon
                    icon={InformationCircleIcon}
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  />
                  <p className="text-pretty text-sm text-muted-foreground">
                    Use a solicitação de calibração para enviar este ativo ao
                    laboratório junto com outros instrumentos da organização.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function AssetDetailSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-5 w-96 max-w-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <Card key={index}>
            <CardContent className="p-5">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="mt-3 h-8 w-32" />
              <Skeleton className="mt-2 h-4 w-40" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  detail,
}: {
  icon: typeof Calendar03Icon;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <Card>
      <CardContent className="flex min-h-32 items-start gap-4 p-5">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <HugeiconsIcon icon={icon} className="size-4" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">
            {value}
          </p>
          <p className="mt-1 text-pretty text-xs text-muted-foreground">
            {detail}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function Info({
  label,
  value,
  mono = false,
}: {
  label: string;
  value?: string | null;
  mono?: boolean;
}) {
  return (
    <div>
      <p className="text-xs font-medium uppercase text-muted-foreground">
        {label}
      </p>
      <p
        className={
          mono
            ? "mt-1 text-sm font-medium tabular-nums"
            : "mt-1 text-sm font-medium"
        }
      >
        {value?.trim() || "-"}
      </p>
    </div>
  );
}
